import { createHash, createHmac, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ulid } from "ulid";
import { z } from "zod";
import type { UniversalChannelAction } from "@agentos/actions";
import type { ChannelAdapter, ChannelCapabilities, PresenceOperation } from "@agentos/channels";
import * as dbs from "@agentos/database";
import { toRuntimeEvent, universalEventSchema, type AgentEvent, type UniversalEvent } from "@agentos/events";
import type { TrustedBusinessContext } from "@agentos/shared";
import { pageContextSchema, parseVisitorSession, sdkVersionSchema, signVisitorSession, WEB_CHAT_SDK_PROTOCOL_VERSION, type VerifiedVisitorSession } from "./contracts";

export const PRODUCTION_WEB_CHAT_CHANNEL = "web_chat";
const visitorIdSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
const siteInputSchema = z.object({ businessId: z.string().min(1), agentId: z.string().min(1), allowedOrigins: z.array(z.string()).min(1).max(20), requestsPerMinute: z.number().int().min(1).max(600).default(60) });
const inboundSchema = z.object({ message: z.string().trim().min(1).max(20_000), idempotencyKey: z.string().min(1).max(150), pageContext: pageContextSchema.optional(), attachments: z.array(z.never()).optional() }).strict();
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const allowedOrigin = (value: string) => { const url = new URL(value); if (url.origin !== value || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new Error("INVALID_ALLOWED_ORIGIN"); return value; };
const bearer = (headers: Headers) => { const value = headers.get("authorization") ?? ""; if (!value.startsWith("Bearer ")) throw new Error("VISITOR_SESSION_INVALID"); return value.slice(7); };

/** Durable site/session authority shared by the public HTTP transport and channel adapter. */
export class PostgresWebChatService {
  constructor(readonly db: NodePgDatabase, private readonly secret: string, private readonly now = () => new Date()) { if (secret.length < 32) throw new Error("VISITOR_SESSION_SECRET_TOO_SHORT"); }
  private hash(value: string) { return createHmac("sha256", this.secret).update(value).digest("hex"); }
  private async consume(key: string, limit: number) {
    const minute = Math.floor(this.now().getTime() / 60_000);
    const bucket = this.hash(`${key}:${minute}`);
    const rows = await this.db.insert(dbs.webChatRateBuckets).values({ key: bucket, count: 1, expiresAt: new Date((minute + 2) * 60_000) }).onConflictDoUpdate({ target: dbs.webChatRateBuckets.key, set: { count: sql`${dbs.webChatRateBuckets.count} + 1` }, setWhere: sql`${dbs.webChatRateBuckets.count} < ${limit}` }).returning({ count: dbs.webChatRateBuckets.count });
    if (!rows.length) throw new Error("RATE_LIMITED");
  }
  async createSite(context: TrustedBusinessContext, input: unknown) {
    if (context.principal.kind !== "user" || !context.capabilityGrants.includes("channel.manage")) throw new Error("FORBIDDEN");
    const actorId = context.principal.userId;
    const parsed = siteInputSchema.parse(input); if (context.businessId !== parsed.businessId) throw new Error("TRUSTED_SCOPE_MISMATCH");
    const origins = [...new Set(parsed.allowedOrigins.map(allowedOrigin))];
    const agent = (await this.db.select({ id: dbs.agents.id }).from(dbs.agents).where(and(eq(dbs.agents.businessId, parsed.businessId), eq(dbs.agents.id, parsed.agentId))).limit(1))[0];
    if (!agent) throw new Error("AGENT_NOT_FOUND");
    const id = ulid(); const publicKey = `pk_${randomBytes(24).toString("base64url")}`;
    await this.db.transaction(async (tx) => {
      await tx.insert(dbs.websiteSites).values({ id, businessId: parsed.businessId, agentId: parsed.agentId, publicKey, allowedOrigins: origins, enabled: false, sdkMajorVersion: 1, requestsPerMinute: parsed.requestsPerMinute });
      await tx.insert(dbs.channelConnections).values({ id, businessId: parsed.businessId, channel: PRODUCTION_WEB_CHAT_CHANNEL, externalPageId: id, displayName: `Website ${id}`, agentId: parsed.agentId, state: "DRAFT", paused: true, setupMethod: "WEBSITE_SDK", capabilities: { text: true, attachments: false } });
      await tx.insert(dbs.auditLogs).values({ id: ulid(), businessId: parsed.businessId, actorId, action: "web_chat.site.created", targetType: "website_site", targetId: id, safeMetadata: { originsCount: origins.length } });
    });
    return { id, publicKey, allowedOrigins: origins, enabled: false };
  }
  async setSiteEnabled(context: TrustedBusinessContext, siteId: string, enabled: boolean) {
    if (context.principal.kind !== "user" || !context.capabilityGrants.includes("channel.manage")) throw new Error("FORBIDDEN");
    const actorId = context.principal.userId;
    await this.db.transaction(async (tx) => {
      const site = (await tx.select({ id: dbs.websiteSites.id }).from(dbs.websiteSites).where(and(eq(dbs.websiteSites.id, siteId), eq(dbs.websiteSites.businessId, context.businessId))).limit(1).for("update"))[0];
      if (!site) throw new Error("SITE_NOT_FOUND");
      if (enabled) { const ready = (await tx.select({ id: dbs.agentVersions.id }).from(dbs.websiteSites).innerJoin(dbs.agents, eq(dbs.agents.id, dbs.websiteSites.agentId)).innerJoin(dbs.agentVersions, eq(dbs.agentVersions.id, dbs.agents.activeVersionId)).where(and(eq(dbs.websiteSites.id, siteId), eq(dbs.agents.businessId, context.businessId), eq(dbs.agentVersions.businessId, context.businessId), eq(dbs.agentVersions.state, "PUBLISHED"))).limit(1))[0]; if (!ready) throw new Error("AGENT_NOT_PUBLISHED"); }
      await tx.update(dbs.websiteSites).set({ enabled, updatedAt: this.now() }).where(eq(dbs.websiteSites.id, siteId));
      await tx.update(dbs.channelConnections).set({ state: enabled ? "CONNECTED" : "PAUSED", paused: !enabled, updatedAt: this.now() }).where(and(eq(dbs.channelConnections.id, siteId), eq(dbs.channelConnections.businessId, context.businessId), eq(dbs.channelConnections.channel, PRODUCTION_WEB_CHAT_CHANNEL)));
      if (!enabled) await tx.update(dbs.visitorSessions).set({ revokedAt: this.now(), updatedAt: this.now() }).where(and(eq(dbs.visitorSessions.siteId, siteId), eq(dbs.visitorSessions.businessId, context.businessId), isNull(dbs.visitorSessions.revokedAt)));
      await tx.insert(dbs.auditLogs).values({ id: ulid(), businessId: context.businessId, actorId, action: enabled ? "web_chat.site.enabled" : "web_chat.site.disabled", targetType: "website_site", targetId: siteId, safeMetadata: {} });
    });
  }
  async bootstrap(input: { publicKey: string; origin: string; sdkVersion: string; visitorId?: string }) {
    sdkVersionSchema.parse(input.sdkVersion); if (input.visitorId) visitorIdSchema.parse(input.visitorId);
    const row = (await this.db.select({ site: dbs.websiteSites, connection: dbs.channelConnections, business: dbs.businesses }).from(dbs.websiteSites).innerJoin(dbs.channelConnections, eq(dbs.channelConnections.id, dbs.websiteSites.id)).innerJoin(dbs.businesses, eq(dbs.businesses.id, dbs.websiteSites.businessId)).where(eq(dbs.websiteSites.publicKey, input.publicKey)).limit(1))[0];
    if (!row || !row.site.enabled || row.connection.channel !== PRODUCTION_WEB_CHAT_CHANNEL || row.connection.state !== "CONNECTED" || row.connection.paused || row.business.disabled || !["TRIAL", "ACTIVE"].includes(row.business.state) || !row.site.allowedOrigins.includes(input.origin)) throw new Error("SITE_NOT_ALLOWED");
    await this.consume(`bootstrap:${row.site.id}:${input.origin}`, Math.max(600, row.site.requestsPerMinute * 10));
    const visitorId = input.visitorId ?? ulid(); const visitorIdHash = this.hash(`${row.site.id}:${input.origin}:${visitorId}`); const expiresAt = new Date(this.now().getTime() + 15 * 60_000); const freshId = ulid();
    const sessions = await this.db.insert(dbs.visitorSessions).values({ id: freshId, businessId: row.site.businessId, siteId: row.site.id, visitorIdHash, origin: input.origin, expiresAt }).onConflictDoUpdate({ target: [dbs.visitorSessions.businessId, dbs.visitorSessions.siteId, dbs.visitorSessions.visitorIdHash], set: { expiresAt, updatedAt: this.now() }, setWhere: isNull(dbs.visitorSessions.revokedAt) }).returning({ id: dbs.visitorSessions.id });
    const saved = sessions[0]; if (!saved) throw new Error("VISITOR_SESSION_REVOKED");
    const session: VerifiedVisitorSession = { sessionId: saved.id, businessId: row.site.businessId, agentId: row.site.agentId, siteId: row.site.id, visitorId, origin: input.origin, expiresAt: expiresAt.toISOString() };
    return { schemaVersion: WEB_CHAT_SDK_PROTOCOL_VERSION, sessionToken: signVisitorSession(session, this.secret), expiresAt: session.expiresAt, capabilities: { text: true, attachments: false }, visitorId };
  }
  async authenticate(token: string, origin: string, rate = false) {
    const session = parseVisitorSession(token, this.secret); const current = this.now();
    const row = (await this.db.select({ session: dbs.visitorSessions, site: dbs.websiteSites, connection: dbs.channelConnections, business: dbs.businesses }).from(dbs.visitorSessions).innerJoin(dbs.websiteSites, eq(dbs.websiteSites.id, dbs.visitorSessions.siteId)).innerJoin(dbs.channelConnections, eq(dbs.channelConnections.id, dbs.websiteSites.id)).innerJoin(dbs.businesses, eq(dbs.businesses.id, dbs.websiteSites.businessId)).where(and(eq(dbs.visitorSessions.id, session.sessionId), eq(dbs.visitorSessions.businessId, session.businessId))).limit(1))[0];
    if (!row || row.session.revokedAt || row.session.expiresAt <= current || session.expiresAt <= current.toISOString() || row.session.origin !== origin || session.origin !== origin || row.session.visitorIdHash !== this.hash(`${session.siteId}:${origin}:${session.visitorId}`) || row.session.siteId !== session.siteId || row.site.businessId !== session.businessId || row.site.agentId !== session.agentId || !row.site.enabled || !row.site.allowedOrigins.includes(origin) || row.connection.businessId !== session.businessId || row.connection.channel !== PRODUCTION_WEB_CHAT_CHANNEL || row.connection.state !== "CONNECTED" || row.connection.paused || row.business.disabled || !["TRIAL", "ACTIVE"].includes(row.business.state)) throw new Error("VISITOR_SESSION_INVALID");
    if (rate) await this.consume(`session:${session.siteId}:${session.sessionId}`, row.site.requestsPerMinute);
    return { ...session, customerId: row.session.customerId, conversationId: row.session.conversationId };
  }
  async ensureConversation(session: Awaited<ReturnType<PostgresWebChatService["authenticate"]>>) {
    return this.db.transaction(async (tx) => {
      const current = (await tx.select().from(dbs.visitorSessions).where(and(eq(dbs.visitorSessions.id, session.sessionId), eq(dbs.visitorSessions.businessId, session.businessId), eq(dbs.visitorSessions.siteId, session.siteId))).limit(1).for("update"))[0];
      if (!current || current.revokedAt || current.expiresAt <= this.now() || current.origin !== session.origin) throw new Error("VISITOR_SESSION_INVALID");
      if (current.conversationId && current.customerId) return { conversationId: current.conversationId, customerId: current.customerId };
      const customerId = ulid(); const conversationId = ulid();
      await tx.insert(dbs.customers).values({ id: customerId, businessId: session.businessId });
      await tx.insert(dbs.customerIdentities).values({ id: ulid(), businessId: session.businessId, customerId, channel: PRODUCTION_WEB_CHAT_CHANNEL, externalId: `web:${session.siteId}:${current.visitorIdHash}`, verifiedAt: this.now(), metadata: { siteId: session.siteId } });
      await tx.insert(dbs.conversations).values({ id: conversationId, businessId: session.businessId, customerId, agentId: session.agentId, channel: PRODUCTION_WEB_CHAT_CHANNEL });
      await tx.update(dbs.visitorSessions).set({ customerId, conversationId, updatedAt: this.now() }).where(eq(dbs.visitorSessions.id, session.sessionId));
      return { conversationId, customerId };
    });
  }
  async poll(token: string, origin: string, after?: string) {
    const session = await this.authenticate(token, origin, true);
    if (after) visitorIdSchema.parse(after);
    if (!session.conversationId) return { messages: [], ownership: "AI_ACTIVE", nextCursor: after ?? null };
    const [rows, conversation] = await Promise.all([
      this.db.select({ id: dbs.messages.id, senderKind: dbs.messages.senderKind, text: dbs.messages.text, occurredAt: dbs.messages.occurredAt }).from(dbs.messages).where(and(eq(dbs.messages.businessId, session.businessId), eq(dbs.messages.conversationId, session.conversationId), ...(after ? [gt(dbs.messages.id, after)] : []))).orderBy(dbs.messages.id).limit(100),
      this.db.select({ ownership: dbs.conversations.ownership }).from(dbs.conversations).where(and(eq(dbs.conversations.businessId, session.businessId), eq(dbs.conversations.id, session.conversationId))).limit(1),
    ]);
    return { messages: rows.filter((row) => ["CUSTOMER", "AGENT", "HUMAN"].includes(row.senderKind)).map((row) => ({ ...row, occurredAt: row.occurredAt.toISOString() })), ownership: conversation[0]?.ownership ?? "PAUSED", nextCursor: rows.at(-1)?.id ?? after ?? null };
  }
  async revoke(token: string, origin: string) {
    const session = await this.authenticate(token, origin, true);
    await this.db.update(dbs.visitorSessions).set({ revokedAt: this.now(), updatedAt: this.now() }).where(and(eq(dbs.visitorSessions.id, session.sessionId), eq(dbs.visitorSessions.businessId, session.businessId), isNull(dbs.visitorSessions.revokedAt)));
  }
}

const capabilities: ChannelCapabilities = { canSendText: true, canSendImage: false, canSendFile: false, canSendProduct: false, canReact: false, canReplyToMessage: true, canReplyToComment: false, canHideComment: false, canDeleteComment: false, canMarkSeen: false, canShowTyping: false, canOpenExternalConversation: false, supportsMessageEdits: false, supportsMessageDeletes: false };

export class WebChatAdapter implements ChannelAdapter {
  readonly channel = PRODUCTION_WEB_CHAT_CHANNEL;
  constructor(private readonly service: PostgresWebChatService) {}
  async verifyInbound(request: { headers: Headers; body: Uint8Array }) { try { await this.service.authenticate(bearer(request.headers), request.headers.get("origin") ?? ""); return { verified: true }; } catch { return { verified: false, safeReason: "VISITOR_SESSION_INVALID" }; } }
  async normalizeUniversalInbound(request: { headers: Headers; body: Uint8Array }, context: TrustedBusinessContext): Promise<UniversalEvent[]> {
    const session = await this.service.authenticate(bearer(request.headers), request.headers.get("origin") ?? "");
    if (context.principal.kind !== "adapter" || context.source !== "verified_adapter" || context.principal.connectionId !== session.siteId || context.businessId !== session.businessId || context.agentId !== session.agentId || context.conversationId !== session.conversationId || context.customerId !== session.customerId) throw new Error("TRUSTED_SCOPE_MISMATCH");
    const body = inboundSchema.parse(JSON.parse(new TextDecoder().decode(request.body))); const now = new Date().toISOString(); const externalId = `web:${digest(`${session.sessionId}:${body.idempotencyKey}`)}`;
    return [universalEventSchema.parse({ id: ulid(), schemaVersion: "1.0", type: "message.received", businessId: session.businessId, channel: this.channel, connectionId: session.siteId, conversationId: session.conversationId, customerId: session.customerId, dedupeKey: externalId, occurredAt: now, receivedAt: now, traceId: context.traceId, rawEventId: ulid(), source: { kind: "adapter", externalEventId: externalId, externalMessageId: externalId }, payload: { messageId: ulid(), text: body.message, attachmentIds: [], ...(body.pageContext ? { pageContext: body.pageContext } : {}) } })];
  }
  async normalizeInbound(request: { headers: Headers; body: Uint8Array }, context: TrustedBusinessContext): Promise<AgentEvent[]> { return (await this.normalizeUniversalInbound(request, context)).map((event) => toRuntimeEvent(event, 1)); }
  private async target(context: TrustedBusinessContext, live: boolean) {
    if (!context.conversationId) throw new Error("CONVERSATION_REQUIRED");
    const row = (await this.service.db.select({ session: dbs.visitorSessions, site: dbs.websiteSites, connection: dbs.channelConnections, conversation: dbs.conversations }).from(dbs.visitorSessions).innerJoin(dbs.websiteSites, eq(dbs.websiteSites.id, dbs.visitorSessions.siteId)).innerJoin(dbs.channelConnections, eq(dbs.channelConnections.id, dbs.websiteSites.id)).innerJoin(dbs.conversations, eq(dbs.conversations.id, dbs.visitorSessions.conversationId)).where(and(eq(dbs.visitorSessions.businessId, context.businessId), eq(dbs.visitorSessions.conversationId, context.conversationId), eq(dbs.conversations.businessId, context.businessId), eq(dbs.conversations.channel, this.channel))).limit(1))[0];
    if (!row) throw new Error("CHANNEL_TARGET_NOT_FOUND");
    if (live && (!row.site.enabled || row.connection.state !== "CONNECTED" || row.connection.paused || row.conversation.ownership !== "AI_ACTIVE" || row.conversation.agentId !== row.site.agentId)) throw new Error("CHANNEL_DISCONNECTED");
    return row;
  }
  async capabilities(context: TrustedBusinessContext) { try { await this.target(context, true); return capabilities; } catch { return { ...capabilities, canSendText: false, canReplyToMessage: false }; } }
  async health(context: TrustedBusinessContext) { try { await this.target(context, true); return { status: "HEALTHY" as const, checkedAt: new Date().toISOString() }; } catch { return { status: "UNAVAILABLE" as const, checkedAt: new Date().toISOString(), safeMessage: "Website chat is unavailable" }; } }
  async presence(_context: TrustedBusinessContext, _operation: PresenceOperation) { return { status: "SKIPPED" as const, safeReason: "VISITOR_POLLING" }; }
  async execute(context: TrustedBusinessContext, action: UniversalChannelAction) {
    const target = await this.target(context, true);
    if (action.type !== "SendMessage" && action.type !== "ReplyToMessage" && action.type !== "SendProduct") return { status: "SKIPPED" as const, safeReason: "CAPABILITY_UNAVAILABLE" };
    if (action.type === "ReplyToMessage") { const referenced = (await this.service.db.select({ id: dbs.messages.id }).from(dbs.messages).where(and(eq(dbs.messages.id, action.messageId), eq(dbs.messages.businessId, context.businessId), eq(dbs.messages.conversationId, context.conversationId!), eq(dbs.messages.senderKind, "CUSTOMER"))).limit(1))[0]; if (!referenced) return { status: "SKIPPED" as const, safeReason: "REPLY_TARGET_INVALID" }; }
    const text = action.type === "SendProduct" ? `${action.fallbackText}${action.url ? `\n${action.url}` : ""}` : action.text;
    const externalId = `web:${digest(`${target.site.id}:${action.idempotencyKey}`)}`;
    const inserted = await this.service.db.insert(dbs.messages).values({ id: ulid(), businessId: context.businessId, conversationId: context.conversationId!, customerId: target.conversation.customerId, connectionId: target.site.id, externalMessageId: externalId, externalParentId: action.type === "ReplyToMessage" ? action.messageId : null, senderKind: "AGENT", text, occurredAt: new Date(), traceId: context.traceId, lifecycle: { actionId: action.id, status: "SENT" } }).onConflictDoNothing().returning({ id: dbs.messages.id });
    if (!inserted.length) { const prior = (await this.service.db.select({ text: dbs.messages.text, conversationId: dbs.messages.conversationId }).from(dbs.messages).where(and(eq(dbs.messages.businessId, context.businessId), eq(dbs.messages.connectionId, target.site.id), eq(dbs.messages.externalMessageId, externalId))).limit(1))[0]; if (!prior || prior.conversationId !== context.conversationId || prior.text !== text) throw new Error("WEB_CHAT_IDEMPOTENCY_CONFLICT"); }
    return { status: "EXECUTED" as const, externalId };
  }
  async reconcile(context: TrustedBusinessContext, action: UniversalChannelAction) { const row = await this.target(context, false); const externalId = `web:${digest(`${row.site.id}:${action.idempotencyKey}`)}`; const sent = (await this.service.db.select({ id: dbs.messages.id }).from(dbs.messages).where(and(eq(dbs.messages.businessId, context.businessId), eq(dbs.messages.conversationId, context.conversationId!), eq(dbs.messages.connectionId, row.site.id), eq(dbs.messages.externalMessageId, externalId))).limit(1))[0]; return sent ? { status: "EXECUTED" as const, externalId } : { status: "NOT_FOUND" as const }; }
}
