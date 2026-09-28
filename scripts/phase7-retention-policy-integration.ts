import assert from "node:assert/strict";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as dbs from "@agentos/database";
import { PostgresBusinessContentRetention, PostgresBusinessRetentionPolicies } from "@agentos/phase4-operations";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
const pool = new Pool({ connectionString: process.env.DATABASE_URL }); const database = drizzle(pool);
const businessA = ulid(); const businessB = ulid(); const userId = ulid(); const conversationA = ulid(); const conversationB = ulid(); const customerA = ulid(); const customerB = ulid(); const identityA = ulid(); const identityB = ulid(); const linkA = ulid(); const memoryA = ulid(); const memoryB = ulid(); const summaryA = ulid(); const summaryB = ulid(); const pinA = ulid(); const pinB = ulid(); const noteA = ulid(); const noteB = ulid(); const old = new Date(Date.now() - 3 * 86_400_000); const now = new Date();
const messageA = ulid(); const messageB = ulid(); const processedEvent = ulid(); const pendingEvent = ulid(); const otherEvent = ulid(); const realtimeA = ulid(); const realtimeB = ulid(); const projectionA = ulid(); const projectionB = ulid(); const pendingOrderA = ulid(); const orderA = ulid(); const orderNoteA = ulid(); const pendingOrderB = ulid(); const orderB = ulid(); const orderNoteB = ulid(); const resolvedGoalA = ulid(); const pendingGoalA = ulid(); const resolvedGoalB = ulid(); const announcementA = ulid(); const currentAnnouncementA = ulid(); const announcementB = ulid();
const actor = { userId, grants: ["retention.manage"], allowedBusinessIds: new Set([businessA]) };
const policies = new PostgresBusinessRetentionPolicies(database);
try {
  await database.insert(dbs.businesses).values([{ id: businessA, name: "Retention A" }, { id: businessB, name: "Retention B" }]);
  await database.insert(dbs.users).values({ id: userId, name: "Retention operator", email: `${userId}@example.test` });
  await database.insert(dbs.conversations).values([{ id: conversationA, businessId: businessA, channel: "test" }, { id: conversationB, businessId: businessB, channel: "test" }]);
  await database.insert(dbs.pendingOrders).values({ id: pendingOrderA, businessId: businessA, conversationId: conversationA, channel: "test", state: "CREATED", confirmation: "GIVEN", expiresAt: new Date(now.getTime() + 86_400_000), createdAt: old, updatedAt: old });
  await database.insert(dbs.pendingOrders).values({ id: pendingOrderB, businessId: businessB, conversationId: conversationB, channel: "test", state: "CREATED", confirmation: "GIVEN", expiresAt: new Date(now.getTime() + 86_400_000), createdAt: old, updatedAt: old });
  await database.insert(dbs.orders).values({ id: orderA, businessId: businessA, number: `RET-${orderA}`, conversationId: conversationA, pendingOrderId: pendingOrderA, sourceChannel: "test", origin: "HUMAN", fields: { customerName: "financial record remains" }, paymentMethod: "COD", deliveryMethod: "DELIVERY", confirmation: "GIVEN", status: "DELIVERED", totalMinor: 500, currency: "BDT", createdAt: old, updatedAt: old });
  await database.insert(dbs.orders).values({ id: orderB, businessId: businessB, number: `RET-${orderB}`, conversationId: conversationB, pendingOrderId: pendingOrderB, sourceChannel: "test", origin: "HUMAN", fields: {}, paymentMethod: "COD", deliveryMethod: "DELIVERY", confirmation: "GIVEN", status: "DELIVERED", totalMinor: 600, currency: "BDT", createdAt: old, updatedAt: old });
  await database.insert(dbs.orderNotes).values({ id: orderNoteA, businessId: businessA, orderId: orderA, actorId: userId, content: "private order note", createdAt: old });
  await database.insert(dbs.orderNotes).values({ id: orderNoteB, businessId: businessB, orderId: orderB, actorId: userId, content: "neighbor order note", createdAt: old });
  await database.insert(dbs.pendingGoals).values([
    { id: resolvedGoalA, businessId: businessA, conversationId: conversationA, type: "FOLLOW_UP", description: "private resolved goal", state: "RESOLVED", trigger: { customerText: "private trigger" }, idempotencyKey: resolvedGoalA, traceId: ulid(), createdAt: old, updatedAt: old },
    { id: pendingGoalA, businessId: businessA, conversationId: conversationA, type: "FOLLOW_UP", description: "active goal stays", state: "PENDING", trigger: {}, idempotencyKey: pendingGoalA, traceId: ulid(), createdAt: old, updatedAt: old },
    { id: resolvedGoalB, businessId: businessB, conversationId: conversationB, type: "FOLLOW_UP", description: "neighbor closed goal", state: "RESOLVED", trigger: { detail: "neighbor trigger" }, idempotencyKey: resolvedGoalB, traceId: ulid(), createdAt: old, updatedAt: old },
  ]);
  await database.insert(dbs.businessAnnouncements).values([
    { id: announcementA, businessId: businessA, content: "private expired announcement", active: false, startsAt: old, expiresAt: old, channels: ["test"], agentIds: [], createdBy: userId, createdAt: old, updatedAt: old },
    { id: currentAnnouncementA, businessId: businessA, content: "current announcement stays", active: true, startsAt: old, expiresAt: new Date(now.getTime() + 86_400_000), channels: ["test"], agentIds: [], createdBy: userId, createdAt: old, updatedAt: old },
    { id: announcementB, businessId: businessB, content: "neighbor expired announcement", active: false, startsAt: old, expiresAt: old, channels: ["test"], agentIds: [], createdBy: userId, createdAt: old, updatedAt: old },
  ]);
  await database.insert(dbs.customers).values([{ id: customerA, businessId: businessA, displayName: "Private customer A", tags: ["priority"], createdAt: old, updatedAt: old }, { id: customerB, businessId: businessB, displayName: "Private customer B", tags: ["priority"], createdAt: old, updatedAt: old }]);
  await database.insert(dbs.customerIdentities).values([{ id: identityA, businessId: businessA, customerId: customerA, channel: "test", externalId: "identity-key-a", metadata: { email: "private-a@example.test" }, verifiedAt: old, createdAt: old, updatedAt: old }, { id: identityB, businessId: businessB, customerId: customerB, channel: "test", externalId: "identity-key-b", metadata: { email: "private-b@example.test" }, verifiedAt: old, createdAt: old, updatedAt: old }]);
  await database.insert(dbs.identityLinks).values({ id: linkA, businessId: businessA, sourceIdentityId: identityA, targetIdentityId: identityA, decision: "POSSIBLE_MATCH", evidence: { note: "private identity evidence" }, confidence: 0.5, actorId: userId, decidedAt: old, createdAt: old, updatedAt: old });
  await database.insert(dbs.messages).values([
    { id: messageA, businessId: businessA, conversationId: conversationA, senderKind: "CUSTOMER", text: "private message A", occurredAt: old, traceId: ulid() },
    { id: messageB, businessId: businessB, conversationId: conversationB, senderKind: "CUSTOMER", text: "private message B", occurredAt: old, traceId: ulid() },
  ]);
  await database.insert(dbs.memories).values([{ id: memoryA, businessId: businessA, customerId: customerA, type: "PREFERENCE", content: "private memory A", importance: 0.8, confidence: 0.9, createdBy: "test", validFrom: old, traceId: ulid(), createdAt: old, updatedAt: old }, { id: memoryB, businessId: businessB, customerId: customerB, type: "PREFERENCE", content: "private memory B", importance: 0.8, confidence: 0.9, createdBy: "test", validFrom: old, traceId: ulid(), createdAt: old, updatedAt: old }]);
  await database.insert(dbs.conversationSummaries).values([{ id: summaryA, businessId: businessA, conversationId: conversationA, content: "private summary A", throughSequence: 1, traceId: ulid(), createdAt: old, updatedAt: old }, { id: summaryB, businessId: businessB, conversationId: conversationB, content: "private summary B", throughSequence: 1, traceId: ulid(), createdAt: old, updatedAt: old }]);
  await database.insert(dbs.pinnedMessages).values([{ id: pinA, businessId: businessA, conversationId: conversationA, messageId: messageA, label: "private pin A", traceId: ulid(), createdAt: old, updatedAt: old }, { id: pinB, businessId: businessB, conversationId: conversationB, messageId: messageB, label: "private pin B", traceId: ulid(), createdAt: old, updatedAt: old }]);
  await database.insert(dbs.customerNotes).values([{ id: noteA, businessId: businessA, customerId: customerA, actorId: userId, content: "private note A", createdAt: old }, { id: noteB, businessId: businessB, customerId: customerB, actorId: userId, content: "private note B", createdAt: old }]);
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
  await assert.rejects(policies.set(actor, { businessId: businessA, enabled: true, expectedRevision: 0, messagesDays: 1, eventPayloadDays: 1, traceDetailsDays: null, realtimePayloadDays: 1, browserHistoryDays: null, commentTextDays: null, customerContentDays: 1, orderNotesDays: 1, resolvedGoalsDays: 1, expiredAnnouncementsDays: 1 }), /RETENTION_CONFIRMATION_REQUIRED/);
  await assert.rejects(policies.set(actor, { businessId: businessA, enabled: true, expectedRevision: 0, messagesDays: null, eventPayloadDays: null, traceDetailsDays: null, realtimePayloadDays: null, browserHistoryDays: null, commentTextDays: null, customerContentDays: null, orderNotesDays: null, resolvedGoalsDays: null, expiredAnnouncementsDays: null, confirmScrub: "ENABLE CONTENT SCRUBBING" }), /RETENTION_RULE_REQUIRED/);
  await assert.rejects(policies.set(actor, { businessId: businessB, enabled: true, expectedRevision: 0, messagesDays: 1, eventPayloadDays: null, traceDetailsDays: null, realtimePayloadDays: null, browserHistoryDays: null, commentTextDays: null, customerContentDays: null, orderNotesDays: null, resolvedGoalsDays: null, expiredAnnouncementsDays: null, confirmScrub: "ENABLE CONTENT SCRUBBING" }), /FORBIDDEN/);
  const policy = await policies.set(actor, { businessId: businessA, enabled: true, expectedRevision: 0, messagesDays: 1, eventPayloadDays: 1, traceDetailsDays: null, realtimePayloadDays: 1, browserHistoryDays: null, commentTextDays: null, customerContentDays: 1, orderNotesDays: 1, resolvedGoalsDays: 1, expiredAnnouncementsDays: 1, confirmScrub: "ENABLE CONTENT SCRUBBING" });
  assert.equal(policy.revision, 1);
  await assert.rejects(policies.set(actor, { businessId: businessA, enabled: false, expectedRevision: 0, messagesDays: 1, eventPayloadDays: 1, traceDetailsDays: null, realtimePayloadDays: 1, browserHistoryDays: null, commentTextDays: null, customerContentDays: 1, orderNotesDays: 1, resolvedGoalsDays: 1, expiredAnnouncementsDays: 1 }), /CONCURRENT_EDIT/);

  const retention = new PostgresBusinessContentRetention(database);
  assert.deepEqual(await retention.sweep(now, 20), { batches: 7 });
  assert.equal((await database.select({ text: dbs.messages.text }).from(dbs.messages).where(eq(dbs.messages.id, messageA)))[0]?.text, null);
  assert.equal((await database.select({ text: dbs.messages.text }).from(dbs.messages).where(eq(dbs.messages.id, messageB)))[0]?.text, "private message B");
  assert.deepEqual((await database.select({ payload: dbs.universalEvents.payload }).from(dbs.universalEvents).where(eq(dbs.universalEvents.id, processedEvent)))[0]?.payload, { retentionRedacted: true });
  assert.deepEqual((await database.select({ payload: dbs.universalEvents.payload }).from(dbs.universalEvents).where(eq(dbs.universalEvents.id, pendingEvent)))[0]?.payload, { customerText: "private event body" });
  assert.deepEqual((await database.select({ safePayload: dbs.realtimeEvents.safePayload }).from(dbs.realtimeEvents).where(eq(dbs.realtimeEvents.id, realtimeA)))[0]?.safePayload, { retentionRedacted: true });
  assert.deepEqual((await database.select({ safePayload: dbs.clientProjectionEvents.safePayload }).from(dbs.clientProjectionEvents).where(eq(dbs.clientProjectionEvents.id, projectionA)))[0]?.safePayload, { retentionRedacted: true });
  assert.equal((await database.select({ displayName: dbs.customers.displayName }).from(dbs.customers).where(eq(dbs.customers.id, customerA)))[0]?.displayName, null);
  assert.equal((await database.select({ displayName: dbs.customers.displayName }).from(dbs.customers).where(eq(dbs.customers.id, customerB)))[0]?.displayName, "Private customer B");
  assert.deepEqual((await database.select({ metadata: dbs.customerIdentities.metadata, externalId: dbs.customerIdentities.externalId }).from(dbs.customerIdentities).where(eq(dbs.customerIdentities.id, identityA)))[0], { metadata: {}, externalId: "identity-key-a" });
  assert.deepEqual((await database.select({ evidence: dbs.identityLinks.evidence }).from(dbs.identityLinks).where(eq(dbs.identityLinks.id, linkA)))[0]?.evidence, {});
  assert.equal((await database.select({ content: dbs.memories.content }).from(dbs.memories).where(eq(dbs.memories.id, memoryA)))[0]?.content, "[retention redacted]");
  assert.equal((await database.select({ content: dbs.memories.content }).from(dbs.memories).where(eq(dbs.memories.id, memoryB)))[0]?.content, "private memory B");
  assert.equal((await database.select({ content: dbs.conversationSummaries.content }).from(dbs.conversationSummaries).where(eq(dbs.conversationSummaries.id, summaryA)))[0]?.content, "[retention redacted]");
  assert.equal((await database.select({ label: dbs.pinnedMessages.label }).from(dbs.pinnedMessages).where(eq(dbs.pinnedMessages.id, pinA)))[0]?.label, null);
  assert.equal((await database.select({ content: dbs.customerNotes.content }).from(dbs.customerNotes).where(eq(dbs.customerNotes.id, noteA)))[0]?.content, "[retention redacted]");
  assert.equal((await database.select({ content: dbs.orderNotes.content }).from(dbs.orderNotes).where(eq(dbs.orderNotes.id, orderNoteA)))[0]?.content, "[retention redacted]");
  assert.equal((await database.select({ content: dbs.orderNotes.content }).from(dbs.orderNotes).where(eq(dbs.orderNotes.id, orderNoteB)))[0]?.content, "neighbor order note");
  assert.deepEqual((await database.select({ fields: dbs.orders.fields, totalMinor: dbs.orders.totalMinor }).from(dbs.orders).where(eq(dbs.orders.id, orderA)))[0], { fields: { customerName: "financial record remains" }, totalMinor: 500 });
  assert.deepEqual((await database.select({ description: dbs.pendingGoals.description, trigger: dbs.pendingGoals.trigger }).from(dbs.pendingGoals).where(eq(dbs.pendingGoals.id, resolvedGoalA)))[0], { description: "[retention redacted]", trigger: { retentionRedacted: true } });
  assert.equal((await database.select({ description: dbs.pendingGoals.description }).from(dbs.pendingGoals).where(eq(dbs.pendingGoals.id, pendingGoalA)))[0]?.description, "active goal stays");
  assert.equal((await database.select({ description: dbs.pendingGoals.description }).from(dbs.pendingGoals).where(eq(dbs.pendingGoals.id, resolvedGoalB)))[0]?.description, "neighbor closed goal");
  assert.deepEqual((await database.select({ content: dbs.businessAnnouncements.content, channels: dbs.businessAnnouncements.channels, active: dbs.businessAnnouncements.active }).from(dbs.businessAnnouncements).where(eq(dbs.businessAnnouncements.id, announcementA)))[0], { content: "[retention redacted]", channels: [], active: false });
  assert.equal((await database.select({ content: dbs.businessAnnouncements.content }).from(dbs.businessAnnouncements).where(eq(dbs.businessAnnouncements.id, currentAnnouncementA)))[0]?.content, "current announcement stays");
  assert.equal((await database.select({ content: dbs.businessAnnouncements.content }).from(dbs.businessAnnouncements).where(eq(dbs.businessAnnouncements.id, announcementB)))[0]?.content, "neighbor expired announcement");
  assert.deepEqual(await retention.sweep(now, 20), { batches: 0 });
  const audit = await database.select({ safeMetadata: dbs.auditLogs.safeMetadata }).from(dbs.auditLogs).where(and(eq(dbs.auditLogs.businessId, businessA), eq(dbs.auditLogs.action, "business.content_retention_scrubbed")));
  assert.equal(audit.length, 7); assert.equal(JSON.stringify(audit).includes("private"), false);
  console.log("Phase 7 business retention: audited opt-in policy, tenant isolation, pending-event protection, redaction, and idempotent sweep passed");
} finally {
  await database.delete(dbs.businessRetentionPolicies).where(eq(dbs.businessRetentionPolicies.businessId, businessA));
  await database.delete(dbs.auditLogs).where(eq(dbs.auditLogs.businessId, businessA));
  await database.delete(dbs.identityLinks).where(eq(dbs.identityLinks.businessId, businessA));
  await database.delete(dbs.customerIdentities).where(eq(dbs.customerIdentities.businessId, businessA));
  await database.delete(dbs.customerIdentities).where(eq(dbs.customerIdentities.businessId, businessB));
  await database.delete(dbs.memories).where(eq(dbs.memories.businessId, businessA));
  await database.delete(dbs.memories).where(eq(dbs.memories.businessId, businessB));
  await database.delete(dbs.conversationSummaries).where(eq(dbs.conversationSummaries.businessId, businessA));
  await database.delete(dbs.conversationSummaries).where(eq(dbs.conversationSummaries.businessId, businessB));
  await database.delete(dbs.pinnedMessages).where(eq(dbs.pinnedMessages.businessId, businessA));
  await database.delete(dbs.pinnedMessages).where(eq(dbs.pinnedMessages.businessId, businessB));
  await database.delete(dbs.customerNotes).where(eq(dbs.customerNotes.businessId, businessA));
  await database.delete(dbs.customerNotes).where(eq(dbs.customerNotes.businessId, businessB));
  await database.delete(dbs.customers).where(eq(dbs.customers.businessId, businessA));
  await database.delete(dbs.customers).where(eq(dbs.customers.businessId, businessB));
  await database.delete(dbs.clientProjectionEvents).where(eq(dbs.clientProjectionEvents.businessId, businessA));
  await database.delete(dbs.clientProjectionEvents).where(eq(dbs.clientProjectionEvents.businessId, businessB));
  await database.delete(dbs.realtimeEvents).where(eq(dbs.realtimeEvents.businessId, businessA));
  await database.delete(dbs.realtimeEvents).where(eq(dbs.realtimeEvents.businessId, businessB));
  await database.delete(dbs.universalEvents).where(eq(dbs.universalEvents.businessId, businessA));
  await database.delete(dbs.universalEvents).where(eq(dbs.universalEvents.businessId, businessB));
  await database.delete(dbs.messages).where(eq(dbs.messages.businessId, businessA));
  await database.delete(dbs.messages).where(eq(dbs.messages.businessId, businessB));
  await database.delete(dbs.orderNotes).where(eq(dbs.orderNotes.businessId, businessA));
  await database.delete(dbs.orderNotes).where(eq(dbs.orderNotes.businessId, businessB));
  await database.delete(dbs.orders).where(eq(dbs.orders.businessId, businessA));
  await database.delete(dbs.orders).where(eq(dbs.orders.businessId, businessB));
  await database.delete(dbs.pendingOrders).where(eq(dbs.pendingOrders.businessId, businessA));
  await database.delete(dbs.pendingOrders).where(eq(dbs.pendingOrders.businessId, businessB));
  await database.delete(dbs.pendingGoals).where(eq(dbs.pendingGoals.businessId, businessA));
  await database.delete(dbs.pendingGoals).where(eq(dbs.pendingGoals.businessId, businessB));
  await database.delete(dbs.businessAnnouncements).where(eq(dbs.businessAnnouncements.businessId, businessA));
  await database.delete(dbs.businessAnnouncements).where(eq(dbs.businessAnnouncements.businessId, businessB));
  await database.delete(dbs.conversations).where(eq(dbs.conversations.businessId, businessA));
  await database.delete(dbs.conversations).where(eq(dbs.conversations.businessId, businessB));
  await database.delete(dbs.users).where(eq(dbs.users.id, userId));
  await database.delete(dbs.businesses).where(eq(dbs.businesses.id, businessA));
  await database.delete(dbs.businesses).where(eq(dbs.businesses.id, businessB));
  await pool.end();
}
