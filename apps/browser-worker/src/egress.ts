import { timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createServer, type Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect } from "node:net";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { assertPublicAddress } from "@agentos/integrations";

const token = process.env.BROWSER_EGRESS_TOKEN ?? "";
if (token.length < 24) throw new Error("BROWSER_EGRESS_TOKEN_REQUIRED");
const registrations = new Map<string, { server: Server; port: number; timer: ReturnType<typeof setTimeout> }>();
const inputSchema = z.object({ sessionId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/), domains: z.array(z.string().regex(/^[a-z0-9.-]+$/i)).min(1).max(20).optional(), timeoutMs: z.number().int().min(1000).max(120_000).optional() }).strict();
const authorized = (header: string | undefined) => { const a = Buffer.from(header ?? ""); const b = Buffer.from(`Bearer ${token}`); return a.length === b.length && timingSafeEqual(a, b); };
async function readBody(request: AsyncIterable<Buffer>) { const chunks: Buffer[] = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > 4096) throw new Error("TOO_LARGE"); chunks.push(chunk); } return inputSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
function revoke(id: string) { const registration = registrations.get(id); if (!registration) return; registrations.delete(id); clearTimeout(registration.timer); registration.server.closeAllConnections(); registration.server.close(); }
async function register(id: string, domains: string[], timeoutMs: number) {
  if (registrations.has(id) || registrations.size >= 20) throw new Error("EGRESS_CAPACITY");
  const allowed = new Set(domains.map((value) => value.toLowerCase()));
  const proxy = createServer((_request, response) => { response.writeHead(403); response.end(); });
  proxy.on("connect", async (request, client, head) => {
    const [hostname, port] = (request.url ?? "").split(":");
    if (!hostname || port !== "443" || !allowed.has(hostname.toLowerCase())) { client.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
    try {
      const testHost = process.env.BROWSER_CONTROLLED_TEST_HOST;
      const testIp = process.env.BROWSER_CONTROLLED_TEST_IP;
      const answer = testHost && testIp && hostname === testHost ? { address: testIp, family: 4 } : (await lookup(hostname, { all: true, verbatim: true }))[0];
      if (!answer) throw new Error("DNS_FAILED");
      if (!(testHost && testIp && hostname === testHost)) assertPublicAddress(answer.address);
      const upstream = connect({ host: answer.address, port: testHost && testIp && hostname === testHost ? 8443 : 443, family: answer.family, timeout: 8000 });
      upstream.once("connect", () => { client.write("HTTP/1.1 200 Connection Established\r\n\r\n"); if (head.byteLength) upstream.write(head); client.pipe(upstream); upstream.pipe(client); });
      upstream.once("error", () => client.destroy()); client.once("error", () => upstream.destroy());
    } catch { client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); }
  });
  await new Promise<void>((resolve, reject) => { proxy.once("error", reject); proxy.listen(0, "0.0.0.0", () => resolve()); });
  const address = proxy.address(); if (!address || typeof address === "string") throw new Error("EGRESS_PORT_FAILED");
  registrations.set(id, { server: proxy, port: address.port, timer: setTimeout(() => revoke(id), timeoutMs) });
  return address.port;
}
const control = createServer(async (request, response) => {
  if (request.method !== "POST" || !authorized(request.headers.authorization)) { response.writeHead(401); response.end(); return; }
  try {
    const input = await readBody(request);
    if (request.url === "/register") { const port = await register(input.sessionId, input.domains ?? [], input.timeoutMs ?? 120_000); response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ port })); return; }
    if (request.url === "/revoke") { revoke(input.sessionId); response.writeHead(200, { "content-type": "application/json" }); response.end("{}"); return; }
    response.writeHead(404); response.end();
  } catch { response.writeHead(400); response.end(); }
});
control.listen(Number(process.env.BROWSER_EGRESS_CONTROL_PORT ?? 3127), "0.0.0.0");
// A narrow host bridge forwards authenticated CDP commands to the internal-only worker.
createServer(async (request, response) => {
  if (request.url === "/health" && request.method === "GET") {
    try { const result = await fetch("http://browser-worker:4317/health", { signal: AbortSignal.timeout(2000) }); response.writeHead(result.status, { "content-type": "application/json" }); response.end(await result.text()); } catch { response.writeHead(503); response.end(); }
    return;
  }
  if (request.url !== "/v1/browser" || request.method !== "POST") { response.writeHead(404); response.end(); return; }
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 16_384) { response.writeHead(413); response.end(); return; } chunks.push(chunk); }
  try {
    const upstream = await fetch("http://browser-worker:4317/v1/browser", { method: "POST", headers: { authorization: request.headers.authorization ?? "", "content-type": "application/json" }, body: Buffer.concat(chunks), signal: AbortSignal.timeout(35_000) });
    response.writeHead(upstream.status, { "content-type": "application/json" }); response.end(await upstream.text());
  } catch { response.writeHead(503); response.end(); }
}).listen(4317, "0.0.0.0");
// The controlled site exists only in explicit integration-test mode and never in the production compose file.
if (process.env.BROWSER_CONTROLLED_TEST_HOST && process.env.BROWSER_TEST_CERT_DIR) {
  const directory = process.env.BROWSER_TEST_CERT_DIR;
  createHttpsServer({ key: readFileSync(`${directory}/key.pem`), cert: readFileSync(`${directory}/cert.pem`) }, (_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end('<!doctype html><title>AgentOS browser test</title><label for="name">Name</label><input id="name"><button id="go" onclick="document.querySelector(\'#result\').textContent=document.querySelector(\'#name\').value">Show</button><button id="egress" onclick="fetch(\'https://example.com/\').then(()=>document.querySelector(\'#result\').textContent=\'escaped\').catch(()=>document.querySelector(\'#result\').textContent=\'blocked\')">Try off-domain</button><p id="result">Ready</p>');
  }).listen(8443, "127.0.0.1");
}
process.on("SIGTERM", () => { for (const id of registrations.keys()) revoke(id); control.close(); });
