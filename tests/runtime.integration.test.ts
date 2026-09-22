import { describe, expect, test } from "bun:test";
import { ulid } from "ulid";
import { AgentRuntime } from "@agentos/agent-runtime";
import { AgentVersionService } from "@agentos/agents";
import { DeferredChannelActionExecutor } from "@agentos/actions";
import { LayeredContextEngine } from "@agentos/context";
import { InMemoryConversationStore } from "@agentos/conversations";
import { MemoryService } from "@agentos/memory";
import { FakeModelProvider } from "@agentos/models";
import { InMemoryActionRepository, InMemoryAgentVersionRepository, InMemoryMemoryRepository, InMemoryTraceRepository } from "@agentos/persistence";
import { InMemoryRealtimeBus } from "@agentos/realtime";
import { ToolRegistry, createDemoLookupTool } from "@agentos/tools";
import { createAgentFixture, event, ids, trusted } from "./helpers";
import { createTestRunHandler, WS_PATH } from "../apps/api/src";

function harness(script: ConstructorParameters<typeof FakeModelProvider>[0], overrides: Parameters<typeof createAgentFixture>[0] = {}) {
  const agentRepository = new InMemoryAgentVersionRepository(); const fixture = createAgentFixture(overrides); agentRepository.seed(fixture.agent, [fixture.version]);
  const memoryRepository = new InMemoryMemoryRepository(); const memories = new MemoryService(memoryRepository); const conversations = new InMemoryConversationStore(memories);
  conversations.seed({ businessId: ids.businessA, conversationId: ids.conversation, customerId: ids.customer, messages: [{ id: ids.message, text: "Hello", occurredAt: new Date().toISOString(), sequence: 1, traceId: ids.trace }], pins: [], pendingGoals: [], announcements: [] });
  const tools = new ToolRegistry(); tools.register(createDemoLookupTool({ color: "blue" })); const traces = new InMemoryTraceRepository(); const realtime = new InMemoryRealtimeBus(); const actionRepository = new InMemoryActionRepository(); const states: string[] = [];
  const runtime = new AgentRuntime({ versions: new AgentVersionService(agentRepository), contextEngine: new LayeredContextEngine(conversations), models: new FakeModelProvider(script), tools, actions: new DeferredChannelActionExecutor(actionRepository, conversations), traces, realtime, presence: { async transition(_context, _channel, state) { states.push(state); } } });
  return { runtime, traces, realtime, actions: actionRepository, memories, states };
}

const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };

describe("AgentRuntime", () => {
  test("runs a deterministic multi-step tool loop and persists safe facts and actions", async () => {
    const rememberId = ulid(); const sendId = ulid();
    const h = harness([
      { kind: "tool_calls", calls: [{ id: ulid(), name: "demo_lookup", arguments: { key: "color" } }], usage },
      { kind: "actions", actions: [
        { id: rememberId, schemaVersion: "1.0", type: "Remember", idempotencyKey: "remember:blue", memoryType: "preference", content: "Likes blue", importance: 0.8, confidence: 0.9, sourceMessageIds: [ids.message] },
        { id: sendId, schemaVersion: "1.0", type: "SendMessage", idempotencyKey: "send:reply", text: "Blue is available." },
      ], usage },
    ]);
    const result = await h.runtime.run({ context: trusted(), event: event(), agentId: ids.agent, debug: true });
    expect(result.status).toBe("COMPLETED"); expect(result.actions.map((action) => action.type)).toEqual(["Remember", "SendMessage"]); expect(result.debug?.context.items.some((item) => item.layer === "tool_results")).toBe(true);
    expect((await h.traces.getRun(trusted(), result.runId))?.toolCalls[0]?.safeOutput).toEqual({ value: "blue" }); expect((await h.actions.listForRun(trusted(), result.runId)).map((record) => record.status)).toEqual(["APPLIED", "DEFERRED"]); expect(await h.memories.listActive(trusted(), { customerId: ids.customer })).toHaveLength(1); expect(h.states).toEqual(["PROCESSING", "COMPOSING", "SENT"]);
    const events = await h.realtime.replay(ids.businessA); expect(events.map((item) => item.sequence)).toEqual(events.map((_item, index) => index + 1)); expect(JSON.stringify(events)).not.toContain("Likes blue");
  });

  test("records cancellation safely", async () => {
    const controller = new AbortController(); controller.abort(); const h = harness([{ kind: "actions", actions: [], usage }]); const result = await h.runtime.run({ context: trusted(ids.businessA, controller.signal), event: event(), agentId: ids.agent });
    expect(result.status).toBe("CANCELLED"); expect(result.safeError?.code).toBe("CANCELLED"); expect((await h.traces.getRun(trusted(), result.runId))?.run.status).toBe("CANCELLED");
  });

  test("enforces step, tool-call, and output limits", async () => {
    const stepLimited = harness([{ kind: "tool_calls", calls: [], usage }], { runtimeLimits: { ...createAgentFixture().version.config.runtimeLimits, maxSteps: 1 } });
    expect((await stepLimited.runtime.run({ context: trusted(), event: event(), agentId: ids.agent })).safeError?.code).toBe("STEP_LIMIT");
    const toolLimited = harness([{ kind: "tool_calls", calls: [{ id: "1", name: "demo_lookup", arguments: { key: "x" } }, { id: "2", name: "demo_lookup", arguments: { key: "x" } }], usage }], { runtimeLimits: { ...createAgentFixture().version.config.runtimeLimits, maxToolCalls: 1 } });
    expect((await toolLimited.runtime.run({ context: trusted(), event: event(), agentId: ids.agent })).safeError?.code).toBe("TOOL_LIMIT");
    const outputLimited = harness([{ kind: "actions", actions: [], usage: { inputTokens: 1, outputTokens: 500, totalTokens: 501 } }], { runtimeLimits: { ...createAgentFixture().version.config.runtimeLimits, maxOutputTokens: 10 } });
    expect((await outputLimited.runtime.run({ context: trusted(), event: event(), agentId: ids.agent })).safeError?.code).toBe("OUTPUT_LIMIT");
  });

  test("rejects cross-business runtime and repository access", async () => {
    const h = harness([{ kind: "actions", actions: [], usage }]); await expect(h.runtime.run({ context: trusted(ids.businessB), event: event(ids.businessA), agentId: ids.agent })).rejects.toThrow("TRUSTED_SCOPE_MISMATCH");
    expect(await h.traces.getRun(trusted(ids.businessB), ulid())).toBeNull();
  });

  test("runs only after server authorization and defines the websocket path", async () => {
    const h = harness([{ kind: "actions", actions: [], usage }]);
    const handler = createTestRunHandler({ async authorize(_principal, businessId, capability) { if (businessId !== ids.businessA || capability !== "run.execute") throw new Error("FORBIDDEN"); return trusted(); } }, h.runtime);
    const result = await handler({ userId: ids.user, sessionId: "s", accountState: "ACTIVE" }, { businessId: ids.businessA, agentId: ids.agent, event: event(), debug: false });
    expect(result.status).toBe("COMPLETED"); expect(WS_PATH).toBe("/ws");
    await expect(handler({ userId: ids.user, sessionId: "s", accountState: "ACTIVE" }, { businessId: ids.businessB, agentId: ids.agent, event: event(ids.businessB) })).rejects.toThrow("FORBIDDEN");
  });

  test("maps provider failures to safe typed errors without leaking provider text", async () => {
    const h = harness([{ kind: "error", error: { code: "RATE_LIMITED", message: "upstream token sk-secret", retryable: true }, usage }]);
    const result = await h.runtime.run({ context: trusted(), event: event(), agentId: ids.agent });
    expect(result.safeError).toEqual({ code: "RATE_LIMITED", message: "Run failed safely", retryable: true });
    expect(JSON.stringify(await h.realtime.replay(ids.businessA))).not.toContain("sk-secret");
  });
});
