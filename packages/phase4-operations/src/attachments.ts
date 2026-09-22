import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@agentos/database";
import { attachmentSchema, derivedArtifactSchema, type Attachment, type AttachmentPersistence, type DerivedArtifact } from "@agentos/attachments";
import type { TrustedBusinessContext } from "@agentos/shared";

export class PostgresAttachmentRepository implements AttachmentPersistence {
  constructor(private readonly db: NodePgDatabase) {}
  async save(unsafe: Attachment, unsafeArtifacts: DerivedArtifact[] = []) {
    const record = attachmentSchema.parse(unsafe);
    const artifacts = unsafeArtifacts.map((artifact) => derivedArtifactSchema.parse(artifact));
    if (record.objectKey && !record.objectKey.startsWith(`${record.businessId}/attachments/${record.id}/`) || artifacts.some((artifact) => artifact.businessId !== record.businessId || artifact.attachmentId !== record.id)) throw new Error("ATTACHMENT_SCOPE_INVALID");
    await this.db.transaction(async (tx) => {
      const prior = (await tx.select({ businessId: schema.attachments.businessId }).from(schema.attachments).where(eq(schema.attachments.id, record.id)).limit(1))[0];
      if (prior && prior.businessId !== record.businessId) throw new Error("ATTACHMENT_SCOPE_INVALID");
      const values = { status: record.status, sizeBytes: record.sizeBytes, mimeType: record.mimeType, contentHash: record.contentHash, objectKey: record.objectKey, errorCode: record.errorCode, retentionUntil: record.retentionUntil ? new Date(record.retentionUntil) : null, updatedAt: new Date(record.updatedAt) };
      if (prior) await tx.update(schema.attachments).set(values).where(and(eq(schema.attachments.id, record.id), eq(schema.attachments.businessId, record.businessId)));
      else await tx.insert(schema.attachments).values({ id: record.id, businessId: record.businessId, conversationId: record.conversationId, source: record.source, sourceRef: record.sourceRef, kind: record.kind, ...values, createdAt: new Date(record.createdAt) });
      for (const artifact of artifacts) await tx.insert(schema.attachmentArtifacts).values({ id: artifact.id, businessId: record.businessId, attachmentId: record.id, kind: artifact.kind, content: artifact.content, language: artifact.language, confidence: artifact.confidence, provider: artifact.provider, version: artifact.version, sourceRef: artifact.sourceRef, createdAt: new Date(artifact.createdAt) }).onConflictDoNothing();
    });
  }
  async load(context: TrustedBusinessContext, id: string) {
    const record = (await this.db.select().from(schema.attachments).where(and(eq(schema.attachments.id, id), eq(schema.attachments.businessId, context.businessId))).limit(1))[0];
    if (!record) return null;
    if (context.conversationId && record.conversationId !== context.conversationId) throw new Error("ATTACHMENT_NOT_FOUND");
    const rows = await this.db.select().from(schema.attachmentArtifacts).where(and(eq(schema.attachmentArtifacts.businessId, context.businessId), eq(schema.attachmentArtifacts.attachmentId, id)));
    return { attachment: attachmentSchema.parse({ ...record, retentionUntil: record.retentionUntil?.toISOString() ?? null, createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() }), artifacts: rows.map((row) => derivedArtifactSchema.parse({ ...row, createdAt: row.createdAt.toISOString() })) };
  }
  async delete(context: TrustedBusinessContext, id: string) {
    await this.db.transaction(async (tx) => {
      const record = (await tx.select({ conversationId: schema.attachments.conversationId }).from(schema.attachments).where(and(eq(schema.attachments.id, id), eq(schema.attachments.businessId, context.businessId))).limit(1))[0];
      if (!record || context.conversationId && record.conversationId !== context.conversationId) throw new Error("ATTACHMENT_NOT_FOUND");
      await tx.delete(schema.attachmentArtifacts).where(and(eq(schema.attachmentArtifacts.businessId, context.businessId), eq(schema.attachmentArtifacts.attachmentId, id)));
      await tx.delete(schema.attachments).where(and(eq(schema.attachments.businessId, context.businessId), eq(schema.attachments.id, id)));
    });
  }
}
