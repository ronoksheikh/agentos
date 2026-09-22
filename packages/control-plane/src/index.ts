import { ulid } from "ulid";
import { z } from "zod";
import type { AgentRuntime, AgentRunResult } from "@agentos/agent-runtime";
import { agentVersionConfigSchema, type AgentVersionConfig } from "@agentos/agents";
import type { AuthenticatedPrincipal, AgencyRole } from "@agentos/auth";
import { requireAgencyCapability } from "@agentos/auth";
import type { AgentEvent } from "@agentos/events";
import { createTrustedBusinessContext, redactSafe, type JsonValue } from "@agentos/shared";

export const onboardingStateSchema = z.enum(["CREATED", "CLIENT_INVITED", "BUSINESS_INFO_READY", "KNOWLEDGE_PENDING", "AGENT_CONFIGURED", "AGENT_TESTED", "CHANNEL_PENDING", "PUBLISHED", "LIVE"]);
export type OnboardingState = z.infer<typeof onboardingStateSchema>;
const onboardingOrder = onboardingStateSchema.options;

const contactSchema = z.object({ label: z.string().min(1).max(80), value: z.string().min(1).max(300), type: z.enum(["EMAIL", "PHONE", "URL", "OTHER"]) });
const locationSchema = z.object({ label: z.string().min(1).max(100), address: z.string().min(1).max(500), timezone: z.string().min(1).max(100).optional() });
const hoursSchema = z.object({ day: z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]), closed: z.boolean().default(false), opensAt: z.string().regex(/^\d{2}:\d{2}$/).optional(), closesAt: z.string().regex(/^\d{2}:\d{2}$/).optional() });
const questionSchema = z.object({ question: z.string().min(1).max(500), answer: z.string().min(1).max(3_000) });

export const businessProfileSchema = z.object({
  identity: z.object({ name: z.string().min(1).max(200), legalName: z.string().max(200).optional(), description: z.string().max(5_000).default("") }),
  tone: z.string().max(2_000).default("clear and helpful"), languages: z.array(z.string().min(2).max(20)).min(1).default(["en"]),
  openingHours: z.array(hoursSchema).default([]), contacts: z.array(contactSchema).default([]), locations: z.array(locationSchema).default([]),
  delivery: z.object({ summary: z.string().max(4_000).default(""), regions: z.array(z.string().max(100)).default([]) }).default({ summary: "", regions: [] }),
  returnsAndRefunds: z.string().max(5_000).default(""), orderRules: z.array(z.string().max(1_000)).default([]), escalationRules: z.array(z.string().max(1_000)).default([]),
  brandInstructions: z.string().max(5_000).default(""), commonQuestions: z.array(questionSchema).default([]),
});
export type BusinessProfile = z.infer<typeof businessProfileSchema>;

export const businessSchema = z.object({ id: z.string(), name: z.string(), disabled: z.boolean(), onboardingState: onboardingStateSchema, profile: businessProfileSchema, assignedAgentIds: z.array(z.string()), revision: z.number().int().positive(), createdAt: z.string(), updatedAt: z.string() });
export type BusinessRecord = z.infer<typeof businessSchema>;

export const announcementSchema = z.object({ id: z.string(), businessId: z.string(), content: z.string().min(1).max(4_000), priority: z.number().int().min(0).max(100), active: z.boolean(), startsAt: z.string(), expiresAt: z.string(), channels: z.array(z.string()), agentIds: z.array(z.string()), source: z.string().max(500).nullable(), createdBy: z.string(), createdAt: z.string(), updatedAt: z.string() });
export type BusinessAnnouncement = z.infer<typeof announcementSchema>;

export interface AuditRecord { id: string; businessId: string | null; actorId: string; action: string; targetType: string; targetId: string; safeMetadata: JsonValue; occurredAt: string }

export class AuditLogService {
  private readonly entries: AuditRecord[] = [];
  append(input: Omit<AuditRecord, "id" | "occurredAt" | "safeMetadata"> & { safeMetadata?: unknown }, now = new Date()) {
    const entry: AuditRecord = { id: ulid(), ...input, safeMetadata: redactSafe(input.safeMetadata ?? {}), occurredAt: now.toISOString() };
    this.entries.push(entry); return structuredClone(entry);
  }
  list(allowedBusinessIds: ReadonlySet<string>, includeAgencyWide = false, cursor?: string, limit = 50) {
    const visible = this.entries.filter((entry) => (entry.businessId === null ? includeAgencyWide : allowedBusinessIds.has(entry.businessId))).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const start = cursor ? Math.max(0, visible.findIndex((entry) => entry.id === cursor) + 1) : 0;
    const items = visible.slice(start, start + Math.min(limit, 100));
    return { items: structuredClone(items), nextCursor: visible[start + items.length]?.id ?? null };
  }
}

export type AgencyActor = { userId: string; role: AgencyRole; capabilities?: string[]; allowedBusinessIds?: ReadonlySet<string> };
const requireBusiness = (actor: AgencyActor, businessId: string, capability: string) => {
  requireAgencyCapability(actor, capability);
  if (actor.allowedBusinessIds && !actor.allowedBusinessIds.has(businessId)) throw new Error("FORBIDDEN");
};

export class BusinessControlPlane {
  readonly businesses = new Map<string, BusinessRecord>(); readonly announcements = new Map<string, BusinessAnnouncement>();
  constructor(private readonly audit: AuditLogService) {}
  create(actor: AgencyActor, input: { name: string; profile?: unknown }, now = new Date()) {
    requireAgencyCapability(actor, "business.manage");
    const profile = businessProfileSchema.parse(input.profile ?? { identity: { name: input.name, description: "" } });
    const business = businessSchema.parse({ id: ulid(), name: input.name, disabled: false, onboardingState: "CREATED", profile, assignedAgentIds: [], revision: 1, createdAt: now.toISOString(), updatedAt: now.toISOString() });
    this.businesses.set(business.id, business); this.audit.append({ businessId: business.id, actorId: actor.userId, action: "business.created", targetType: "business", targetId: business.id }); return structuredClone(business);
  }
  get(actor: AgencyActor, businessId: string) { requireBusiness(actor, businessId, "business.read"); const business = this.businesses.get(businessId); if (!business) throw new Error("BUSINESS_NOT_FOUND"); return structuredClone(business); }
  list(actor: AgencyActor) { requireAgencyCapability(actor, "business.read"); return [...this.businesses.values()].filter((b) => !actor.allowedBusinessIds || actor.allowedBusinessIds.has(b.id)).map((b) => structuredClone(b)); }
  updateProfile(actor: AgencyActor, businessId: string, unsafeProfile: unknown, expectedRevision: number, now = new Date()) {
    requireBusiness(actor, businessId, "business.manage"); const business = this.businesses.get(businessId); if (!business) throw new Error("BUSINESS_NOT_FOUND"); if (business.revision !== expectedRevision) throw new Error("CONCURRENT_EDIT");
    business.profile = businessProfileSchema.parse(unsafeProfile); business.name = business.profile.identity.name; business.revision++; business.updatedAt = now.toISOString();
    this.audit.append({ businessId, actorId: actor.userId, action: "business.profile.updated", targetType: "business", targetId: businessId, safeMetadata: { revision: business.revision } }); return structuredClone(business);
  }
  transition(actor: AgencyActor, businessId: string, next: OnboardingState, now = new Date()) {
    requireBusiness(actor, businessId, "business.manage"); const business = this.businesses.get(businessId); if (!business) throw new Error("BUSINESS_NOT_FOUND");
    const currentIndex = onboardingOrder.indexOf(business.onboardingState); const nextIndex = onboardingOrder.indexOf(next); if (nextIndex !== currentIndex + 1 && !(business.onboardingState === "LIVE" && next === "PUBLISHED")) throw new Error("INVALID_ONBOARDING_TRANSITION");
    const previous = business.onboardingState; business.onboardingState = next; business.revision++; business.updatedAt = now.toISOString();
    this.audit.append({ businessId, actorId: actor.userId, action: "business.onboarding.transitioned", targetType: "business", targetId: businessId, safeMetadata: { previous, next } }); return structuredClone(business);
  }
  disable(actor: AgencyActor, businessId: string, disabled = true) { requireBusiness(actor, businessId, "business.manage"); const business = this.businesses.get(businessId); if (!business) throw new Error("BUSINESS_NOT_FOUND"); business.disabled = disabled; business.revision++; business.updatedAt = new Date().toISOString(); this.audit.append({ businessId, actorId: actor.userId, action: disabled ? "business.disabled" : "business.enabled", targetType: "business", targetId: businessId }); }
  assignAgent(actor: AgencyActor, businessId: string, agentId: string) { requireBusiness(actor, businessId, "agent.manage"); const business = this.businesses.get(businessId); if (!business) throw new Error("BUSINESS_NOT_FOUND"); if (!business.assignedAgentIds.includes(agentId)) business.assignedAgentIds.push(agentId); this.audit.append({ businessId, actorId: actor.userId, action: "business.agent.assigned", targetType: "agent", targetId: agentId }); }
  saveAnnouncement(actor: AgencyActor, input: unknown, now = new Date()) {
    const parsed = announcementSchema.omit({ id: true, createdBy: true, createdAt: true, updatedAt: true }).parse(input); requireBusiness(actor, parsed.businessId, "business.manage"); if (parsed.expiresAt <= parsed.startsAt) throw new Error("INVALID_ANNOUNCEMENT_WINDOW");
    const existingId = typeof input === "object" && input && "id" in input ? String(input.id) : undefined; const existing = existingId ? this.announcements.get(existingId) : undefined;
    if (existing && existing.businessId !== parsed.businessId) throw new Error("TENANT_SCOPE_VIOLATION");
    const record = announcementSchema.parse({ ...parsed, id: existing?.id ?? ulid(), createdBy: existing?.createdBy ?? actor.userId, createdAt: existing?.createdAt ?? now.toISOString(), updatedAt: now.toISOString() });
    this.announcements.set(record.id, record); this.audit.append({ businessId: record.businessId, actorId: actor.userId, action: existing ? "announcement.updated" : "announcement.created", targetType: "announcement", targetId: record.id, safeMetadata: { active: record.active, priority: record.priority } }); return structuredClone(record);
  }
  activeAnnouncements(businessId: string, at: Date, scope: { channel: string; agentId: string }) { const now = at.toISOString(); return [...this.announcements.values()].filter((a) => a.businessId === businessId && a.active && a.startsAt <= now && a.expiresAt > now && (!a.channels.length || a.channels.includes(scope.channel)) && (!a.agentIds.length || a.agentIds.includes(scope.agentId))).sort((a, b) => b.priority - a.priority).map((a) => ({ ...structuredClone(a), provenance: { sourceType: "announcements", sourceId: a.id, label: "Active business announcement", reason: "Active and in scope" } })); }
}

export const managedAgentVersionSchema = z.object({ id: z.string(), businessId: z.string(), agentId: z.string(), version: z.number().int().positive(), state: z.enum(["DRAFT", "TEST", "PUBLISHED", "ARCHIVED"]), config: agentVersionConfigSchema, revision: z.number().int().positive(), createdBy: z.string(), createdAt: z.string(), updatedAt: z.string(), publishedAt: z.string().nullable(), basedOnVersionId: z.string().nullable() });
export type ManagedAgentVersion = z.infer<typeof managedAgentVersionSchema>;

export class AgentConfigurationService {
  readonly versions = new Map<string, ManagedAgentVersion>(); readonly activeVersions = new Map<string, string>();
  constructor(private readonly audit: AuditLogService) {}
  createDraft(actor: AgencyActor, input: { businessId: string; agentId: string; config: unknown; basedOnVersionId?: string }, now = new Date()) {
    requireBusiness(actor, input.businessId, "agent.manage"); const existing = [...this.versions.values()].filter((v) => v.businessId === input.businessId && v.agentId === input.agentId); const basedOn = input.basedOnVersionId ? this.versions.get(input.basedOnVersionId) : undefined;
    if (input.basedOnVersionId && (!basedOn || basedOn.businessId !== input.businessId || basedOn.agentId !== input.agentId)) throw new Error("VERSION_NOT_FOUND");
    const version = managedAgentVersionSchema.parse({ id: ulid(), businessId: input.businessId, agentId: input.agentId, version: Math.max(0, ...existing.map((v) => v.version)) + 1, state: "DRAFT", config: input.config, revision: 1, createdBy: actor.userId, createdAt: now.toISOString(), updatedAt: now.toISOString(), publishedAt: null, basedOnVersionId: basedOn?.id ?? null });
    this.versions.set(version.id, version); this.audit.append({ businessId: input.businessId, actorId: actor.userId, action: "agent.version.draft.created", targetType: "agent_version", targetId: version.id }); return structuredClone(version);
  }
  updateDraft(actor: AgencyActor, versionId: string, config: unknown, expectedRevision: number, now = new Date()) { const version = this.versions.get(versionId); if (!version) throw new Error("VERSION_NOT_FOUND"); requireBusiness(actor, version.businessId, "agent.manage"); if (!['DRAFT', 'TEST'].includes(version.state)) throw new Error("IMMUTABLE_VERSION"); if (version.revision !== expectedRevision) throw new Error("CONCURRENT_EDIT"); version.config = agentVersionConfigSchema.parse(config); version.revision++; version.updatedAt = now.toISOString(); this.audit.append({ businessId: version.businessId, actorId: actor.userId, action: "agent.version.updated", targetType: "agent_version", targetId: version.id, safeMetadata: { revision: version.revision } }); return structuredClone(version); }
  selectForTest(actor: AgencyActor, versionId: string) { const version = this.versions.get(versionId); if (!version) throw new Error("VERSION_NOT_FOUND"); requireBusiness(actor, version.businessId, "run.execute"); if (version.state === "ARCHIVED") throw new Error("VERSION_NOT_RUNNABLE"); if (version.state === "DRAFT") version.state = "TEST"; this.audit.append({ businessId: version.businessId, actorId: actor.userId, action: "agent.version.test.selected", targetType: "agent_version", targetId: version.id }); return structuredClone(version); }
  private validateCompatibility(config: AgentVersionConfig) { if (config.responseTimingPolicy.minPreSendDelayMs > config.responseTimingPolicy.maxPreSendDelayMs || config.responseTimingPolicy.maxPreSendDelayMs > config.responseTimingPolicy.maxCustomerWaitMs) throw new Error("INCOMPATIBLE_TIMING_POLICY"); if (!config.disclosurePolicy.discloseWhenAsked || !/automated|ai|virtual/i.test(config.disclosurePolicy.statement)) throw new Error("UNTRUTHFUL_DISCLOSURE_POLICY"); if (config.browserPolicy.enabled || config.knowledgePolicy.enabled) throw new Error("PHASE_CAPABILITY_UNAVAILABLE"); }
  publish(actor: AgencyActor, versionId: string, now = new Date()) { const version = this.versions.get(versionId); if (!version) throw new Error("VERSION_NOT_FOUND"); requireBusiness(actor, version.businessId, "agent.manage"); if (version.state === "ARCHIVED") throw new Error("VERSION_NOT_PUBLISHABLE"); this.validateCompatibility(version.config); const key = `${version.businessId}:${version.agentId}`; const priorId = this.activeVersions.get(key); if (priorId && priorId !== version.id) { const prior = this.versions.get(priorId); if (prior) prior.state = "ARCHIVED"; } version.state = "PUBLISHED"; version.publishedAt = now.toISOString(); version.updatedAt = now.toISOString(); this.activeVersions.set(key, version.id); this.audit.append({ businessId: version.businessId, actorId: actor.userId, action: "agent.version.published", targetType: "agent_version", targetId: version.id, safeMetadata: { previousVersionId: priorId ?? null } }); return structuredClone(version); }
  rollback(actor: AgencyActor, versionId: string, now = new Date()) { const target = this.versions.get(versionId); if (!target || !target.publishedAt) throw new Error("ROLLBACK_TARGET_INVALID"); requireBusiness(actor, target.businessId, "agent.manage"); this.validateCompatibility(target.config); const activeId = this.activeVersions.get(`${target.businessId}:${target.agentId}`); if (activeId) { const active = this.versions.get(activeId); if (active) active.state = "ARCHIVED"; } target.state = "PUBLISHED"; this.activeVersions.set(`${target.businessId}:${target.agentId}`, target.id); this.audit.append({ businessId: target.businessId, actorId: actor.userId, action: "agent.version.rolled_back", targetType: "agent_version", targetId: target.id, safeMetadata: { fromVersionId: activeId ?? null } }, now); return structuredClone(target); }
  archive(actor: AgencyActor, versionId: string) { const version = this.versions.get(versionId); if (!version) throw new Error("VERSION_NOT_FOUND"); requireBusiness(actor, version.businessId, "agent.manage"); if (this.activeVersions.get(`${version.businessId}:${version.agentId}`) === version.id) throw new Error("ACTIVE_VERSION_CANNOT_ARCHIVE"); version.state = "ARCHIVED"; this.audit.append({ businessId: version.businessId, actorId: actor.userId, action: "agent.version.archived", targetType: "agent_version", targetId: version.id }); }
}

export interface SearchConversation { id: string; businessId: string; customerName: string; verifiedPhone?: string; orderIds: string[]; messageText: string; tags: string[]; channel: string; handoffState: string; occurredAt: string; unread: boolean; agentId?: string; failedRun: boolean; urgent: boolean }
export class OperationalQueryService {
  readonly conversations = new Map<string, SearchConversation>(); private readonly appliedEvents = new Set<string>();
  search(actor: AgencyActor, filter: Partial<{ businessId: string; query: string; phone: string; orderId: string; conversationId: string; tag: string; channel: string; handoffState: string; dateFrom: string; dateTo: string; unread: boolean; agentId: string }>, cursor?: string, limit = 50) { requireAgencyCapability(actor, "conversation.read"); if (filter.businessId) requireBusiness(actor, filter.businessId, "conversation.read"); let rows = [...this.conversations.values()].filter((row) => !actor.allowedBusinessIds || actor.allowedBusinessIds.has(row.businessId)); if (filter.businessId) rows = rows.filter((r) => r.businessId === filter.businessId); if (filter.query) { const q = filter.query.toLowerCase(); rows = rows.filter((r) => [r.customerName, r.id, r.messageText, ...r.orderIds].some((v) => v.toLowerCase().includes(q))); } if (filter.phone) rows = rows.filter((r) => r.verifiedPhone === filter.phone); if (filter.orderId) rows = rows.filter((r) => r.orderIds.includes(filter.orderId!)); if (filter.conversationId) rows = rows.filter((r) => r.id === filter.conversationId); if (filter.tag) rows = rows.filter((r) => r.tags.includes(filter.tag!)); if (filter.channel) rows = rows.filter((r) => r.channel === filter.channel); if (filter.handoffState) rows = rows.filter((r) => r.handoffState === filter.handoffState); if (filter.dateFrom) rows = rows.filter((r) => r.occurredAt >= filter.dateFrom!); if (filter.dateTo) rows = rows.filter((r) => r.occurredAt <= filter.dateTo!); if (filter.unread !== undefined) rows = rows.filter((r) => r.unread === filter.unread); if (filter.agentId) rows = rows.filter((r) => r.agentId === filter.agentId); rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)); const start = cursor ? Math.max(0, rows.findIndex((r) => r.id === cursor) + 1) : 0; const items = rows.slice(start, start + Math.min(limit, 100)); return { items: structuredClone(items), nextCursor: rows[start + items.length]?.id ?? null }; }
  counters(actor: AgencyActor, businessId?: string) { const rows = this.search(actor, businessId ? { businessId } : {}, undefined, 100_000).items; return { unreadConversations: rows.filter((r) => r.unread).length, unresolvedHandoffs: rows.filter((r) => !["AI_ACTIVE", "RESOLVED"].includes(r.handoffState)).length, failedRuns: rows.filter((r) => r.failedRun).length, urgentIssues: rows.filter((r) => r.urgent).length }; }
  applyRealtimeEvent(event: { id: string; businessId: string; conversationId?: string; type: string }) { if (this.appliedEvents.has(event.id)) return false; this.appliedEvents.add(event.id); return true; }
}

export interface InspectableMemory { id: string; businessId: string; conversationId?: string; customerId?: string; type: string; content: string; importance: number; createdBy: string; createdAt: string; expiresAt: string | null; status: "ACTIVE" | "OUTDATED" | "EXPIRED"; sourceMessageIds: string[] }
export class MemoryInspectorService {
  readonly memories = new Map<string, InspectableMemory>(); readonly pins = new Map<string, { id: string; businessId: string; conversationId: string; messageId: string; label?: string }>(); readonly summaries = new Map<string, { id: string; businessId: string; conversationId: string; content: string; throughSequence: number }>(); readonly goals = new Map<string, { id: string; businessId: string; conversationId: string; description: string; state: string; expiresAt?: string }>();
  constructor(private readonly audit: AuditLogService) {}
  list(actor: AgencyActor, businessId: string, now = new Date()) { requireBusiness(actor, businessId, "conversation.read"); return [...this.memories.values()].filter((m) => m.businessId === businessId).map((m) => ({ ...structuredClone(m), status: m.status === "OUTDATED" ? "OUTDATED" as const : m.expiresAt && m.expiresAt <= now.toISOString() ? "EXPIRED" as const : "ACTIVE" as const, sourceNavigation: m.conversationId ? { conversationId: m.conversationId, messageIds: m.sourceMessageIds } : null })); }
  update(actor: AgencyActor, businessId: string, memoryId: string, input: { content?: string; status?: "ACTIVE" | "OUTDATED" }) { requireBusiness(actor, businessId, "memory.manage"); const memory = this.memories.get(memoryId); if (!memory || memory.businessId !== businessId) throw new Error("MEMORY_NOT_FOUND"); if (input.content !== undefined) memory.content = z.string().min(1).max(5_000).parse(input.content); if (input.status) memory.status = input.status; this.audit.append({ businessId, actorId: actor.userId, action: "memory.updated", targetType: "memory", targetId: memoryId, safeMetadata: { status: memory.status } }); return structuredClone(memory); }
}

export class FeatureFlagService {
  readonly flags = new Map<string, { key: string; businessId: string | null; enabled: boolean; revision: number }>();
  constructor(private readonly audit: AuditLogService) {}
  set(actor: AgencyActor, input: { key: string; businessId?: string; enabled: boolean; expectedRevision?: number }) { requireAgencyCapability(actor, "feature_flag.manage"); if (input.businessId) requireBusiness(actor, input.businessId, "feature_flag.manage"); const id = `${input.businessId ?? "global"}:${input.key}`; const existing = this.flags.get(id); if (existing && input.expectedRevision !== existing.revision) throw new Error("CONCURRENT_EDIT"); const flag = { key: input.key, businessId: input.businessId ?? null, enabled: input.enabled, revision: (existing?.revision ?? 0) + 1 }; this.flags.set(id, flag); this.audit.append({ businessId: flag.businessId, actorId: actor.userId, action: "feature_flag.changed", targetType: "feature_flag", targetId: id, safeMetadata: { enabled: flag.enabled, revision: flag.revision } }); return structuredClone(flag); }
}

export const playgroundFixtureSchema = z.enum(["GENERIC_WEBCHAT", "MESSENGER_MESSAGE", "COMMENT", "IMAGE_MESSAGE", "VOICE_TRANSCRIPT"]);
export class AgentPlaygroundService {
  readonly conversations = new Map<string, { id: string; businessId: string; agentId: string; versionId: string; disposable: true; createdAt: string }>();
  constructor(private readonly runtime: AgentRuntime, private readonly principal: AuthenticatedPrincipal, private readonly capabilities: string[]) {}
  create(input: { businessId: string; agentId: string; versionId: string }) { const id = ulid(); const conversation = { id, ...input, disposable: true as const, createdAt: new Date().toISOString() }; this.conversations.set(id, conversation); return structuredClone(conversation); }
  async send(conversationId: string, input: { text: string; fixture: z.infer<typeof playgroundFixtureSchema> }): Promise<AgentRunResult> { const conversation = this.conversations.get(conversationId); if (!conversation) throw new Error("PLAYGROUND_CONVERSATION_NOT_FOUND"); if (this.principal.accountState !== "ACTIVE") throw new Error("ACCOUNT_DISABLED"); const fixture = playgroundFixtureSchema.parse(input.fixture); const traceId = ulid(); const context = createTrustedBusinessContext({ businessId: conversation.businessId, principal: { kind: "user", userId: this.principal.userId, sessionId: this.principal.sessionId }, source: "test_harness", agentId: conversation.agentId, conversationId, traceId, capabilityGrants: this.capabilities.filter((capability) => !capability.includes("destructive")) }); const event: AgentEvent = { id: ulid(), schemaVersion: "1.0", type: "message.received", businessId: conversation.businessId, channel: `simulation:${fixture.toLowerCase()}`, conversationId, occurredAt: new Date().toISOString(), dedupeKey: `playground:${ulid()}`, source: { kind: "test", metadata: { fixture } }, payload: { messageId: ulid(), text: input.text, attachmentIds: fixture === "IMAGE_MESSAGE" || fixture === "VOICE_TRANSCRIPT" ? [ulid()] : [], inboundSequence: 1 } }; return this.runtime.run({ context, event, agentId: conversation.agentId, testVersionId: conversation.versionId, debug: true }); }
  reset(conversationId: string) { this.conversations.delete(conversationId); }
}
