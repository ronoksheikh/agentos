import assert from "node:assert/strict";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as dbs from "@agentos/database";
import { PostgresBusinessContentRetention, PostgresBusinessRetentionPolicies } from "@agentos/phase4-operations";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
const pool = new Pool({ connectionString: process.env.DATABASE_URL }); const database = drizzle(pool);
const businessA = ulid(); const businessB = ulid(); const userId = ulid(); const conversationA = ulid(); const conversationB = ulid(); const old = new Date(Date.now() - 3 * 86_400_000); const now = new Date();
const messageA = ulid(); const messageB = ulid(); const processedEvent = ulid(); const pendingEvent = ulid(); const otherEvent = ulid(); const realtimeA = ulid(); const realtimeB = ulid(); const projectionA = ulid(); const projectionB = ulid();
const actor = { userId, grants: ["retention.manage"], allowedBusinessIds: new Set([businessA]) };
const policies = new PostgresBusinessRetentionPolicies(database);
try {
  await database.insert(dbs.businesses).values([{ id: businessA, name: "Retention A" }, { id: businessB, name: "Retention B" }]);
  await database.insert(dbs.users).values({ id: userId, name: "Retention operator", email: `${userId}@example.test` });
  await database.insert(dbs.conversations).values([{ id: conversationA, businessId: businessA, channel: "test" }, { id: conversationB, businessId: businessB, channel: "test" }]);
  await database.insert(dbs.messages).values([
    { id: messageA, businessId: businessA, conversationId: conversationA, senderKind: "CUSTOMER", text: "private message A", occurredAt: old, traceId: ulid() },
    { id: messageB, businessId: businessB, conversationId: conversationB, senderKind: "CUSTOMER", text: "private message B", occurredAt: old, traceId: ulid() },
  ]);
  const eventRow = (id: string, businessId: string, state: string, processedAt: Date | null) => ({ id, businessId, connectionId: "connection", channel: "web_chat", schemaVersion: "1.0", type: "message.received", dedupeKey: id, payload: { customerText: "private event body" }, source: { kind: "adapter", sourceId: "private" }, traceId: ulid(), state, occurredAt: old, receivedAt: old, processedAt });
  await database.insert(dbs.universalEvents).values([eventRow(processedEvent, businessA, "PROCESSED", old), eventRow(pendingEvent, businessA, "PENDING", null), eventRow(otherEvent, businessB, "PROCESSED", old)]);
  await database.insert(dbs.realtimeEvents).values([
    { id: realtimeA, businessId: businessA, traceId: ulid(), schemaVersion: "1.0", type: "message.created", sequence: 1, safePayload: { text: "private realtime A" }, occurredAt: old },
    { id: realtimeB, businessId: businessB, traceId: ulid(), schemaVersion: "1.0", type: "message.created", sequence: 1, safePayload: { text: "private realtime B" }, occurredAt: old },
  ]);
  await database.insert(dbs.clientProjectionEvents).values([
    { id: projectionA, sourceEventId: ulid(), businessId: businessA, traceId: "projection-a", sequence: 1, type: "message.created", safePayload: { text: "private projection A" }, occurredAt: old },
    { id: projectionB, sourceEventId: ulid(), businessId: businessB, traceId: "projection-b", sequence: 1, type: "message.created", safePayload: { text: "private projection B" }, occurredAt: old },
  ]);
  assert.equal((await policies.get(actor, businessA)).enabled, false);
  await assert.rejects(policies.set(actor, { businessId: businessA, enabled: true, expectedRevision: 0, messagesDays: 1, eventPayloadDays: 1, traceDetailsDays: null, realtimePayloadDays: 1, browserHistoryDays: null, commentTextDays: null }), /RETENTION_CONFIRMATION_REQUIRED/);
  await assert.rejects(policies.set(actor, { businessId: businessA, enabled: true, expectedRevision: 0, messagesDays: null, eventPayloadDays: null, traceDetailsDays: null, realtimePayloadDays: null, browserHistoryDays: null, commentTextDays: null, confirmScrub: "ENABLE CONTENT SCRUBBING" }), /RETENTION_RULE_REQUIRED/);
  await assert.rejects(policies.set(actor, { businessId: businessB, enabled: true, expectedRevision: 0, messagesDays: 1, eventPayloadDays: null, traceDetailsDays: null, realtimePayloadDays: null, browserHistoryDays: null, commentTextDays: null, confirmScrub: "ENABLE CONTENT SCRUBBING" }), /FORBIDDEN/);
  const policy = await policies.set(actor, { businessId: businessA, enabled: true, expectedRevision: 0, messagesDays: 1, eventPayloadDays: 1, traceDetailsDays: null, realtimePayloadDays: 1, browserHistoryDays: null, commentTextDays: null, confirmScrub: "ENABLE CONTENT SCRUBBING" });
  assert.equal(policy.revision, 1);
  await assert.rejects(policies.set(actor, { businessId: businessA, enabled: false, expectedRevision: 0, messagesDays: 1, eventPayloadDays: 1, traceDetailsDays: null, realtimePayloadDays: 1, browserHistoryDays: null, commentTextDays: null }), /CONCURRENT_EDIT/);

  const retention = new PostgresBusinessContentRetention(database);
  assert.deepEqual(await retention.sweep(now, 20), { batches: 3 });
  assert.equal((await database.select({ text: dbs.messages.text }).from(dbs.messages).where(eq(dbs.messages.id, messageA)))[0]?.text, null);
  assert.equal((await database.select({ text: dbs.messages.text }).from(dbs.messages).where(eq(dbs.messages.id, messageB)))[0]?.text, "private message B");
  assert.deepEqual((await database.select({ payload: dbs.universalEvents.payload }).from(dbs.universalEvents).where(eq(dbs.universalEvents.id, processedEvent)))[0]?.payload, { retentionRedacted: true });
  assert.deepEqual((await database.select({ payload: dbs.universalEvents.payload }).from(dbs.universalEvents).where(eq(dbs.universalEvents.id, pendingEvent)))[0]?.payload, { customerText: "private event body" });
  assert.deepEqual((await database.select({ safePayload: dbs.realtimeEvents.safePayload }).from(dbs.realtimeEvents).where(eq(dbs.realtimeEvents.id, realtimeA)))[0]?.safePayload, { retentionRedacted: true });
  assert.deepEqual((await database.select({ safePayload: dbs.clientProjectionEvents.safePayload }).from(dbs.clientProjectionEvents).where(eq(dbs.clientProjectionEvents.id, projectionA)))[0]?.safePayload, { retentionRedacted: true });
  assert.deepEqual(await retention.sweep(now, 20), { batches: 0 });
  const audit = await database.select({ safeMetadata: dbs.auditLogs.safeMetadata }).from(dbs.auditLogs).where(and(eq(dbs.auditLogs.businessId, businessA), eq(dbs.auditLogs.action, "business.content_retention_scrubbed")));
  assert.equal(audit.length, 3); assert.equal(JSON.stringify(audit).includes("private"), false);
  console.log("Phase 7 business retention: audited opt-in policy, tenant isolation, pending-event protection, redaction, and idempotent sweep passed");
} finally {
  await database.delete(dbs.businessRetentionPolicies).where(eq(dbs.businessRetentionPolicies.businessId, businessA));
  await database.delete(dbs.auditLogs).where(eq(dbs.auditLogs.businessId, businessA));
  await database.delete(dbs.clientProjectionEvents).where(eq(dbs.clientProjectionEvents.businessId, businessA));
  await database.delete(dbs.clientProjectionEvents).where(eq(dbs.clientProjectionEvents.businessId, businessB));
  await database.delete(dbs.realtimeEvents).where(eq(dbs.realtimeEvents.businessId, businessA));
  await database.delete(dbs.realtimeEvents).where(eq(dbs.realtimeEvents.businessId, businessB));
  await database.delete(dbs.universalEvents).where(eq(dbs.universalEvents.businessId, businessA));
  await database.delete(dbs.universalEvents).where(eq(dbs.universalEvents.businessId, businessB));
  await database.delete(dbs.messages).where(eq(dbs.messages.businessId, businessA));
  await database.delete(dbs.messages).where(eq(dbs.messages.businessId, businessB));
  await database.delete(dbs.conversations).where(eq(dbs.conversations.businessId, businessA));
  await database.delete(dbs.conversations).where(eq(dbs.conversations.businessId, businessB));
  await database.delete(dbs.users).where(eq(dbs.users.id, userId));
  await database.delete(dbs.businesses).where(eq(dbs.businesses.id, businessA));
  await database.delete(dbs.businesses).where(eq(dbs.businesses.id, businessB));
  await pool.end();
}
