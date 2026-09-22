import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ulid } from "ulid";
import { credentialReferences, credentialSecrets } from "@agentos/database";
import type { TrustedBusinessContext } from "@agentos/shared";

/** The database stores a general credential reference plus AES-256-GCM ciphertext. */
export class PostgresCredentialVault {
  constructor(private readonly db: NodePgDatabase, private readonly key: Buffer, private readonly keyVersion: string) {
    if (key.length !== 32 || !/^[a-zA-Z0-9._-]{1,40}$/.test(keyVersion)) throw new Error("CREDENTIAL_KEY_INVALID");
  }
  static fromEnvironment(db: NodePgDatabase) {
    const raw = process.env.CREDENTIAL_ENCRYPTION_KEY ?? "";
    if (!/^[a-f0-9]{64}$/i.test(raw)) throw new Error("CREDENTIAL_ENCRYPTION_KEY_REQUIRED");
    return new PostgresCredentialVault(db, Buffer.from(raw, "hex"), process.env.CREDENTIAL_KEY_VERSION ?? "v1");
  }
  async write(context: TrustedBusinessContext, kind: string, secret: string, existingId?: string) {
    if (!(context.capabilityGrants.includes("channel.manage") || context.source === "verified_adapter" && kind === "meta_attachment_url") || !secret || secret.length > 10_000) throw new Error("CREDENTIAL_DENIED");
    const id = existingId ?? ulid();
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(`${context.businessId}:${id}:${kind}`));
    const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    const data = { ciphertext: ciphertext.toString("base64"), nonce: nonce.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), keyVersion: this.keyVersion, updatedAt: new Date() };
    await this.db.transaction(async (tx) => {
      if (existingId) {
        const prior = await tx.select({ id: credentialReferences.id }).from(credentialReferences).where(and(eq(credentialReferences.id, id), eq(credentialReferences.businessId, context.businessId), eq(credentialReferences.kind, kind))).limit(1);
        if (!prior.length) throw new Error("CREDENTIAL_NOT_FOUND");
        await tx.update(credentialReferences).set({ status: "ACTIVE", updatedAt: new Date() }).where(eq(credentialReferences.id, id));
        await tx.update(credentialSecrets).set(data).where(and(eq(credentialSecrets.referenceId, id), eq(credentialSecrets.businessId, context.businessId)));
      } else {
        await tx.insert(credentialReferences).values({ id, businessId: context.businessId, kind, vaultKey: `encrypted:${id}`, status: "ACTIVE" });
        await tx.insert(credentialSecrets).values({ referenceId: id, businessId: context.businessId, ...data });
      }
    });
    return { id, kind, present: true };
  }
  /** Restricted server-side point-of-use read. Never return this from an API. */
  async resolve(context: TrustedBusinessContext, id: string, kind: string) {
    if (!(["verified_adapter", "internal_system"].includes(context.source))) throw new Error("CREDENTIAL_DENIED");
    const row = (await this.db.select({ reference: credentialReferences, secret: credentialSecrets }).from(credentialReferences).innerJoin(credentialSecrets, eq(credentialSecrets.referenceId, credentialReferences.id)).where(and(eq(credentialReferences.id, id), eq(credentialReferences.businessId, context.businessId), eq(credentialReferences.kind, kind), eq(credentialReferences.status, "ACTIVE"), eq(credentialSecrets.businessId, context.businessId))).limit(1))[0];
    if (!row || row.secret.keyVersion !== this.keyVersion) throw new Error("CREDENTIAL_UNAVAILABLE");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(row.secret.nonce, "base64"));
    decipher.setAAD(Buffer.from(`${context.businessId}:${id}:${kind}`));
    decipher.setAuthTag(Buffer.from(row.secret.authTag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(row.secret.ciphertext, "base64")), decipher.final()]).toString("utf8");
  }
  async revoke(context: TrustedBusinessContext, id: string, kind: string) {
    if (!(context.capabilityGrants.includes("channel.manage") || context.source === "internal_system" && kind === "meta_attachment_url")) throw new Error("CREDENTIAL_DENIED");
    await this.db.transaction(async (tx) => {
      const row = (await tx.update(credentialReferences).set({ status: "REVOKED", updatedAt: new Date() }).where(and(eq(credentialReferences.id, id), eq(credentialReferences.businessId, context.businessId), eq(credentialReferences.kind, kind))).returning({ id: credentialReferences.id }))[0];
      if (!row) throw new Error("CREDENTIAL_NOT_FOUND");
      await tx.delete(credentialSecrets).where(and(eq(credentialSecrets.referenceId, id), eq(credentialSecrets.businessId, context.businessId)));
    });
  }
}
