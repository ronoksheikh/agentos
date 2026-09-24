import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "@agentos/database";
import { FileObjectStorage } from "@agentos/attachments";
import { PostgresExpiredContentRetention } from "@agentos/phase4-operations";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.includes("agentos_phase7_retention_")) throw new Error("DISPOSABLE_RETENTION_DATABASE_REQUIRED");
const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool);
const root = await mkdtemp(join(tmpdir(), "agentos-retention-"));
const storage = new FileObjectStorage(root, "https://media.example.invalid", "test-signing-key-abcdefghijklmnopqrstuvwxyz");
const now = new Date("2026-09-24T12:00:00.000Z");
const expired = new Date("2026-09-23T12:00:00.000Z");
const future = new Date("2026-09-25T12:00:00.000Z");

try {
  const businessA = ulid(); const businessB = ulid();
  await db.insert(schema.businesses).values([{ id: businessA, name: "Expired fixture" }, { id: businessB, name: "Active fixture" }]);
  const makeAttachment = async (businessId: string, retentionUntil: Date) => {
    const id = ulid(); const bytes = new TextEncoder().encode(`private:${businessId}`);
    const objectKey = `${businessId}/attachments/${id}/${createHash("sha256").update(bytes).digest("hex")}`;
    await storage.put(objectKey, bytes, "image/png");
    await db.insert(schema.attachments).values({ id, businessId, conversationId: null, source: "INTERNAL_TEST", sourceRef: "fixture", kind: "IMAGE", mimeType: "image/png", sizeBytes: bytes.length, contentHash: objectKey.split("/").at(-1)!, objectKey, status: "READY", retentionUntil });
    await db.insert(schema.attachmentArtifacts).values({ id: ulid(), businessId, attachmentId: id, kind: "VISION_TEXT", content: "sensitive description", provider: "fixture", version: "1", sourceRef: "fixture" });
    return { id, objectKey };
  };
  const oldAttachment = await makeAttachment(businessA, expired);
  const liveAttachment = await makeAttachment(businessB, future);
  const oldSource = ulid(); const liveSource = ulid();
  await db.insert(schema.knowledgeSources).values([{ id: oldSource, businessId: businessA, type: "TEXT", label: "Sensitive old title", status: "READY", retentionUntil: expired }, { id: liveSource, businessId: businessB, type: "TEXT", label: "Current title", status: "READY", retentionUntil: future }]);
  await db.insert(schema.knowledgeChunks).values([{ id: ulid(), businessId: businessA, sourceId: oldSource, sourceVersion: 1, ordinal: 0, content: "sensitive old content" }, { id: ulid(), businessId: businessB, sourceId: liveSource, sourceVersion: 1, ordinal: 0, content: "current content" }]);

  const service = new PostgresExpiredContentRetention(db, storage);
  assert.deepEqual(await service.sweep(now), { attachments: 1, knowledgeSources: 1 });
  assert.deepEqual(await service.sweep(now), { attachments: 0, knowledgeSources: 0 });
  assert.equal((await db.select().from(schema.attachments).where(eq(schema.attachments.id, oldAttachment.id))).length, 0);
  assert.equal((await db.select().from(schema.attachmentArtifacts).where(eq(schema.attachmentArtifacts.attachmentId, oldAttachment.id))).length, 0);
  assert.equal((await db.select().from(schema.attachments).where(eq(schema.attachments.id, liveAttachment.id))).length, 1);
  assert.equal((await db.select().from(schema.knowledgeChunks).where(eq(schema.knowledgeChunks.sourceId, oldSource))).length, 0);
  assert.equal((await db.select().from(schema.knowledgeChunks).where(eq(schema.knowledgeChunks.sourceId, liveSource))).length, 1);
  const oldRow = (await db.select().from(schema.knowledgeSources).where(eq(schema.knowledgeSources.id, oldSource)))[0]!;
  assert.equal(oldRow.status, "DELETED"); assert.equal(oldRow.label, "[expired]"); assert.equal(oldRow.enabled, false);
  assert.equal((await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.businessId, businessA), eq(schema.auditLogs.actorId, "system:retention")))).length, 2);
  await assert.rejects(readFile(join(root, oldAttachment.objectKey)), { code: "ENOENT" });
  assert.equal((await readFile(join(root, liveAttachment.objectKey))).length > 0, true);
  console.log("RETENTION_INTEGRATION_OK");
} finally {
  await pool.end();
  await rm(root, { recursive: true, force: true });
}
