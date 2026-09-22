import { ulid } from "ulid";
import type { AuthenticatedPrincipal } from "@agentos/auth";
import type { AgentConfigurationService, AgencyActor, AuditLogService, BusinessControlPlane, FeatureFlagService, MemoryInspectorService, OperationalQueryService } from "@agentos/control-plane";
import { AgentOSError, redactSafe } from "@agentos/shared";
import { conversationSearchSchema, cursorQuerySchema } from "./index";

export interface AgencyActorResolver { resolve(principal: AuthenticatedPrincipal): Promise<AgencyActor | null>; }

export class AgencyControlPlaneApi {
  constructor(private readonly deps: { actors: AgencyActorResolver; businesses: BusinessControlPlane; agents: AgentConfigurationService; operations: OperationalQueryService; memories: MemoryInspectorService; audits: AuditLogService; flags: FeatureFlagService }) {}
  private async actor(principal: AuthenticatedPrincipal) { if (principal.accountState !== "ACTIVE") throw new AgentOSError("UNAUTHORIZED", "Authentication required"); const actor = await this.deps.actors.resolve(principal); if (!actor) throw new AgentOSError("FORBIDDEN", "Agency membership required"); return actor; }
  async listBusinesses(principal: AuthenticatedPrincipal) { return this.deps.businesses.list(await this.actor(principal)); }
  async createBusiness(principal: AuthenticatedPrincipal, input: { name: string; profile?: unknown }) { return this.deps.businesses.create(await this.actor(principal), input); }
  async getBusiness(principal: AuthenticatedPrincipal, businessId: string) { return this.deps.businesses.get(await this.actor(principal), businessId); }
  async transitionOnboarding(principal: AuthenticatedPrincipal, businessId: string, next: Parameters<BusinessControlPlane["transition"]>[2]) { return this.deps.businesses.transition(await this.actor(principal), businessId, next); }
  async saveAnnouncement(principal: AuthenticatedPrincipal, input: unknown) { return this.deps.businesses.saveAnnouncement(await this.actor(principal), input); }
  async createAgentDraft(principal: AuthenticatedPrincipal, input: Parameters<AgentConfigurationService["createDraft"]>[1]) { return this.deps.agents.createDraft(await this.actor(principal), input); }
  async updateAgentDraft(principal: AuthenticatedPrincipal, versionId: string, config: unknown, expectedRevision: number) { return this.deps.agents.updateDraft(await this.actor(principal), versionId, config, expectedRevision); }
  async publishAgentVersion(principal: AuthenticatedPrincipal, versionId: string) { return this.deps.agents.publish(await this.actor(principal), versionId); }
  async rollbackAgentVersion(principal: AuthenticatedPrincipal, versionId: string) { return this.deps.agents.rollback(await this.actor(principal), versionId); }
  async archiveAgentVersion(principal: AuthenticatedPrincipal, versionId: string) { return this.deps.agents.archive(await this.actor(principal), versionId); }
  async searchConversations(principal: AuthenticatedPrincipal, input: unknown) { const query = conversationSearchSchema.parse(input); const { cursor, limit, ...rawFilter } = query; const filter = Object.fromEntries(Object.entries(rawFilter).filter(([, value]) => value !== undefined)) as Parameters<OperationalQueryService["search"]>[1]; return this.deps.operations.search(await this.actor(principal), filter, cursor, limit); }
  async counters(principal: AuthenticatedPrincipal, businessId?: string) { return this.deps.operations.counters(await this.actor(principal), businessId); }
  async inspectMemories(principal: AuthenticatedPrincipal, businessId: string) { return this.deps.memories.list(await this.actor(principal), businessId); }
  async updateMemory(principal: AuthenticatedPrincipal, businessId: string, memoryId: string, input: Parameters<MemoryInspectorService["update"]>[3]) { return this.deps.memories.update(await this.actor(principal), businessId, memoryId, input); }
  async setFeatureFlag(principal: AuthenticatedPrincipal, input: Parameters<FeatureFlagService["set"]>[1]) { return this.deps.flags.set(await this.actor(principal), input); }
  async listAudits(principal: AuthenticatedPrincipal, input: unknown) { const actor = await this.actor(principal); const query = cursorQuerySchema.parse(input); return this.deps.audits.list(actor.allowedBusinessIds ?? new Set(), actor.role === "SUPER_ADMIN", query.cursor, query.limit); }
}

export async function safeApiResponse<T>(work: () => Promise<T>) {
  const requestId = ulid();
  try { return { status: 200, body: { data: await work(), requestId } }; }
  catch (error) { const known = error instanceof AgentOSError; const code = known ? error.code : error instanceof Error && /^[A-Z][A-Z_]+$/.test(error.message) ? error.message : "REQUEST_FAILED"; const status = code === "UNAUTHORIZED" ? 401 : code === "FORBIDDEN" ? 403 : code === "CONCURRENT_EDIT" ? 409 : 400; return { status, body: { code, message: known ? error.message : code === "REQUEST_FAILED" ? "Request failed safely" : code.toLowerCase().replaceAll("_", " "), requestId, details: redactSafe(known ? error.safeDetails ?? {} : {}) } }; }
}
