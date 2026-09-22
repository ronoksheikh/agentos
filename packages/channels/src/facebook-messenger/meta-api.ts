import { z } from "zod";

export const META_GRAPH_VERSION = "v26.0";
export class MetaApiError extends Error {
  constructor(readonly safeCode: "META_AUTH" | "META_PERMISSION" | "META_RATE_LIMIT" | "META_TRANSIENT" | "META_REJECTED", readonly retryAfterMs?: number) { super(safeCode); }
}
export interface MetaPage { id: string; name: string; accessToken: string; tasks: string[]; }
export interface MetaApi {
  exchangeCode(code: string, redirectUri: string): Promise<string>;
  listPages(userToken: string): Promise<MetaPage[]>;
  verifyPage(pageId: string, pageToken: string): Promise<{ id: string; name: string }>;
  subscribePage(pageId: string, pageToken: string): Promise<boolean>;
  isSubscribed(pageId: string, pageToken: string): Promise<boolean>;
  send(pageId: string, pageToken: string, body: Record<string, unknown>): Promise<{ messageId?: string }>;
}

const errorCode = (status: number, code?: number): MetaApiError["safeCode"] => {
  if (status === 429 || [4, 17, 32, 613].includes(code ?? -1)) return "META_RATE_LIMIT";
  if (status === 401 || code === 190) return "META_AUTH";
  if (status === 403 || [10, 200].includes(code ?? -1)) return "META_PERMISSION";
  if (status >= 500) return "META_TRANSIENT";
  return "META_REJECTED";
};

/** Only this private Meta client knows Graph paths and token formats. */
export class GraphMetaApi implements MetaApi {
  constructor(private readonly appId: string, private readonly appSecret: string, private readonly version = META_GRAPH_VERSION, private readonly fetcher: typeof fetch = fetch) {
    if (!/^v\d+\.0$/.test(version)) throw new Error("META_VERSION_INVALID");
  }
  private async call<T>(path: string, token: string | null, options: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {}): Promise<T> {
    const url = new URL(`https://graph.facebook.com/${this.version}/${path}`);
    const response = await this.fetcher(url, { method: options.method ?? "GET", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.body ? { "content-type": "application/json" } : {}) }, ...(options.body ? { body: JSON.stringify(options.body) } : {}), signal: AbortSignal.timeout(8000), redirect: "error" }).catch(() => { throw new MetaApiError("META_TRANSIENT"); });
    const parsed: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = typeof parsed === "object" && parsed !== null && "error" in parsed && typeof parsed.error === "object" && parsed.error !== null && "code" in parsed.error ? Number(parsed.error.code) : undefined;
      const retryHeader = response.headers.get("retry-after");
      throw new MetaApiError(errorCode(response.status, code), retryHeader ? Math.min(120_000, Math.max(1000, Number(retryHeader) * 1000)) : undefined);
    }
    return parsed as T;
  }
  async exchangeCode(code: string, redirectUri: string) {
    const query = new URLSearchParams({ client_id: this.appId, client_secret: this.appSecret, redirect_uri: redirectUri, code });
    const result = await this.call<unknown>(`oauth/access_token?${query}`, null);
    return z.object({ access_token: z.string().min(1) }).parse(result).access_token;
  }
  async listPages(userToken: string) {
    const result = await this.call<unknown>("me/accounts?fields=id,name,access_token,tasks&limit=100", userToken);
    return z.object({ data: z.array(z.object({ id: z.string(), name: z.string(), access_token: z.string(), tasks: z.array(z.string()).default([]) })) }).parse(result).data.map(({ access_token, ...page }) => ({ ...page, accessToken: access_token }));
  }
  async verifyPage(pageId: string, pageToken: string) {
    const result = await this.call<unknown>(`${encodeURIComponent(pageId)}?fields=id,name`, pageToken);
    return z.object({ id: z.string(), name: z.string() }).parse(result);
  }
  async subscribePage(pageId: string, pageToken: string) {
    const result = await this.call<unknown>(`${encodeURIComponent(pageId)}/subscribed_apps`, pageToken, { method: "POST", body: { subscribed_fields: ["messages", "message_deliveries", "message_reads", "messaging_postbacks"] } });
    return z.object({ success: z.boolean() }).parse(result).success;
  }
  async isSubscribed(pageId: string, pageToken: string) {
    const result = await this.call<unknown>(`${encodeURIComponent(pageId)}/subscribed_apps`, pageToken);
    return z.object({ data: z.array(z.object({ id: z.string() }).passthrough()) }).parse(result).data.some((app) => app.id === this.appId);
  }
  async send(pageId: string, pageToken: string, body: Record<string, unknown>) {
    const result = await this.call<unknown>(`${encodeURIComponent(pageId)}/messages`, pageToken, { method: "POST", body });
    const messageId = z.object({ message_id: z.string().optional() }).parse(result).message_id;
    return messageId ? { messageId } : {};
  }
}
