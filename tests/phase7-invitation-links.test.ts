import { describe, expect, it } from "bun:test";
import { createInvitationLink, deliverInvitationEmail } from "../apps/admin/lib/invitations";

describe("invitation links", () => {
  it("keeps bearer tokens in the fragment instead of HTTP-visible query or path", () => {
    const token = "sensitive-one-use-token";
    const link = new URL(createInvitationLink("https://agency.example.test/", token));
    expect(link.origin).toBe("https://agency.example.test");
    expect(link.pathname).toBe("/accept-invitation");
    expect(link.search).toBe("");
    expect(link.hash).toBe(`#token=${encodeURIComponent(token)}`);
  });

  it("sends the scoped template and fragment-only acceptance link through the bounded gateway request", async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const accepted = await deliverInvitationEmail({
      endpoint: "https://mail-gateway.example.test/send",
      template: "business-invitation",
      recipient: "member@example.test",
      url: createInvitationLink("https://client.example.test", "one-time-secret"),
      expiresAt: "2026-09-30T12:00:00.000Z",
      businessName: "Example shop",
      fetcher: async (url, init) => {
        request = { url: String(url), init: init ?? {} };
        return new Response(null, { status: 202 });
      },
    });
    expect(accepted).toBe(true);
    expect(request?.url).toBe("https://mail-gateway.example.test/send");
    expect(request?.init.method).toBe("POST");
    expect(request?.init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(request?.init.body))).toEqual({
      template: "business-invitation",
      recipient: "member@example.test",
      url: "https://client.example.test/accept-invitation#token=one-time-secret",
      expiresAt: "2026-09-30T12:00:00.000Z",
      businessName: "Example shop",
    });
  });

  it("treats rejected and unreachable email gateways as delivery failure", async () => {
    const base = { endpoint: "https://mail-gateway.example.test/send", template: "agency-invitation" as const, recipient: "member@example.test", url: "https://agency.example.test/accept-invitation#token=secret", expiresAt: "2026-09-30T12:00:00.000Z" };
    expect(await deliverInvitationEmail({ ...base, fetcher: async () => new Response(null, { status: 503 }) })).toBe(false);
    expect(await deliverInvitationEmail({ ...base, fetcher: async () => { throw new Error("network detail"); } })).toBe(false);
  });
});
