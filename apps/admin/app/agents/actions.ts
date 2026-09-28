"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ulid } from "ulid";
import { AgentRuntime, AgentRuntimeEvaluationAdapter } from "@agentos/agent-runtime";
import { AgentVersionService, runAgentEvaluation, type AgentEvaluationCase, type AgentVersion } from "@agentos/agents";
import { DeferredChannelActionExecutor } from "@agentos/actions";
import { LayeredContextEngine } from "@agentos/context";
import { InMemoryActionRepository, InMemoryTraceRepository } from "@agentos/persistence";
import { CircuitBreakerModelProvider, OpenAIResponsesProvider } from "@agentos/models";
import { PostgresAgentEvaluationRepository, PostgresAgentVersionRepository, PostgresRuntimeContextSource } from "@agentos/phase6";
import { InMemoryRealtimeBus } from "@agentos/realtime";
import { createTrustedBusinessContext, ulidSchema } from "@agentos/shared";
import { ToolRegistry } from "@agentos/tools";
import { agencyCapabilities, agencyRoleSchema } from "@agentos/auth";
import { agentVersions, auditLogs, businesses } from "@agentos/database";
import { database, requireAgencyPage } from "../../lib/server";

const value = (form: FormData, name: string) => String(form.get(name) ?? "");
const workflowUrl = (agentId: string, versionId: string, state: string) => `/agents/${agentId}/versions/${versionId}?workflow=${encodeURIComponent(state)}`;
const safeCode = (error: unknown) => error instanceof Error && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.message) ? error.message.toLowerCase().replaceAll("_", "-") : "operation-failed";

async function scopedActor(businessId: string, capability: string) {
  ulidSchema.parse(businessId);
  const access = await requireAgencyPage(capability);
  const grants = agencyCapabilities(agencyRoleSchema.parse(access.membership.role), access.membership.capabilities);
  if (!grants.includes("agent.manage")) throw new Error("FORBIDDEN");
  const business = (await database.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, businessId)).limit(1))[0];
  if (!business) throw new Error("BUSINESS_NOT_FOUND");
  return {
    actorId: access.session.user.id,
    trusted: createTrustedBusinessContext({ businessId, principal: { kind: "user", userId: access.session.user.id, sessionId: access.session.session.id }, source: "authenticated_request", traceId: ulid(), capabilityGrants: grants }),
  };
}

export async function createAgentDraftAction(form: FormData) {
  const agentId = value(form, "agentId"); const sourceVersionId = value(form, "sourceVersionId");
  await requireAgencyPage("agent.manage");
  const source = (await database.select({ businessId: agentVersions.businessId, agentId: agentVersions.agentId }).from(agentVersions).where(eq(agentVersions.id, sourceVersionId)).limit(1))[0];
  if (!source || source.agentId !== agentId) redirect(`/agents/${agentId}?workflow=version-not-found`);
  const { actorId, trusted } = await scopedActor(source.businessId, "agent.manage");
  let targetVersionId = ""; let result = "draft-created";
  try {
    const repository = new PostgresAgentVersionRepository(database);
    const base = await repository.getVersion(trusted, sourceVersionId);
    if (!base) throw new Error("VERSION_NOT_FOUND");
    const draft = await repository.createDraft(trusted, agentId, actorId, base.config, base.id);
    targetVersionId = draft.id;
  } catch (error) { result = safeCode(error); }
  if (targetVersionId) revalidatePath(`/agents/${agentId}`);
  redirect(targetVersionId ? workflowUrl(agentId, targetVersionId, result) : `/agents/${agentId}?workflow=${result}`);
}

export async function createAgentAction(form: FormData) {
  const businessId = value(form, "businessId"); const name = value(form, "name").trim();
  const { actorId, trusted } = await scopedActor(businessId, "agent.manage");
  let created: { agentId: string; versionId: string } | null = null; let result = "agent-created";
  try {
    const model = process.env.OPENAI_MODEL;
    if (!model) throw new Error("OPENAI_MODEL_REQUIRED");
    const config = {
      name,
      instructions: "Answer using only approved business context. Do not invent prices, availability, delivery promises, policies, or order status. Ask one clear question when key details are missing. Offer a human handoff when a customer requests one or the request needs human judgment.",
      tone: "clear and helpful",
      languages: ["en"],
      models: { primary: { provider: "openai", model }, ...(process.env.OPENAI_FALLBACK_MODEL ? { fallback: { provider: "openai", model: process.env.OPENAI_FALLBACK_MODEL } } : {}) },
      enabledTools: [],
      toolPolicy: {}, contextPolicy: {}, memoryPolicy: {}, runtimeLimits: {}, handoffPolicy: {}, responseTimingPolicy: {}, disclosurePolicy: {}, channelBehavior: {}, featureFlags: {}, browserPolicy: {}, knowledgePolicy: {},
    };
    const createdAgent = await new PostgresAgentVersionRepository(database).createAgent(trusted, actorId, name, config);
    created = { agentId: createdAgent.agentId, versionId: createdAgent.version.id };
    revalidatePath(`/businesses/${businessId}`);
  } catch (error) { result = safeCode(error); }
  redirect(created ? workflowUrl(created.agentId, created.versionId, result) : `/businesses/${businessId}?phase7=${result}#agent`);
}

export async function updateAgentDraftAction(form: FormData) {
  const versionId = value(form, "versionId"); const agentId = value(form, "agentId"); const businessId = value(form, "businessId");
  const { actorId, trusted } = await scopedActor(businessId, "agent.manage");
  let result = "draft-saved";
  try {
    const config = JSON.parse(value(form, "config"));
    const revision = Number(value(form, "revision"));
    if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("INVALID_REVISION");
    await new PostgresAgentVersionRepository(database).updateDraft(trusted, versionId, actorId, config, revision);
    revalidatePath(`/agents/${agentId}/versions/${versionId}`);
  } catch (error) { result = error instanceof SyntaxError ? "invalid-config" : safeCode(error); }
  redirect(workflowUrl(agentId, versionId, result));
}

export async function selectAgentForTestAction(form: FormData) {
  const versionId = value(form, "versionId"); const agentId = value(form, "agentId"); const businessId = value(form, "businessId");
  const { actorId, trusted } = await scopedActor(businessId, "run.execute");
  let result = "test-selected";
  try { await new PostgresAgentVersionRepository(database).selectForTest(trusted, versionId, actorId); revalidatePath(`/agents/${agentId}/versions/${versionId}`); }
  catch (error) { result = safeCode(error); }
  redirect(workflowUrl(agentId, versionId, result));
}

export async function runAgentEvaluationAction(form: FormData) {
  const versionId = value(form, "versionId"); const agentId = value(form, "agentId"); const businessId = value(form, "businessId");
  const { actorId, trusted } = await scopedActor(businessId, "run.execute");
  let result = "evaluation-completed";
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY_REQUIRED");
    const versions = new PostgresAgentVersionRepository(database); const evaluations = new PostgresAgentEvaluationRepository(database);
    const version = await versions.getVersion(trusted, versionId);
    if (!version || version.agentId !== agentId || !["DRAFT", "TEST"].includes(version.state)) throw new Error("VERSION_NOT_RUNNABLE");
    const provider = new CircuitBreakerModelProvider(new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}), ...(process.env.OPENAI_TIMEOUT_MS ? { timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS) } : {}), ...(process.env.OPENAI_FALLBACK_MODEL ? { fallbackModel: process.env.OPENAI_FALLBACK_MODEL } : {}) }));
    const adapter = new AgentRuntimeEvaluationAdapter((candidate: AgentVersion, scenario: AgentEvaluationCase) => new AgentRuntime({
      versions: new AgentVersionService(versions),
      contextEngine: new LayeredContextEngine(new PostgresRuntimeContextSource(database)),
      models: scenario.expectedStatus === "FAILED" ? { async generate() { return { kind: "error" as const, provider: "evaluation-fixture", model: "timeout-fixture", latencyMs: 0, error: { code: "UNAVAILABLE" as const, message: "Injected model timeout fixture", retryable: false } }; } } : provider,
      tools: new ToolRegistry(),
      actions: new DeferredChannelActionExecutor(new InMemoryActionRepository(), { async apply() {} }),
      traces: new InMemoryTraceRepository(),
      realtime: new InMemoryRealtimeBus(),
      presence: { async transition() {} },
    }));
    const run = await runAgentEvaluation({ version, results: evaluations, execute: (candidate, scenario) => adapter.execute(candidate, scenario) });
    await database.insert(auditLogs).values({ id: ulid(), businessId, actorId, action: "agent.version.evaluated", targetType: "agent_version", targetId: versionId, safeMetadata: { runId: run.id, revision: run.versionRevision ?? 1, suiteVersion: run.suiteVersion, status: run.status, passedCases: run.passedCases, failedCases: run.failedCases } });
    revalidatePath(`/agents/${agentId}/versions/${versionId}`);
    result = run.status === "PASSED" ? "evaluation-passed" : "evaluation-failed";
  } catch (error) { result = safeCode(error); }
  redirect(workflowUrl(agentId, versionId, result));
}

export async function publishAgentVersionAction(form: FormData) {
  const versionId = value(form, "versionId"); const agentId = value(form, "agentId"); const businessId = value(form, "businessId");
  const { actorId, trusted } = await scopedActor(businessId, "agent.manage");
  let result = "published";
  try { await new AgentVersionService(new PostgresAgentVersionRepository(database), new PostgresAgentEvaluationRepository(database)).publish(trusted, agentId, versionId, actorId); revalidatePath(`/agents/${agentId}`); revalidatePath(`/agents/${agentId}/versions/${versionId}`); }
  catch (error) { result = safeCode(error); }
  redirect(workflowUrl(agentId, versionId, result));
}

export async function rollbackAgentVersionAction(form: FormData) {
  const versionId = value(form, "versionId"); const agentId = value(form, "agentId"); const businessId = value(form, "businessId");
  const { actorId, trusted } = await scopedActor(businessId, "agent.manage");
  let result = "rolled-back";
  try { await new AgentVersionService(new PostgresAgentVersionRepository(database), new PostgresAgentEvaluationRepository(database)).rollback(trusted, agentId, versionId, actorId); revalidatePath(`/agents/${agentId}`); revalidatePath(`/agents/${agentId}/versions/${versionId}`); }
  catch (error) { result = safeCode(error); }
  redirect(workflowUrl(agentId, versionId, result));
}

export async function archiveAgentVersionAction(form: FormData) {
  const versionId = value(form, "versionId"); const agentId = value(form, "agentId"); const businessId = value(form, "businessId");
  const { actorId, trusted } = await scopedActor(businessId, "agent.manage");
  let result = "archived";
  try { await new PostgresAgentVersionRepository(database).archiveVersion(trusted, versionId, actorId); revalidatePath(`/agents/${agentId}`); revalidatePath(`/agents/${agentId}/versions/${versionId}`); }
  catch (error) { result = safeCode(error); }
  redirect(workflowUrl(agentId, versionId, result));
}
