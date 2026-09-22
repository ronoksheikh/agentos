import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import type { AgentRuntime, AgentRunResult } from "@agentos/agent-runtime";
import { AgentPlaygroundService } from "@agentos/control-plane";
import { OperationalPage } from "../apps/admin/components/OperationalPage";
import { sections } from "../apps/admin/components/navigation";
import { ulid } from "ulid";

describe("phase 2 playground and Mantine UI", () => {
  test("playground creates disposable scope and invokes canonical runtime with explicit version", async () => {
    let captured: Parameters<AgentRuntime["run"]>[0] | undefined;
    const runtime = { async run(input: Parameters<AgentRuntime["run"]>[0]) { captured = input; const now = new Date().toISOString(); return { runId: ulid(), agentVersionId: input.testVersionId!, context: { businessId: input.context.businessId, agentId: input.agentId, ...(input.context.conversationId ? { conversationId: input.context.conversationId } : {}), traceId: input.context.traceId }, event: input.event, mode: "TEST", status: "COMPLETED", actions: [], usage: { inputTokens: 0, outputTokens: 0, toolCalls: 0, steps: 1, latencyMs: 1 }, timing: { startedAt: now, completedAt: now } } satisfies AgentRunResult; } } as unknown as AgentRuntime;
    const service = new AgentPlaygroundService(runtime, { userId: ulid(), sessionId: "session", accountState: "ACTIVE" }, ["run.execute", "tool.read", "tool.destructive"]);
    const conversation = service.create({ businessId: ulid(), agentId: ulid(), versionId: ulid() });
    expect(conversation.disposable).toBe(true);
    await service.send(conversation.id, { text: "Test only", fixture: "GENERIC_WEBCHAT" });
    expect(captured?.testVersionId).toBe(conversation.versionId); expect(captured?.debug).toBe(true); expect(captured?.context.source).toBe("test_harness");
    expect(captured?.context.capabilityGrants).not.toContain("tool.destructive"); expect(captured?.event.channel).toStartWith("simulation:");
  });

  test("renders the operational UI with Mantine and exposes every required route section", () => {
    const html = renderToStaticMarkup(<MantineProvider defaultColorScheme="dark"><OperationalPage section="agent-playground" /></MantineProvider>);
    expect(html).toContain("Agent Playground"); expect(html).toContain("Tenant scoped");
    expect(sections).toEqual(expect.arrayContaining(["Overview", "Businesses", "Agents", "Agent Playground", "Tools", "Customers", "Conversations", "Memories", "Runs", "Handoffs", "Integrations", "Failures & Queues", "Audit Logs", "Feature Flags", "Team", "Settings"]));
  });

  test("sign-in and theme controls are present without custom replacement primitives", async () => {
    const signIn = await readFile(new URL("../apps/admin/app/sign-in/page.tsx", import.meta.url), "utf8"); const shell = await readFile(new URL("../apps/admin/components/Shell.tsx", import.meta.url), "utf8");
    expect(signIn).toContain("@mantine/form"); expect(signIn).toContain("PasswordInput"); expect(shell).toContain("toggleColorScheme"); expect(shell).toContain("AppShell");
  });
});
