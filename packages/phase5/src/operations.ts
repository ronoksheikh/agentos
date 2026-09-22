import { ulid } from "ulid";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as dbs from "@agentos/database";
import { requireAgencyCapability, type AgencyRole } from "@agentos/auth";
import { ulidSchema } from "@agentos/shared";
import { Phase5Store } from "./store";
import type { Phase5Queues } from "./queue";

export const replayRequestSchema = z.object({ businessId: ulidSchema, workId: ulidSchema, dryRun: z.boolean().default(true) });
type Actor = { userId: string; role: AgencyRole; capabilities?: readonly string[] };

export class Phase5Operations {
  constructor(private readonly store: Phase5Store, private readonly queues?: Phase5Queues) {}
  async inspect(actor: Actor, businessId: string) {
    requireAgencyCapability(actor, "queue.read"); ulidSchema.parse(businessId);
    const scope = eq(dbs.workItems.businessId, businessId);
    const [work, events, batches, goals, effects, totals, locks, queueDepth, rawStats, oldest, failureCodes, responseLatency, lockContention] = await Promise.all([
      this.store.db.select({ id: dbs.workItems.id, kind: dbs.workItems.kind, resourceId: dbs.workItems.resourceId, state: dbs.workItems.state, attempt: dbs.workItems.attempt, safeCode: dbs.workItems.safeCode, runAt: dbs.workItems.runAt, createdAt: dbs.workItems.createdAt }).from(dbs.workItems).where(scope).orderBy(desc(dbs.workItems.createdAt)).limit(100),
      this.store.db.select({ id: dbs.universalEvents.id, type: dbs.universalEvents.type, state: dbs.universalEvents.state, safeCode: dbs.universalEvents.safeCode, receivedAt: dbs.universalEvents.receivedAt }).from(dbs.universalEvents).where(eq(dbs.universalEvents.businessId, businessId)).orderBy(desc(dbs.universalEvents.receivedAt)).limit(100),
      this.store.db.select({ id: dbs.messageBatches.id, conversationId: dbs.messageBatches.conversationId, state: dbs.messageBatches.state, upperSequence: dbs.messageBatches.upperSequence, messageIds: dbs.messageBatches.messageIds, dueAt: dbs.messageBatches.dueAt }).from(dbs.messageBatches).where(and(eq(dbs.messageBatches.businessId, businessId), sql`${dbs.messageBatches.state} IN ('BUFFERING','PROCESSING')`)).limit(100),
      this.store.db.select({ id: dbs.pendingGoals.id, state: dbs.pendingGoals.state, triggerType: dbs.pendingGoals.triggerType, expiresAt: dbs.pendingGoals.expiresAt }).from(dbs.pendingGoals).where(eq(dbs.pendingGoals.businessId, businessId)).limit(100),
      this.store.db.select({ id: dbs.effectIntents.id, type: dbs.effectIntents.type, state: dbs.effectIntents.state, safeCode: dbs.effectIntents.safeCode }).from(dbs.effectIntents).where(eq(dbs.effectIntents.businessId, businessId)).limit(100),
      this.store.db.select({ state: dbs.workItems.state, count: sql<number>`count(*)::int` }).from(dbs.workItems).where(scope).groupBy(dbs.workItems.state),
      this.queues?.activeLocks(businessId) ?? Promise.resolve([]),
      this.queues?.metrics() ?? Promise.resolve(null),
      this.store.db.select({ total: sql<number>`count(*)::int`, duplicates: sql<number>`coalesce(sum(${dbs.rawInboundEvents.duplicateCount}), 0)::int` }).from(dbs.rawInboundEvents).where(eq(dbs.rawInboundEvents.businessId, businessId)),
      this.store.db.select({ at: sql<Date | null>`min(${dbs.workItems.createdAt})` }).from(dbs.workItems).where(and(scope, sql`${dbs.workItems.state} IN ('PENDING','QUEUED')`)),
      this.store.db.select({ safeCode: dbs.workItems.safeCode, count: sql<number>`count(*)::int` }).from(dbs.workItems).where(and(scope, eq(dbs.workItems.state, "DEAD"))).groupBy(dbs.workItems.safeCode),
      this.store.db.select({ averageMs: sql<number>`coalesce(avg(extract(epoch from (${dbs.effectIntents.updatedAt} - ${dbs.messageBatches.firstAt})) * 1000), 0)::float` }).from(dbs.effectIntents).innerJoin(dbs.messageBatches, and(eq(dbs.messageBatches.businessId, dbs.effectIntents.businessId), eq(dbs.messageBatches.conversationId, dbs.effectIntents.conversationId), eq(dbs.messageBatches.upperSequence, dbs.effectIntents.includedSequence))).where(and(eq(dbs.effectIntents.businessId, businessId), eq(dbs.effectIntents.state, "COMPLETED"))),
      this.queues?.lockContention(businessId) ?? Promise.resolve(0),
    ]);
    const counts = Object.fromEntries(totals.map((item) => [item.state, item.count])) as Record<string, number>;
    const oldestAt = oldest[0]?.at ? new Date(oldest[0].at).getTime() : Date.now();
    return { work, events, batches, goals, effects, counts, locks, queueDepth, lockContention, failureCodes, duplicateRate: rawStats[0]?.total ? rawStats[0].duplicates / (rawStats[0].total + rawStats[0].duplicates) : 0, averageMessageToReplyMs: responseLatency[0]?.averageMs ?? 0, oldestPendingLagMs: Math.max(0, Date.now() - oldestAt) };
  }
  async replay(actor: Actor, unsafe: unknown) {
    requireAgencyCapability(actor, "queue.replay"); const input = replayRequestSchema.parse(unsafe);
    const work = await this.store.getWork(input.businessId, input.workId);
    if (!["DEAD", "CANCELLED"].includes(work.state)) throw new Error("REPLAY_STATE_DENIED");
    let safe = work.kind === "EVENT" || work.kind === "ATTACHMENT" || work.kind === "GOAL";
    if (work.kind === "OUTBOUND") {
      const effect = await this.store.getEffect(input.businessId, work.resourceId);
      safe = effect.state === "FAILED" || effect.state === "RESERVED";
    }
    if (work.kind === "CONVERSATION") {
      const batch = await this.store.getBatch(input.businessId, work.resourceId);
      const effects = await this.store.db.select({ id: dbs.effectIntents.id }).from(dbs.effectIntents).where(and(eq(dbs.effectIntents.businessId, input.businessId), eq(dbs.effectIntents.conversationId, batch.conversationId), eq(dbs.effectIntents.includedSequence, batch.upperSequence))).limit(1);
      safe = ["FAILED", "CANCELLED"].includes(batch.state) && !effects.length;
    }
    const preview = { workId: work.id, kind: work.kind, state: work.state, attempts: work.attempt, safe };
    if (!input.dryRun && !safe) throw new Error("REPLAY_RECONCILIATION_REQUIRED");
    await this.store.db.insert(dbs.auditLogs).values({ id: ulid(), businessId: input.businessId, actorId: actor.userId, action: input.dryRun ? "work.replay_preview" : "work.replayed", targetType: "work_item", targetId: work.id, safeMetadata: preview });
    if (input.dryRun) return { ...preview, replayed: false };
    if (work.kind === "OUTBOUND") await this.store.db.update(dbs.effectIntents).set({ state: "RESERVED", safeCode: null, updatedAt: new Date() }).where(and(eq(dbs.effectIntents.businessId, input.businessId), eq(dbs.effectIntents.id, work.resourceId)));
    if (work.kind === "CONVERSATION") await this.store.db.update(dbs.messageBatches).set({ state: "BUFFERING", dueAt: new Date(), updatedAt: new Date() }).where(and(eq(dbs.messageBatches.businessId, input.businessId), eq(dbs.messageBatches.id, work.resourceId)));
    await this.store.db.update(dbs.workItems).set({ state: "PENDING", attempt: 0, cancelledAt: null, completedAt: null, safeCode: "OPERATOR_REPLAY", runAt: new Date(), updatedAt: new Date() }).where(and(eq(dbs.workItems.businessId, input.businessId), eq(dbs.workItems.id, input.workId)));
    return { ...preview, replayed: true };
  }
  async cancel(actor: Actor, businessId: string, workId: string) {
    requireAgencyCapability(actor, "queue.replay"); ulidSchema.parse(businessId); ulidSchema.parse(workId);
    const work = await this.store.getWork(businessId, workId);
    const cancelled = await this.store.cancelWork(businessId, workId);
    if (cancelled && work.kind === "OUTBOUND") await this.store.effectState(businessId, work.resourceId, "CANCELLED", "OPERATOR_CANCELLED");
    if (cancelled && work.kind === "CONVERSATION") await this.store.completeBatch(businessId, work.resourceId, null, "CANCELLED", "OPERATOR_CANCELLED");
    await this.store.db.insert(dbs.auditLogs).values({ id: ulid(), businessId, actorId: actor.userId, action: "work.cancelled", targetType: "work_item", targetId: workId, safeMetadata: { cancelled } });
    return { cancelled };
  }
}
