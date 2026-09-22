import { and, eq, desc } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ulid } from "ulid";
import * as dbs from "@agentos/database";
import { agentSchema, agentVersionSchema, type Agent, type AgentVersion, type AgentVersionRepository } from "@agentos/agents";
import { agentActionSchema, type ActionRecord, type ActionRepository, type AgentAction, type DomainAction, type DomainActionHandler } from "@agentos/actions";
import type { ContextSource } from "@agentos/context";
import type { AgentEvent } from "@agentos/events";
import type { JsonValue, TrustedBusinessContext } from "@agentos/shared";
import type { AgentRunRecord, AgentStepRecord, ToolCallRecord, TraceRepository } from "@agentos/trace";

const scope = (context: TrustedBusinessContext, businessId: string) => { if (context.businessId !== businessId) throw new Error("TENANT_SCOPE_VIOLATION"); };
const iso = (date: Date) => date.toISOString();

export class PostgresAgentVersionRepository implements AgentVersionRepository {
  constructor(private readonly db: NodePgDatabase) {}
  async getAgent(context: TrustedBusinessContext, id: string): Promise<Agent | null> { const row = (await this.db.select().from(dbs.agents).where(and(eq(dbs.agents.id, id), eq(dbs.agents.businessId, context.businessId))).limit(1))[0]; return row ? agentSchema.parse({ ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) }) : null; }
  async getVersion(context: TrustedBusinessContext, id: string): Promise<AgentVersion | null> { const row = (await this.db.select().from(dbs.agentVersions).where(and(eq(dbs.agentVersions.id, id), eq(dbs.agentVersions.businessId, context.businessId))).limit(1))[0]; return row ? agentVersionSchema.parse({ ...row, createdAt: iso(row.createdAt), publishedAt: row.publishedAt ? iso(row.publishedAt) : null }) : null; }
  async getActiveVersion(context: TrustedBusinessContext, agentId: string) { const agent = await this.getAgent(context, agentId); return agent?.activeVersionId ? this.getVersion(context, agent.activeVersionId) : null; }
  async saveVersion(context: TrustedBusinessContext, version: AgentVersion) { scope(context, version.businessId); await this.db.insert(dbs.agentVersions).values({ id: version.id, businessId: version.businessId, agentId: version.agentId, version: version.version, state: version.state, config: version.config, createdBy: version.createdBy, ...(version.publishedAt ? { publishedAt: new Date(version.publishedAt) } : {}) }); }
  async selectPublishedVersion(context: TrustedBusinessContext, agentId: string, versionId: string, actorId: string) { const version = await this.getVersion(context, versionId); if (!version || version.agentId !== agentId) throw new Error("VERSION_NOT_FOUND"); await this.db.transaction(async (tx) => { await tx.update(dbs.agentVersions).set({ state: "ARCHIVED" }).where(and(eq(dbs.agentVersions.businessId, context.businessId), eq(dbs.agentVersions.agentId, agentId), eq(dbs.agentVersions.state, "PUBLISHED"))); await tx.update(dbs.agentVersions).set({ state: "PUBLISHED", publishedAt: new Date() }).where(and(eq(dbs.agentVersions.id, versionId), eq(dbs.agentVersions.businessId, context.businessId))); await tx.update(dbs.agents).set({ activeVersionId: versionId, updatedAt: new Date() }).where(and(eq(dbs.agents.id, agentId), eq(dbs.agents.businessId, context.businessId))); await tx.insert(dbs.auditLogs).values({ id: ulid(), businessId: context.businessId, actorId, action: "agent.version.published", targetType: "agent", targetId: agentId, safeMetadata: { versionId } }); }); }
}

export class PostgresRuntimeContextSource implements ContextSource {
  constructor(private readonly db: NodePgDatabase) {}
  async load(context: TrustedBusinessContext, _version: AgentVersion, _event: AgentEvent) {
    const [business, recent, memories, summaries, goals] = await Promise.all([
      this.db.select({ name: dbs.businesses.name, profile: dbs.businesses.profile }).from(dbs.businesses).where(eq(dbs.businesses.id, context.businessId)).limit(1),
      context.conversationId ? this.db.select({ id: dbs.messages.id, text: dbs.messages.text, senderKind: dbs.messages.senderKind }).from(dbs.messages).where(and(eq(dbs.messages.businessId, context.businessId), eq(dbs.messages.conversationId, context.conversationId))).orderBy(desc(dbs.messages.occurredAt)).limit(20) : Promise.resolve([]),
      context.customerId ? this.db.select({ id: dbs.memories.id, content: dbs.memories.content }).from(dbs.memories).where(and(eq(dbs.memories.businessId, context.businessId), eq(dbs.memories.customerId, context.customerId))).limit(10) : Promise.resolve([]),
      context.conversationId ? this.db.select({ id: dbs.conversationSummaries.id, content: dbs.conversationSummaries.content }).from(dbs.conversationSummaries).where(and(eq(dbs.conversationSummaries.businessId, context.businessId), eq(dbs.conversationSummaries.conversationId, context.conversationId))).orderBy(desc(dbs.conversationSummaries.createdAt)).limit(1) : Promise.resolve([]),
      context.conversationId ? this.db.select({ id: dbs.pendingGoals.id, description: dbs.pendingGoals.description }).from(dbs.pendingGoals).where(and(eq(dbs.pendingGoals.businessId, context.businessId), eq(dbs.pendingGoals.conversationId, context.conversationId), eq(dbs.pendingGoals.state, "PENDING"))).limit(10) : Promise.resolve([]),
    ]);
    return { business: business[0] ? [{ sourceId: context.businessId, label: "Business profile", reason: "Trusted business policy", content: JSON.stringify({ name: business[0].name, profile: business[0].profile }).slice(0, 8000) }] : [], recent_messages: recent.reverse().map((row) => ({ sourceId: row.id, label: "Conversation message", reason: "Recent message", content: `${row.senderKind}: ${row.text ?? "[attachment]"}` })), customer_memory: memories.map((row) => ({ sourceId: row.id, label: "Customer memory", reason: "Active memory", content: row.content })), summary: summaries.map((row) => ({ sourceId: row.id, label: "Conversation summary", reason: "Latest summary", content: row.content })), pending_goals: goals.map((row) => ({ sourceId: row.id, label: "Pending goal", reason: "Active customer commitment", content: row.description })) };
  }
}

export class PostgresRuntimeTraceRepository implements TraceRepository {
  constructor(private readonly db: NodePgDatabase) {}
  async createRun(context: TrustedBusinessContext, run: AgentRunRecord) { scope(context, run.businessId); await this.db.insert(dbs.agentRuns).values({ id: run.id, businessId: run.businessId, agentId: run.agentId, agentVersionId: run.agentVersionId, conversationId: run.conversationId ?? null, eventId: run.eventId, traceId: run.traceId, status: run.status, startedAt: new Date(run.startedAt), usage: run.usage, safeError: run.safeError }); }
  async updateRun(context: TrustedBusinessContext, id: string, changes: Pick<AgentRunRecord, "status" | "completedAt" | "usage" | "safeError">) { await this.db.update(dbs.agentRuns).set({ status: changes.status, completedAt: changes.completedAt ? new Date(changes.completedAt) : null, usage: changes.usage, safeError: changes.safeError, updatedAt: new Date() }).where(and(eq(dbs.agentRuns.id, id), eq(dbs.agentRuns.businessId, context.businessId))); }
  async appendStep(context: TrustedBusinessContext, step: AgentStepRecord) { scope(context, step.businessId); await this.db.insert(dbs.agentSteps).values({ ...step, occurredAt: new Date(step.occurredAt) }); }
  async appendToolCall(context: TrustedBusinessContext, call: ToolCallRecord) { scope(context, call.businessId); await this.db.insert(dbs.toolCalls).values({ id: call.id, businessId: call.businessId, runId: call.runId, traceId: call.traceId, toolName: call.toolName, status: call.status, safeInput: call.safeInput, safeOutput: call.safeOutput ?? null, safeError: call.safeError ?? null, occurredAt: new Date(call.occurredAt) }); }
  async getRun(context: TrustedBusinessContext, id: string) { const row = (await this.db.select().from(dbs.agentRuns).where(and(eq(dbs.agentRuns.id, id), eq(dbs.agentRuns.businessId, context.businessId))).limit(1))[0]; if (!row) return null; const [steps, calls] = await Promise.all([this.db.select().from(dbs.agentSteps).where(and(eq(dbs.agentSteps.businessId, context.businessId), eq(dbs.agentSteps.runId, id))), this.db.select().from(dbs.toolCalls).where(and(eq(dbs.toolCalls.businessId, context.businessId), eq(dbs.toolCalls.runId, id)))]); return { run: { id: row.id, businessId: row.businessId, agentId: row.agentId, agentVersionId: row.agentVersionId, ...(row.conversationId ? { conversationId: row.conversationId } : {}), eventId: row.eventId, traceId: row.traceId, status: row.status, startedAt: iso(row.startedAt), completedAt: row.completedAt ? iso(row.completedAt) : null, usage: row.usage as AgentRunRecord["usage"], safeError: row.safeError as AgentRunRecord["safeError"] }, steps: steps.map((s) => ({ ...s, safeFacts: s.safeFacts as JsonValue, occurredAt: iso(s.occurredAt) })) as AgentStepRecord[], toolCalls: calls.map((c) => ({ ...c, safeInput: c.safeInput as JsonValue, ...(c.safeOutput ? { safeOutput: c.safeOutput as JsonValue } : {}), ...(c.safeError ? { safeError: c.safeError as JsonValue } : {}), occurredAt: iso(c.occurredAt) })) as ToolCallRecord[] }; }
}

export class PostgresRuntimeActionRepository implements ActionRepository {
  constructor(private readonly db: NodePgDatabase) {}
  private record(row: typeof dbs.actions.$inferSelect): ActionRecord { return { id: row.id, businessId: row.businessId, runId: row.runId, traceId: row.traceId, action: agentActionSchema.parse(row.payload), status: row.status, ...(row.safeError ? { safeError: row.safeError as NonNullable<ActionRecord["safeError"]> } : {}) }; }
  async reserve(context: TrustedBusinessContext, runId: string, action: AgentAction) { const row = (await this.db.insert(dbs.actions).values({ id: action.id, businessId: context.businessId, runId, traceId: context.traceId, type: action.type, payload: action, idempotencyKey: action.idempotencyKey, status: "PENDING" }).onConflictDoNothing().returning())[0]; if (row) return { record: this.record(row), duplicate: false }; const prior = (await this.db.select().from(dbs.actions).where(and(eq(dbs.actions.businessId, context.businessId), eq(dbs.actions.idempotencyKey, action.idempotencyKey))).limit(1))[0]; if (!prior) throw new Error("ACTION_NOT_FOUND"); return { record: this.record(prior), duplicate: true }; }
  async updateStatus(context: TrustedBusinessContext, actionId: string, status: ActionRecord["status"], safeError?: ActionRecord["safeError"]) { await this.db.update(dbs.actions).set({ status, safeError: safeError ?? null, updatedAt: new Date() }).where(and(eq(dbs.actions.id, actionId), eq(dbs.actions.businessId, context.businessId))); }
  async listForRun(context: TrustedBusinessContext, runId: string) { return (await this.db.select().from(dbs.actions).where(and(eq(dbs.actions.businessId, context.businessId), eq(dbs.actions.runId, runId)))).map((row) => this.record(row)); }
}

export class PostgresRuntimeDomainActions implements DomainActionHandler {
  constructor(private readonly db: NodePgDatabase) {}
  async apply(context: TrustedBusinessContext, runId: string, action: DomainAction) {
    if (action.type !== "RequestHuman" || !context.conversationId) throw new Error("DOMAIN_ACTION_UNAVAILABLE");
    await this.db.transaction(async (tx) => {
      const conversation = (await tx.select({ ownership: dbs.conversations.ownership, customerId: dbs.conversations.customerId, channel: dbs.conversations.channel }).from(dbs.conversations).where(and(eq(dbs.conversations.id, context.conversationId!), eq(dbs.conversations.businessId, context.businessId))).limit(1).for("update"))[0];
      if (!conversation) throw new Error("CONVERSATION_NOT_FOUND");
      await tx.insert(dbs.handoffs).values({ id: ulid(), businessId: context.businessId, conversationId: context.conversationId!, customerId: conversation.customerId, runId, channel: conversation.channel, reason: action.reason, priority: action.priority, safeSummary: action.safeSummary ?? null, state: "HANDOFF_REQUESTED", traceId: context.traceId, idempotencyKey: action.idempotencyKey }).onConflictDoNothing();
      await tx.update(dbs.conversations).set({ ownership: "HANDOFF_REQUESTED", updatedAt: new Date() }).where(and(eq(dbs.conversations.id, context.conversationId!), eq(dbs.conversations.businessId, context.businessId)));
    });
  }
}
