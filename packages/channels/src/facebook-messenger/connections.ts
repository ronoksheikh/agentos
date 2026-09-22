import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ulid } from "ulid";
import { z } from "zod";
import { agents, auditLogs, channelConnections, messengerThreads, metaOauthStates, metaWebhookStatus } from "@agentos/database";
import { createTrustedBusinessContext, type TrustedBusinessContext } from "@agentos/shared";
import { FACEBOOK_MESSENGER } from "./adapter";
import { MetaApiError, META_GRAPH_VERSION, type MetaApi } from "./meta-api";
import { PostgresCredentialVault } from "./secrets";

const pageIdSchema = z.string().regex(/^\d{5,30}$/);
const tokenSchema = z.string().min(20).max(10000);
const setupMethod = z.enum(["MANUAL", "OAUTH"]);
const actor = (context: TrustedBusinessContext) => context.principal.kind === "user" ? context.principal.userId : "system";
const manager = (context: TrustedBusinessContext) => { if (!context.capabilityGrants.includes("channel.manage") || context.principal.kind !== "user") throw new Error("FORBIDDEN"); };
const systemContext = (context: TrustedBusinessContext) => createTrustedBusinessContext({ businessId: context.businessId, principal: { kind: "system", service: "meta-connection" }, source: "internal_system", traceId: context.traceId, capabilityGrants: [] });
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export class MetaConnectionService {
  constructor(private readonly db: NodePgDatabase, private readonly api: MetaApi, private readonly vault: PostgresCredentialVault, private readonly appId: string, private readonly redirectUri: string, private readonly callbackUrl: string) {}
  private async audit(context: TrustedBusinessContext, action: string, targetId: string, safeMetadata: Record<string, unknown> = {}) { await this.db.insert(auditLogs).values({ id: ulid(), businessId: context.businessId, actorId: actor(context), action, targetType: "channel_connection", targetId, safeMetadata }); }
  private async require(context: TrustedBusinessContext, id: string) { const row = (await this.db.select().from(channelConnections).where(and(eq(channelConnections.id, id), eq(channelConnections.businessId, context.businessId), eq(channelConnections.channel, FACEBOOK_MESSENGER))).limit(1))[0]; if (!row) throw new Error("PAGE_CONNECTION_NOT_FOUND"); return row; }
  private async assertAgent(context: TrustedBusinessContext, agentId: string) { const row = (await this.db.select({ id: agents.id, activeVersionId: agents.activeVersionId }).from(agents).where(and(eq(agents.id, agentId), eq(agents.businessId, context.businessId))).limit(1))[0]; if (!row?.activeVersionId) throw new Error("PUBLISHED_AGENT_REQUIRED"); }
  async setupInstructions(context: TrustedBusinessContext) { manager(context); const handshake = (await this.db.select({ appId: metaWebhookStatus.appId }).from(metaWebhookStatus).where(eq(metaWebhookStatus.appId, this.appId)).limit(1))[0]; return { callbackUrl: this.callbackUrl, graphVersion: META_GRAPH_VERSION, verifyTokenPresent: Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN), ...(!handshake && process.env.META_WEBHOOK_VERIFY_TOKEN ? { initialVerificationToken: process.env.META_WEBHOOK_VERIFY_TOKEN } : {}) }; }
  async list(context: TrustedBusinessContext) { const rows = await this.db.select().from(channelConnections).where(and(eq(channelConnections.businessId, context.businessId), eq(channelConnections.channel, FACEBOOK_MESSENGER))); return rows.map((row) => this.safe(row)); }
  private safe(row: typeof channelConnections.$inferSelect) { return { id: row.id, businessId: row.businessId, pageId: row.externalPageId, displayName: row.displayName, agentId: row.agentId, state: row.state, paused: row.paused, setupMethod: row.setupMethod, tokenPresent: Boolean(row.credentialRefId), grantedScopes: row.grantedScopes, lastErrorCode: row.lastErrorCode, webhookVerifiedAt: row.webhookVerifiedAt?.toISOString() ?? null, testMessageReceived: Boolean(row.testMessageId && row.testConversationId), replyVerifiedAt: row.replyVerifiedAt?.toISOString() ?? null, lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null, lastWebhookAt: row.lastWebhookAt?.toISOString() ?? null }; }
  async manual(context: TrustedBusinessContext, input: { pageId: string; pageToken: string; agentId: string }) { manager(context); await this.assertAgent(context, input.agentId); const pageId = pageIdSchema.parse(input.pageId); tokenSchema.parse(input.pageToken); return this.create(context, { pageId, pageToken: input.pageToken, agentId: input.agentId, method: "MANUAL" }); }
  private async create(context: TrustedBusinessContext, input: { pageId: string; pageToken: string; agentId: string; method: z.infer<typeof setupMethod> }) {
    const current = (await this.db.select({ id: channelConnections.id, businessId: channelConnections.businessId, credentialRefId: channelConnections.credentialRefId }).from(channelConnections).where(and(eq(channelConnections.channel, FACEBOOK_MESSENGER), eq(channelConnections.externalPageId, input.pageId))).limit(1))[0];
    if (current && current.businessId !== context.businessId) throw new Error("PAGE_ALREADY_ASSIGNED");
    const credential = await this.vault.write(context, "meta_page_token", input.pageToken, current?.credentialRefId ?? undefined);
    const id = current?.id ?? ulid();
    if (current) await this.db.update(channelConnections).set({ agentId: input.agentId, credentialRefId: credential.id, state: "DRAFT", paused: true, setupMethod: input.method, webhookVerifiedAt: null, testMessageId: null, testConversationId: null, replyVerifiedAt: null, lastErrorCode: null, updatedAt: new Date() }).where(and(eq(channelConnections.id, id), eq(channelConnections.businessId, context.businessId)));
    else await this.db.insert(channelConnections).values({ id, businessId: context.businessId, channel: FACEBOOK_MESSENGER, externalPageId: input.pageId, agentId: input.agentId, credentialRefId: credential.id, state: "DRAFT", paused: true, setupMethod: input.method });
    await this.audit(context, "messenger.page.saved", id, { method: input.method });
    return this.safe(await this.require(context, id));
  }
  async beginOAuth(context: TrustedBusinessContext, agentId: string) {
    manager(context); await this.assertAgent(context, agentId);
    const state = randomBytes(32).toString("base64url"); const id = ulid();
    await this.db.insert(metaOauthStates).values({ id, stateHash: digest(state), businessId: context.businessId, agentId, actorId: actor(context), expiresAt: new Date(Date.now() + 10 * 60_000) });
    const url = new URL(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);
    url.search = new URLSearchParams({ client_id: this.appId, redirect_uri: this.redirectUri, state, response_type: "code", scope: "pages_show_list,pages_messaging,pages_manage_metadata" }).toString();
    await this.audit(context, "messenger.oauth.started", id);
    return { url: url.toString(), stateId: id };
  }
  async finishOAuth(context: TrustedBusinessContext, state: string, code: string) {
    manager(context);
    const row = (await this.db.select().from(metaOauthStates).where(and(eq(metaOauthStates.stateHash, digest(state)), eq(metaOauthStates.businessId, context.businessId), eq(metaOauthStates.actorId, actor(context)), isNull(metaOauthStates.usedAt), gt(metaOauthStates.expiresAt, new Date()))).limit(1))[0];
    if (!row || row.credentialRefId) throw new Error("OAUTH_STATE_INVALID");
    const userToken = await this.api.exchangeCode(code, this.redirectUri);
    const pages = await this.api.listPages(userToken);
    const reference = await this.vault.write(context, "meta_oauth_user_token", userToken);
    await this.db.update(metaOauthStates).set({ credentialRefId: reference.id }).where(eq(metaOauthStates.id, row.id));
    await this.audit(context, "messenger.oauth.pages", row.id, { count: pages.length });
    return { stateId: row.id, pages: pages.filter((page) => page.tasks.includes("MESSAGE")).map(({ id, name }) => ({ id, name })) };
  }
  async oauthPages(context: TrustedBusinessContext, stateId: string) {
    manager(context);
    const row = (await this.db.select().from(metaOauthStates).where(and(eq(metaOauthStates.id, stateId), eq(metaOauthStates.businessId, context.businessId), eq(metaOauthStates.actorId, actor(context)), isNull(metaOauthStates.usedAt), gt(metaOauthStates.expiresAt, new Date()))).limit(1))[0];
    if (!row?.credentialRefId) throw new Error("OAUTH_STATE_INVALID");
    const pages = await this.api.listPages(await this.vault.resolve(systemContext(context), row.credentialRefId, "meta_oauth_user_token"));
    return pages.filter((page) => page.tasks.includes("MESSAGE")).map(({ id, name }) => ({ id, name }));
  }
  async selectOAuthPage(context: TrustedBusinessContext, stateId: string, pageId: string) {
    manager(context); pageIdSchema.parse(pageId);
    const row = (await this.db.select().from(metaOauthStates).where(and(eq(metaOauthStates.id, stateId), eq(metaOauthStates.businessId, context.businessId), eq(metaOauthStates.actorId, actor(context)), isNull(metaOauthStates.usedAt), gt(metaOauthStates.expiresAt, new Date()))).limit(1))[0];
    if (!row?.credentialRefId) throw new Error("OAUTH_STATE_INVALID");
    const pages = await this.api.listPages(await this.vault.resolve(systemContext(context), row.credentialRefId, "meta_oauth_user_token"));
    const page = pages.find((candidate) => candidate.id === pageId && candidate.tasks.includes("MESSAGE"));
    if (!page) throw new Error("PAGE_NOT_AUTHORIZED");
    const claimed = await this.db.update(metaOauthStates).set({ usedAt: new Date() }).where(and(eq(metaOauthStates.id, row.id), isNull(metaOauthStates.usedAt))).returning({ id: metaOauthStates.id });
    if (!claimed.length) throw new Error("OAUTH_STATE_USED");
    try {
      if (!await this.api.subscribePage(pageId, page.accessToken)) throw new Error("PAGE_SUBSCRIPTION_FAILED");
      return await this.create(context, { pageId, pageToken: page.accessToken, agentId: row.agentId, method: "OAUTH" });
    }
    finally { await this.vault.revoke(context, row.credentialRefId, "meta_oauth_user_token"); }
  }
  async verifyCredentials(context: TrustedBusinessContext, id: string) {
    manager(context); const row = await this.require(context, id);
    if (!row.credentialRefId) throw new Error("CREDENTIAL_UNAVAILABLE");
    try {
      const page = await this.api.verifyPage(row.externalPageId, await this.vault.resolve(systemContext(context), row.credentialRefId, "meta_page_token"));
      if (page.id !== row.externalPageId) throw new Error("PAGE_IDENTITY_MISMATCH");
      await this.db.update(channelConnections).set({ displayName: page.name, state: "CREDENTIALS_VERIFIED", lastVerifiedAt: new Date(), lastErrorCode: null, updatedAt: new Date() }).where(eq(channelConnections.id, id));
      await this.audit(context, "messenger.credentials.verified", id);
    } catch (error) {
      const safeCode = error instanceof MetaApiError ? error.safeCode : "PAGE_IDENTITY_MISMATCH";
      await this.db.update(channelConnections).set({ state: safeCode === "META_AUTH" ? "NEEDS_REAUTHORIZATION" : "FAILED", paused: true, lastErrorCode: safeCode, updatedAt: new Date() }).where(eq(channelConnections.id, id));
      throw new Error(safeCode);
    }
    return this.safe(await this.require(context, id));
  }
  async verifyWebhook(context: TrustedBusinessContext, id: string) {
    manager(context); const row = await this.require(context, id);
    if (row.state !== "CREDENTIALS_VERIFIED" || !row.credentialRefId) throw new Error("CREDENTIALS_NOT_VERIFIED");
    const handshake = (await this.db.select().from(metaWebhookStatus).where(eq(metaWebhookStatus.appId, this.appId)).limit(1))[0];
    if (!handshake) throw new Error("WEBHOOK_HANDSHAKE_MISSING");
    const subscribed = await this.api.isSubscribed(row.externalPageId, await this.vault.resolve(systemContext(context), row.credentialRefId, "meta_page_token"));
    if (!subscribed) throw new Error("PAGE_SUBSCRIPTION_MISSING");
    await this.db.update(channelConnections).set({ state: "TEST_PENDING", webhookVerifiedAt: handshake.verifiedAt, lastErrorCode: null, updatedAt: new Date() }).where(eq(channelConnections.id, id));
    await this.audit(context, "messenger.webhook.verified", id);
    return this.safe(await this.require(context, id));
  }
  async subscribePage(context: TrustedBusinessContext, id: string) {
    manager(context); const row = await this.require(context, id);
    if (!row.credentialRefId || !["CREDENTIALS_VERIFIED", "TEST_PENDING"].includes(row.state)) throw new Error("CREDENTIALS_NOT_VERIFIED");
    if (!await this.api.subscribePage(row.externalPageId, await this.vault.resolve(systemContext(context), row.credentialRefId, "meta_page_token"))) throw new Error("PAGE_SUBSCRIPTION_FAILED");
    await this.audit(context, "messenger.page.subscribed", id);
    return this.safe(await this.require(context, id));
  }
  async recordTestMessage(businessId: string, connectionId: string, externalMessageId: string, conversationId: string) {
    await this.db.update(channelConnections).set({ testMessageId: externalMessageId, testConversationId: conversationId, lastWebhookAt: new Date(), updatedAt: new Date() }).where(and(eq(channelConnections.id, connectionId), eq(channelConnections.businessId, businessId), eq(channelConnections.state, "TEST_PENDING"), isNull(channelConnections.testMessageId)));
  }
  async controlledReply(context: TrustedBusinessContext, id: string, text: string) {
    manager(context); const row = await this.require(context, id);
    if (row.state !== "TEST_PENDING" || !row.testMessageId || !row.testConversationId || !row.credentialRefId) throw new Error("TEST_MESSAGE_MISSING");
    const thread = (await this.db.select().from(messengerThreads).where(and(eq(messengerThreads.businessId, context.businessId), eq(messengerThreads.connectionId, id), eq(messengerThreads.conversationId, row.testConversationId))).limit(1))[0];
    if (!thread?.lastCustomerMessageAt || Date.now() - thread.lastCustomerMessageAt.getTime() > 24 * 3600_000) throw new Error("META_STANDARD_WINDOW_CLOSED");
    const content = z.string().min(1).max(1000).parse(text);
    const sent = await this.api.send(row.externalPageId, await this.vault.resolve(systemContext(context), row.credentialRefId, "meta_page_token"), { recipient: { id: thread.senderId }, messaging_type: "RESPONSE", message: { text: content } });
    if (!sent.messageId) throw new Error("TEST_REPLY_UNVERIFIED");
    await this.db.update(channelConnections).set({ replyVerifiedAt: new Date(), lastErrorCode: null, updatedAt: new Date() }).where(eq(channelConnections.id, id));
    await this.audit(context, "messenger.test.reply", id, { verified: true });
    return this.safe(await this.require(context, id));
  }
  async activate(context: TrustedBusinessContext, id: string) {
    manager(context); const row = await this.require(context, id);
    if (row.state !== "TEST_PENDING" || !row.lastVerifiedAt || !row.webhookVerifiedAt || !row.testMessageId || !row.testConversationId || !row.replyVerifiedAt) throw new Error("PAGE_VERIFICATION_INCOMPLETE");
    if (Date.now() - row.replyVerifiedAt.getTime() > 24 * 3600_000 || !row.credentialRefId) throw new Error("TEST_REPLY_EXPIRED");
    const token = await this.vault.resolve(systemContext(context), row.credentialRefId, "meta_page_token");
    const page = await this.api.verifyPage(row.externalPageId, token);
    if (page.id !== row.externalPageId || !await this.api.isSubscribed(row.externalPageId, token)) throw new Error("PAGE_VERIFICATION_INCOMPLETE");
    await this.db.update(channelConnections).set({ state: "CONNECTED", paused: false, lastErrorCode: null, updatedAt: new Date() }).where(eq(channelConnections.id, id));
    await this.audit(context, "messenger.page.activated", id);
    return this.safe(await this.require(context, id));
  }
  async setPaused(context: TrustedBusinessContext, id: string, paused: boolean) { manager(context); const row = await this.require(context, id); if (row.state !== "CONNECTED") throw new Error("PAGE_NOT_CONNECTED"); await this.db.update(channelConnections).set({ paused, updatedAt: new Date() }).where(eq(channelConnections.id, id)); await this.audit(context, paused ? "messenger.page.paused" : "messenger.page.resumed", id); return this.safe(await this.require(context, id)); }
  async recordHandshake() { await this.db.insert(metaWebhookStatus).values({ appId: this.appId, verifiedAt: new Date() }).onConflictDoUpdate({ target: metaWebhookStatus.appId, set: { verifiedAt: new Date(), updatedAt: new Date() } }); }
}
