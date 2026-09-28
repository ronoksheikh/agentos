import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as schema from "@agentos/database";
import { FileObjectStorage } from "@agentos/attachments";

const url = process.env.DATABASE_URL;
const media = process.env.PRIVATE_MEDIA_DIR;
if (!url || !new URL(url).pathname.includes("agentos_phase7_offboard") || !media) throw new Error("DISPOSABLE_OFFBOARD_DATABASE_REQUIRED");
const mode = process.argv[2];
const a = "00000000000000000000000000"; const b = "11111111111111111111111111";
const user = "22222222222222222222222222";
const storage = new FileObjectStorage(media, "https://media.example.invalid", "test-signing-key-abcdefghijklmnopqrstuvwxyz");
const pool = new Pool({ connectionString: url }); const db = drizzle(pool);
const attachment = (businessId: string) => {
  const id = businessId === a ? "33333333333333333333333333" : "44444444444444444444444444";
  const bytes = new TextEncoder().encode(`media:${businessId}`);
  return { id, bytes, objectKey: `${businessId}/attachments/${id}/${createHash("sha256").update(bytes).digest("hex")}` };
};
try {
  if (mode === "prepare") {
    await db.insert(schema.businesses).values([{ id: a, name: "Offboard A", state: "CANCELLED", disabled: true }, { id: b, name: "Keep B", state: "ACTIVE" }]);
    await db.insert(schema.users).values({ id: user, name: "Shared operator", email: "offboard-fixture@example.test" });
    await db.insert(schema.businessMemberships).values([{ id: "55555555555555555555555555", businessId: a, userId: user, role: "OWNER" }, { id: "66666666666666666666666666", businessId: b, userId: user, role: "OWNER" }]);
    for (const businessId of [a, b]) {
      const customerId = businessId === a ? "77777777777777777777777777" : "88888888888888888888888888";
      const conversationId = businessId === a ? "99999999999999999999999999" : "AAAAAAAAAAAAAAAAAAAAAAAAAA";
      await db.insert(schema.customers).values({ id: customerId, businessId, displayName: `Customer ${businessId}` });
      await db.insert(schema.conversations).values({ id: conversationId, businessId, customerId, channel: "web_chat" });
      await db.insert(schema.messages).values({ id: businessId === a ? "BBBBBBBBBBBBBBBBBBBBBBBBBB" : "CCCCCCCCCCCCCCCCCCCCCCCCCC", businessId, conversationId, customerId, senderKind: "CUSTOMER", text: "fixture content", occurredAt: new Date(), traceId: "offboard-fixture" });
      const item = attachment(businessId);
      await storage.put(item.objectKey, item.bytes, "image/png");
      await db.insert(schema.attachments).values({ id: item.id, businessId, conversationId, source: "INTERNAL_TEST", sourceRef: "fixture", kind: "IMAGE", mimeType: "image/png", sizeBytes: item.bytes.length, contentHash: item.objectKey.split("/").at(-1)!, objectKey: item.objectKey, status: "READY" });
      await db.insert(schema.attachmentArtifacts).values({ id: businessId === a ? "DDDDDDDDDDDDDDDDDDDDDDDDDD" : "EEEEEEEEEEEEEEEEEEEEEEEEEE", businessId, attachmentId: item.id, kind: "VISION_TEXT", content: "fixture derived text", provider: "fixture", version: "1", sourceRef: "fixture" });
      const sourceId = businessId === a ? "FFFFFFFFFFFFFFFFFFFFFFFFFF" : "GGGGGGGGGGGGGGGGGGGGGGGGGG";
      await db.insert(schema.knowledgeSources).values({ id: sourceId, businessId, type: "TEXT", label: "Fixture", status: "READY" });
      await db.insert(schema.knowledgeChunks).values({ id: businessId === a ? "HHHHHHHHHHHHHHHHHHHHHHHHHH" : "JJJJJJJJJJJJJJJJJJJJJJJJJJ", businessId, sourceId, sourceVersion: 1, ordinal: 0, content: "fixture chunk" });
    }
    console.log("OFFBOARD_FIXTURE_PREPARED");
  } else if (mode === "verify") {
    assert.equal((await db.select().from(schema.businesses).where(eq(schema.businesses.id, a))).length, 0);
    assert.equal((await db.select().from(schema.businesses).where(eq(schema.businesses.id, b))).length, 1);
    assert.equal((await db.select().from(schema.businessMemberships).where(eq(schema.businessMemberships.businessId, a))).length, 0);
    assert.equal((await db.select().from(schema.businessMemberships).where(eq(schema.businessMemberships.businessId, b))).length, 1);
    assert.equal((await db.select().from(schema.users).where(eq(schema.users.id, user))).length, 1);
    assert.equal((await db.select().from(schema.attachments).where(eq(schema.attachments.businessId, a))).length, 0);
    assert.equal((await db.select().from(schema.knowledgeChunks).where(eq(schema.knowledgeChunks.businessId, a))).length, 0);
    assert.equal((await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.targetId, a))).some((row) => row.action === "business.offboarded"), true);
    await assert.rejects(readFile(join(media, attachment(a).objectKey)), { code: "ENOENT" });
    assert.equal((await readFile(join(media, attachment(b).objectKey))).length > 0, true);
    console.log("OFFBOARD_INTEGRATION_OK");
  } else throw new Error("Usage: phase7-offboard-integration.ts prepare|verify");
} finally { await pool.end(); }
