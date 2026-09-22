import type { ActionRepository, DomainActionHandler, IdempotentActionExecutor, AgentAction, ActionRecord } from "./index";
import { domainActionSchema, universalChannelActionSchema } from "./index";
import type { TrustedBusinessContext } from "@agentos/shared";

export class DeferredChannelActionExecutor implements IdempotentActionExecutor {
  constructor(private readonly repository: ActionRepository, private readonly domainHandler: DomainActionHandler) {}
  async execute(context: TrustedBusinessContext, runId: string, action: AgentAction): Promise<ActionRecord> {
    const reserved = await this.repository.reserve(context, runId, action); if (reserved.duplicate) return reserved.record;
    try {
      if (universalChannelActionSchema.safeParse(action).success) await this.repository.updateStatus(context, action.id, "DEFERRED");
      else {
        const required = action.type === "RequestHuman" ? "handoff.request" : action.type === "Remember" || action.type === "UpdateMemory" || action.type === "PinMessage" || action.type === "UnpinMessage" ? "memory.manage" : "pending_goal.manage";
        if (!context.capabilityGrants.includes(required)) throw new Error("Action permission denied");
        await this.domainHandler.apply(context, runId, domainActionSchema.parse(action)); await this.repository.updateStatus(context, action.id, "APPLIED");
      }
    } catch { await this.repository.updateStatus(context, action.id, "FAILED", { code: "ACTION_APPLY_FAILED", message: "Action could not be applied" }); }
    return (await this.repository.listForRun(context, runId)).find((record) => record.id === action.id)!;
  }
}
