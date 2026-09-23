import { z } from "zod";
import type { BrowserAdapter, BrowserPolicy } from "./index";

const pageSchema = z.object({ url: z.url(), title: z.string() });
const textSchema = z.object({ text: z.string() });
const shotSchema = z.object({ objectRef: z.string() });

/** Transport for the isolated Browser Use worker. It never returns raw screenshots or browser credentials. */
export class RemoteBrowserAdapter implements BrowserAdapter {
  constructor(private readonly endpoint: string, private readonly token: string) {
    const url = new URL(endpoint);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("BROWSER_WORKER_URL_INVALID");
    if (!token || token.length < 24) throw new Error("BROWSER_WORKER_TOKEN_REQUIRED");
  }
  private async call(sessionId: string, operation: string, input: Record<string, unknown> = {}, signal?: AbortSignal) {
    const response = await fetch(new URL("/v1/browser", this.endpoint), { method: "POST", headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" }, body: JSON.stringify({ sessionId, operation, ...input }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(5000), redirect: "error" });
    if (!response.ok) throw new Error(response.status === 404 ? "BROWSER_WORKER_SESSION_LOST" : "BROWSER_WORKER_FAILED");
    return response.json() as Promise<unknown>;
  }
  private attachCancellation(sessionId: string, signal: AbortSignal) { signal.addEventListener("abort", () => { void this.close(sessionId); }, { once: true }); }
  async open(sessionId: string, url: string, signal: AbortSignal, businessId: string, policy?: BrowserPolicy) {
    if (!policy) throw new Error("BROWSER_POLICY_REQUIRED");
    this.attachCancellation(sessionId, signal);
    return pageSchema.parse(await this.call(sessionId, "open", { url, businessId, policy }, signal));
  }
  async click(sessionId: string, selector: string, signal: AbortSignal) { this.attachCancellation(sessionId, signal); return pageSchema.parse(await this.call(sessionId, "click", { selector }, signal)); }
  async type(sessionId: string, selector: string, value: string, signal: AbortSignal) { this.attachCancellation(sessionId, signal); await this.call(sessionId, "type", { selector, value }, signal); }
  async extract(sessionId: string, selector: string, signal: AbortSignal) { this.attachCancellation(sessionId, signal); return textSchema.parse(await this.call(sessionId, "extract", { selector }, signal)).text; }
  async screenshot(sessionId: string, signal: AbortSignal) { this.attachCancellation(sessionId, signal); return shotSchema.parse(await this.call(sessionId, "screenshot", {}, signal)); }
  async research(sessionId: string, task: string, signal: AbortSignal) { this.attachCancellation(sessionId, signal); return z.object({ text: z.string(), url: z.url(), totalTokens: z.number().int().min(0) }).parse(await this.call(sessionId, "research", { task }, signal)); }
  async close(sessionId: string) { await this.call(sessionId, "close").catch(() => {}); }
}
