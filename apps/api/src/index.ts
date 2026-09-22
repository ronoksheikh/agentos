import { z } from "zod";
import type { AuthenticatedPrincipal, TrustedContextAuthorizer } from "@agentos/auth";
import type { AgentRuntime, AgentRunResult } from "@agentos/agent-runtime";
import { agentEventSchema } from "@agentos/events";
import { ulidSchema } from "@agentos/shared";

export const WS_PATH = "/ws";
export const API_PATHS = {
  session: "/api/session", sessions: "/api/sessions", users: "/api/users", invitations: "/api/invitations",
  businesses: "/api/businesses", business: "/api/businesses/:businessId", onboarding: "/api/businesses/:businessId/onboarding", announcements: "/api/businesses/:businessId/announcements",
  agents: "/api/businesses/:businessId/agents", agentVersion: "/api/agents/:agentId/versions/:versionId", publishVersion: "/api/agents/:agentId/versions/:versionId/publish", rollbackVersion: "/api/agents/:agentId/versions/:versionId/rollback",
  playgroundConversations: "/api/playground/conversations", playgroundMessages: "/api/playground/conversations/:conversationId/messages",
  testRun: "/api/runs/test", runDetail: "/api/runs/:runId", toolCalls: "/api/runs/:runId/tool-calls", actions: "/api/runs/:runId/actions", traces: "/api/traces/:traceId",
  conversations: "/api/conversations", memories: "/api/businesses/:businessId/memories", pins: "/api/businesses/:businessId/pins", goals: "/api/businesses/:businessId/goals",
  toolPolicies: "/api/businesses/:businessId/tool-policies", audits: "/api/audit-logs", featureFlags: "/api/feature-flags", counters: "/api/operations/counters",
} as const;
export const testRunRequestSchema = z.object({ businessId: ulidSchema, agentId: ulidSchema, testVersionId: ulidSchema.optional(), event: agentEventSchema, debug: z.boolean().default(false) });
export const cursorQuerySchema = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
export const conversationSearchSchema = cursorQuerySchema.extend({ businessId: ulidSchema.optional(), query: z.string().max(500).optional(), phone: z.string().max(40).optional(), orderId: z.string().max(100).optional(), conversationId: ulidSchema.optional(), tag: z.string().max(100).optional(), channel: z.string().max(100).optional(), handoffState: z.string().max(100).optional(), dateFrom: z.iso.datetime({ offset: true }).optional(), dateTo: z.iso.datetime({ offset: true }).optional(), unread: z.coerce.boolean().optional(), agentId: ulidSchema.optional() });

export const endpointCapabilities: Record<string, string> = {
  [API_PATHS.session]: "business.read", [API_PATHS.sessions]: "session.manage", [API_PATHS.users]: "agency.manage", [API_PATHS.invitations]: "member.manage",
  [API_PATHS.businesses]: "business.read", [API_PATHS.business]: "business.read", [API_PATHS.onboarding]: "business.manage", [API_PATHS.announcements]: "business.manage",
  [API_PATHS.agents]: "agent.manage", [API_PATHS.agentVersion]: "agent.manage", [API_PATHS.publishVersion]: "agent.manage", [API_PATHS.rollbackVersion]: "agent.manage",
  [API_PATHS.playgroundConversations]: "run.execute", [API_PATHS.playgroundMessages]: "run.execute", [API_PATHS.runDetail]: "run.read", [API_PATHS.toolCalls]: "run.read", [API_PATHS.actions]: "run.read", [API_PATHS.traces]: "run.read",
  [API_PATHS.conversations]: "conversation.read", [API_PATHS.memories]: "conversation.read", [API_PATHS.pins]: "memory.manage", [API_PATHS.goals]: "memory.manage", [API_PATHS.toolPolicies]: "tool_policy.manage", [API_PATHS.audits]: "audit.read", [API_PATHS.featureFlags]: "feature_flag.manage", [API_PATHS.counters]: "business.read",
};

export function createTestRunHandler(authorizer: TrustedContextAuthorizer, runtime: AgentRuntime) {
  return async (principal: AuthenticatedPrincipal, unsafeInput: unknown): Promise<AgentRunResult> => {
    if (principal.accountState !== "ACTIVE") throw new Error("ACCOUNT_DISABLED");
    const request = testRunRequestSchema.parse(unsafeInput);
    const context = await authorizer.authorize(principal, request.businessId, "run.execute");
    if (context.businessId !== request.businessId || context.agentId !== request.agentId) throw new Error("AUTHORIZED_SCOPE_MISMATCH");
    return runtime.run({ context, event: request.event, agentId: request.agentId, ...(request.testVersionId ? { testVersionId: request.testVersionId } : {}), debug: request.debug });
  };
}
