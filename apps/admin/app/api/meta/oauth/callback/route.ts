import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { metaOauthStates } from "@agentos/database";
import { database } from "../../../../../lib/server";
import { agencyMetaContext, metaServices } from "../../../../../lib/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!state || !code) return new Response("OAuth authorization incomplete", { status: 400 });
  const stateHash = createHash("sha256").update(state).digest("hex");
  const row = (await database.select({ businessId: metaOauthStates.businessId }).from(metaOauthStates).where(eq(metaOauthStates.stateHash, stateHash)).limit(1))[0];
  if (!row) return new Response("OAuth state invalid", { status: 400 });
  const trusted = await agencyMetaContext(row.businessId);
  const base = new URL(`/businesses/${row.businessId}/messenger`, url.origin);
  try {
    const result = await metaServices().connections.finishOAuth(trusted, state, code);
    base.searchParams.set("oauthState", result.stateId);
  } catch { base.searchParams.set("status", "oauth-error"); }
  return Response.redirect(base, 303);
}
