import { z } from "zod";
import { isoDateTimeSchema, jsonValueSchema, redactSafe, ulidSchema } from "@agentos/shared";

const eventBase = {
  id: ulidSchema,
  schemaVersion: z.literal("1.0"),
  businessId: ulidSchema,
  channel: z.string().min(1).max(100),
  connectionId: ulidSchema.optional(),
  conversationId: ulidSchema.optional(),
  customerId: ulidSchema.optional(),
  occurredAt: isoDateTimeSchema,
  dedupeKey: z.string().min(1).max(300),
  source: z.object({ kind: z.enum(["adapter", "system", "test"]), externalEventId: z.string().max(300).optional(), metadata: z.record(z.string(), jsonValueSchema).transform((value) => redactSafe(value)).optional() }),
};

export const agentEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...eventBase,
    type: z.literal("message.received"),
    payload: z.object({ messageId: ulidSchema, text: z.string().max(100_000).optional(), attachmentIds: z.array(ulidSchema).max(20).default([]), inboundSequence: z.number().int().positive() }),
  }),
  z.object({
    ...eventBase,
    type: z.literal("system.trigger"),
    payload: z.object({ name: z.string().min(1).max(100), data: z.record(z.string(), jsonValueSchema).default({}) }),
  }),
]);

export type AgentEvent = z.infer<typeof agentEventSchema>;
