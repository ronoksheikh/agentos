import { ulid } from "ulid";
import { agentVersionConfigSchema, type Agent, type AgentVersion } from "@agentos/agents";
import { createTrustedBusinessContext } from "@agentos/shared";
import type { AgentEvent } from "@agentos/events";

export const ids = {
  businessA: ulid(), businessB: ulid(), user: ulid(), agent: ulid(), version: ulid(), conversation: ulid(), customer: ulid(), message: ulid(), trace: ulid(),
};

export const config = agentVersionConfigSchema.parse({
  name: "Test agent", instructions: "Answer safely and concisely.", models: { primary: { provider: "fake", model: "deterministic-v1" } },
  enabledTools: ["demo_lookup"], runtimeLimits: { maxSteps: 4, maxToolCalls: 3, maxRuntimeMs: 5_000, maxContextTokens: 1_000, maxOutputTokens: 200 },
  contextPolicy: { recentMessageLimit: 2, includeMemories: true, includePins: true },
});

export function createAgentFixture(overrides: Partial<AgentVersion["config"]> = {}): { agent: Agent; version: AgentVersion } {
  const now = new Date().toISOString();
  const merged = agentVersionConfigSchema.parse({ ...config, ...overrides, runtimeLimits: { ...config.runtimeLimits, ...overrides.runtimeLimits } });
  return {
    agent: { id: ids.agent, businessId: ids.businessA, name: "Test agent", activeVersionId: ids.version, createdAt: now, updatedAt: now },
    version: { id: ids.version, businessId: ids.businessA, agentId: ids.agent, version: 1, state: "PUBLISHED", config: merged, createdBy: ids.user, createdAt: now, publishedAt: now },
  };
}

export function trusted(businessId = ids.businessA, signal = new AbortController().signal) {
  return createTrustedBusinessContext({ businessId, principal: { kind: "user", userId: ids.user, sessionId: "session" }, source: "test_harness", agentId: ids.agent, conversationId: ids.conversation, customerId: ids.customer, traceId: ids.trace, capabilityGrants: ["tool.demo.read", "memory.read", "memory.manage", "conversation.read", "handoff.request", "pending_goal.manage"] }, signal);
}

export function event(businessId = ids.businessA): AgentEvent {
  return { id: ulid(), schemaVersion: "1.0", type: "message.received", businessId, channel: "test_channel", conversationId: ids.conversation, customerId: ids.customer, occurredAt: new Date().toISOString(), dedupeKey: `test:${ulid()}`, source: { kind: "test" }, payload: { messageId: ids.message, text: "Hello", attachmentIds: [], inboundSequence: 1 } };
}
