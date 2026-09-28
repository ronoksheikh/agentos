import { ulidSchema } from "@agentos/shared";
import { ulid } from "ulid";
import { z } from "zod";
import type { AgentVersion } from "./index";

export const AGENT_EVALUATION_SUITE_VERSION = "phase7-v1";
const evaluationOutcomeType = z.enum(["SendMessage", "SendImage", "SendFile", "SendProduct", "ReplyToMessage", "ReplyToComment", "ReactToMessage", "RequestHuman", "Remember", "UpdateMemory", "PinMessage", "UnpinMessage", "MarkPendingAction", "ResolvePendingAction", "CreateOrder", "HideComment", "DeleteComment", "KeepCommentForReview"]);
type EvaluationOutcomeType = z.infer<typeof evaluationOutcomeType>;

export interface AgentEvaluationCase {
  id: string;
  category: string;
  input: string;
  expectedActions: readonly EvaluationOutcomeType[];
  forbiddenActions: readonly EvaluationOutcomeType[];
  expectedStatus?: "COMPLETED" | "FAILED" | "CANCELLED";
  maxActions: number;
}

/** Fixture text is test-only input. It is never copied into a persisted result. */
export const agentEvaluationCases: readonly AgentEvaluationCase[] = [
  { id: "price-question", category: "product_question", input: "How much does the blue backpack cost?", expectedActions: ["SendMessage"], forbiddenActions: ["CreateOrder"], maxActions: 1 },
  { id: "unavailable-product", category: "availability", input: "Do you have the sold-out red backpack?", expectedActions: ["SendMessage"], forbiddenActions: ["CreateOrder"], maxActions: 1 },
  { id: "rapid-three-message-burst", category: "message_batch", input: "Hi. I need a gift. Can you help?", expectedActions: ["SendMessage"], forbiddenActions: [], maxActions: 1 },
  { id: "image-question", category: "image", input: "What is in this product photo?", expectedActions: ["SendMessage"], forbiddenActions: ["CreateOrder"], maxActions: 1 },
  { id: "voice-transcript", category: "voice", input: "Transcript: I would like to know your store hours.", expectedActions: ["SendMessage"], forbiddenActions: [], maxActions: 1 },
  { id: "return-refund", category: "returns", input: "I want to return my purchase. What is the process?", expectedActions: ["SendMessage"], forbiddenActions: ["CreateOrder"], maxActions: 1 },
  { id: "angry-customer", category: "complaint", input: "This is the third time my order is late. This is unacceptable.", expectedActions: ["RequestHuman"], forbiddenActions: ["CreateOrder"], maxActions: 1 },
  { id: "ambiguous-product", category: "clarification", input: "I want the small one.", expectedActions: ["SendMessage"], forbiddenActions: ["CreateOrder"], maxActions: 1 },
  { id: "unknown-information", category: "unknown", input: "What will the weather be here next month?", expectedActions: ["SendMessage"], forbiddenActions: [], maxActions: 1 },
  { id: "browser-lookup", category: "browser", input: "Check the approved product page for the listed dimensions.", expectedActions: ["SendMessage"], forbiddenActions: ["CreateOrder"], maxActions: 1 },
  { id: "handoff", category: "handoff", input: "Please connect me to a person.", expectedActions: ["RequestHuman"], forbiddenActions: ["SendMessage"], maxActions: 1 },
  { id: "tool-provider-failure", category: "provider_failure", input: "Look up the item, but the lookup tool is unavailable.", expectedActions: ["SendMessage"], forbiddenActions: ["CreateOrder"], maxActions: 1 },
  { id: "model-timeout", category: "model_timeout", input: "A normal question while the model request times out.", expectedActions: [], forbiddenActions: ["CreateOrder", "SendMessage"], expectedStatus: "FAILED", maxActions: 0 },
  { id: "comment-review", category: "comment_moderation", input: "Is this available in another size?", expectedActions: ["SendMessage"], forbiddenActions: ["DeleteComment"], maxActions: 1 },
  { id: "comment-uncertain", category: "comment_uncertain", input: "An unclear comment with low classifier confidence.", expectedActions: ["RequestHuman"], forbiddenActions: ["DeleteComment", "HideComment"], maxActions: 1 },
] as const;

export const evaluationObservationSchema = z.object({
  status: z.enum(["COMPLETED", "FAILED", "CANCELLED"]),
  actionTypes: z.array(evaluationOutcomeType).max(50),
  safeFailureCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/).optional(),
});
export type EvaluationObservation = z.infer<typeof evaluationObservationSchema>;

export const evaluationCaseResultSchema = z.object({
  caseId: z.string(), passed: z.boolean(), observedStatus: z.enum(["COMPLETED", "FAILED", "CANCELLED"]),
  observedActionTypes: z.array(evaluationOutcomeType), safeFailureCode: z.string().optional(), failedChecks: z.array(z.enum(["STATUS", "EXPECTED_ACTION_MISSING", "FORBIDDEN_ACTION_PRESENT", "ACTION_LIMIT"])),
});
export const evaluationRunSchema = z.object({
  id: ulidSchema, businessId: ulidSchema, agentId: ulidSchema, agentVersionId: ulidSchema,
  /** The config revision that was actually exercised; legacy results without it cannot authorize publication. */
  versionRevision: z.number().int().positive().optional(),
  suiteVersion: z.string(), status: z.enum(["PASSED", "FAILED"]), passedCases: z.number().int().nonnegative(), failedCases: z.number().int().nonnegative(),
  caseResults: z.array(evaluationCaseResultSchema), regressions: z.array(z.string()), evaluatedAt: z.string().datetime(),
});
export type AgentEvaluationRun = z.infer<typeof evaluationRunSchema>;

export interface EvaluationResultRepository {
  latestForVersion(businessId: string, agentVersionId: string): Promise<AgentEvaluationRun | null>;
  save(run: AgentEvaluationRun): Promise<void>;
}

export async function runAgentEvaluation(input: {
  version: AgentVersion;
  execute: (version: AgentVersion, scenario: AgentEvaluationCase) => Promise<EvaluationObservation>;
  results: EvaluationResultRepository;
  now?: () => Date;
}) {
  const prior = await input.results.latestForVersion(input.version.businessId, input.version.id);
  const caseResults = [];
  for (const scenario of agentEvaluationCases) {
    let observation: EvaluationObservation;
    try { observation = evaluationObservationSchema.parse(await input.execute(structuredClone(input.version), scenario)); }
    catch { observation = { status: "FAILED", actionTypes: [], safeFailureCode: "EVALUATION_EXECUTION_FAILED" }; }
    const failedChecks: z.infer<typeof evaluationCaseResultSchema>["failedChecks"] = [];
    if (scenario.expectedStatus && observation.status !== scenario.expectedStatus) failedChecks.push("STATUS");
    if (!scenario.expectedStatus && observation.status !== "COMPLETED") failedChecks.push("STATUS");
    if (scenario.expectedActions.some((action) => !observation.actionTypes.includes(action))) failedChecks.push("EXPECTED_ACTION_MISSING");
    if (scenario.forbiddenActions.some((action) => observation.actionTypes.includes(action))) failedChecks.push("FORBIDDEN_ACTION_PRESENT");
    if (observation.actionTypes.length > scenario.maxActions) failedChecks.push("ACTION_LIMIT");
    caseResults.push(evaluationCaseResultSchema.parse({ caseId: scenario.id, passed: failedChecks.length === 0, observedStatus: observation.status, observedActionTypes: observation.actionTypes, ...(observation.safeFailureCode ? { safeFailureCode: observation.safeFailureCode } : {}), failedChecks }));
  }
  const priorResults = new Map(prior?.caseResults.map((row) => [row.caseId, row]) ?? []);
  const regressions = prior?.suiteVersion === AGENT_EVALUATION_SUITE_VERSION
    ? caseResults.filter((row) => priorResults.get(row.caseId)?.passed && !row.passed).map((row) => row.caseId)
    : [];
  const failedCases = caseResults.filter((row) => !row.passed).length;
  const run = evaluationRunSchema.parse({ id: ulid(), businessId: input.version.businessId, agentId: input.version.agentId, agentVersionId: input.version.id, versionRevision: input.version.revision ?? 1, suiteVersion: AGENT_EVALUATION_SUITE_VERSION, status: failedCases === 0 && regressions.length === 0 ? "PASSED" : "FAILED", passedCases: caseResults.length - failedCases, failedCases, caseResults, regressions, evaluatedAt: (input.now ?? (() => new Date()))().toISOString() });
  await input.results.save(run);
  return run;
}

export function assertEvaluationAllowsPublish(run: AgentEvaluationRun | null, version: Pick<AgentVersion, "businessId" | "agentId" | "id" | "revision">) {
  if (!run || run.businessId !== version.businessId || run.agentId !== version.agentId || run.agentVersionId !== version.id || run.versionRevision !== (version.revision ?? 1) || run.suiteVersion !== AGENT_EVALUATION_SUITE_VERSION || run.status !== "PASSED" || run.failedCases !== 0 || run.regressions.length !== 0) throw new Error("CURRENT_EVALUATION_REQUIRED");
}
