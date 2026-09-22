import { ulid } from "ulid";
import type { ContextSource } from "@agentos/context";
import type { AgentVersion } from "@agentos/agents";
import type { AgentEvent } from "@agentos/events";
import type { DomainAction, DomainActionHandler } from "@agentos/actions";
import type { MemoryService } from "@agentos/memory";
import type { TrustedBusinessContext } from "@agentos/shared";

export interface ConversationState {
  businessId: string; conversationId: string; customerId?: string; businessInfo?: string; customerIdentity?: string; summary?: { id: string; content: string };
  messages: Array<{ id: string; text: string; occurredAt: string; sequence: number; traceId: string }>;
  pins: Array<{ id: string; messageId: string; label?: string; traceId: string }>;
  pendingGoals: Array<{ id: string; type: string; description: string; state: "PENDING" | "RESOLVED"; traceId: string; expiresAt?: string }>;
  announcements: Array<{ id: string; content: string; active: boolean; startsAt: string; expiresAt: string; channels: string[]; agentIds: string[] }>;
  handoff?: { id: string; reason: string; priority: string; state: "REQUESTED"; traceId: string };
}

export class InMemoryConversationStore implements ContextSource, DomainActionHandler {
  readonly states = new Map<string, ConversationState>();
  constructor(private readonly memories: MemoryService) {}
  seed(state: ConversationState) { this.states.set(`${state.businessId}:${state.conversationId}`, structuredClone(state)); }
  private require(context: TrustedBusinessContext) { if (!context.conversationId) throw new Error("Conversation is required"); const state = this.states.get(`${context.businessId}:${context.conversationId}`); if (!state) throw new Error("Conversation unavailable"); return state; }
  async load(context: TrustedBusinessContext, version: AgentVersion, event: AgentEvent) {
    const state = context.conversationId ? this.states.get(`${context.businessId}:${context.conversationId}`) : undefined; const now = event.occurredAt;
    const memoryFilter = { ...(context.customerId ? { customerId: context.customerId } : {}), ...(context.conversationId ? { conversationId: context.conversationId } : {}) };
    const activeMemories = version.config.contextPolicy.includeMemories ? await this.memories.listActive(context, memoryFilter) : [];
    return {
      business: state?.businessInfo ? [{ sourceId: context.businessId, label: "Business information", reason: "Trusted tenant context", content: state.businessInfo }] : [],
      announcements: (state?.announcements ?? []).filter((item) => item.active && item.startsAt <= now && item.expiresAt > now && (!item.channels.length || item.channels.includes(event.channel)) && (!item.agentIds.length || item.agentIds.includes(version.agentId))).map((item) => ({ sourceId: item.id, label: "Active business announcement", reason: "Active and in scope", content: item.content })),
      customer_identity: state?.customerIdentity ? [{ sourceId: state.customerId ?? "unknown", label: "Customer identity", reason: "Trusted scoped customer identity", content: state.customerIdentity }] : [],
      customer_memory: activeMemories.map((item) => ({ sourceId: item.id, label: `Memory: ${item.type}`, reason: "Active customer memory", content: item.content })),
      summary: state?.summary ? [{ sourceId: state.summary.id, label: "Conversation summary", reason: "Bounded rolling summary", content: state.summary.content }] : [],
      pins: version.config.contextPolicy.includePins ? (state?.pins ?? []).map((pin) => ({ sourceId: pin.id, label: pin.label ?? "Pinned message", reason: "Explicitly pinned context", content: state?.messages.find((message) => message.id === pin.messageId)?.text ?? "[message unavailable]" })) : [],
      recent_messages: (state?.messages ?? []).slice(-version.config.contextPolicy.recentMessageLimit).map((message) => ({ sourceId: message.id, label: `Message ${message.sequence}`, reason: "Bounded recent message window", content: message.text })),
      pending_goals: (state?.pendingGoals ?? []).filter((goal) => goal.state === "PENDING" && (!goal.expiresAt || goal.expiresAt > now)).map((goal) => ({ sourceId: goal.id, label: `Pending ${goal.type}`, reason: "Unresolved customer commitment", content: goal.description })),
      knowledge: [], tool_results: [],
    };
  }
  async apply(context: TrustedBusinessContext, _runId: string, action: DomainAction) {
    const state = this.require(context);
    if (action.type === "Remember") { await this.memories.remember(context, { customerId: context.customerId, conversationId: context.conversationId, type: action.memoryType, content: action.content, importance: action.importance, confidence: action.confidence, sourceMessageIds: action.sourceMessageIds, createdBy: `run:${context.traceId}`, expiresAt: action.expiresAt ?? null }); return; }
    if (action.type === "UpdateMemory") { await this.memories.update(context, action.memoryId, action); return; }
    if (action.type === "PinMessage") { if (!state.messages.some((message) => message.id === action.messageId)) throw new Error("Message unavailable"); if (!state.pins.some((pin) => pin.messageId === action.messageId)) state.pins.push({ id: ulid(), messageId: action.messageId, ...(action.label ? { label: action.label } : {}), traceId: context.traceId }); return; }
    if (action.type === "UnpinMessage") { state.pins = state.pins.filter((pin) => pin.messageId !== action.messageId); return; }
    if (action.type === "MarkPendingAction") { state.pendingGoals.push({ id: ulid(), type: action.goalType, description: action.description, state: "PENDING", traceId: context.traceId, ...(action.expiresAt ? { expiresAt: action.expiresAt } : {}) }); return; }
    if (action.type === "ResolvePendingAction") { const goal = state.pendingGoals.find((item) => item.id === action.pendingActionId); if (!goal) throw new Error("Pending action unavailable"); goal.state = "RESOLVED"; return; }
    if (action.type === "RequestHuman") { if (!state.handoff) state.handoff = { id: ulid(), reason: action.reason, priority: action.priority, state: "REQUESTED", traceId: context.traceId }; }
  }
}
