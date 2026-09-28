import assert from "node:assert/strict";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as dbs from "@agentos/database";
import { PostgresClientDashboard } from "@agentos/client-operations";
import { createTrustedBusinessContext } from "@agentos/shared";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);
const businessA = ulid(); const businessB = ulid(); const customerA = ulid(); const customerB = ulid(); const realA = ulid(); const noReplyA = ulid(); const testA = ulid(); const realB = ulid(); const now = new Date();
const context = (businessId: string, grants = ["conversation.read"]) => createTrustedBusinessContext({ businessId, principal: { kind: "user", userId: ulid(), sessionId: ulid() }, source: "test_harness", traceId: ulid(), capabilityGrants: grants });
try {
  await db.insert(dbs.businesses).values([{ id: businessA, name: "Analytics A" }, { id: businessB, name: "Analytics B" }]);
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
  const service = new PostgresClientDashboard(db);
  const a = await service.snapshot(context(businessA), "needs-attention", { urgent: true });
  assert.deepEqual(a.counters, { unreadConversations: 1, unresolvedHandoffs: 1, failedRuns: 0, urgentIssues: 1 });
  assert.deepEqual(a.recent.map((row) => row.id), [realA]);
  assert.deepEqual(a.attention.map((row) => row.conversationId), [realA]);
  assert.equal(a.recent[0]?.customerName, "A customer");
  const aOverview = await service.snapshot(context(businessA), "overview");
  assert.deepEqual(aOverview.performance, { windowDays: 30, inboundConversations: 2, aiFirstResponseRate: 50, handoffRate: 50, customersHelped: 1, medianFirstResponseMs: 300_000 });
  const b = await service.snapshot(context(businessB), "conversations", { unread: true });
  assert.deepEqual(b.recent.map((row) => row.id), [realB]);
  assert.equal(b.recent[0]?.customerName, "B customer");
  const bOverview = await service.snapshot(context(businessB), "overview");
  assert.deepEqual(bOverview.performance, { windowDays: 30, inboundConversations: 1, aiFirstResponseRate: 0, handoffRate: 100, customersHelped: 1, medianFirstResponseMs: 600_000 });
  await assert.rejects(service.snapshot(context(businessA, []), "overview"), /FORBIDDEN/);
  console.log("Phase 7 client analytics: scoped counters/performance, delivery-qualified response timing, test exclusion, tenant separation, and authorization passed");
} finally {
  await db.delete(dbs.handoffs).where(eq(dbs.handoffs.businessId, businessA)); await db.delete(dbs.handoffs).where(eq(dbs.handoffs.businessId, businessB));
  await db.delete(dbs.messages).where(eq(dbs.messages.businessId, businessA)); await db.delete(dbs.messages).where(eq(dbs.messages.businessId, businessB));
  await db.delete(dbs.conversations).where(eq(dbs.conversations.businessId, businessA)); await db.delete(dbs.conversations).where(eq(dbs.conversations.businessId, businessB));
  await db.delete(dbs.customers).where(eq(dbs.customers.businessId, businessA)); await db.delete(dbs.customers).where(eq(dbs.customers.businessId, businessB));
  await db.delete(dbs.businesses).where(eq(dbs.businesses.id, businessA)); await db.delete(dbs.businesses).where(eq(dbs.businesses.id, businessB));
  await pool.end();
}
