import { describe, expect, test } from "bun:test";
import { ulid } from "ulid";
import { z } from "zod";
import { DeferredChannelActionExecutor } from "@agentos/actions";
import { DefaultToolPolicyEvaluator, ToolRegistry, type AgentTool } from "@agentos/tools";
import { InMemoryActionRepository, InMemoryMemoryRepository } from "@agentos/persistence";
import { MemoryService } from "@agentos/memory";
import { InMemoryConversationStore } from "@agentos/conversations";
import { ids, trusted } from "./helpers";

describe("tools and actions", () => {
  test("validates policy and redacts unsafe tool fields", async () => {
    const registry = new ToolRegistry(); let sawBusiness = "";
    const tool: AgentTool<{ query: string; apiKey: string }, { result: string; secret: string }> = { name: "safe_search", description: "test", category: "demo", safetyClass: "READ", requiredCapabilities: ["conversation.read"], inputSchema: z.object({ query: z.string(), apiKey: z.string() }), outputSchema: z.object({ result: z.string(), secret: z.string() }), redaction: { unsafeInputKeys: ["apiKey"], unsafeOutputKeys: ["secret"] }, async execute(context) { sawBusiness = context.businessId; return { result: "ok", secret: "do-not-leak" }; } };
    registry.register(tool);
    const result = await registry.execute({ id: "call", name: "safe_search", arguments: { query: "x", apiKey: "top-secret" } }, { ...trusted(), runId: ulid() }, {}, new DefaultToolPolicyEvaluator(), ["safe_search"]);
    expect(sawBusiness).toBe(ids.businessA); expect(result.status).toBe("COMPLETED"); expect(result.safeInput).toEqual({ query: "x", apiKey: "[REDACTED]" }); expect(result.safeOutput).toEqual({ result: "ok", secret: "[REDACTED]" });
  });

  test("rejects invalid, disabled, and ungranted tools without execution", async () => {
    const registry = new ToolRegistry(); let executions = 0;
    registry.register({ name: "writer", description: "test", category: "demo", safetyClass: "WRITE", requiredCapabilities: ["missing.grant"], inputSchema: z.object({ value: z.string() }), outputSchema: z.object({ ok: z.boolean() }), redaction: { unsafeInputKeys: [], unsafeOutputKeys: [] }, async execute() { executions++; return { ok: true }; } });
    const context = { ...trusted(), runId: ulid() }; const policy = new DefaultToolPolicyEvaluator();
    expect((await registry.execute({ id: "1", name: "writer", arguments: {} }, context, {}, policy, ["writer"])).safeError?.code).toBe("INVALID_TOOL_INPUT");
    expect((await registry.execute({ id: "2", name: "writer", arguments: { value: "x" } }, context, {}, policy, [])).safeError?.code).toBe("TOOL_NOT_ALLOWED");
    expect((await registry.execute({ id: "3", name: "writer", arguments: { value: "x" } }, context, {}, policy, ["writer"])).status).toBe("DENIED"); expect(executions).toBe(0);
  });

  test("checks conversation freshness before a write tool", async () => {
    const registry = new ToolRegistry(); let executions = 0;
    registry.register({ name: "write_once", description: "test", category: "demo", safetyClass: "WRITE", requiredCapabilities: [], inputSchema: z.object({}), outputSchema: z.object({ ok: z.boolean() }), redaction: { unsafeInputKeys: [], unsafeOutputKeys: [] }, async execute() { executions++; return { ok: true }; } });
    const context = { ...trusted(), runId: ulid(), async assertConversationFresh() { throw new Error("STALE_CONVERSATION"); } };
    const result = await registry.execute({ id: "stale", name: "write_once", arguments: {} }, context, {}, new DefaultToolPolicyEvaluator());
    expect(result.status).toBe("FAILED"); expect(executions).toBe(0);
  });

  test("reserves side effects idempotently and applies internal state once", async () => {
    const memories = new MemoryService(new InMemoryMemoryRepository()); const store = new InMemoryConversationStore(memories); store.seed({ businessId: ids.businessA, conversationId: ids.conversation, messages: [], pins: [], pendingGoals: [], announcements: [] });
    const repository = new InMemoryActionRepository(); const executor = new DeferredChannelActionExecutor(repository, store); const action = { id: ulid(), schemaVersion: "1.0" as const, type: "Remember" as const, idempotencyKey: "memory:1", memoryType: "preference", content: "blue", importance: 0.8, confidence: 0.9, sourceMessageIds: [] };
    expect((await executor.execute(trusted(), ulid(), action)).status).toBe("APPLIED"); const duplicate = await executor.execute(trusted(), ulid(), { ...action, id: ulid() }); expect(duplicate.id).toBe(action.id); expect(await memories.listActive(trusted(), { customerId: ids.customer })).toHaveLength(1);
  });
});
