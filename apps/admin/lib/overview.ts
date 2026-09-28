import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { agentRuns, businesses, conversations, handoffs } from "@agentos/database";

/** Agency-wide operational counts sourced from persisted rows, excluding test conversations. */
export async function readAgencyOverview(database: NodePgDatabase, now = new Date()) {
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  const [businessCount, unread, openHandoffs, failedRuns] = await Promise.all([
    database.select({ value: sql<number>`count(*)::int` }).from(businesses),
    database.select({ value: sql<number>`count(*)::int` }).from(conversations).where(and(eq(conversations.unread, true), eq(conversations.isTest, false))),
    database.select({ value: sql<number>`count(*)::int` }).from(handoffs).innerJoin(conversations, and(eq(handoffs.businessId, conversations.businessId), eq(handoffs.conversationId, conversations.id))).where(and(inArray(handoffs.state, ["HANDOFF_REQUESTED", "HUMAN_ACTIVE", "PAUSED"]), eq(conversations.isTest, false))),
    database.select({ value: sql<number>`count(*)::int` }).from(agentRuns).where(and(eq(agentRuns.status, "FAILED"), gte(agentRuns.startedAt, weekStart))),
  ]);
  return { asOf: now.toISOString(), windowStart: weekStart.toISOString(), businesses: businessCount[0]?.value ?? 0, unread: unread[0]?.value ?? 0, handoffs: openHandoffs[0]?.value ?? 0, failedRuns: failedRuns[0]?.value ?? 0 };
}
