import { ulid } from "ulid";
import { z } from "zod";
import { isoDateTimeSchema, jsonValueSchema, nowIso, redactSafe, ulidSchema, type JsonValue } from "@agentos/shared";
import type { AuthenticatedPrincipal, RealtimeScopeAuthorizer } from "@agentos/auth";

export const realtimeTypeSchema = z.enum(["run.started", "context.built", "model.requested", "model.completed", "tool.requested", "tool.completed", "action.validated", "action.applied", "memory.updated", "run.completed", "run.failed", "run.cancelled"]);
export const realtimeEnvelopeSchema = z.object({ id: ulidSchema, schemaVersion: z.literal("1.0"), type: realtimeTypeSchema, occurredAt: isoDateTimeSchema, sequence: z.number().int().positive().optional(), businessId: ulidSchema, conversationId: ulidSchema.optional(), runId: ulidSchema.optional(), traceId: ulidSchema, payload: jsonValueSchema });
export type RealtimeEnvelope = z.infer<typeof realtimeEnvelopeSchema>;
export interface RealtimeBus { publish(event: Omit<RealtimeEnvelope, "id" | "schemaVersion" | "occurredAt" | "sequence">): Promise<RealtimeEnvelope>; replay(businessId: string, afterSequence?: number): Promise<RealtimeEnvelope[]>; }

export class InMemoryRealtimeBus implements RealtimeBus {
  private sequence = 0; private readonly events: RealtimeEnvelope[] = [];
  async publish(event: Omit<RealtimeEnvelope, "id" | "schemaVersion" | "occurredAt" | "sequence">): Promise<RealtimeEnvelope> {
    const envelope = realtimeEnvelopeSchema.parse({ ...event, id: ulid(), schemaVersion: "1.0", occurredAt: nowIso(), sequence: ++this.sequence, payload: redactSafe(event.payload) });
    this.events.push(envelope); return structuredClone(envelope);
  }
  async replay(businessId: string, afterSequence = 0): Promise<RealtimeEnvelope[]> { return structuredClone(this.events.filter((event) => event.businessId === businessId && (event.sequence ?? 0) > afterSequence)); }
}

export interface RedisRealtimeTransport { publish(channel: string, payload: string): Promise<void>; }
export class RedisBackedRealtimeBus implements RealtimeBus {
  constructor(private readonly persisted: RealtimeBus, private readonly transport: RedisRealtimeTransport) {}
  async publish(event: Omit<RealtimeEnvelope, "id" | "schemaVersion" | "occurredAt" | "sequence">): Promise<RealtimeEnvelope> { const envelope = await this.persisted.publish(event); await this.transport.publish(`agentos:${envelope.businessId}:realtime`, JSON.stringify(envelope)); return envelope; }
  replay(businessId: string, afterSequence?: number): Promise<RealtimeEnvelope[]> { return this.persisted.replay(businessId, afterSequence); }
}

export const wsClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("authenticate"), token: z.string().min(1) }),
  z.object({ type: z.literal("subscribe"), scope: z.object({ businessId: ulidSchema, conversationId: ulidSchema.optional(), runId: ulidSchema.optional() }), cursor: z.number().int().nonnegative().optional() }),
  z.object({ type: z.literal("heartbeat"), sentAt: isoDateTimeSchema }),
]);
export const wsServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("authenticated"), heartbeatIntervalMs: z.number().int().positive() }),
  z.object({ type: z.literal("subscribed"), scope: z.object({ businessId: ulidSchema, conversationId: ulidSchema.optional(), runId: ulidSchema.optional() }) }),
  z.object({ type: z.literal("event"), event: realtimeEnvelopeSchema }),
  z.object({ type: z.literal("heartbeat_ack"), receivedAt: isoDateTimeSchema }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
]);

export class RealtimeProtocol {
  constructor(private readonly authorizer: RealtimeScopeAuthorizer, private readonly bus: RealtimeBus, readonly heartbeatIntervalMs = 30_000, readonly staleAfterMs = 90_000) {}
  async subscribe(principal: AuthenticatedPrincipal, scope: { businessId: string; conversationId?: string; runId?: string }, cursor = 0): Promise<RealtimeEnvelope[]> {
    if (principal.accountState !== "ACTIVE" || !(await this.authorizer.canSubscribe(principal, scope))) throw new Error("UNAUTHORIZED_SUBSCRIPTION");
    const events = await this.bus.replay(scope.businessId, cursor);
    return events.filter((event) => (!scope.conversationId || event.conversationId === scope.conversationId) && (!scope.runId || event.runId === scope.runId));
  }
}

export const safeRealtimePayload = (payload: unknown): JsonValue => redactSafe(payload);
