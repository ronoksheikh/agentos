import { ulid } from "ulid";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Attachment, AttachmentDownloader, ObjectStorage } from "@agentos/attachments";
import { attachments } from "@agentos/database";
import { assertApprovedUrl, PinnedHttpsTransport, type SafeHttpTransport } from "@agentos/integrations";
import { createTrustedBusinessContext, type TrustedBusinessContext } from "@agentos/shared";
import type { MessengerAssetResolver } from "./adapter";
import { PostgresCredentialVault } from "./secrets";

/** Media download runs only in the attachment queue, after webhook acknowledgement. */
export class MessengerMediaDownloader implements AttachmentDownloader {
  constructor(private readonly vault: PostgresCredentialVault, private readonly allowedHosts: string[], private readonly transport: SafeHttpTransport = new PinnedHttpsTransport()) {}
  async download(source: Attachment, signal: AbortSignal) {
    if (source.source !== "VERIFIED_CHANNEL" || !source.sourceRef) throw new Error("MEDIA_SOURCE_DENIED");
    const context = createTrustedBusinessContext({ businessId: source.businessId, principal: { kind: "system", service: "messenger-media" }, source: "internal_system", ...(source.conversationId ? { conversationId: source.conversationId } : {}), traceId: ulid(), capabilityGrants: [] }, signal);
    const secretUrl = await this.vault.resolve(context, source.sourceRef, "meta_attachment_url");
    const url = assertApprovedUrl(secretUrl, this.allowedHosts);
    const response = await this.transport.send({ url, method: "GET", headers: { accept: "image/*, audio/*, application/pdf, text/plain" }, timeoutMs: 15_000, maxResponseBytes: 15_000_000, signal });
    if (response.status !== 200) throw new Error("MEDIA_DOWNLOAD_FAILED");
    return response.body;
  }
}

export class PostgresMessengerAssetResolver implements MessengerAssetResolver {
  constructor(private readonly db: NodePgDatabase, private readonly storage: ObjectStorage) {}
  async signedUrl(context: TrustedBusinessContext, assetId: string) {
    const row = (await this.db.select({ objectKey: attachments.objectKey, status: attachments.status, retentionUntil: attachments.retentionUntil, kind: attachments.kind }).from(attachments).where(and(eq(attachments.id, assetId), eq(attachments.businessId, context.businessId))).limit(1))[0];
    if (!row || row.status !== "READY" || row.kind !== "IMAGE" || !row.objectKey?.startsWith(`${context.businessId}/attachments/${assetId}/`) || row.retentionUntil && row.retentionUntil <= new Date()) throw new Error("ASSET_UNAVAILABLE");
    return this.storage.signedGet(row.objectKey, 120);
  }
}
