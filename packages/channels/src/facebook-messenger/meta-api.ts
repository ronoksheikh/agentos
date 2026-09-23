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
  subscribeFeed?(pageId: string, pageToken: string): Promise<boolean>;
  isSubscribed(pageId: string, pageToken: string): Promise<boolean>;
  send(pageId: string, pageToken: string, body: Record<string, unknown>): Promise<{ messageId?: string }>;
  getComment?(commentId: string, pageToken: string): Promise<{ id: string; message: string; createdAt?: string; authorId?: string; parentId?: string; postId?: string; canComment: boolean; canHide: boolean; isHidden: boolean }>;
  getPost?(postId: string, pageToken: string): Promise<{ id: string; message?: string; authorId?: string }>;
  replyComment?(commentId: string, pageToken: string, message: string): Promise<{ id: string }>;
  hideComment?(commentId: string, pageToken: string): Promise<boolean>;
  inspectToken?(pageToken: string): Promise<{ appId: string; valid: boolean; type: string; scopes: string[]; expiresAt?: number }>;
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
  private async call<T>(path: string, token: string | null, options: { method?: "GET" | "POST"; body?: Record<string, unknown>; form?: boolean } = {}): Promise<T> {
    const url = new URL(`https://graph.facebook.com/${this.version}/${path}`);
    const response = await this.fetcher(url, { method: options.method ?? "GET", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.body ? { "content-type": options.form ? "application/x-www-form-urlencoded" : "application/json" } : {}) }, ...(options.body ? { body: options.form ? new URLSearchParams(Object.entries(options.body).map(([key, value]) => [key, String(value)])).toString() : JSON.stringify(options.body) } : {}), signal: AbortSignal.timeout(8000), redirect: "error" }).catch(() => { throw new MetaApiError("META_TRANSIENT"); });
    const parsed: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = typeof parsed === "object" && parsed !== null && "error" in parsed && typeof parsed.error === "object" && parsed.error !== null && "code" in parsed.error ? Number(parsed.error.code) : undefined;
      const retryHeader = response.headers.get("retry-after"); const retrySeconds = retryHeader ? Number(retryHeader) : NaN;
      throw new MetaApiError(errorCode(response.status, code), Number.isFinite(retrySeconds) ? Math.min(120_000, Math.max(1000, retrySeconds * 1000)) : undefined);
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
    const result = await this.call<unknown>(`${encodeURIComponent(pageId)}/subscribed_apps`, pageToken, { method: "POST", body: { subscribed_fields: "messages,message_deliveries,message_reads,messaging_postbacks" }, form: true });
    return z.object({ success: z.boolean() }).parse(result).success;
  }
  async subscribeFeed(pageId: string, pageToken: string) {
    const result = await this.call<unknown>(`${encodeURIComponent(pageId)}/subscribed_apps`, pageToken, { method: "POST", body: { subscribed_fields: "messages,message_deliveries,message_reads,messaging_postbacks,feed" }, form: true });
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
  async getComment(commentId: string, pageToken: string) {
    const result = await this.call<unknown>(`${encodeURIComponent(commentId)}?fields=id,message,created_time,from,parent,object,can_comment,can_hide,is_hidden`, pageToken);
    const parsed = z.object({ id: z.string(), message: z.string().max(100_000), created_time: z.string().optional(), from: z.object({ id: z.string() }).optional(), parent: z.object({ id: z.string() }).optional(), object: z.object({ id: z.string() }).optional(), can_comment: z.boolean().default(false), can_hide: z.boolean().default(false), is_hidden: z.boolean().default(false) }).parse(result);
    return { id: parsed.id, message: parsed.message, ...(parsed.created_time ? { createdAt: parsed.created_time } : {}), ...(parsed.from ? { authorId: parsed.from.id } : {}), ...(parsed.parent ? { parentId: parsed.parent.id } : {}), ...(parsed.object ? { postId: parsed.object.id } : {}), canComment: parsed.can_comment, canHide: parsed.can_hide, isHidden: parsed.is_hidden };
  }
  async getPost(postId: string, pageToken: string) {
    const result = await this.call<unknown>(`${encodeURIComponent(postId)}?fields=id,message,from`, pageToken);
    const parsed = z.object({ id: z.string(), message: z.string().max(100_000).optional(), from: z.object({ id: z.string() }).optional() }).parse(result);
    return { id: parsed.id, ...(parsed.message ? { message: parsed.message } : {}), ...(parsed.from ? { authorId: parsed.from.id } : {}) };
  }
  async replyComment(commentId: string, pageToken: string, message: string) {
    const result = await this.call<unknown>(`${encodeURIComponent(commentId)}/comments`, pageToken, { method: "POST", body: { message }, form: true });
    return z.object({ id: z.string().min(1) }).parse(result);
  }
  async hideComment(commentId: string, pageToken: string) {
    const result = await this.call<unknown>(encodeURIComponent(commentId), pageToken, { method: "POST", body: { is_hidden: "true" }, form: true });
    return z.object({ success: z.boolean() }).parse(result).success;
  }
  async inspectToken(pageToken: string) {
    const result = await this.call<unknown>(`debug_token?input_token=${encodeURIComponent(pageToken)}`, `${this.appId}|${this.appSecret}`);
    const parsed = z.object({ data: z.object({ app_id: z.string(), is_valid: z.boolean(), type: z.string(), scopes: z.array(z.string()).default([]), expires_at: z.number().int().optional() }) }).parse(result).data;
    return { appId: parsed.app_id, valid: parsed.is_valid, type: parsed.type, scopes: parsed.scopes, ...(parsed.expires_at ? { expiresAt: parsed.expires_at } : {}) };
  }
}
