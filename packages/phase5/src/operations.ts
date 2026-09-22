import { ulid } from "ulid";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import * as dbs from "@agentos/database";
import { requireAgencyCapability, type AgencyRole } from "@agentos/auth";
import { ulidSchema } from "@agentos/shared";
import { Phase5Store } from "./store";

export const replayRequestSchema = z.object({ businessId: ulidSchema, workId: ulidSchema, dryRun: z.boolean().default(true) });
type Actor = { userId: string; role: AgencyRole; capabilities?: readonly string[] };

export class Phase5Operations {
  constructor(private readonly store: Phase5Store) {}
  async inspect(actor: Actor, businessId: string) {
    requireAgencyCapability(actor, "queue.read"); ulidSchema.parse(businessId);
    const scope = eq(dbs.workItems.businessId, businessId);
    const [work, events, batches, goals, effects] = await Promise.all([
      this.store.db.select({ id: dbs.workItems.id, kind: dbs.workItems.kind, resourceId: dbs.workItems.resourceId, state: dbs.workItems.state, attempt: dbs.workItems.attempt, safeCode: dbs.workItems.safeCode, runAt: dbs.workItems.runAt, createdAt: dbs.workItems.createdAt }).from(dbs.workItems).where(scope).orderBy(desc(dbs.workItems.createdAt)).limit(100),
      this.store.db.select({ id: dbs.universalEvents.id, type: dbs.universalEvents.type, state: dbs.universalEvents.state, safeCode: dbs.universalEvents.safeCode, receivedAt: dbs.universalEvents.receivedAt }).from(dbs.universalEvents).where(eq(dbs.universalEvents.businessId, businessId)).orderBy(desc(dbs.universalEvents.receivedAt)).limit(100),
      this.store.db.select({ id: dbs.messageBatches.id, conversationId: dbs.messageBatches.conversationId, state: dbs.messageBatches.state, upperSequence: dbs.messageBatches.upperSequence, messageIds: dbs.messageBatches.messageIds, dueAt: dbs.messageBatches.dueAt }).from(dbs.messageBatches).where(and(eq(dbs.messageBatches.businessId, businessId), sql`${dbs.messageBatches.state} IN ('BUFFERING','PROCESSING')`)).limit(100),
      this.store.db.select({ id: dbs.pendingGoals.id, state: dbs.pendingGoals.state, triggerType: dbs.pendingGoals.triggerType, expiresAt: dbs.pendingGoals.expiresAt }).from(dbs.pendingGoals).where(eq(dbs.pendingGoals.businessId, businessId)).limit(100),
      this.store.db.select({ id: dbs.effectIntents.id, type: dbs.effectIntents.type, state: dbs.effectIntents.state, safeCode: dbs.effectIntents.safeCode }).from(dbs.effectIntents).where(eq(dbs.effectIntents.businessId, businessId)).limit(100),
    ]);
    const counts = work.reduce<Record<string, number>>((result, item) => { result[item.state] = (result[item.state] ?? 0) + 1; return result; }, {});
    return { work, events, batches, goals, effects, counts, oldestPendingLagMs: Math.max(0, Date.now() - Math.min(Date.now(), ...work.filter((item) => ["PENDING", "QUEUED"].includes(item.state)).map((item) => item.createdAt.getTime()))) };
  }
  async replay(actor: Actor, unsafe: unknown) {
    requireAgencyCapability(actor, "queue.replay"); const input = replayRequestSchema.parse(unsafe);
    const work = await this.store.getWork(input.businessId, input.workId);
    if (!["DEAD", "CANCELLED"].includes(work.state)) throw new Error("REPLAY_STATE_DENIED");
    if (work.kind === "OUTBOUND") {
      const effect = await this.store.getEffect(input.businessId, work.resourceId);
      if (effect.state === "UNKNOWN" || effect.state === "EXECUTING" || effect.state === "COMPLETED") throw new Error("EXTERNAL_RECONCILIATION_REQUIRED");
    }
    const preview = { workId: work.id, kind: work.kind, state: work.state, attempts: work.attempt, safe: work.kind !== "OUTBOUND" };
    await this.store.db.insert(dbs.auditLogs).values({ id: ulid(), businessId: input.businessId, actorId: actor.userId, action: input.dryRun ? "work.replay_preview" : "work.replayed", targetType: "work_item", targetId: work.id, safeMetadata: preview });
    if (input.dryRun) return { ...preview, replayed: false };
    await this.store.db.update(dbs.workItems).set({ state: "PENDING", attempt: 0, cancelledAt: null, completedAt: null, safeCode: "OPERATOR_REPLAY", runAt: new Date(), updatedAt: new Date() }).where(and(eq(dbs.workItems.businessId, input.businessId), eq(dbs.workItems.id, input.workId)));
    return { ...preview, replayed: true };
  }
  async cancel(actor: Actor, businessId: string, workId: string) {
    requireAgencyCapability(actor, "queue.replay"); ulidSchema.parse(businessId); ulidSchema.parse(workId);
    const cancelled = await this.store.cancelWork(businessId, workId);
    await this.store.db.insert(dbs.auditLogs).values({ id: ulid(), businessId, actorId: actor.userId, action: "work.cancelled", targetType: "work_item", targetId: workId, safeMetadata: { cancelled } });
    return { cancelled };
  }
}
