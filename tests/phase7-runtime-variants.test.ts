import { describe, expect, test } from "bun:test";
import { ulid } from "ulid";
import { AgentRuntime } from "@agentos/agent-runtime";
import { AgentVersionService, selectRuntimeModelVariant } from "@agentos/agents";
import { DeferredChannelActionExecutor } from "@agentos/actions";
import { LayeredContextEngine } from "@agentos/context";
import { InMemoryConversationStore } from "@agentos/conversations";
import { MemoryService } from "@agentos/memory";
import { InMemoryActionRepository, InMemoryAgentVersionRepository, InMemoryMemoryRepository, InMemoryTraceRepository } from "@agentos/persistence";
import { InMemoryRealtimeBus } from "@agentos/realtime";
import { ToolRegistry } from "@agentos/tools";
import type { ModelProvider } from "@agentos/models";
import { createAgentFixture, event, ids, trusted } from "./helpers";

describe("Phase 7 runtime model variant", () => {
  test("promotes a configured same-provider fallback only for the selected run", () => {
    const { version } = createAgentFixture({ models: { primary: { provider: "openai", model: "primary-v1" }, fallback: { provider: "openai", model: "fallback-v1" } } });
    const unchanged = selectRuntimeModelVariant(version, false);
    const selected = selectRuntimeModelVariant(version, true);
    expect(unchanged.config.models.primary.model).toBe("primary-v1");
    expect(selected.config.models.primary.model).toBe("fallback-v1");
    expect(selected.config.models.fallback?.model).toBe("primary-v1");
    expect(version.config.models.primary.model).toBe("primary-v1");
    expect(selectRuntimeModelVariant(createAgentFixture().version, true).config.models.primary.model).toBe("deterministic-v1");
  });

  test("passes the selected model to the provider without changing the persisted version", async () => {
    const { agent, version } = createAgentFixture({ models: { primary: { provider: "openai", model: "primary-v1" }, fallback: { provider: "openai", model: "fallback-v1" } } });
    const versions = new InMemoryAgentVersionRepository(); versions.seed(agent, [version]);
    const memories = new MemoryService(new InMemoryMemoryRepository()); const conversations = new InMemoryConversationStore(memories);
    conversations.seed({ businessId: ids.businessA, conversationId: ids.conversation, customerId: ids.customer, messages: [], pins: [], pendingGoals: [], announcements: [] });
    let requestedModel = "";
    const models: ModelProvider = { async generate(request) { requestedModel = request.version.config.models.primary.model; return { kind: "actions", provider: "test", model: requestedModel, actions: [], usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, latencyMs: 0 }; } };
    const runtime = new AgentRuntime({
      versions: new AgentVersionService(versions), contextEngine: new LayeredContextEngine(conversations), models,
      tools: new ToolRegistry(), actions: new DeferredChannelActionExecutor(new InMemoryActionRepository(), conversations),
      traces: new InMemoryTraceRepository(), realtime: new InMemoryRealtimeBus(), presence: { async transition() {} },
      runtimeVersionSelector: async (_context, resolved) => selectRuntimeModelVariant(resolved, true),
    });
    const result = await runtime.run({ context: trusted(), event: event(), agentId: ids.agent });
    expect(result.status).toBe("COMPLETED");
    expect(requestedModel).toBe("fallback-v1");
    expect((await versions.getVersion(trusted(), version.id))?.config.models.primary.model).toBe("primary-v1");
  });

  test("rejects a selector that changes version identity or revision", async () => {
    const { agent, version } = createAgentFixture(); const versions = new InMemoryAgentVersionRepository(); versions.seed(agent, [version]);
    const memories = new MemoryService(new InMemoryMemoryRepository()); const conversations = new InMemoryConversationStore(memories);
    conversations.seed({ businessId: ids.businessA, conversationId: ids.conversation, customerId: ids.customer, messages: [], pins: [], pendingGoals: [], announcements: [] });
    const runtime = new AgentRuntime({ versions: new AgentVersionService(versions), contextEngine: new LayeredContextEngine(conversations), models: { async generate() { throw new Error("must not reach model"); } }, tools: new ToolRegistry(), actions: new DeferredChannelActionExecutor(new InMemoryActionRepository(), conversations), traces: new InMemoryTraceRepository(), realtime: new InMemoryRealtimeBus(), presence: { async transition() {} }, runtimeVersionSelector: async (_context, resolved) => ({ ...resolved, id: ulid() }) });
    await expect(runtime.run({ context: trusted(), event: event(), agentId: ids.agent })).rejects.toThrow("RUNTIME_VARIANT_SCOPE_MISMATCH");
  });
});
