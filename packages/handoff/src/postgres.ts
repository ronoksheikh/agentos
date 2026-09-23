import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ulid } from "ulid";
import * as dbs from "@agentos/database";
import { businessAutomationAllowed, type TrustedBusinessContext } from "@agentos/shared";

/** Durable client actions. A Website Chat human reply is visible through the visitor's existing poll transport. */
export class PostgresHandoffOperations {
  constructor(private readonly db: NodePgDatabase, private readonly now: () => Date = () => new Date()) {}
  private actor(context: TrustedBusinessContext, capability: "conversation.read" | "handoff.manage") {
    if (context.principal.kind !== "user" || !context.capabilityGrants.includes(capability)) throw new Error("FORBIDDEN");
    return context.principal.userId;
  }
  async detail(context: TrustedBusinessContext, conversationId: string) {
    this.actor(context, "conversation.read");
    const conversation = (await this.db.select({ id: dbs.conversations.id, businessId: dbs.conversations.businessId, channel: dbs.conversations.channel, ownership: dbs.conversations.ownership, customerName: dbs.customers.displayName, customerId: dbs.conversations.customerId, updatedAt: dbs.conversations.updatedAt }).from(dbs.conversations).leftJoin(dbs.customers, and(eq(dbs.customers.id, dbs.conversations.customerId), eq(dbs.customers.businessId, context.businessId))).where(and(eq(dbs.conversations.id, conversationId), eq(dbs.conversations.businessId, context.businessId))).limit(1))[0];
    if (!conversation) throw new Error("CONVERSATION_NOT_FOUND");
    const [messages, handoff] = await Promise.all([
      this.db.select({ id: dbs.messages.id, senderKind: dbs.messages.senderKind, text: dbs.messages.text, occurredAt: dbs.messages.occurredAt }).from(dbs.messages).where(and(eq(dbs.messages.businessId, context.businessId), eq(dbs.messages.conversationId, conversationId))).orderBy(desc(dbs.messages.occurredAt), desc(dbs.messages.id)).limit(100),
      this.db.select({ id: dbs.handoffs.id, state: dbs.handoffs.state, reason: dbs.handoffs.reason, priority: dbs.handoffs.priority, assignedTo: dbs.handoffs.assignedTo, resolution: dbs.handoffs.resolution, updatedAt: dbs.handoffs.updatedAt }).from(dbs.handoffs).where(and(eq(dbs.handoffs.businessId, context.businessId), eq(dbs.handoffs.conversationId, conversationId))).orderBy(desc(dbs.handoffs.createdAt), desc(dbs.handoffs.id)).limit(1),
    ]);
    return { ...conversation, updatedAt: conversation.updatedAt.toISOString(), messages: messages.reverse().map((message) => ({ ...message, occurredAt: message.occurredAt.toISOString() })), handoff: handoff[0] ? { ...handoff[0], updatedAt: handoff[0].updatedAt.toISOString() } : null };
  }
  private async transition(context: TrustedBusinessContext, conversationId: string, action: "take-over" | "resolve" | "resume", resolution?: string) {
    const actorId = this.actor(context, "handoff.manage"); const now = this.now();
    return this.db.transaction(async (tx) => {
      const conversation = (await tx.select().from(dbs.conversations).where(and(eq(dbs.conversations.id, conversationId), eq(dbs.conversations.businessId, context.businessId))).limit(1).for("update"))[0];
      if (!conversation) throw new Error("CONVERSATION_NOT_FOUND");
      const handoff = (await tx.select().from(dbs.handoffs).where(and(eq(dbs.handoffs.businessId, context.businessId), eq(dbs.handoffs.conversationId, conversationId))).orderBy(desc(dbs.handoffs.createdAt), desc(dbs.handoffs.id)).limit(1).for("update"))[0];
      if (!handoff) throw new Error("HANDOFF_NOT_FOUND");
      if (action === "take-over" && handoff.state === "HUMAN_ACTIVE" && handoff.assignedTo === actorId) return handoff.state;
      if (action === "take-over" && !["HANDOFF_REQUESTED", "PAUSED"].includes(handoff.state)) throw new Error("INVALID_HANDOFF_TRANSITION");
      if (action === "resolve" && !["HANDOFF_REQUESTED", "HUMAN_ACTIVE", "PAUSED"].includes(handoff.state)) throw new Error("INVALID_HANDOFF_TRANSITION");
      if (action === "resume" && !["RESOLVED", "PAUSED"].includes(handoff.state)) throw new Error("INVALID_HANDOFF_TRANSITION");
      if (action === "resolve" && (!resolution || resolution.length > 1000)) throw new Error("RESOLUTION_INVALID");
      const state = action === "take-over" ? "HUMAN_ACTIVE" : action === "resolve" ? "RESOLVED" : "AI_ACTIVE";
      await tx.update(dbs.handoffs).set({ state, ...(action === "take-over" ? { assignedTo: actorId, acknowledgedBy: actorId, acknowledgedAt: now } : {}), ...(action === "resolve" ? { resolvedAt: now, resolvedBy: actorId, resolution } : {}), updatedAt: now }).where(eq(dbs.handoffs.id, handoff.id));
      await tx.update(dbs.conversations).set({ ownership: state, updatedAt: now }).where(and(eq(dbs.conversations.id, conversationId), eq(dbs.conversations.businessId, context.businessId)));
      await tx.insert(dbs.conversationOwnershipHistory).values({ id: ulid(), businessId: context.businessId, conversationId, handoffId: handoff.id, fromState: conversation.ownership, toState: state, actorId, safeMetadata: { action } });
      await tx.insert(dbs.auditLogs).values({ id: ulid(), businessId: context.businessId, actorId, action: `handoff.${action}`, targetType: "handoff", targetId: handoff.id, safeMetadata: { state } });
      return state;
    });
  }
  takeOver(context: TrustedBusinessContext, conversationId: string) { return this.transition(context, conversationId, "take-over"); }
  resolve(context: TrustedBusinessContext, conversationId: string, resolution: string) { return this.transition(context, conversationId, "resolve", resolution.trim()); }
  resumeAgent(context: TrustedBusinessContext, conversationId: string) { return this.transition(context, conversationId, "resume"); }
  async sendWebsiteReply(context: TrustedBusinessContext, conversationId: string, content: string, idempotencyKey: string) {
    const actorId = this.actor(context, "handoff.manage"); const text = content.trim();
    if (!text || text.length > 4000 || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(idempotencyKey)) throw new Error("HUMAN_REPLY_INVALID");
    return this.db.transaction(async (tx) => {
      const conversation = (await tx.select().from(dbs.conversations).where(and(eq(dbs.conversations.id, conversationId), eq(dbs.conversations.businessId, context.businessId), eq(dbs.conversations.channel, "web_chat"))).limit(1).for("update"))[0];
      if (!conversation || conversation.ownership !== "HUMAN_ACTIVE") throw new Error("HUMAN_OWNERSHIP_REQUIRED");
      const handoff = (await tx.select({ assignedTo: dbs.handoffs.assignedTo, state: dbs.handoffs.state }).from(dbs.handoffs).where(and(eq(dbs.handoffs.businessId, context.businessId), eq(dbs.handoffs.conversationId, conversationId))).orderBy(desc(dbs.handoffs.createdAt), desc(dbs.handoffs.id)).limit(1).for("update"))[0];
      if (handoff?.state !== "HUMAN_ACTIVE" || handoff.assignedTo !== actorId) throw new Error("HUMAN_OWNERSHIP_REQUIRED");
      const live = (await tx.select({ session: dbs.visitorSessions, site: dbs.websiteSites, connection: dbs.channelConnections, business: dbs.businesses }).from(dbs.visitorSessions).innerJoin(dbs.websiteSites, eq(dbs.websiteSites.id, dbs.visitorSessions.siteId)).innerJoin(dbs.channelConnections, eq(dbs.channelConnections.id, dbs.websiteSites.id)).innerJoin(dbs.businesses, eq(dbs.businesses.id, dbs.websiteSites.businessId)).where(and(eq(dbs.visitorSessions.businessId, context.businessId), eq(dbs.visitorSessions.conversationId, conversationId), gt(dbs.visitorSessions.expiresAt, this.now()), isNull(dbs.visitorSessions.revokedAt))).limit(1))[0];
      if (!live || live.site.businessId !== context.businessId || live.connection.businessId !== context.businessId || live.connection.channel !== "web_chat" || !live.site.enabled || live.connection.state !== "CONNECTED" || live.connection.paused || !businessAutomationAllowed(live.business, this.now())) throw new Error("VISITOR_SESSION_UNAVAILABLE");
      const externalMessageId = `human:${idempotencyKey}`; const id = ulid(); const now = this.now();
      const inserted = await tx.insert(dbs.messages).values({ id, businessId: context.businessId, conversationId, customerId: conversation.customerId, connectionId: live.site.id, externalMessageId, senderKind: "HUMAN", text, occurredAt: now, traceId: context.traceId, lifecycle: { status: "SENT", actorId } }).onConflictDoNothing().returning({ id: dbs.messages.id });
      if (!inserted.length) { const prior = (await tx.select({ id: dbs.messages.id, text: dbs.messages.text, conversationId: dbs.messages.conversationId }).from(dbs.messages).where(and(eq(dbs.messages.businessId, context.businessId), eq(dbs.messages.connectionId, live.site.id), eq(dbs.messages.externalMessageId, externalMessageId))).limit(1))[0]; if (!prior || prior.conversationId !== conversationId || prior.text !== text) throw new Error("HUMAN_REPLY_IDEMPOTENCY_CONFLICT"); return prior.id; }
      await tx.update(dbs.conversations).set({ updatedAt: now }).where(eq(dbs.conversations.id, conversationId));
      await tx.insert(dbs.auditLogs).values({ id: ulid(), businessId: context.businessId, actorId, action: "handoff.website_reply", targetType: "message", targetId: id, safeMetadata: { conversationId, channel: "web_chat" } });
      return id;
    });
  }
}
