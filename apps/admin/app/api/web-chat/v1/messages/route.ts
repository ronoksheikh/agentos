import { ulid } from "ulid";
import { InboundGateway, Phase5Store } from "@agentos/phase5";
import { createTrustedBusinessContext } from "@agentos/shared";
import { WebChatAdapter } from "@agentos/website-sdk";
import { database } from "../../../../../lib/server";
import { assertSessionSite, siteCors, webChatError, webChatService } from "../../../../../lib/web-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const token = (request: Request) => { const authorization = request.headers.get("authorization") ?? ""; if (!authorization.startsWith("Bearer ")) throw new Error("VISITOR_SESSION_INVALID"); return authorization.slice(7); };

export async function OPTIONS(request: Request) { const cors = await siteCors(request); return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} }); }
export async function GET(request: Request) {
  const cors = await siteCors(request); if (!cors) return new Response(null, { status: 403 });
  try {
    const service = webChatService(); const sessionToken = token(request); const session = await service.authenticate(sessionToken, request.headers.get("origin") ?? ""); await assertSessionSite(request, session.siteId);
    const result = await service.poll(sessionToken, request.headers.get("origin") ?? "", new URL(request.url).searchParams.get("after") ?? undefined);
    return Response.json(result, { headers: { ...cors, "cache-control": "no-store" } });
  } catch (error) { return webChatError(error, cors); }
}
export async function POST(request: Request) {
  const cors = await siteCors(request); if (!cors) return new Response(null, { status: 403 });
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 32_768) throw new Error("BODY_TOO_LARGE");
    const body = new Uint8Array(await request.arrayBuffer()); if (body.byteLength > 32_768) throw new Error("BODY_TOO_LARGE");
    const service = webChatService(); const session = await service.authenticate(token(request), request.headers.get("origin") ?? "", true); await assertSessionSite(request, session.siteId);
    const { conversationId, customerId } = await service.ensureConversation(session);
    const context = createTrustedBusinessContext({ businessId: session.businessId, principal: { kind: "adapter", connectionId: session.siteId }, source: "verified_adapter", agentId: session.agentId, conversationId, customerId, traceId: ulid(), capabilityGrants: ["conversation.read", "handoff.request"] });
    const result = await new InboundGateway(new Phase5Store(database)).accept(new WebChatAdapter(service), { headers: request.headers, body }, context);
    return Response.json({ accepted: result.acknowledged, duplicate: result.duplicate }, { status: 202, headers: { ...cors, "cache-control": "no-store" } });
  } catch (error) { return webChatError(error, cors); }
}
