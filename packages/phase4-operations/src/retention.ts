import { and, eq, isNull, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ulid } from "ulid";
import * as schema from "@agentos/database";
import type { ObjectStorage } from "@agentos/attachments";

/** Removes content whose explicit expiry has passed, preserving scoped audit metadata. */
export class PostgresExpiredContentRetention {
  constructor(private readonly db: NodePgDatabase, private readonly storage: ObjectStorage) {}

  async sweep(now = new Date(), limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("RETENTION_LIMIT_INVALID");
    let attachments = 0;
    let knowledgeSources = 0;
    const expiredAttachments = await this.db.select({ id: schema.attachments.id, businessId: schema.attachments.businessId, objectKey: schema.attachments.objectKey }).from(schema.attachments)
      .where(and(lte(schema.attachments.retentionUntil, now), sql`${schema.attachments.status} not in ('DOWNLOADING', 'PROCESSING')`)).limit(limit);
    for (const row of expiredAttachments) {
      if (row.objectKey) {
        if (!row.objectKey.startsWith(`${row.businessId}/attachments/${row.id}/`)) throw new Error("RETENTION_OBJECT_SCOPE_INVALID");
        await this.storage.delete(row.objectKey);
      }
      const removed = await this.db.transaction(async (tx) => {
        await tx.delete(schema.attachmentArtifacts).where(and(eq(schema.attachmentArtifacts.businessId, row.businessId), eq(schema.attachmentArtifacts.attachmentId, row.id)));
        const deleted = await tx.delete(schema.attachments).where(and(eq(schema.attachments.businessId, row.businessId), eq(schema.attachments.id, row.id), lte(schema.attachments.retentionUntil, now), sql`${schema.attachments.status} not in ('DOWNLOADING', 'PROCESSING')`)).returning({ id: schema.attachments.id });
        if (deleted.length) await tx.insert(schema.auditLogs).values({ id: ulid(), businessId: row.businessId, actorId: "system:retention", action: "attachment.retention_purged", targetType: "attachment", targetId: row.id, safeMetadata: { hadObject: Boolean(row.objectKey) } });
        return deleted.length;
      });
      attachments += removed;
    }
    const expiredSources = await this.db.select({ id: schema.knowledgeSources.id, businessId: schema.knowledgeSources.businessId }).from(schema.knowledgeSources)
      .where(and(lte(schema.knowledgeSources.retentionUntil, now), isNull(schema.knowledgeSources.deletedAt))).limit(limit);
    for (const row of expiredSources) {
      const changed = await this.db.transaction(async (tx) => {
        const updated = await tx.update(schema.knowledgeSources).set({ status: "DELETED", enabled: false, label: "[expired]", canonicalUrl: null, checksum: null, sizeBytes: 0, deletedAt: now, updatedAt: now }).where(and(eq(schema.knowledgeSources.businessId, row.businessId), eq(schema.knowledgeSources.id, row.id), lte(schema.knowledgeSources.retentionUntil, now), isNull(schema.knowledgeSources.deletedAt))).returning({ id: schema.knowledgeSources.id });
        if (!updated.length) return 0;
        await tx.delete(schema.knowledgeChunks).where(and(eq(schema.knowledgeChunks.businessId, row.businessId), eq(schema.knowledgeChunks.sourceId, row.id)));
        await tx.insert(schema.auditLogs).values({ id: ulid(), businessId: row.businessId, actorId: "system:retention", action: "knowledge.retention_purged", targetType: "knowledge_source", targetId: row.id, safeMetadata: {} });
        return 1;
      });
      knowledgeSources += changed;
    }
    return { attachments, knowledgeSources };
  }
}
