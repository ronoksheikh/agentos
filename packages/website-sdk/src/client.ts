import { ulid } from "ulid";
import { WEB_CHAT_SDK_PROTOCOL_VERSION } from "./protocol";

export interface WebChatClientOptions { baseUrl: string; publicKey: string; visitorId?: string; fetcher?: typeof fetch }
export interface VisitorMessage { id: string; senderKind: "CUSTOMER" | "AGENT" | "HUMAN"; text: string | null; occurredAt: string }
export interface VisitorPageContext { url: string; title?: string; productRef?: string; cartRef?: string; consented: boolean }

/** Browser-side transport. Keep the bearer token in memory; callers may persist only the opaque visitor ID. */
export class WebChatClient {
  private token: string | null = null;
  private expiresAt = 0;
  private cursor: string | null = null;
  private visitorId: string | null;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: WebChatClientOptions) {
    const base = new URL(options.baseUrl);
    if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname))) throw new Error("WEB_CHAT_HTTPS_REQUIRED");
    if (!options.publicKey.startsWith("pk_")) throw new Error("WEB_CHAT_PUBLIC_KEY_INVALID");
    this.baseUrl = base.origin;
    this.fetcher = options.fetcher ?? fetch;
    this.visitorId = options.visitorId ?? null;
  }
  private url(path: string) { const url = new URL(`/api/web-chat/v1/${path}`, this.baseUrl); url.searchParams.set("site", this.options.publicKey); return url.toString(); }
  private async request(path: string, method: "GET" | "POST" | "DELETE", body?: unknown) {
    const response = await this.fetcher(this.url(path), { method, headers: { ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), credentials: "omit", cache: "no-store" });
    if (!response.ok) { const payload = await response.json().catch(() => ({})) as { error?: string }; throw new Error(payload.error ?? `WEB_CHAT_HTTP_${response.status}`); }
    return response.status === 204 ? null : response.json();
  }
  async connect() {
    if (this.token && this.expiresAt > Date.now() + 30_000) return { visitorId: this.visitorId!, expiresAt: new Date(this.expiresAt).toISOString() };
    const result = await this.request("bootstrap", "POST", { publicKey: this.options.publicKey, sdkVersion: WEB_CHAT_SDK_PROTOCOL_VERSION, ...(this.visitorId ? { visitorId: this.visitorId } : {}) }) as { sessionToken: string; visitorId: string; expiresAt: string; capabilities: { text: true; attachments: false } };
    this.token = result.sessionToken; this.visitorId = result.visitorId; this.expiresAt = new Date(result.expiresAt).getTime();
    return { visitorId: result.visitorId, expiresAt: result.expiresAt, capabilities: result.capabilities };
  }
  async send(message: string, idempotencyKey = ulid(), pageContext?: VisitorPageContext) { await this.connect(); return this.request("messages", "POST", { message, idempotencyKey, ...(pageContext ? { pageContext } : {}) }) as Promise<{ accepted: boolean; duplicate: boolean }>; }
  async poll() {
    await this.connect();
    const path = this.cursor ? `messages?after=${encodeURIComponent(this.cursor)}` : "messages";
    const result = await this.request(path, "GET") as { messages: VisitorMessage[]; ownership: string; nextCursor: string | null };
    this.cursor = result.nextCursor;
    return result;
  }
  async disconnect() { if (this.token) await this.request("session", "DELETE"); this.token = null; this.visitorId = null; this.expiresAt = 0; this.cursor = null; }
  getVisitorId() { return this.visitorId; }
}
