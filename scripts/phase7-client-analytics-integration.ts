import assert from "node:assert/strict";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as dbs from "@agentos/database";
import { PostgresClientDashboard } from "@agentos/client-operations";
import { PostgresRuntimeDomainActions } from "@agentos/phase6";
import { Phase5Store } from "@agentos/phase5";
import { PostgresHandoffOperations } from "@agentos/handoff";
import { createTrustedBusinessContext } from "@agentos/shared";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);
const businessA = ulid(); const businessB = ulid(); const userA = ulid(); const userA2 = ulid(); const userB = ulid(); const customerA = ulid(); const customerB = ulid(); const realA = ulid(); const noReplyA = ulid(); const testA = ulid(); const realB = ulid(); const agentA = ulid(); const versionA = ulid(); const runA = ulid(); const deadWork = ulid(); const staleHandoff = ulid(); const notificationA = ulid(); const notificationA2 = ulid(); const notificationB = ulid(); const now = new Date();
const context = (businessId: string, grants = ["conversation.read"], userId = businessId === businessA ? userA : userB, conversationId?: string) => createTrustedBusinessContext({ businessId, principal: { kind: "user", userId, sessionId: ulid() }, source: "test_harness", ...(conversationId ? { conversationId } : {}), traceId: ulid(), capabilityGrants: grants });
try {
  await db.insert(dbs.businesses).values([{ id: businessA, name: "Analytics A" }, { id: businessB, name: "Analytics B" }]);
  await db.insert(dbs.users).values([{ id: userA, name: "Analytics user A", email: `${userA}@example.test` }, { id: userA2, name: "Analytics user A2", email: `${userA2}@example.test` }, { id: userB, name: "Analytics user B", email: `${userB}@example.test` }]);
  await db.insert(dbs.businessMemberships).values([{ id: ulid(), businessId: businessA, userId: userA, role: "OWNER" }, { id: ulid(), businessId: businessA, userId: userA2, role: "STAFF" }, { id: ulid(), businessId: businessB, userId: userB, role: "OWNER" }]);
  await db.insert(dbs.customers).values([{ id: customerA, businessId: businessA, displayName: "A customer" }, { id: customerB, businessId: businessB, displayName: "B customer" }]);
  await db.insert(dbs.conversations).values([
    { id: realA, businessId: businessA, customerId: customerA, channel: "web_chat", unread: true, urgent: true, ownership: "HANDOFF_REQUESTED" },
    { id: noReplyA, businessId: businessA, customerId: customerA, channel: "facebook_messenger" },
    { id: testA, businessId: businessA, channel: "web_chat", unread: true, urgent: true, isTest: true },
    { id: realB, businessId: businessB, customerId: customerB, channel: "facebook_messenger", unread: true, urgent: true, ownership: "HANDOFF_REQUESTED" },
  ]);
  const messageAt = (conversationId: string, businessId: string, senderKind: string, occurredAt: Date, status?: string) => ({ id: ulid(), businessId, conversationId, senderKind, text: "metric fixture", occurredAt, traceId: ulid(), lifecycle: status ? { status } : {} });
  await db.insert(dbs.messages).values([
    messageAt(realA, businessA, "CUSTOMER", new Date(now.getTime() - 10 * 60_000)),
    messageAt(realA, businessA, "AGENT", new Date(now.getTime() - 5 * 60_000), "SENT"),
    messageAt(noReplyA, businessA, "CUSTOMER", new Date(now.getTime() - 4 * 60_000)),
    messageAt(testA, businessA, "CUSTOMER", new Date(now.getTime() - 9 * 60_000)),
    messageAt(testA, businessA, "AGENT", new Date(now.getTime() - 8 * 60_000), "SENT"),
    messageAt(realB, businessB, "CUSTOMER", new Date(now.getTime() - 20 * 60_000)),
    messageAt(realB, businessB, "HUMAN", new Date(now.getTime() - 10 * 60_000), "SENT"),
  ]);
  await db.insert(dbs.handoffs).values([
    { id: ulid(), businessId: businessA, conversationId: realA, channel: "web_chat", reason: "NEEDS_HUMAN", traceId: ulid(), idempotencyKey: ulid() },
    { id: ulid(), businessId: businessB, conversationId: realB, channel: "facebook_messenger", reason: "NEEDS_HUMAN", traceId: ulid(), idempotencyKey: ulid() },
  ]);
  await db.insert(dbs.notifications).values([
    { id: notificationA, businessId: businessA, userId: userA, conversationId: realA, type: "HANDOFF_REQUESTED", severity: "NORMAL", dedupeKey: "handoff:a", safePayload: { private: "must not be projected" } },
    { id: notificationA2, businessId: businessA, userId: userA2, conversationId: realA, type: "COMMENT_REVIEW", severity: "NORMAL", dedupeKey: "comment:a2", safePayload: {} },
    { id: notificationB, businessId: businessB, userId: userB, conversationId: realB, type: "TRIAL_STARTED", severity: "NORMAL", dedupeKey: "trial:b", safePayload: {} },
  ]);
  const service = new PostgresClientDashboard(db);
  const customerDirectory = await service.customerDirectory(context(businessA, ["customer.read"]));
  assert.deepEqual(customerDirectory.map((row) => row.id), [customerA]);
  assert.equal(customerDirectory[0]?.conversationCount, 2);
  assert.ok(customerDirectory[0]?.lastConversationAt);
  assert.deepEqual((await service.customerDirectory(context(businessA, ["customer.read"]), "A customer")).map((row) => row.id), [customerA]);
  assert.deepEqual(await service.customerDirectory(context(businessA, ["customer.read"]), "B customer"), []);
  const teamDirectory = await service.teamDirectory(context(businessA, ["member.manage"]));
  assert.deepEqual(teamDirectory.map((row) => row.userId).sort(), [userA, userA2].sort());
  assert.ok(teamDirectory.every((row) => row.email.endsWith("@example.test")));
  await assert.rejects(service.customerDirectory(context(businessA)), /FORBIDDEN/);
  await assert.rejects(service.teamDirectory(context(businessA)), /FORBIDDEN/);
  const a = await service.snapshot(context(businessA), "needs-attention", { urgent: true });
  assert.deepEqual(a.counters, { unreadConversations: 1, unresolvedHandoffs: 1, failedRuns: 0, urgentIssues: 1 });
  assert.deepEqual(a.recent.map((row) => row.id), [realA]);
  assert.deepEqual(a.attention.map((row) => row.conversationId), [realA]);
  assert.equal(a.recent[0]?.customerName, "A customer");
  const aOverview = await service.snapshot(context(businessA), "overview");
  assert.deepEqual(aOverview.performance, { windowDays: 30, inboundConversations: 2, aiFirstResponseRate: 50, handoffRate: 50, customersHelped: 1, medianFirstResponseMs: 300_000 });
  assert.deepEqual(aOverview.notifications.map((item) => item.id), [notificationA]);
  assert.equal(JSON.stringify(aOverview.notifications).includes("must not be projected"), false);
  const acknowledgedAt = await service.acknowledgeNotification(context(businessA, ["conversation.read", "notification.manage"]), notificationA);
  assert.ok(acknowledgedAt);
  assert.equal((await service.snapshot(context(businessA), "overview")).notifications[0]?.acknowledgedAt, acknowledgedAt);
  await assert.rejects(service.acknowledgeNotification(context(businessA), notificationA), /FORBIDDEN/);
  await assert.rejects(service.acknowledgeNotification(context(businessB, ["conversation.read", "notification.manage"]), notificationA), /NOTIFICATION_NOT_FOUND/);
  await db.insert(dbs.agents).values({ id: agentA, businessId: businessA, name: "Notification fixture", activeVersionId: versionA });
  await db.insert(dbs.agentVersions).values({ id: versionA, businessId: businessA, agentId: agentA, version: 1, state: "PUBLISHED", config: {}, createdBy: userA });
  await db.insert(dbs.agentRuns).values({ id: runA, businessId: businessA, agentId: agentA, agentVersionId: versionA, conversationId: noReplyA, eventId: ulid(), traceId: ulid(), status: "COMPLETED", startedAt: now, completedAt: now, usage: {} });
  const domainActions = new PostgresRuntimeDomainActions(db); const handoffContext = context(businessA, ["conversation.read"], userA, noReplyA); const requestHuman = { id: ulid(), schemaVersion: "1.0" as const, type: "RequestHuman" as const, idempotencyKey: ulid(), reason: "NEEDS_HUMAN", priority: "HIGH" as const };
  await domainActions.apply(handoffContext, runA, requestHuman); await domainActions.apply(handoffContext, runA, requestHuman);
  const handoffNotices = await db.select({ userId: dbs.notifications.userId, severity: dbs.notifications.severity, handoffId: dbs.notifications.handoffId }).from(dbs.notifications).where(and(eq(dbs.notifications.businessId, businessA), eq(dbs.notifications.type, "HANDOFF_REQUESTED")));
  const generatedNotices = handoffNotices.filter((notice) => notice.handoffId); assert.equal(generatedNotices.length, 2); assert.ok(generatedNotices.every((notice) => notice.severity === "WARNING"));
  assert.deepEqual((await service.snapshot(context(businessA), "overview")).notifications.map((item) => item.type).sort(), ["HANDOFF_REQUESTED", "HANDOFF_REQUESTED"]);
  await db.insert(dbs.handoffs).values({ id: staleHandoff, businessId: businessA, conversationId: realA, customerId: customerA, channel: "web_chat", reason: "Stale fixture", priority: "URGENT", state: "HANDOFF_REQUESTED", staleAt: new Date(now.getTime() - 1_000), traceId: ulid(), idempotencyKey: `stale:${staleHandoff}` });
  const handoffOps = new PostgresHandoffOperations(db, () => now); assert.equal(await handoffOps.notifyStale(), 1); assert.equal(await handoffOps.notifyStale(), 0);
  const staleNotices = await db.select({ userId: dbs.notifications.userId, safePayload: dbs.notifications.safePayload }).from(dbs.notifications).where(and(eq(dbs.notifications.businessId, businessA), eq(dbs.notifications.type, "HANDOFF_STALE")));
  assert.equal(staleNotices.length, 2); assert.ok(staleNotices.every((notice) => JSON.stringify(notice.safePayload) === JSON.stringify({ priority: "URGENT" })));
  await db.insert(dbs.workItems).values({ id: deadWork, businessId: businessA, kind: "EVENT", resourceId: ulid(), traceId: ulid(), state: "PENDING", runAt: now });
  await new Phase5Store(db).finishWork(businessA, deadWork, "DEAD", "PROVIDER_UNAVAILABLE");
  const queueNotice = (await db.select({ safePayload: dbs.notifications.safePayload }).from(dbs.notifications).where(and(eq(dbs.notifications.businessId, businessA), eq(dbs.notifications.type, "QUEUE_WORK_DEAD"))))[0];
  assert.deepEqual(queueNotice?.safePayload, { kind: "EVENT", safeCode: "PROVIDER_UNAVAILABLE" });
  await new Phase5Store(db).finishWork(businessA, deadWork, "DEAD", "PROVIDER_UNAVAILABLE");
  assert.equal((await db.select().from(dbs.notifications).where(and(eq(dbs.notifications.businessId, businessA), eq(dbs.notifications.type, "QUEUE_WORK_DEAD")))).length, 2);
  const b = await service.snapshot(context(businessB), "conversations", { unread: true });
  assert.deepEqual(b.recent.map((row) => row.id), [realB]);
  assert.equal(b.recent[0]?.customerName, "B customer");
  const bOverview = await service.snapshot(context(businessB), "overview");
  assert.deepEqual(bOverview.performance, { windowDays: 30, inboundConversations: 1, aiFirstResponseRate: 0, handoffRate: 100, customersHelped: 1, medianFirstResponseMs: 600_000 });
  await assert.rejects(service.snapshot(context(businessA, []), "overview"), /FORBIDDEN/);
  console.log("Phase 7 client analytics and notifications: scoped performance, delivery-qualified timing, user/tenant inbox isolation, handoff/stale/dead-queue notification idempotency, acknowledgement, and authorization passed");
} finally {
  await db.delete(dbs.notifications).where(eq(dbs.notifications.businessId, businessA)); await db.delete(dbs.notifications).where(eq(dbs.notifications.businessId, businessB));
  await db.delete(dbs.workItems).where(eq(dbs.workItems.businessId, businessA));
  await db.delete(dbs.handoffs).where(eq(dbs.handoffs.businessId, businessA)); await db.delete(dbs.handoffs).where(eq(dbs.handoffs.businessId, businessB));
  await db.delete(dbs.messages).where(eq(dbs.messages.businessId, businessA)); await db.delete(dbs.messages).where(eq(dbs.messages.businessId, businessB));
  await db.delete(dbs.agentRuns).where(eq(dbs.agentRuns.businessId, businessA)); await db.delete(dbs.agentVersions).where(eq(dbs.agentVersions.businessId, businessA)); await db.delete(dbs.agents).where(eq(dbs.agents.businessId, businessA));
  await db.delete(dbs.conversations).where(eq(dbs.conversations.businessId, businessA)); await db.delete(dbs.conversations).where(eq(dbs.conversations.businessId, businessB));
  await db.delete(dbs.customers).where(eq(dbs.customers.businessId, businessA)); await db.delete(dbs.customers).where(eq(dbs.customers.businessId, businessB));
  await db.delete(dbs.businessMemberships).where(eq(dbs.businessMemberships.businessId, businessA)); await db.delete(dbs.businessMemberships).where(eq(dbs.businessMemberships.businessId, businessB));
  await db.delete(dbs.users).where(eq(dbs.users.id, userA)); await db.delete(dbs.users).where(eq(dbs.users.id, userA2)); await db.delete(dbs.users).where(eq(dbs.users.id, userB));
  await db.delete(dbs.businesses).where(eq(dbs.businesses.id, businessA)); await db.delete(dbs.businesses).where(eq(dbs.businesses.id, businessB));
  await pool.end();
}
