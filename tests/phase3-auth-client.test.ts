import { describe, expect, test } from "bun:test";
import { ulid } from "ulid";
import { AgencyAuthService, businessCapabilities, BusinessMembershipRealtimeAuthorizer, BusinessMembershipService } from "@agentos/auth";
import { ClientActorResolver, ClientDashboardService } from "@agentos/client-operations";

describe("phase 3 client authentication and tenant isolation", () => {
  test("accepts business invitations, authenticates clients, selects memberships, and disables immediately", () => {
    const auth = new AgencyAuthService(); const root = auth.createUser({ name: "Root", email: "root@example.com", password: "correct-horse-battery", role: "SUPER_ADMIN" }); const businessA = ulid(); const businessB = ulid();
    const first = auth.invite({ userId: root.id, role: "SUPER_ADMIN" }, { email: "client@example.com", scope: "BUSINESS", role: "OWNER", businessId: businessA }); const accepted = auth.acceptBusinessInvitation(first.token, { name: "Client", password: "client-secure-password" });
    const second = auth.invite({ userId: root.id, role: "SUPER_ADMIN" }, { email: "client@example.com", scope: "BUSINESS", role: "VIEWER", businessId: businessB }); auth.acceptBusinessInvitation(second.token, { name: "Ignored", password: "unused-password" });
    const session = auth.loginClient("client@example.com", "client-secure-password"); const principal = auth.authenticateToken(session.token)!;
    expect(auth.businessMemberships.listForUser(principal).map((membership) => membership.businessId).sort()).toEqual([businessA, businessB].sort());
    expect(auth.businessMemberships.authorize(principal, businessA, "member.manage").role).toBe("OWNER"); expect(() => auth.businessMemberships.authorize(principal, businessB, "member.manage")).toThrow("FORBIDDEN");
    auth.disableUser({ role: "SUPER_ADMIN" }, accepted.user.id); expect(auth.authenticateToken(session.token)).toBeNull();
  });

  test("enforces all role capabilities and client query scope server-side", async () => {
    expect(businessCapabilities("OWNER")).toContain("member.manage"); expect(businessCapabilities("ADMIN")).toContain("handoff.manage"); expect(businessCapabilities("STAFF")).toContain("conversation.manage"); expect(businessCapabilities("VIEWER")).not.toContain("handoff.manage");
    const memberships = new BusinessMembershipService(); const businessA = ulid(); const businessB = ulid(); const userId = ulid(); const principal = { userId, sessionId: "s", accountState: "ACTIVE" as const }; const membership = { id: ulid(), businessId: businessA, userId, role: "STAFF" as const, capabilities: [], createdAt: new Date().toISOString() }; memberships.memberships.set(membership.id, membership); const actors = new ClientActorResolver(memberships); const dashboard = new ClientDashboardService();
    dashboard.conversations.set("visible", { id: "visible", businessId: businessA, customerId: "customer", customerName: "Amina", verifiedPhone: "+8801", orderIds: ["order-1"], messageText: "refund", tags: ["vip"], channel: "test", handoffState: "HANDOFF_REQUESTED", occurredAt: "2026-09-22T00:00:00.000Z", unread: true, agentId: "agent", failedRun: true, urgent: true, messages: [] }); dashboard.conversations.set("hidden", { id: "hidden", businessId: businessB, customerId: "hidden", customerName: "Hidden", orderIds: [], messageText: "secret", tags: [], channel: "test", handoffState: "AI_ACTIVE", occurredAt: "2026-09-22T00:00:00.000Z", unread: true, failedRun: false, urgent: false, messages: [] });
    const actor = actors.resolve(principal, businessA, "conversation.read"); expect(dashboard.search(actor, { query: "refund", phone: "+8801", orderId: "order-1", tag: "vip", channel: "test", handoffState: "HANDOFF_REQUESTED", unread: true, agentId: "agent" }).items.map((row) => row.id)).toEqual(["visible"]); expect(dashboard.counters(actor)).toEqual({ unreadConversations: 1, unresolvedHandoffs: 1, failedRuns: 1, urgentIssues: 1 }); expect(() => actors.resolve(principal, businessB)).toThrow("FORBIDDEN");
    const ws = new BusinessMembershipRealtimeAuthorizer(memberships, { async conversationBelongsToBusiness(id, businessId) { return id === "visible" && businessId === businessA; }, async runBelongsToBusiness(id, businessId) { return id === "run-visible" && businessId === businessA; } }); expect(await ws.canSubscribe(principal, { businessId: businessA, conversationId: "visible", runId: "run-visible" })).toBe(true); expect(await ws.canSubscribe(principal, { businessId: businessA, conversationId: "hidden" })).toBe(false); expect(await ws.canSubscribe(principal, { businessId: businessB })).toBe(false);
  });
});
