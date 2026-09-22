import { timingSafeEqual } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ulid } from "ulid";
import { z } from "zod";
import { assertApprovedUrl } from "@agentos/integrations";
import type { BrowserPolicy } from "@agentos/web";
import { Cdp } from "./cdp";

const policySchema = z.object({ allowedDomains: z.array(z.string().regex(/^[a-z0-9.-]+$/i)).min(1).max(20), deniedDomains: z.array(z.string()).max(20), timeoutMs: z.number().int().min(1000).max(120_000), maxActions: z.number().int().min(1).max(100), maxEgress: z.number().int().min(1).max(30), allowDownloads: z.literal(false), allowUploads: z.literal(false), credentialRef: z.string().optional() }).strict();
const requestSchema = z.object({ sessionId: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/), operation: z.enum(["open", "click", "type", "extract", "screenshot", "close"]), businessId: z.string().optional(), url: z.string().optional(), policy: policySchema.optional(), selector: z.string().min(1).max(300).optional(), value: z.string().max(2000).optional() }).strict();
type Session = { id: string; businessId: string; policy: BrowserPolicy; profile: string; process: ReturnType<typeof Bun.spawn>; cdp: Cdp; targetSession: string; proxyPort: number; expiresAt: number; actions: number; egress: number; timer: ReturnType<typeof setTimeout> };
const sessions = new Map<string, Session>();
const workerToken = process.env.BROWSER_WORKER_TOKEN ?? "";
const proxyToken = process.env.BROWSER_EGRESS_TOKEN ?? "";
const proxyControl = process.env.BROWSER_EGRESS_CONTROL_URL ?? "";
const chromePath = process.env.BROWSER_CHROME_PATH ?? "";
if (!workerToken || workerToken.length < 24 || !proxyToken || !proxyControl || !chromePath) throw new Error("BROWSER_WORKER_CONFIGURATION_REQUIRED");
const allowed = (raw: string, policy: BrowserPolicy) => { const url = assertApprovedUrl(raw, policy.allowedDomains); if (policy.deniedDomains.some((host) => host.toLowerCase() === url.hostname.toLowerCase())) throw new Error("BROWSER_DOMAIN_DENIED"); return url; };
const auth = (token: string | null) => { const supplied = Buffer.from(token ?? ""); const expected = Buffer.from(`Bearer ${workerToken}`); return supplied.length === expected.length && timingSafeEqual(supplied, expected); };
async function proxy(operation: "register" | "revoke", sessionId: string, domains?: string[], timeoutMs?: number) {
  const response = await fetch(new URL(`/${operation}`, proxyControl), { method: "POST", headers: { authorization: `Bearer ${proxyToken}`, "content-type": "application/json" }, body: JSON.stringify({ sessionId, ...(domains ? { domains } : {}), ...(timeoutMs ? { timeoutMs } : {}) }), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("BROWSER_EGRESS_UNAVAILABLE");
  return z.object({ port: z.number().int().positive().optional() }).parse(await response.json());
}
async function close(id: string) {
  const session = sessions.get(id); if (!session) return;
  sessions.delete(id); clearTimeout(session.timer); session.cdp.close(); session.process.kill("SIGKILL");
  await Promise.allSettled([proxy("revoke", id), rm(session.profile, { recursive: true, force: true })]);
}
async function evaluate(session: Session, expression: string) {
  const result = await session.cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: false }, session.targetSession);
  if (result.exceptionDetails) throw new Error("BROWSER_SCRIPT_FAILED");
  return result.result?.value as unknown;
}
async function page(session: Session) {
  const data = await evaluate(session, "({url:location.href,title:document.title})");
  const parsed = z.object({ url: z.string(), title: z.string() }).parse(data);
  allowed(parsed.url, session.policy); return parsed;
}
async function node(session: Session, selector: string) {
  const document = await session.cdp.send("DOM.getDocument", { depth: -1, pierce: false }, session.targetSession);
  const result = await session.cdp.send("DOM.querySelector", { nodeId: document.root.nodeId, selector }, session.targetSession);
  if (!result.nodeId) throw new Error("BROWSER_ELEMENT_NOT_FOUND");
  return Number(result.nodeId);
}
async function start(input: z.infer<typeof requestSchema>) {
  if (sessions.has(input.sessionId)) throw new Error("BROWSER_SESSION_EXISTS");
  if (!input.url || !input.businessId || !input.policy) throw new Error("BROWSER_INPUT_INVALID");
  const { credentialRef, ...policy } = input.policy; if (credentialRef) throw new Error("BROWSER_CREDENTIAL_UNAVAILABLE"); allowed(input.url, policy);
  const registered = await proxy("register", input.sessionId, policy.allowedDomains.filter((host) => !policy.deniedDomains.includes(host)), policy.timeoutMs);
  if (!registered.port) throw new Error("BROWSER_EGRESS_UNAVAILABLE");
  const profile = await mkdtemp(join(tmpdir(), "agentos-browser-")); await chmod(profile, 0o700);
  let chrome: ReturnType<typeof Bun.spawn> | undefined;
  try {
    chrome = Bun.spawn([chromePath, "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-background-networking", "--disable-sync", "--disable-extensions", "--disable-default-apps", "--no-first-run", "--no-default-browser-check", "--disable-features=OptimizationHints,MediaRouter,Translate", "--proxy-bypass-list=<-loopback>", `--proxy-server=http://${process.env.BROWSER_EGRESS_HOST ?? "browser-egress"}:${registered.port}`, "--remote-debugging-port=0", `--user-data-dir=${profile}`, ...(process.env.BROWSER_TEST_MODE === "1" ? ["--ignore-certificate-errors"] : []), "about:blank"], { stdout: "ignore", stderr: "ignore", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: profile, TMPDIR: profile } });
    let port = 0; let browserId = "";
    for (let i = 0; i < 100; i++) { try { const [p, id] = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).trim().split("\n"); port = Number(p); browserId = id ?? ""; if (port && browserId) break; } catch { /* Chrome is starting. */ } await Bun.sleep(50); }
    if (!port || !browserId) throw new Error("BROWSER_CHROME_START_FAILED");
    const cdp = await Cdp.connect(`ws://127.0.0.1:${port}${browserId}`);
    const target = await cdp.send("Target.createTarget", { url: "about:blank" });
    const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    const targetSession = String(attached.sessionId);
    const session: Session = { id: input.sessionId, businessId: input.businessId, policy, profile, process: chrome, cdp, targetSession, proxyPort: registered.port, expiresAt: Date.now() + policy.timeoutMs, actions: 0, egress: 0, timer: setTimeout(() => { void close(input.sessionId); }, policy.timeoutMs) };
    sessions.set(input.sessionId, session);
    cdp.on("Fetch.requestPaused", (params, eventSession) => {
      if (eventSession !== targetSession) return;
      const requestId = String(params.requestId);
      let method = "Fetch.continueRequest";
      try { allowed(String(params.request?.url), policy); if (++session.egress > policy.maxEgress) throw new Error("BROWSER_EGRESS_LIMIT"); } catch { method = "Fetch.failRequest"; }
      void cdp.send(method, method === "Fetch.failRequest" ? { requestId, errorReason: "BlockedByClient" } : { requestId }, targetSession).catch(() => {});
    });
    await Promise.all([cdp.send("Page.enable", {}, targetSession), cdp.send("DOM.enable", {}, targetSession), cdp.send("Runtime.enable", {}, targetSession)]);
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] }, targetSession);
    await cdp.send("Page.navigate", { url: input.url }, targetSession, Math.min(policy.timeoutMs, 20_000));
    for (let i = 0; i < 100; i++) { const result = await page(session).catch(() => null); if (result?.url !== "about:blank" && result?.title) return result; await Bun.sleep(50); }
    return page(session);
  } catch (error) { if (sessions.has(input.sessionId)) await close(input.sessionId); else { chrome?.kill("SIGKILL"); await Promise.allSettled([proxy("revoke", input.sessionId), rm(profile, { recursive: true, force: true })]); } throw error; }
}
async function act(input: z.infer<typeof requestSchema>) {
  if (input.operation === "close") { await close(input.sessionId); return { closed: true }; }
  const session = sessions.get(input.sessionId); if (!session) throw new Error("BROWSER_SESSION_NOT_FOUND");
  if (Date.now() >= session.expiresAt) { await close(input.sessionId); throw new Error("BROWSER_SESSION_EXPIRED"); }
  if (++session.actions > session.policy.maxActions) { await close(input.sessionId); throw new Error("BROWSER_ACTION_LIMIT"); }
  if (input.operation === "click") {
    if (!input.selector) throw new Error("BROWSER_INPUT_INVALID");
    const id = await node(session, input.selector);
    await session.cdp.send("DOM.scrollIntoViewIfNeeded", { nodeId: id }, session.targetSession);
    const box = await session.cdp.send("DOM.getBoxModel", { nodeId: id }, session.targetSession);
    const q = box.model?.content as number[] | undefined; if (!q || q.length < 8) throw new Error("BROWSER_ELEMENT_NOT_VISIBLE");
    const x = (q[0]! + q[2]! + q[4]! + q[6]!) / 4; const y = (q[1]! + q[3]! + q[5]! + q[7]!) / 4;
    await session.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, session.targetSession);
    await session.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, session.targetSession);
    await Bun.sleep(100); return page(session);
  }
  if (input.operation === "type") {
    if (!input.selector || input.value === undefined) throw new Error("BROWSER_INPUT_INVALID");
    const id = await node(session, input.selector);
    await session.cdp.send("DOM.focus", { nodeId: id }, session.targetSession);
    await session.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 }, session.targetSession);
    await session.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 }, session.targetSession);
    await session.cdp.send("Input.insertText", { text: input.value }, session.targetSession);
    return { typed: true };
  }
  if (input.operation === "extract") {
    if (!input.selector) throw new Error("BROWSER_INPUT_INVALID");
    const text = await evaluate(session, `(() => { const el = document.querySelector(${JSON.stringify(input.selector)}); if (!el) throw Error('missing'); return (el.textContent || '').slice(0,10000); })()`);
    return { text: z.string().parse(text) };
  }
  if (input.operation === "screenshot") {
    const result = await session.cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, session.targetSession);
    const bytes = Buffer.from(z.string().parse(result.data), "base64"); if (bytes.byteLength > 5_000_000) throw new Error("BROWSER_SCREENSHOT_TOO_LARGE");
    const shotId = ulid(); const directory = join("/screenshots", session.businessId, input.sessionId); await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, `${shotId}.png`); await Bun.write(file, bytes); await chmod(file, 0o600);
    return { objectRef: `${session.businessId}/screenshots/${input.sessionId}/${shotId}` };
  }
  throw new Error("BROWSER_OPERATION_INVALID");
}

export const server = Bun.serve({ hostname: "0.0.0.0", port: Number(process.env.BROWSER_WORKER_PORT ?? 4317), async fetch(request) {
  if (new URL(request.url).pathname === "/health") return Response.json({ ready: true });
  if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/browser") return new Response("Not found", { status: 404 });
  if (!auth(request.headers.get("authorization"))) return new Response("Unauthorized", { status: 401 });
  if (Number(request.headers.get("content-length") ?? 0) > 16_384) return new Response("Too large", { status: 413 });
  try {
    const input = requestSchema.parse(await request.json());
    return Response.json(input.operation === "open" ? await start(input) : await act(input));
  } catch (error) { const code = error instanceof Error ? error.message : "BROWSER_FAILED"; return Response.json({ code: /^[A-Z_]+$/.test(code) ? code : "BROWSER_FAILED" }, { status: code === "BROWSER_SESSION_NOT_FOUND" ? 404 : 400 }); }
} });
process.on("SIGTERM", () => { void Promise.allSettled([...sessions.keys()].map(close)).then(() => server.stop(true)); });
