import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ulid } from "ulid";
import * as dbs from "@agentos/database";
import type { TrustedBusinessContext } from "@agentos/shared";

export function oneCalendarMonthFrom(start: Date) {
  const year = start.getUTCFullYear(); const month = start.getUTCMonth(); const day = start.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  return new Date(Date.UTC(year, month + 1, Math.min(day, lastDay), start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), start.getUTCMilliseconds()));
}

/** Agency-controlled offer lifecycle. Expiry never deletes business data. */
export class PostgresTrialService {
  constructor(private readonly db: NodePgDatabase, private readonly now: () => Date = () => new Date()) {}
  private authorize(context: TrustedBusinessContext, capability: "business.read" | "business.manage") {
    if (context.principal.kind !== "user" || !context.capabilityGrants.includes(capability)) throw new Error("FORBIDDEN");
    return context.principal.userId;
  }
  private async notify(tx: Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0], businessId: string, type: string, key: string, safePayload: Record<string, string>) {
    const members = await tx.select({ userId: dbs.businessMemberships.userId }).from(dbs.businessMemberships).where(eq(dbs.businessMemberships.businessId, businessId));
    for (const member of members) await tx.insert(dbs.notifications).values({ id: ulid(), businessId, userId: member.userId, type, severity: "NORMAL", dedupeKey: `trial:${key}:${member.userId}`, safePayload }).onConflictDoNothing();
  }
  async get(context: TrustedBusinessContext) {
    this.authorize(context, "business.read");
    const row = (await this.db.select({ id: dbs.businesses.id, state: dbs.businesses.state, disabled: dbs.businesses.disabled, startedAt: dbs.businesses.trialStartedAt, endsAt: dbs.businesses.trialEndsAt, expiryBehavior: dbs.businesses.trialExpiryBehavior, revision: dbs.businesses.revision }).from(dbs.businesses).where(eq(dbs.businesses.id, context.businessId)).limit(1))[0];
    if (!row) throw new Error("BUSINESS_NOT_FOUND");
    return row;
  }
  async activate(context: TrustedBusinessContext) {
    const actorId = this.authorize(context, "business.manage"); const now = this.now(); const endsAt = oneCalendarMonthFrom(now);
    await this.db.transaction(async (tx) => {
      const row = (await tx.select().from(dbs.businesses).where(eq(dbs.businesses.id, context.businessId)).limit(1).for("update"))[0];
      if (!row) throw new Error("BUSINESS_NOT_FOUND");
      if (row.trialStartedAt || row.trialEndsAt) throw new Error("TRIAL_ALREADY_STARTED");
      if (row.state === "CANCELLED" || row.disabled) throw new Error("BUSINESS_INACTIVE");
      await tx.update(dbs.businesses).set({ state: "TRIAL", trialStartedAt: now, trialEndsAt: endsAt, revision: sql`${dbs.businesses.revision} + 1`, updatedAt: now }).where(eq(dbs.businesses.id, context.businessId));
      await tx.insert(dbs.auditLogs).values({ id: ulid(), businessId: context.businessId, actorId, action: "trial.activated", targetType: "business", targetId: context.businessId, safeMetadata: { startedAt: now.toISOString(), endsAt: endsAt.toISOString(), offer: "ONE_MONTH_UNLIMITED_FREE" } });
      await this.notify(tx, context.businessId, "TRIAL_STARTED", `started:${endsAt.toISOString()}`, { endsAt: endsAt.toISOString() });
    });
    return this.get(context);
  }
  async extend(context: TrustedBusinessContext, endsAt: Date) {
    const actorId = this.authorize(context, "business.manage"); const now = this.now();
    if (!Number.isFinite(endsAt.getTime()) || endsAt <= now) throw new Error("TRIAL_END_INVALID");
    await this.db.transaction(async (tx) => {
      const row = (await tx.select().from(dbs.businesses).where(eq(dbs.businesses.id, context.businessId)).limit(1).for("update"))[0];
      if (!row?.trialStartedAt || !row.trialEndsAt || row.state === "CANCELLED" || endsAt <= row.trialEndsAt) throw new Error("TRIAL_EXTENSION_INVALID");
      await tx.update(dbs.businesses).set({ state: "TRIAL", trialEndsAt: endsAt, revision: sql`${dbs.businesses.revision} + 1`, updatedAt: now }).where(eq(dbs.businesses.id, context.businessId));
      await tx.insert(dbs.auditLogs).values({ id: ulid(), businessId: context.businessId, actorId, action: "trial.extended", targetType: "business", targetId: context.businessId, safeMetadata: { previousEndsAt: row.trialEndsAt.toISOString(), endsAt: endsAt.toISOString() } });
      await this.notify(tx, context.businessId, "TRIAL_EXTENDED", `extended:${endsAt.toISOString()}`, { endsAt: endsAt.toISOString() });
    });
    return this.get(context);
  }
  async setExpiryBehavior(context: TrustedBusinessContext, behavior: "PAUSE_AUTOMATION" | "CONTINUE_AUTOMATION") {
    const actorId = this.authorize(context, "business.manage"); if (!["PAUSE_AUTOMATION", "CONTINUE_AUTOMATION"].includes(behavior)) throw new Error("TRIAL_BEHAVIOR_INVALID");
    await this.db.transaction(async (tx) => {
      const changed = await tx.update(dbs.businesses).set({ trialExpiryBehavior: behavior, revision: sql`${dbs.businesses.revision} + 1`, updatedAt: this.now() }).where(eq(dbs.businesses.id, context.businessId)).returning({ id: dbs.businesses.id });
      if (!changed.length) throw new Error("BUSINESS_NOT_FOUND");
      await tx.insert(dbs.auditLogs).values({ id: ulid(), businessId: context.businessId, actorId, action: "trial.expiry_behavior.updated", targetType: "business", targetId: context.businessId, safeMetadata: { behavior } });
    });
    return this.get(context);
  }
  async overrideState(context: TrustedBusinessContext, state: "ACTIVE" | "PAUSED" | "CANCELLED") {
    const actorId = this.authorize(context, "business.manage"); if (!["ACTIVE", "PAUSED", "CANCELLED"].includes(state)) throw new Error("BUSINESS_STATE_INVALID"); const now = this.now();
    await this.db.transaction(async (tx) => {
      const row = (await tx.select({ state: dbs.businesses.state }).from(dbs.businesses).where(eq(dbs.businesses.id, context.businessId)).limit(1).for("update"))[0]; if (!row) throw new Error("BUSINESS_NOT_FOUND");
      await tx.update(dbs.businesses).set({ state, revision: sql`${dbs.businesses.revision} + 1`, updatedAt: now }).where(eq(dbs.businesses.id, context.businessId));
      await tx.insert(dbs.auditLogs).values({ id: ulid(), businessId: context.businessId, actorId, action: "trial.agency_override", targetType: "business", targetId: context.businessId, safeMetadata: { previous: row.state, state } });
      await this.notify(tx, context.businessId, "TRIAL_SERVICE_CHANGED", `state:${state}:${now.toISOString()}`, { state });
    });
    return this.get(context);
  }
  async expireDue(now = this.now(), limit = 100) {
    const batchSize = Math.max(1, limit);
    let afterId: string | undefined;
    while (true) {
      const approaching = await this.db.select({ id: dbs.businesses.id, endsAt: dbs.businesses.trialEndsAt }).from(dbs.businesses).where(and(eq(dbs.businesses.state, "TRIAL"), gt(dbs.businesses.trialEndsAt, now), lte(dbs.businesses.trialEndsAt, new Date(now.getTime() + 3 * 86400_000)), ...(afterId ? [gt(dbs.businesses.id, afterId)] : []))).orderBy(asc(dbs.businesses.id)).limit(batchSize);
      for (const item of approaching) if (item.endsAt) await this.db.transaction(async (tx) => {
        const current = (await tx.select({ state: dbs.businesses.state, endsAt: dbs.businesses.trialEndsAt }).from(dbs.businesses).where(eq(dbs.businesses.id, item.id)).limit(1).for("update"))[0];
        if (current?.state === "TRIAL" && current.endsAt?.getTime() === item.endsAt!.getTime()) await this.notify(tx, item.id, "TRIAL_ENDING", `ending:${item.endsAt!.toISOString()}`, { endsAt: item.endsAt!.toISOString() });
      });
      if (approaching.length < batchSize) break;
      afterId = approaching[approaching.length - 1]!.id;
    }
    const due = await this.db.select({ id: dbs.businesses.id }).from(dbs.businesses).where(and(eq(dbs.businesses.state, "TRIAL"), lte(dbs.businesses.trialEndsAt, now))).limit(limit);
    let expired = 0;
    for (const item of due) await this.db.transaction(async (tx) => {
      const row = (await tx.select({ state: dbs.businesses.state, endsAt: dbs.businesses.trialEndsAt, behavior: dbs.businesses.trialExpiryBehavior }).from(dbs.businesses).where(eq(dbs.businesses.id, item.id)).limit(1).for("update"))[0];
      if (row?.state !== "TRIAL" || !row.endsAt || row.endsAt > now) return;
      await tx.update(dbs.businesses).set({ state: "EXPIRED", revision: sql`${dbs.businesses.revision} + 1`, updatedAt: now }).where(eq(dbs.businesses.id, item.id));
      await tx.insert(dbs.auditLogs).values({ id: ulid(), businessId: item.id, actorId: "trial-sweeper", action: "trial.expired", targetType: "business", targetId: item.id, safeMetadata: { endsAt: row.endsAt.toISOString(), behavior: row.behavior } });
      await this.notify(tx, item.id, "TRIAL_EXPIRED", `expired:${row.endsAt.toISOString()}`, { behavior: row.behavior });
      expired++;
    });
    return expired;
  }
}
