import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ulid } from "ulid";
import { agents, channelConnections, conversations, customerIdentities, customers, messengerThreads, rawInboundEvents } from "@agentos/database";
import { InboundGateway, Phase5Store } from "@agentos/phase5";
import { createTrustedBusinessContext } from "@agentos/shared";
import { FACEBOOK_MESSENGER, FacebookMessengerAdapter, flattenMetaFeedChanges, flattenMetaNotifications, verifyMetaChallenge, verifyMetaSignature } from "./adapter";
import { MetaConnectionService } from "./connections";

export class MessengerWebhook {
  private readonly gateway: InboundGateway;
  constructor(private readonly db: NodePgDatabase, private readonly adapter: FacebookMessengerAdapter, private readonly connections: MetaConnectionService, private readonly appSecret: string, private readonly verifyToken: string) { this.gateway = new InboundGateway(new Phase5Store(db)); }
  async handshake(url: URL) {
    const challenge = verifyMetaChallenge(url, this.verifyToken);
    if (!challenge) return new Response("Forbidden", { status: 403 });
    await this.connections.recordHandshake();
    return new Response(challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  private async thread(businessId: string, connectionId: string, agentId: string, senderId: string, pending: boolean, occurredAt: Date) {
    const previous = (await this.db.select().from(messengerThreads).where(and(eq(messengerThreads.businessId, businessId), eq(messengerThreads.connectionId, connectionId), eq(messengerThreads.senderId, senderId))).limit(1))[0];
    if (previous) return previous;
    // Unique sender key and transaction make concurrent first messages converge on one tenant-owned thread.
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${connectionId}:${senderId}`}, 0))`);
      const concurrent = (await tx.select().from(messengerThreads).where(and(eq(messengerThreads.businessId, businessId), eq(messengerThreads.connectionId, connectionId), eq(messengerThreads.senderId, senderId))).limit(1))[0];
      if (concurrent) return concurrent;
      const customerId = ulid(); const conversationId = ulid();
      await tx.insert(customers).values({ id: customerId, businessId });
      await tx.insert(customerIdentities).values({ id: ulid(), businessId, customerId, channel: FACEBOOK_MESSENGER, externalId: `${connectionId}:${senderId}`, verifiedAt: occurredAt, metadata: {} });
      await tx.insert(conversations).values({ id: conversationId, businessId, customerId, agentId, channel: FACEBOOK_MESSENGER, ownership: pending ? "PAUSED" : "AI_ACTIVE" });
      const row = { id: ulid(), businessId, connectionId, senderId, customerId, conversationId, lastCustomerMessageAt: new Date(Math.min(occurredAt.getTime(), Date.now())) };
      await tx.insert(messengerThreads).values(row);
      return row;
    });
  }
  async receive(headers: Headers, body: Uint8Array) {
    // The raw bytes must be authenticated before parsing Page IDs or creating tenant records.
    if (!verifyMetaSignature(body, headers.get("x-hub-signature-256"), this.appSecret)) return new Response("Unauthorized", { status: 401 });
    let notifications: ReturnType<typeof flattenMetaNotifications>; let feedChanges: ReturnType<typeof flattenMetaFeedChanges>;
    try { notifications = flattenMetaNotifications(body); feedChanges = flattenMetaFeedChanges(body); } catch { return new Response("Malformed webhook", { status: 400 }); }
    for (const [index, { pageId, notification }] of notifications.entries()) {
      const connection = (await this.db.select().from(channelConnections).where(and(eq(channelConnections.channel, FACEBOOK_MESSENGER), eq(channelConnections.externalPageId, pageId))).limit(1))[0];
      if (!connection || !["TEST_PENDING", "CONNECTED"].includes(connection.state)) return new Response("Page unavailable", { status: 404 });
      if (notification.sender.id === pageId || notification.message?.is_echo) continue;
      const activeAgent = (await this.db.select({ activeVersionId: agents.activeVersionId }).from(agents).where(and(eq(agents.id, connection.agentId), eq(agents.businessId, connection.businessId))).limit(1))[0];
      if (!activeAgent?.activeVersionId) return new Response("Agent unavailable", { status: 503 });
      const prior = (await this.db.select().from(messengerThreads).where(and(eq(messengerThreads.businessId, connection.businessId), eq(messengerThreads.connectionId, connection.id), eq(messengerThreads.senderId, notification.sender.id))).limit(1))[0];
      if (!prior && !notification.message) continue;
      const thread = prior ?? await this.thread(connection.businessId, connection.id, connection.agentId, notification.sender.id, connection.state === "TEST_PENDING", new Date(notification.timestamp));
      if (prior && notification.message) await this.db.update(messengerThreads).set({ lastCustomerMessageAt: sql`GREATEST(${messengerThreads.lastCustomerMessageAt}, ${new Date(Math.min(notification.timestamp, Date.now()))})`, updatedAt: new Date() }).where(eq(messengerThreads.id, prior.id));
      const context = createTrustedBusinessContext({ businessId: connection.businessId, principal: { kind: "adapter", connectionId: connection.id }, source: "verified_adapter", agentId: connection.agentId, conversationId: thread.conversationId, customerId: thread.customerId, traceId: ulid(), capabilityGrants: [] });
      const internalHeaders = new Headers(headers); internalHeaders.set("x-agentos-event-index", String(index));
      try {
        // A transaction-scoped advisory lock serializes normalization's media side effects with dedupe.
        await this.db.transaction(async (tx) => {
          if (notification.message?.mid) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${connection.id}:${notification.message.mid}`}, 0))`);
          await this.gateway.accept(this.adapter, { headers: internalHeaders, body }, context);
        });
        if (connection.state === "TEST_PENDING" && notification.message?.mid) await this.connections.recordTestMessage(connection.businessId, connection.id, notification.message.mid, thread.conversationId);
        await this.db.update(channelConnections).set({ lastWebhookAt: new Date(), updatedAt: new Date() }).where(eq(channelConnections.id, connection.id));
      } catch { return new Response("Webhook receipt unavailable", { status: 503 }); }
    }
    for (const [index, change] of feedChanges.entries()) {
      const connection = (await this.db.select().from(channelConnections).where(and(eq(channelConnections.channel, FACEBOOK_MESSENGER), eq(channelConnections.externalPageId, change.pageId))).limit(1))[0];
      if (!connection || !["TEST_PENDING", "CONNECTED"].includes(connection.state)) return new Response("Page unavailable", { status: 404 });
      const activeAgent = (await this.db.select({ activeVersionId: agents.activeVersionId }).from(agents).where(and(eq(agents.id, connection.agentId), eq(agents.businessId, connection.businessId))).limit(1))[0];
      if (!activeAgent?.activeVersionId) return new Response("Agent unavailable", { status: 503 });
      const prior = (await this.db.select({ id: rawInboundEvents.id }).from(rawInboundEvents).where(and(eq(rawInboundEvents.businessId, connection.businessId), eq(rawInboundEvents.connectionId, connection.id), eq(rawInboundEvents.dedupeKey, `meta:comment:${change.commentId}:add`))).limit(1))[0];
      if (prior) continue;
      const context = createTrustedBusinessContext({ businessId: connection.businessId, principal: { kind: "adapter", connectionId: connection.id }, source: "verified_adapter", agentId: connection.agentId, traceId: ulid(), capabilityGrants: [] });
      const internalHeaders = new Headers(headers); internalHeaders.set("x-agentos-feed-index", String(index));
      try { await this.gateway.accept(this.adapter, { headers: internalHeaders, body }, context); await this.db.update(channelConnections).set({ lastWebhookAt: new Date(), updatedAt: new Date() }).where(eq(channelConnections.id, connection.id)); }
      catch { return new Response("Webhook receipt unavailable", { status: 503 }); }
    }
    return new Response("EVENT_RECEIVED", { status: 200 });
  }
}
