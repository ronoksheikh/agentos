import { describe, expect, test } from "bun:test";
import { ulid } from "ulid";
import { AgentRuntime, AgentRuntimePlaygroundAdapter } from "@agentos/agent-runtime";
import { AgentVersionService } from "@agentos/agents";
import { DeferredChannelActionExecutor } from "@agentos/actions";
import { LayeredContextEngine } from "@agentos/context";
import { FakeModelProvider } from "@agentos/models";
import { InMemoryActionRepository, InMemoryAgentVersionRepository, InMemoryMemoryRepository, InMemoryTraceRepository } from "@agentos/persistence";
import { InMemoryRealtimeBus } from "@agentos/realtime";
import { createTrustedBusinessContext } from "@agentos/shared";
import { ToolRegistry, createDemoLookupTool } from "@agentos/tools";
import { createAgentFixture, ids } from "./helpers";

const usage = { inputTokens: 8, outputTokens: 4, totalTokens: 12 };
function makeRuntime(script: ConstructorParameters<typeof FakeModelProvider>[0], observed: { context?: unknown; toolCount?: number; actionCount: number }) {
  const fixture = createAgentFixture(); const versions = new InMemoryAgentVersionRepository(); versions.seed(fixture.agent, [fixture.version]);
  const tools = new ToolRegistry(); tools.register(createDemoLookupTool({ color: "blue" }));
  const actionRepository = new InMemoryActionRepository();
  const contextEngine = new LayeredContextEngine({ async load(context) { observed.context = context; return { business: [], recent_messages: [], customer_memory: [], summary: [], pending_goals: [], pending_order: [], attachment_derivatives: [] }; } });
  const provider = new FakeModelProvider(script);
  return new AgentRuntime({
    versions: new AgentVersionService(versions), contextEngine, models: { async generate(request) { observed.toolCount = request.tools.length; return provider.generate(request); } }, tools,
    actions: new DeferredChannelActionExecutor(actionRepository, { async apply() { observed.actionCount++; } }),
    traces: new InMemoryTraceRepository(), realtime: new InMemoryRealtimeBus(), presence: { async transition() {} },
  });
}

describe("Phase 7 controlled agent playground", () => {
  test("runs a fresh scoped preview and returns draft text without applying actions", async () => {
    const observed: { context?: unknown; toolCount?: number; actionCount: number } = { actionCount: 0 };
    const messageId = ulid();
    const script = [{ kind: "actions" as const, actions: [
      { id: messageId, schemaVersion: "1.0" as const, type: "SendMessage" as const, idempotencyKey: "preview:reply", text: "A safe draft reply." },
      { id: ulid(), schemaVersion: "1.0" as const, type: "Remember" as const, idempotencyKey: "preview:remember", memoryType: "note", content: "must not persist", importance: 0.5, confidence: 0.7, sourceMessageIds: [] },
    ], usage }];
    const runtime = makeRuntime(script, observed);
    const adapter = new AgentRuntimePlaygroundAdapter(() => runtime);
    const version = createAgentFixture().version;
    const result = await adapter.execute(version, { text: "Where is my order?", fixture: "WEB_CHAT" });
    expect(result.status).toBe("COMPLETED");
    expect(result.draftMessages).toEqual(["A safe draft reply."]);
    expect(result.otherActionTypes).toEqual(["Remember"]);
    expect("actions" in result).toBe(false);
    expect(result.versionId).toBe(version.id);
    expect(observed.actionCount).toBe(0);
    expect(observed.toolCount).toBe(0);
    const context = observed.context as ReturnType<typeof createTrustedBusinessContext>;
    expect(context.businessId).toBe(ids.businessA);
    expect(context.source).toBe("test_harness");
    expect(context.conversationId).not.toBe(ids.conversation);
    expect(context.customerId).toBeUndefined();
    expect(context.capabilityGrants).toEqual([]);
    expect(context.principal).toEqual({ kind: "system", service: "playground" });
  });

  test("hides tools and fails safely if the model requests one", async () => {
    const observed: { context?: unknown; toolCount?: number; actionCount: number } = { actionCount: 0 };
    const runtime = makeRuntime([{ kind: "tool_calls", calls: [{ id: ulid(), name: "demo_lookup", arguments: { key: "color" } }], usage }], observed);
    const result = await new AgentRuntimePlaygroundAdapter(() => runtime).execute(createAgentFixture().version, { text: "Look this up", fixture: "WEB_CHAT" });
    expect(result.status).toBe("FAILED");
    expect(result.safeError?.code).toBe("DRAFT_TOOL_CALL_DENIED");
    expect(observed.actionCount).toBe(0);
    expect(observed.toolCount).toBe(0);
  });

  test("validates bounded input before creating a preview", async () => {
    const adapter = new AgentRuntimePlaygroundAdapter(() => { throw new Error("runtime must not be created"); });
    await expect(adapter.execute(createAgentFixture().version, { text: " ", fixture: "WEB_CHAT" })).rejects.toThrow();
    await expect(adapter.execute(createAgentFixture().version, { text: "hello", fixture: "UNKNOWN" as "WEB_CHAT" })).rejects.toThrow();
  });
});
