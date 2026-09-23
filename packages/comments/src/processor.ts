import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ulid } from "ulid";
import * as dbs from "@agentos/database";
import type { MetaApi, PostgresCredentialVault } from "@agentos/channels";
import { MetaApiError } from "@agentos/channels";
import type { UniversalEvent } from "@agentos/events";
import type { RealtimeBus } from "@agentos/realtime";
import { businessAutomationAllowed, createTrustedBusinessContext } from "@agentos/shared";
import { CommentPolicyEngine, RuleCommentClassifier, type CommentClassifier, type CommentDecision } from "./index";

type CommentEvent = Extract<UniversalEvent, { type: "comment.created" }>;
type LoadedComment = { text: string; authorId: string | null; parentId: string | null; postId: string | null; postText: string | null; postScopeVerified: boolean; canComment: boolean; canHide: boolean; isHidden: boolean; readCode: string };

export interface CommentWriteExecutor {
  reply(input: { event: CommentEvent; commentId: string; conversationId: string; decisionId: string; signal: AbortSignal }): Promise<{ externalId: string; runId?: string }>;
  hide(input: { event: CommentEvent; commentId: string; decisionId: string; signal: AbortSignal }): Promise<{ externalId: string }>;
}

/** Specialized Page-comment path; all inbound receipt remains in the shared event gateway. */
export class PostgresCommentProcessor {
  private readonly policy = new CommentPolicyEngine();
  constructor(private readonly db: NodePgDatabase, private readonly meta: MetaApi, private readonly vault: PostgresCredentialVault, private readonly realtime?: RealtimeBus, private readonly classifier: CommentClassifier = new RuleCommentClassifier(), private readonly writes?: CommentWriteExecutor) {}
  private async load(event: CommentEvent, connection: typeof dbs.channelConnections.$inferSelect): Promise<LoadedComment> {
    const fallback: LoadedComment = { text: "", authorId: null, parentId: event.payload.externalParentId ?? null, postId: event.payload.externalPostId ?? null, postText: null, postScopeVerified: false, canComment: false, canHide: false, isHidden: false, readCode: "COMMENT_READ_UNAVAILABLE" };
    if (!connection.credentialRefId || !this.meta.getComment || !this.meta.getPost) return fallback;
    const context = createTrustedBusinessContext({ businessId: event.businessId, principal: { kind: "system", service: "comment-processor" }, source: "internal_system", agentId: connection.agentId, traceId: event.traceId, capabilityGrants: [] });
    try {
      const token = await this.vault.resolve(context, connection.credentialRefId, "meta_page_token");
      const comment = await this.meta.getComment(event.payload.externalCommentId, token);
      if (comment.id !== event.payload.externalCommentId) return { ...fallback, readCode: "COMMENT_ID_MISMATCH" };
      const postId = comment.postId ?? event.payload.externalPostId ?? null;
      const post = postId ? await this.meta.getPost(postId, token) : null;
      const postScopeVerified = Boolean(post && post.id === postId && post.authorId === connection.externalPageId && (!comment.postId || !event.payload.externalPostId || comment.postId === event.payload.externalPostId));
      return { text: comment.message.slice(0, 20_000), authorId: comment.authorId ?? null, parentId: comment.parentId ?? event.payload.externalParentId ?? null, postId, postText: post?.message?.slice(0, 20_000) ?? null, postScopeVerified, canComment: comment.canComment, canHide: comment.canHide, isHidden: comment.isHidden, readCode: postScopeVerified ? "VERIFIED" : "POST_SCOPE_UNVERIFIED" };
    } catch (error) {
      if (error instanceof MetaApiError && ["META_RATE_LIMIT", "META_TRANSIENT"].includes(error.safeCode)) throw Object.assign(new Error(error.safeCode), { code: error.safeCode });
      return { ...fallback, readCode: error instanceof MetaApiError ? error.safeCode : "COMMENT_READ_UNAVAILABLE" };
    }
  }
  private async persist(event: CommentEvent, connection: typeof dbs.channelConnections.$inferSelect, loaded: LoadedComment) {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${connection.id}:${event.payload.externalCommentId}`}, 0))`);
      const existing = (await tx.select().from(dbs.facebookComments).where(and(eq(dbs.facebookComments.businessId, event.businessId), eq(dbs.facebookComments.connectionId, connection.id), eq(dbs.facebookComments.externalCommentId, event.payload.externalCommentId))).limit(1))[0];
      if (existing) return existing;
      let postId: string | null = null;
      if (loaded.postId) {
        const inserted = await tx.insert(dbs.facebookPosts).values({ id: ulid(), businessId: event.businessId, connectionId: connection.id, externalPostId: loaded.postId, text: loaded.postText, fetchedAt: loaded.postScopeVerified ? new Date() : null }).onConflictDoNothing().returning({ id: dbs.facebookPosts.id });
        postId = inserted[0]?.id ?? (await tx.select({ id: dbs.facebookPosts.id }).from(dbs.facebookPosts).where(and(eq(dbs.facebookPosts.businessId, event.businessId), eq(dbs.facebookPosts.connectionId, connection.id), eq(dbs.facebookPosts.externalPostId, loaded.postId))).limit(1))[0]?.id ?? null;
      }
      let customerId: string;
      if (loaded.authorId) {
        const externalId = `${connection.id}:${loaded.authorId}`;
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${externalId}, 0))`);
        const priorIdentity = (await tx.select({ customerId: dbs.customerIdentities.customerId }).from(dbs.customerIdentities).where(and(eq(dbs.customerIdentities.businessId, event.businessId), eq(dbs.customerIdentities.channel, "facebook_comment"), eq(dbs.customerIdentities.externalId, externalId))).limit(1))[0];
        customerId = priorIdentity?.customerId ?? ulid();
        if (!priorIdentity) { await tx.insert(dbs.customers).values({ id: customerId, businessId: event.businessId }); await tx.insert(dbs.customerIdentities).values({ id: ulid(), businessId: event.businessId, customerId, channel: "facebook_comment", externalId, verifiedAt: new Date(), metadata: { connectionId: connection.id } }); }
      } else { customerId = ulid(); await tx.insert(dbs.customers).values({ id: customerId, businessId: event.businessId }); }
      const conversationId = ulid();
      await tx.insert(dbs.conversations).values({ id: conversationId, businessId: event.businessId, customerId, agentId: connection.agentId, channel: "facebook_messenger", latestInboundSequence: 1 });
      await tx.insert(dbs.messages).values({ id: ulid(), businessId: event.businessId, conversationId, customerId, connectionId: connection.id, externalMessageId: `comment:${event.payload.externalCommentId}`, senderKind: "CUSTOMER", text: loaded.text || null, occurredAt: new Date(event.occurredAt), inboundSequence: 1, traceId: event.traceId, rawEventSourceRef: event.rawEventId, lifecycle: { source: "facebook_comment" } });
      const id = ulid(); await tx.insert(dbs.facebookComments).values({ id, businessId: event.businessId, connectionId: connection.id, postId, externalCommentId: event.payload.externalCommentId, externalParentId: loaded.parentId, authorExternalId: loaded.authorId, customerId, conversationId, text: loaded.text || null, canComment: loaded.canComment, canHide: loaded.canHide, isHidden: loaded.isHidden, sourceEventId: event.id });
      return (await tx.select().from(dbs.facebookComments).where(eq(dbs.facebookComments.id, id)).limit(1))[0]!;
    });
  }
  private async notifyReview(event: CommentEvent, commentId: string, decisionId: string, reason: string, conversationId: string | null) {
    const members = await this.db.select({ userId: dbs.businessMemberships.userId }).from(dbs.businessMemberships).where(eq(dbs.businessMemberships.businessId, event.businessId));
    for (const member of members) await this.db.insert(dbs.notifications).values({ id: ulid(), businessId: event.businessId, userId: member.userId, conversationId, type: "COMMENT_REVIEW", severity: "NORMAL", dedupeKey: `comment:${decisionId}:${member.userId}`, safePayload: { commentId, reason } }).onConflictDoNothing();
  }
  private async handoff(event: CommentEvent, comment: typeof dbs.facebookComments.$inferSelect, decisionId: string) {
    if (!comment.conversationId) return;
    await this.db.transaction(async (tx) => {
      const conversation = (await tx.select({ ownership: dbs.conversations.ownership }).from(dbs.conversations).where(and(eq(dbs.conversations.id, comment.conversationId!), eq(dbs.conversations.businessId, event.businessId))).limit(1).for("update"))[0];
      if (!conversation || conversation.ownership !== "AI_ACTIVE") return;
      const handoffId = ulid();
      await tx.insert(dbs.handoffs).values({ id: handoffId, businessId: event.businessId, conversationId: comment.conversationId!, customerId: comment.customerId, channel: "facebook_messenger", reason: "Comment needs human review", priority: "NORMAL", state: "HANDOFF_REQUESTED", traceId: event.traceId, idempotencyKey: `comment:${decisionId}:handoff` }).onConflictDoNothing();
      await tx.update(dbs.conversations).set({ ownership: "HANDOFF_REQUESTED", updatedAt: new Date() }).where(eq(dbs.conversations.id, comment.conversationId!));
      await tx.insert(dbs.conversationOwnershipHistory).values({ id: ulid(), businessId: event.businessId, conversationId: comment.conversationId!, handoffId, fromState: "AI_ACTIVE", toState: "HANDOFF_REQUESTED", actorId: "comment-processor", safeMetadata: { commentId: comment.id } });
    });
  }
  async process(event: CommentEvent, signal: AbortSignal) {
    if (signal.aborted) throw Object.assign(new Error("Cancelled"), { code: "CANCELLED" });
    const connection = (await this.db.select().from(dbs.channelConnections).where(and(eq(dbs.channelConnections.id, event.connectionId), eq(dbs.channelConnections.businessId, event.businessId), eq(dbs.channelConnections.channel, "facebook_messenger"))).limit(1))[0];
    if (!connection) throw new Error("COMMENT_CONNECTION_NOT_FOUND");
    const loaded = await this.load(event, connection); const comment = await this.persist(event, connection, loaded);
    const [policy, flag, conversation, business] = await Promise.all([
      this.db.select().from(dbs.commentPolicies).where(and(eq(dbs.commentPolicies.businessId, event.businessId), eq(dbs.commentPolicies.connectionId, connection.id))).limit(1),
      this.db.select({ enabled: dbs.featureFlags.enabled }).from(dbs.featureFlags).where(and(eq(dbs.featureFlags.businessId, event.businessId), eq(dbs.featureFlags.key, "comment_ai"))).limit(1),
      comment.conversationId ? this.db.select({ ownership: dbs.conversations.ownership }).from(dbs.conversations).where(and(eq(dbs.conversations.id, comment.conversationId), eq(dbs.conversations.businessId, event.businessId))).limit(1) : Promise.resolve([]),
      this.db.select({ state: dbs.businesses.state, disabled: dbs.businesses.disabled, trialStartedAt: dbs.businesses.trialStartedAt, trialEndsAt: dbs.businesses.trialEndsAt, trialExpiryBehavior: dbs.businesses.trialExpiryBehavior }).from(dbs.businesses).where(eq(dbs.businesses.id, event.businessId)).limit(1),
    ]);
    const configured = policy[0]; const capabilities = connection.capabilities && typeof connection.capabilities === "object" && !Array.isArray(connection.capabilities) ? connection.capabilities as Record<string, unknown> : {};
    const classification = await this.classifier.classify({ text: loaded.text, postText: loaded.postText, signal });
    const decided = this.policy.evaluate(classification, { enabled: configured?.enabled ?? false, autoReply: configured?.autoReply ?? false, autoHide: configured?.autoHide ?? false, allowDelete: configured?.allowDelete ?? false, minimumConfidence: configured?.minimumConfidence ?? 0.85, featureEnabled: flag[0]?.enabled ?? false, businessEligible: Boolean(business[0] && businessAutomationAllowed(business[0])), channelConnected: connection.state === "CONNECTED" && !connection.paused, verifiedRead: capabilities.commentReadVerified === true, verifiedReply: capabilities.commentReplyVerified === true, verifiedHide: capabilities.commentHideVerified === true, commentCanReply: loaded.canComment, commentCanHide: loaded.canHide, commentHidden: loaded.isHidden, postScopeVerified: loaded.postScopeVerified, verifiedExternalAuthor: Boolean(loaded.authorId && loaded.authorId !== connection.externalPageId), ...(conversation[0] ? { ownership: conversation[0].ownership } : {}) });
    const key = `comment:${connection.id}:${comment.externalCommentId}:policy:${configured?.version ?? 1}`;
    const id = ulid(); const inserted = await this.db.insert(dbs.commentDecisions).values({ id, businessId: event.businessId, commentId: comment.id, sourceEventId: event.id, classification, policyVersion: configured?.version ?? 1, outcome: decided.outcome, safeReason: loaded.readCode !== "VERIFIED" ? loaded.readCode : decided.safeReason, actionStatus: "PENDING", idempotencyKey: key, actorId: "comment-processor" }).onConflictDoNothing().returning({ id: dbs.commentDecisions.id });
    const decisionId = inserted[0]?.id ?? (await this.db.select({ id: dbs.commentDecisions.id }).from(dbs.commentDecisions).where(and(eq(dbs.commentDecisions.businessId, event.businessId), eq(dbs.commentDecisions.idempotencyKey, key))).limit(1))[0]?.id;
    if (!decisionId) throw new Error("COMMENT_DECISION_MISSING");
    if (!inserted.length) {
      // A replay can follow a crash between decision persistence and the external write.
      // Never restart that write from the event: preserve an uncertain outcome for review.
      const recovered = await this.db.update(dbs.commentDecisions).set({ actionStatus: "UNKNOWN", safeReason: "REPLAY_OUTCOME_UNVERIFIED", completedAt: new Date(), updatedAt: new Date() }).where(and(eq(dbs.commentDecisions.id, decisionId), eq(dbs.commentDecisions.businessId, event.businessId), eq(dbs.commentDecisions.actionStatus, "EXECUTING"))).returning({ id: dbs.commentDecisions.id });
      const pending = recovered.length ? [] : await this.db.update(dbs.commentDecisions).set({ actionStatus: "REVIEW_REQUIRED", safeReason: "REPLAY_BEFORE_ACTION", completedAt: new Date(), updatedAt: new Date() }).where(and(eq(dbs.commentDecisions.id, decisionId), eq(dbs.commentDecisions.businessId, event.businessId), eq(dbs.commentDecisions.actionStatus, "PENDING"))).returning({ id: dbs.commentDecisions.id });
      if (recovered.length || pending.length) {
        await this.notifyReview(event, comment.id, decisionId, recovered.length ? "REPLAY_OUTCOME_UNVERIFIED" : "REPLAY_BEFORE_ACTION", comment.conversationId);
        await this.db.insert(dbs.auditLogs).values({ id: ulid(), businessId: event.businessId, actorId: "comment-processor", action: "comment.replay.review", targetType: "facebook_comment", targetId: comment.id, safeMetadata: { decisionId, state: recovered.length ? "UNKNOWN" : "REVIEW_REQUIRED" } });
        await this.realtime?.publish({ type: "comment.review", businessId: event.businessId, ...(comment.conversationId ? { conversationId: comment.conversationId } : {}), traceId: event.traceId, payload: { commentId: comment.id } });
      }
      return decisionId;
    }
    const finish = async (status: string, reason?: string, externalId?: string, runId?: string) => { await this.db.update(dbs.commentDecisions).set({ actionStatus: status, ...(reason ? { safeReason: reason } : {}), ...(externalId ? { externalActionId: externalId } : {}), ...(runId ? { runId } : {}), completedAt: new Date(), updatedAt: new Date() }).where(and(eq(dbs.commentDecisions.id, decisionId), eq(dbs.commentDecisions.businessId, event.businessId))); };
    if (decided.outcome === "HANDOFF") { await this.handoff(event, comment, decisionId); await this.notifyReview(event, comment.id, decisionId, decided.safeReason, comment.conversationId); await finish("COMPLETED"); }
    else if (decided.outcome === "KEEP") { if (decided.reviewRequired) await this.notifyReview(event, comment.id, decisionId, decided.safeReason, comment.conversationId); await finish(decided.reviewRequired ? "REVIEW_REQUIRED" : "COMPLETED"); }
    else if (!this.writes || !comment.conversationId) { await this.notifyReview(event, comment.id, decisionId, "WRITE_PATH_UNAVAILABLE", comment.conversationId); await finish("REVIEW_REQUIRED", "WRITE_PATH_UNAVAILABLE"); }
    else if (decided.outcome === "REPLY" || decided.outcome === "HIDE") {
      try {
        if (decided.outcome === "REPLY") { const result = await this.writes.reply({ event, commentId: comment.id, conversationId: comment.conversationId, decisionId, signal }); await finish("COMPLETED", undefined, result.externalId, result.runId); }
        else { const result = await this.writes.hide({ event, commentId: comment.id, decisionId, signal }); await finish("COMPLETED", undefined, result.externalId); }
      } catch (error) {
        const current = (await this.db.select({ status: dbs.commentDecisions.actionStatus }).from(dbs.commentDecisions).where(and(eq(dbs.commentDecisions.id, decisionId), eq(dbs.commentDecisions.businessId, event.businessId))).limit(1))[0];
        if (current?.status === "PENDING") await finish("REVIEW_REQUIRED", error instanceof Error && ["COMMENT_MODEL_REPLY_INVALID", "COMMENT_REPLY_UNSAFE", "COMMENT_CAPABILITY_UNVERIFIED"].includes(error.message) ? error.message : "COMMENT_WRITE_FAILED");
        else if (current?.status === "EXECUTING") await finish("UNKNOWN", "EXTERNAL_OUTCOME_UNKNOWN");
        await this.notifyReview(event, comment.id, decisionId, "COMMENT_WRITE_REVIEW", comment.conversationId);
      }
    }
    else { await this.notifyReview(event, comment.id, decisionId, "DELETE_NOT_VERIFIED", comment.conversationId); await finish("REVIEW_REQUIRED", "DELETE_NOT_VERIFIED"); }
    const final = (await this.db.select({ status: dbs.commentDecisions.actionStatus, safeReason: dbs.commentDecisions.safeReason }).from(dbs.commentDecisions).where(and(eq(dbs.commentDecisions.id, decisionId), eq(dbs.commentDecisions.businessId, event.businessId))).limit(1))[0];
    if (decided.reviewRequired && (decided.outcome === "HIDE" || decided.outcome === "REPLY")) await this.notifyReview(event, comment.id, decisionId, decided.safeReason, comment.conversationId);
    await this.db.update(dbs.facebookComments).set({ state: final?.status === "COMPLETED" ? decided.outcome : final?.status ?? "UNKNOWN", updatedAt: new Date() }).where(and(eq(dbs.facebookComments.id, comment.id), eq(dbs.facebookComments.businessId, event.businessId)));
    await this.db.insert(dbs.auditLogs).values({ id: ulid(), businessId: event.businessId, actorId: "comment-processor", action: "comment.decided", targetType: "facebook_comment", targetId: comment.id, safeMetadata: { category: classification.category, confidence: classification.confidence, outcome: decided.outcome, actionStatus: final?.status ?? "UNKNOWN", reason: final?.safeReason ?? decided.safeReason, policyVersion: configured?.version ?? 1 } });
    await this.realtime?.publish({ type: "comment.classified", businessId: event.businessId, ...(comment.conversationId ? { conversationId: comment.conversationId } : {}), traceId: event.traceId, payload: { commentId: comment.id, category: classification.category, outcome: decided.outcome, reviewRequired: decided.reviewRequired || final?.status !== "COMPLETED" } });
    if (final?.status === "COMPLETED" && decided.outcome === "HIDE") await this.realtime?.publish({ type: "comment.hidden", businessId: event.businessId, ...(comment.conversationId ? { conversationId: comment.conversationId } : {}), traceId: event.traceId, payload: { commentId: comment.id } });
    else if (final?.status === "COMPLETED" && decided.outcome === "REPLY") await this.realtime?.publish({ type: "comment.replied", businessId: event.businessId, ...(comment.conversationId ? { conversationId: comment.conversationId } : {}), traceId: event.traceId, payload: { commentId: comment.id } });
    else if (final?.status !== "COMPLETED" || decided.reviewRequired) await this.realtime?.publish({ type: "comment.review", businessId: event.businessId, ...(comment.conversationId ? { conversationId: comment.conversationId } : {}), traceId: event.traceId, payload: { commentId: comment.id } });
    return decisionId;
  }
}
