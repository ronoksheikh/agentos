import { z } from "zod";
import { isoDateTimeSchema, jsonValueSchema, ulidSchema, type JsonValue, type TrustedBusinessContext } from "@agentos/shared";

export const runStatusSchema = z.enum(["RUNNING", "COMPLETED", "FAILED", "CANCELLED"]);
export const agentRunRecordSchema = z.object({ id: ulidSchema, businessId: ulidSchema, agentId: ulidSchema, agentVersionId: ulidSchema, conversationId: ulidSchema.optional(), eventId: ulidSchema, traceId: ulidSchema, status: runStatusSchema, startedAt: isoDateTimeSchema, completedAt: isoDateTimeSchema.nullable(), usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), toolCalls: z.number().int().nonnegative(), steps: z.number().int().nonnegative(), latencyMs: z.number().int().nonnegative() }), safeError: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).nullable() });
export type AgentRunRecord = z.infer<typeof agentRunRecordSchema>;
export interface AgentStepRecord { id: string; businessId: string; runId: string; traceId: string; sequence: number; kind: "CONTEXT" | "MODEL" | "TOOL" | "ACTION" | "STATE"; status: "STARTED" | "COMPLETED" | "FAILED"; safeFacts: JsonValue; occurredAt: string; }
export interface ToolCallRecord { id: string; businessId: string; runId: string; traceId: string; toolName: string; status: string; safeInput: JsonValue; safeOutput?: JsonValue; safeError?: JsonValue; occurredAt: string; }
export interface TraceRepository {
  createRun(context: TrustedBusinessContext, run: AgentRunRecord): Promise<void>;
  updateRun(context: TrustedBusinessContext, runId: string, changes: Pick<AgentRunRecord, "status" | "completedAt" | "usage" | "safeError">): Promise<void>;
  appendStep(context: TrustedBusinessContext, step: AgentStepRecord): Promise<void>;
  appendToolCall(context: TrustedBusinessContext, call: ToolCallRecord): Promise<void>;
  getRun(context: TrustedBusinessContext, runId: string): Promise<{ run: AgentRunRecord; steps: AgentStepRecord[]; toolCalls: ToolCallRecord[] } | null>;
}
