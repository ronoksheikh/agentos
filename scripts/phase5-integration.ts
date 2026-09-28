import assert from "node:assert/strict";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "@agentos/database";
import { AgentRuntime } from "@agentos/agent-runtime";
import { AgentVersionService } from "@agentos/agents";
import { FakeCommerceAdapter, OrderService } from "@agentos/commerce";
import { PostgresOrderRepository } from "@agentos/phase4-operations";
import { DeferredChannelActionExecutor } from "@agentos/actions";
import { InMemoryChannelRegistry, RegistryPresenceController } from "@agentos/channels";
import { LayeredContextEngine } from "@agentos/context";
import { InMemoryConversationStore } from "@agentos/conversations";
import { MemoryService } from "@agentos/memory";
import { FakeModelProvider } from "@agentos/models";
import { InMemoryActionRepository, InMemoryAgentVersionRepository, InMemoryMemoryRepository, InMemoryTraceRepository } from "@agentos/persistence";
import { EventRouter, InboundGateway, Phase5Operations, Phase5Processor, Phase5Queues, Phase5Store, RedisConversationLease } from "@agentos/phase5";
import { InMemoryRealtimeBus } from "@agentos/realtime";
import { createTrustedBusinessContext } from "@agentos/shared";
import { ToolRegistry } from "@agentos/tools";
import { FakeWebChatAdapter, WebsiteContractService, WEB_CHAT_CHANNEL } from "@agentos/website-sdk";
import { universalEventSchema } from "@agentos/events";
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
  await db.insert(schema.businessMemberships).values({ id: ulid(), businessId: ids.businessA, userId, role: "OWNER" });
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
  await assert.rejects(() => gateway.accept(adapter, { headers: new Headers({ origin: "https://evil.example" }), body: new TextEncoder().encode("{}") }, trusted, { quietMs: 150, maxWaitMs: 500 }), /PERMISSION_ERROR/);
  await assert.rejects(() => gateway.accept(adapter, { headers: new Headers({ origin: "https://shop.example", authorization: `Bearer ${bootstrap.sessionToken}` }), body: new TextEncoder().encode("not json") }, trusted, { quietMs: 150, maxWaitMs: 500 }), /VALIDATION_ERROR/);
  const messages = await db.select().from(schema.messages).where(eq(schema.messages.businessId, ids.businessA)).orderBy(schema.messages.inboundSequence);
  assert.deepEqual(messages.map((message) => message.inboundSequence), [1, 2, 3]); assert.deepEqual(messages.map((message) => message.externalMessageId), keys); assert.equal(messages[0]!.occurredAt.toISOString(), "2026-09-20T10:00:00.000Z");
  const batches = await db.select().from(schema.messageBatches).where(eq(schema.messageBatches.businessId, ids.businessA)); assert.equal(batches.length, 1); assert.deepEqual(batches[0]!.messageIds, messages.map((message) => message.id));

  await pause(170);
  const stop = await startPhase5Worker({ db, redisUrl, runtime, registry, presence });
  assert.equal((await db.select().from(schema.serviceHeartbeats).where(eq(schema.serviceHeartbeats.service, "agentos-worker"))).length, 1);
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
  const priorSends = adapter.executed.length; adapter.throwAfterNextExecute = true;
  const ambiguous = await store.reserveEffect({ businessId: ids.businessA, conversationId: ids.conversation, traceId: ulid(), includedSequence: 3, runAt: new Date(), action: { id: ulid(), schemaVersion: "1.0", type: "SendMessage", idempotencyKey: `ambiguous:${ulid()}`, text: "Ambiguous outcome" } });
  await until("ambiguous send recorded", async () => (await store.getEffect(ids.businessA, ambiguous.id)).state === "UNKNOWN");
  assert.equal(adapter.executed.length, priorSends + 1);
  const reconciler = new Phase5Processor({ store, runtime, registry, presence, router: new EventRouter(store) });
  assert.equal(await reconciler.reconcileUnknownEffect(ids.businessA, ambiguous.id), "COMPLETED");
  assert.equal(adapter.executed.length, priorSends + 1, "reconciliation must not resend");
  await stop();
  assert.equal((await db.select().from(schema.serviceHeartbeats).where(eq(schema.serviceHeartbeats.service, "agentos-worker"))).length, 0);

  const failedConversation = ulid(); await db.insert(schema.conversations).values({ id: failedConversation, businessId: ids.businessA, customerId: ids.customer, agentId: ids.agent, channel: WEB_CHAT_CHANNEL });
  conversations.seed({ businessId: ids.businessA, conversationId: failedConversation, customerId: ids.customer, messages: [], pins: [], pendingGoals: [], announcements: [] });
  const failedRuntime = new AgentRuntime({ versions: new AgentVersionService(versions), contextEngine: new LayeredContextEngine(conversations), models: new FakeModelProvider([{ kind: "error", error: { code: "UNAVAILABLE", message: "Run failed safely", retryable: false } }]), tools: new ToolRegistry(), actions: new DeferredChannelActionExecutor(new InMemoryActionRepository(), conversations), traces: new InMemoryTraceRepository(), realtime: new InMemoryRealtimeBus(), presence });
  const failedTrusted = createTrustedBusinessContext({ businessId: ids.businessA, principal: { kind: "adapter", connectionId: site.id }, source: "verified_adapter", agentId: ids.agent, conversationId: failedConversation, customerId: ids.customer, traceId: ulid(), capabilityGrants: ["conversation.read", "handoff.request"] });
  await gateway.accept(adapter, await request("Need a person", ulid()), failedTrusted, { quietMs: 100, maxWaitMs: 300 }); await pause(120);
  const stopFailed = await startPhase5Worker({ db, redisUrl, runtime: failedRuntime, registry, presence });
  await until("terminal run failure notification", async () => (await db.select().from(schema.notifications).where(and(eq(schema.notifications.businessId, ids.businessA), eq(schema.notifications.type, "AGENT_RUN_FAILED"), eq(schema.notifications.conversationId, failedConversation)))).length === 1);
  const failedNotice = (await db.select().from(schema.notifications).where(and(eq(schema.notifications.businessId, ids.businessA), eq(schema.notifications.type, "AGENT_RUN_FAILED"), eq(schema.notifications.conversationId, failedConversation))))[0]!;
  assert.deepEqual(failedNotice.safePayload, { safeCode: "UNAVAILABLE" });
  await stopFailed();

  // PostgreSQL order writes hold the conversation row and reject an older worker sequence.
  const durableOrders = new PostgresOrderRepository(db);
  const checkout = new OrderService(new FakeCommerceAdapter(new Map([["shirt", { id: "shirt", name: "Shirt", variants: [{ id: "XL", name: "XL", stock: 5, priceMinor: 1500 }], currency: "BDT" }]])));
  const orderContext = createTrustedBusinessContext({ businessId: ids.businessA, principal: { kind: "system", service: "phase5-worker" }, source: "internal_system", agentId: ids.agent, conversationId: ids.conversation, customerId: ids.customer, traceId: ulid(), capabilityGrants: ["commerce.write"] });
  orderContext.includedInboundSequence = 2;
  checkout.setPolicy(orderContext, { enabled: true, fields: [], requireVariant: false, requireConfirmation: true, paymentMethods: ["COD"], deliveryMethods: ["HOME"], pendingExpiryMinutes: 60 });
  const pendingOrder = checkout.start(orderContext, { channel: WEB_CHAT_CHANNEL });
  await checkout.addItem(orderContext, pendingOrder.id, { reference: { productId: "shirt", variantId: "XL", source: "CATALOG", confirmed: true }, quantity: 1 });
  checkout.collect(orderContext, pendingOrder.id, { paymentMethod: "COD", deliveryMethod: "HOME" });
  const confirmedOrder = await checkout.confirm(orderContext, pendingOrder.id);
  await assert.rejects(durableOrders.savePending(orderContext, confirmedOrder), /STALE_CONVERSATION/);
  orderContext.includedInboundSequence = 3;
  await durableOrders.savePending(orderContext, confirmedOrder);
  const createdOrder = await checkout.createOrder(orderContext, pendingOrder.id, `phase5-order:${pendingOrder.id}`);
  await db.update(schema.conversations).set({ latestInboundSequence: 4 }).where(eq(schema.conversations.id, ids.conversation));
  await assert.rejects(durableOrders.commitOrder(orderContext, createdOrder.order, `phase5-order:${pendingOrder.id}`), /STALE_CONVERSATION/);
  orderContext.includedInboundSequence = 4;
  assert.equal((await durableOrders.commitOrder(orderContext, createdOrder.order, `phase5-order:${pendingOrder.id}`)).duplicate, false);
  assert.equal((await durableOrders.commitOrder(orderContext, createdOrder.order, `phase5-order:${pendingOrder.id}`)).duplicate, true);

  // Two worker instances cannot overlap a conversation run; new input suppresses its stale reply.
  const freshnessConversation = ulid(); await db.insert(schema.conversations).values({ id: freshnessConversation, businessId: ids.businessA, customerId: ids.customer, agentId: ids.agent, channel: WEB_CHAT_CHANNEL });
  conversations.seed({ businessId: ids.businessA, conversationId: freshnessConversation, customerId: ids.customer, messages: [], pins: [], pendingGoals: [], announcements: [] });
  const staleReply = "XL is unavailable."; const freshReply = "XL is available now.";
  const scripted = new FakeModelProvider([{ kind: "actions", actions: [{ id: ulid(), schemaVersion: "1.0", type: "SendMessage", idempotencyKey: `stale:${ulid()}`, text: staleReply }], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }, { kind: "actions", actions: [{ id: ulid(), schemaVersion: "1.0", type: "SendMessage", idempotencyKey: `fresh:${ulid()}`, text: freshReply }], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }]);
  let signalFirstModel!: () => void; const firstModel = new Promise<void>((resolve) => { signalFirstModel = resolve; }); let modelCalls = 0; let activeModel = 0; let maxActiveModel = 0;
  const delayedModel = { async generate(request: Parameters<typeof scripted.generate>[0]) { modelCalls++; activeModel++; maxActiveModel = Math.max(maxActiveModel, activeModel); if (modelCalls === 1) { signalFirstModel(); await pause(250); } const response = await scripted.generate(request); activeModel--; return response; } };
  const freshnessRuntime = new AgentRuntime({ versions: new AgentVersionService(versions), contextEngine: new LayeredContextEngine(conversations), models: delayedModel, tools: new ToolRegistry(), actions: new DeferredChannelActionExecutor(new InMemoryActionRepository(), conversations), traces: new InMemoryTraceRepository(), realtime: new InMemoryRealtimeBus(), presence });
  const freshContext = createTrustedBusinessContext({ businessId: ids.businessA, principal: { kind: "adapter", connectionId: site.id }, source: "verified_adapter", agentId: ids.agent, conversationId: freshnessConversation, customerId: ids.customer, traceId: ulid(), capabilityGrants: ["conversation.read"] });
  const stopOne = await startPhase5Worker({ db, redisUrl, runtime: freshnessRuntime, registry, presence });
  const stopTwo = await startPhase5Worker({ db, redisUrl, runtime: freshnessRuntime, registry, presence });
  await gateway.accept(adapter, await request("Black M ache?", ulid()), freshContext, { quietMs: 0, maxWaitMs: 0 });
  await firstModel;
  await gateway.accept(adapter, { headers: (await request("XL lagbe", ulid())).headers, body: new TextEncoder().encode(JSON.stringify({ message: "XL lagbe", idempotencyKey: ulid(), urgent: true })) }, freshContext, { quietMs: 0, maxWaitMs: 0 });
  await until("fresh reply after newer input", async () => adapter.executed.some((item) => item.action.type === "SendMessage" && item.action.text === freshReply));
  assert.equal(adapter.executed.some((item) => item.action.type === "SendMessage" && item.action.text === staleReply), false);
  assert.equal(maxActiveModel, 1);
  await stopOne(); await stopTwo();

  const redisQueues = new Phase5Queues(store, redisUrl);
  const leaseA = new RedisConversationLease(redisQueues.redis, `agentos:conversation:${ids.businessA}:${ids.conversation}`);
  const leaseB = new RedisConversationLease(redisQueues.redis, `agentos:conversation:${ids.businessA}:${ids.conversation}`);
  const leaseOther = new RedisConversationLease(redisQueues.redis, `agentos:conversation:${secondBusiness}:${ulid()}`);
  assert.equal(await leaseA.acquire(), true); assert.equal(await leaseB.acquire(), false); assert.equal(await leaseOther.acquire(), true); await leaseA.release(); assert.equal(await leaseB.acquire(), true); await leaseB.release(); await leaseOther.release();
  const expiryKey = `agentos:conversation:${ids.businessA}:${ulid()}`;
  const expiring = new RedisConversationLease(redisQueues.redis, expiryKey, 80);
  assert.equal(await expiring.acquire(), true);
  await redisQueues.redis.del(expiryKey); // Simulate an expired lease while the old worker still runs.
  const replacement = new RedisConversationLease(redisQueues.redis, expiryKey, 1_000);
  assert.equal(await replacement.acquire(), true);
  await assert.rejects(expiring.assertOwner(), /lease lost/);
  await expiring.release();
  assert.equal(await redisQueues.redis.get(expiryKey), replacement.token, "old owner cannot release a replacement lease");
  await replacement.release();

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
  const deadId = ulid(); await db.insert(schema.workItems).values({ id: deadId, businessId: ids.businessA, kind: "EVENT", resourceId: ulid(), traceId: ulid(), state: "DEAD", runAt: new Date() });
  const operations = new Phase5Operations(store);
  await assert.rejects(() => operations.replay({ userId, role: "SUPPORT" }, { businessId: ids.businessA, workId: deadId, dryRun: false }), /FORBIDDEN/);
  assert.equal((await operations.replay({ userId, role: "ADMIN" }, { businessId: ids.businessA, workId: deadId })).replayed, false);
  assert.equal((await store.getWork(ids.businessA, deadId)).state, "DEAD");
  assert.equal((await operations.replay({ userId, role: "ADMIN" }, { businessId: ids.businessA, workId: deadId, dryRun: false })).replayed, true);
  const cancelledId = ulid(); await db.insert(schema.workItems).values({ id: cancelledId, businessId: ids.businessA, kind: "BROWSER", resourceId: ulid(), traceId: ulid(), state: "PENDING", runAt: new Date() });
  assert.equal((await operations.cancel({ userId, role: "ADMIN" }, ids.businessA, cancelledId)).cancelled, true); assert.equal((await store.getWork(ids.businessA, cancelledId)).state, "CANCELLED");

  const goalId = ulid(); await db.insert(schema.pendingGoals).values({ id: goalId, businessId: ids.businessA, customerId: ids.customer, conversationId: ids.conversation, type: "follow_up", description: "Follow up", state: "PENDING", triggerType: "TIME", trigger: { at: new Date(Date.now() - 1_000).toISOString() }, createdBy: userId, idempotencyKey: `goal:${goalId}`, traceId: ulid() });
  assert.equal(await store.scheduleDueGoals(), 1); assert.equal(await store.scheduleDueGoals(), 0);
  assert.equal((await db.select().from(schema.goalExecutions).where(and(eq(schema.goalExecutions.businessId, ids.businessA), eq(schema.goalExecutions.goalId, goalId)))).length, 1);
  const inventoryGoalId = ulid(); const customGoalId = ulid();
  await db.insert(schema.pendingGoals).values([{ id: inventoryGoalId, businessId: ids.businessA, customerId: ids.customer, conversationId: ids.conversation, type: "stock", description: "Black XL returns", state: "PENDING", triggerType: "INVENTORY", trigger: { productId: "black-shirt", variantId: "XL" }, createdBy: userId, idempotencyKey: `goal:${inventoryGoalId}`, traceId: ulid() }, { id: customGoalId, businessId: ids.businessA, customerId: ids.customer, conversationId: ids.conversation, type: "custom", description: "Custom event", state: "PENDING", triggerType: "EVENT", trigger: { eventType: "custom.triggered", name: "shipment_ready" }, createdBy: userId, idempotencyKey: `goal:${customGoalId}`, traceId: ulid() }]);
  const eventBase = { id: ulid(), schemaVersion: "1.0", businessId: ids.businessA, channel: WEB_CHAT_CHANNEL, connectionId: site.id, conversationId: ids.conversation, customerId: ids.customer, dedupeKey: ulid(), occurredAt: new Date().toISOString(), receivedAt: new Date().toISOString(), traceId: ulid(), rawEventId: ulid(), source: { kind: "system" } };
  const inventoryEvent = universalEventSchema.parse({ ...eventBase, type: "inventory.updated", payload: { productId: "black-shirt", variantId: "XL", available: 4 } });
  const customEvent = universalEventSchema.parse({ ...eventBase, id: ulid(), dedupeKey: ulid(), type: "custom.triggered", payload: { name: "shipment_ready" } });
  assert.deepEqual(await store.activateGoals(inventoryEvent), [inventoryGoalId]); assert.deepEqual(await store.activateGoals(inventoryEvent), []);
  assert.deepEqual(await store.activateGoals(customEvent), [customGoalId]); assert.deepEqual(await store.activateGoals(customEvent), []);
  assert.equal((await db.select().from(schema.goalExecutions).where(eq(schema.goalExecutions.businessId, ids.businessA))).length, 3);
  const router = new EventRouter(store);
  const deliveryEvent = universalEventSchema.parse({ ...eventBase, id: ulid(), dedupeKey: ulid(), type: "message.delivered", payload: { externalMessageId: keys[0], at: new Date().toISOString() } });
  await router.process(deliveryEvent, new AbortController().signal);
  const delivered = (await db.select().from(schema.messages).where(eq(schema.messages.id, messages[0]!.id)))[0]!;
  assert.ok((delivered.lifecycle as Record<string, string>)["message.delivered"]);
  const commentEvent = universalEventSchema.parse({ ...eventBase, id: ulid(), dedupeKey: ulid(), type: "comment.created", payload: { externalCommentId: "comment-1" } });
  await db.insert(schema.universalEvents).values({ id: commentEvent.id, businessId: ids.businessA, connectionId: site.id, channel: WEB_CHAT_CHANNEL, conversationId: ids.conversation, customerId: ids.customer, schemaVersion: "1.0", type: commentEvent.type, dedupeKey: commentEvent.dedupeKey, payload: commentEvent.payload, source: commentEvent.source, traceId: commentEvent.traceId, state: "PENDING", occurredAt: new Date(commentEvent.occurredAt), receivedAt: new Date(commentEvent.receivedAt) });
  await assert.rejects(() => router.process(commentEvent, new AbortController().signal), (error: unknown) => (error as { code?: string }).code === "COMMENT_PROCESSOR_UNAVAILABLE");
  assert.equal((await db.select().from(schema.universalEvents).where(eq(schema.universalEvents.id, commentEvent.id)))[0]!.state, "PENDING");
  assert.equal((await operations.inspect({ userId, role: "SUPPORT" }, secondBusiness)).events.length, 0);
  await assert.rejects(() => store.getWork(secondBusiness, deadId), /WORK_NOT_FOUND/);
  await db.update(schema.rawInboundEvents).set({ retentionUntil: new Date(Date.now() - 1_000) }).where(eq(schema.rawInboundEvents.id, messages[0]!.rawEventSourceRef!));
  assert.ok(await store.purgeExpiredRaw() >= 1);
  assert.equal((await db.select().from(schema.rawInboundEvents).where(eq(schema.rawInboundEvents.id, messages[0]!.rawEventSourceRef!)))[0]!.state, "PURGED");
  assert.equal((await store.getEvent(ids.businessA, batches[0]!.eventIds[0]!)).type, "message.received");
  await redisQueues.close();
  console.log("Phase 5 PostgreSQL/Redis integration passed: dedupe, ordered batching, fake adapter delivery, terminal run-failure notification, notification retry, leases, 40-conversation fairness, recovery, replay authorization, and one-shot goals.");
} finally { await pool.end(); }
