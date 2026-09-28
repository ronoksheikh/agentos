import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ulid } from "ulid";
import { z } from "zod";
import * as dbs from "@agentos/database";
import { PostgresFeatureFlags } from "@agentos/feature-flags";
import type { TrustedBusinessContext } from "@agentos/shared";

const policyUpdateSchema = z.object({ enabled: z.boolean(), autoReply: z.boolean(), autoHide: z.boolean(), allowDelete: z.boolean().default(false), minimumConfidence: z.number().min(0.8).max(1), featureEnabled: z.boolean() });
export type CommentPolicyUpdate = z.infer<typeof policyUpdateSchema>;

/** Agency policy is separate from observed Meta capabilities; saving it never verifies a Page. */
export class PostgresCommentPolicyService {
  constructor(private readonly db: NodePgDatabase) {}
  private authorize(context: TrustedBusinessContext) {
    if (context.principal.kind !== "user" || !context.capabilityGrants.includes("channel.manage")) throw new Error("FORBIDDEN");
    return context.principal.userId;
  }
  async get(context: TrustedBusinessContext, connectionId: string) {
    this.authorize(context);
    const connection = (await this.db.select({ id: dbs.channelConnections.id }).from(dbs.channelConnections).where(and(eq(dbs.channelConnections.id, connectionId), eq(dbs.channelConnections.businessId, context.businessId), eq(dbs.channelConnections.channel, "facebook_messenger"))).limit(1))[0];
    if (!connection) throw new Error("PAGE_CONNECTION_NOT_FOUND");
    const [policy, flag] = await Promise.all([
      this.db.select().from(dbs.commentPolicies).where(and(eq(dbs.commentPolicies.businessId, context.businessId), eq(dbs.commentPolicies.connectionId, connectionId))).limit(1),
      new PostgresFeatureFlags(this.db).effective(context.businessId, "comment_ai"),
    ]);
    return { enabled: policy[0]?.enabled ?? false, autoReply: policy[0]?.autoReply ?? false, autoHide: policy[0]?.autoHide ?? false, minimumConfidence: policy[0]?.minimumConfidence ?? 0.85, allowDelete: policy[0]?.allowDelete ?? false, version: policy[0]?.version ?? 0, featureEnabled: flag };
  }
  async update(context: TrustedBusinessContext, connectionId: string, untrusted: CommentPolicyUpdate) {
    const userId = this.authorize(context); const input = policyUpdateSchema.parse(untrusted);
    await this.db.transaction(async (tx) => {
      const connection = (await tx.select({ id: dbs.channelConnections.id }).from(dbs.channelConnections).where(and(eq(dbs.channelConnections.id, connectionId), eq(dbs.channelConnections.businessId, context.businessId), eq(dbs.channelConnections.channel, "facebook_messenger"))).limit(1))[0];
      if (!connection) throw new Error("PAGE_CONNECTION_NOT_FOUND");
      if (input.allowDelete) {
        const row = (await tx.select({ capabilities: dbs.channelConnections.capabilities }).from(dbs.channelConnections).where(and(eq(dbs.channelConnections.id, connectionId), eq(dbs.channelConnections.businessId, context.businessId))).limit(1))[0];
        const capabilities = row?.capabilities && typeof row.capabilities === "object" && !Array.isArray(row.capabilities) ? row.capabilities as Record<string, unknown> : {};
        if (capabilities.commentDeleteVerified !== true) throw new Error("COMMENT_DELETE_CAPABILITY_UNVERIFIED");
      }
      await tx.insert(dbs.commentPolicies).values({ id: ulid(), businessId: context.businessId, connectionId, enabled: input.enabled, autoReply: input.autoReply, autoHide: input.autoHide, allowDelete: input.allowDelete, minimumConfidence: input.minimumConfidence, updatedBy: userId }).onConflictDoUpdate({ target: [dbs.commentPolicies.businessId, dbs.commentPolicies.connectionId], set: { enabled: input.enabled, autoReply: input.autoReply, autoHide: input.autoHide, allowDelete: input.allowDelete, minimumConfidence: input.minimumConfidence, version: sql`${dbs.commentPolicies.version} + 1`, updatedBy: userId, updatedAt: new Date() } });
      await tx.insert(dbs.featureFlags).values({ id: ulid(), businessId: context.businessId, key: "comment_ai", enabled: input.featureEnabled, updatedBy: userId }).onConflictDoUpdate({ target: [dbs.featureFlags.businessId, dbs.featureFlags.key], set: { enabled: input.featureEnabled, revision: sql`${dbs.featureFlags.revision} + 1`, updatedBy: userId, updatedAt: new Date() } });
      await tx.insert(dbs.auditLogs).values({ id: ulid(), businessId: context.businessId, actorId: userId, action: "comment.policy.updated", targetType: "channel_connection", targetId: connectionId, safeMetadata: { enabled: input.enabled, autoReply: input.autoReply, autoHide: input.autoHide, minimumConfidence: input.minimumConfidence, featureEnabled: input.featureEnabled, allowDelete: input.allowDelete } });
    });
    return this.get(context, connectionId);
  }
}
