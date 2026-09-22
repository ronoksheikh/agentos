import { ulid } from "ulid";
import { and, eq, gt, notInArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@agentos/database";
import { orderSchema, pendingOrderSchema, type Order, type PendingOrder } from "@agentos/commerce";
import type { TrustedBusinessContext } from "@agentos/shared";

/** Durable boundary for conversational state and idempotent order creation. */
export class PostgresOrderRepository {
  constructor(private readonly db: NodePgDatabase) {}
  private requireScope(context: TrustedBusinessContext, conversationId: string) { if (context.conversationId !== conversationId) throw new Error("CONVERSATION_SCOPE_DENIED"); }
  async savePending(context: TrustedBusinessContext, unsafe: unknown): Promise<PendingOrder> {
    if (!context.capabilityGrants.includes("commerce.write")) throw new Error("FORBIDDEN");
    const pending = pendingOrderSchema.parse(unsafe); this.requireScope(context, pending.conversationId);
    if (pending.businessId !== context.businessId || pending.customerId !== (context.customerId ?? null)) throw new Error("PENDING_ORDER_SCOPE_DENIED");
    await context.conversationLease?.assertOwner();
    await this.db.transaction(async (tx) => {
      const conversation = (await tx.select({ id: schema.conversations.id, latestInboundSequence: schema.conversations.latestInboundSequence, ownership: schema.conversations.ownership }).from(schema.conversations).where(and(eq(schema.conversations.id, pending.conversationId), eq(schema.conversations.businessId, context.businessId))).limit(1).for("update"))[0];
      if (!conversation) throw new Error("CONVERSATION_NOT_FOUND");
      if (context.includedInboundSequence !== undefined && (conversation.latestInboundSequence !== context.includedInboundSequence || conversation.ownership !== "AI_ACTIVE")) throw new Error("STALE_CONVERSATION");
      const prior = (await tx.select().from(schema.pendingOrders).where(eq(schema.pendingOrders.id, pending.id)).limit(1).for("update"))[0];
      if (prior && (prior.businessId !== context.businessId || prior.conversationId !== pending.conversationId || ["CREATED", "CANCELLED", "EXPIRED"].includes(prior.state))) throw new Error("PENDING_ORDER_CLOSED");
      const values = { state: pending.state, items: pending.items, fields: pending.fields, missingFields: pending.missingFields, paymentMethod: pending.paymentMethod, deliveryMethod: pending.deliveryMethod, confirmation: pending.confirmation, sourceMessageIds: pending.sourceMessageIds, history: pending.history, expiresAt: new Date(pending.expiresAt), updatedAt: new Date(pending.updatedAt) };
      if (prior) await tx.update(schema.pendingOrders).set(values).where(and(eq(schema.pendingOrders.id, pending.id), eq(schema.pendingOrders.businessId, context.businessId)));
      else await tx.insert(schema.pendingOrders).values({ id: pending.id, businessId: context.businessId, conversationId: pending.conversationId, customerId: pending.customerId, channel: pending.channel, agentId: pending.agentId, agentVersionId: pending.agentVersionId, runId: pending.runId, ...values, createdAt: new Date(pending.createdAt) });
    });
    return pending;
  }
  async loadPending(context: TrustedBusinessContext, id: string): Promise<PendingOrder> {
    const row = (await this.db.select().from(schema.pendingOrders).where(and(eq(schema.pendingOrders.id, id), eq(schema.pendingOrders.businessId, context.businessId), ...(context.conversationId ? [eq(schema.pendingOrders.conversationId, context.conversationId)] : []))).limit(1))[0];
    if (!row) throw new Error("PENDING_ORDER_NOT_FOUND");
    return pendingOrderSchema.parse({ ...row, expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
  }
  async listPending(context: TrustedBusinessContext): Promise<PendingOrder[]> {
    const rows = await this.db.select().from(schema.pendingOrders).where(and(eq(schema.pendingOrders.businessId, context.businessId), ...(context.conversationId ? [eq(schema.pendingOrders.conversationId, context.conversationId)] : []), notInArray(schema.pendingOrders.state, ["CREATED", "CANCELLED", "EXPIRED"]), gt(schema.pendingOrders.expiresAt, new Date()))).limit(20);
    return rows.map((row) => pendingOrderSchema.parse({ ...row, expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }));
  }
  async commitOrder(context: TrustedBusinessContext, unsafe: unknown, intentKey: string): Promise<{ orderId: string; duplicate: boolean }> {
    if (!context.capabilityGrants.includes("commerce.write") || !intentKey || intentKey.length > 200) throw new Error("ORDER_WRITE_DENIED");
    const order = orderSchema.parse(unsafe); this.requireScope(context, order.conversationId);
    if (order.businessId !== context.businessId || order.status !== "CONFIRMED" || order.items.some((item) => item.currency !== order.currency) || order.items.reduce((sum, item) => sum + item.totalMinor, 0) !== order.totalMinor) throw new Error("ORDER_SNAPSHOT_INVALID");
    await context.conversationLease?.assertOwner();
    return this.db.transaction(async (tx) => {
      if (context.includedInboundSequence !== undefined) {
        const conversation = (await tx.select({ latestInboundSequence: schema.conversations.latestInboundSequence, ownership: schema.conversations.ownership }).from(schema.conversations).where(and(eq(schema.conversations.id, order.conversationId), eq(schema.conversations.businessId, context.businessId))).limit(1).for("update"))[0];
        if (!conversation || conversation.latestInboundSequence !== context.includedInboundSequence || conversation.ownership !== "AI_ACTIVE") throw new Error("STALE_CONVERSATION");
      }
      const pending = (await tx.select().from(schema.pendingOrders).where(and(eq(schema.pendingOrders.id, order.pendingOrderId), eq(schema.pendingOrders.businessId, context.businessId), eq(schema.pendingOrders.conversationId, order.conversationId))).limit(1).for("update"))[0];
      if (!pending) throw new Error("PENDING_ORDER_NOT_FOUND");
      const existing = (await tx.select({ id: schema.orders.id }).from(schema.orders).where(and(eq(schema.orders.businessId, context.businessId), eq(schema.orders.pendingOrderId, order.pendingOrderId))).limit(1))[0];
      if (existing) { await tx.insert(schema.orderIntents).values({ id: ulid(), businessId: context.businessId, conversationId: order.conversationId, pendingOrderId: order.pendingOrderId, intentKey, orderId: existing.id, status: "COMPLETED" }).onConflictDoNothing(); return { orderId: existing.id, duplicate: true }; }
      if (pending.state !== "CONFIRMED" || pending.missingFields.length || !["GIVEN", "NOT_REQUIRED"].includes(pending.confirmation) || pending.expiresAt <= new Date()) throw new Error("ORDER_NOT_CONFIRMED");
      const pendingItems = pendingOrderSchema.shape.items.parse(pending.items);
      if (order.customerId !== pending.customerId || order.sourceChannel !== pending.channel || order.paymentMethod !== pending.paymentMethod || order.deliveryMethod !== pending.deliveryMethod || order.confirmation !== pending.confirmation || JSON.stringify(order.fields) !== JSON.stringify(pending.fields) || order.items.length !== pendingItems.length || order.items.some((item) => !pendingItems.some((candidate) => candidate.reference.productId === item.reference.productId && candidate.reference.variantId === item.reference.variantId && candidate.quantity === item.quantity))) throw new Error("ORDER_SNAPSHOT_MISMATCH");
      const inserted = await tx.insert(schema.orders).values({ id: order.id, businessId: context.businessId, number: order.number, conversationId: order.conversationId, customerId: order.customerId, pendingOrderId: order.pendingOrderId, sourceChannel: order.sourceChannel, sourceMessageIds: order.sourceMessageIds, agentId: order.agentId, agentVersionId: order.agentVersionId, runId: order.runId, origin: order.origin, fields: order.fields, paymentMethod: order.paymentMethod, deliveryMethod: order.deliveryMethod, confirmation: order.confirmation, status: order.status, totalMinor: order.totalMinor, currency: order.currency, notificationState: order.notificationState, createdAt: new Date(order.createdAt), updatedAt: new Date(order.updatedAt) }).onConflictDoNothing({ target: [schema.orders.businessId, schema.orders.pendingOrderId] }).returning({ id: schema.orders.id });
      if (!inserted.length) { const resolved = (await tx.select({ id: schema.orders.id }).from(schema.orders).where(and(eq(schema.orders.businessId, context.businessId), eq(schema.orders.pendingOrderId, order.pendingOrderId))).limit(1))[0]; if (!resolved) throw new Error("ORDER_RECONCILE_FAILED"); await tx.insert(schema.orderIntents).values({ id: ulid(), businessId: context.businessId, conversationId: order.conversationId, pendingOrderId: order.pendingOrderId, intentKey, orderId: resolved.id, status: "COMPLETED" }).onConflictDoNothing(); return { orderId: resolved.id, duplicate: true }; }
      await tx.insert(schema.orderItems).values(order.items.map((item) => ({ id: item.id, businessId: context.businessId, orderId: order.id, productId: item.reference.productId, variantId: item.reference.variantId ?? null, canonicalUrl: item.reference.canonicalUrl ?? null, productName: item.productName, variantName: item.variantName, sku: item.sku, quantity: item.quantity, unitPriceMinor: item.unitPriceMinor, discountMinor: item.discountMinor, totalMinor: item.totalMinor, currency: item.currency })));
      await tx.insert(schema.orderIntents).values({ id: ulid(), businessId: context.businessId, conversationId: order.conversationId, pendingOrderId: order.pendingOrderId, intentKey, orderId: order.id, status: "COMPLETED" });
      await tx.update(schema.pendingOrders).set({ state: "CREATED", updatedAt: new Date() }).where(and(eq(schema.pendingOrders.id, order.pendingOrderId), eq(schema.pendingOrders.businessId, context.businessId)));
      await tx.insert(schema.orderAudits).values({ id: ulid(), businessId: context.businessId, orderId: order.id, actorId: context.principal.kind === "user" ? context.principal.userId : context.principal.kind, action: "order.created", safeMetadata: { pendingOrderId: order.pendingOrderId, itemCount: order.items.length } });
      return { orderId: order.id, duplicate: false };
    });
  }
  async setNotificationState(context: TrustedBusinessContext, id: string, state: "SENT" | "FAILED") {
    if (!context.capabilityGrants.includes("commerce.write")) throw new Error("FORBIDDEN");
    const updated = await this.db.update(schema.orders).set({ notificationState: state, updatedAt: new Date() }).where(and(eq(schema.orders.id, id), eq(schema.orders.businessId, context.businessId), eq(schema.orders.conversationId, context.conversationId ?? ""), eq(schema.orders.notificationState, "PENDING"))).returning({ id: schema.orders.id });
    if (!updated.length && state === "SENT") {
      const retried = await this.db.update(schema.orders).set({ notificationState: "SENT", updatedAt: new Date() }).where(and(eq(schema.orders.id, id), eq(schema.orders.businessId, context.businessId), eq(schema.orders.conversationId, context.conversationId ?? ""), eq(schema.orders.notificationState, "FAILED"))).returning({ id: schema.orders.id });
      if (!retried.length) throw new Error("ORDER_NOTIFICATION_NOT_PENDING");
    } else if (!updated.length) throw new Error("ORDER_NOTIFICATION_NOT_PENDING");
    return state;
  }
}
