import { describe, expect, it } from "bun:test";
import { AGENT_EVALUATION_SUITE_VERSION, agentEvaluationCases, assertEvaluationAllowsPublish, runAgentEvaluation, type AgentEvaluationRun, type EvaluationResultRepository } from "@agentos/agents";
import { createAgentFixture } from "./helpers";

function fakeResults(): EvaluationResultRepository & { runs: AgentEvaluationRun[] } {
  const runs: AgentEvaluationRun[] = [];
  return { runs, async latestForVersion(businessId, versionId) { return runs.filter((run) => run.businessId === businessId && run.agentVersionId === versionId).at(-1) ?? null; }, async save(run) { runs.push(structuredClone(run)); } };
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
});
