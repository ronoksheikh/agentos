import { describe, expect, test } from "bun:test";
import { AgentConfigurationService, AuditLogService, FeatureFlagService, OperationalQueryService } from "@agentos/control-plane";
import { config } from "./helpers";

const actor = { userId: "admin", role: "ADMIN" as const, allowedBusinessIds: new Set(["a"]) };

describe("phase 2 agent versions and operations", () => {
  test("isolates drafts, handles concurrency, publish, rollback, archive and audit", () => {
    const audit = new AuditLogService(); const agents = new AgentConfigurationService(audit);
    const v1 = agents.createDraft(actor, { businessId: "a", agentId: "agent", config });
    const published1 = agents.publish(actor, v1.id); expect(published1.state).toBe("PUBLISHED");
    const v2 = agents.createDraft(actor, { businessId: "a", agentId: "agent", basedOnVersionId: v1.id, config: { ...config, tone: "brief" } });
    expect(agents.versions.get(v1.id)?.config.tone).not.toBe("brief");
    expect(() => agents.updateDraft(actor, v2.id, config, 99)).toThrow("CONCURRENT_EDIT");
    agents.selectForTest(actor, v2.id); agents.publish(actor, v2.id); expect(agents.activeVersions.get("a:agent")).toBe(v2.id);
    agents.rollback(actor, v1.id); expect(agents.activeVersions.get("a:agent")).toBe(v1.id);
    expect(() => agents.archive(actor, v1.id)).toThrow("ACTIVE_VERSION_CANNOT_ARCHIVE");
    agents.archive(actor, v2.id); expect(agents.versions.get(v2.id)?.state).toBe("ARCHIVED");
    expect(audit.list(new Set(["a"])).items.some((entry) => entry.action === "agent.version.rolled_back")).toBe(true);
  });

  test("rejects unbounded timing and untruthful disclosure on publish", () => {
    const agents = new AgentConfigurationService(new AuditLogService());
    const timing = agents.createDraft(actor, { businessId: "a", agentId: "agent", config: { ...config, responseTimingPolicy: { ...config.responseTimingPolicy, minPreSendDelayMs: 10_000, maxPreSendDelayMs: 2_000 } } });
    expect(() => agents.publish(actor, timing.id)).toThrow("INCOMPATIBLE_TIMING_POLICY");
    const disclosure = agents.createDraft(actor, { businessId: "a", agentId: "agent2", config: { ...config, disclosurePolicy: { discloseWhenAsked: false, statement: "I am human" } } });
    expect(() => agents.publish(actor, disclosure.id)).toThrow("UNTRUTHFUL_DISCLOSURE_POLICY");
  });

  test("searches within tenant scope and computes replay-safe counters", () => {
    const service = new OperationalQueryService();
    service.conversations.set("c1", { id: "c1", businessId: "a", customerName: "Amina", verifiedPhone: "+8801", orderIds: ["order-1"], messageText: "refund", tags: ["vip"], channel: "test", handoffState: "HANDOFF_REQUESTED", occurredAt: "2026-09-22T00:00:00.000Z", unread: true, agentId: "agent", failedRun: true, urgent: true });
    service.conversations.set("c2", { id: "c2", businessId: "b", customerName: "Hidden", orderIds: [], messageText: "hidden", tags: [], channel: "test", handoffState: "AI_ACTIVE", occurredAt: "2026-09-22T00:00:00.000Z", unread: true, failedRun: false, urgent: false });
    expect(service.search(actor, { query: "refund" }).items.map((row) => row.id)).toEqual(["c1"]);
    expect(service.counters(actor)).toEqual({ unreadConversations: 1, unresolvedHandoffs: 1, failedRuns: 1, urgentIssues: 1 });
    expect(service.applyRealtimeEvent({ id: "event", businessId: "a", type: "conversation.updated" })).toBe(true);
    expect(service.applyRealtimeEvent({ id: "event", businessId: "a", type: "conversation.updated" })).toBe(false);
  });

  test("feature flags are tenant-safe, audited and revision checked", () => {
    const audit = new AuditLogService(); const flags = new FeatureFlagService(audit);
    const flag = flags.set(actor, { key: "advanced_memory", businessId: "a", enabled: true });
    expect(flag.revision).toBe(1);
    expect(() => flags.set(actor, { key: "advanced_memory", businessId: "a", enabled: false, expectedRevision: 0 })).toThrow("CONCURRENT_EDIT");
  });
});
