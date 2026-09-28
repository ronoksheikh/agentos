import { ulid } from "ulid";
import { createTrustedBusinessContext } from "@agentos/shared";
import type { AgentEvaluationCase, EvaluationObservation, AgentVersion } from "@agentos/agents";
import type { AgentRuntime } from "./index";

/** Executes a candidate through AgentRuntime while suppressing external actions and tools. */
export class AgentRuntimeEvaluationAdapter {
  constructor(private readonly createRuntime: (version: AgentVersion, scenario: AgentEvaluationCase) => AgentRuntime) {}

  async execute(version: AgentVersion, scenario: AgentEvaluationCase): Promise<EvaluationObservation> {
    const traceId = ulid(); const conversationId = ulid(); const customerId = ulid();
    const event = {
      id: ulid(), schemaVersion: "1.0" as const, type: "message.received" as const, businessId: version.businessId,
      channel: "evaluation", conversationId, customerId, occurredAt: new Date().toISOString(), dedupeKey: `evaluation:${scenario.id}:${ulid()}`,
      source: { kind: "test" as const }, payload: { messageId: ulid(), text: scenario.input, attachmentIds: [], inboundSequence: 1 },
    };
    const context = createTrustedBusinessContext({ businessId: version.businessId, principal: { kind: "system", service: "evaluation" }, capabilityGrants: [], source: "internal_system", agentId: version.agentId, conversationId, customerId, traceId });
    const result = await this.createRuntime(version, scenario).run({ context, event, agentId: version.agentId, testVersionId: version.id, draftOnly: true });
    return { status: result.status, actionTypes: result.actions.map((action) => action.type), ...(result.safeError ? { safeFailureCode: result.safeError.code } : {}) };
  }
}
