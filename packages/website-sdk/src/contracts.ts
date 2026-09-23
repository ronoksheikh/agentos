import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export { WEB_CHAT_SDK_PROTOCOL_VERSION } from "./protocol";
export const sdkVersionSchema = z.string().regex(/^1\.[0-9]+\.[0-9]+$/);
export const pageContextSchema = z.object({
  url: z.url().max(2_048), title: z.string().trim().max(300).optional(),
  productRef: z.string().trim().max(200).optional(), cartRef: z.string().trim().max(200).optional(), consented: z.boolean().default(false),
}).transform((value) => ({ url: new URL(value.url).origin + new URL(value.url).pathname.slice(0, 1_024), ...(value.title ? { title: value.title } : {}), ...(value.consented && value.productRef ? { productRef: value.productRef } : {}), ...(value.consented && value.cartRef ? { cartRef: value.cartRef } : {}), consented: value.consented }));

export interface WebsiteSiteConfiguration { id: string; businessId: string; agentId: string; publicKey: string; allowedOrigins: string[]; enabled: boolean; sdkMajorVersion: 1; requestsPerMinute: number; createdAt: string }
export interface VerifiedVisitorSession { sessionId: string; businessId: string; agentId: string; siteId: string; visitorId: string; origin: string; expiresAt: string }

const base64url = (input: string) => Buffer.from(input).toString("base64url");
const fromBase64url = (input: string) => Buffer.from(input, "base64url").toString();
export function signVisitorSession(session: VerifiedVisitorSession, secret: string) { const payload = base64url(JSON.stringify(session)); return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`; }
export function parseVisitorSession(token: string, secret: string): VerifiedVisitorSession { if (token.length > 2_048) throw new Error("VISITOR_SESSION_INVALID"); const [payload, signature, extra] = token.split("."); if (!payload || !signature || extra) throw new Error("VISITOR_SESSION_INVALID"); const expected = createHmac("sha256", secret).update(payload).digest(); const actual = Buffer.from(signature, "base64url"); if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("VISITOR_SESSION_INVALID"); try { return z.object({ sessionId: z.string(), businessId: z.string(), agentId: z.string(), siteId: z.string(), visitorId: z.string(), origin: z.string(), expiresAt: z.iso.datetime({ offset: true }) }).parse(JSON.parse(fromBase64url(payload))) as VerifiedVisitorSession; } catch { throw new Error("VISITOR_SESSION_INVALID"); } }
