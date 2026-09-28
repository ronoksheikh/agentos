import { and, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { agentRuns, agents, businesses, browserRuns, channelConnections, conversations, handoffs, websiteSites } from "@agentos/database";

export function readAgencyRuns(database: NodePgDatabase) {
  return database.select({ id: agentRuns.id, business: businesses.name, agent: agents.name, status: agentRuns.status, startedAt: agentRuns.startedAt, completedAt: agentRuns.completedAt, inputTokens: sql<number>`coalesce(nullif(${agentRuns.usage}->>'inputTokens', '')::bigint, 0)`, outputTokens: sql<number>`coalesce(nullif(${agentRuns.usage}->>'outputTokens', '')::bigint, 0)`, toolCalls: sql<number>`coalesce(nullif(${agentRuns.usage}->>'toolCalls', '')::int, 0)`, errorCode: sql<string | null>`${agentRuns.safeError}->>'code'` })
    .from(agentRuns).innerJoin(businesses, eq(agentRuns.businessId, businesses.id)).innerJoin(agents, and(eq(agentRuns.businessId, agents.businessId), eq(agentRuns.agentId, agents.id))).orderBy(desc(agentRuns.startedAt)).limit(100);
}

export function readAgencyBrowserRuns(database: NodePgDatabase) {
  return database.select({ id: browserRuns.id, business: businesses.name, agent: agents.name, action: browserRuns.action, status: browserRuns.status, safeCode: browserRuns.safeCode, occurredAt: browserRuns.occurredAt })
    .from(browserRuns).innerJoin(agentRuns, and(eq(browserRuns.businessId, agentRuns.businessId), eq(browserRuns.runId, agentRuns.id))).innerJoin(businesses, eq(browserRuns.businessId, businesses.id)).innerJoin(agents, and(eq(agentRuns.businessId, agents.businessId), eq(agentRuns.agentId, agents.id))).orderBy(desc(browserRuns.occurredAt)).limit(100);
}

export function readAgencyHandoffs(database: NodePgDatabase) {
  return database.select({ id: handoffs.id, business: businesses.name, conversationId: handoffs.conversationId, agent: agents.name, channel: handoffs.channel, priority: handoffs.priority, state: handoffs.state, assignedTo: handoffs.assignedTo, createdAt: handoffs.createdAt, staleAt: handoffs.staleAt, resolvedAt: handoffs.resolvedAt })
    .from(handoffs).innerJoin(businesses, eq(handoffs.businessId, businesses.id)).innerJoin(conversations, and(eq(handoffs.businessId, conversations.businessId), eq(handoffs.conversationId, conversations.id))).leftJoin(agents, and(eq(conversations.businessId, agents.businessId), eq(conversations.agentId, agents.id))).orderBy(desc(handoffs.createdAt)).limit(100);
}

export async function readAgencyIntegrations(database: NodePgDatabase) {
  const [connections, sites] = await Promise.all([
    database.select({ business: businesses.name, channel: channelConnections.channel, state: channelConnections.state, paused: channelConnections.paused, lastErrorCode: channelConnections.lastErrorCode, lastWebhookAt: channelConnections.lastWebhookAt, tokenExpiresAt: channelConnections.tokenExpiresAt, capabilities: channelConnections.capabilities })
      .from(channelConnections).innerJoin(businesses, eq(channelConnections.businessId, businesses.id)).orderBy(desc(channelConnections.updatedAt)).limit(100),
    database.select({ business: businesses.name, enabled: websiteSites.enabled, originCount: sql<number>`cardinality(${websiteSites.allowedOrigins})::int`, updatedAt: websiteSites.updatedAt })
      .from(websiteSites).innerJoin(businesses, eq(websiteSites.businessId, businesses.id)).orderBy(desc(websiteSites.updatedAt)).limit(100),
  ]);
  return { connections, sites };
}
