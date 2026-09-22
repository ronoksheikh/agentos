import { z } from "zod";
import type { JsonValue, TrustedBusinessContext } from "@agentos/shared";
import { redactSafe } from "@agentos/shared";

export const toolSafetyClassSchema = z.enum(["READ", "WRITE", "SENSITIVE", "DESTRUCTIVE"]);
export const toolPolicyOutcomeSchema = z.enum(["ALLOW", "DENY", "REQUIRE_HUMAN_APPROVAL"]);
export type ToolSafetyClass = z.infer<typeof toolSafetyClassSchema>;
export type ToolPolicyOutcome = z.infer<typeof toolPolicyOutcomeSchema>;
export interface ToolExecutionContext extends TrustedBusinessContext { runId: string; approvedBrowserPolicy?: { enabled: boolean; allowedDomains: string[]; deniedDomains: string[]; maxActions: number; maxEgress: number }; }
export interface AgentTool<I = unknown, O = unknown> {
  name: string; description: string; category: "memory" | "conversation" | "handoff" | "demo" | "knowledge" | "commerce" | "customer" | "web" | "browser" | "custom" | "goals";
  safetyClass: ToolSafetyClass; requiredCapabilities: string[]; inputSchema: z.ZodType<I>; outputSchema: z.ZodType<O>;
  redaction: { unsafeInputKeys: string[]; unsafeOutputKeys: string[] };
  execute(context: ToolExecutionContext, input: I): Promise<O>;
}
export interface ToolPolicyEvaluator { evaluate(tool: AgentTool, context: ToolExecutionContext, configured?: ToolPolicyOutcome): Promise<ToolPolicyOutcome>; }
export class DefaultToolPolicyEvaluator implements ToolPolicyEvaluator {
  async evaluate(tool: AgentTool, context: ToolExecutionContext, configured?: ToolPolicyOutcome): Promise<ToolPolicyOutcome> {
    if (!tool.requiredCapabilities.every((grant) => context.capabilityGrants.includes(grant))) return "DENY";
    return configured ?? (tool.safetyClass === "DESTRUCTIVE" ? "REQUIRE_HUMAN_APPROVAL" : "ALLOW");
  }
}
export interface SafeToolResult { toolCallId: string; toolName: string; status: "COMPLETED" | "DENIED" | "REQUIRES_APPROVAL" | "FAILED"; safeInput: JsonValue; safeOutput?: JsonValue; safeError?: { code: string; message: string }; }

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();
  register(tool: AgentTool): void { if (this.tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`); this.tools.set(tool.name, tool); }
  resolveAllowed(names: string[]): AgentTool[] { return names.map((name) => this.tools.get(name)).filter((tool): tool is AgentTool => Boolean(tool)); }
  describe(names: string[]) { return this.resolveAllowed(names).map((tool) => ({ name: tool.name, description: tool.description, inputSchema: z.toJSONSchema(tool.inputSchema) as JsonValue })); }
  async execute(call: { id: string; name: string; arguments: unknown }, context: ToolExecutionContext, configuredPolicy: Record<string, ToolPolicyOutcome>, evaluator: ToolPolicyEvaluator, allowedNames?: readonly string[]): Promise<SafeToolResult> {
    const tool = this.tools.get(call.name); if (!tool || (allowedNames && !allowedNames.includes(call.name))) return { toolCallId: call.id, toolName: call.name, status: "DENIED", safeInput: {}, safeError: { code: "TOOL_NOT_ALLOWED", message: "Tool is not enabled for this agent version" } };
    let parsed: unknown; try { parsed = tool.inputSchema.parse(call.arguments); } catch { return { toolCallId: call.id, toolName: call.name, status: "FAILED", safeInput: redactSafe(call.arguments), safeError: { code: "INVALID_TOOL_INPUT", message: "Tool input failed validation" } }; }
    const safeInput = redactSafe(parsed, tool.redaction.unsafeInputKeys); const policy = await evaluator.evaluate(tool, context, configuredPolicy[tool.name]);
    if (policy === "DENY") return { toolCallId: call.id, toolName: call.name, status: "DENIED", safeInput, safeError: { code: "TOOL_DENIED", message: "Tool policy denied execution" } };
    if (policy === "REQUIRE_HUMAN_APPROVAL") return { toolCallId: call.id, toolName: call.name, status: "REQUIRES_APPROVAL", safeInput, safeError: { code: "HUMAN_APPROVAL_REQUIRED", message: "Tool requires human approval" } };
    try { if (context.cancellationSignal.aborted) throw new Error("CANCELLED"); if (tool.safetyClass !== "READ") await context.assertConversationFresh?.(); const output = tool.outputSchema.parse(await tool.execute(context, parsed)); if (context.cancellationSignal.aborted) throw new Error("CANCELLED"); return { toolCallId: call.id, toolName: call.name, status: "COMPLETED", safeInput, safeOutput: redactSafe(output, tool.redaction.unsafeOutputKeys) }; }
    catch { return { toolCallId: call.id, toolName: call.name, status: "FAILED", safeInput, safeError: { code: "TOOL_EXECUTION_FAILED", message: "Tool execution failed safely" } }; }
  }
}

export function createDemoLookupTool(entries: Record<string, string>): AgentTool<{ key: string }, { value: string | null }> {
  return { name: "demo_lookup", description: "Look up deterministic demo reference data", category: "demo", safetyClass: "READ", requiredCapabilities: ["tool.demo.read"], inputSchema: z.object({ key: z.string().min(1) }), outputSchema: z.object({ value: z.string().nullable() }), redaction: { unsafeInputKeys: [], unsafeOutputKeys: [] }, async execute(_context, input) { return { value: entries[input.key] ?? null }; } };
}

export interface ProofToolServices {
  searchMemories(context: ToolExecutionContext, query: string): Promise<Array<{ id: string; type: string; content: string }>>;
  searchConversation(context: ToolExecutionContext, query: string, limit: number): Promise<Array<{ messageId: string; excerpt: string }>>;
  pinMessage(context: ToolExecutionContext, messageId: string, label?: string): Promise<{ pinId: string }>;
  requestHuman(context: ToolExecutionContext, reason: string, priority: "LOW" | "NORMAL" | "HIGH" | "URGENT", idempotencyKey: string): Promise<{ handoffId: string; duplicate: boolean }>;
}

export function createProofTools(services: ProofToolServices): AgentTool[] {
  return [
    { name: "memory_search", description: "Search active memories in the trusted customer or conversation scope", category: "memory", safetyClass: "READ", requiredCapabilities: ["memory.read"], inputSchema: z.object({ query: z.string().min(1).max(500) }), outputSchema: z.object({ results: z.array(z.object({ id: z.string(), type: z.string(), content: z.string() })).max(20) }), redaction: { unsafeInputKeys: [], unsafeOutputKeys: [] }, async execute(context, input: { query: string }) { return { results: (await services.searchMemories(context, input.query)).slice(0, 20) }; } },
    { name: "conversation_search", description: "Search messages only within the trusted tenant scope", category: "conversation", safetyClass: "READ", requiredCapabilities: ["conversation.read"], inputSchema: z.object({ query: z.string().min(1).max(500), limit: z.number().int().min(1).max(50).default(10) }), outputSchema: z.object({ results: z.array(z.object({ messageId: z.string(), excerpt: z.string() })).max(50) }), redaction: { unsafeInputKeys: [], unsafeOutputKeys: [] }, async execute(context, input: { query: string; limit: number }) { return { results: await services.searchConversation(context, input.query, input.limit) }; } },
    { name: "pin_message", description: "Pin a message in the trusted conversation", category: "conversation", safetyClass: "WRITE", requiredCapabilities: ["memory.manage"], inputSchema: z.object({ messageId: z.string().min(1), label: z.string().max(200).optional() }), outputSchema: z.object({ pinId: z.string() }), redaction: { unsafeInputKeys: [], unsafeOutputKeys: [] }, async execute(context, input: { messageId: string; label?: string }) { return services.pinMessage(context, input.messageId, ...(input.label ? [input.label] : [])); } },
    { name: "request_human", description: "Request human ownership for the trusted conversation", category: "handoff", safetyClass: "WRITE", requiredCapabilities: ["handoff.request"], inputSchema: z.object({ reason: z.string().min(1).max(1_000), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"), idempotencyKey: z.string().min(1).max(300) }), outputSchema: z.object({ handoffId: z.string(), duplicate: z.boolean() }), redaction: { unsafeInputKeys: [], unsafeOutputKeys: [] }, async execute(context, input: { reason: string; priority: "LOW" | "NORMAL" | "HIGH" | "URGENT"; idempotencyKey: string }) { return services.requestHuman(context, input.reason, input.priority, input.idempotencyKey); } },
  ];
}
