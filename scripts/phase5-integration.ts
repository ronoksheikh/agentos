import assert from "node:assert/strict";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "@agentos/database";
import { AgentRuntime } from "@agentos/agent-runtime";
import { AgentVersionService } from "@agentos/agents";
import { DeferredChannelActionExecutor } from "@agentos/actions";
import { InMemoryChannelRegistry, RegistryPresenceController } from "@agentos/channels";
import { LayeredContextEngine } from "@agentos/context";
import { InMemoryConversationStore } from "@agentos/conversations";
import { MemoryService } from "@agentos/memory";
import { FakeModelProvider } from "@agentos/models";
import { InMemoryActionRepository, InMemoryAgentVersionRepository, InMemoryMemoryRepository, InMemoryTraceRepository } from "@agentos/persistence";
import { InboundGateway, Phase5Operations, Phase5Queues, Phase5Store, RedisConversationLease } from "@agentos/phase5";
import { InMemoryRealtimeBus } from "@agentos/realtime";
import { createTrustedBusinessContext } from "@agentos/shared";
import { ToolRegistry } from "@agentos/tools";
import { FakeWebChatAdapter, WebsiteContractService, WEB_CHAT_CHANNEL } from "@agentos/website-sdk";
import { createAgentFixture, ids } from "../tests/helpers";
import { startPhase5Worker } from "../apps/worker/src/index";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
if (!databaseUrl || !redisUrl) throw new Error("DATABASE_URL and REDIS_URL are required");
const pool = new Pool({ connectionString: databaseUrl }); const db = drizzle(pool); const store = new Phase5Store(db);
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(label: string, test: () => Promise<boolean>, timeoutMs = 12_000) { const end = Date.now() + timeoutMs; while (Date.now() < end) { if (await test()) return; await pause(50); } throw new Error(`Timed out: ${label}`); }

try {
  const secondBusiness = ulid(); const connectionId = ulid(); const userId = ulid(); const fixture = createAgentFixture();
  await db.insert(schema.businesses).values([{ id: ids.businessA, name: "Phase5 A", state: "ACTIVE" }, { id: secondBusiness, name: "Phase5 B", state: "ACTIVE" }]);
  await db.insert(schema.users).values({ id: userId, name: "Phase5 Tester", email: `${userId}@example.test` });
  await db.insert(schema.agents).values({ id: ids.agent, businessId: ids.businessA, name: "Phase5 Agent", activeVersionId: ids.version });
  await db.insert(schema.agentVersions).values({ id: ids.version, businessId: ids.businessA, agentId: ids.agent, version: 1, state: "PUBLISHED", config: fixture.version.config, createdBy: userId });
  await db.insert(schema.customers).values({ id: ids.customer, businessId: ids.businessA });
  await db.insert(schema.conversations).values({ id: ids.conversation, businessId: ids.businessA, customerId: ids.customer, agentId: ids.agent, channel: WEB_CHAT_CHANNEL });

  const contracts = new WebsiteContractService("phase-five-integration-secret-32-chars");
  const site = contracts.register({ businessId: ids.businessA, agentId: ids.agent, publicKey: "pk_phase5", allowedOrigins: ["https://shop.example"], enabled: true, requestsPerMinute: 100 });
  const bootstrap = contracts.bootstrap({ publicKey: "pk_phase5", origin: "https://shop.example", sdkVersion: "1.0.0" });
  const adapter = new FakeWebChatAdapter(contracts); const registry = new InMemoryChannelRegistry(); registry.register(adapter);
  const presence = new RegistryPresenceController(registry);
  const versions = new InMemoryAgentVersionRepository(); versions.seed(fixture.agent, [fixture.version]);
  const conversations = new InMemoryConversationStore(new MemoryService(new InMemoryMemoryRepository()));
  conversations.seed({ businessId: ids.businessA, conversationId: ids.conversation, customerId: ids.customer, messages: [], pins: [], pendingGoals: [], announcements: [] });
  const action = { id: ulid(), schemaVersion: "1.0" as const, type: "SendMessage" as const, idempotencyKey: `phase5:${ulid()}`, text: "Black XL is available." };
  const runtime = new AgentRuntime({ versions: new AgentVersionService(versions), contextEngine: new LayeredContextEngine(conversations), models: new FakeModelProvider([{ kind: "actions", actions: [action], usage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 } }]), tools: new ToolRegistry(), actions: new DeferredChannelActionExecutor(new InMemoryActionRepository(), conversations), traces: new InMemoryTraceRepository(), realtime: new InMemoryRealtimeBus(), presence });
  const gateway = new InboundGateway(store);
  const trusted = createTrustedBusinessContext({ businessId: ids.businessA, principal: { kind: "adapter", connectionId: site.id }, source: "verified_adapter", agentId: ids.agent, conversationId: ids.conversation, customerId: ids.customer, traceId: ulid(), capabilityGrants: ["conversation.read", "handoff.request"] });
  async function request(text: string, key: string) { const headers = new Headers({ origin: "https://shop.example", authorization: `Bearer ${bootstrap.sessionToken}` }); const body = new TextEncoder().encode(JSON.stringify({ message: text, idempotencyKey: key, externalMessageId: key, occurredAt: "2026-09-20T10:00:00.000Z" })); return { headers, body }; }
  const keys = [ulid(), ulid(), ulid()];
  const started = Date.now();
  for (const [i, text] of ["bhai", "black ta", "XL ache?"].entries()) { const result = await gateway.accept(adapter, await request(text, keys[i]!), trusted, { quietMs: 150, maxWaitMs: 500 }); assert.equal(result.duplicate, false); }
  assert.ok(Date.now() - started < 1_000, "acknowledgement did not wait for a model or worker");
  const duplicate = await gateway.accept(adapter, await request("bhai", keys[0]!), trusted, { quietMs: 150, maxWaitMs: 500 }); assert.equal(duplicate.duplicate, true);
  const messages = await db.select().from(schema.messages).where(eq(schema.messages.businessId, ids.businessA)).orderBy(schema.messages.inboundSequence);
  assert.deepEqual(messages.map((message) => message.inboundSequence), [1, 2, 3]); assert.deepEqual(messages.map((message) => message.externalMessageId), keys); assert.equal(messages[0]!.occurredAt.toISOString(), "2026-09-20T10:00:00.000Z");
  const batches = await db.select().from(schema.messageBatches).where(eq(schema.messageBatches.businessId, ids.businessA)); assert.equal(batches.length, 1); assert.deepEqual(batches[0]!.messageIds, messages.map((message) => message.id));

  await pause(170);
  const stop = await startPhase5Worker({ db, redisUrl, runtime, registry, presence });
  await until("one fake outbound action", async () => adapter.executed.length === 1);
  const effects = await db.select().from(schema.effectIntents).where(eq(schema.effectIntents.businessId, ids.businessA)); assert.equal(effects.length, 1); assert.equal(effects[0]!.state, "COMPLETED");
  assert.equal(adapter.executed.length, 1); assert.equal(adapter.executed[0]!.action.type, "SendMessage");

  // A confirmed order exists before notification; a definite failed notification reuses it.
  const pendingId = ulid(); const orderId = ulid();
  await db.insert(schema.pendingOrders).values({ id: pendingId, businessId: ids.businessA, conversationId: ids.conversation, customerId: ids.customer, channel: WEB_CHAT_CHANNEL, state: "CREATED", items: [], fields: {}, missingFields: [], confirmation: "GIVEN", expiresAt: new Date(Date.now() + 60_000), history: [] });
  await db.insert(schema.orders).values({ id: orderId, businessId: ids.businessA, number: `ORD-${orderId}`, conversationId: ids.conversation, customerId: ids.customer, pendingOrderId: pendingId, sourceChannel: WEB_CHAT_CHANNEL, origin: "AGENT", fields: {}, paymentMethod: "COD", deliveryMethod: "DELIVERY", confirmation: "GIVEN", status: "CONFIRMED", totalMinor: 100, currency: "USD" });
  adapter.failNextExecute = true;
  const notification = await store.enqueueOrderNotification({ businessId: ids.businessA, conversationId: ids.conversation, traceId: ulid(), orderId, action: { id: ulid(), schemaVersion: "1.0", type: "SendMessage", idempotencyKey: `order:${orderId}:notification`, text: "Your order is confirmed." } });
  assert.ok(notification.id); await until("notification failure", async () => (await store.getEffect(ids.businessA, notification.id!)).state === "FAILED");
  assert.equal((await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)))[0]!.notificationState, "FAILED");
  await store.retryFailedOrderNotification(ids.businessA, orderId);
  await until("notification retry", async () => (await store.getEffect(ids.businessA, notification.id!)).state === "COMPLETED");
  assert.equal((await db.select().from(schema.orders).where(eq(schema.orders.id, orderId)))[0]!.notificationState, "SENT");
  assert.equal((await db.select().from(schema.orders).where(eq(schema.orders.id, orderId))).length, 1);
  await stop();

  const redisQueues = new Phase5Queues(store, redisUrl);
  const leaseA = new RedisConversationLease(redisQueues.redis, `agentos:conversation:${ids.businessA}:${ids.conversation}`);
  const leaseB = new RedisConversationLease(redisQueues.redis, `agentos:conversation:${ids.businessA}:${ids.conversation}`);
  const leaseOther = new RedisConversationLease(redisQueues.redis, `agentos:conversation:${secondBusiness}:${ulid()}`);
  assert.equal(await leaseA.acquire(), true); assert.equal(await leaseB.acquire(), false); assert.equal(await leaseOther.acquire(), true); await leaseA.release(); assert.equal(await leaseB.acquire(), true); await leaseB.release(); await leaseOther.release();

  const fairnessConversations = Array.from({ length: 40 }, () => ulid()); const otherConversation = ulid();
  await db.insert(schema.conversations).values([...fairnessConversations.map((id) => ({ id, businessId: ids.businessA, channel: WEB_CHAT_CHANNEL })), { id: otherConversation, businessId: secondBusiness, channel: WEB_CHAT_CHANNEL }]);
  await db.insert(schema.workItems).values([...fairnessConversations.map((conversationId, index) => ({ id: ulid(), businessId: ids.businessA, kind: "BROWSER", resourceId: ulid(), conversationId, connectionId, traceId: ulid(), priority: index === 39 ? 1 : 5, state: "PENDING", runAt: new Date() })), { id: ulid(), businessId: secondBusiness, kind: "BROWSER", resourceId: ulid(), conversationId: otherConversation, connectionId: ulid(), traceId: ulid(), priority: 5, state: "PENDING", runAt: new Date() }]);
  let activeA = 0; let maxA = 0; let activeGlobal = 0; let maxGlobal = 0; let completedA = 0; let otherStartedAfter = -1;
  const stopFair = redisQueues.start(async (work, _signal, lease) => { await lease?.assertOwner(); activeGlobal++; maxGlobal = Math.max(maxGlobal, activeGlobal); if (work.businessId === ids.businessA) { activeA++; maxA = Math.max(maxA, activeA); } else otherStartedAfter = completedA; await pause(35); if (work.businessId === ids.businessA) { activeA--; completedA++; } activeGlobal--; }, { concurrency: 6, businessConcurrency: 3, connectionConcurrency: 3 });
  await redisQueues.pump();
  await until("forty fair jobs", async () => completedA === 40 && otherStartedAfter >= 0, 30_000);
  assert.ok(maxA <= 3); assert.ok(maxGlobal <= 6); assert.ok(otherStartedAfter < 40, "other business starved");
  await stopFair();

  const staleId = ulid(); await db.insert(schema.workItems).values({ id: staleId, businessId: ids.businessA, kind: "BROWSER", resourceId: ulid(), traceId: ulid(), state: "RUNNING", runAt: new Date(), updatedAt: new Date(Date.now() - 120_000) });
  assert.equal(await redisQueues.recover(60_000) >= 1, true); assert.equal((await store.getWork(ids.businessA, staleId)).state, "PENDING");
  const deadId = ulid(); await db.insert(schema.workItems).values({ id: deadId, businessId: ids.businessA, kind: "BROWSER", resourceId: ulid(), traceId: ulid(), state: "DEAD", runAt: new Date() });
  const operations = new Phase5Operations(store);
  await assert.rejects(() => operations.replay({ userId, role: "SUPPORT" }, { businessId: ids.businessA, workId: deadId, dryRun: false }), /FORBIDDEN/);
  assert.equal((await operations.replay({ userId, role: "ADMIN" }, { businessId: ids.businessA, workId: deadId })).replayed, false);
  assert.equal((await store.getWork(ids.businessA, deadId)).state, "DEAD");
  assert.equal((await operations.replay({ userId, role: "ADMIN" }, { businessId: ids.businessA, workId: deadId, dryRun: false })).replayed, true);

  const goalId = ulid(); await db.insert(schema.pendingGoals).values({ id: goalId, businessId: ids.businessA, customerId: ids.customer, conversationId: ids.conversation, type: "follow_up", description: "Follow up", state: "PENDING", triggerType: "TIME", trigger: { at: new Date(Date.now() - 1_000).toISOString() }, createdBy: userId, idempotencyKey: `goal:${goalId}`, traceId: ulid() });
  assert.equal(await store.scheduleDueGoals(), 1); assert.equal(await store.scheduleDueGoals(), 0);
  assert.equal((await db.select().from(schema.goalExecutions).where(and(eq(schema.goalExecutions.businessId, ids.businessA), eq(schema.goalExecutions.goalId, goalId)))).length, 1);
  await redisQueues.close();
  console.log("Phase 5 PostgreSQL/Redis integration passed: dedupe, ordered batching, fake adapter delivery, notification retry, leases, 40-conversation fairness, recovery, replay authorization, and one-shot goals.");
} finally { await pool.end(); }
