import { Phase5Operations, type Phase5Queues, type Phase5Store } from "@agentos/phase5";
import type { AgencyRole } from "@agentos/auth";

/** Framework-neutral Phase 5 API boundary; the HTTP host supplies the authenticated actor. */
export class Phase5Api {
  private readonly operations: Phase5Operations;
  constructor(store: Phase5Store, queues?: Phase5Queues) { this.operations = new Phase5Operations(store, queues); }
  status(actor: { userId: string; role: AgencyRole; capabilities?: readonly string[] }, businessId: string) { return this.operations.inspect(actor, businessId); }
  replay(actor: { userId: string; role: AgencyRole; capabilities?: readonly string[] }, input: unknown) { return this.operations.replay(actor, input); }
  cancel(actor: { userId: string; role: AgencyRole; capabilities?: readonly string[] }, businessId: string, workId: string) { return this.operations.cancel(actor, businessId, workId); }
}
