import { createHash } from "node:crypto";
import { ulid } from "ulid";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as dbs from "@agentos/database";
import type { AgentRuntime, AgentRunResult } from "@agentos/agent-runtime";
import { universalChannelActionSchema, type UniversalChannelAction } from "@agentos/actions";
import type { ChannelAdapter, ChannelRegistry, PresenceController } from "@agentos/channels";
import { rawEventRecordSchema, toRuntimeEvent, universalEventSchema, type UniversalEvent } from "@agentos/events";
import type { RealtimeBus } from "@agentos/realtime";
import { createTrustedBusinessContext, type TrustedBusinessContext } from "@agentos/shared";
import { evaluateResponseTiming } from "./contracts";
import type { RedisConversationLease } from "./queue";
import { Phase5Store } from "./store";

type Request = { headers: Headers; body: Uint8Array };
export class InboundGateway {
  constructor(private readonly store: Phase5Store) {}
  async accept(adapter: ChannelAdapter, request: Request, trusted: TrustedBusinessContext, timing?: { quietMs: number; maxWaitMs: number }) {
    if (request.body.byteLength > 1_000_000) throw new Error("VALIDATION_ERROR");
    const connectionId = trusted.principal.kind === "adapter" ? trusted.principal.connectionId : undefined;
    if (!connectionId || trusted.source !== "verified_adapter") throw new Error("TRUSTED_SCOPE_MISMATCH");
    const verified = await adapter.verifyInbound(request);
    if (!verified.verified) { await this.store.db.insert(dbs.auditLogs).values({ id: ulid(), businessId: trusted.businessId, actorId: "adapter", action: "inbound.rejected", targetType: "connection", targetId: connectionId, safeMetadata: { code: "PERMISSION_ERROR", channel: adapter.channel } }); throw new Error("PERMISSION_ERROR"); }
    const rawId = ulid(); const receivedAt = new Date().toISOString();
    let normalized: UniversalEvent[];
    try { normalized = adapter.normalizeUniversalInbound ? await adapter.normalizeUniversalInbound(request, trusted) : (await adapter.normalizeInbound(request, trusted)).map((legacy): UniversalEvent => {
      if (legacy.type !== "message.received") throw new Error("LEGACY_EVENT_UNSUPPORTED");
      const metadata = legacy.source.metadata && typeof legacy.source.metadata === "object" && !Array.isArray(legacy.source.metadata) ? legacy.source.metadata : {};
      const externalMessageId = typeof metadata.externalMessageId === "string" ? metadata.externalMessageId : undefined;
      const replyToExternalId = typeof metadata.replyToExternalId === "string" ? metadata.replyToExternalId : undefined;
      return universalEventSchema.parse({ id: legacy.id, schemaVersion: "1.0", type: legacy.type, businessId: legacy.businessId, channel: legacy.channel, connectionId, conversationId: legacy.conversationId, customerId: legacy.customerId, dedupeKey: legacy.dedupeKey, occurredAt: legacy.occurredAt, receivedAt, traceId: trusted.traceId, rawEventId: rawId, source: { kind: legacy.source.kind, externalEventId: legacy.source.externalEventId, externalMessageId, externalParentId: replyToExternalId }, payload: { messageId: legacy.payload.messageId, text: legacy.payload.text, attachmentIds: legacy.payload.attachmentIds, replyToExternalId, urgent: legacy.payload.urgent ?? false } });
    }); } catch { await this.store.db.insert(dbs.auditLogs).values({ id: ulid(), businessId: trusted.businessId, actorId: "adapter", action: "inbound.rejected", targetType: "connection", targetId: connectionId, safeMetadata: { code: "VALIDATION_ERROR", channel: adapter.channel } }); throw new Error("VALIDATION_ERROR"); }
    if (!normalized.length) return { acknowledged: true, duplicate: false, eventIds: [] as string[] };
    const events = normalized.map((candidate) => universalEventSchema.parse({ ...candidate, rawEventId: rawId, receivedAt, traceId: trusted.traceId }));
    if (events.some((event) => event.businessId !== trusted.businessId || event.connectionId !== connectionId || event.channel !== adapter.channel || event.conversationId !== trusted.conversationId)) throw new Error("TRUSTED_SCOPE_MISMATCH");
    const raw = rawEventRecordSchema.parse({ id: rawId, businessId: trusted.businessId, connectionId, channel: adapter.channel, dedupeKey: events[0]!.dedupeKey, externalEventId: events[0]!.source.externalEventId, payloadSha256: createHash("sha256").update(request.body).digest("hex"), payloadBytes: request.body.byteLength, receivedAt, retentionUntil: new Date(Date.now() + 7 * 86400_000).toISOString(), state: "RECEIVED" });
    const resolvedTiming = timing ? z.object({ quietMs: z.number().int().min(0).max(60_000), maxWaitMs: z.number().int().min(0).max(120_000) }).parse(timing) : await this.store.timingPolicyFor(trusted.businessId, trusted.agentId!, adapter.channel).then((policy) => ({ quietMs: policy.debounceMs, maxWaitMs: policy.maxBatchWaitMs }));
    const result = await this.store.ingest(raw, events, resolvedTiming);
    return { acknowledged: true, duplicate: result.duplicate, eventIds: result.eventIds, batchIds: result.batchIds };
  }
}

export class EventRouter {
  constructor(private readonly store: Phase5Store, private readonly attachment?: (event: UniversalEvent, signal: AbortSignal) => Promise<void>, private readonly browser?: (businessId: string, browserRunId: string, signal: AbortSignal) => Promise<void>, private readonly comments?: (event: Extract<UniversalEvent, { type: "comment.created" }>, signal: AbortSignal) => Promise<void>) {}
  async process(event: UniversalEvent, signal: AbortSignal) {
    if (signal.aborted) throw Object.assign(new Error("Cancelled"), { code: "CANCELLED" });
    if (event.type === "comment.created") { if (!this.comments) throw Object.assign(new Error("Comment processor unavailable"), { code: "COMMENT_PROCESSOR_UNAVAILABLE" }); await this.comments(event, signal); await this.store.eventState(event.businessId, event.id, "PROCESSED"); return; }
    if (event.type === "reaction.created") { await this.store.eventState(event.businessId, event.id, "IGNORED", "POLICY_DEFERRED"); return; }
    if (event.type === "message.delivered" || event.type === "message.read") {
      await this.store.db.update(dbs.messages).set({ lifecycle: sql`${dbs.messages.lifecycle} || ${JSON.stringify({ [event.type]: event.payload.at })}::jsonb`, updatedAt: new Date() }).where(and(eq(dbs.messages.businessId, event.businessId), eq(dbs.messages.connectionId, event.connectionId), eq(dbs.messages.externalMessageId, event.payload.externalMessageId)));
      await this.store.eventState(event.businessId, event.id, "PROCESSED"); return;
    }
    if (event.type === "attachment.received") {
      if (!this.attachment) throw Object.assign(new Error("Attachment worker unavailable"), { code: "ATTACHMENT_ERROR" });
      await this.attachment(event, signal); await this.store.eventState(event.businessId, event.id, "PROCESSED"); return;
    }
    if (["inventory.updated", "order.created", "order.updated", "scheduled.triggered", "handoff.resolved", "custom.triggered"].includes(event.type)) {
      await this.store.activateGoals(event); await this.store.eventState(event.businessId, event.id, "PROCESSED"); return;
    }
    await this.store.eventState(event.businessId, event.id, "IGNORED", "NO_PROCESSOR");
  }
  async processBrowser(businessId: string, browserRunId: string, signal: AbortSignal) { if (!this.browser) throw Object.assign(new Error("Browser worker unavailable"), { code: "BROWSER_ERROR" }); await this.browser(businessId, browserRunId, signal); }
}

export class Phase5Processor {
  constructor(private readonly deps: { store: Phase5Store; runtime: AgentRuntime; registry: ChannelRegistry; presence: PresenceController; realtime?: RealtimeBus; capabilities?: (businessId: string, agentId: string) => Promise<string[]>; router: EventRouter }) {}
  private async context(businessId: string, conversationId: string, traceId: string, signal: AbortSignal) {
    const current = await this.deps.store.latestSequence(businessId, conversationId);
    if (!current.agentId) throw new Error("AGENT_NOT_FOUND");
    const grants = await this.deps.capabilities?.(businessId, current.agentId) ?? ["conversation.read", "handoff.request"];
    return createTrustedBusinessContext({ businessId, principal: { kind: "system", service: "phase5-worker" }, source: "internal_system", agentId: current.agentId, conversationId, ...(current.customerId ? { customerId: current.customerId } : {}), traceId, capabilityGrants: grants }, signal);
  }
  private async eligible(context: TrustedBusinessContext, channel: string) {
    const current = await this.deps.store.latestSequence(context.businessId, context.conversationId!);
    if (current.disabled || !["ACTIVE", "TRIAL"].includes(current.businessState) || current.ownership !== "AI_ACTIVE" || !current.activeVersionId) return false;
    const adapter = this.deps.registry.resolve(channel);
    return Boolean(adapter && (await adapter.health(context)).status !== "UNAVAILABLE");
  }
  private async publish(type: "batch.formed" | "batch.suppressed" | "delivery.sent" | "delivery.failed", context: TrustedBusinessContext, payload: { count?: number; status?: string }) { await this.deps.realtime?.publish({ type, businessId: context.businessId, conversationId: context.conversationId, traceId: context.traceId, payload }); }
  private async scheduleActions(result: AgentRunResult, context: TrustedBusinessContext, includedSequence: number, batchSize: number, startedAt: Date, lease: RedisConversationLease | null, urgent = false) {
    const channelActions = result.actions.filter((action): action is UniversalChannelAction => universalChannelActionSchema.safeParse(action).success);
    if (!channelActions.length) { await this.deps.presence.transition(context, result.event.channel, "SENT"); return 0; }
    await lease?.assertOwner();
    const fresh = await this.deps.store.latestSequence(context.businessId, context.conversationId!);
    if (fresh.sequence > includedSequence || fresh.ownership !== "AI_ACTIVE" || fresh.disabled || !fresh.activeVersionId) { await this.deps.presence.transition(context, result.event.channel, "SUPPRESSED"); await this.publish("batch.suppressed", context, { status: "STALE_OR_INELIGIBLE" }); return 0; }
    const policy = await this.deps.store.timingPolicyFor(context.businessId, context.agentId!, result.event.channel);
    const timing = evaluateResponseTiming({ policy, batchSize, responseChars: channelActions.reduce((count, action) => count + ("text" in action ? action.text.length : 0), 0), queueAgeMs: Math.max(0, Date.now() - startedAt.getTime()), elapsedMs: Math.max(0, Date.now() - startedAt.getTime()), urgent, transactional: false, seed: result.runId });
    for (const action of channelActions) await this.deps.store.reserveEffect({ businessId: context.businessId, conversationId: context.conversationId!, traceId: context.traceId, action, includedSequence, runAt: new Date(Date.now() + timing.delayMs) });
    return channelActions.length;
  }
  async handle(work: Awaited<ReturnType<Phase5Store["getWork"]>>, signal: AbortSignal, lease: RedisConversationLease | null) {
    const { store } = this.deps;
    if (work.kind === "EVENT") { const event = await store.getEvent(work.businessId, work.resourceId); await this.deps.router.process(event, signal); return; }
    if (work.kind === "BROWSER") { await this.deps.router.processBrowser(work.businessId, work.resourceId, signal); return; }
    if (work.kind === "ATTACHMENT") { const event = await store.getEvent(work.businessId, work.resourceId); await this.deps.router.process(event, signal); return; }
    if (work.kind === "OUTBOUND") { await this.deliver(work.businessId, work.resourceId, work.traceId, signal, lease, work.id, work.attempt, work.maxAttempts); return; }
    if (work.kind === "GOAL") { await this.runGoal(work.businessId, work.resourceId, work.traceId, signal, lease); return; }
    if (work.kind !== "CONVERSATION") throw new Error("WORK_KIND_INVALID");
    const requested = await store.getBatch(work.businessId, work.resourceId);
    const earlier = await store.db.select({ id: dbs.messageBatches.id }).from(dbs.messageBatches).where(and(eq(dbs.messageBatches.businessId, work.businessId), eq(dbs.messageBatches.conversationId, requested.conversationId), sql`${dbs.messageBatches.firstSequence} < ${requested.firstSequence}`, sql`${dbs.messageBatches.state} IN ('BUFFERING','PROCESSING')`)).limit(1);
    if (earlier.length) { await store.reschedule(work.businessId, work.id, new Date(Date.now() + 250), "PRIOR_BATCH_PENDING"); return; }
    const claimed = await store.claimBatch(work.businessId, work.resourceId);
    if (!claimed) return;
    if ("deferredUntil" in claimed) { await store.reschedule(work.businessId, work.id, claimed.deferredUntil); return; }
    const batch = claimed.batch;
    const context = await this.context(work.businessId, batch.conversationId, batch.traceId, signal);
    context.includedInboundSequence = batch.upperSequence; if (lease) context.conversationLease = lease;
    context.assertConversationFresh = async () => { await lease?.assertOwner(); const latest = await store.latestSequence(work.businessId, batch.conversationId); if (latest.sequence !== batch.upperSequence || latest.ownership !== "AI_ACTIVE" || latest.disabled || !latest.activeVersionId) throw Object.assign(new Error("Conversation changed during order work"), { code: "STALE_CONVERSATION" }); };
    if (!await this.eligible(context, batch.channel)) { await store.completeBatch(work.businessId, batch.id, null, "SUPPRESSED", "AUTOMATION_INELIGIBLE"); return; }
    const priorEffects = await store.db.select({ id: dbs.effectIntents.id }).from(dbs.effectIntents).where(and(eq(dbs.effectIntents.businessId, work.businessId), eq(dbs.effectIntents.conversationId, batch.conversationId), sql`${dbs.effectIntents.state} IN ('RESERVED','EXECUTING')`, sql`${dbs.effectIntents.includedSequence} < ${batch.firstSequence}`)).limit(1);
    if (priorEffects.length) { await store.db.update(dbs.messageBatches).set({ state: "BUFFERING", startedAt: null }).where(eq(dbs.messageBatches.id, batch.id)); await store.reschedule(work.businessId, work.id, new Date(Date.now() + 250), "PRIOR_DELIVERY_PENDING"); return; }
    const messages = await store.db.select().from(dbs.messages).where(and(eq(dbs.messages.businessId, work.businessId), inArray(dbs.messages.id, batch.messageIds))).orderBy(dbs.messages.inboundSequence);
    const events = await Promise.all(batch.eventIds.map((id) => store.getEvent(work.businessId, id)));
    const last = events.at(-1);
    if (!last || last.type !== "message.received" || messages.length !== batch.messageIds.length) throw new Error("BATCH_MESSAGES_MISSING");
    const attachmentIds = [...new Set(events.flatMap((event) => event.type === "message.received" ? event.payload.attachmentIds : []))];
    if (attachmentIds.length) {
      const ready = await store.db.select({ id: dbs.attachments.id, status: dbs.attachments.status }).from(dbs.attachments).where(and(eq(dbs.attachments.businessId, work.businessId), inArray(dbs.attachments.id, attachmentIds)));
      const policy = await store.timingPolicyFor(work.businessId, context.agentId!, batch.channel);
      if (ready.filter((item) => item.status === "READY" || item.status === "FAILED").length < attachmentIds.length && Date.now() < batch.firstAt.getTime() + policy.attachmentWaitMs) {
        await store.db.update(dbs.messageBatches).set({ state: "BUFFERING", startedAt: null, dueAt: new Date(Date.now() + 250) }).where(eq(dbs.messageBatches.id, batch.id));
        await store.reschedule(work.businessId, work.id, new Date(Date.now() + 250), "ATTACHMENT_PENDING"); return;
      }
    }
    const runtimeEvent = toRuntimeEvent({ ...last, payload: { ...last.payload, text: messages.map((message) => message.text ?? "[attachment]").join("\n"), messageId: batch.messageIds.at(-1)!, attachmentIds } }, batch.upperSequence);
    await this.publish("batch.formed", context, { count: messages.length });
    const result = await this.deps.runtime.run({ context, event: runtimeEvent, agentId: context.agentId!, deliveryManaged: true });
    if (result.status !== "COMPLETED") { if (result.safeError?.retryable) { await store.db.update(dbs.messageBatches).set({ state: "BUFFERING", runId: result.runId, dueAt: new Date(), updatedAt: new Date() }).where(eq(dbs.messageBatches.id, batch.id)); throw Object.assign(new Error("Retryable run failure"), { code: result.safeError.code }); } await store.completeBatch(work.businessId, batch.id, result.runId, result.status === "CANCELLED" ? "CANCELLED" : "FAILED", result.safeError?.code); return; }
    const count = await this.scheduleActions(result, context, batch.upperSequence, messages.length, batch.firstAt, lease, work.priority === 1);
    await store.completeBatch(work.businessId, batch.id, result.runId, count ? "COMPLETED" : "SUPPRESSED", count ? undefined : "NO_FRESH_DELIVERY");
    for (const eventId of batch.eventIds) await store.eventState(work.businessId, eventId, "PROCESSED");
  }
  private async deliver(businessId: string, effectId: string, traceId: string, signal: AbortSignal, lease: RedisConversationLease | null, workId: string, attempt: number, maxAttempts: number) {
    const effect = await this.deps.store.getEffect(businessId, effectId);
    if (!effect.conversationId || ["COMPLETED", "CANCELLED", "FAILED", "UNKNOWN"].includes(effect.state)) return;
    const context = await this.context(businessId, effect.conversationId, traceId, signal);
    const adapter = this.deps.registry.resolve((await this.deps.store.latestSequence(businessId, effect.conversationId)).channel);
    if (!adapter || !await this.eligible(context, adapter.channel)) { await this.deps.store.effectState(businessId, effectId, "CANCELLED", "AUTOMATION_INELIGIBLE"); await this.deps.presence.transition(context, adapter?.channel ?? "", "DISCONNECTED"); return; }
    await lease?.assertOwner();
    const fresh = await this.deps.store.latestSequence(businessId, effect.conversationId);
    if (fresh.sequence > effect.includedSequence && !effect.relatedOrderId) { await this.deps.store.effectState(businessId, effectId, "CANCELLED", "STALE_RESPONSE"); await this.deps.presence.transition(context, adapter.channel, "SUPPRESSED"); await this.publish("batch.suppressed", context, { status: "STALE_RESPONSE" }); return; }
    if (effect.state === "EXECUTING") {
      const reconciled = await adapter.reconcile?.(context, effect.action);
      if (reconciled?.status === "EXECUTED") { await this.deps.store.effectState(businessId, effectId, "COMPLETED", undefined, reconciled.externalId); return; }
      if (reconciled?.status !== "NOT_FOUND") { await this.deps.store.effectState(businessId, effectId, "UNKNOWN", "RECONCILIATION_REQUIRED"); await this.deps.presence.transition(context, adapter.channel, "FAILED"); return; }
      await this.deps.store.db.update(dbs.effectIntents).set({ state: "RESERVED" }).where(and(eq(dbs.effectIntents.businessId, businessId), eq(dbs.effectIntents.id, effectId)));
    }
    if (!await this.deps.store.claimEffect(businessId, effectId)) return;
    await this.deps.presence.transition(context, adapter.channel, "SENDING");
    try {
      if (signal.aborted) throw Object.assign(new Error("Cancelled"), { code: "CANCELLED" });
      await lease?.assertOwner();
      const sent = await adapter.execute(context, effect.action);
      if (sent.status === "EXECUTED") { await this.deps.store.effectState(businessId, effectId, "COMPLETED", undefined, sent.externalId); if (effect.relatedOrderId) await this.deps.store.db.update(dbs.orders).set({ notificationState: "SENT" }).where(and(eq(dbs.orders.id, effect.relatedOrderId), eq(dbs.orders.businessId, businessId))); await this.deps.presence.transition(context, adapter.channel, "SENT"); await this.publish("delivery.sent", context, { status: "SENT" }); }
      else { await this.deps.store.effectState(businessId, effectId, "FAILED", sent.safeReason ?? "CHANNEL_SKIPPED"); if (effect.relatedOrderId) await this.deps.store.db.update(dbs.orders).set({ notificationState: "FAILED" }).where(and(eq(dbs.orders.id, effect.relatedOrderId), eq(dbs.orders.businessId, businessId))); await this.deps.presence.transition(context, adapter.channel, "FAILED"); await this.publish("delivery.failed", context, { status: "FAILED" }); }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "CHANNEL_RATE_LIMIT" && attempt < maxAttempts) {
        await this.deps.store.db.update(dbs.effectIntents).set({ state: "RESERVED", safeCode: "CHANNEL_RATE_LIMIT", updatedAt: new Date() }).where(and(eq(dbs.effectIntents.id, effectId), eq(dbs.effectIntents.businessId, businessId)));
        const retryAfterMs = "retryAfterMs" in error && typeof error.retryAfterMs === "number" ? error.retryAfterMs : 1000;
        await this.deps.store.reschedule(businessId, workId, new Date(Date.now() + Math.min(120_000, Math.max(1000, retryAfterMs))), "CHANNEL_RATE_LIMIT");
        await this.deps.presence.transition(context, adapter.channel, "FAILED");
        return;
      }
      await this.deps.store.effectState(businessId, effectId, error instanceof Error && "code" in error && error.code === "CHANNEL_RATE_LIMIT" ? "FAILED" : "UNKNOWN", error instanceof Error && "code" in error && error.code === "CHANNEL_RATE_LIMIT" ? "CHANNEL_RATE_LIMIT" : "EXTERNAL_OUTCOME_UNKNOWN"); await this.deps.presence.transition(context, adapter.channel, "FAILED"); await this.publish("delivery.failed", context, { status: "UNKNOWN" });
    }
  }
  async reconcileUnknownEffect(businessId: string, effectId: string) {
    const effect = await this.deps.store.getEffect(businessId, effectId);
    if (!effect.conversationId || !["UNKNOWN", "EXECUTING"].includes(effect.state)) throw new Error("EFFECT_NOT_RECONCILABLE");
    const context = await this.context(businessId, effect.conversationId, effect.traceId, new AbortController().signal);
    const channel = (await this.deps.store.latestSequence(businessId, effect.conversationId)).channel;
    const result = await this.deps.registry.resolve(channel)?.reconcile?.(context, effect.action);
    if (result?.status === "EXECUTED") { await this.deps.store.effectState(businessId, effectId, "COMPLETED", "RECONCILED", result.externalId); if (effect.relatedOrderId) await this.deps.store.db.update(dbs.orders).set({ notificationState: "SENT" }).where(and(eq(dbs.orders.id, effect.relatedOrderId), eq(dbs.orders.businessId, businessId))); return "COMPLETED" as const; }
    if (result?.status === "NOT_FOUND") { await this.deps.store.effectState(businessId, effectId, "FAILED", "CONFIRMED_NOT_SENT"); if (effect.relatedOrderId) await this.deps.store.db.update(dbs.orders).set({ notificationState: "FAILED" }).where(and(eq(dbs.orders.id, effect.relatedOrderId), eq(dbs.orders.businessId, businessId))); return "FAILED" as const; }
    return "UNKNOWN" as const;
  }
  private async runGoal(businessId: string, executionId: string, traceId: string, signal: AbortSignal, lease: RedisConversationLease | null) {
    const row = (await this.deps.store.db.select({ execution: dbs.goalExecutions, goal: dbs.pendingGoals }).from(dbs.goalExecutions).innerJoin(dbs.pendingGoals, eq(dbs.pendingGoals.id, dbs.goalExecutions.goalId)).where(and(eq(dbs.goalExecutions.id, executionId), eq(dbs.goalExecutions.businessId, businessId), eq(dbs.pendingGoals.businessId, businessId))).limit(1))[0];
    if (!row || row.execution.state === "COMPLETED") return;
    const context = await this.context(businessId, row.goal.conversationId, traceId, signal);
    const includedSequence = (await this.deps.store.latestSequence(businessId, row.goal.conversationId)).sequence;
    context.includedInboundSequence = includedSequence; if (lease) context.conversationLease = lease;
    context.assertConversationFresh = async () => { await lease?.assertOwner(); const latest = await this.deps.store.latestSequence(businessId, row.goal.conversationId); if (latest.sequence !== includedSequence || latest.ownership !== "AI_ACTIVE" || latest.disabled || !latest.activeVersionId) throw Object.assign(new Error("Conversation changed during goal work"), { code: "STALE_CONVERSATION" }); };
    if (!await this.eligible(context, (await this.deps.store.latestSequence(businessId, row.goal.conversationId)).channel) || row.goal.state !== "PENDING") { await this.deps.store.db.update(dbs.goalExecutions).set({ state: "CANCELLED", resultCode: "AUTOMATION_INELIGIBLE" }).where(eq(dbs.goalExecutions.id, executionId)); return; }
    const event = universalEventSchema.parse({ id: ulid(), schemaVersion: "1.0", type: "scheduled.triggered", businessId, channel: (await this.deps.store.latestSequence(businessId, row.goal.conversationId)).channel, connectionId: ulid(), conversationId: row.goal.conversationId, customerId: row.goal.customerId ?? undefined, dedupeKey: `goal:${row.goal.id}`, occurredAt: new Date().toISOString(), receivedAt: new Date().toISOString(), traceId, rawEventId: ulid(), source: { kind: "system" }, payload: { goalId: row.goal.id } });
    const result = await this.deps.runtime.run({ context, event: toRuntimeEvent(event, (await this.deps.store.latestSequence(businessId, row.goal.conversationId)).sequence), agentId: context.agentId!, deliveryManaged: true });
    if (result.status !== "COMPLETED") throw Object.assign(new Error("Goal run failed"), { code: result.safeError?.code ?? "MODEL_ERROR" });
    await this.scheduleActions(result, context, (await this.deps.store.latestSequence(businessId, row.goal.conversationId)).sequence, 1, new Date(), lease);
    await this.deps.store.db.transaction(async (tx) => { await tx.update(dbs.goalExecutions).set({ state: "COMPLETED", resultCode: "RUN_COMPLETED", firedAt: new Date() }).where(eq(dbs.goalExecutions.id, executionId)); await tx.update(dbs.pendingGoals).set({ state: "RESOLVED", updatedAt: new Date() }).where(and(eq(dbs.pendingGoals.id, row.goal.id), eq(dbs.pendingGoals.businessId, businessId))); });
  }
}
