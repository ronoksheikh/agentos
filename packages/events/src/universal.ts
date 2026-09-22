import { z } from "zod";
import { isoDateTimeSchema, ulidSchema } from "@agentos/shared";
import { agentEventSchema, type AgentEvent } from "./index";

const reference = z.string().min(1).max(300);
const base = {
  id: ulidSchema, schemaVersion: z.literal("1.0"), businessId: ulidSchema,
  channel: z.string().min(1).max(100), connectionId: ulidSchema,
  conversationId: ulidSchema.optional(), customerId: ulidSchema.optional(),
  dedupeKey: reference, occurredAt: isoDateTimeSchema, receivedAt: isoDateTimeSchema,
  traceId: ulidSchema, rawEventId: ulidSchema,
  source: z.object({ kind: z.enum(["adapter", "system", "test"]), externalEventId: reference.optional(), externalMessageId: reference.optional(), externalParentId: reference.optional(), senderId: reference.optional() }),
};
const message = z.object({ ...base, type: z.literal("message.received"), payload: z.object({ messageId: ulidSchema, text: z.string().max(100_000).optional(), attachmentIds: z.array(ulidSchema).max(20).default([]), replyToExternalId: reference.optional(), urgent: z.boolean().default(false) }) });
const attachment = z.object({ ...base, type: z.literal("attachment.received"), payload: z.object({ attachmentId: ulidSchema, messageId: ulidSchema.optional() }) });
const comment = z.object({ ...base, type: z.literal("comment.created"), payload: z.object({ externalCommentId: reference }) });
const reaction = z.object({ ...base, type: z.literal("reaction.created"), payload: z.object({ externalMessageId: reference, reaction: z.string().max(50) }) });
const delivery = z.object({ ...base, type: z.enum(["message.delivered", "message.read"]), payload: z.object({ externalMessageId: reference, at: isoDateTimeSchema }) });
const order = z.object({ ...base, type: z.enum(["order.created", "order.updated"]), payload: z.object({ orderId: ulidSchema }) });
const inventory = z.object({ ...base, type: z.literal("inventory.updated"), payload: z.object({ productId: reference, variantId: reference.optional(), available: z.number().int().nonnegative() }) });
const scheduled = z.object({ ...base, type: z.literal("scheduled.triggered"), payload: z.object({ goalId: ulidSchema }) });
const handoff = z.object({ ...base, type: z.literal("handoff.resolved"), payload: z.object({ handoffId: ulidSchema }) });
export const universalEventSchema = z.union([message, attachment, comment, reaction, delivery, order, inventory, scheduled, handoff]);
export type UniversalEvent = z.infer<typeof universalEventSchema>;

export const rawEventRecordSchema = z.object({
  id: ulidSchema, businessId: ulidSchema, connectionId: ulidSchema, channel: z.string().min(1).max(100),
  dedupeKey: reference, externalEventId: reference.optional(), payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
  payloadBytes: z.number().int().nonnegative(), receivedAt: isoDateTimeSchema, retentionUntil: isoDateTimeSchema,
  state: z.enum(["RECEIVED", "NORMALIZED", "REJECTED", "DUPLICATE"]), safeCode: z.string().max(100).optional(),
});
export type RawEventRecord = z.infer<typeof rawEventRecordSchema>;

export function toRuntimeEvent(event: UniversalEvent, inboundSequence: number): AgentEvent {
  if (event.type !== "message.received" && event.type !== "scheduled.triggered") throw new Error("RUNTIME_EVENT_UNSUPPORTED");
  if (event.type === "scheduled.triggered") return agentEventSchema.parse({ id: event.id, schemaVersion: "1.0", type: "system.trigger", businessId: event.businessId, channel: event.channel, connectionId: event.connectionId, conversationId: event.conversationId, customerId: event.customerId, occurredAt: event.occurredAt, dedupeKey: event.dedupeKey, source: { kind: event.source.kind, externalEventId: event.source.externalEventId }, payload: { name: "goal.triggered", data: { goalId: event.payload.goalId } } });
  return agentEventSchema.parse({ id: event.id, schemaVersion: "1.0", type: "message.received", businessId: event.businessId, channel: event.channel, connectionId: event.connectionId, conversationId: event.conversationId, customerId: event.customerId, occurredAt: event.occurredAt, dedupeKey: event.dedupeKey, source: { kind: event.source.kind, externalEventId: event.source.externalEventId }, payload: { messageId: event.payload.messageId, text: event.payload.text, attachmentIds: event.payload.attachmentIds, inboundSequence } });
}
