import assert from "node:assert/strict";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { ulid } from "ulid";
import * as dbs from "@agentos/database";
import { PostgresClientDashboard } from "@agentos/client-operations";
import { createTrustedBusinessContext } from "@agentos/shared";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);
const businessA = ulid(); const businessB = ulid(); const customerA = ulid(); const customerB = ulid(); const realA = ulid(); const testA = ulid(); const realB = ulid();
const context = (businessId: string, grants = ["conversation.read"]) => createTrustedBusinessContext({ businessId, principal: { kind: "user", userId: ulid(), sessionId: ulid() }, source: "test_harness", traceId: ulid(), capabilityGrants: grants });
try {
  await db.insert(dbs.businesses).values([{ id: businessA, name: "Analytics A" }, { id: businessB, name: "Analytics B" }]);
  await db.insert(dbs.customers).values([{ id: customerA, businessId: businessA, displayName: "A customer" }, { id: customerB, businessId: businessB, displayName: "B customer" }]);
  await db.insert(dbs.conversations).values([
    { id: realA, businessId: businessA, customerId: customerA, channel: "web_chat", unread: true, urgent: true, ownership: "HANDOFF_REQUESTED" },
    { id: testA, businessId: businessA, channel: "web_chat", unread: true, urgent: true, isTest: true },
    { id: realB, businessId: businessB, customerId: customerB, channel: "facebook_messenger", unread: true, urgent: true, ownership: "HANDOFF_REQUESTED" },
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
  const b = await service.snapshot(context(businessB), "conversations", { unread: true });
  assert.deepEqual(b.recent.map((row) => row.id), [realB]);
  assert.equal(b.recent[0]?.customerName, "B customer");
  await assert.rejects(service.snapshot(context(businessA, []), "overview"), /FORBIDDEN/);
  console.log("Phase 7 client analytics: scoped counts, current ownership, test exclusion, filters, tenant separation, and authorization passed");
} finally { await pool.end(); }
