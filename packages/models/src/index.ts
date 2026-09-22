import { z } from "zod";
import type { AgentAction } from "@agentos/actions";
import type { ContextBundle } from "@agentos/context";
import type { JsonValue } from "@agentos/shared";
import type { AgentVersion } from "@agentos/agents";

export const modelUsageSchema = z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), totalTokens: z.number().int().nonnegative(), costMicros: z.number().int().nonnegative().optional() });
export const modelErrorSchema = z.object({ code: z.enum(["TIMEOUT", "RATE_LIMITED", "UNAVAILABLE", "INVALID_RESPONSE", "CANCELLED", "UNKNOWN"]), message: z.string(), retryable: z.boolean() });
export interface ModelToolDescription { name: string; description: string; inputSchema: JsonValue; }
export interface ModelRequest { runId: string; version: AgentVersion; context: ContextBundle; tools: ModelToolDescription[]; safeToolResults: Array<{ toolCallId: string; toolName: string; output: JsonValue }>; maxOutputTokens: number; signal: AbortSignal; }
export type ModelResponse =
  | { kind: "tool_calls"; provider: string; model: string; calls: Array<{ id: string; name: string; arguments: unknown }>; usage: z.infer<typeof modelUsageSchema>; latencyMs: number }
  | { kind: "actions"; provider: string; model: string; actions: AgentAction[]; usage: z.infer<typeof modelUsageSchema>; latencyMs: number }
  | { kind: "error"; provider: string; model: string; error: z.infer<typeof modelErrorSchema>; usage?: z.infer<typeof modelUsageSchema>; latencyMs: number };
export interface ModelProvider { generate(request: ModelRequest): Promise<ModelResponse>; }

export type FakeModelScriptEntry =
  | Omit<Extract<ModelResponse, { kind: "tool_calls" }>, "provider" | "model" | "latencyMs">
  | Omit<Extract<ModelResponse, { kind: "actions" }>, "provider" | "model" | "latencyMs">
  | Omit<Extract<ModelResponse, { kind: "error" }>, "provider" | "model" | "latencyMs">;

export class FakeModelProvider implements ModelProvider {
  private index = 0;
  constructor(private readonly script: FakeModelScriptEntry[], private readonly provider = "fake", private readonly model = "deterministic-v1") {}
  async generate(request: ModelRequest): Promise<ModelResponse> {
    if (request.signal.aborted) return { kind: "error", provider: this.provider, model: this.model, latencyMs: 0, error: { code: "CANCELLED", message: "Run cancelled", retryable: false } };
    const entry = this.script[this.index++]; if (!entry) return { kind: "error", provider: this.provider, model: this.model, latencyMs: 0, error: { code: "INVALID_RESPONSE", message: "Fake provider script exhausted", retryable: false } };
    return { ...structuredClone(entry), provider: this.provider, model: this.model, latencyMs: 0 } as ModelResponse;
  }
}
export { OpenAIResponsesProvider } from "./openai";
