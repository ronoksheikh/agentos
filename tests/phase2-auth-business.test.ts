import { describe, expect, test } from "bun:test";
import { AgencyAuthService, agencyCapabilities, requireAgencyCapability } from "@agentos/auth";
import { AuditLogService, BusinessControlPlane, MemoryInspectorService } from "@agentos/control-plane";

const admin = { userId: "admin", role: "ADMIN" as const };
const support = { userId: "support", role: "SUPPORT" as const };

describe("phase 2 authentication and business controls", () => {
  test("supports login, logout, reset, invitation, revocation, and disabled-account enforcement", () => {
    const auth = new AgencyAuthService();
    const root = auth.createUser({ name: "Root", email: "root@example.com", password: "correct-horse-battery", role: "SUPER_ADMIN" });
    const session = auth.login("root@example.com", "correct-horse-battery");
    expect(auth.authenticateToken(session.token)?.userId).toBe(root.id);
    auth.logout(session.sessionId); expect(auth.authenticateToken(session.token)).toBeNull();

    const invited = auth.invite({ userId: root.id, role: "SUPER_ADMIN" }, { email: "dev@example.com", scope: "AGENCY", role: "DEVELOPER" });
    const developer = auth.acceptAgencyInvitation(invited.token, { name: "Dev", password: "another-secure-password" });
    expect(auth.memberships.get(developer.id)?.role).toBe("DEVELOPER");
    const developerSession = auth.login("dev@example.com", "another-secure-password");
    const reset = auth.requestPasswordReset("dev@example.com")!; auth.resetPassword(reset, "replacement-password!");
    expect(auth.authenticateToken(developerSession.token)).toBeNull();
    const replacementSession = auth.login("dev@example.com", "replacement-password!");
    auth.disableUser({ role: "SUPER_ADMIN" }, developer.id);
    expect(auth.authenticateToken(replacementSession.token)).toBeNull();
  });

  test("enforces role capabilities server-side", () => {
    expect(agencyCapabilities("SUPPORT")).toContain("business.read");
    expect(() => requireAgencyCapability(support, "business.manage")).toThrow("FORBIDDEN");
    expect(() => requireAgencyCapability(admin, "business.manage")).not.toThrow();
  });

  test("keeps structured profile fields separate and audits onboarding and announcements", () => {
    const audit = new AuditLogService(); const service = new BusinessControlPlane(audit);
    const business = service.create(admin, { name: "Acme" });
    const updated = service.updateProfile(admin, business.id, {
      identity: { name: "Acme", description: "Retailer" }, tone: "warm", languages: ["en", "bn"], openingHours: [], contacts: [], locations: [],
      delivery: { summary: "Dhaka delivery", regions: ["Dhaka"] }, returnsAndRefunds: "Seven days", orderRules: ["Confirm size"], escalationRules: ["Escalate refunds"], brandInstructions: "Use short replies", commonQuestions: [{ question: "Open?", answer: "Daily" }],
    }, 1);
    expect(updated.profile.delivery.summary).toBe("Dhaka delivery");
    expect(updated.profile).not.toHaveProperty("knowledge");
    expect(service.transition(admin, business.id, "CLIENT_INVITED").onboardingState).toBe("CLIENT_INVITED");
    expect(() => service.transition(admin, business.id, "LIVE")).toThrow("INVALID_ONBOARDING_TRANSITION");
    const announcement = service.saveAnnouncement(admin, { businessId: business.id, content: "Delivery delayed", priority: 80, active: true, startsAt: "2026-09-22T00:00:00.000Z", expiresAt: "2026-09-24T00:00:00.000Z", channels: ["test"], agentIds: [], source: "Ops" });
    const active = service.activeAnnouncements(business.id, new Date("2026-09-23T00:00:00.000Z"), { channel: "test", agentId: "a" });
    expect(active[0]?.provenance.sourceId).toBe(announcement.id);
    expect(service.activeAnnouncements(business.id, new Date("2026-09-25T00:00:00.000Z"), { channel: "test", agentId: "a" })).toHaveLength(0);
    expect(audit.list(new Set([business.id])).items.map((entry) => entry.action)).toContain("announcement.created");
  });

  test("memory inspector exposes source navigation, expiry, outdated state and audits edits", () => {
    const audit = new AuditLogService(); const inspector = new MemoryInspectorService(audit); const businessId = "business";
    inspector.memories.set("memory", { id: "memory", businessId, conversationId: "conversation", type: "preference", content: "Blue", importance: 0.8, createdBy: "agent", createdAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-02-01T00:00:00.000Z", status: "ACTIVE", sourceMessageIds: ["message"] });
    const actor = { ...admin, allowedBusinessIds: new Set([businessId]) };
    expect(inspector.list(actor, businessId, new Date("2026-03-01T00:00:00.000Z"))[0]?.status).toBe("EXPIRED");
    expect(inspector.list(actor, businessId)[0]?.sourceNavigation?.conversationId).toBe("conversation");
    inspector.update(actor, businessId, "memory", { status: "OUTDATED" });
    expect(audit.list(new Set([businessId])).items[0]?.action).toBe("memory.updated");
    expect(() => inspector.update(support, businessId, "memory", { status: "ACTIVE" })).toThrow("FORBIDDEN");
  });
});
