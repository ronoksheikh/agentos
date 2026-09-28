import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ulid } from "ulid";
import { FacebookMessengerAdapter, FACEBOOK_MESSENGER } from "@agentos/channels";
import * as dbs from "@agentos/database";
import { universalChannelActionSchema } from "@agentos/actions";
import { createTrustedBusinessContext, redactSafe, ulidSchema, type TrustedBusinessContext } from "@agentos/shared";
import { commentClassificationSchema } from "./index";

const inputSchema = ulidSchema;

/** Audited human action path for reviewed Page comments; deletion is always an explicit manager action. */
export class PostgresManualCommentOperations {
  constructor(private readonly db: NodePgDatabase, private readonly adapter: FacebookMessengerAdapter) {}
  private actor(context: TrustedBusinessContext) {
    if (context.principal.kind !== "user" || !(context.capabilityGrants.includes("channel.manage") || context.capabilityGrants.includes("conversation.manage"))) throw new Error("FORBIDDEN");
    return context.principal.userId;
  }
  async apply(context: TrustedBusinessContext, input: { commentId: string; requestId: string; mode: "REPLY" | "HIDE" | "DELETE"; text?: string; confirmDelete?: boolean }) {
    const actorId = this.actor(context); const commentId = inputSchema.parse(input.commentId); const requestId = inputSchema.parse(input.requestId);
    if (input.mode === "DELETE" && (!context.capabilityGrants.includes("channel.manage") || input.confirmDelete !== true)) throw new Error("COMMENT_DELETE_CONFIRMATION_REQUIRED");
    const text = input.mode === "REPLY" ? (input.text ?? "").trim() : "";
    if (input.mode === "REPLY" && (!text || text.length > 2_000 || redactSafe(text) !== text)) throw new Error("COMMENT_REPLY_UNSAFE");
    if (input.mode !== "REPLY" && input.text) throw new Error("COMMENT_ACTION_INVALID");
    const hash = createHash("sha256").update(`${input.mode}\0${text}`).digest("hex"); const idempotencyKey = `manual:${actorId}:${requestId}`; const outcome = input.mode;
    const prior = (await this.db.select().from(dbs.commentDecisions).where(and(eq(dbs.commentDecisions.businessId, context.businessId), eq(dbs.commentDecisions.idempotencyKey, idempotencyKey))).limit(1))[0];
    if (prior) {
      const classification = commentClassificationSchema.safeParse(prior.classification);
      if (prior.commentId !== commentId || prior.actorId !== actorId || prior.outcome !== outcome || !classification.success || !classification.data.signals.includes(`manual:${hash}`)) throw new Error("IDEMPOTENCY_CONFLICT");
      if (prior.actionStatus === "COMPLETED") return { decisionId: prior.id, status: "COMPLETED" as const, externalId: prior.externalActionId };
      throw new Error("MANUAL_ACTION_RECONCILIATION_REQUIRED");
    }
    const row = (await this.db.select({ comment: dbs.facebookComments, connection: dbs.channelConnections, policy: dbs.commentPolicies }).from(dbs.facebookComments).innerJoin(dbs.channelConnections, eq(dbs.channelConnections.id, dbs.facebookComments.connectionId)).leftJoin(dbs.commentPolicies, and(eq(dbs.commentPolicies.businessId, dbs.facebookComments.businessId), eq(dbs.commentPolicies.connectionId, dbs.channelConnections.id))).where(and(eq(dbs.facebookComments.id, commentId), eq(dbs.facebookComments.businessId, context.businessId), eq(dbs.channelConnections.businessId, context.businessId), eq(dbs.channelConnections.channel, FACEBOOK_MESSENGER))).limit(1))[0];
    if (!row?.comment.conversationId || !row.comment.customerId) throw new Error("COMMENT_NOT_FOUND");
    if (row.connection.state !== "CONNECTED" || row.connection.paused || !row.connection.credentialRefId) throw new Error("COMMENT_CHANNEL_UNAVAILABLE");
    const caps = row.connection.capabilities && typeof row.connection.capabilities === "object" && !Array.isArray(row.connection.capabilities) ? row.connection.capabilities as Record<string, unknown> : {};
    const capabilityKey = input.mode === "REPLY" ? "commentReplyVerified" : input.mode === "HIDE" ? "commentHideVerified" : "commentDeleteVerified";
    if (!row.connection.grantedScopes.includes("pages_manage_engagement") || caps.commentReadVerified !== true || caps[capabilityKey] !== true) throw new Error("COMMENT_CAPABILITY_UNVERIFIED");
    if (input.mode === "DELETE" && row.policy?.allowDelete !== true) throw new Error("COMMENT_DELETE_POLICY_DISABLED");
    if (!row.comment.authorExternalId || row.comment.authorExternalId === row.connection.externalPageId) throw new Error("COMMENT_AUTHOR_UNVERIFIED");
    if (input.mode !== "DELETE" && (row.comment.isHidden || !(input.mode === "REPLY" ? row.comment.canComment : row.comment.canHide))) throw new Error("COMMENT_ACTION_UNAVAILABLE");
    if (input.mode === "REPLY") {
      const ownership = (await this.db.select({ state: dbs.conversations.ownership }).from(dbs.conversations).where(and(eq(dbs.conversations.id, row.comment.conversationId), eq(dbs.conversations.businessId, context.businessId))).limit(1))[0]?.state;
      if (ownership === "HUMAN_ACTIVE") {
        const handoff = (await this.db.select({ assignedTo: dbs.handoffs.assignedTo }).from(dbs.handoffs).where(and(eq(dbs.handoffs.businessId, context.businessId), eq(dbs.handoffs.conversationId, row.comment.conversationId))).orderBy(desc(dbs.handoffs.createdAt), desc(dbs.handoffs.id)).limit(1))[0];
        if (handoff?.assignedTo !== actorId) throw new Error("HUMAN_OWNERSHIP_REQUIRED");
      }
    }
    const sourceEventId = row.comment.sourceEventId;
    const classification = commentClassificationSchema.parse({ schemaVersion: "1.0", category: "uncertain", confidence: 0, requiresReply: input.mode === "REPLY", requiresHuman: true, moderationRecommendation: "review", signals: [`manual:${hash}`] });
    const decisionId = ulid();
    await this.db.transaction(async (tx) => {
      await tx.insert(dbs.commentDecisions).values({ id: decisionId, businessId: context.businessId, commentId, sourceEventId, classification, policyVersion: input.mode === "DELETE" ? row.policy?.version ?? 0 : 0, outcome, safeReason: input.mode === "REPLY" ? "MANUAL_APPROVED_REPLY" : input.mode === "HIDE" ? "MANUAL_APPROVED_HIDE" : "MANUAL_APPROVED_DELETE", actionStatus: "PENDING", idempotencyKey, actorId });
      await tx.insert(dbs.auditLogs).values({ id: ulid(), businessId: context.businessId, actorId, action: "comment.manual_action.requested", targetType: "comment_decision", targetId: decisionId, safeMetadata: { outcome, confirmed: input.mode === "DELETE" } });
    });
    const trusted = createTrustedBusinessContext({ businessId: context.businessId, principal: { kind: "system", service: "comment-processor" }, source: "internal_system", agentId: row.connection.agentId, conversationId: row.comment.conversationId, customerId: row.comment.customerId, traceId: context.traceId, capabilityGrants: [input.mode === "REPLY" ? "comment.reply" : input.mode === "HIDE" ? "comment.hide" : "comment.delete"] });
    try {
      const result = input.mode === "REPLY"
        ? await this.adapter.execute(trusted, universalChannelActionSchema.parse({ id: ulid(), schemaVersion: "1.0", type: "ReplyToComment", idempotencyKey, commentId, text }))
        : input.mode === "HIDE" ? await this.adapter.hideComment(trusted, commentId, idempotencyKey) : await this.adapter.deleteComment(trusted, commentId, idempotencyKey);
      const final = (await this.db.select({ status: dbs.commentDecisions.actionStatus, externalId: dbs.commentDecisions.externalActionId }).from(dbs.commentDecisions).where(and(eq(dbs.commentDecisions.id, decisionId), eq(dbs.commentDecisions.businessId, context.businessId))).limit(1))[0];
      await this.db.insert(dbs.auditLogs).values({ id: ulid(), businessId: context.businessId, actorId, action: "comment.manual_action.finished", targetType: "comment_decision", targetId: decisionId, safeMetadata: { outcome, status: final?.status ?? "UNKNOWN" } });
      if (result.status !== "EXECUTED" || final?.status !== "COMPLETED") throw new Error(final?.status === "UNKNOWN" ? "EXTERNAL_OUTCOME_UNVERIFIED" : ("safeReason" in result ? result.safeReason : undefined) ?? "COMMENT_ACTION_FAILED");
      return { decisionId, status: "COMPLETED" as const, externalId: final.externalId ?? result.externalId };
    } catch (error) {
      const current = (await this.db.select({ status: dbs.commentDecisions.actionStatus }).from(dbs.commentDecisions).where(and(eq(dbs.commentDecisions.id, decisionId), eq(dbs.commentDecisions.businessId, context.businessId))).limit(1))[0];
      if (current?.status === "PENDING") await this.db.update(dbs.commentDecisions).set({ actionStatus: "FAILED", safeReason: "MANUAL_ACTION_FAILED", completedAt: new Date(), updatedAt: new Date() }).where(and(eq(dbs.commentDecisions.id, decisionId), eq(dbs.commentDecisions.businessId, context.businessId), eq(dbs.commentDecisions.actionStatus, "PENDING")));
      throw error;
    }
  }
}
