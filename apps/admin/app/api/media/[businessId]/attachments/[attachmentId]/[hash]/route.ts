import { and, eq } from "drizzle-orm";
import { FileObjectStorage } from "@agentos/attachments";
import { attachments } from "@agentos/database";
import { database } from "../../../../../../../lib/server";

export const runtime = "nodejs";
const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`${name}_REQUIRED`); return value; };
export async function GET(request: Request, { params }: { params: Promise<{ businessId: string; attachmentId: string; hash: string }> }) {
  const { businessId, attachmentId, hash } = await params;
  const key = `${businessId}/attachments/${attachmentId}/${hash}`;
  const row = (await database.select({ status: attachments.status, mimeType: attachments.mimeType, retentionUntil: attachments.retentionUntil, objectKey: attachments.objectKey }).from(attachments).where(and(eq(attachments.businessId, businessId), eq(attachments.id, attachmentId), eq(attachments.objectKey, key))).limit(1))[0];
  if (!row || row.status !== "READY" || row.retentionUntil && row.retentionUntil <= new Date()) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  try {
    const storage = new FileObjectStorage(required("PRIVATE_MEDIA_DIR"), required("PUBLIC_MEDIA_BASE_URL"), required("MEDIA_SIGNING_KEY"));
    const bytes = await storage.readSigned(key, Number(url.searchParams.get("expires")), url.searchParams.get("signature") ?? "");
    return new Response(new Blob([bytes]), { status: 200, headers: { "content-type": row.mimeType, "cache-control": "private, max-age=60", "x-content-type-options": "nosniff" } });
  } catch { return new Response("Forbidden", { status: 403 }); }
}
