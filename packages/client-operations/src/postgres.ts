import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as dbs from "@agentos/database";
import type { TrustedBusinessContext } from "@agentos/shared";

/** Current operational counts and a bounded business-scoped conversation list. */
export class PostgresClientDashboard {
  constructor(private readonly db: NodePgDatabase, private readonly now: () => Date = () => new Date()) {}
  async snapshot(context: TrustedBusinessContext, section: string, filter: { unread?: boolean; urgent?: boolean; failed?: boolean } = {}) {
    if (context.principal.kind !== "user" || !context.capabilityGrants.includes("conversation.read")) throw new Error("FORBIDDEN");
    const businessId = context.businessId;
    const weekStart = new Date(this.now().getTime() - 7 * 86400_000);
    const nonTest = and(eq(dbs.conversations.businessId, businessId), eq(dbs.conversations.isTest, false));
    const [unread, handoffs, failed, urgent, recent, runs, attention] = await Promise.all([
      this.db.select({ value: count() }).from(dbs.conversations).where(and(nonTest, eq(dbs.conversations.unread, true))),
      this.db.select({ value: count() }).from(dbs.handoffs).innerJoin(dbs.conversations, and(eq(dbs.conversations.id, dbs.handoffs.conversationId), eq(dbs.conversations.businessId, dbs.handoffs.businessId))).where(and(eq(dbs.handoffs.businessId, businessId), eq(dbs.conversations.isTest, false), inArray(dbs.handoffs.state, ["HANDOFF_REQUESTED", "HUMAN_ACTIVE", "PAUSED"]))),
      this.db.select({ value: count() }).from(dbs.agentRuns).where(and(eq(dbs.agentRuns.businessId, businessId), eq(dbs.agentRuns.status, "FAILED"), gte(dbs.agentRuns.startedAt, weekStart))),
      this.db.select({ value: count() }).from(dbs.conversations).where(and(nonTest, eq(dbs.conversations.urgent, true))),
      this.db.select({ id: dbs.conversations.id, customerName: dbs.customers.displayName, channel: dbs.conversations.channel, ownership: dbs.conversations.ownership, unread: dbs.conversations.unread, urgent: dbs.conversations.urgent, updatedAt: dbs.conversations.updatedAt }).from(dbs.conversations).leftJoin(dbs.customers, and(eq(dbs.customers.id, dbs.conversations.customerId), eq(dbs.customers.businessId, businessId))).where(and(nonTest, ...(section === "needs-attention" ? [inArray(dbs.conversations.ownership, ["HANDOFF_REQUESTED", "HUMAN_ACTIVE", "PAUSED"])] : []), ...(filter.unread ? [eq(dbs.conversations.unread, true)] : []), ...(filter.urgent ? [eq(dbs.conversations.urgent, true)] : []))).orderBy(desc(dbs.conversations.updatedAt), desc(dbs.conversations.id)).limit(25),
      this.db.select({ id: dbs.agentRuns.id, agentName: dbs.agents.name, status: dbs.agentRuns.status, startedAt: dbs.agentRuns.startedAt, completedAt: dbs.agentRuns.completedAt }).from(dbs.agentRuns).innerJoin(dbs.agents, and(eq(dbs.agents.id, dbs.agentRuns.agentId), eq(dbs.agents.businessId, businessId))).where(and(eq(dbs.agentRuns.businessId, businessId), ...(filter.failed ? [eq(dbs.agentRuns.status, "FAILED"), gte(dbs.agentRuns.startedAt, weekStart)] : []))).orderBy(desc(dbs.agentRuns.startedAt), desc(dbs.agentRuns.id)).limit(25),
      this.db.select({ id: dbs.handoffs.id, conversationId: dbs.handoffs.conversationId, customerName: dbs.customers.displayName, channel: dbs.conversations.channel, state: dbs.handoffs.state, priority: dbs.handoffs.priority, updatedAt: dbs.handoffs.updatedAt }).from(dbs.handoffs).innerJoin(dbs.conversations, and(eq(dbs.conversations.id, dbs.handoffs.conversationId), eq(dbs.conversations.businessId, businessId))).leftJoin(dbs.customers, and(eq(dbs.customers.id, dbs.conversations.customerId), eq(dbs.customers.businessId, businessId))).where(and(eq(dbs.handoffs.businessId, businessId), eq(dbs.conversations.isTest, false), inArray(dbs.handoffs.state, ["HANDOFF_REQUESTED", "HUMAN_ACTIVE", "PAUSED"]))).orderBy(desc(dbs.handoffs.updatedAt), desc(dbs.handoffs.id)).limit(25),
    ]);
    return { asOf: this.now().toISOString(), counters: { unreadConversations: unread[0]?.value ?? 0, unresolvedHandoffs: handoffs[0]?.value ?? 0, failedRuns: failed[0]?.value ?? 0, urgentIssues: urgent[0]?.value ?? 0 }, recent: recent.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })), runs: runs.map((row) => ({ ...row, startedAt: row.startedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null })), attention: attention.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })) };
  }
}
