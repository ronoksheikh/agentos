import { and, count, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ulid } from "ulid";
import * as dbs from "@agentos/database";
import { ulidSchema, type TrustedBusinessContext } from "@agentos/shared";
import { commentClassificationSchema } from "./index";

const dispositions = ["ACKNOWLEDGED", "FOLLOW_UP_REQUIRED", "EXTERNAL_CHECKED"] as const;
export type CommentReviewDisposition = typeof dispositions[number];

/** Decision-grain analytics and human review acknowledgement. No Page write is performed here. */
export class PostgresCommentAnalytics {
  constructor(private readonly db: NodePgDatabase, private readonly now: () => Date = () => new Date()) {}
  private actor(context: TrustedBusinessContext, manage = false) {
    const capability = manage ? "conversation.manage" : "conversation.read";
    if (context.principal.kind !== "user" || !(context.capabilityGrants.includes(capability) || context.capabilityGrants.includes("channel.manage"))) throw new Error("FORBIDDEN");
    return context.principal.userId;
  }
  async summary(context: TrustedBusinessContext, connectionId?: string) {
    this.actor(context);
    const start = new Date(this.now().getTime() - 30 * 86400_000);
    const scope = and(eq(dbs.facebookComments.businessId, context.businessId), ...(connectionId ? [eq(dbs.facebookComments.connectionId, connectionId)] : []));
    const reviewCondition = or(inArray(dbs.commentDecisions.actionStatus, ["REVIEW_REQUIRED", "UNKNOWN"]), eq(dbs.commentDecisions.outcome, "HANDOFF"));
    const category = sql<string>`COALESCE(${dbs.commentDecisions.classification}->>'category', 'unknown')`;
    const [received, outcomes, actions, categories, reviewCount, queue, productSources] = await Promise.all([
      this.db.select({ value: count() }).from(dbs.facebookComments).where(and(scope, gte(dbs.facebookComments.createdAt, start))),
      this.db.select({ outcome: dbs.commentDecisions.outcome, value: count() }).from(dbs.commentDecisions).innerJoin(dbs.facebookComments, and(eq(dbs.facebookComments.id, dbs.commentDecisions.commentId), eq(dbs.facebookComments.businessId, context.businessId))).where(and(scope, gte(dbs.commentDecisions.decidedAt, start))).groupBy(dbs.commentDecisions.outcome),
      this.db.select({ status: dbs.commentDecisions.actionStatus, value: count() }).from(dbs.commentDecisions).innerJoin(dbs.facebookComments, and(eq(dbs.facebookComments.id, dbs.commentDecisions.commentId), eq(dbs.facebookComments.businessId, context.businessId))).where(and(scope, gte(dbs.commentDecisions.decidedAt, start))).groupBy(dbs.commentDecisions.actionStatus),
      this.db.select({ category, value: count() }).from(dbs.commentDecisions).innerJoin(dbs.facebookComments, and(eq(dbs.facebookComments.id, dbs.commentDecisions.commentId), eq(dbs.facebookComments.businessId, context.businessId))).where(and(scope, gte(dbs.commentDecisions.decidedAt, start))).groupBy(category),
      this.db.select({ value: count() }).from(dbs.commentDecisions).innerJoin(dbs.facebookComments, and(eq(dbs.facebookComments.id, dbs.commentDecisions.commentId), eq(dbs.facebookComments.businessId, context.businessId))).leftJoin(dbs.commentReviews, and(eq(dbs.commentReviews.decisionId, dbs.commentDecisions.id), eq(dbs.commentReviews.businessId, context.businessId))).where(and(scope, reviewCondition, isNull(dbs.commentReviews.id))),
      this.db.select({ id: dbs.commentDecisions.id, commentId: dbs.facebookComments.id, text: dbs.facebookComments.text, externalCommentId: dbs.facebookComments.externalCommentId, postId: dbs.facebookComments.postId, productRef: dbs.facebookPosts.productRef, connectionId: dbs.facebookComments.connectionId, outcome: dbs.commentDecisions.outcome, actionStatus: dbs.commentDecisions.actionStatus, safeReason: dbs.commentDecisions.safeReason, classification: dbs.commentDecisions.classification, decidedAt: dbs.commentDecisions.decidedAt }).from(dbs.commentDecisions).innerJoin(dbs.facebookComments, and(eq(dbs.facebookComments.id, dbs.commentDecisions.commentId), eq(dbs.facebookComments.businessId, context.businessId))).leftJoin(dbs.facebookPosts, and(eq(dbs.facebookPosts.id, dbs.facebookComments.postId), eq(dbs.facebookPosts.businessId, context.businessId))).leftJoin(dbs.commentReviews, and(eq(dbs.commentReviews.decisionId, dbs.commentDecisions.id), eq(dbs.commentReviews.businessId, context.businessId))).where(and(scope, reviewCondition, isNull(dbs.commentReviews.id))).orderBy(desc(dbs.commentDecisions.decidedAt), desc(dbs.commentDecisions.id)).limit(50),
      context.capabilityGrants.includes("channel.manage") ? this.db.select({ id: dbs.knowledgeSources.id, version: dbs.knowledgeSources.version, label: dbs.knowledgeSources.label, excerpt: sql<string>`max(${dbs.knowledgeChunks.content})` }).from(dbs.knowledgeSources).innerJoin(dbs.knowledgeChunks, and(eq(dbs.knowledgeChunks.sourceId, dbs.knowledgeSources.id), eq(dbs.knowledgeChunks.businessId, context.businessId), eq(dbs.knowledgeChunks.sourceVersion, dbs.knowledgeSources.version))).where(and(eq(dbs.knowledgeSources.businessId, context.businessId), eq(dbs.knowledgeSources.type, "PRODUCT_CATALOG"), eq(dbs.knowledgeSources.status, "READY"), eq(dbs.knowledgeSources.enabled, true), isNull(dbs.knowledgeSources.deletedAt))).groupBy(dbs.knowledgeSources.id, dbs.knowledgeSources.version, dbs.knowledgeSources.label).having(sql`count(*) = 1`).orderBy(dbs.knowledgeSources.label).limit(100) : Promise.resolve([]),
    ]);
    return { asOf: this.now().toISOString(), windowStart: start.toISOString(), received: received[0]?.value ?? 0, decisionsByOutcome: Object.fromEntries(outcomes.map((row) => [row.outcome, row.value])), decisionsByActionStatus: Object.fromEntries(actions.map((row) => [row.status, row.value])), decisionsByCategory: Object.fromEntries(categories.map((row) => [row.category, row.value])), openReviews: reviewCount[0]?.value ?? 0, productSources: productSources.map((row) => ({ ...row, excerpt: row.excerpt.slice(0, 180) })), reviewQueue: queue.map((row) => ({ ...row, text: row.text?.slice(0, 1000) ?? null, classification: commentClassificationSchema.parse(row.classification), decidedAt: row.decidedAt.toISOString() })) };
  }
  async mapPostProductSource(context: TrustedBusinessContext, postId: string, sourceRef: string | null) {
    if (context.principal.kind !== "user" || !context.capabilityGrants.includes("channel.manage")) throw new Error("FORBIDDEN");
    const actorId = context.principal.userId;
    const sourceParts = sourceRef?.split(":") ?? [];
    const parsedSourceId = sourceRef ? ulidSchema.safeParse(sourceParts[0]) : null;
    const sourceId = parsedSourceId?.success ? parsedSourceId.data : null;
    const sourceVersion = sourceRef ? Number(sourceParts[1]) : null;
    if (sourceRef && (sourceParts.length !== 2 || !sourceId || !Number.isSafeInteger(sourceVersion) || sourceVersion! < 1)) throw new Error("PRODUCT_SOURCE_UNVERIFIED");
    return this.db.transaction(async (tx) => {
      const post = (await tx.select({ id: dbs.facebookPosts.id, fetchedAt: dbs.facebookPosts.fetchedAt }).from(dbs.facebookPosts).innerJoin(dbs.channelConnections, and(eq(dbs.channelConnections.id, dbs.facebookPosts.connectionId), eq(dbs.channelConnections.businessId, context.businessId))).where(and(eq(dbs.facebookPosts.id, postId), eq(dbs.facebookPosts.businessId, context.businessId), eq(dbs.channelConnections.channel, "facebook_messenger"))).limit(1).for("update"))[0];
      if (!post) throw new Error("COMMENT_POST_NOT_FOUND");
      if (!post.fetchedAt) throw new Error("COMMENT_POST_SCOPE_UNVERIFIED");
      if (sourceId) {
        const source = (await tx.select({ id: dbs.knowledgeSources.id, version: dbs.knowledgeSources.version }).from(dbs.knowledgeSources).where(and(eq(dbs.knowledgeSources.id, sourceId), eq(dbs.knowledgeSources.version, sourceVersion!), eq(dbs.knowledgeSources.businessId, context.businessId), eq(dbs.knowledgeSources.type, "PRODUCT_CATALOG"), eq(dbs.knowledgeSources.status, "READY"), eq(dbs.knowledgeSources.enabled, true), isNull(dbs.knowledgeSources.deletedAt))).limit(1).for("update"))[0];
        if (!source) throw new Error("PRODUCT_SOURCE_UNVERIFIED");
        const chunks = await tx.select({ id: dbs.knowledgeChunks.id }).from(dbs.knowledgeChunks).where(and(eq(dbs.knowledgeChunks.sourceId, source.id), eq(dbs.knowledgeChunks.businessId, context.businessId), eq(dbs.knowledgeChunks.sourceVersion, source.version))).limit(2);
        if (chunks.length !== 1) throw new Error("PRODUCT_SOURCE_UNVERIFIED");
      }
      const productRef = sourceId ? `${sourceId}:${sourceVersion}` : null;
      await tx.update(dbs.facebookPosts).set({ productRef, updatedAt: this.now() }).where(and(eq(dbs.facebookPosts.id, postId), eq(dbs.facebookPosts.businessId, context.businessId)));
      await tx.insert(dbs.auditLogs).values({ id: ulid(), businessId: context.businessId, actorId, action: sourceId ? "comment.post_product_mapped" : "comment.post_product_unmapped", targetType: "facebook_post", targetId: postId, safeMetadata: { ...(productRef ? { productRef } : {}) } });
      return { postId, productRef };
    });
  }
  async markReviewed(context: TrustedBusinessContext, decisionId: string, disposition: CommentReviewDisposition) {
    const actorId = this.actor(context, true);
    if (!dispositions.includes(disposition)) throw new Error("REVIEW_DISPOSITION_INVALID");
    return this.db.transaction(async (tx) => {
      const row = (await tx.select({ id: dbs.commentDecisions.id, outcome: dbs.commentDecisions.outcome, actionStatus: dbs.commentDecisions.actionStatus }).from(dbs.commentDecisions).innerJoin(dbs.facebookComments, and(eq(dbs.facebookComments.id, dbs.commentDecisions.commentId), eq(dbs.facebookComments.businessId, context.businessId))).where(and(eq(dbs.commentDecisions.businessId, context.businessId), eq(dbs.commentDecisions.id, decisionId))).limit(1).for("update"))[0];
      if (!row) throw new Error("COMMENT_DECISION_NOT_FOUND");
      if (!["REVIEW_REQUIRED", "UNKNOWN"].includes(row.actionStatus) && row.outcome !== "HANDOFF") throw new Error("REVIEW_NOT_REQUIRED");
      if (row.actionStatus === "UNKNOWN" && disposition === "ACKNOWLEDGED") throw new Error("EXTERNAL_OUTCOME_UNVERIFIED");
      const prior = (await tx.select({ id: dbs.commentReviews.id, disposition: dbs.commentReviews.disposition }).from(dbs.commentReviews).where(and(eq(dbs.commentReviews.businessId, context.businessId), eq(dbs.commentReviews.decisionId, decisionId))).limit(1))[0];
      if (prior) { if (prior.disposition !== disposition) throw new Error("REVIEW_ALREADY_RECORDED"); return prior.id; }
      const id = ulid(); await tx.insert(dbs.commentReviews).values({ id, businessId: context.businessId, decisionId, disposition, actorId });
      await tx.insert(dbs.auditLogs).values({ id: ulid(), businessId: context.businessId, actorId, action: "comment.reviewed", targetType: "comment_decision", targetId: decisionId, safeMetadata: { disposition, actionStatus: row.actionStatus } });
      return id;
    });
  }
}
