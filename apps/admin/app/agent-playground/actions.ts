"use server";

import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { AgentRuntime, AgentRuntimePlaygroundAdapter, playgroundInputSchema, type PlaygroundResult } from "@agentos/agent-runtime";
import { AgentVersionService, agentVersionSchema } from "@agentos/agents";
import { DeferredChannelActionExecutor } from "@agentos/actions";
import { LayeredContextEngine } from "@agentos/context";
import { InMemoryActionRepository, InMemoryTraceRepository } from "@agentos/persistence";
import { CircuitBreakerModelProvider, OpenAIResponsesProvider } from "@agentos/models";
import { PostgresAgentVersionRepository, PostgresRuntimeContextSource } from "@agentos/phase6";
import { InMemoryRealtimeBus } from "@agentos/realtime";
import { ulidSchema } from "@agentos/shared";
import { ToolRegistry } from "@agentos/tools";
import { agentVersions, agents, auditLogs } from "@agentos/database";
import { database, requireAgencyPage } from "../../lib/server";

export type PlaygroundActionState = { outcome: "idle" | "success" | "error"; message: string; result?: PlaygroundResult };
const safeCode = (error: unknown) => error instanceof Error && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.message) ? error.message.toLowerCase().replaceAll("_", "-") : "preview-failed";

export async function runAgentPlaygroundAction(_previous: PlaygroundActionState, form: FormData): Promise<PlaygroundActionState> {
  const access = await requireAgencyPage("run.execute");

  const input = playgroundInputSchema.safeParse({ text: String(form.get("text") ?? ""), fixture: String(form.get("fixture") ?? "WEB_CHAT") });
  const businessId = String(form.get("businessId") ?? ""); const agentId = String(form.get("agentId") ?? ""); const versionId = String(form.get("versionId") ?? "");
  if (!input.success) return { outcome: "error", message: "Enter a message under 4,000 characters and choose a valid scenario." };
  if (!ulidSchema.safeParse(businessId).success || !ulidSchema.safeParse(agentId).success || !ulidSchema.safeParse(versionId).success) return { outcome: "error", message: "Select a valid business, agent, and version." };
  if (!process.env.OPENAI_API_KEY) return { outcome: "error", message: "Model preview is unavailable because OPENAI_API_KEY is not configured." };

  const row = (await database.select({ config: agentVersions.config, version: agentVersions.version, state: agentVersions.state, revision: agentVersions.revision, createdAt: agentVersions.createdAt, publishedAt: agentVersions.publishedAt, businessId: agentVersions.businessId, agentId: agentVersions.agentId }).from(agentVersions).innerJoin(agents, and(eq(agents.id, agentVersions.agentId), eq(agents.businessId, agentVersions.businessId))).where(and(eq(agentVersions.id, versionId), eq(agentVersions.businessId, businessId), eq(agentVersions.agentId, agentId))).limit(1))[0];
  if (!row || !["DRAFT", "TEST", "PUBLISHED"].includes(row.state)) return { outcome: "error", message: "That version is not available for preview in this business." };
  const version = agentVersionSchema.parse({ id: versionId, ...row, createdAt: row.createdAt.toISOString(), publishedAt: row.publishedAt?.toISOString() ?? null });

  try {
    const versionRepository = new PostgresAgentVersionRepository(database);
    const modelProvider = new CircuitBreakerModelProvider(new OpenAIResponsesProvider({ apiKey: process.env.OPENAI_API_KEY, ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}), ...(process.env.OPENAI_TIMEOUT_MS ? { timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS) } : {}), ...(process.env.OPENAI_FALLBACK_MODEL ? { fallbackModel: process.env.OPENAI_FALLBACK_MODEL } : {}) }));
    const adapter = new AgentRuntimePlaygroundAdapter(() => new AgentRuntime({
      versions: new AgentVersionService(versionRepository), contextEngine: new LayeredContextEngine(new PostgresRuntimeContextSource(database)),
      models: modelProvider, tools: new ToolRegistry(), actions: new DeferredChannelActionExecutor(new InMemoryActionRepository(), { async apply() {} }),
      traces: new InMemoryTraceRepository(), realtime: new InMemoryRealtimeBus(), presence: { async transition() {} },
    }));
    const result = await adapter.execute(version, input.data);
    await database.insert(auditLogs).values({ id: ulid(), businessId, actorId: access.session.user.id, action: "agent.playground.previewed", targetType: "agent_version", targetId: versionId, safeMetadata: { revision: version.revision ?? 1, fixture: input.data.fixture, status: result.status, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, actionTypes: result.draftActionTypes.concat(result.otherActionTypes) } });
    return { outcome: result.status === "COMPLETED" ? "success" : "error", message: result.status === "COMPLETED" ? "Preview completed. No tools or external actions were run." : `Preview ended safely (${result.safeError?.code ?? "run-failed"}).`, result };
  } catch (error) {
    return { outcome: "error", message: `Preview failed safely (${safeCode(error)}).` };
  }
}
