import { z } from "zod";
import type { AuthenticatedPrincipal, TrustedContextAuthorizer } from "@agentos/auth";
import type { AgentRuntime, AgentRunResult } from "@agentos/agent-runtime";
import { agentEventSchema } from "@agentos/events";
import { ulidSchema } from "@agentos/shared";

export const WS_PATH = "/ws";
export const API_PATHS = { testRun: "/api/runs/test", runDetail: "/api/runs/:runId", agentVersion: "/api/agents/:agentId/versions/:versionId" } as const;
export const testRunRequestSchema = z.object({ businessId: ulidSchema, agentId: ulidSchema, testVersionId: ulidSchema.optional(), event: agentEventSchema, debug: z.boolean().default(false) });

export function createTestRunHandler(authorizer: TrustedContextAuthorizer, runtime: AgentRuntime) {
  return async (principal: AuthenticatedPrincipal, unsafeInput: unknown): Promise<AgentRunResult> => {
    if (principal.accountState !== "ACTIVE") throw new Error("ACCOUNT_DISABLED");
    const request = testRunRequestSchema.parse(unsafeInput);
    const context = await authorizer.authorize(principal, request.businessId, "run.execute");
    if (context.businessId !== request.businessId || context.agentId !== request.agentId) throw new Error("AUTHORIZED_SCOPE_MISMATCH");
    return runtime.run({ context, event: request.event, agentId: request.agentId, ...(request.testVersionId ? { testVersionId: request.testVersionId } : {}), debug: request.debug });
  };
}
