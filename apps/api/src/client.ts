import type { AuthenticatedPrincipal, BusinessMembershipService } from "@agentos/auth";
import type { ClientActorResolver, ClientDashboardService } from "@agentos/client-operations";
import type { HandoffService } from "@agentos/handoff";
import type { WebsiteContractService } from "@agentos/website-sdk";
import { conversationSearchSchema } from "./index";

export class ClientApi {
  constructor(private readonly deps: { actors: ClientActorResolver; memberships: BusinessMembershipService; dashboard: ClientDashboardService; handoffs: HandoffService; website: WebsiteContractService }) {}
  private handoffActor(principal: AuthenticatedPrincipal, businessId: string, capability: string) { const actor = this.deps.actors.resolve(principal, businessId, capability); return { userId: actor.principal.userId, membership: actor.membership }; }
  businesses(principal: AuthenticatedPrincipal) { return this.deps.actors.businesses(principal); }
  conversations(principal: AuthenticatedPrincipal, businessId: string, input: unknown) { const actor = this.deps.actors.resolve(principal, businessId, "conversation.read"); const query = conversationSearchSchema.omit({ businessId: true }).parse(input); const { cursor, limit, ...raw } = query; return this.deps.dashboard.search(actor, Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined)), cursor, limit); }
  conversation(principal: AuthenticatedPrincipal, businessId: string, conversationId: string) { return this.deps.dashboard.detail(this.deps.actors.resolve(principal, businessId, "conversation.read"), conversationId); }
  counters(principal: AuthenticatedPrincipal, businessId: string) { return this.deps.dashboard.counters(this.deps.actors.resolve(principal, businessId)); }
  activity(principal: AuthenticatedPrincipal, businessId: string, runId: string) { return this.deps.dashboard.activities(this.deps.actors.resolve(principal, businessId, "run.read"), runId); }
  handoffs(principal: AuthenticatedPrincipal, businessId: string) { return this.deps.handoffs.list(this.handoffActor(principal, businessId, "conversation.read")); }
  takeOver(principal: AuthenticatedPrincipal, businessId: string, handoffId: string) { return this.deps.handoffs.takeOver(this.handoffActor(principal, businessId, "handoff.manage"), handoffId); }
  resolve(principal: AuthenticatedPrincipal, businessId: string, handoffId: string, resolution: string) { return this.deps.handoffs.resolve(this.handoffActor(principal, businessId, "handoff.manage"), handoffId, resolution); }
  resume(principal: AuthenticatedPrincipal, businessId: string, handoffId: string) { return this.deps.handoffs.resumeAgent(this.handoffActor(principal, businessId, "handoff.manage"), handoffId); }
  acknowledge(principal: AuthenticatedPrincipal, businessId: string, notificationId: string) { return this.deps.handoffs.acknowledgeNotification(this.handoffActor(principal, businessId, "notification.manage"), notificationId); }
  bootstrap(input: Parameters<WebsiteContractService["bootstrap"]>[0]) { return this.deps.website.bootstrap(input); }
}
