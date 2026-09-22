import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "@agentos/database";
import { AgentRuntime } from "@agentos/agent-runtime";
import { AgentVersionService } from "@agentos/agents";
import { DeferredChannelActionExecutor } from "@agentos/actions";
import { FacebookMessengerAdapter, InMemoryChannelRegistry, MessengerWebhook, MetaConnectionService, PostgresCredentialVault, RegistryPresenceController, type MetaApi } from "@agentos/channels";
import { LayeredContextEngine } from "@agentos/context";
import { FakeModelProvider } from "@agentos/models";
import { PostgresAgentVersionRepository, PostgresRealtimeBus, PostgresRuntimeActionRepository, PostgresRuntimeContextSource, PostgresRuntimeDomainActions, PostgresRuntimeTraceRepository } from "@agentos/phase6";
import { createTrustedBusinessContext } from "@agentos/shared";
import { ToolRegistry } from "@agentos/tools";
import { config } from "../tests/helpers";
import { startPhase5Worker } from "../apps/worker/src/index";

const databaseUrl = process.env.DATABASE_URL; const redisUrl = process.env.REDIS_URL;
if (!databaseUrl || !redisUrl) throw new Error("DATABASE_URL and REDIS_URL required");
const pool = new Pool({ connectionString: databaseUrl }); const db = drizzle(pool);
const businessId = ulid(); const otherBusinessId = ulid(); const agentId = ulid(); const versionId = ulid(); const userId = ulid();
const pageId = "123456789012345"; const appId = "987654321012345"; const appSecret = "phase6-meta-app-secret"; const verifyToken = "phase6-verify-token";
const pageToken = "phase6-page-token-write-only-123";
const bodies: Record<string, unknown>[] = [];
const api: MetaApi = {
  async exchangeCode() { return "phase6-user-token"; },
  async listPages() { return [{ id: "333333333333333", name: "OAuth Page", accessToken: "oauth-page-token-1234567890", tasks: ["MESSAGE"] }]; },
  async verifyPage(id) { return { id, name: "Fixture Page" }; },
  async subscribePage() { return true; },
  async isSubscribed() { return true; },
  async send(_page, _token, body) { bodies.push(body); return "message" in body ? { messageId: `sent-${bodies.length}` } : {}; },
};
let stop: (() => Promise<void>) | undefined;
try {
  await db.insert(schema.businesses).values([{ id: businessId, name: "Phase6 A", state: "ACTIVE" }, { id: otherBusinessId, name: "Phase6 B", state: "ACTIVE" }]);
  await db.insert(schema.users).values({ id: userId, name: "Phase6 Tester", email: `${userId}@example.test` });
  await db.insert(schema.agents).values({ id: agentId, businessId, name: "Messenger agent", activeVersionId: versionId });
  await db.insert(schema.agentVersions).values({ id: versionId, businessId, agentId, version: 1, state: "PUBLISHED", config, createdBy: userId });
  const vault = new PostgresCredentialVault(db, randomBytes(32), "integration");
  const service = new MetaConnectionService(db, api, vault, appId, "https://agentos.example/api/meta/oauth/callback", "https://agentos.example/api/webhooks/meta/messenger");
  const adapter = new FacebookMessengerAdapter(db, api, vault, appSecret);
  const webhook = new MessengerWebhook(db, adapter, service, appSecret, verifyToken);
  const agency = createTrustedBusinessContext({ businessId, principal: { kind: "user", userId, sessionId: "integration" }, source: "authenticated_request", traceId: ulid(), capabilityGrants: ["channel.manage"] });
  const otherAgency = createTrustedBusinessContext({ businessId: otherBusinessId, principal: { kind: "user", userId, sessionId: "integration" }, source: "authenticated_request", traceId: ulid(), capabilityGrants: ["channel.manage"] });
  const saved = await service.manual(agency, { pageId, pageToken, agentId });
  assert.equal(saved.state, "DRAFT"); assert.equal(saved.tokenPresent, true); assert.equal(JSON.stringify(saved).includes(pageToken), false);
  const secret = (await db.select().from(schema.credentialSecrets).limit(1))[0]!; assert.equal(JSON.stringify(secret).includes(pageToken), false);
  await assert.rejects(service.list(otherAgency).then((rows) => { assert.equal(rows.length, 0); throw new Error("TENANT_ISOLATED"); }), /TENANT_ISOLATED/);
  await assert.rejects(service.activate(agency, saved.id), /PAGE_VERIFICATION_INCOMPLETE/);
  await service.verifyCredentials(agency, saved.id);
  await service.subscribePage(agency, saved.id);
  await webhook.handshake(new URL(`https://agentos.example/api/webhooks/meta/messenger?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=hello`));
  await service.verifyWebhook(agency, saved.id);
  const post = async (mid: string, sender: string, signatureValid = true) => {
    const body = new TextEncoder().encode(JSON.stringify({ object: "page", entry: [{ id: pageId, messaging: [{ sender: { id: sender }, recipient: { id: pageId }, timestamp: Date.now(), message: { mid, text: "Hello from Messenger" } }] }] }));
    const signature = `sha256=${createHmac("sha256", signatureValid ? appSecret : "wrong").update(body).digest("hex")}`;
    return webhook.receive(new Headers({ "x-hub-signature-256": signature }), body);
  };
  assert.equal((await post("bad", "sender-1", false)).status, 401);
  assert.equal((await post("test-message", "sender-1")).status, 200);
  assert.equal((await post("test-message", "sender-1")).status, 200);
  const first = (await db.select().from(schema.channelConnections).where(eq(schema.channelConnections.id, saved.id)).limit(1))[0]!;
  assert.equal(first.testMessageId, "test-message");
  const firstThread = (await db.select().from(schema.messengerThreads).where(and(eq(schema.messengerThreads.connectionId, saved.id), eq(schema.messengerThreads.senderId, "sender-1"))).limit(1))[0]!;
  assert.equal((await db.select().from(schema.messages).where(and(eq(schema.messages.businessId, businessId), eq(schema.messages.conversationId, firstThread.conversationId)))).length, 1);
  assert.equal((await db.select().from(schema.conversations).where(eq(schema.conversations.id, firstThread.conversationId)).limit(1))[0]?.ownership, "PAUSED");
  await service.controlledReply(agency, saved.id, "Connection confirmed");
  await service.activate(agency, saved.id);
  assert.equal((await db.select().from(schema.conversations).where(eq(schema.conversations.id, firstThread.conversationId)).limit(1))[0]?.ownership, "PAUSED");
  const registry = new InMemoryChannelRegistry(); registry.register(adapter); const presence = new RegistryPresenceController(registry); const realtime = new PostgresRealtimeBus(db);
  const runtime = new AgentRuntime({ versions: new AgentVersionService(new PostgresAgentVersionRepository(db)), contextEngine: new LayeredContextEngine(new PostgresRuntimeContextSource(db)), models: new FakeModelProvider([{ kind: "actions", actions: [{ id: ulid(), schemaVersion: "1.0", type: "SendMessage", idempotencyKey: `phase6:${ulid()}`, text: "Agent reply" }], usage: { inputTokens: 8, outputTokens: 6, totalTokens: 14 } }]), tools: new ToolRegistry(), actions: new DeferredChannelActionExecutor(new PostgresRuntimeActionRepository(db), new PostgresRuntimeDomainActions(db)), traces: new PostgresRuntimeTraceRepository(db), realtime, presence });
  stop = await startPhase5Worker({ db, redisUrl, runtime, registry, presence, realtime, capabilities: async () => ["conversation.read", "handoff.request"] });
  assert.equal((await post("live-message", "sender-2")).status, 200);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && !bodies.some((body) => "message" in body && JSON.stringify(body).includes("Agent reply"))) await Bun.sleep(50);
  assert.ok(bodies.some((body) => "message" in body && JSON.stringify(body).includes("Agent reply")), "durable Messenger response not sent");
  assert.ok(bodies.some((body) => body.sender_action === "mark_seen"));
  assert.ok(bodies.some((body) => body.sender_action === "typing_on"));
  assert.ok(bodies.some((body) => body.sender_action === "typing_off"));
  const oauth = await service.beginOAuth(agency, agentId); const state = new URL(oauth.url).searchParams.get("state")!;
  const selection = await service.finishOAuth(agency, state, "fixture-code"); assert.equal(selection.pages.length, 1);
  assert.equal((await service.selectOAuthPage(agency, selection.stateId, selection.pages[0]!.id)).state, "DRAFT");
  await assert.rejects(service.selectOAuthPage(agency, selection.stateId, selection.pages[0]!.id), /OAUTH_STATE_INVALID/);
  console.log("Phase 6 Messenger PostgreSQL/Redis path passed: manual and OAuth setup, encrypted credentials, verification gates, signed webhook, dedupe, paused test, durable worker, Meta send, presence, and tenant scope.");
} finally { await stop?.(); await pool.end(); }
