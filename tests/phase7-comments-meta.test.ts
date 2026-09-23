import { expect, test } from "bun:test";
import { GraphMetaApi } from "@agentos/channels";

test("Meta comment client uses scoped Graph paths and inspects token without exposing it", async () => {
  const calls: { path: string; method: string; fields: string | null; auth: string | null; body: string | null }[] = [];
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)); const body = typeof init?.body === "string" ? init.body : null;
    calls.push({ path: url.pathname, method: init?.method ?? "GET", fields: url.searchParams.get("fields"), auth: new Headers(init?.headers).get("authorization"), body });
    const payload = url.pathname.endsWith("/debug_token") ? { data: { app_id: "app-1", is_valid: true, type: "PAGE", scopes: ["pages_read_engagement", "pages_manage_engagement"] } }
      : url.pathname.endsWith("/subscribed_apps") ? { success: true }
      : url.pathname.endsWith("/comment_1/comments") ? { id: "reply_1" }
      : url.pathname.endsWith("/comment_1") && init?.method === "POST" ? { success: true }
      : url.pathname.endsWith("/comment_1") ? { id: "comment_1", message: "Question", from: { id: "person_1" }, object: { id: "post_1" }, can_comment: true, can_hide: true, is_hidden: false }
      : { id: "post_1", message: "Page post", from: { id: "page_1" } };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
  const api = new GraphMetaApi("app-1", "secret-1", "v26.0", fetcher as typeof fetch);
  expect(await api.inspectToken("page-token")).toMatchObject({ appId: "app-1", valid: true, type: "PAGE" });
  expect(await api.subscribeFeed("page_1", "page-token")).toBe(true);
  expect(await api.getComment("comment_1", "page-token")).toMatchObject({ postId: "post_1", authorId: "person_1", canComment: true, canHide: true });
  expect(await api.getPost("post_1", "page-token")).toMatchObject({ authorId: "page_1" });
  expect(await api.replyComment("comment_1", "page-token", "Test reply")).toEqual({ id: "reply_1" });
  expect(await api.hideComment("comment_1", "page-token")).toBe(true);
  expect(calls.map((call) => call.path)).toEqual(["/v26.0/debug_token", "/v26.0/page_1/subscribed_apps", "/v26.0/comment_1", "/v26.0/post_1", "/v26.0/comment_1/comments", "/v26.0/comment_1"]);
  expect(calls[0]?.auth).toBe("Bearer app-1|secret-1");
  expect(calls[1]?.body).toContain("feed");
  expect(calls[2]?.fields).toContain("can_comment");
  expect(calls[4]?.body).toBe("message=Test+reply");
  expect(calls[5]?.body).toBe("is_hidden=true");
});
