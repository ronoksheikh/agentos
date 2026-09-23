import { z } from "zod";
import { siteCors, webChatError, webChatService } from "../../../../../lib/web-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const bodySchema = z.object({ publicKey: z.string().min(1).max(100), sdkVersion: z.string(), visitorId: z.string().optional() }).strict();

export async function OPTIONS(request: Request) { const cors = await siteCors(request); return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} }); }
export async function POST(request: Request) {
  const cors = await siteCors(request); if (!cors) return new Response(null, { status: 403 });
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 4_096) throw new Error("BODY_TOO_LARGE");
    const body = await request.text(); if (body.length > 4_096) throw new Error("BODY_TOO_LARGE");
    const input = bodySchema.parse(JSON.parse(body));
    if (input.publicKey !== new URL(request.url).searchParams.get("site")) throw new Error("SITE_NOT_ALLOWED");
    const result = await webChatService().bootstrap({ publicKey: input.publicKey, sdkVersion: input.sdkVersion, ...(input.visitorId ? { visitorId: input.visitorId } : {}), origin: request.headers.get("origin") ?? "" });
    return Response.json(result, { headers: { ...cors, "cache-control": "no-store" } });
  } catch (error) { return webChatError(error, cors); }
}
