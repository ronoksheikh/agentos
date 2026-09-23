import { assertSessionSite, siteCors, webChatError, webChatService } from "../../../../../lib/web-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const token = (request: Request) => { const value = request.headers.get("authorization") ?? ""; if (!value.startsWith("Bearer ")) throw new Error("VISITOR_SESSION_INVALID"); return value.slice(7); };

export async function OPTIONS(request: Request) { const cors = await siteCors(request); return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} }); }
export async function GET(request: Request) {
  const cors = await siteCors(request); if (!cors) return new Response(null, { status: 403 });
  try { const session = await webChatService().authenticate(token(request), request.headers.get("origin") ?? "", true); await assertSessionSite(request, session.siteId); return Response.json({ active: true, expiresAt: session.expiresAt }, { headers: { ...cors, "cache-control": "no-store" } }); }
  catch (error) { return webChatError(error, cors); }
}
export async function DELETE(request: Request) {
  const cors = await siteCors(request); if (!cors) return new Response(null, { status: 403 });
  try { const service = webChatService(); const sessionToken = token(request); const session = await service.authenticate(sessionToken, request.headers.get("origin") ?? ""); await assertSessionSite(request, session.siteId); await service.revoke(sessionToken, request.headers.get("origin") ?? ""); return new Response(null, { status: 204, headers: cors }); }
  catch (error) { return webChatError(error, cors); }
}
