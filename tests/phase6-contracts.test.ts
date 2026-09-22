import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { flattenMetaNotifications, verifyMetaChallenge, verifyMetaSignature } from "@agentos/channels";

describe("Phase 6 Messenger boundary", () => {
  const secret = "meta-test-app-secret";
  const payload = new TextEncoder().encode(JSON.stringify({ object: "page", entry: [{ id: "123456789", messaging: [{ sender: { id: "sender-1" }, recipient: { id: "123456789" }, timestamp: 1_780_000_000_000, message: { mid: "mid-1", text: "Hi", reply_to: { mid: "older-mid" }, attachments: [{ type: "image", payload: { url: "https://example.com/image.jpg" } }] } }] }] }));
  test("requires a valid SHA-256 signature over exact raw bytes", () => {
    const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
    expect(verifyMetaSignature(payload, signature, secret)).toBe(true);
    expect(verifyMetaSignature(payload, signature, "other-secret")).toBe(false);
    expect(verifyMetaSignature(new Uint8Array([...payload, 32]), signature, secret)).toBe(false);
    expect(verifyMetaSignature(payload, null, secret)).toBe(false);
    expect(verifyMetaSignature(payload, "sha1=abc", secret)).toBe(false);
  });
  test("validates the challenge and bounds the envelope", () => {
    const url = new URL("https://agentos.example/api/webhooks/meta/messenger?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=challenge-123");
    expect(verifyMetaChallenge(url, "verify-me")).toBe("challenge-123");
    expect(verifyMetaChallenge(url, "wrong")).toBeNull();
    expect(flattenMetaNotifications(payload)[0]?.notification.message?.reply_to?.mid).toBe("older-mid");
    expect(() => flattenMetaNotifications(new TextEncoder().encode('{"object":"user","entry":[]}'))).toThrow();
  });
});
