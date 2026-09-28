import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { ClientCustomersView, ClientTeamView } from "../apps/client/components/ClientDirectoryViews";

describe("Phase 7 client directories", () => {
  test("shows only customer profile fields and safe activity summaries", () => {
    const html = renderToStaticMarkup(<MantineProvider><ClientCustomersView businessId="business" search="" customers={[{ id: "customer-1", displayName: "A customer", tags: ["vip"], updatedAt: "2026-09-01T10:00:00.000Z", conversationCount: 2, lastConversationAt: "2026-09-02T10:00:00.000Z" }]} /></MantineProvider>);
    expect(html).toContain("A customer"); expect(html).toContain("vip"); expect(html).toContain("2"); expect(html).toContain("Last conversation");
  });

  test("shows business member role and account state without mixing another view", () => {
    const html = renderToStaticMarkup(<MantineProvider><ClientTeamView members={[{ userId: "user-1", name: "Team Member", email: "member@example.test", accountState: "ACTIVE", role: "STAFF", capabilities: [], joinedAt: "2026-01-01T00:00:00.000Z" }]} /></MantineProvider>);
    expect(html).toContain("Team Member"); expect(html).toContain("member@example.test"); expect(html).toContain("STAFF"); expect(html).toContain("ACTIVE"); expect(html).not.toContain("Recent conversations");
  });
});
