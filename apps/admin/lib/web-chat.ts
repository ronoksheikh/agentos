import { and, eq } from "drizzle-orm";
import { websiteSites } from "@agentos/database";
import { PostgresWebChatService } from "@agentos/website-sdk";
import { ZodError } from "zod";
import { database } from "./server";

export function webChatService() { const secret = process.env.VISITOR_SESSION_SECRET; if (!secret) throw new Error("VISITOR_SESSION_SECRET_REQUIRED"); return new PostgresWebChatService(database, secret); }
export async function siteCors(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  const publicKey = new URL(request.url).searchParams.get("site") ?? "";
  if (!origin || !publicKey) return null;
  const site = (await database.select({ enabled: websiteSites.enabled, origins: websiteSites.allowedOrigins }).from(websiteSites).where(eq(websiteSites.publicKey, publicKey)).limit(1))[0];
  if (!site?.enabled || !site.origins.includes(origin)) return null;
  return { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, POST, DELETE, OPTIONS", "access-control-allow-headers": "authorization, content-type", "access-control-max-age": "600", vary: "Origin" };
}
export async function assertSessionSite(request: Request, siteId: string) {
  const publicKey = new URL(request.url).searchParams.get("site") ?? "";
  const row = (await database.select({ id: websiteSites.id }).from(websiteSites).where(and(eq(websiteSites.id, siteId), eq(websiteSites.publicKey, publicKey))).limit(1))[0];
  if (!row) throw new Error("SITE_NOT_ALLOWED");
}
export function webChatError(error: unknown, cors: Record<string, string>) {
  const code = error instanceof ZodError || error instanceof SyntaxError ? "VALIDATION_ERROR" : error instanceof Error ? error.message : "INTERNAL_ERROR";
  const status = code === "RATE_LIMITED" ? 429 : code === "VISITOR_SESSION_INVALID" || code === "VISITOR_SESSION_REVOKED" ? 401 : code === "SITE_NOT_ALLOWED" || code === "TRUSTED_SCOPE_MISMATCH" ? 403 : code === "VALIDATION_ERROR" || code.startsWith("INVALID_") || code === "BODY_TOO_LARGE" ? 400 : 500;
  return Response.json({ error: status === 500 ? "SERVICE_UNAVAILABLE" : code }, { status, headers: { ...cors, "cache-control": "no-store" } });
}
