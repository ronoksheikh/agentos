import { ulid } from "ulid";
import { z } from "zod";
import { isoDateTimeSchema, jsonValueSchema, nowIso, redactSafe, ulidSchema, type JsonValue } from "@agentos/shared";
import type { AuthenticatedPrincipal, RealtimeScopeAuthorizer } from "@agentos/auth";

export const realtimeTypeSchema = z.enum(["run.started", "context.built", "model.requested", "model.completed", "tool.requested", "tool.completed", "action.validated", "action.applied", "memory.updated", "run.completed", "run.failed", "run.cancelled", "conversation.updated", "batch.formed", "handoff.requested", "handoff.updated", "notification.updated", "counter.updated"]);
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
  z.object({ type: z.literal("unsubscribe"), scope: z.object({ businessId: ulidSchema, conversationId: ulidSchema.optional(), runId: ulidSchema.optional() }) }),
  z.object({ type: z.literal("heartbeat"), sentAt: isoDateTimeSchema }),
]);
export const wsServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("authenticated"), heartbeatIntervalMs: z.number().int().positive() }),
  z.object({ type: z.literal("subscribed"), scope: z.object({ businessId: ulidSchema, conversationId: ulidSchema.optional(), runId: ulidSchema.optional() }) }),
  z.object({ type: z.literal("unsubscribed"), scope: z.object({ businessId: ulidSchema, conversationId: ulidSchema.optional(), runId: ulidSchema.optional() }) }),
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

export interface RealtimeSessionValidator { authenticateToken(token: string): AuthenticatedPrincipal | null | Promise<AuthenticatedPrincipal | null>; }

/** Connection-local WS boundary: the same opaque server session is validated before any scope is accepted. */
export class AuthenticatedRealtimeConnection {
  private principal: AuthenticatedPrincipal | null = null;
  private lastSeenAt = Date.now(); private requestWindowStartedAt = Date.now(); private requestCount = 0;
  private readonly subscriptions = new Set<string>();
  constructor(private readonly sessions: RealtimeSessionValidator, private readonly protocol: RealtimeProtocol, private readonly maxRequestsPerMinute = 120) {}
  private consume(now = Date.now()) { if (now - this.requestWindowStartedAt >= 60_000) { this.requestWindowStartedAt = now; this.requestCount = 0; } if (++this.requestCount > this.maxRequestsPerMinute) throw new Error("SOCKET_RATE_LIMITED"); this.lastSeenAt = now; }
  private scopeKey(scope: { businessId: string; conversationId?: string; runId?: string }) { return `${scope.businessId}:${scope.conversationId ?? "*"}:${scope.runId ?? "*"}`; }
  async authenticate(token: string) { this.consume(); const principal = await this.sessions.authenticateToken(token); if (!principal || principal.accountState !== "ACTIVE") throw new Error("UNAUTHORIZED_HANDSHAKE"); this.principal = principal; return { type: "authenticated" as const, heartbeatIntervalMs: this.protocol.heartbeatIntervalMs }; }
  async subscribe(scope: { businessId: string; conversationId?: string; runId?: string }, cursor = 0) { this.consume(); if (!this.principal) throw new Error("UNAUTHENTICATED_SOCKET"); const replay = await this.protocol.subscribe(this.principal, scope, cursor); this.subscriptions.add(this.scopeKey(scope)); return replay; }
  unsubscribe(scope: { businessId: string; conversationId?: string; runId?: string }) { this.consume(); if (!this.principal) throw new Error("UNAUTHENTICATED_SOCKET"); if (!this.subscriptions.delete(this.scopeKey(scope))) throw new Error("SUBSCRIPTION_NOT_FOUND"); return { type: "unsubscribed" as const, scope }; }
  heartbeat(now = new Date()) { this.consume(now.getTime()); if (!this.principal) throw new Error("UNAUTHENTICATED_SOCKET"); return { type: "heartbeat_ack" as const, receivedAt: now.toISOString() }; }
  isStale(now = Date.now()) { return now - this.lastSeenAt > this.protocol.staleAfterMs; }
}

export const safeRealtimePayload = (payload: unknown): JsonValue => redactSafe(payload);

export const clientActivitySchema = z.object({
  label: z.enum(["Agent started", "Customer context loaded", "Combined message batch", "Checking approved tool", "Preparing reply", "Reply sent", "Agent run failed", "Handoff requested", "Handoff updated", "Conversation updated"]),
  status: z.enum(["ACTIVE", "COMPLETED", "FAILED", "ATTENTION"]),
  count: z.number().int().nonnegative().optional(),
});
export type ClientActivity = z.infer<typeof clientActivitySchema>;

/** Strict audience projection: it rebuilds a payload from an allow-list rather than redacting an internal object in place. */
export class ClientRealtimeProjector {
  private readonly labels: Record<RealtimeEnvelope["type"], ClientActivity> = {
    "run.started": { label: "Agent started", status: "ACTIVE" }, "context.built": { label: "Customer context loaded", status: "COMPLETED" },
    "model.requested": { label: "Preparing reply", status: "ACTIVE" }, "model.completed": { label: "Preparing reply", status: "COMPLETED" },
    "tool.requested": { label: "Checking approved tool", status: "ACTIVE" }, "tool.completed": { label: "Checking approved tool", status: "COMPLETED" },
    "action.validated": { label: "Preparing reply", status: "ACTIVE" }, "action.applied": { label: "Reply sent", status: "COMPLETED" },
    "memory.updated": { label: "Customer context loaded", status: "COMPLETED" }, "run.completed": { label: "Reply sent", status: "COMPLETED" },
    "run.failed": { label: "Agent run failed", status: "FAILED" }, "run.cancelled": { label: "Agent run failed", status: "FAILED" },
    "conversation.updated": { label: "Conversation updated", status: "COMPLETED" }, "batch.formed": { label: "Combined message batch", status: "COMPLETED" },
    "handoff.requested": { label: "Handoff requested", status: "ATTENTION" }, "handoff.updated": { label: "Handoff updated", status: "COMPLETED" },
    "notification.updated": { label: "Handoff updated", status: "ATTENTION" }, "counter.updated": { label: "Conversation updated", status: "COMPLETED" },
  };
  project(event: RealtimeEnvelope): RealtimeEnvelope {
    const base = this.labels[event.type]; const payload = typeof event.payload === "object" && event.payload && !Array.isArray(event.payload) && typeof event.payload.count === "number" ? { ...base, count: Math.max(0, Math.trunc(event.payload.count)) } : base;
    return realtimeEnvelopeSchema.parse({ ...event, payload: clientActivitySchema.parse(payload) });
  }
  projectMany(events: RealtimeEnvelope[]) { return events.map((event) => this.project(event)); }
}
