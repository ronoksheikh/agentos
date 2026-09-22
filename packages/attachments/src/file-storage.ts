import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ObjectStorage } from "./index";

const keyPattern = /^[0-9A-HJKMNP-TV-Z]{26}\/attachments\/[0-9A-HJKMNP-TV-Z]{26}\/[a-f0-9]{64}$/i;
export class FileObjectStorage implements ObjectStorage {
  constructor(private readonly root: string, private readonly publicBaseUrl: string, private readonly signingKey: string) {
    if (!root.startsWith("/") || signingKey.length < 32 || new URL(publicBaseUrl).protocol !== "https:") throw new Error("MEDIA_STORAGE_CONFIGURATION_INVALID");
  }
  private path(key: string) { if (!keyPattern.test(key)) throw new Error("OBJECT_SCOPE_INVALID"); return join(this.root, key); }
  private signature(key: string, expires: number) { return createHmac("sha256", this.signingKey).update(`${key}:${expires}`).digest("hex"); }
  async put(key: string, bytes: Uint8Array, _mimeType: string) { const path = this.path(key); await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await writeFile(path, bytes, { mode: 0o600 }); }
  async signedGet(key: string, expiresSeconds: number) { this.path(key); if (expiresSeconds < 1 || expiresSeconds > 300) throw new Error("SIGNED_URL_EXPIRY_INVALID"); const expires = Math.floor(Date.now() / 1000) + expiresSeconds; const url = new URL(`/api/media/${key}`, this.publicBaseUrl); url.searchParams.set("expires", String(expires)); url.searchParams.set("signature", this.signature(key, expires)); return url.toString(); }
  async readSigned(key: string, expires: number, signature: string) { const path = this.path(key); if (!Number.isSafeInteger(expires) || expires < Date.now() / 1000 || expires > Date.now() / 1000 + 300 || !/^[a-f0-9]{64}$/i.test(signature)) throw new Error("MEDIA_SIGNATURE_INVALID"); const expected = Buffer.from(this.signature(key, expires), "hex"); const supplied = Buffer.from(signature, "hex"); if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("MEDIA_SIGNATURE_INVALID"); return readFile(path); }
  async delete(key: string) { await rm(this.path(key), { force: true }); }
}
