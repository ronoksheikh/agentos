import { metaServices } from "../../../../../lib/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return metaServices().webhook.handshake(new URL(request.url));
}

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 1_000_000) return new Response("Payload too large", { status: 413 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > 1_000_000) return new Response("Payload too large", { status: 413 });
  return metaServices().webhook.receive(request.headers, bytes);
}
