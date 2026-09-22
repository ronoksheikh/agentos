import { z } from "zod";
import type { AgentVersion } from "@agentos/agents";
import type { AgentEvent } from "@agentos/events";
import type { JsonValue, TrustedBusinessContext } from "@agentos/shared";

export const contextLayerSchema = z.enum(["instructions", "business", "channel", "announcements", "customer_identity", "customer_memory", "summary", "pins", "recent_messages", "pending_order", "pending_goals", "knowledge", "tool_results", "attachment_derivatives", "current_event"]);
export const contextProvenanceSchema = z.object({ sourceType: z.string(), sourceId: z.string(), label: z.string(), reason: z.string(), included: z.boolean(), estimatedTokens: z.number().int().nonnegative(), confidence: z.number().min(0).max(1).optional(), rawSourceId: z.string().optional() });
export const contextItemSchema = z.object({ layer: contextLayerSchema, content: z.string(), provenance: contextProvenanceSchema });
export const contextBundleSchema = z.object({ items: z.array(contextItemSchema), provenance: z.array(contextProvenanceSchema), estimatedTokens: z.number().int().nonnegative(), truncated: z.boolean() });
export type ContextBundle = z.infer<typeof contextBundleSchema>;
export type ContextLayer = z.infer<typeof contextLayerSchema>;

export interface ContextSource {
  load(context: TrustedBusinessContext, version: AgentVersion, event: AgentEvent): Promise<Partial<Record<ContextLayer, Array<{ sourceId: string; label: string; reason: string; content: string; confidence?: number; rawSourceId?: string }>>>>;
}
export interface ContextEngine { build(context: TrustedBusinessContext, version: AgentVersion, event: AgentEvent, safeToolResults?: JsonValue[]): Promise<ContextBundle>; }

const orderedLayers: ContextLayer[] = ["instructions", "business", "channel", "announcements", "customer_identity", "customer_memory", "summary", "pins", "recent_messages", "pending_order", "pending_goals", "knowledge", "tool_results", "attachment_derivatives", "current_event"];
export const estimateTokens = (content: string) => Math.max(1, Math.ceil(content.length / 4));

export class LayeredContextEngine implements ContextEngine {
  constructor(private readonly source: ContextSource) {}
  async build(context: TrustedBusinessContext, version: AgentVersion, event: AgentEvent, safeToolResults: JsonValue[] = []): Promise<ContextBundle> {
    const loaded = await this.source.load(context, version, event);
    loaded.instructions = [{ sourceId: version.id, label: "Agent instructions", reason: "Configured agent behavior", content: version.config.instructions }];
    loaded.channel = [{ sourceId: event.channel, label: "Channel context", reason: "Current generic channel identifier", content: `Channel: ${event.channel}` }];
    if (safeToolResults.length) loaded.tool_results = safeToolResults.map((result, index) => ({ sourceId: `tool-${index}`, label: "Safe tool result", reason: "Result from an allowed tool in this run", content: JSON.stringify(result) }));
    loaded.current_event = [{ sourceId: event.id, label: "Current event", reason: "Event being processed", content: JSON.stringify({ type: event.type, payload: event.payload, occurredAt: event.occurredAt }) }];
    const items: ContextBundle["items"] = []; const provenance: ContextBundle["provenance"] = []; let used = 0; let truncated = false;
    for (const layer of orderedLayers) for (const candidate of loaded[layer] ?? []) {
      const tokens = estimateTokens(candidate.content); const included = used + tokens <= version.config.runtimeLimits.maxContextTokens;
      const fact = { sourceType: layer, sourceId: candidate.sourceId, label: candidate.label, reason: candidate.reason, included, estimatedTokens: tokens, ...(candidate.confidence !== undefined ? { confidence: candidate.confidence } : {}), ...(candidate.rawSourceId ? { rawSourceId: candidate.rawSourceId } : {}) };
      provenance.push(fact); if (included) { items.push({ layer, content: candidate.content, provenance: fact }); used += tokens; } else truncated = true;
    }
    return contextBundleSchema.parse({ items, provenance, estimatedTokens: used, truncated });
  }
}
export { AdvancedContextSource } from "./advanced";
