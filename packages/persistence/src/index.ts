import type { Agent, AgentVersion, AgentVersionRepository } from "@agentos/agents";
import type { ActionRecord, ActionRepository, AgentAction } from "@agentos/actions";
import type { Memory, MemoryRepository } from "@agentos/memory";
import type { AgentRunRecord, AgentStepRecord, ToolCallRecord, TraceRepository } from "@agentos/trace";
import type { TrustedBusinessContext } from "@agentos/shared";

const assertScope = (context: TrustedBusinessContext, businessId: string) => { if (context.businessId !== businessId) throw new Error("TENANT_SCOPE_VIOLATION"); };

export class InMemoryAgentVersionRepository implements AgentVersionRepository {
  readonly agents = new Map<string, Agent>(); readonly versions = new Map<string, AgentVersion>(); readonly audits: Array<{ businessId: string; agentId: string; versionId: string; actorId: string }> = [];
  seed(agent: Agent, versions: AgentVersion[]) { this.agents.set(agent.id, structuredClone(agent)); for (const version of versions) this.versions.set(version.id, structuredClone(version)); }
  async getAgent(context: TrustedBusinessContext, agentId: string) { const value = this.agents.get(agentId); if (!value || value.businessId !== context.businessId) return null; return structuredClone(value); }
  async getVersion(context: TrustedBusinessContext, versionId: string) { const value = this.versions.get(versionId); if (!value || value.businessId !== context.businessId) return null; return structuredClone(value); }
  async getActiveVersion(context: TrustedBusinessContext, agentId: string) { const agent = await this.getAgent(context, agentId); return agent?.activeVersionId ? this.getVersion(context, agent.activeVersionId) : null; }
  async saveVersion(context: TrustedBusinessContext, version: AgentVersion) { assertScope(context, version.businessId); if (this.versions.has(version.id)) throw new Error("IMMUTABLE_VERSION_EXISTS"); this.versions.set(version.id, structuredClone(version)); }
  async selectPublishedVersion(context: TrustedBusinessContext, agentId: string, versionId: string, actorId: string) { const agent = await this.getAgent(context, agentId); const version = await this.getVersion(context, versionId); if (!agent || !version || version.agentId !== agentId) throw new Error("Version unavailable"); for (const value of this.versions.values()) if (value.agentId === agentId && value.state === "PUBLISHED") value.state = "ARCHIVED"; version.state = "PUBLISHED"; version.publishedAt = new Date().toISOString(); this.versions.set(versionId, version); agent.activeVersionId = versionId; agent.updatedAt = new Date().toISOString(); this.agents.set(agentId, agent); this.audits.push({ businessId: context.businessId, agentId, versionId, actorId }); }
}

export class InMemoryMemoryRepository implements MemoryRepository {
  readonly memories = new Map<string, Memory>();
  async create(context: TrustedBusinessContext, memory: Memory) { assertScope(context, memory.businessId); if (this.memories.has(memory.id)) throw new Error("Memory exists"); this.memories.set(memory.id, structuredClone(memory)); }
  async get(context: TrustedBusinessContext, memoryId: string) { const value = this.memories.get(memoryId); if (!value || value.businessId !== context.businessId) return null; return structuredClone(value); }
  async listActive(context: TrustedBusinessContext, filter: { customerId?: string; conversationId?: string }, at = new Date()) { return [...this.memories.values()].filter((value) => value.businessId === context.businessId && !value.supersededBy && (!value.expiresAt || new Date(value.expiresAt) > at) && (!filter.customerId || value.customerId === filter.customerId) && (!filter.conversationId || value.conversationId === filter.conversationId)).map((value) => structuredClone(value)); }
  async supersede(context: TrustedBusinessContext, memoryId: string, replacement: Memory) { const current = await this.get(context, memoryId); if (!current) throw new Error("Memory not found"); assertScope(context, replacement.businessId); current.supersededBy = replacement.id; current.updatedAt = replacement.createdAt; this.memories.set(current.id, current); this.memories.set(replacement.id, structuredClone(replacement)); }
}

export class InMemoryTraceRepository implements TraceRepository {
  readonly runs = new Map<string, AgentRunRecord>(); readonly steps: AgentStepRecord[] = []; readonly toolCalls: ToolCallRecord[] = [];
  async createRun(context: TrustedBusinessContext, run: AgentRunRecord) { assertScope(context, run.businessId); this.runs.set(run.id, structuredClone(run)); }
  async updateRun(context: TrustedBusinessContext, runId: string, changes: Pick<AgentRunRecord, "status" | "completedAt" | "usage" | "safeError">) { const run = this.runs.get(runId); if (!run || run.businessId !== context.businessId) throw new Error("Run unavailable"); Object.assign(run, structuredClone(changes)); }
  async appendStep(context: TrustedBusinessContext, step: AgentStepRecord) { assertScope(context, step.businessId); this.steps.push(structuredClone(step)); }
  async appendToolCall(context: TrustedBusinessContext, call: ToolCallRecord) { assertScope(context, call.businessId); this.toolCalls.push(structuredClone(call)); }
  async getRun(context: TrustedBusinessContext, runId: string) { const run = this.runs.get(runId); if (!run || run.businessId !== context.businessId) return null; return { run: structuredClone(run), steps: structuredClone(this.steps.filter((step) => step.runId === runId && step.businessId === context.businessId)), toolCalls: structuredClone(this.toolCalls.filter((call) => call.runId === runId && call.businessId === context.businessId)) }; }
}

export class InMemoryActionRepository implements ActionRepository {
  readonly records = new Map<string, ActionRecord>(); private readonly keys = new Map<string, string>();
  async reserve(context: TrustedBusinessContext, runId: string, action: AgentAction) { const key = `${context.businessId}:${action.idempotencyKey}`; const existingId = this.keys.get(key); if (existingId) return { record: structuredClone(this.records.get(existingId)!), duplicate: true }; const record: ActionRecord = { id: action.id, businessId: context.businessId, runId, traceId: context.traceId, action: structuredClone(action), status: "PENDING" }; this.records.set(record.id, record); this.keys.set(key, record.id); return { record: structuredClone(record), duplicate: false }; }
  async updateStatus(context: TrustedBusinessContext, actionId: string, status: ActionRecord["status"], safeError?: ActionRecord["safeError"]) { const record = this.records.get(actionId); if (!record || record.businessId !== context.businessId) throw new Error("Action unavailable"); record.status = status; if (safeError) record.safeError = safeError; }
  async listForRun(context: TrustedBusinessContext, runId: string) { return [...this.records.values()].filter((record) => record.businessId === context.businessId && record.runId === runId).map((record) => structuredClone(record)); }
}
