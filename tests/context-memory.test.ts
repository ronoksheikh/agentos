import { describe, expect, test } from "bun:test";
import { ulid } from "ulid";
import { LayeredContextEngine } from "@agentos/context";
import { MemoryService } from "@agentos/memory";
import { InMemoryMemoryRepository } from "@agentos/persistence";
import { InMemoryConversationStore } from "@agentos/conversations";
import { createAgentFixture, event, ids, trusted } from "./helpers";

describe("context and memory", () => {
  test("builds canonical bounded context with provenance and a recent window", async () => {
    const memories = new MemoryService(new InMemoryMemoryRepository()); const store = new InMemoryConversationStore(memories);
    store.seed({ businessId: ids.businessA, conversationId: ids.conversation, customerId: ids.customer, businessInfo: "Returns accepted in 30 days", customerIdentity: "Verified customer", summary: { id: ulid(), content: "Asked about shoes" }, messages: [1, 2, 3].map((sequence) => ({ id: ulid(), text: `message ${sequence}`, occurredAt: new Date().toISOString(), sequence, traceId: ids.trace })), pins: [], pendingGoals: [], announcements: [] });
    await memories.remember(trusted(), { customerId: ids.customer, conversationId: ids.conversation, type: "preference", content: "Prefers blue", importance: 0.8, confidence: 0.9, sourceMessageIds: [], createdBy: ids.user, expiresAt: null });
    const bundle = await new LayeredContextEngine(store).build(trusted(), createAgentFixture().version, event());
    expect(bundle.items.map((item) => item.layer)).toEqual(["instructions", "business", "channel", "customer_identity", "customer_memory", "summary", "recent_messages", "recent_messages", "current_event"]);
    expect(bundle.items.filter((item) => item.layer === "recent_messages")).toHaveLength(2);
    expect(bundle.provenance.every((item) => item.reason.length > 0)).toBe(true);
  });

  test("records excluded provenance when the context budget is exhausted", async () => {
    const memories = new MemoryService(new InMemoryMemoryRepository()); const store = new InMemoryConversationStore(memories);
    store.seed({ businessId: ids.businessA, conversationId: ids.conversation, messages: [{ id: ids.message, text: "x".repeat(2_000), occurredAt: new Date().toISOString(), sequence: 1, traceId: ids.trace }], pins: [], pendingGoals: [], announcements: [] });
    const { version } = createAgentFixture({ runtimeLimits: { ...createAgentFixture().version.config.runtimeLimits, maxContextTokens: 128 } });
    const bundle = await new LayeredContextEngine(store).build(trusted(), version, event());
    expect(bundle.truncated).toBe(true); expect(bundle.provenance.some((item) => !item.included)).toBe(true); expect(bundle.estimatedTokens).toBeLessThanOrEqual(128);
  });

  test("supersedes memory and excludes expired records", async () => {
    let now = new Date("2026-01-01T00:00:00.000Z"); const repository = new InMemoryMemoryRepository(); const service = new MemoryService(repository, () => now);
    const first = await service.remember(trusted(), { customerId: ids.customer, type: "preference", content: "blue", importance: 0.5, confidence: 0.8, sourceMessageIds: [], createdBy: ids.user, expiresAt: "2026-02-01T00:00:00.000Z" });
    const replacement = await service.update(trusted(), first.id, { content: "green", importance: 0.7, confidence: 0.9 });
    expect((await repository.get(trusted(), first.id))?.supersededBy).toBe(replacement.id); expect((await service.listActive(trusted(), { customerId: ids.customer })).map((item) => item.id)).toEqual([replacement.id]);
    now = new Date("2026-03-01T00:00:00.000Z"); expect(await service.listActive(trusted(), { customerId: ids.customer })).toHaveLength(0);
  });
});
