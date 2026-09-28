import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ulid } from "ulid";
import { z } from "zod";
import { attachments, channelConnections, commentDecisions, conversations, facebookComments, messages, messengerSends, messengerThreads, rawInboundEvents } from "@agentos/database";
import { toRuntimeEvent, universalEventSchema, type UniversalEvent, type AgentEvent } from "@agentos/events";
import type { UniversalChannelAction } from "@agentos/actions";
import type { ChannelAdapter, ChannelCapabilities, PresenceOperation } from "../index";
import type { TrustedBusinessContext } from "@agentos/shared";
import { MetaApiError, type MetaApi } from "./meta-api";
import { PostgresCredentialVault } from "./secrets";
import { notifyMessengerReauthorization } from "./notifications";

export const FACEBOOK_MESSENGER = "facebook_messenger";
const identity = z.object({ id: z.string().min(1).max(200) });
const attachmentInput = z.object({ type: z.string().max(30), payload: z.object({ url: z.url().optional(), attachment_id: z.string().optional() }).passthrough().default({}) });
const messageInput = z.object({ mid: z.string().min(1).max(300).optional(), text: z.string().max(100_000).optional(), is_echo: z.boolean().optional(), reply_to: z.object({ mid: z.string().max(300) }).optional(), attachments: z.array(attachmentInput).max(20).optional() }).passthrough();
const messagingInput = z.object({ sender: identity, recipient: identity, timestamp: z.number().int().positive(), message: messageInput.optional(), delivery: z.object({ mids: z.array(z.string()).max(100).optional(), watermark: z.number().int().optional() }).optional(), read: z.object({ watermark: z.number().int().positive() }).optional(), reaction: z.object({ mid: z.string(), emoji: z.string().optional(), action: z.string().optional() }).optional() }).passthrough();
const envelopeSchema = z.object({ object: z.literal("page"), entry: z.array(z.object({ id: z.string().min(1).max(200), messaging: z.array(messagingInput).max(100).default([]) }).passthrough()).max(100) });
const feedChangeSchema = z.object({ field: z.string(), value: z.object({ item: z.string().optional(), verb: z.string().optional(), comment_id: z.string().min(1).max(300).optional(), post_id: z.string().min(1).max(300).optional(), parent_id: z.string().min(1).max(300).optional() }).passthrough() });
export type MetaNotification = z.infer<typeof messagingInput>;
export function parseMetaEnvelope(body: Uint8Array) { if (body.byteLength > 1_000_000) throw new Error("META_BODY_TOO_LARGE"); return envelopeSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body))); }
export function flattenMetaNotifications(body: Uint8Array) { return parseMetaEnvelope(body).entry.flatMap((entry) => entry.messaging.map((notification) => ({ pageId: entry.id, notification }))); }
export function flattenMetaFeedChanges(body: Uint8Array) { return parseMetaEnvelope(body).entry.flatMap((entry) => z.array(feedChangeSchema).max(100).parse((entry as typeof entry & { changes?: unknown }).changes ?? []).filter((change) => change.field === "feed" && change.value.item === "comment" && change.value.verb === "add" && change.value.comment_id).map((change) => ({ pageId: entry.id, commentId: change.value.comment_id!, postId: change.value.post_id, parentId: change.value.parent_id }))); }
export function verifyMetaSignature(body: Uint8Array, signature: string | null, appSecret: string) {
  if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature) || !appSecret) return false;
  const expected = createHmac("sha256", appSecret).update(body).digest();
  const supplied = Buffer.from(signature.slice(7), "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
export function verifyMetaChallenge(url: URL, verifyToken: string) {
  const mode = url.searchParams.get("hub.mode"); const token = url.searchParams.get("hub.verify_token"); const challenge = url.searchParams.get("hub.challenge");
  if (mode !== "subscribe" || !token || !challenge || challenge.length > 1000) return null;
  const a = Buffer.from(token); const b = Buffer.from(verifyToken);
  return a.length === b.length && timingSafeEqual(a, b) ? challenge : null;
}

const capabilities: ChannelCapabilities = { canSendText: true, canSendImage: true, canSendFile: false, canSendProduct: false, canReact: false, canReplyToMessage: false, canReplyToComment: false, canHideComment: false, canDeleteComment: false, canMarkSeen: true, canShowTyping: true, canOpenExternalConversation: false, supportsMessageEdits: false, supportsMessageDeletes: false };
const asDate = (ms: number) => new Date(ms).toISOString();
const selected = (request: { headers: Headers; body: Uint8Array }) => {
  const all = flattenMetaNotifications(request.body);
  const index = Number(request.headers.get("x-agentos-event-index") ?? 0);
  if (!Number.isSafeInteger(index) || index < 0 || index >= all.length) throw new Error("META_EVENT_INDEX_INVALID");
  return all[index]!;
};
export interface MessengerAssetResolver { signedUrl(context: TrustedBusinessContext, assetId: string): Promise<string>; }

/** The only production channel adapter; Meta parsing, Graph calls and credentials stay private here. */
export class FacebookMessengerAdapter implements ChannelAdapter {
  readonly channel = FACEBOOK_MESSENGER;
  constructor(private readonly db: NodePgDatabase, private readonly api: MetaApi, private readonly vault: PostgresCredentialVault, private readonly appSecret: string, private readonly assets?: MessengerAssetResolver) {}
  async verifyInbound(request: { headers: Headers; body: Uint8Array }) { return { verified: verifyMetaSignature(request.body, request.headers.get("x-hub-signature-256"), this.appSecret), safeReason: "META_SIGNATURE_INVALID" }; }
  async normalizeInbound(request: { headers: Headers; body: Uint8Array }, context: TrustedBusinessContext): Promise<AgentEvent[]> { return (await this.normalizeUniversalInbound(request, context)).filter((event) => event.type === "message.received").map((event) => toRuntimeEvent(event, 1)); }
  async normalizeUniversalInbound(request: { headers: Headers; body: Uint8Array }, context: TrustedBusinessContext): Promise<UniversalEvent[]> {
    if (request.headers.has("x-agentos-feed-index")) {
      const changes = flattenMetaFeedChanges(request.body); const index = Number(request.headers.get("x-agentos-feed-index"));
      if (!Number.isSafeInteger(index) || index < 0 || index >= changes.length) throw new Error("META_EVENT_INDEX_INVALID");
      const change = changes[index]!; const connectionId = context.principal.kind === "adapter" ? context.principal.connectionId : null;
      if (!connectionId || context.source !== "verified_adapter") throw new Error("META_SCOPE_DENIED");
      const connection = (await this.db.select({ id: channelConnections.id }).from(channelConnections).where(and(eq(channelConnections.id, connectionId), eq(channelConnections.businessId, context.businessId), eq(channelConnections.externalPageId, change.pageId), eq(channelConnections.channel, FACEBOOK_MESSENGER))).limit(1))[0];
      if (!connection) throw new Error("META_SCOPE_DENIED");
      const now = new Date().toISOString();
      return [universalEventSchema.parse({ id: ulid(), schemaVersion: "1.0", type: "comment.created", businessId: context.businessId, channel: FACEBOOK_MESSENGER, connectionId, dedupeKey: `meta:comment:${change.commentId}:add`, occurredAt: now, receivedAt: now, traceId: context.traceId, rawEventId: ulid(), source: { kind: "adapter", externalEventId: change.commentId }, payload: { externalCommentId: change.commentId, ...(change.postId ? { externalPostId: change.postId } : {}), ...(change.parentId ? { externalParentId: change.parentId } : {}) } })];
    }
    const { pageId, notification } = selected(request);
    const connectionId = context.principal.kind === "adapter" ? context.principal.connectionId : null;
    if (!connectionId || context.source !== "verified_adapter") throw new Error("META_SCOPE_DENIED");
    const connection = (await this.db.select({ id: channelConnections.id, state: channelConnections.state }).from(channelConnections).where(and(eq(channelConnections.id, connectionId), eq(channelConnections.businessId, context.businessId), eq(channelConnections.externalPageId, pageId), eq(channelConnections.channel, FACEBOOK_MESSENGER))).limit(1))[0];
    if (!connection) throw new Error("META_SCOPE_DENIED");
    if (notification.sender.id === pageId || notification.message?.is_echo) return [];
    if (!context.conversationId || !context.customerId) throw new Error("META_CONVERSATION_REQUIRED");
    const now = new Date().toISOString(); const occurredAt = asDate(notification.timestamp);
    const fingerprint = createHash("sha256").update(JSON.stringify(notification)).digest("hex").slice(0, 32);
    const sourceBase = { kind: "adapter" as const, senderId: notification.sender.id };
    const common = { schemaVersion: "1.0", businessId: context.businessId, channel: FACEBOOK_MESSENGER, connectionId, conversationId: context.conversationId, customerId: context.customerId, occurredAt, receivedAt: now, traceId: context.traceId, rawEventId: ulid() };
    if (notification.message) {
      const mid = notification.message.mid ?? `fallback:${fingerprint}`;
      // Media records are created during normalization; a replay must not create orphan media.
      const prior = (await this.db.select({ id: rawInboundEvents.id }).from(rawInboundEvents).where(and(eq(rawInboundEvents.businessId, context.businessId), eq(rawInboundEvents.connectionId, connectionId), eq(rawInboundEvents.dedupeKey, `meta:message:${mid}`))).limit(1))[0];
      if (prior) return [];
      const attachmentIds: string[] = [];
      for (const [index, item] of (notification.message.attachments ?? []).entries()) {
        const kind = item.type === "image" ? "IMAGE" : item.type === "audio" ? "AUDIO" : "DOCUMENT";
        const mimeType = kind === "IMAGE" ? "image/jpeg" : kind === "AUDIO" ? "audio/mpeg" : "application/pdf";
        const ref = item.payload.url ? await this.vault.write(context, "meta_attachment_url", item.payload.url) : null;
        const id = ulid(); attachmentIds.push(id);
        await this.db.insert(attachments).values({ id, businessId: context.businessId, conversationId: context.conversationId, source: "VERIFIED_CHANNEL", sourceRef: ref?.id ?? `meta:${pageId}:${mid}:${index}`, kind, mimeType, sizeBytes: 0, status: ref ? "RECEIVED" : "FAILED", errorCode: ref ? null : "MEDIA_URL_UNAVAILABLE", retentionUntil: new Date(Date.now() + 7 * 86400_000) });
      }
      const messageId = ulid();
      const main = universalEventSchema.parse({ ...common, id: ulid(), type: "message.received", dedupeKey: `meta:message:${mid}`, source: { ...sourceBase, externalEventId: mid, externalMessageId: mid, ...(notification.message.reply_to?.mid ? { externalParentId: notification.message.reply_to.mid } : {}) }, payload: { messageId, ...(notification.message.text ? { text: notification.message.text } : {}), attachmentIds, ...(notification.message.reply_to?.mid ? { replyToExternalId: notification.message.reply_to.mid } : {}) } });
      const media = attachmentIds.map((attachmentId, index) => universalEventSchema.parse({ ...common, id: ulid(), type: "attachment.received", dedupeKey: `meta:attachment:${mid}:${index}`, source: { ...sourceBase, externalEventId: mid, externalMessageId: mid }, payload: { attachmentId, messageId } }));
      return [main, ...media];
    }
    if (notification.delivery?.mids?.length) return notification.delivery.mids.map((mid) => universalEventSchema.parse({ ...common, id: ulid(), type: "message.delivered", dedupeKey: `meta:delivery:${mid}:${notification.delivery!.watermark ?? notification.timestamp}`, source: { ...sourceBase, externalMessageId: mid }, payload: { externalMessageId: mid, at: asDate(notification.delivery!.watermark ?? notification.timestamp) } }));
    if (notification.read) {
      const rows = await this.db.select({ externalMessageId: messages.externalMessageId }).from(messages).where(and(eq(messages.businessId, context.businessId), eq(messages.connectionId, connectionId), eq(messages.conversationId, context.conversationId), eq(messages.senderKind, "AGENT"), lte(messages.occurredAt, new Date(notification.read.watermark)))).limit(100);
      return rows.filter((row): row is { externalMessageId: string } => !!row.externalMessageId).map((row) => universalEventSchema.parse({ ...common, id: ulid(), type: "message.read", dedupeKey: `meta:read:${row.externalMessageId}:${notification.read!.watermark}`, source: { ...sourceBase, externalMessageId: row.externalMessageId }, payload: { externalMessageId: row.externalMessageId, at: asDate(notification.read!.watermark) } }));
    }
    if (notification.reaction) return [universalEventSchema.parse({ ...common, id: ulid(), type: "reaction.created", dedupeKey: `meta:reaction:${notification.reaction.mid}:${fingerprint}`, source: { ...sourceBase }, payload: { externalMessageId: notification.reaction.mid, reaction: notification.reaction.emoji ?? notification.reaction.action ?? "unknown" } })];
    return [];
  }
  private async target(context: TrustedBusinessContext, live = true) {
    if (!context.conversationId) throw new Error("CONVERSATION_REQUIRED");
    const row = (await this.db.select({ connection: channelConnections, thread: messengerThreads, ownership: conversations.ownership }).from(messengerThreads).innerJoin(channelConnections, eq(channelConnections.id, messengerThreads.connectionId)).innerJoin(conversations, eq(conversations.id, messengerThreads.conversationId)).where(and(eq(messengerThreads.businessId, context.businessId), eq(messengerThreads.conversationId, context.conversationId), eq(channelConnections.businessId, context.businessId), eq(channelConnections.channel, FACEBOOK_MESSENGER), eq(conversations.businessId, context.businessId))).limit(1))[0];
    if (!row) throw new Error("CHANNEL_TARGET_NOT_FOUND");
    if (live && (row.connection.state !== "CONNECTED" || row.connection.paused || row.ownership !== "AI_ACTIVE")) throw new Error("CHANNEL_DISCONNECTED");
    return row;
  }
  async capabilities(context: TrustedBusinessContext) { if (context.principal.kind === "system" && context.principal.service === "comment-processor") return { ...capabilities, canSendText: false, canSendImage: false, canMarkSeen: false, canShowTyping: false, canReplyToComment: true }; const row = await this.target(context, false); return row.connection.state === "CONNECTED" && !row.connection.paused ? capabilities : { ...capabilities, canSendText: false, canSendImage: false, canMarkSeen: false, canShowTyping: false }; }
  async health(context: TrustedBusinessContext) { try { await this.target(context); return { status: "HEALTHY" as const, checkedAt: new Date().toISOString() }; } catch { return { status: "UNAVAILABLE" as const, checkedAt: new Date().toISOString(), safeMessage: "Messenger Page is not ready" }; } }
  async presence(context: TrustedBusinessContext, operation: PresenceOperation) {
    if (context.principal.kind === "system" && context.principal.service === "comment-processor") return { status: "SKIPPED" as const, safeReason: "COMMENT_HAS_NO_MESSENGER_PRESENCE" };
    const row = await this.target(context, operation !== "TYPING_OFF"); if (!row.connection.credentialRefId) return { status: "SKIPPED" as const, safeReason: "CREDENTIAL_UNAVAILABLE" };
    const sender_action = operation === "MARK_SEEN" ? "mark_seen" : operation === "TYPING_OFF" ? "typing_off" : "typing_on";
    await this.api.send(row.connection.externalPageId, await this.vault.resolve(context, row.connection.credentialRefId, "meta_page_token"), { recipient: { id: row.thread.senderId }, sender_action });
    return { status: "EXECUTED" as const };
  }
  private async commentTarget(context: TrustedBusinessContext, commentId: string, decisionKey: string, outcome: "REPLY" | "HIDE") {
    if (context.principal.kind !== "system" || context.principal.service !== "comment-processor" || !context.capabilityGrants.includes(outcome === "REPLY" ? "comment.reply" : "comment.hide")) throw new Error("COMMENT_ACTION_DENIED");
    const row = (await this.db.select({ comment: facebookComments, connection: channelConnections, decision: commentDecisions, ownership: conversations.ownership }).from(commentDecisions).innerJoin(facebookComments, eq(facebookComments.id, commentDecisions.commentId)).innerJoin(channelConnections, eq(channelConnections.id, facebookComments.connectionId)).innerJoin(conversations, eq(conversations.id, facebookComments.conversationId)).where(and(eq(commentDecisions.businessId, context.businessId), eq(commentDecisions.commentId, commentId), eq(commentDecisions.idempotencyKey, decisionKey), eq(commentDecisions.outcome, outcome), eq(facebookComments.businessId, context.businessId), eq(channelConnections.businessId, context.businessId), eq(channelConnections.channel, FACEBOOK_MESSENGER), eq(conversations.businessId, context.businessId), eq(conversations.id, context.conversationId!))).limit(1))[0];
    if (!row || row.connection.agentId !== context.agentId || row.connection.state !== "CONNECTED" || row.connection.paused || row.ownership !== "AI_ACTIVE" || !row.connection.credentialRefId) throw new Error("COMMENT_ACTION_DENIED");
    const caps = row.connection.capabilities && typeof row.connection.capabilities === "object" && !Array.isArray(row.connection.capabilities) ? row.connection.capabilities as Record<string, unknown> : {};
    if (!row.connection.grantedScopes.includes("pages_manage_engagement") || caps.commentReadVerified !== true || caps[outcome === "REPLY" ? "commentReplyVerified" : "commentHideVerified"] !== true || !(outcome === "REPLY" ? row.comment.canComment : row.comment.canHide) || row.decision.safeReason !== (outcome === "REPLY" ? "APPROVED_COMMENT_REPLY" : "HIGH_CONFIDENCE_SPAM")) throw new Error("COMMENT_CAPABILITY_UNVERIFIED");
    return row;
  }
  private async claimComment(decisionId: string, businessId: string) { return (await this.db.update(commentDecisions).set({ actionStatus: "EXECUTING", updatedAt: new Date() }).where(and(eq(commentDecisions.id, decisionId), eq(commentDecisions.businessId, businessId), eq(commentDecisions.actionStatus, "PENDING"))).returning({ id: commentDecisions.id }))[0]; }
  private async commentFailure(decisionId: string, businessId: string, error: unknown) {
    const code = error instanceof MetaApiError ? error.safeCode : "EXTERNAL_OUTCOME_UNKNOWN";
    const definite = error instanceof MetaApiError && ["META_AUTH", "META_PERMISSION", "META_RATE_LIMIT", "META_REJECTED"].includes(error.safeCode);
    await this.db.update(commentDecisions).set({ actionStatus: definite ? "FAILED" : "UNKNOWN", safeReason: code, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(commentDecisions.id, decisionId), eq(commentDecisions.businessId, businessId)));
    return { status: "SKIPPED" as const, safeReason: code };
  }
  private async executeCommentReply(context: TrustedBusinessContext, action: Extract<UniversalChannelAction, { type: "ReplyToComment" }>) {
    const row = await this.commentTarget(context, action.commentId, action.idempotencyKey, "REPLY");
    if (row.decision.actionStatus === "COMPLETED") return { status: "EXECUTED" as const, ...(row.decision.externalActionId ? { externalId: row.decision.externalActionId } : {}) };
    if (!this.api.replyComment || !await this.claimComment(row.decision.id, context.businessId)) return { status: "SKIPPED" as const, safeReason: "COMMENT_RECONCILIATION_REQUIRED" };
    try {
      const token = await this.vault.resolve(context, row.connection.credentialRefId!, "meta_page_token");
      const sent = await this.api.replyComment(row.comment.externalCommentId, token, action.text);
      await this.db.update(commentDecisions).set({ actionStatus: "COMPLETED", externalActionId: sent.id, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(commentDecisions.id, row.decision.id), eq(commentDecisions.businessId, context.businessId)));
      await this.db.insert(messages).values({ id: ulid(), businessId: context.businessId, conversationId: row.comment.conversationId!, customerId: row.comment.customerId, connectionId: row.connection.id, externalMessageId: sent.id, externalParentId: row.comment.externalCommentId, senderKind: "AGENT", text: action.text, occurredAt: new Date(), traceId: context.traceId, lifecycle: { actionId: action.id, source: "facebook_comment" } }).onConflictDoNothing();
      return { status: "EXECUTED" as const, externalId: sent.id };
    } catch (error) { return this.commentFailure(row.decision.id, context.businessId, error); }
  }
  async hideComment(context: TrustedBusinessContext, commentId: string, decisionKey: string) {
    const row = await this.commentTarget(context, commentId, decisionKey, "HIDE");
    if (row.decision.actionStatus === "COMPLETED") return { status: "EXECUTED" as const, externalId: row.comment.externalCommentId };
    if (!this.api.hideComment || !await this.claimComment(row.decision.id, context.businessId)) return { status: "SKIPPED" as const, safeReason: "COMMENT_RECONCILIATION_REQUIRED" };
    try {
      const token = await this.vault.resolve(context, row.connection.credentialRefId!, "meta_page_token");
      if (!await this.api.hideComment(row.comment.externalCommentId, token)) throw new MetaApiError("META_REJECTED");
      await this.db.transaction(async (tx) => { await tx.update(commentDecisions).set({ actionStatus: "COMPLETED", externalActionId: row.comment.externalCommentId, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(commentDecisions.id, row.decision.id), eq(commentDecisions.businessId, context.businessId))); await tx.update(facebookComments).set({ isHidden: true, updatedAt: new Date() }).where(and(eq(facebookComments.id, commentId), eq(facebookComments.businessId, context.businessId))); });
      return { status: "EXECUTED" as const, externalId: row.comment.externalCommentId };
    } catch (error) { return this.commentFailure(row.decision.id, context.businessId, error); }
  }
  async execute(context: TrustedBusinessContext, action: UniversalChannelAction) {
    if (action.type === "ReplyToComment") return this.executeCommentReply(context, action);
    const row = await this.target(context); const connection = row.connection;
    if (!connection.credentialRefId) return { status: "SKIPPED" as const, safeReason: "CREDENTIAL_UNAVAILABLE" };
    if (!row.thread.lastCustomerMessageAt || Date.now() - row.thread.lastCustomerMessageAt.getTime() > 24 * 3600_000) return { status: "SKIPPED" as const, safeReason: "META_STANDARD_WINDOW_CLOSED" };
    if (["ReplyToMessage", "ReactToMessage", "SendFile"].includes(action.type)) return { status: "SKIPPED" as const, safeReason: "CAPABILITY_UNAVAILABLE" };
    let message: Record<string, unknown>;
    if (action.type === "SendMessage") { if (action.text.length > 2000) return { status: "SKIPPED" as const, safeReason: "META_TEXT_LIMIT" }; message = { text: action.text }; }
    else if (action.type === "SendProduct") message = { text: `${action.fallbackText}${action.url ? `\n${action.url}` : ""}`.slice(0, 2000) };
    else if (action.type === "SendImage") {
      if (!this.assets) return { status: "SKIPPED" as const, safeReason: "ASSET_RESOLVER_UNAVAILABLE" };
      const url = await this.assets.signedUrl(context, action.assetId);
      if (new URL(url).protocol !== "https:") return { status: "SKIPPED" as const, safeReason: "ASSET_URL_INVALID" };
      message = { attachment: { type: "image", payload: { url } } };
    } else return { status: "SKIPPED" as const, safeReason: "CAPABILITY_UNAVAILABLE" };
    let inserted = await this.db.insert(messengerSends).values({ id: ulid(), businessId: context.businessId, connectionId: connection.id, conversationId: context.conversationId!, idempotencyKey: action.idempotencyKey, actionId: action.id, state: "SENDING" }).onConflictDoNothing().returning({ id: messengerSends.id });
    if (!inserted.length) {
      const prior = (await this.db.select().from(messengerSends).where(and(eq(messengerSends.businessId, context.businessId), eq(messengerSends.connectionId, connection.id), eq(messengerSends.idempotencyKey, action.idempotencyKey))).limit(1))[0];
      if (prior?.actionId !== action.id || prior?.conversationId !== context.conversationId) throw new Error("IDEMPOTENCY_CONFLICT");
      if (prior.state === "COMPLETED") return { status: "EXECUTED" as const, ...(prior.externalMessageId ? { externalId: prior.externalMessageId } : {}) };
      if (prior.state === "FAILED" && prior.safeCode === "META_RATE_LIMIT") inserted = await this.db.update(messengerSends).set({ state: "SENDING", safeCode: null, updatedAt: new Date() }).where(and(eq(messengerSends.id, prior.id), eq(messengerSends.businessId, context.businessId), eq(messengerSends.state, "FAILED"))).returning({ id: messengerSends.id });
      if (!inserted.length) return { status: "SKIPPED" as const, safeReason: "RECONCILIATION_REQUIRED" };
    }
    try {
      const sent = await this.api.send(connection.externalPageId, await this.vault.resolve(context, connection.credentialRefId, "meta_page_token"), { recipient: { id: row.thread.senderId }, messaging_type: "RESPONSE", message });
      if (!sent.messageId) throw new Error("META_SEND_RESULT_UNKNOWN");
      await this.db.transaction(async (tx) => {
        await tx.update(messengerSends).set({ state: "COMPLETED", externalMessageId: sent.messageId, updatedAt: new Date() }).where(eq(messengerSends.id, inserted[0]!.id));
        await tx.insert(messages).values({ id: ulid(), businessId: context.businessId, conversationId: context.conversationId!, customerId: row.thread.customerId, connectionId: connection.id, externalMessageId: sent.messageId, senderKind: "AGENT", text: "text" in message ? String(message.text) : null, occurredAt: new Date(), traceId: context.traceId, lifecycle: { actionId: action.id, status: "SENT" } }).onConflictDoNothing();
      });
      return { status: "EXECUTED" as const, externalId: sent.messageId };
    } catch (error) {
      const definite = error instanceof MetaApiError && ["META_AUTH", "META_PERMISSION", "META_RATE_LIMIT", "META_REJECTED"].includes(error.safeCode);
      await this.db.update(messengerSends).set({ state: definite ? "FAILED" : "UNKNOWN", safeCode: error instanceof MetaApiError ? error.safeCode : "EXTERNAL_OUTCOME_UNKNOWN", updatedAt: new Date() }).where(eq(messengerSends.id, inserted[0]!.id));
      if (error instanceof MetaApiError && error.safeCode === "META_AUTH") {
        await this.db.update(channelConnections).set({ state: "NEEDS_REAUTHORIZATION", paused: true, lastErrorCode: "META_AUTH", updatedAt: new Date() }).where(and(eq(channelConnections.id, connection.id), eq(channelConnections.businessId, context.businessId)));
        if (connection.state !== "NEEDS_REAUTHORIZATION") await notifyMessengerReauthorization(this.db, context.businessId, connection.id, error.safeCode);
      }
      if (error instanceof MetaApiError && error.safeCode === "META_RATE_LIMIT") throw Object.assign(new Error("CHANNEL_RATE_LIMIT"), { code: "CHANNEL_RATE_LIMIT", retryAfterMs: error.retryAfterMs ?? 1000 });
      if (definite) return { status: "SKIPPED" as const, safeReason: error.safeCode };
      throw new Error("EXTERNAL_OUTCOME_UNKNOWN");
    }
  }
  async reconcile(context: TrustedBusinessContext, action: UniversalChannelAction) {
    if (action.type === "ReplyToComment") { const row = await this.commentTarget(context, action.commentId, action.idempotencyKey, "REPLY"); return row.decision.actionStatus === "COMPLETED" ? { status: "EXECUTED" as const, ...(row.decision.externalActionId ? { externalId: row.decision.externalActionId } : {}) } : row.decision.actionStatus === "FAILED" ? { status: "NOT_FOUND" as const } : { status: "UNKNOWN" as const }; }
    const row = await this.target(context, false);
    const send = (await this.db.select().from(messengerSends).where(and(eq(messengerSends.businessId, context.businessId), eq(messengerSends.connectionId, row.connection.id), eq(messengerSends.idempotencyKey, action.idempotencyKey), eq(messengerSends.actionId, action.id))).limit(1))[0];
    if (send?.state === "COMPLETED") return { status: "EXECUTED" as const, ...(send.externalMessageId ? { externalId: send.externalMessageId } : {}) };
    return send?.state === "FAILED" ? { status: "NOT_FOUND" as const } : { status: "UNKNOWN" as const };
  }
}
