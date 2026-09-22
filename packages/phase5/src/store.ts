import { ulid } from "ulid";
import { and, eq, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as dbs from "@agentos/database";
import { universalEventSchema, type UniversalEvent, type RawEventRecord } from "@agentos/events";
import { universalChannelActionSchema, type UniversalChannelAction } from "@agentos/actions";
import { workJobSchema, type WorkKind } from "./contracts";

export class Phase5Store {
  constructor(readonly db: NodePgDatabase) {}

  /** Raw receipt, normalized events, messages, batches, and enqueue intents share one commit. */
  async ingest(raw: RawEventRecord, unsafeEvents: readonly UniversalEvent[], timing: { quietMs: number; maxWaitMs: number }) {
    const events = unsafeEvents.map((event) => universalEventSchema.parse(event));
    if (!events.length || events.some((event) => event.businessId !== raw.businessId || event.connectionId !== raw.connectionId || event.channel !== raw.channel || event.rawEventId !== raw.id)) throw new Error("EVENT_SCOPE_INVALID");
    return this.db.transaction(async (tx) => {
      const inserted = await tx.insert(dbs.rawInboundEvents).values({ ...raw, receivedAt: new Date(raw.receivedAt), retentionUntil: new Date(raw.retentionUntil) }).onConflictDoNothing().returning({ id: dbs.rawInboundEvents.id });
      if (!inserted.length) return { duplicate: true, eventIds: [] as string[], batchIds: [] as string[] };
      const batchIds: string[] = [];
      for (const event of events) {
        const result = await tx.insert(dbs.universalEvents).values({ id: event.id, businessId: event.businessId, rawEventId: raw.id, connectionId: event.connectionId, channel: event.channel, conversationId: event.conversationId ?? null, customerId: event.customerId ?? null, schemaVersion: event.schemaVersion, type: event.type, dedupeKey: event.dedupeKey, payload: event.payload, source: event.source, traceId: event.traceId, state: event.type === "message.received" ? "BUFFERED" : "PENDING", occurredAt: new Date(event.occurredAt), receivedAt: new Date(event.receivedAt) }).onConflictDoNothing().returning({ id: dbs.universalEvents.id });
        if (!result.length) continue;
        if (event.type !== "message.received") {
          await tx.insert(dbs.workItems).values({ id: ulid(), businessId: event.businessId, kind: "EVENT", resourceId: event.id, conversationId: event.conversationId ?? null, connectionId: event.connectionId, traceId: event.traceId, priority: event.type === "scheduled.triggered" ? 1 : 5, state: "PENDING", runAt: new Date(event.receivedAt) });
          continue;
        }
        if (!event.conversationId) throw new Error("CONVERSATION_REQUIRED");
        const conversation = (await tx.update(dbs.conversations).set({ latestInboundSequence: sql`${dbs.conversations.latestInboundSequence} + 1`, updatedAt: new Date() }).where(and(eq(dbs.conversations.id, event.conversationId), eq(dbs.conversations.businessId, event.businessId), eq(dbs.conversations.channel, event.channel))).returning({ sequence: dbs.conversations.latestInboundSequence, activeBatchId: dbs.conversations.activeBatchId, customerId: dbs.conversations.customerId }))[0];
        if (!conversation || (event.customerId && conversation.customerId !== event.customerId)) throw new Error("CONVERSATION_SCOPE_DENIED");
        await tx.insert(dbs.messages).values({ id: event.payload.messageId, businessId: event.businessId, conversationId: event.conversationId, customerId: event.customerId ?? null, connectionId: event.connectionId, externalMessageId: event.source.externalMessageId ?? null, externalParentId: event.payload.replyToExternalId ?? event.source.externalParentId ?? null, senderKind: "CUSTOMER", text: event.payload.text ?? null, occurredAt: new Date(event.occurredAt), receivedAt: new Date(event.receivedAt), inboundSequence: conversation.sequence, traceId: event.traceId, rawEventSourceRef: raw.id, lifecycle: { attachmentIds: event.payload.attachmentIds } });
        const now = new Date(event.receivedAt);
        const existing = conversation.activeBatchId ? (await tx.select().from(dbs.messageBatches).where(and(eq(dbs.messageBatches.id, conversation.activeBatchId), eq(dbs.messageBatches.businessId, event.businessId), eq(dbs.messageBatches.state, "BUFFERING"))).limit(1))[0] : undefined;
        if (existing && !event.payload.urgent) {
          const dueAt = new Date(Math.min(now.getTime() + timing.quietMs, existing.firstAt.getTime() + timing.maxWaitMs));
          await tx.update(dbs.messageBatches).set({ messageIds: [...existing.messageIds, event.payload.messageId], eventIds: [...existing.eventIds, event.id], upperSequence: conversation.sequence, dueAt, updatedAt: now }).where(eq(dbs.messageBatches.id, existing.id));
          await tx.update(dbs.workItems).set({ runAt: dueAt, state: "PENDING", updatedAt: now }).where(and(eq(dbs.workItems.businessId, event.businessId), eq(dbs.workItems.kind, "CONVERSATION"), eq(dbs.workItems.resourceId, existing.id)));
          batchIds.push(existing.id);
        } else {
          const batchId = ulid(); const dueAt = event.payload.urgent ? now : new Date(Math.min(now.getTime() + timing.quietMs, now.getTime() + timing.maxWaitMs));
          await tx.insert(dbs.messageBatches).values({ id: batchId, businessId: event.businessId, conversationId: event.conversationId, channel: event.channel, connectionId: event.connectionId, traceId: event.traceId, state: "BUFFERING", messageIds: [event.payload.messageId], eventIds: [event.id], firstSequence: conversation.sequence, upperSequence: conversation.sequence, firstAt: now, dueAt });
          if (!event.payload.urgent) await tx.update(dbs.conversations).set({ activeBatchId: batchId }).where(and(eq(dbs.conversations.id, event.conversationId), eq(dbs.conversations.businessId, event.businessId)));
          await tx.insert(dbs.workItems).values({ id: ulid(), businessId: event.businessId, kind: "CONVERSATION", resourceId: batchId, conversationId: event.conversationId, connectionId: event.connectionId, traceId: event.traceId, priority: event.payload.urgent ? 1 : 5, state: "PENDING", runAt: dueAt });
          batchIds.push(batchId);
        }
      }
      await tx.update(dbs.rawInboundEvents).set({ state: "NORMALIZED" }).where(eq(dbs.rawInboundEvents.id, raw.id));
      return { duplicate: false, eventIds: events.map((event) => event.id), batchIds };
    });
  }

  async getEvent(businessId: string, eventId: string): Promise<UniversalEvent> {
    const row = (await this.db.select().from(dbs.universalEvents).where(and(eq(dbs.universalEvents.businessId, businessId), eq(dbs.universalEvents.id, eventId))).limit(1))[0];
    if (!row || !row.rawEventId) throw new Error("EVENT_NOT_FOUND");
    return universalEventSchema.parse({ ...row, rawEventId: row.rawEventId, occurredAt: row.occurredAt.toISOString(), receivedAt: row.receivedAt.toISOString() });
  }
  async getBatch(businessId: string, batchId: string) {
    const row = (await this.db.select().from(dbs.messageBatches).where(and(eq(dbs.messageBatches.businessId, businessId), eq(dbs.messageBatches.id, batchId))).limit(1))[0];
    if (!row) throw new Error("BATCH_NOT_FOUND"); return row;
  }
  async claimBatch(businessId: string, batchId: string) {
    return this.db.transaction(async (tx) => {
      const row = (await tx.select().from(dbs.messageBatches).where(and(eq(dbs.messageBatches.businessId, businessId), eq(dbs.messageBatches.id, batchId))).limit(1).for("update"))[0];
      if (!row || row.state !== "BUFFERING") return null;
      if (row.dueAt > new Date()) return { deferredUntil: row.dueAt } as const;
      await tx.update(dbs.messageBatches).set({ state: "PROCESSING", startedAt: new Date(), updatedAt: new Date() }).where(eq(dbs.messageBatches.id, batchId));
      await tx.update(dbs.conversations).set({ activeBatchId: null }).where(and(eq(dbs.conversations.businessId, businessId), eq(dbs.conversations.id, row.conversationId), eq(dbs.conversations.activeBatchId, batchId)));
      return { batch: row } as const;
    });
  }
  async latestSequence(businessId: string, conversationId: string) {
    const row = (await this.db.select({ sequence: dbs.conversations.latestInboundSequence, ownership: dbs.conversations.ownership, agentId: dbs.conversations.agentId, customerId: dbs.conversations.customerId, channel: dbs.conversations.channel, businessState: dbs.businesses.state, disabled: dbs.businesses.disabled, activeVersionId: dbs.agents.activeVersionId }).from(dbs.conversations).innerJoin(dbs.businesses, eq(dbs.businesses.id, dbs.conversations.businessId)).leftJoin(dbs.agents, eq(dbs.agents.id, dbs.conversations.agentId)).where(and(eq(dbs.conversations.id, conversationId), eq(dbs.conversations.businessId, businessId))).limit(1))[0];
    if (!row) throw new Error("CONVERSATION_NOT_FOUND"); return row;
  }
  async completeBatch(businessId: string, batchId: string, runId: string | null, state: "COMPLETED" | "SUPPRESSED" | "FAILED" | "CANCELLED", safeCode?: string) {
    await this.db.update(dbs.messageBatches).set({ state, runId, safeCode: safeCode ?? null, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(dbs.messageBatches.businessId, businessId), eq(dbs.messageBatches.id, batchId)));
  }
  async listDue(limit = 100) {
    return this.db.select().from(dbs.workItems).where(and(eq(dbs.workItems.state, "PENDING"), lte(dbs.workItems.runAt, new Date()))).orderBy(dbs.workItems.priority, dbs.workItems.runAt).limit(limit);
  }
  async markQueued(workId: string) { await this.db.update(dbs.workItems).set({ state: "QUEUED", updatedAt: new Date() }).where(and(eq(dbs.workItems.id, workId), eq(dbs.workItems.state, "PENDING"))); }
  async getWork(businessId: string, workId: string) {
    const row = (await this.db.select().from(dbs.workItems).where(and(eq(dbs.workItems.id, workId), eq(dbs.workItems.businessId, businessId))).limit(1))[0];
    if (!row) throw new Error("WORK_NOT_FOUND"); return row;
  }
  async startWork(businessId: string, workId: string) {
    const row = (await this.db.update(dbs.workItems).set({ state: "RUNNING", startedAt: new Date(), attempt: sql`${dbs.workItems.attempt} + 1`, updatedAt: new Date() }).where(and(eq(dbs.workItems.id, workId), eq(dbs.workItems.businessId, businessId), eq(dbs.workItems.state, "QUEUED"))).returning())[0];
    return row ?? null;
  }
  async finishWork(businessId: string, workId: string, state: "COMPLETED" | "CANCELLED" | "DEAD", safeCode?: string) {
    await this.db.update(dbs.workItems).set({ state, safeCode: safeCode ?? null, completedAt: new Date(), updatedAt: new Date() }).where(and(eq(dbs.workItems.businessId, businessId), eq(dbs.workItems.id, workId)));
  }
  async reschedule(businessId: string, workId: string, at: Date, safeCode?: string) {
    await this.db.update(dbs.workItems).set({ state: "PENDING", runAt: at, safeCode: safeCode ?? null, updatedAt: new Date() }).where(and(eq(dbs.workItems.businessId, businessId), eq(dbs.workItems.id, workId)));
  }
  async cancelWork(businessId: string, workId: string) {
    const rows = await this.db.update(dbs.workItems).set({ state: "CANCELLED", cancelledAt: new Date(), updatedAt: new Date() }).where(and(eq(dbs.workItems.businessId, businessId), eq(dbs.workItems.id, workId), sql`${dbs.workItems.state} NOT IN ('COMPLETED','DEAD','CANCELLED')`)).returning({ id: dbs.workItems.id });
    return rows.length > 0;
  }
  async workJob(businessId: string, workId: string) {
    const row = await this.getWork(businessId, workId);
    return workJobSchema.parse({ schemaVersion: "1.0", workId: row.id, businessId: row.businessId, traceId: row.traceId, kind: row.kind as WorkKind });
  }
  async eventState(businessId: string, eventId: string, state: string, safeCode?: string) {
    await this.db.update(dbs.universalEvents).set({ state, safeCode: safeCode ?? null, processedAt: new Date(), updatedAt: new Date() }).where(and(eq(dbs.universalEvents.businessId, businessId), eq(dbs.universalEvents.id, eventId)));
  }
  async reserveEffect(input: { businessId: string; conversationId: string; traceId: string; action: UniversalChannelAction; includedSequence: number; runAt: Date; relatedOrderId?: string }) {
    const action = universalChannelActionSchema.parse(input.action);
    return this.db.transaction(async (tx) => {
      const effectId = ulid();
      const inserted = await tx.insert(dbs.effectIntents).values({ id: effectId, businessId: input.businessId, conversationId: input.conversationId, actionId: action.id, idempotencyKey: action.idempotencyKey, type: action.type, payload: action, includedSequence: input.includedSequence, traceId: input.traceId, relatedOrderId: input.relatedOrderId ?? null, state: "RESERVED" }).onConflictDoNothing().returning({ id: dbs.effectIntents.id });
      if (!inserted.length) {
        const existing = (await tx.select().from(dbs.effectIntents).where(and(eq(dbs.effectIntents.businessId, input.businessId), eq(dbs.effectIntents.idempotencyKey, action.idempotencyKey))).limit(1))[0];
        if (!existing || existing.conversationId !== input.conversationId || existing.type !== action.type || JSON.stringify(existing.payload) !== JSON.stringify(action)) throw new Error("EFFECT_IDEMPOTENCY_CONFLICT");
        return { id: existing.id, duplicate: true };
      }
      await tx.insert(dbs.workItems).values({ id: ulid(), businessId: input.businessId, kind: "OUTBOUND", resourceId: effectId, conversationId: input.conversationId, traceId: input.traceId, state: "PENDING", runAt: input.runAt, priority: input.relatedOrderId ? 1 : 5 });
      return { id: effectId, duplicate: false };
    });
  }
  async enqueueOrderNotification(input: { businessId: string; conversationId: string; traceId: string; orderId: string; action: UniversalChannelAction }) {
    const order = (await this.db.select({ id: dbs.orders.id, state: dbs.orders.notificationState }).from(dbs.orders).where(and(eq(dbs.orders.id, input.orderId), eq(dbs.orders.businessId, input.businessId), eq(dbs.orders.conversationId, input.conversationId))).limit(1))[0];
    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (order.state === "SENT") return { id: null, duplicate: true };
    const current = await this.latestSequence(input.businessId, input.conversationId);
    return this.reserveEffect({ businessId: input.businessId, conversationId: input.conversationId, traceId: input.traceId, action: input.action, includedSequence: current.sequence, runAt: new Date(), relatedOrderId: input.orderId });
  }
  async retryFailedOrderNotification(businessId: string, orderId: string) {
    const effect = (await this.db.select().from(dbs.effectIntents).where(and(eq(dbs.effectIntents.businessId, businessId), eq(dbs.effectIntents.relatedOrderId, orderId), eq(dbs.effectIntents.state, "FAILED"))).limit(1))[0];
    if (!effect) throw new Error("ORDER_NOTIFICATION_NOT_RETRYABLE");
    await this.db.transaction(async (tx) => {
      await tx.update(dbs.effectIntents).set({ state: "RESERVED", safeCode: null, updatedAt: new Date() }).where(and(eq(dbs.effectIntents.id, effect.id), eq(dbs.effectIntents.businessId, businessId), eq(dbs.effectIntents.state, "FAILED")));
      await tx.update(dbs.workItems).set({ state: "PENDING", runAt: new Date(), attempt: 0, updatedAt: new Date() }).where(and(eq(dbs.workItems.businessId, businessId), eq(dbs.workItems.kind, "OUTBOUND"), eq(dbs.workItems.resourceId, effect.id)));
    });
    return effect.id;
  }
  async getEffect(businessId: string, effectId: string) {
    const row = (await this.db.select().from(dbs.effectIntents).where(and(eq(dbs.effectIntents.businessId, businessId), eq(dbs.effectIntents.id, effectId))).limit(1))[0];
    if (!row) throw new Error("EFFECT_NOT_FOUND"); return { ...row, action: universalChannelActionSchema.parse(row.payload) };
  }
  async claimEffect(businessId: string, effectId: string) {
    const row = (await this.db.update(dbs.effectIntents).set({ state: "EXECUTING", updatedAt: new Date() }).where(and(eq(dbs.effectIntents.businessId, businessId), eq(dbs.effectIntents.id, effectId), eq(dbs.effectIntents.state, "RESERVED"))).returning())[0];
    return row ?? null;
  }
  async effectState(businessId: string, effectId: string, state: "COMPLETED" | "UNKNOWN" | "FAILED" | "CANCELLED", safeCode?: string, externalId?: string) {
    await this.db.update(dbs.effectIntents).set({ state, safeCode: safeCode ?? null, externalId: externalId ?? null, updatedAt: new Date() }).where(and(eq(dbs.effectIntents.businessId, businessId), eq(dbs.effectIntents.id, effectId)));
  }
  async activateGoals(event: UniversalEvent) {
    if (!["inventory.updated", "order.created", "order.updated", "scheduled.triggered"].includes(event.type)) return [];
    return this.db.transaction(async (tx) => {
      const goals = await tx.select().from(dbs.pendingGoals).where(and(eq(dbs.pendingGoals.businessId, event.businessId), eq(dbs.pendingGoals.state, "PENDING")));
      const activated: string[] = [];
      for (const goal of goals) {
        if (goal.expiresAt && goal.expiresAt <= new Date()) { await tx.update(dbs.pendingGoals).set({ state: "EXPIRED" }).where(eq(dbs.pendingGoals.id, goal.id)); continue; }
        const trigger = goal.trigger as Record<string, string>;
        const matches = event.type === "scheduled.triggered" ? goal.id === event.payload.goalId : event.type === "inventory.updated" ? goal.triggerType === "INVENTORY" && trigger.productId === event.payload.productId && (!trigger.variantId || trigger.variantId === event.payload.variantId) && event.payload.available > 0 : goal.triggerType === "EVENT" && trigger.eventType === event.type;
        if (!matches) continue;
        const executionId = ulid();
        const inserted = await tx.insert(dbs.goalExecutions).values({ id: executionId, businessId: event.businessId, goalId: goal.id, triggerEventId: event.id, state: "PENDING" }).onConflictDoNothing().returning({ id: dbs.goalExecutions.id });
        if (!inserted.length) continue;
        await tx.insert(dbs.workItems).values({ id: ulid(), businessId: event.businessId, kind: "GOAL", resourceId: executionId, conversationId: goal.conversationId, traceId: event.traceId, state: "PENDING", runAt: new Date(), priority: 2 });
        activated.push(goal.id);
      }
      return activated;
    });
  }
  async scheduleDueGoals() {
    const goals = await this.db.select().from(dbs.pendingGoals).where(and(eq(dbs.pendingGoals.state, "PENDING"), eq(dbs.pendingGoals.triggerType, "TIME"))).limit(500);
    let count = 0;
    for (const goal of goals) {
      const at = Date.parse((goal.trigger as Record<string, string>).at ?? "");
      if (!Number.isFinite(at) || at > Date.now()) continue;
      await this.db.transaction(async (tx) => {
        if (goal.expiresAt && goal.expiresAt <= new Date()) { await tx.update(dbs.pendingGoals).set({ state: "EXPIRED" }).where(eq(dbs.pendingGoals.id, goal.id)); return; }
        const executionId = ulid();
        const inserted = await tx.insert(dbs.goalExecutions).values({ id: executionId, businessId: goal.businessId, goalId: goal.id, state: "PENDING" }).onConflictDoNothing().returning({ id: dbs.goalExecutions.id });
        if (!inserted.length) return;
        await tx.insert(dbs.workItems).values({ id: ulid(), businessId: goal.businessId, kind: "GOAL", resourceId: executionId, conversationId: goal.conversationId, traceId: goal.traceId, state: "PENDING", runAt: new Date(), priority: 2 }); count++;
      });
    }
    return count;
  }
}
