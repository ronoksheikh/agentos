import { describe, expect, it } from "bun:test";
import { ulid } from "ulid";
import { AgentVersionService, AGENT_EVALUATION_SUITE_VERSION, agentEvaluationCases, assertEvaluationAllowsPublish, runAgentEvaluation, type AgentEvaluationCase, type AgentEvaluationRun, type AgentVersion, type EvaluationResultRepository } from "@agentos/agents";
import { AgentRuntime, AgentRuntimeEvaluationAdapter } from "@agentos/agent-runtime";
import { DeferredChannelActionExecutor } from "@agentos/actions";
import { LayeredContextEngine } from "@agentos/context";
import { InMemoryActionRepository, InMemoryAgentVersionRepository, InMemoryTraceRepository } from "@agentos/persistence";
import { InMemoryRealtimeBus } from "@agentos/realtime";
import { ToolRegistry } from "@agentos/tools";
import { createAgentFixture } from "./helpers";

function fakeResults(): EvaluationResultRepository & { runs: AgentEvaluationRun[] } {
  const runs: AgentEvaluationRun[] = [];
  return { runs, async latestForVersion(businessId, versionId) { return runs.filter((run) => run.businessId === businessId && run.agentVersionId === versionId).at(-1) ?? null; }, async save(run) { runs.push(structuredClone(run)); } };
}

function runtimeFactory(sideEffects: { count: number; fixtureInputs: string[] }) {
  return (version: AgentVersion, scenario: AgentEvaluationCase) => {
    const versions = new InMemoryAgentVersionRepository(); versions.seed({ id: version.agentId, businessId: version.businessId, name: version.config.name, activeVersionId: version.id, createdAt: version.createdAt, updatedAt: version.createdAt }, [version]);
    const models = { async generate(input: { context: { items: Array<{ layer: string; content: string }> } }) {
      const eventContent = input.context.items.find((item) => item.layer === "current_event")?.content;
      if (eventContent) sideEffects.fixtureInputs.push(eventContent);
      if (scenario.expectedStatus === "FAILED") return { kind: "error" as const, provider: "fake", model: "evaluation", latencyMs: 0, error: { code: "TIMEOUT" as const, message: "Model response unavailable", retryable: true } };
      const actions = scenario.expectedActions.filter((type) => type === "SendMessage" || type === "RequestHuman").map((type) => type === "SendMessage"
        ? { id: ulid(), schemaVersion: "1.0" as const, type, idempotencyKey: `eval:${scenario.id}`, text: "A safe test response." }
        : { id: ulid(), schemaVersion: "1.0" as const, type, idempotencyKey: `eval:${scenario.id}`, reason: "Evaluation handoff", priority: "NORMAL" as const });
      return { kind: "actions" as const, provider: "fake", model: "evaluation", latencyMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, actions };
    } };
    return new AgentRuntime({
      versions: new AgentVersionService(versions),
      contextEngine: new LayeredContextEngine({ async load() { return {}; } }),
      models,
      tools: new ToolRegistry(),
      actions: new DeferredChannelActionExecutor(new InMemoryActionRepository(), { async apply() { sideEffects.count++; } }),
      traces: new InMemoryTraceRepository(), realtime: new InMemoryRealtimeBus(), presence: { async transition() {} },
    });
  };
}

describe("Phase 7 published-agent evaluations", () => {
  it("covers the required scenarios and retains only safe action/status metadata", async () => {
    const { version } = createAgentFixture(); const results = fakeResults();
    const run = await runAgentEvaluation({ version, results, now: () => new Date("2026-09-28T00:00:00.000Z"), async execute(_version, scenario) {
      return scenario.expectedStatus === "FAILED"
        ? { status: "FAILED", actionTypes: [], safeFailureCode: "MODEL_TIMEOUT" }
        : { status: "COMPLETED", actionTypes: [...scenario.expectedActions] };
    } });
    expect(agentEvaluationCases.map((scenario) => scenario.id)).toHaveLength(15);
    expect(run.status).toBe("PASSED"); expect(run.failedCases).toBe(0); expect(results.runs).toHaveLength(1);
    const stored = JSON.stringify(results.runs[0]);
    expect(stored).not.toContain("How much does the blue backpack cost?");
    expect(stored).not.toContain("instructions");
    assertEvaluationAllowsPublish(run, version);
  });

  it("records failed checks and blocks a run with unsafe actions", async () => {
    const { version } = createAgentFixture(); const results = fakeResults();
    const run = await runAgentEvaluation({ version, results, async execute(_version, scenario) {
      return { status: "COMPLETED", actionTypes: scenario.id === "price-question" ? ["CreateOrder"] : [...scenario.expectedActions] };
    } });
    expect(run.status).toBe("FAILED");
    expect(run.caseResults.find((row) => row.caseId === "price-question")?.failedChecks).toContain("EXPECTED_ACTION_MISSING");
    expect(run.caseResults.find((row) => row.caseId === "price-question")?.failedChecks).toContain("FORBIDDEN_ACTION_PRESENT");
    expect(() => assertEvaluationAllowsPublish(run, version)).toThrow("CURRENT_EVALUATION_REQUIRED");
  });

  it("compares repeated results and identifies regressions by case", async () => {
    const { version } = createAgentFixture(); const results = fakeResults();
    await runAgentEvaluation({ version, results, async execute(_version, scenario) { return scenario.expectedStatus === "FAILED" ? { status: "FAILED", actionTypes: [], safeFailureCode: "MODEL_TIMEOUT" } : { status: "COMPLETED", actionTypes: [...scenario.expectedActions] }; } });
    const changed = await runAgentEvaluation({ version, results, async execute(_version, scenario) { return scenario.id === "handoff" ? { status: "COMPLETED", actionTypes: ["SendMessage"] } : scenario.expectedStatus === "FAILED" ? { status: "FAILED", actionTypes: [], safeFailureCode: "MODEL_TIMEOUT" } : { status: "COMPLETED", actionTypes: [...scenario.expectedActions] }; } });
    expect(changed.regressions).toEqual(["handoff"]); expect(changed.status).toBe("FAILED");
    expect(results.runs[0]?.suiteVersion).toBe(AGENT_EVALUATION_SUITE_VERSION);
  });

  it("runs every fixture through AgentRuntime with deterministic provider responses and no external effects", async () => {
    const { version: published } = createAgentFixture(); const version = { ...published, state: "DRAFT" as const, publishedAt: null };
    const results = fakeResults(); const sideEffects = { count: 0, fixtureInputs: [] as string[] }; const adapter = new AgentRuntimeEvaluationAdapter(runtimeFactory(sideEffects));
    const run = await runAgentEvaluation({ version, results, execute: (candidate, scenario) => adapter.execute(candidate, scenario) });
    expect(run.status).toBe("PASSED"); expect(run.passedCases).toBe(agentEvaluationCases.length); expect(sideEffects.count).toBe(0);
    expect(sideEffects.fixtureInputs).toHaveLength(agentEvaluationCases.length);
    for (const scenario of agentEvaluationCases) expect(sideEffects.fixtureInputs.some((input) => input.includes(scenario.input))).toBe(true);
  });
});
