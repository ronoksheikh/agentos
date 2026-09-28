import { describe, expect, it } from "bun:test";
import { createInvitationLink } from "../apps/admin/lib/invitations";

describe("invitation links", () => {
  it("keeps bearer tokens in the fragment instead of HTTP-visible query or path", () => {
    const token = "sensitive-one-use-token";
    const link = new URL(createInvitationLink("https://agency.example.test/", token));
    expect(link.origin).toBe("https://agency.example.test");
    expect(link.pathname).toBe("/accept-invitation");
    expect(link.search).toBe("");
    expect(link.hash).toBe(`#token=${encodeURIComponent(token)}`);
  });
});
