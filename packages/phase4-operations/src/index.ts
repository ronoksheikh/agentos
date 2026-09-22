import { createHash } from "node:crypto";
import { ulid } from "ulid";
import { z } from "zod";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@agentos/database";
import { chunkKnowledgeText, DefaultKnowledgeParser, sanitizeKnowledgeText, type KnowledgeHit, type KnowledgeParser, type KnowledgeRetriever, type KnowledgeSource } from "@agentos/knowledge";
import { assertSafeToolConfiguration, customToolSchema } from "@agentos/integrations";
import { orderPolicySchema, orderStatusSchema, type OrderPolicy } from "@agentos/commerce";
import { goalSchema, type PendingGoal } from "@agentos/goals";
import type { TrustedBusinessContext } from "@agentos/shared";
export { PostgresOrderRepository } from "./orders";
export { PostgresAttachmentRepository } from "./attachments";
export { PostgresBrowserRepository } from "./browser";
export { PostgresCustomToolIntentStore } from "./tool-intents";

type Db = NodePgDatabase;
const sourceInputSchema = z.object({ type: z.enum(["PDF", "DOCX", "TEXT", "FAQ", "URL_SNAPSHOT", "CSV", "PRODUCT_CATALOG", "MANUAL_NOTE", "POLICY", "LIVE_DESCRIPTOR"]), label: z.string().min(1).max(200), url: z.url().optional(), retentionUntil: z.iso.datetime({ offset: true }).optional() });
const statusTransitions: Record<string, string[]> = { CONFIRMED: ["PROCESSING", "CANCELLED"], PROCESSING: ["SHIPPED", "CANCELLED"], SHIPPED: ["DELIVERED"] };
const actorId = (context: TrustedBusinessContext) => context.principal.kind === "user" ? context.principal.userId : context.principal.kind;

/** PostgreSQL retrieval uses the generated GIN full-text index and current source version. */
export class PostgresKnowledgeRetriever implements KnowledgeRetriever {
  constructor(private readonly db: Db) {}
  async search(context: TrustedBusinessContext, query: string, filter: { types?: KnowledgeSource["type"][]; sourceIds?: string[]; limit?: number } = {}): Promise<KnowledgeHit[]> {
    if (!query.trim() || /\b(stock|inventory|live price|current price|order status)\b/i.test(query)) return [];
    const score = sql<number>`ts_rank(to_tsvector('simple', ${schema.knowledgeChunks.content}), plainto_tsquery('simple', ${query}))`;
    const rows = await this.db.select({ sourceId: schema.knowledgeSources.id, sourceVersion: schema.knowledgeChunks.sourceVersion, chunkId: schema.knowledgeChunks.id, label: schema.knowledgeSources.label, type: schema.knowledgeSources.type, url: schema.knowledgeSources.canonicalUrl, excerpt: schema.knowledgeChunks.content, score }).from(schema.knowledgeChunks).innerJoin(schema.knowledgeSources, eq(schema.knowledgeChunks.sourceId, schema.knowledgeSources.id)).where(and(eq(schema.knowledgeChunks.businessId, context.businessId), eq(schema.knowledgeSources.businessId, context.businessId), eq(schema.knowledgeSources.status, "READY"), eq(schema.knowledgeSources.enabled, true), eq(schema.knowledgeChunks.sourceVersion, schema.knowledgeSources.version), or(isNull(schema.knowledgeSources.retentionUntil), gt(schema.knowledgeSources.retentionUntil, new Date())), sql`to_tsvector('simple', ${schema.knowledgeChunks.content}) @@ plainto_tsquery('simple', ${query})`, ...(filter.sourceIds?.length ? [inArray(schema.knowledgeSources.id, filter.sourceIds)] : []), ...(filter.types?.length ? [inArray(schema.knowledgeSources.type, filter.types)] : []))).orderBy(desc(score)).limit(Math.min(filter.limit ?? 5, 20));
    return rows.map((row) => ({ sourceId: row.sourceId, sourceVersion: row.sourceVersion, chunkId: row.chunkId, label: row.label, type: row.type as KnowledgeSource["type"], ...(row.url ? { url: row.url } : {}), excerpt: row.excerpt.slice(0, 700), score: Number(row.score) }));
  }
}

/** Durable operations used by both dashboard apps; route actions only authenticate and pass trusted scope. */
export class PostgresPhase4Operations {
  constructor(private readonly db: Db, private readonly parser: KnowledgeParser = new DefaultKnowledgeParser()) {}
  private require(context: TrustedBusinessContext, capability: string) { if (!context.capabilityGrants.includes(capability)) throw new Error("FORBIDDEN"); }
  private audit(tx: Db, context: TrustedBusinessContext, action: string, targetType: string, targetId: string, safeMetadata: Record<string, unknown> = {}) { return tx.insert(schema.auditLogs).values({ id: ulid(), businessId: context.businessId, actorId: actorId(context), action, targetType, targetId, safeMetadata }); }
  async createKnowledge(context: TrustedBusinessContext, unsafe: unknown, bytes: Uint8Array) {
    this.require(context, "knowledge.manage");
    const input = sourceInputSchema.parse(unsafe);
    if (input.type === "LIVE_DESCRIPTOR") {
      if (!input.url) throw new Error("DESCRIPTOR_URL_REQUIRED");
      const url = new URL(input.url);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("DESCRIPTOR_URL_INVALID");
    } else if (!bytes.length || bytes.length > 10_000_000) throw new Error("SOURCE_SIZE_INVALID");
    const id = ulid();
    if (input.type === "LIVE_DESCRIPTOR") {
      await this.db.transaction(async (tx) => {
        await tx.insert(schema.knowledgeSources).values({ id, businessId: context.businessId, type: input.type, label: input.label, canonicalUrl: input.url!, status: "READY", enabled: true, version: 1, checksum: createHash("sha256").update(input.url!).digest("hex"), sizeBytes: 0, retentionUntil: input.retentionUntil ? new Date(input.retentionUntil) : null });
        await this.audit(tx as Db, context, "knowledge.created", "knowledge_source", id, { type: input.type, version: 1 });
      });
      return id;
    }
    await this.db.insert(schema.knowledgeSources).values({ id, businessId: context.businessId, type: input.type, label: input.label, canonicalUrl: input.url ?? null, status: "UPLOADED", enabled: true, version: 1, sizeBytes: bytes.length, retentionUntil: input.retentionUntil ? new Date(input.retentionUntil) : null });
    await this.db.update(schema.knowledgeSources).set({ status: "PROCESSING", updatedAt: new Date() }).where(and(eq(schema.knowledgeSources.id, id), eq(schema.knowledgeSources.businessId, context.businessId)));
    try {
      const content = sanitizeKnowledgeText(await this.parser.parse(input.type, bytes));
      const chunks = chunkKnowledgeText(content); if (!chunks.length) throw new Error("EMPTY_SOURCE");
      const checksum = createHash("sha256").update(bytes).digest("hex");
      await this.db.transaction(async (tx) => {
        await tx.insert(schema.knowledgeChunks).values(chunks.map((chunk, ordinal) => ({ id: ulid(), businessId: context.businessId, sourceId: id, sourceVersion: 1, ordinal, content: chunk, metadata: {} })));
        await tx.update(schema.knowledgeSources).set({ status: "READY", checksum, updatedAt: new Date() }).where(and(eq(schema.knowledgeSources.id, id), eq(schema.knowledgeSources.businessId, context.businessId)));
        await this.audit(tx as Db, context, "knowledge.created", "knowledge_source", id, { type: input.type, version: 1 });
      });
    } catch (error) {
      const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "SOURCE_PARSE_FAILED";
      await this.db.update(schema.knowledgeSources).set({ status: "FAILED", errorCode: code, updatedAt: new Date() }).where(and(eq(schema.knowledgeSources.id, id), eq(schema.knowledgeSources.businessId, context.businessId)));
      await this.audit(this.db, context, "knowledge.processing_failed", "knowledge_source", id, { code });
    }
    return id;
  }
  async replaceKnowledge(context: TrustedBusinessContext, id: string, bytes: Uint8Array) {
    this.require(context, "knowledge.manage");
    if (!bytes.length || bytes.length > 10_000_000) throw new Error("SOURCE_SIZE_INVALID");
    const source = (await this.db.select().from(schema.knowledgeSources).where(and(eq(schema.knowledgeSources.id, id), eq(schema.knowledgeSources.businessId, context.businessId))).limit(1))[0];
    if (!source || source.status === "DELETED") throw new Error("KNOWLEDGE_NOT_FOUND");
    if (source.type === "LIVE_DESCRIPTOR") throw new Error("DESCRIPTOR_REPLACEMENT_UNSUPPORTED");
    await this.db.update(schema.knowledgeSources).set({ status: "PROCESSING", errorCode: null, updatedAt: new Date() }).where(and(eq(schema.knowledgeSources.id, id), eq(schema.knowledgeSources.businessId, context.businessId)));
    try {
      const content = sanitizeKnowledgeText(await this.parser.parse(source.type as KnowledgeSource["type"], bytes));
      const chunks = chunkKnowledgeText(content); if (!chunks.length) throw new Error("EMPTY_SOURCE");
      const checksum = createHash("sha256").update(bytes).digest("hex"); const version = source.version + 1;
      await this.db.transaction(async (tx) => {
        const updated = await tx.update(schema.knowledgeSources).set({ status: "READY", enabled: true, version, checksum, sizeBytes: bytes.length, errorCode: null, updatedAt: new Date() }).where(and(eq(schema.knowledgeSources.id, id), eq(schema.knowledgeSources.businessId, context.businessId), eq(schema.knowledgeSources.version, source.version))).returning({ id: schema.knowledgeSources.id });
        if (!updated.length) throw new Error("CONCURRENT_SOURCE_UPDATE");
        await tx.insert(schema.knowledgeChunks).values(chunks.map((chunk, ordinal) => ({ id: ulid(), businessId: context.businessId, sourceId: id, sourceVersion: version, ordinal, content: chunk, metadata: {} })));
        await this.audit(tx as Db, context, "knowledge.replaced", "knowledge_source", id, { version });
      });
      return version;
    } catch (error) {
      const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "SOURCE_PARSE_FAILED";
      await this.db.update(schema.knowledgeSources).set({ status: "FAILED", errorCode: code, updatedAt: new Date() }).where(and(eq(schema.knowledgeSources.id, id), eq(schema.knowledgeSources.businessId, context.businessId), eq(schema.knowledgeSources.version, source.version)));
      await this.audit(this.db, context, "knowledge.processing_failed", "knowledge_source", id, { code });
      throw error;
    }
  }
  async setKnowledgeEnabled(context: TrustedBusinessContext, id: string, enabled: boolean) {
    this.require(context, "knowledge.manage");
    await this.db.transaction(async (tx) => {
      const source = (await tx.select().from(schema.knowledgeSources).where(and(eq(schema.knowledgeSources.id, id), eq(schema.knowledgeSources.businessId, context.businessId))).limit(1))[0];
      if (!source || source.status === "DELETED") throw new Error("KNOWLEDGE_NOT_FOUND");
      if (enabled && !["READY", "DISABLED"].includes(source.status)) throw new Error("KNOWLEDGE_NOT_READY");
      const status = enabled ? "READY" : source.status === "READY" ? "DISABLED" : source.status;
      await tx.update(schema.knowledgeSources).set({ enabled, status, updatedAt: new Date() }).where(and(eq(schema.knowledgeSources.id, id), eq(schema.knowledgeSources.businessId, context.businessId)));
      await this.audit(tx as Db, context, "knowledge.enablement_changed", "knowledge_source", id, { enabled });
    });
  }
  async deleteKnowledge(context: TrustedBusinessContext, id: string) {
    this.require(context, "knowledge.manage");
    await this.db.transaction(async (tx) => {
      const updated = await tx.update(schema.knowledgeSources).set({ enabled: false, status: "DELETED", deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(schema.knowledgeSources.id, id), eq(schema.knowledgeSources.businessId, context.businessId))).returning({ id: schema.knowledgeSources.id });
      if (!updated.length) throw new Error("KNOWLEDGE_NOT_FOUND");
      await tx.delete(schema.knowledgeChunks).where(and(eq(schema.knowledgeChunks.businessId, context.businessId), eq(schema.knowledgeChunks.sourceId, id)));
      await this.audit(tx as Db, context, "knowledge.deleted", "knowledge_source", id);
    });
  }
  async saveOrderPolicy(context: TrustedBusinessContext, unsafe: unknown) { this.require(context, "order_policy.manage"); const config: OrderPolicy = orderPolicySchema.parse(unsafe); await this.db.transaction(async (tx) => { await tx.insert(schema.orderPolicies).values({ id: ulid(), businessId: context.businessId, config, updatedBy: actorId(context) }).onConflictDoUpdate({ target: schema.orderPolicies.businessId, set: { config, updatedBy: actorId(context), revision: sql`${schema.orderPolicies.revision} + 1`, updatedAt: new Date() } }); await this.audit(tx as Db, context, "order.policy_updated", "order_policy", context.businessId); }); return config; }
  async updateOrderStatus(context: TrustedBusinessContext, id: string, unsafeStatus: unknown, idempotencyKey: string) { this.require(context, "commerce.manage"); const status = orderStatusSchema.parse(unsafeStatus); z.string().min(1).max(200).parse(idempotencyKey); return this.db.transaction(async (tx) => { const order = (await tx.select().from(schema.orders).where(and(eq(schema.orders.id, id), eq(schema.orders.businessId, context.businessId))).limit(1))[0]; if (!order) throw new Error("ORDER_NOT_FOUND"); const priorAudit = (await tx.select({ id: schema.orderAudits.id }).from(schema.orderAudits).where(and(eq(schema.orderAudits.businessId, context.businessId), eq(schema.orderAudits.orderId, id), eq(schema.orderAudits.idempotencyKey, idempotencyKey))).limit(1))[0]; if (priorAudit) return order.status; const policyRow = (await tx.select({ config: schema.orderPolicies.config }).from(schema.orderPolicies).where(eq(schema.orderPolicies.businessId, context.businessId)).limit(1))[0]; const policy = policyRow ? orderPolicySchema.parse(policyRow.config) : null; if (!statusTransitions[order.status]?.includes(status) || !policy?.allowedStatuses.includes(status)) throw new Error("INVALID_ORDER_TRANSITION"); const updated = await tx.update(schema.orders).set({ status, updatedAt: new Date() }).where(and(eq(schema.orders.id, id), eq(schema.orders.businessId, context.businessId), eq(schema.orders.status, order.status))).returning({ id: schema.orders.id }); if (!updated.length) throw new Error("CONCURRENT_ORDER_UPDATE"); await tx.insert(schema.orderAudits).values({ id: ulid(), businessId: context.businessId, orderId: id, actorId: actorId(context), action: "order.status_updated", idempotencyKey, safeMetadata: { from: order.status, to: status } }); await this.audit(tx as Db, context, "order.status_updated", "order", id, { from: order.status, to: status }); return status; }); }
  async addOrderNote(context: TrustedBusinessContext, id: string, unsafeContent: unknown, idempotencyKey: string) { this.require(context, "commerce.manage"); const content = z.string().min(1).max(2000).parse(unsafeContent); z.string().min(1).max(200).parse(idempotencyKey); return this.db.transaction(async (tx) => { const order = (await tx.select({ id: schema.orders.id }).from(schema.orders).where(and(eq(schema.orders.id, id), eq(schema.orders.businessId, context.businessId))).limit(1))[0]; if (!order) throw new Error("ORDER_NOT_FOUND"); const previous = (await tx.select({ safeMetadata: schema.orderAudits.safeMetadata }).from(schema.orderAudits).where(and(eq(schema.orderAudits.businessId, context.businessId), eq(schema.orderAudits.orderId, id), eq(schema.orderAudits.idempotencyKey, idempotencyKey))).limit(1))[0]; if (previous) return (previous.safeMetadata as { noteId: string }).noteId; const noteId = ulid(); await tx.insert(schema.orderNotes).values({ id: noteId, businessId: context.businessId, orderId: id, actorId: actorId(context), content }); await tx.insert(schema.orderAudits).values({ id: ulid(), businessId: context.businessId, orderId: id, actorId: actorId(context), action: "order.note_added", idempotencyKey, safeMetadata: { noteId } }); await this.audit(tx as Db, context, "order.note_added", "order", id); return noteId; }); }
  async saveCustomTool(context: TrustedBusinessContext, unsafe: unknown) { this.require(context, "custom_tool.manage"); const input = customToolSchema.omit({ id: true, businessId: true, testState: true, createdAt: true, updatedAt: true }).parse(unsafe); assertSafeToolConfiguration(input); if (input.credentialRef) { const ref = (await this.db.select({ id: schema.credentialReferences.id }).from(schema.credentialReferences).where(and(eq(schema.credentialReferences.id, input.credentialRef), eq(schema.credentialReferences.businessId, context.businessId))).limit(1))[0]; if (!ref) throw new Error("CREDENTIAL_REF_NOT_FOUND"); } const id = ulid(); await this.db.transaction(async (tx) => { await tx.insert(schema.customTools).values({ id, businessId: context.businessId, name: input.name, description: input.description, type: input.type, method: input.method, baseUrl: input.baseUrl, pathTemplate: input.pathTemplate, inputSchema: input.inputSchema, outputSchema: input.outputSchema, outputMapping: input.outputMapping, safeHeaders: input.safeHeaders, credentialRefId: input.credentialRef, allowedHosts: input.allowedHosts, allowedAgentIds: input.allowedAgentIds, requiredCapabilities: input.requiredCapabilities, safetyClass: input.safetyClass, enabled: input.enabled, testState: "UNTESTED", timeoutMs: input.timeoutMs, maxRequestBytes: input.maxRequestBytes, maxResponseBytes: input.maxResponseBytes }); await this.audit(tx as Db, context, "custom_tool.created", "custom_tool", id, { safetyClass: input.safetyClass }); }); return id; }
  async listCustomToolDefinitions(context: TrustedBusinessContext) {
    if (!context.capabilityGrants.includes("custom_tool.manage") && !context.capabilityGrants.includes("custom_tool.execute")) throw new Error("FORBIDDEN");
    const rows = await this.db.select().from(schema.customTools).where(eq(schema.customTools.businessId, context.businessId));
    return rows.map((row) => customToolSchema.parse({ ...row, credentialRef: row.credentialRefId, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }));
  }

  private goalFromRow(row: typeof schema.pendingGoals.$inferSelect): PendingGoal { return goalSchema.parse({ id: row.id, businessId: row.businessId, customerId: row.customerId, conversationId: row.conversationId, createdBy: row.createdBy, type: row.type, description: row.description, triggerType: row.triggerType, trigger: row.trigger, state: row.state, expiresAt: row.expiresAt?.toISOString() ?? null, idempotencyKey: row.idempotencyKey, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }); }
  async markGoal(context: TrustedBusinessContext, unsafe: unknown) {
    this.require(context, "pending_goal.manage"); if (!context.conversationId) throw new Error("CONVERSATION_REQUIRED");
    const input = goalSchema.pick({ type: true, description: true, triggerType: true, trigger: true, idempotencyKey: true }).extend({ expiresAt: z.iso.datetime({ offset: true }).optional() }).parse(unsafe);
    const id = ulid();
    return this.db.transaction(async (tx) => {
      const inserted = await tx.insert(schema.pendingGoals).values({ id, businessId: context.businessId, customerId: context.customerId ?? null, conversationId: context.conversationId!, type: input.type, description: input.description, state: "PENDING", triggerType: input.triggerType, trigger: input.trigger, createdBy: actorId(context), expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, idempotencyKey: input.idempotencyKey, traceId: context.traceId }).onConflictDoNothing({ target: [schema.pendingGoals.businessId, schema.pendingGoals.idempotencyKey] }).returning();
      const row = inserted[0] ?? (await tx.select().from(schema.pendingGoals).where(and(eq(schema.pendingGoals.businessId, context.businessId), eq(schema.pendingGoals.idempotencyKey, input.idempotencyKey))).limit(1))[0];
      if (!row || row.conversationId !== context.conversationId) throw new Error("GOAL_SCOPE_CONFLICT");
      if (inserted.length) await this.audit(tx as Db, context, "goal.created", "pending_goal", row.id, { triggerType: input.triggerType });
      return this.goalFromRow(row);
    });
  }
  async listGoals(context: TrustedBusinessContext) {
    this.require(context, "conversation.read");
    await this.db.update(schema.pendingGoals).set({ state: "EXPIRED", updatedAt: new Date() }).where(and(eq(schema.pendingGoals.businessId, context.businessId), ...(context.conversationId ? [eq(schema.pendingGoals.conversationId, context.conversationId)] : []), eq(schema.pendingGoals.state, "PENDING"), sql`${schema.pendingGoals.expiresAt} <= now()`));
    const rows = await this.db.select().from(schema.pendingGoals).where(and(eq(schema.pendingGoals.businessId, context.businessId), ...(context.conversationId ? [eq(schema.pendingGoals.conversationId, context.conversationId)] : []))).orderBy(desc(schema.pendingGoals.createdAt)).limit(100);
    return rows.map((row) => this.goalFromRow(row));
  }
  async resolveGoal(context: TrustedBusinessContext, id: string) {
    this.require(context, "pending_goal.manage"); if (!context.conversationId) throw new Error("CONVERSATION_REQUIRED");
    const updated = await this.db.update(schema.pendingGoals).set({ state: "RESOLVED", updatedAt: new Date() }).where(and(eq(schema.pendingGoals.id, id), eq(schema.pendingGoals.businessId, context.businessId), eq(schema.pendingGoals.conversationId, context.conversationId), eq(schema.pendingGoals.state, "PENDING"), or(isNull(schema.pendingGoals.expiresAt), gt(schema.pendingGoals.expiresAt, new Date())))).returning();
    if (!updated[0]) throw new Error("GOAL_NOT_PENDING");
    await this.audit(this.db, context, "goal.resolved", "pending_goal", id);
    return this.goalFromRow(updated[0]);
  }
}

export class PostgresGoalContextReader {
  constructor(private readonly operations: PostgresPhase4Operations) {}
  list(context: TrustedBusinessContext) { return this.operations.listGoals(context); }
}
