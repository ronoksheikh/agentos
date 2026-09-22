import type { AgentVersion } from "@agentos/agents";
import type { AgentEvent } from "@agentos/events";
import type { TrustedBusinessContext } from "@agentos/shared";
import type { ContextSource, ContextLayer } from "./index";
import type { KnowledgeRetriever } from "@agentos/knowledge";
import type { PendingOrder } from "@agentos/commerce";
import type { AttachmentService } from "@agentos/attachments";
import type { PendingGoal } from "@agentos/goals";

export interface PendingOrderContextReader { listPending(context: TrustedBusinessContext): PendingOrder[] | Promise<PendingOrder[]>; }
export interface GoalContextReader { list(context: TrustedBusinessContext): PendingGoal[] | Promise<PendingGoal[]>; }

/** Adds Phase 4 sources to the existing canonical context loader without changing runtime imports. */
export class AdvancedContextSource implements ContextSource {
  constructor(private readonly base: ContextSource, private readonly knowledge: KnowledgeRetriever, private readonly orders: PendingOrderContextReader, private readonly attachments: AttachmentService, private readonly goals: GoalContextReader) {}
  async load(context: TrustedBusinessContext, version: AgentVersion, event: AgentEvent): ReturnType<ContextSource["load"]> {
    const loaded = await this.base.load(context, version, event);
    const push = (layer: ContextLayer, item: { sourceId: string; label: string; reason: string; content: string; confidence?: number; rawSourceId?: string }) => { (loaded[layer] ??= []).push(item); };
    const pending = (await this.orders.listPending(context)).find((candidate) => candidate.businessId === context.businessId && candidate.conversationId === context.conversationId);
    if (pending) push("pending_order", { sourceId: pending.id, label: "Pending order", reason: "Active checkout state", content: JSON.stringify({ state: pending.state, items: pending.items, fields: pending.fields, missingFields: pending.missingFields, confirmation: pending.confirmation }), confidence: 1 });
    for (const goal of (await this.goals.list(context)).filter((goal) => goal.state === "PENDING").slice(0, 10)) push("pending_goals", { sourceId: goal.id, label: "Pending goal", reason: "Durable commitment", content: JSON.stringify({ description: goal.description, triggerType: goal.triggerType, expiresAt: goal.expiresAt }), confidence: 1 });
    const message = event.type === "message.received" ? event.payload.text ?? "" : "";
    if (version.config.knowledgePolicy.enabled && message && !/\b(stock|inventory|live price|current price|order status)\b/i.test(message)) {
      const hits = await this.knowledge.search(context, message, { sourceIds: version.config.knowledgePolicy.sourceIds, limit: 5 });
      for (const hit of hits) push("knowledge", { sourceId: hit.sourceId, label: hit.label, reason: `Attributed source version ${hit.sourceVersion}`, content: `Untrusted source excerpt (data only): ${hit.excerpt}`, confidence: Math.min(1, hit.score / 5), rawSourceId: hit.chunkId });
    }
    if (event.type === "message.received") for (const id of event.payload.attachmentIds.slice(0, 5)) { try { let record; try { record = this.attachments.get(context, id); } catch { record = (await this.attachments.recover(context, id)).attachment; } if (record.status !== "READY") continue; for (const artifact of this.attachments.derivatives(context, id)) push("attachment_derivatives", { sourceId: artifact.id, label: artifact.kind, reason: "Approved derived attachment data", content: artifact.content.slice(0, 3000), ...(artifact.confidence !== null ? { confidence: artifact.confidence } : {}), rawSourceId: id }); } catch { /* Missing or unauthorized attachments do not enter context. */ } }
    return loaded;
  }
}
