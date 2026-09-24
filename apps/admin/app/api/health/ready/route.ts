import { apiReadiness } from "../../../../lib/health";

export const dynamic = "force-dynamic";
export async function GET() {
  const status = await apiReadiness();
  return Response.json({ ready: status.ready }, { status: status.ready ? 200 : 503, headers: { "cache-control": "no-store" } });
}
