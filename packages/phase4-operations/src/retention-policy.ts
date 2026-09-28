import { and, eq, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ulid } from "ulid";
import { z } from "zod";
import * as db from "@agentos/database";

const dayRule = z.number().int().min(1).max(3_650).nullable();
export const businessRetentionPolicySchema = z.object({
  businessId: z.string().min(1), enabled: z.boolean(), revision: z.number().int().positive(),
  messagesDays: dayRule, eventPayloadDays: dayRule, traceDetailsDays: dayRule,
  realtimePayloadDays: dayRule, browserHistoryDays: dayRule, commentTextDays: dayRule,
});
export type BusinessRetentionPolicy = z.infer<typeof businessRetentionPolicySchema>;
type RetentionActor = { userId: string; grants: readonly string[]; allowedBusinessIds?: ReadonlySet<string> };
const ruleFields = ["messagesDays", "eventPayloadDays", "traceDetailsDays", "realtimePayloadDays", "browserHistoryDays", "commentTextDays"] as const;

export class PostgresBusinessRetentionPolicies {
  constructor(private readonly database: NodePgDatabase) {}
  private require(actor: RetentionActor, businessId?: string) {
    if (!actor.grants.includes("retention.manage")) throw new Error("FORBIDDEN");
    if (businessId && actor.allowedBusinessIds && !actor.allowedBusinessIds.has(businessId) && !actor.grants.includes("business.manage")) throw new Error("FORBIDDEN");
  }
  async get(actor: RetentionActor, businessId: string) {
    this.require(actor, businessId);
    const row = (await this.database.select().from(db.businessRetentionPolicies).where(eq(db.businessRetentionPolicies.businessId, businessId)).limit(1))[0];
    return row ? businessRetentionPolicySchema.parse(row) : { businessId, enabled: false, revision: 0, messagesDays: null, eventPayloadDays: null, traceDetailsDays: null, realtimePayloadDays: null, browserHistoryDays: null, commentTextDays: null };
  }
  async set(actor: RetentionActor, input: Omit<BusinessRetentionPolicy, "revision"> & { expectedRevision: number; confirmScrub?: string }) {
    this.require(actor, input.businessId);
    if (input.enabled && input.confirmScrub !== "ENABLE CONTENT SCRUBBING") throw new Error("RETENTION_CONFIRMATION_REQUIRED");
    const rules = Object.fromEntries(ruleFields.map((field) => [field, dayRule.parse(input[field] ?? null)])) as Pick<BusinessRetentionPolicy, typeof ruleFields[number]>;
    if (input.enabled && !Object.values(rules).some((days) => days !== null)) throw new Error("RETENTION_RULE_REQUIRED");
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error("RETENTION_REVISION_INVALID");
    return this.database.transaction(async (tx) => {
      const business = (await tx.select({ id: db.businesses.id }).from(db.businesses).where(eq(db.businesses.id, input.businessId)).limit(1).for("update"))[0];
      if (!business) throw new Error("BUSINESS_NOT_FOUND");
      const current = (await tx.select({ revision: db.businessRetentionPolicies.revision }).from(db.businessRetentionPolicies).where(eq(db.businessRetentionPolicies.businessId, input.businessId)).limit(1).for("update"))[0];
      if ((current?.revision ?? 0) !== input.expectedRevision) throw new Error("CONCURRENT_EDIT");
      const revision = input.expectedRevision + 1;
      if (current) await tx.update(db.businessRetentionPolicies).set({ enabled: input.enabled, ...rules, revision, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(db.businessRetentionPolicies.businessId, input.businessId));
      else await tx.insert(db.businessRetentionPolicies).values({ businessId: input.businessId, enabled: input.enabled, ...rules, revision, updatedBy: actor.userId });
      await tx.insert(db.auditLogs).values({ id: ulid(), businessId: input.businessId, actorId: actor.userId, action: "business.retention_policy.changed", targetType: "business_retention_policy", targetId: input.businessId, safeMetadata: { enabled: input.enabled, revision, rules } });
      return businessRetentionPolicySchema.parse({ businessId: input.businessId, enabled: input.enabled, revision, ...rules });
    });
  }
}

/** Age-based content scrubbing is opt-in per business; identity, financial, and audit records stay intact. */
export class PostgresBusinessContentRetention {
  constructor(private readonly database: NodePgDatabase) {}
  async sweep(now = new Date(), limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("RETENTION_LIMIT_INVALID");
    const policies = await this.database.select().from(db.businessRetentionPolicies).where(eq(db.businessRetentionPolicies.enabled, true));
    let batches = 0;
    for (const policy of policies) {
      const categories = [
        ["messages", policy.messagesDays], ["eventPayloads", policy.eventPayloadDays], ["traceDetails", policy.traceDetailsDays],
        ["realtimePayloads", policy.realtimePayloadDays], ["browserHistory", policy.browserHistoryDays], ["commentText", policy.commentTextDays],
      ] as const;
      for (const [category, days] of categories) {
        if (days === null) continue;
        const cutoff = new Date(now.getTime() - days * 86_400_000);
        let count = 0;
        if (category === "messages") {
          const ids = await this.database.select({ id: db.messages.id }).from(db.messages).where(and(eq(db.messages.businessId, policy.businessId), lte(db.messages.occurredAt, cutoff), isNotNull(db.messages.text))).orderBy(db.messages.occurredAt).limit(limit);
          if (ids.length) count = (await this.database.update(db.messages).set({ text: null, lifecycle: { retentionRedacted: true }, updatedAt: now }).where(and(eq(db.messages.businessId, policy.businessId), inArray(db.messages.id, ids.map((row) => row.id)), isNotNull(db.messages.text))).returning({ id: db.messages.id })).length;
        } else if (category === "eventPayloads") {
          const ids = await this.database.select({ id: db.universalEvents.id }).from(db.universalEvents).where(and(eq(db.universalEvents.businessId, policy.businessId), lte(db.universalEvents.receivedAt, cutoff), isNotNull(db.universalEvents.processedAt), sql`${db.universalEvents.payload}->>'retentionRedacted' is distinct from 'true'`)).orderBy(db.universalEvents.receivedAt).limit(limit);
          if (ids.length) count = (await this.database.update(db.universalEvents).set({ payload: { retentionRedacted: true }, source: { kind: "retention_redacted" }, updatedAt: now }).where(and(eq(db.universalEvents.businessId, policy.businessId), inArray(db.universalEvents.id, ids.map((row) => row.id)), sql`${db.universalEvents.payload}->>'retentionRedacted' is distinct from 'true'`)).returning({ id: db.universalEvents.id })).length;
        } else if (category === "traceDetails") {
          const runs = await this.database.select({ id: db.agentRuns.id }).from(db.agentRuns).where(and(eq(db.agentRuns.businessId, policy.businessId), lte(db.agentRuns.completedAt, cutoff), isNotNull(db.agentRuns.completedAt), ne(db.agentRuns.status, "RUNNING"), sql`(exists (select 1 from agent_steps s where s.business_id=${policy.businessId} and s.run_id=${db.agentRuns.id} and s.safe_facts->>'retentionRedacted' is distinct from 'true') or exists (select 1 from tool_calls t where t.business_id=${policy.businessId} and t.run_id=${db.agentRuns.id} and t.safe_input->>'retentionRedacted' is distinct from 'true') or exists (select 1 from actions a where a.business_id=${policy.businessId} and a.run_id=${db.agentRuns.id} and a.payload->>'retentionRedacted' is distinct from 'true') or ${db.agentRuns.safeError} is not null)`)).orderBy(db.agentRuns.completedAt).limit(limit);
          const runIds = runs.map((row) => row.id);
          if (runIds.length) {
            const [steps, tools, actions] = await Promise.all([
              this.database.update(db.agentSteps).set({ safeFacts: { retentionRedacted: true } }).where(and(eq(db.agentSteps.businessId, policy.businessId), inArray(db.agentSteps.runId, runIds), sql`${db.agentSteps.safeFacts}->>'retentionRedacted' is distinct from 'true'`)).returning({ id: db.agentSteps.id }),
              this.database.update(db.toolCalls).set({ safeInput: { retentionRedacted: true }, safeOutput: null, safeError: null }).where(and(eq(db.toolCalls.businessId, policy.businessId), inArray(db.toolCalls.runId, runIds), sql`${db.toolCalls.safeInput}->>'retentionRedacted' is distinct from 'true'`)).returning({ id: db.toolCalls.id }),
              this.database.update(db.actions).set({ payload: { retentionRedacted: true } }).where(and(eq(db.actions.businessId, policy.businessId), inArray(db.actions.runId, runIds), sql`${db.actions.payload}->>'retentionRedacted' is distinct from 'true'`)).returning({ id: db.actions.id }),
            ]);
            const errors = await this.database.update(db.agentRuns).set({ safeError: null }).where(and(eq(db.agentRuns.businessId, policy.businessId), inArray(db.agentRuns.id, runIds), isNotNull(db.agentRuns.safeError))).returning({ id: db.agentRuns.id });
            count = steps.length + tools.length + actions.length + errors.length;
          }
        } else if (category === "realtimePayloads") {
          const realtime = await this.database.select({ id: db.realtimeEvents.id }).from(db.realtimeEvents).where(and(eq(db.realtimeEvents.businessId, policy.businessId), lte(db.realtimeEvents.occurredAt, cutoff), sql`${db.realtimeEvents.safePayload}->>'retentionRedacted' is distinct from 'true'`)).orderBy(db.realtimeEvents.occurredAt).limit(limit);
          const projected = await this.database.select({ id: db.clientProjectionEvents.id }).from(db.clientProjectionEvents).where(and(eq(db.clientProjectionEvents.businessId, policy.businessId), lte(db.clientProjectionEvents.occurredAt, cutoff), sql`${db.clientProjectionEvents.safePayload}->>'retentionRedacted' is distinct from 'true'`)).orderBy(db.clientProjectionEvents.occurredAt).limit(limit);
          const [a, b] = await Promise.all([
            realtime.length ? this.database.update(db.realtimeEvents).set({ safePayload: { retentionRedacted: true } }).where(and(eq(db.realtimeEvents.businessId, policy.businessId), inArray(db.realtimeEvents.id, realtime.map((row) => row.id)), sql`${db.realtimeEvents.safePayload}->>'retentionRedacted' is distinct from 'true'`)).returning({ id: db.realtimeEvents.id }) : Promise.resolve([]),
            projected.length ? this.database.update(db.clientProjectionEvents).set({ safePayload: { retentionRedacted: true } }).where(and(eq(db.clientProjectionEvents.businessId, policy.businessId), inArray(db.clientProjectionEvents.id, projected.map((row) => row.id)), sql`${db.clientProjectionEvents.safePayload}->>'retentionRedacted' is distinct from 'true'`)).returning({ id: db.clientProjectionEvents.id }) : Promise.resolve([]),
          ]);
          count = a.length + b.length;
        } else if (category === "browserHistory") {
          const ids = await this.database.select({ id: db.browserRuns.id }).from(db.browserRuns).where(and(eq(db.browserRuns.businessId, policy.businessId), lte(db.browserRuns.occurredAt, cutoff), isNotNull(db.browserRuns.safeUrl))).orderBy(db.browserRuns.occurredAt).limit(limit);
          if (ids.length) count = (await this.database.update(db.browserRuns).set({ safeUrl: null }).where(and(eq(db.browserRuns.businessId, policy.businessId), inArray(db.browserRuns.id, ids.map((row) => row.id)), isNotNull(db.browserRuns.safeUrl))).returning({ id: db.browserRuns.id })).length;
        } else {
          const ids = await this.database.select({ id: db.facebookComments.id }).from(db.facebookComments).where(and(eq(db.facebookComments.businessId, policy.businessId), lte(db.facebookComments.createdAt, cutoff), sql`(${db.facebookComments.text} is not null or ${db.facebookComments.authorExternalId} is not null)`)).orderBy(db.facebookComments.createdAt).limit(limit);
          if (ids.length) {
            const commentIds = ids.map((row) => row.id);
            const comments = await this.database.update(db.facebookComments).set({ text: null, authorExternalId: null, updatedAt: now }).where(and(eq(db.facebookComments.businessId, policy.businessId), inArray(db.facebookComments.id, commentIds), sql`(${db.facebookComments.text} is not null or ${db.facebookComments.authorExternalId} is not null)`)).returning({ id: db.facebookComments.id });
            const decisions = comments.length ? await this.database.update(db.commentDecisions).set({ classification: { retentionRedacted: true } }).where(and(eq(db.commentDecisions.businessId, policy.businessId), inArray(db.commentDecisions.commentId, comments.map((row) => row.id)), sql`${db.commentDecisions.classification}->>'retentionRedacted' is distinct from 'true'`)).returning({ id: db.commentDecisions.id }) : [];
            count = comments.length + decisions.length;
          }
        }
        if (count) {
          await this.database.insert(db.auditLogs).values({ id: ulid(), businessId: policy.businessId, actorId: "system:retention", action: "business.content_retention_scrubbed", targetType: "business", targetId: policy.businessId, safeMetadata: { category, count, cutoff: cutoff.toISOString(), policyRevision: policy.revision } });
          batches++;
        }
      }
    }
    return { batches };
  }
}
