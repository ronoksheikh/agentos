import { and, count, desc, eq, gte, ilike, inArray, isNull, max, sql, asc } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as dbs from "@agentos/database";
import type { TrustedBusinessContext } from "@agentos/shared";

/** Current operational counts and a bounded business-scoped conversation list. */
export class PostgresClientDashboard {
  constructor(private readonly db: NodePgDatabase, private readonly now: () => Date = () => new Date()) {}
  async customerDirectory(context: TrustedBusinessContext, search = "") {
    if (context.principal.kind !== "user" || !context.capabilityGrants.includes("customer.read")) throw new Error("FORBIDDEN");
    const normalizedSearch = search.trim().slice(0, 120);
    const rows = await this.db.select({
      id: dbs.customers.id, displayName: dbs.customers.displayName, tags: dbs.customers.tags, updatedAt: dbs.customers.updatedAt,
      conversationCount: sql<number>`count(${dbs.conversations.id})::int`, lastConversationAt: max(dbs.conversations.updatedAt),
    }).from(dbs.customers).leftJoin(dbs.conversations, and(eq(dbs.conversations.businessId, context.businessId), eq(dbs.conversations.customerId, dbs.customers.id), eq(dbs.conversations.isTest, false)))
      .where(and(eq(dbs.customers.businessId, context.businessId), ...(normalizedSearch ? [ilike(dbs.customers.displayName, `%${normalizedSearch}%`)] : [])))
      .groupBy(dbs.customers.id).orderBy(desc(dbs.customers.updatedAt), desc(dbs.customers.id)).limit(100);
    return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString(), lastConversationAt: row.lastConversationAt?.toISOString() ?? null }));
  }
  async teamDirectory(context: TrustedBusinessContext) {
    if (context.principal.kind !== "user" || !context.capabilityGrants.includes("member.manage")) throw new Error("FORBIDDEN");
    return this.db.select({ userId: dbs.users.id, name: dbs.users.name, email: dbs.users.email, accountState: dbs.users.state, role: dbs.businessMemberships.role, capabilities: dbs.businessMemberships.capabilities, joinedAt: dbs.businessMemberships.createdAt })
      .from(dbs.businessMemberships).innerJoin(dbs.users, eq(dbs.users.id, dbs.businessMemberships.userId)).where(eq(dbs.businessMemberships.businessId, context.businessId))
      .orderBy(asc(dbs.users.name), asc(dbs.users.id)).limit(100).then((rows) => rows.map((row) => ({ ...row, joinedAt: row.joinedAt.toISOString() })));
  }
  async snapshot(context: TrustedBusinessContext, section: string, filter: { unread?: boolean; urgent?: boolean; failed?: boolean } = {}) {
    if (context.principal.kind !== "user" || !context.capabilityGrants.includes("conversation.read")) throw new Error("FORBIDDEN");
    const businessId = context.businessId;
    const asOf = this.now(); const weekStart = new Date(asOf.getTime() - 7 * 86400_000); const monthStart = new Date(asOf.getTime() - 30 * 86400_000);
    const nonTest = and(eq(dbs.conversations.businessId, businessId), eq(dbs.conversations.isTest, false));
    const [unread, handoffs, failed, urgent, recent, runs, attention, performance, notifications] = await Promise.all([
      this.db.select({ value: count() }).from(dbs.conversations).where(and(nonTest, eq(dbs.conversations.unread, true))),
      this.db.select({ value: count() }).from(dbs.handoffs).innerJoin(dbs.conversations, and(eq(dbs.conversations.id, dbs.handoffs.conversationId), eq(dbs.conversations.businessId, dbs.handoffs.businessId))).where(and(eq(dbs.handoffs.businessId, businessId), eq(dbs.conversations.isTest, false), inArray(dbs.handoffs.state, ["HANDOFF_REQUESTED", "HUMAN_ACTIVE", "PAUSED"]))),
      this.db.select({ value: count() }).from(dbs.agentRuns).where(and(eq(dbs.agentRuns.businessId, businessId), eq(dbs.agentRuns.status, "FAILED"), gte(dbs.agentRuns.startedAt, weekStart))),
      this.db.select({ value: count() }).from(dbs.conversations).where(and(nonTest, eq(dbs.conversations.urgent, true))),
      this.db.select({ id: dbs.conversations.id, customerName: dbs.customers.displayName, channel: dbs.conversations.channel, ownership: dbs.conversations.ownership, unread: dbs.conversations.unread, urgent: dbs.conversations.urgent, updatedAt: dbs.conversations.updatedAt }).from(dbs.conversations).leftJoin(dbs.customers, and(eq(dbs.customers.id, dbs.conversations.customerId), eq(dbs.customers.businessId, businessId))).where(and(nonTest, ...(section === "needs-attention" ? [inArray(dbs.conversations.ownership, ["HANDOFF_REQUESTED", "HUMAN_ACTIVE", "PAUSED"])] : []), ...(filter.unread ? [eq(dbs.conversations.unread, true)] : []), ...(filter.urgent ? [eq(dbs.conversations.urgent, true)] : []))).orderBy(desc(dbs.conversations.updatedAt), desc(dbs.conversations.id)).limit(25),
      this.db.select({ id: dbs.agentRuns.id, agentName: dbs.agents.name, status: dbs.agentRuns.status, startedAt: dbs.agentRuns.startedAt, completedAt: dbs.agentRuns.completedAt }).from(dbs.agentRuns).innerJoin(dbs.agents, and(eq(dbs.agents.id, dbs.agentRuns.agentId), eq(dbs.agents.businessId, businessId))).where(and(eq(dbs.agentRuns.businessId, businessId), ...(filter.failed ? [eq(dbs.agentRuns.status, "FAILED"), gte(dbs.agentRuns.startedAt, weekStart)] : []))).orderBy(desc(dbs.agentRuns.startedAt), desc(dbs.agentRuns.id)).limit(25),
      this.db.select({ id: dbs.handoffs.id, conversationId: dbs.handoffs.conversationId, customerName: dbs.customers.displayName, channel: dbs.conversations.channel, state: dbs.handoffs.state, priority: dbs.handoffs.priority, updatedAt: dbs.handoffs.updatedAt }).from(dbs.handoffs).innerJoin(dbs.conversations, and(eq(dbs.conversations.id, dbs.handoffs.conversationId), eq(dbs.conversations.businessId, businessId))).leftJoin(dbs.customers, and(eq(dbs.customers.id, dbs.conversations.customerId), eq(dbs.customers.businessId, businessId))).where(and(eq(dbs.handoffs.businessId, businessId), eq(dbs.conversations.isTest, false), inArray(dbs.handoffs.state, ["HANDOFF_REQUESTED", "HUMAN_ACTIVE", "PAUSED"]))).orderBy(desc(dbs.handoffs.updatedAt), desc(dbs.handoffs.id)).limit(25),
      section === "overview" ? this.performance(businessId, monthStart) : Promise.resolve(null),
      section === "overview" && context.principal.kind === "user" ? this.db.select({ id: dbs.notifications.id, type: dbs.notifications.type, severity: dbs.notifications.severity, conversationId: dbs.notifications.conversationId, acknowledgedAt: dbs.notifications.acknowledgedAt, createdAt: dbs.notifications.createdAt }).from(dbs.notifications).where(and(eq(dbs.notifications.businessId, businessId), eq(dbs.notifications.userId, context.principal.userId))).orderBy(desc(dbs.notifications.acknowledgedAt), desc(dbs.notifications.createdAt)).limit(20) : Promise.resolve([]),
    ]);
    return { asOf: asOf.toISOString(), counters: { unreadConversations: unread[0]?.value ?? 0, unresolvedHandoffs: handoffs[0]?.value ?? 0, failedRuns: failed[0]?.value ?? 0, urgentIssues: urgent[0]?.value ?? 0 }, performance, notifications: notifications.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null })), recent: recent.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })), runs: runs.map((row) => ({ ...row, startedAt: row.startedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null })), attention: attention.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })) };
  }

  async acknowledgeNotification(context: TrustedBusinessContext, notificationId: string) {
    if (context.principal.kind !== "user" || !context.capabilityGrants.includes("notification.manage")) throw new Error("FORBIDDEN");
    const now = this.now();
    const row = (await this.db.update(dbs.notifications).set({ acknowledgedAt: now, updatedAt: now }).where(and(eq(dbs.notifications.id, notificationId), eq(dbs.notifications.businessId, context.businessId), eq(dbs.notifications.userId, context.principal.userId), isNull(dbs.notifications.acknowledgedAt))).returning({ acknowledgedAt: dbs.notifications.acknowledgedAt }))[0];
    if (row?.acknowledgedAt) return row.acknowledgedAt.toISOString();
    const existing = (await this.db.select({ acknowledgedAt: dbs.notifications.acknowledgedAt }).from(dbs.notifications).where(and(eq(dbs.notifications.id, notificationId), eq(dbs.notifications.businessId, context.businessId), eq(dbs.notifications.userId, context.principal.userId))).limit(1))[0];
    if (!existing) throw new Error("NOTIFICATION_NOT_FOUND");
    return existing.acknowledgedAt?.toISOString() ?? now.toISOString();
  }

  private async performance(businessId: string, monthStart: Date) {
    type Row = { inboundConversations: number; aiFirstResponses: number; customersHelped: number; medianFirstResponseMs: number | null };
    const aggregate = await this.db.execute<Row>(sql`WITH inbound AS (
      SELECT c.id AS conversation_id, c.customer_id, MIN(m.occurred_at) AS first_inbound_at
      FROM messages m INNER JOIN conversations c ON c.id = m.conversation_id AND c.business_id = m.business_id
      WHERE m.business_id = ${businessId} AND c.is_test = false AND m.sender_kind = 'CUSTOMER' AND m.occurred_at >= ${monthStart}
      GROUP BY c.id, c.customer_id
    ), first_response AS (
      SELECT i.conversation_id, i.customer_id, i.first_inbound_at, r.sender_kind, r.occurred_at AS response_at
      FROM inbound i LEFT JOIN LATERAL (
        SELECT outgoing.sender_kind, outgoing.occurred_at
        FROM messages outgoing
        WHERE outgoing.business_id = ${businessId} AND outgoing.conversation_id = i.conversation_id
          AND outgoing.sender_kind IN ('AGENT', 'HUMAN') AND outgoing.occurred_at > i.first_inbound_at
          AND (outgoing.external_message_id IS NOT NULL OR outgoing.lifecycle->>'status' = 'SENT')
        ORDER BY outgoing.occurred_at, outgoing.id LIMIT 1
      ) r ON true
    )
    SELECT COUNT(*)::int AS "inboundConversations",
      COUNT(*) FILTER (WHERE sender_kind = 'AGENT')::int AS "aiFirstResponses",
      COUNT(DISTINCT customer_id) FILTER (WHERE response_at IS NOT NULL)::int AS "customersHelped",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (response_at - first_inbound_at)) * 1000)
        FILTER (WHERE response_at IS NOT NULL) AS "medianFirstResponseMs"
    FROM first_response`);
    const row = aggregate.rows[0] ?? { inboundConversations: 0, aiFirstResponses: 0, customersHelped: 0, medianFirstResponseMs: null };
    const handoffs = await this.db.select({ value: sql<number>`COUNT(DISTINCT ${dbs.handoffs.conversationId})::int` }).from(dbs.handoffs)
      .innerJoin(dbs.conversations, and(eq(dbs.conversations.id, dbs.handoffs.conversationId), eq(dbs.conversations.businessId, businessId)))
      .where(and(eq(dbs.handoffs.businessId, businessId), eq(dbs.conversations.isTest, false), gte(dbs.handoffs.createdAt, monthStart)));
    const rate = (value: number) => row.inboundConversations === 0 ? null : Math.round(value / row.inboundConversations * 1000) / 10;
    return { windowDays: 30 as const, inboundConversations: row.inboundConversations, aiFirstResponseRate: rate(row.aiFirstResponses), handoffRate: rate(handoffs[0]?.value ?? 0), customersHelped: row.customersHelped, medianFirstResponseMs: row.medianFirstResponseMs === null ? null : Math.round(Number(row.medianFirstResponseMs)) };
  }
}
