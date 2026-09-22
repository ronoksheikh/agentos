import { z } from "zod";
import { isoDateTimeSchema, jsonValueSchema, ulidSchema, type TrustedBusinessContext } from "@agentos/shared";

const actionBase = { id: ulidSchema, schemaVersion: z.literal("1.0"), idempotencyKey: z.string().min(1).max(300) };
export const universalChannelActionSchema = z.discriminatedUnion("type", [
  z.object({ ...actionBase, type: z.literal("SendMessage"), text: z.string().min(1).max(20_000) }),
  z.object({ ...actionBase, type: z.literal("SendImage"), assetId: ulidSchema, altText: z.string().max(500).optional() }),
  z.object({ ...actionBase, type: z.literal("SendFile"), assetId: ulidSchema, filename: z.string().min(1).max(255) }),
  z.object({ ...actionBase, type: z.literal("SendProduct"), productRef: z.string().min(1), title: z.string().min(1), url: z.url().optional(), fallbackText: z.string().min(1) }),
  z.object({ ...actionBase, type: z.literal("ReplyToMessage"), messageId: ulidSchema, text: z.string().min(1).max(20_000) }),
  z.object({ ...actionBase, type: z.literal("ReactToMessage"), messageId: ulidSchema, reaction: z.string().min(1).max(50) }),
]);

export const domainActionSchema = z.discriminatedUnion("type", [
  z.object({ ...actionBase, type: z.literal("RequestHuman"), reason: z.string().min(1).max(1_000), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"), safeSummary: z.string().max(2_000).optional() }),
  z.object({ ...actionBase, type: z.literal("Remember"), memoryType: z.string().min(1).max(100), content: z.string().min(1).max(10_000), importance: z.number().min(0).max(1), confidence: z.number().min(0).max(1), sourceMessageIds: z.array(ulidSchema).default([]), expiresAt: isoDateTimeSchema.optional() }),
  z.object({ ...actionBase, type: z.literal("UpdateMemory"), memoryId: ulidSchema, content: z.string().min(1).max(10_000), importance: z.number().min(0).max(1), confidence: z.number().min(0).max(1) }),
  z.object({ ...actionBase, type: z.literal("PinMessage"), messageId: ulidSchema, label: z.string().max(200).optional() }),
  z.object({ ...actionBase, type: z.literal("UnpinMessage"), messageId: ulidSchema }),
  z.object({ ...actionBase, type: z.literal("MarkPendingAction"), goalType: z.string().min(1), description: z.string().min(1).max(2_000), trigger: z.record(z.string(), jsonValueSchema).default({}), expiresAt: isoDateTimeSchema.optional() }),
  z.object({ ...actionBase, type: z.literal("ResolvePendingAction"), pendingActionId: ulidSchema, resolution: z.string().max(1_000).optional() }),
]);

export const agentActionSchema = z.union([universalChannelActionSchema, domainActionSchema]);
export type UniversalChannelAction = z.infer<typeof universalChannelActionSchema>;
export type DomainAction = z.infer<typeof domainActionSchema>;
export type AgentAction = z.infer<typeof agentActionSchema>;

export interface ActionRecord {
  id: string;
  businessId: string;
  runId: string;
  traceId: string;
  action: AgentAction;
  status: "PENDING" | "APPLIED" | "DEFERRED" | "FAILED";
  safeError?: { code: string; message: string };
}

export interface ActionRepository {
  reserve(context: TrustedBusinessContext, runId: string, action: AgentAction): Promise<{ record: ActionRecord; duplicate: boolean }>;
  updateStatus(context: TrustedBusinessContext, actionId: string, status: ActionRecord["status"], safeError?: ActionRecord["safeError"]): Promise<void>;
  listForRun(context: TrustedBusinessContext, runId: string): Promise<ActionRecord[]>;
}

export interface DomainActionHandler {
  apply(context: TrustedBusinessContext, runId: string, action: DomainAction): Promise<void>;
}

export interface IdempotentActionExecutor {
  execute(context: TrustedBusinessContext, runId: string, action: AgentAction): Promise<ActionRecord>;
}

export { DeferredChannelActionExecutor } from "./executor";
