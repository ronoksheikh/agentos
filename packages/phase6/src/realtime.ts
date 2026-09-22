import { and, eq, gt, max, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ulid } from "ulid";
import { realtimeEvents } from "@agentos/database";
import { realtimeEnvelopeSchema, type RealtimeBus, type RealtimeEnvelope } from "@agentos/realtime";
import { nowIso, redactSafe } from "@agentos/shared";

/** Durable, tenant-sequenced safe events for worker progress and client replay. */
export class PostgresRealtimeBus implements RealtimeBus {
  constructor(private readonly db: NodePgDatabase) {}
  async publish(event: Omit<RealtimeEnvelope, "id" | "schemaVersion" | "occurredAt" | "sequence">) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`realtime:${event.businessId}`}, 0))`);
      const last = (await tx.select({ sequence: max(realtimeEvents.sequence) }).from(realtimeEvents).where(eq(realtimeEvents.businessId, event.businessId)))[0]?.sequence ?? 0;
      const envelope = realtimeEnvelopeSchema.parse({ ...event, id: ulid(), schemaVersion: "1.0", occurredAt: nowIso(), sequence: last + 1, payload: redactSafe(event.payload) });
      await tx.insert(realtimeEvents).values({ id: envelope.id, businessId: envelope.businessId, conversationId: envelope.conversationId ?? null, runId: envelope.runId ?? null, traceId: envelope.traceId, schemaVersion: envelope.schemaVersion, type: envelope.type, sequence: envelope.sequence!, safePayload: envelope.payload, occurredAt: new Date(envelope.occurredAt) });
      return envelope;
    });
  }
  async replay(businessId: string, afterSequence = 0) {
    const rows = await this.db.select().from(realtimeEvents).where(and(eq(realtimeEvents.businessId, businessId), gt(realtimeEvents.sequence, afterSequence))).orderBy(realtimeEvents.sequence).limit(500);
    return rows.map((row) => realtimeEnvelopeSchema.parse({ id: row.id, schemaVersion: row.schemaVersion, type: row.type, businessId: row.businessId, ...(row.conversationId ? { conversationId: row.conversationId } : {}), ...(row.runId ? { runId: row.runId } : {}), traceId: row.traceId, sequence: row.sequence, payload: row.safePayload, occurredAt: row.occurredAt.toISOString() }));
  }
}
