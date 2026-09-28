import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { agentRuns, agentSteps, agents, businesses, browserRuns, toolCalls } from "@agentos/database";

const tokenValue = (field: string) => sql<number>`coalesce(nullif(${agentRuns.usage}->>${field}, '')::bigint, 0)`;

/** Business-scoped source query for the agency Usage page; values are counts, never inferred currency. */
export async function readAgencyUsage(database: NodePgDatabase, since: Date) {
  const [totals, modelRows, runRows, toolRows, browserRows] = await Promise.all([
    database.select({ runs: sql<number>`count(*)::int`, inputTokens: sql<number>`coalesce(sum(${tokenValue("inputTokens")}), 0)::bigint`, outputTokens: sql<number>`coalesce(sum(${tokenValue("outputTokens")}), 0)::bigint`, toolCalls: sql<number>`coalesce(sum(${tokenValue("toolCalls")}), 0)::bigint` })
      .from(agentRuns).where(gte(agentRuns.startedAt, since)),
    database.select({ business: businesses.name, agent: agents.name, provider: sql<string>`coalesce(${agentSteps.safeFacts}->>'provider', 'unknown')`, model: sql<string>`coalesce(${agentSteps.safeFacts}->>'model', 'unknown')`, requests: sql<number>`count(*)::int`, inputTokens: sql<number>`coalesce(sum(nullif(${agentSteps.safeFacts}->'usage'->>'inputTokens', '')::bigint), 0)::bigint`, outputTokens: sql<number>`coalesce(sum(nullif(${agentSteps.safeFacts}->'usage'->>'outputTokens', '')::bigint), 0)::bigint` })
      .from(agentSteps).innerJoin(agentRuns, and(eq(agentSteps.businessId, agentRuns.businessId), eq(agentSteps.runId, agentRuns.id))).innerJoin(agents, and(eq(agentRuns.businessId, agents.businessId), eq(agentRuns.agentId, agents.id))).innerJoin(businesses, eq(agentRuns.businessId, businesses.id))
      .where(and(gte(agentSteps.occurredAt, since), eq(agentSteps.kind, "MODEL"), eq(agentSteps.status, "COMPLETED")))
      .groupBy(businesses.name, agents.name, sql`${agentSteps.safeFacts}->>'provider'`, sql`${agentSteps.safeFacts}->>'model'`).orderBy(desc(sql`sum(coalesce(nullif(${agentSteps.safeFacts}->'usage'->>'inputTokens', '')::bigint, 0)) + sum(coalesce(nullif(${agentSteps.safeFacts}->'usage'->>'outputTokens', '')::bigint, 0))`)).limit(50),
    database.select({ runId: agentRuns.id, business: businesses.name, agent: agents.name, status: agentRuns.status, startedAt: agentRuns.startedAt, inputTokens: tokenValue("inputTokens"), outputTokens: tokenValue("outputTokens"), toolCalls: tokenValue("toolCalls") })
      .from(agentRuns).innerJoin(agents, and(eq(agentRuns.businessId, agents.businessId), eq(agentRuns.agentId, agents.id))).innerJoin(businesses, eq(agentRuns.businessId, businesses.id)).where(gte(agentRuns.startedAt, since)).orderBy(desc(agentRuns.startedAt)).limit(50),
    database.select({ business: businesses.name, agent: agents.name, tool: toolCalls.toolName, calls: sql<number>`count(*)::int`, failures: sql<number>`count(*) filter (where ${toolCalls.status} = 'FAILED')::int` })
      .from(toolCalls).innerJoin(agentRuns, and(eq(toolCalls.businessId, agentRuns.businessId), eq(toolCalls.runId, agentRuns.id))).innerJoin(agents, and(eq(agentRuns.businessId, agents.businessId), eq(agentRuns.agentId, agents.id))).innerJoin(businesses, eq(agentRuns.businessId, businesses.id)).where(gte(toolCalls.occurredAt, since)).groupBy(businesses.name, agents.name, toolCalls.toolName).orderBy(desc(sql`count(*)`)).limit(30),
    database.select({ business: businesses.name, agent: agents.name, action: browserRuns.action, runs: sql<number>`count(*)::int`, failures: sql<number>`count(*) filter (where ${browserRuns.status} = 'FAILED')::int` })
      .from(browserRuns).innerJoin(agentRuns, and(eq(browserRuns.businessId, agentRuns.businessId), eq(browserRuns.runId, agentRuns.id))).innerJoin(agents, and(eq(agentRuns.businessId, agents.businessId), eq(agentRuns.agentId, agents.id))).innerJoin(businesses, eq(agentRuns.businessId, businesses.id)).where(gte(browserRuns.occurredAt, since)).groupBy(businesses.name, agents.name, browserRuns.action).orderBy(desc(sql`count(*)`)).limit(30),
  ]);
  return { totals: totals[0] ?? { runs: 0, inputTokens: 0, outputTokens: 0, toolCalls: 0 }, modelRows, runRows, toolRows, browserRows };
}
