import { createHash } from "node:crypto";
import { z } from "zod";
import { responseTimingPolicySchema } from "@agentos/agents";
import { ulidSchema } from "@agentos/shared";

export const workKindSchema = z.enum(["EVENT", "CONVERSATION", "OUTBOUND", "ATTACHMENT", "BROWSER", "GOAL"]);
export const workJobSchema = z.object({ schemaVersion: z.literal("1.0"), workId: ulidSchema, businessId: ulidSchema, traceId: ulidSchema, kind: workKindSchema });
export type WorkJob = z.infer<typeof workJobSchema>;
export type WorkKind = z.infer<typeof workKindSchema>;

export const timingInputSchema = z.object({
  policy: responseTimingPolicySchema, batchSize: z.number().int().min(1).max(100), responseChars: z.number().int().nonnegative(),
  usedTools: z.boolean().default(false), usedBrowser: z.boolean().default(false), usedMedia: z.boolean().default(false),
  queueAgeMs: z.number().int().nonnegative(), elapsedMs: z.number().int().nonnegative(),
  urgent: z.boolean().default(false), transactional: z.boolean().default(false), seed: z.string().min(1),
});
export type TimingInput = z.input<typeof timingInputSchema>;

export function evaluateResponseTiming(unsafe: TimingInput) {
  const input = timingInputSchema.parse(unsafe);
  const { policy } = input;
  const deadlineMs = Math.max(0, policy.maxCustomerWaitMs - input.elapsedMs);
  if ((input.urgent && policy.urgencyBypass) || input.transactional) return { delayMs: 0, latestSendInMs: deadlineMs, reason: "URGENT" as const };
  const complexity = Math.min(2_000, Math.floor(input.responseChars / 12) + (input.batchSize - 1) * 120 + (input.usedTools ? 250 : 0) + (input.usedBrowser ? 500 : 0) + (input.usedMedia ? 350 : 0));
  const digest = createHash("sha256").update(input.seed).digest();
  const jitter = policy.variabilityMs ? digest.readUInt16BE(0) % (policy.variabilityMs + 1) : 0;
  const delayMs = Math.min(deadlineMs, Math.max(0, policy.maxPreSendDelayMs - input.queueAgeMs), Math.max(policy.minPreSendDelayMs, Math.min(policy.maxPreSendDelayMs, complexity + jitter)));
  return { delayMs, latestSendInMs: deadlineMs, reason: "BOUNDED" as const };
}

export function classifyFailure(code: string) {
  if (["VALIDATION_ERROR", "PERMISSION_ERROR", "FORBIDDEN", "TRUSTED_SCOPE_MISMATCH", "CANCELLED"].includes(code)) return { retryable: false, category: code };
  if (["MODEL_ERROR", "TOOL_ERROR", "CHANNEL_ERROR", "AUTH_ERROR", "TIMEOUT", "RUNTIME_LIMIT", "BROWSER_ERROR", "ATTACHMENT_ERROR", "LOCK_BUSY", "LOCK_LOST"].includes(code)) return { retryable: true, category: code };
  return { retryable: false, category: "UNKNOWN" };
}
