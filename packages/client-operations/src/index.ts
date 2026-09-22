import type { AuthenticatedPrincipal, BusinessMembership, BusinessMembershipService } from "@agentos/auth";
import { requireBusinessCapability } from "@agentos/auth";
import { ClientRealtimeProjector, type RealtimeEnvelope } from "@agentos/realtime";
import { redactSafe, type JsonValue } from "@agentos/shared";

export interface ClientConversation { id: string; businessId: string; customerId: string; customerName: string; verifiedPhone?: string; orderIds: string[]; messageText: string; tags: string[]; channel: string; handoffState: string; occurredAt: string; unread: boolean; agentId?: string; failedRun: boolean; urgent: boolean; messages: Array<{ id: string; sender: "CUSTOMER" | "AGENT" | "HUMAN"; text: string; occurredAt: string; deliveryState: string }> }
export interface ClientActor { principal: AuthenticatedPrincipal; membership: BusinessMembership }
export class ClientActorResolver {
  constructor(private readonly memberships: BusinessMembershipService) {}
  resolve(principal: AuthenticatedPrincipal, businessId: string, capability = "business.read"): ClientActor { return { principal, membership: this.memberships.authorize(principal, businessId, capability) }; }
  businesses(principal: AuthenticatedPrincipal) { return this.memberships.listForUser(principal); }
}

export class ClientDashboardService {
  readonly conversations = new Map<string, ClientConversation>(); readonly runEvents = new Map<string, RealtimeEnvelope[]>(); private readonly replayedCounterEvents = new Set<string>();
  constructor(private readonly projector = new ClientRealtimeProjector()) {}
  private check(actor: ClientActor, businessId: string, capability = "conversation.read") { if (actor.membership.businessId !== businessId) throw new Error("FORBIDDEN"); requireBusinessCapability(actor.membership, capability); }
  search(actor: ClientActor, filter: Partial<{ query: string; phone: string; orderId: string; conversationId: string; tag: string; channel: string; handoffState: string; dateFrom: string; dateTo: string; unread: boolean; agentId: string }>, cursor?: string, limit = 50) { this.check(actor, actor.membership.businessId); let rows = [...this.conversations.values()].filter((row) => row.businessId === actor.membership.businessId); if (filter.query) { const query = filter.query.toLowerCase(); rows = rows.filter((row) => [row.customerName, row.id, row.messageText, ...row.orderIds].some((value) => value.toLowerCase().includes(query))); } if (filter.phone) rows = rows.filter((row) => row.verifiedPhone === filter.phone); if (filter.orderId) rows = rows.filter((row) => row.orderIds.includes(filter.orderId!)); if (filter.conversationId) rows = rows.filter((row) => row.id === filter.conversationId); if (filter.tag) rows = rows.filter((row) => row.tags.includes(filter.tag!)); if (filter.channel) rows = rows.filter((row) => row.channel === filter.channel); if (filter.handoffState) rows = rows.filter((row) => row.handoffState === filter.handoffState); if (filter.dateFrom) rows = rows.filter((row) => row.occurredAt >= filter.dateFrom!); if (filter.dateTo) rows = rows.filter((row) => row.occurredAt <= filter.dateTo!); if (filter.unread !== undefined) rows = rows.filter((row) => row.unread === filter.unread); if (filter.agentId) rows = rows.filter((row) => row.agentId === filter.agentId); rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)); const start = cursor ? Math.max(0, rows.findIndex((row) => row.id === cursor) + 1) : 0; const items = rows.slice(start, start + Math.min(limit, 100)).map((row) => this.safeConversation(row)); return { items, nextCursor: rows[start + items.length]?.id ?? null }; }
  detail(actor: ClientActor, conversationId: string) { const row = this.conversations.get(conversationId); if (!row || row.businessId !== actor.membership.businessId) throw new Error("CONVERSATION_NOT_FOUND"); this.check(actor, row.businessId); return this.safeConversation(row); }
  counters(actor: ClientActor) { const rows = this.search(actor, {}, undefined, 100_000).items; return { unreadConversations: rows.filter((row) => row.unread).length, unresolvedHandoffs: rows.filter((row) => !["AI_ACTIVE", "RESOLVED"].includes(row.handoffState)).length, failedRuns: rows.filter((row) => row.failedRun).length, urgentIssues: rows.filter((row) => row.urgent).length }; }
  applyCounterEvent(actor: ClientActor, event: { id: string; businessId: string }) { if (event.businessId !== actor.membership.businessId) throw new Error("FORBIDDEN"); if (this.replayedCounterEvents.has(event.id)) return false; this.replayedCounterEvents.add(event.id); return true; }
  activities(actor: ClientActor, runId: string) { this.check(actor, actor.membership.businessId, "run.read"); return this.projector.projectMany((this.runEvents.get(runId) ?? []).filter((event) => event.businessId === actor.membership.businessId)); }
  private safeConversation(row: ClientConversation): ClientConversation { return structuredClone(redactSafe(row, ["provider", "prompt", "traceId", "securityMetadata", "toolInput", "toolOutput", "credentials"]) as unknown as ClientConversation); }
}

export const CLIENT_COUNTER_LINKS = {
  unreadConversations: "/conversations?unread=true", unresolvedHandoffs: "/needs-attention?state=unresolved", failedRuns: "/agent-activity?status=failed", urgentIssues: "/needs-attention?priority=urgent",
} as const;
export type ClientSafeRecord = JsonValue;
