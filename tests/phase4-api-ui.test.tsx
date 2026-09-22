import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { ulid } from "ulid";
import { Phase4Api } from "../apps/api/src/phase4";
import { API_PATHS, endpointCapabilities } from "../apps/api/src";
import { KnowledgeService } from "@agentos/knowledge";
import { FakeCommerceAdapter, OrderService } from "@agentos/commerce";
import { CustomToolCatalog } from "@agentos/integrations";
import { BrowserCoordinator, FakeBrowserAdapter } from "@agentos/web";
import { AttachmentService, InMemoryObjectStorage } from "@agentos/attachments";
import { GoalService } from "@agentos/goals";
import { AuditLogService } from "@agentos/control-plane";
import { KnowledgePanel, OrdersPanel, CustomToolsPanel, AttachmentsPanel, BrowserPanel } from "../apps/admin/components/Phase4BusinessPanels";
import { ClientKnowledgeView, ClientOrdersView } from "../apps/client/components/Phase4ClientViews";
import { ids, trusted } from "./helpers";

describe("Phase 4 API and dashboard contracts", () => {
  test("authorizes tenant-scoped knowledge operations and audits writes", async () => {
    const principal = { userId: ids.user, sessionId: "session", accountState: "ACTIVE" as const };
    const audit = new AuditLogService(), knowledge = new KnowledgeService();
    const api = new Phase4Api({ authorizer: { async authorize(_principal, businessId, capability) { if (businessId !== ids.businessA) throw new Error("FORBIDDEN"); return { ...trusted(), capabilityGrants: [capability] }; } }, audit, knowledge, orders: new OrderService(new FakeCommerceAdapter()), customTools: new CustomToolCatalog({ async resolve() { return "secret"; } }), browser: new BrowserCoordinator(new FakeBrowserAdapter(), () => ({ allowedDomains: [], deniedDomains: [], timeoutMs: 1000, maxActions: 1, maxEgress: 1, allowDownloads: false, allowUploads: false })), attachments: new AttachmentService(new InMemoryObjectStorage(), { async download() { return new Uint8Array(); } }, null, null, null), goals: new GoalService() });
    const input = { type: "FAQ" as const, label: "Delivery", bytes: new TextEncoder().encode("Delivery within two days") };
    const created = await api.createKnowledge(principal, ids.businessA, input, "knowledge-create-1");
    expect((await api.createKnowledge(principal, ids.businessA, input, "knowledge-create-1")).id).toBe(created.id);
    expect(await api.searchKnowledge(principal, ids.businessA, "delivery")).toHaveLength(1);
    await expect(api.listKnowledge(principal, ids.businessB)).rejects.toThrow("FORBIDDEN");
    expect(audit.list(new Set([ids.businessA])).items.map((item) => item.action)).toContain("knowledge.created");
  });
  test("exposes typed scoped routes and safe Mantine states", () => {
    for (const key of ["knowledge", "knowledgeSource", "customTools", "orderPolicy", "orders", "order", "attachments", "browserRuns", "clientKnowledge", "clientOrders", "clientOrderPolicy", "clientAttachments"] as const) expect(endpointCapabilities[API_PATHS[key]]).toBeTruthy();
    const html = renderToStaticMarkup(<MantineProvider defaultColorScheme="dark"><KnowledgePanel sources={[{ id: ulid(), label: "FAQ", type: "FAQ", status: "FAILED", version: 2, errorCode: "PARSE_FAILED", updatedAt: "today", chunks: [] }]} /><OrdersPanel orders={[]} /><CustomToolsPanel tools={[]} /><AttachmentsPanel attachments={[]} /><BrowserPanel activities={[]} /><ClientKnowledgeView sources={[]} businessId={ids.businessA} canManage={false} /><ClientOrdersView orders={[]} businessId={ids.businessA} policy={null} canManage={false} canManagePolicy={false} filters={{}} /></MantineProvider>);
    expect(html).toContain("PARSE_FAILED"); expect(html).toContain("No matching orders"); expect(html).toContain("No attachments"); expect(html).toContain("No knowledge sources"); expect(html).not.toContain("secret");
  });
});
