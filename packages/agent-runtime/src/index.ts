import { ulid } from "ulid";
import { z } from "zod";
import type { AgentVersionService } from "@agentos/agents";
import { agentActionSchema, type AgentAction, type IdempotentActionExecutor } from "@agentos/actions";
import type { ContextEngine, ContextBundle } from "@agentos/context";
import { agentEventSchema, type AgentEvent } from "@agentos/events";
import type { ModelProvider } from "@agentos/models";
import type { RealtimeBus } from "@agentos/realtime";
import { nowIso, redactSafe, type JsonValue, type TrustedBusinessContext } from "@agentos/shared";
import { DefaultToolPolicyEvaluator, ToolRegistry, type SafeToolResult, type ToolPolicyEvaluator } from "@agentos/tools";
import type { TraceRepository, AgentRunRecord } from "@agentos/trace";

export interface AgentRunInput { context: TrustedBusinessContext; event: AgentEvent; agentId: string; testVersionId?: string; debug?: boolean; }
export interface RunLifecycleObserver { transition(context: TrustedBusinessContext, channel: string, state: "RECEIVED" | "QUEUED" | "PROCESSING" | "COMPOSING" | "SENDING" | "SENT" | "FAILED" | "CANCELLED"): Promise<void>; }
export interface AgentRunResult { runId: string; agentVersionId: string; context: { businessId: string; agentId: string; conversationId?: string; customerId?: string; traceId: string }; event: AgentEvent; mode: "LIVE" | "TEST"; actions: AgentAction[]; status: "COMPLETED" | "FAILED" | "CANCELLED"; usage: { inputTokens: number; outputTokens: number; toolCalls: number; steps: number; latencyMs: number }; timing: { startedAt: string; completedAt: string }; safeError?: { code: string; message: string; retryable: boolean }; debug?: { context: ContextBundle }; }

async function withinRuntimeLimit<T>(work: (signal: AbortSignal) => Promise<T>, externalSignal: AbortSignal, remainingMs: number): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const cancel = () => { controller.abort(); reject(Object.assign(new Error("Run cancelled"), { code: "CANCELLED" })); };
    const timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error("Runtime limit exceeded"), { code: "RUNTIME_LIMIT" })); }, Math.max(0, remainingMs));
    externalSignal.addEventListener("abort", cancel, { once: true });
    work(controller.signal).then(resolve, reject).finally(() => { clearTimeout(timer); externalSignal.removeEventListener("abort", cancel); });
  });
}

export class AgentRuntime {
  constructor(private readonly deps: { versions: AgentVersionService; contextEngine: ContextEngine; models: ModelProvider; tools: ToolRegistry; toolPolicy?: ToolPolicyEvaluator; actions: IdempotentActionExecutor; traces: TraceRepository; realtime: RealtimeBus; presence: RunLifecycleObserver }) {}
  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const started = Date.now(); const startedAt = nowIso(); const runId = ulid(); const event = agentEventSchema.parse(input.event); const trusted = input.context;
    if (event.businessId !== trusted.businessId || input.agentId !== trusted.agentId) throw new Error("TRUSTED_SCOPE_MISMATCH");
    const version = await this.deps.versions.resolve(trusted, input.agentId, input.testVersionId); const usage = { inputTokens: 0, outputTokens: 0, toolCalls: 0, steps: 0, latencyMs: 0 }; let sequence = 0; let contextBundle: ContextBundle | undefined; const toolResults: SafeToolResult[] = []; const actions: AgentAction[] = [];
    const publish = (type: Parameters<RealtimeBus["publish"]>[0]["type"], payload: JsonValue) => this.deps.realtime.publish({ type, businessId: trusted.businessId, ...(trusted.conversationId ? { conversationId: trusted.conversationId } : {}), runId, traceId: trusted.traceId, payload });
    const step = async (kind: "CONTEXT" | "MODEL" | "TOOL" | "ACTION" | "STATE", status: "STARTED" | "COMPLETED" | "FAILED", safeFacts: JsonValue) => { await this.deps.traces.appendStep(trusted, { id: ulid(), businessId: trusted.businessId, runId, traceId: trusted.traceId, sequence: ++sequence, kind, status, safeFacts: redactSafe(safeFacts), occurredAt: nowIso() }); };
    const baseRun: AgentRunRecord = { id: runId, businessId: trusted.businessId, agentId: input.agentId, agentVersionId: version.id, ...(trusted.conversationId ? { conversationId: trusted.conversationId } : {}), eventId: event.id, traceId: trusted.traceId, status: "RUNNING", startedAt, completedAt: null, usage, safeError: null };
    await this.deps.traces.createRun(trusted, baseRun); await publish("run.started", { agentVersionId: version.id, mode: input.testVersionId ? "TEST" : "LIVE" }); await this.deps.presence.transition(trusted, event.channel, "PROCESSING");
    let finalStatus: AgentRunResult["status"] = "FAILED"; let safeError: AgentRunResult["safeError"];
    try {
      const deadline = started + version.config.runtimeLimits.maxRuntimeMs;
      for (let iteration = 0; iteration < version.config.runtimeLimits.maxSteps; iteration++) {
        if (trusted.cancellationSignal.aborted) throw Object.assign(new Error("Run cancelled"), { code: "CANCELLED" });
        if (Date.now() > deadline) throw Object.assign(new Error("Runtime limit exceeded"), { code: "RUNTIME_LIMIT" });
        usage.steps++;
        contextBundle = await this.deps.contextEngine.build(trusted, version, event, toolResults.filter((result) => result.safeOutput !== undefined).map((result) => result.safeOutput!));
        await step("CONTEXT", "COMPLETED", { itemCount: contextBundle.items.length, estimatedTokens: contextBundle.estimatedTokens, truncated: contextBundle.truncated, provenance: contextBundle.provenance }); await publish("context.built", { itemCount: contextBundle.items.length, estimatedTokens: contextBundle.estimatedTokens, truncated: contextBundle.truncated });
        await step("MODEL", "STARTED", { provider: version.config.models.primary.provider, model: version.config.models.primary.model }); await publish("model.requested", { provider: version.config.models.primary.provider, model: version.config.models.primary.model });
        const response = await withinRuntimeLimit((signal) => this.deps.models.generate({ runId, version, context: contextBundle!, tools: this.deps.tools.describe(version.config.enabledTools), safeToolResults: toolResults.filter((result) => result.safeOutput !== undefined).map((result) => ({ toolCallId: result.toolCallId, toolName: result.toolName, output: result.safeOutput! })), maxOutputTokens: version.config.runtimeLimits.maxOutputTokens, signal }), trusted.cancellationSignal, deadline - Date.now());
        usage.inputTokens += response.kind === "error" ? response.usage?.inputTokens ?? 0 : response.usage.inputTokens; usage.outputTokens += response.kind === "error" ? response.usage?.outputTokens ?? 0 : response.usage.outputTokens;
        if (response.kind === "error") throw Object.assign(new Error(response.error.message), { code: response.error.code, retryable: response.error.retryable });
        if (response.usage.outputTokens > version.config.runtimeLimits.maxOutputTokens) throw Object.assign(new Error("Output token limit exceeded"), { code: "OUTPUT_LIMIT" });
        const safeUsage = redactSafe(response.usage);
        await step("MODEL", "COMPLETED", { provider: response.provider, model: response.model, usage: safeUsage, responseKind: response.kind }); await publish("model.completed", { provider: response.provider, model: response.model, usage: safeUsage, responseKind: response.kind });
        if (response.kind === "tool_calls") {
          if (usage.toolCalls + response.calls.length > version.config.runtimeLimits.maxToolCalls) throw Object.assign(new Error("Tool call limit exceeded"), { code: "TOOL_LIMIT" });
          for (const call of response.calls) { usage.toolCalls++; await publish("tool.requested", { toolName: call.name }); const result = await this.deps.tools.execute(call, { ...trusted, runId }, version.config.toolPolicy, this.deps.toolPolicy ?? new DefaultToolPolicyEvaluator(), version.config.enabledTools); toolResults.push(result); await this.deps.traces.appendToolCall(trusted, { id: call.id, businessId: trusted.businessId, runId, traceId: trusted.traceId, toolName: call.name, status: result.status, safeInput: result.safeInput, ...(result.safeOutput !== undefined ? { safeOutput: result.safeOutput } : {}), ...(result.safeError ? { safeError: result.safeError } : {}), occurredAt: nowIso() }); await step("TOOL", result.status === "FAILED" ? "FAILED" : "COMPLETED", { toolName: call.name, status: result.status }); await publish("tool.completed", { toolName: call.name, status: result.status }); }
          continue;
        }
        await this.deps.presence.transition(trusted, event.channel, "COMPOSING");
        for (const candidate of response.actions) { const action = agentActionSchema.parse(candidate); actions.push(action); await step("ACTION", "COMPLETED", { actionId: action.id, type: action.type }); await publish("action.validated", { actionId: action.id, actionType: action.type }); const record = await this.deps.actions.execute(trusted, runId, action); await publish("action.applied", { actionId: action.id, actionType: action.type, status: record.status }); }
        finalStatus = "COMPLETED"; break;
      }
      if (finalStatus !== "COMPLETED") throw Object.assign(new Error("Step limit exceeded"), { code: "STEP_LIMIT" });
    } catch (error) { const code = error instanceof Error && "code" in error ? String(error.code) : "RUNTIME_FAILED"; finalStatus = code === "CANCELLED" ? "CANCELLED" : "FAILED"; safeError = { code, message: code === "CANCELLED" ? "Run cancelled" : "Run failed safely", retryable: Boolean(error instanceof Error && "retryable" in error && error.retryable) }; await step("STATE", "FAILED", { code }); }
    const completedAt = nowIso(); usage.latencyMs = Date.now() - started; await this.deps.traces.updateRun(trusted, runId, { status: finalStatus, completedAt, usage, safeError: safeError ?? null }); await publish(finalStatus === "COMPLETED" ? "run.completed" : finalStatus === "CANCELLED" ? "run.cancelled" : "run.failed", { status: finalStatus, usage }); await this.deps.presence.transition(trusted, event.channel, finalStatus === "COMPLETED" ? "SENT" : finalStatus === "CANCELLED" ? "CANCELLED" : "FAILED");
    return { runId, agentVersionId: version.id, context: { businessId: trusted.businessId, agentId: input.agentId, ...(trusted.conversationId ? { conversationId: trusted.conversationId } : {}), ...(trusted.customerId ? { customerId: trusted.customerId } : {}), traceId: trusted.traceId }, event, mode: input.testVersionId ? "TEST" : "LIVE", actions, status: finalStatus, usage, timing: { startedAt, completedAt }, ...(safeError ? { safeError } : {}), ...(input.debug && contextBundle ? { debug: { context: contextBundle } } : {}) };
  }
}
