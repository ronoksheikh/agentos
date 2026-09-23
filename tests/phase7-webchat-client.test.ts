import { describe, expect, test } from "bun:test";
import { WebChatClient } from "@agentos/website-sdk/client";

describe("browser Web Chat transport", () => {
  test("keeps bearer in memory, carries idempotency key and cursor, and revokes on disconnect", async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input)); calls.push({ url, init: init ?? {} });
      if (url.pathname.endsWith("/bootstrap")) return Response.json({ sessionToken: "signed-token", visitorId: "01K5WX86EK57V43FCD1P6HQGYR", expiresAt: new Date(Date.now() + 60_000).toISOString(), capabilities: { text: true, attachments: false } });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (init?.method === "POST") return Response.json({ accepted: true, duplicate: false }, { status: 202 });
      return Response.json({ messages: [{ id: "01K5WX86EK57V43FCD1P6HQGYS", senderKind: "AGENT", text: "Hi", occurredAt: new Date().toISOString() }], ownership: "AI_ACTIVE", nextCursor: "01K5WX86EK57V43FCD1P6HQGYS" });
    }) as typeof fetch;
    const client = new WebChatClient({ baseUrl: "https://agent.example", publicKey: "pk_example", fetcher });
    await client.connect(); expect(client.getVisitorId()).toBe("01K5WX86EK57V43FCD1P6HQGYR");
    await client.send("Hello", "message-key"); await client.poll(); await client.poll(); await client.disconnect();
    expect(calls.map((call) => call.url.pathname)).toEqual(["/api/web-chat/v1/bootstrap", "/api/web-chat/v1/messages", "/api/web-chat/v1/messages", "/api/web-chat/v1/messages", "/api/web-chat/v1/session"]);
    expect(calls.every((call) => call.url.searchParams.get("site") === "pk_example")).toBe(true);
    expect(calls[3]!.url.searchParams.get("after")).toBe("01K5WX86EK57V43FCD1P6HQGYS");
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ message: "Hello", idempotencyKey: "message-key" });
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe("Bearer signed-token");
    expect(calls.every((call) => call.init.credentials === "omit")).toBe(true);
    expect(client.getVisitorId()).toBeNull();
  });
});
