import { and, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ulid } from "ulid";
import { z } from "zod";
import * as dbs from "@agentos/database";

export const featureFlagKeySchema = z.enum(["browser", "comment_ai", "advanced_memory", "experimental_tools", "runtime_variant"]);
export type FeatureFlagKey = z.infer<typeof featureFlagKeySchema>;
const defaults: Record<FeatureFlagKey, boolean> = { browser: true, comment_ai: false, advanced_memory: false, experimental_tools: false, runtime_variant: false };
type Actor = { userId: string; grants: readonly string[] };

/** Tenant overrides take precedence over one global row; missing flags use explicit defaults. */
export class PostgresFeatureFlags {
  constructor(private readonly db: NodePgDatabase) {}
  async effective(businessId: string, key: FeatureFlagKey) {
    featureFlagKeySchema.parse(key);
    const [tenant, global] = await Promise.all([
      this.db.select({ enabled: dbs.featureFlags.enabled }).from(dbs.featureFlags).where(and(eq(dbs.featureFlags.businessId, businessId), eq(dbs.featureFlags.key, key))).limit(1),
      this.db.select({ enabled: dbs.featureFlags.enabled }).from(dbs.featureFlags).where(and(isNull(dbs.featureFlags.businessId), eq(dbs.featureFlags.key, key))).limit(1),
    ]);
    return tenant[0]?.enabled ?? global[0]?.enabled ?? defaults[key];
  }
  async list(actor: Actor, businessId?: string) {
    if (!actor.grants.includes("feature_flag.manage")) throw new Error("FORBIDDEN");
    const rows = await this.db.select({ businessId: dbs.featureFlags.businessId, key: dbs.featureFlags.key, enabled: dbs.featureFlags.enabled, revision: dbs.featureFlags.revision }).from(dbs.featureFlags).where(businessId ? sql`${dbs.featureFlags.businessId} = ${businessId} or ${dbs.featureFlags.businessId} is null` : isNull(dbs.featureFlags.businessId));
    return featureFlagKeySchema.options.map((key) => { const tenant = rows.find((row) => row.key === key && row.businessId === businessId); const global = rows.find((row) => row.key === key && row.businessId === null); return { key, defaultEnabled: defaults[key], global: global ? { enabled: global.enabled, revision: global.revision } : null, tenant: tenant ? { enabled: tenant.enabled, revision: tenant.revision } : null, effective: tenant?.enabled ?? global?.enabled ?? defaults[key] }; });
  }
  async set(actor: Actor, input: { businessId?: string; key: FeatureFlagKey; enabled: boolean; expectedRevision: number }) {
    if (!actor.grants.includes("feature_flag.manage")) throw new Error("FORBIDDEN");
    const key = featureFlagKeySchema.parse(input.key);
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error("FEATURE_FLAG_REVISION_INVALID");
    return this.db.transaction(async (tx) => {
      if (input.businessId) { const business = (await tx.select({ id: dbs.businesses.id }).from(dbs.businesses).where(eq(dbs.businesses.id, input.businessId)).limit(1))[0]; if (!business) throw new Error("BUSINESS_NOT_FOUND"); }
      const scope = input.businessId ? eq(dbs.featureFlags.businessId, input.businessId) : isNull(dbs.featureFlags.businessId);
      const current = (await tx.select({ id: dbs.featureFlags.id, revision: dbs.featureFlags.revision }).from(dbs.featureFlags).where(and(scope, eq(dbs.featureFlags.key, key))).limit(1).for("update"))[0];
      if ((current?.revision ?? 0) !== input.expectedRevision) throw new Error("CONCURRENT_EDIT");
      const revision = input.expectedRevision + 1;
      if (current) await tx.update(dbs.featureFlags).set({ enabled: input.enabled, revision, updatedBy: actor.userId, updatedAt: new Date() }).where(eq(dbs.featureFlags.id, current.id));
      else await tx.insert(dbs.featureFlags).values({ id: ulid(), businessId: input.businessId ?? null, key, enabled: input.enabled, revision, updatedBy: actor.userId });
      await tx.insert(dbs.auditLogs).values({ id: ulid(), businessId: input.businessId ?? null, actorId: actor.userId, action: "feature_flag.changed", targetType: "feature_flag", targetId: `${input.businessId ?? "global"}:${key}`, safeMetadata: { enabled: input.enabled, revision } });
      return { key, businessId: input.businessId ?? null, enabled: input.enabled, revision };
    });
  }
  async clearTenant(actor: Actor, businessId: string, keyInput: FeatureFlagKey, expectedRevision: number) {
    if (!actor.grants.includes("feature_flag.manage")) throw new Error("FORBIDDEN");
    const key = featureFlagKeySchema.parse(keyInput);
    return this.db.transaction(async (tx) => {
      const row = (await tx.select({ id: dbs.featureFlags.id, revision: dbs.featureFlags.revision }).from(dbs.featureFlags).where(and(eq(dbs.featureFlags.businessId, businessId), eq(dbs.featureFlags.key, key))).limit(1).for("update"))[0];
      if (!row || row.revision !== expectedRevision) throw new Error("CONCURRENT_EDIT");
      await tx.delete(dbs.featureFlags).where(eq(dbs.featureFlags.id, row.id));
      await tx.insert(dbs.auditLogs).values({ id: ulid(), businessId, actorId: actor.userId, action: "feature_flag.inherited", targetType: "feature_flag", targetId: `${businessId}:${key}`, safeMetadata: { previousRevision: row.revision } });
    });
  }
}

export async function runtimeCapabilityGrants(flags: PostgresFeatureFlags, businessId: string, browserAvailable: boolean) {
  return ["conversation.read", "handoff.request", ...(browserAvailable && await flags.effective(businessId, "browser") ? ["browser.use"] : [])];
}
