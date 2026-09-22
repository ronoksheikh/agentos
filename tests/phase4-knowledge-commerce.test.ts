import { describe, expect, test } from "bun:test";
import { ulid } from "ulid";
import { KnowledgeService, createKnowledgeTools } from "@agentos/knowledge";
import { FakeCommerceAdapter, OrderService, createCommerceTools } from "@agentos/commerce";
import { DefaultToolPolicyEvaluator, ToolRegistry } from "@agentos/tools";
import { ids, trusted } from "./helpers";

describe("Phase 4 knowledge", () => {
  test("ingests, attributes, reindexes, disables and isolates sources", async () => {
    const service = new KnowledgeService(); const context = trusted();
    const source = await service.create(context, { type: "POLICY", label: "Returns", bytes: new TextEncoder().encode("Returns are accepted within thirty days") });
    expect(source.status).toBe("READY"); expect((await service.search(context, "returns thirty"))[0]).toMatchObject({ sourceId: source.id, sourceVersion: 1, label: "Returns" });
    expect(await service.search(trusted(ids.businessB), "returns")).toEqual([]);
    const replaced = await service.replace(context, source.id, new TextEncoder().encode("Returns are accepted within fourteen days"));
    expect(replaced.version).toBe(2); expect(service.versions(context, source.id)).toHaveLength(1);
    expect((await service.search(context, "fourteen"))[0]?.sourceVersion).toBe(2);
    service.setEnabled(context, source.id, false); expect(await service.search(context, "fourteen")).toEqual([]);
    service.delete(context, source.id); expect(service.list(context)).toEqual([]);
  });
  test("knowledge tools avoid volatile live facts", async () => {
    const service = new KnowledgeService(); await service.create(trusted(), { type: "FAQ", label: "FAQ", bytes: new TextEncoder().encode("Inventory is 8 and shipping is free") });
    const registry = new ToolRegistry(); createKnowledgeTools(service).forEach((tool) => registry.register(tool));
    const context = { ...trusted(), runId: ulid(), capabilityGrants: ["knowledge.read"] };
    expect((await registry.execute({ id: ulid(), name: "search_faq", arguments: { query: "shipping" } }, context, {}, new DefaultToolPolicyEvaluator())).status).toBe("COMPLETED");
    expect((await registry.execute({ id: ulid(), name: "search_faq", arguments: { query: "inventory stock" } }, context, {}, new DefaultToolPolicyEvaluator())).safeOutput).toEqual({ results: [] });
  });
});

describe("Phase 4 conversational orders", () => {
  const build = () => { const adapter = new FakeCommerceAdapter(new Map([["shirt", { id: "shirt", name: "Shirt", variants: [{ id: "L", name: "Large", stock: 10, priceMinor: 1500 }, { id: "XL", name: "Extra Large", stock: 5, priceMinor: 1700 }], currency: "BDT" }]])); const service = new OrderService(adapter); service.setPolicy(trusted(), { enabled: true, fields: [{ key: "phone", label: "Phone", required: true, maxLength: 20 }], requireVariant: true, requireConfirmation: true, paymentMethods: ["COD"], deliveryMethods: ["HOME"], pendingExpiryMinutes: 60, websiteDiscoveryEnabled: false, handoffOnAmbiguity: true }); return { adapter, service }; };
  test("collects multiple messages, changes variants and quantities, confirms and snapshots once", async () => {
    const { adapter, service } = build(); const context = trusted(); const pending = service.start(context, { channel: "web_chat", sourceMessageId: ids.message });
    await expect(service.addItem(context, pending.id, { reference: { productId: "shirt", source: "CATALOG", confirmed: true }, quantity: 1 })).rejects.toThrow("VARIANT_REQUIRED");
    await service.addItem(context, pending.id, { reference: { productId: "shirt", variantId: "XL", source: "CATALOG", confirmed: true }, quantity: 1 });
    service.removeItem(context, pending.id, { productId: "shirt", variantId: "XL", source: "CATALOG", confirmed: true });
    await service.addItem(context, pending.id, { reference: { productId: "shirt", variantId: "L", source: "CATALOG", confirmed: true }, quantity: 2 });
    const collected = service.collect(context, pending.id, { fields: { phone: "01700000000" }, paymentMethod: "COD", deliveryMethod: "HOME" });
    expect(collected.state).toBe("AWAITING_CONFIRMATION"); await expect(service.createOrder(context, pending.id, "intent")).rejects.toThrow("ORDER_NOT_CONFIRMED");
    await service.confirm(context, pending.id); const first = await service.createOrder(context, pending.id, "intent"); const second = await service.createOrder(context, pending.id, "intent");
    expect(second.duplicate).toBe(true); expect(second.order.id).toBe(first.order.id); expect(first.order.items[0]).toMatchObject({ variantName: "Large", quantity: 2, totalMinor: 3000 });
    adapter.products.get("shirt")!.variants[0]!.priceMinor = 9999; expect(service.getOrder(context, first.order.id).items[0]?.unitPriceMinor).toBe(1500);
    let sends = 0; expect((await service.notifyCustomer(context, first.order.id, async () => { sends++; throw new Error("send"); })).notificationState).toBe("FAILED");
    expect((await service.notifyCustomer(context, first.order.id, async () => { sends++; })).notificationState).toBe("SENT"); expect(sends).toBe(2); expect(service.orders.size).toBe(1);
    expect(service.searchOrders(context, { query: "Large" })).toHaveLength(1); expect(service.orderAudits(context, first.order.id).map((audit) => audit.action)).toContain("order.created");
    expect(() => service.getOrder(trusted(ids.businessB), first.order.id)).toThrow("ORDER_NOT_FOUND");
  });
  test("expiry and human takeover close automated flow", async () => { const { service } = build(); const p = service.start(trusted(), { channel: "web_chat" }); service.takeOver(trusted(), p.id); await expect(service.addItem(trusted(), p.id, { reference: { productId: "shirt", variantId: "L", source: "CATALOG", confirmed: true }, quantity: 1 })).rejects.toThrow("PENDING_ORDER_CLOSED"); service.resume(trusted(), p.id); service.cancelPending(trusted(), p.id); expect(service.pending.get(p.id)?.state).toBe("CANCELLED"); });
  test("rechecks stock and reconciles concurrent order intents for one pending order", async () => {
    const { adapter, service } = build(); const context = trusted(); const pending = service.start(context, { channel: "web_chat" });
    await service.addItem(context, pending.id, { reference: { productId: "shirt", variantId: "L", source: "CATALOG", confirmed: true }, quantity: 2 });
    service.collect(context, pending.id, { fields: { phone: "01700000000" }, paymentMethod: "COD", deliveryMethod: "HOME" });
    adapter.products.get("shirt")!.variants[0]!.stock = 1;
    await expect(service.confirm(context, pending.id)).rejects.toThrow("INSUFFICIENT_STOCK");
    adapter.products.get("shirt")!.variants[0]!.stock = 3;
    await service.confirm(context, pending.id);
    const [first, second] = await Promise.all([service.createOrder(context, pending.id, "first"), service.createOrder(context, pending.id, "second")]);
    expect(first.order.id).toBe(second.order.id); expect(service.orders.size).toBe(1); expect([first.duplicate, second.duplicate]).toEqual([false, true]);
    expect(() => service.removeItem(context, pending.id, { productId: "shirt", variantId: "L", source: "CATALOG", confirmed: true })).toThrow("PENDING_ORDER_CLOSED");
  });
  test("commerce tools obey safety and grants", async () => { const { service } = build(); const registry = new ToolRegistry(); createCommerceTools(service).forEach((tool) => registry.register(tool)); const context = { ...trusted(), runId: ulid(), capabilityGrants: ["commerce.read", "commerce.manage"] }; expect((await registry.execute({ id: ulid(), name: "search_products", arguments: { query: "shirt" } }, context, {}, new DefaultToolPolicyEvaluator())).status).toBe("COMPLETED"); expect((await registry.execute({ id: ulid(), name: "cancel_order", arguments: { orderId: ulid() } }, context, {}, new DefaultToolPolicyEvaluator())).status).toBe("REQUIRES_APPROVAL"); });
});
