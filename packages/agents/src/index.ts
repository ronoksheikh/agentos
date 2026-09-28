import { z } from "zod";
import { isoDateTimeSchema, ulidSchema, type TrustedBusinessContext } from "@agentos/shared";
import { assertEvaluationAllowsPublish, type EvaluationResultRepository } from "./evaluation";

export const agentVersionStateSchema = z.enum(["DRAFT", "TEST", "PUBLISHED", "ARCHIVED"]);
export const runtimeLimitsSchema = z.object({
  maxSteps: z.number().int().min(1).max(50).default(8),
  maxToolCalls: z.number().int().min(0).max(50).default(8),
  maxRuntimeMs: z.number().int().min(100).max(300_000).default(30_000),
  maxContextTokens: z.number().int().min(128).max(1_000_000).default(8_000),
  maxOutputTokens: z.number().int().min(1).max(100_000).default(2_000),
});

export const responseTimingPolicySchema = z.object({
  debounceMs: z.number().int().min(0).max(60_000).default(0),
  maxBatchWaitMs: z.number().int().min(0).max(120_000).default(10_000),
  attachmentWaitMs: z.number().int().min(0).max(30_000).default(5_000),
  minPreSendDelayMs: z.number().int().min(0).max(60_000).default(0),
  maxPreSendDelayMs: z.number().int().min(0).max(120_000).default(5_000),
  maxCustomerWaitMs: z.number().int().min(100).max(300_000).default(60_000),
  variabilityMs: z.number().int().min(0).max(2_000).default(250),
  urgencyBypass: z.boolean().default(true),
  typing: z.object({ enabled: z.boolean().default(true), refreshMs: z.number().int().min(1_000).max(30_000).default(8_000) }),
});

export const modelReferenceSchema = z.object({ provider: z.string().min(1), model: z.string().min(1), credentialRef: z.string().min(1).optional() });
export const agentVersionConfigSchema = z.object({
  name: z.string().min(1).max(200),
  instructions: z.string().min(1).max(100_000),
  tone: z.string().max(2_000).default("clear and helpful"),
  languages: z.array(z.string().min(2).max(20)).min(1).default(["en"]),
  models: z.object({ primary: modelReferenceSchema, fallback: modelReferenceSchema.optional(), vision: modelReferenceSchema.optional() }),
  enabledTools: z.array(z.string().min(1)).default([]),
  toolPolicy: z.record(z.string(), z.enum(["ALLOW", "DENY", "REQUIRE_HUMAN_APPROVAL"])).default({}),
  contextPolicy: z.object({ recentMessageLimit: z.number().int().min(1).max(200).default(20), includeMemories: z.boolean().default(true), includePins: z.boolean().default(true) }),
  memoryPolicy: z.object({ enabled: z.boolean().default(true), defaultExpiryDays: z.number().int().positive().optional() }).default({ enabled: true }),
  runtimeLimits: runtimeLimitsSchema,
  handoffPolicy: z.object({ enabled: z.boolean().default(true), allowReasons: z.array(z.string()).default([]) }).default({ enabled: true, allowReasons: [] }),
  responseTimingPolicy: responseTimingPolicySchema.default({ debounceMs: 0, maxBatchWaitMs: 10_000, attachmentWaitMs: 5_000, minPreSendDelayMs: 0, maxPreSendDelayMs: 5_000, maxCustomerWaitMs: 60_000, variabilityMs: 250, urgencyBypass: true, typing: { enabled: true, refreshMs: 8_000 } }),
  disclosurePolicy: z.object({ discloseWhenAsked: z.boolean().default(true), statement: z.string().max(1_000).default("I am an automated assistant.") }).default({ discloseWhenAsked: true, statement: "I am an automated assistant." }),
  channelBehavior: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  featureFlags: z.record(z.string(), z.boolean()).default({}),
  browserPolicy: z.object({ enabled: z.boolean().default(false), allowedDomains: z.array(z.string()).default([]), deniedDomains: z.array(z.string()).default([]), maxActions: z.number().int().min(1).max(100).default(20), maxEgress: z.number().int().min(1).max(30).default(10) }).default({ enabled: false, allowedDomains: [], deniedDomains: [], maxActions: 20, maxEgress: 10 }),
  knowledgePolicy: z.object({ enabled: z.boolean().default(false), sourceIds: z.array(ulidSchema).default([]) }).default({ enabled: false, sourceIds: [] }),
});

export const agentSchema = z.object({ id: ulidSchema, businessId: ulidSchema, name: z.string().min(1), activeVersionId: ulidSchema.nullable(), createdAt: isoDateTimeSchema, updatedAt: isoDateTimeSchema });
export const agentVersionSchema = z.object({ id: ulidSchema, businessId: ulidSchema, agentId: ulidSchema, version: z.number().int().positive(), state: agentVersionStateSchema, config: agentVersionConfigSchema, createdBy: ulidSchema, createdAt: isoDateTimeSchema, publishedAt: isoDateTimeSchema.nullable(), revision: z.number().int().positive().optional(), basedOnVersionId: ulidSchema.nullable().optional() });
export type Agent = z.infer<typeof agentSchema>;
export type AgentVersion = z.infer<typeof agentVersionSchema>;
export type AgentVersionConfig = z.infer<typeof agentVersionConfigSchema>;
export { AGENT_EVALUATION_SUITE_VERSION, agentEvaluationCases, evaluationObservationSchema, evaluationCaseResultSchema, evaluationRunSchema, runAgentEvaluation, assertEvaluationAllowsPublish } from "./evaluation";
export type { AgentEvaluationCase, AgentEvaluationRun, EvaluationObservation, EvaluationResultRepository } from "./evaluation";

export interface AgentVersionRepository {
  getAgent(context: TrustedBusinessContext, agentId: string): Promise<Agent | null>;
  getVersion(context: TrustedBusinessContext, versionId: string): Promise<AgentVersion | null>;
  getActiveVersion(context: TrustedBusinessContext, agentId: string): Promise<AgentVersion | null>;
  saveVersion(context: TrustedBusinessContext, version: AgentVersion): Promise<void>;
  selectPublishedVersion(context: TrustedBusinessContext, agentId: string, versionId: string, actorId: string, expectedRevision?: number): Promise<void>;
}

export class AgentVersionService {
  constructor(private readonly repository: AgentVersionRepository, private readonly evaluations?: EvaluationResultRepository) {}
  async resolve(context: TrustedBusinessContext, agentId: string, testVersionId?: string): Promise<AgentVersion> {
    const version = testVersionId ? await this.repository.getVersion(context, testVersionId) : await this.repository.getActiveVersion(context, agentId);
    if (!version || version.agentId !== agentId || version.businessId !== context.businessId) throw new Error("Agent version is unavailable in this business");
    if (testVersionId && !["DRAFT", "TEST", "PUBLISHED"].includes(version.state)) throw new Error("Agent version is not runnable");
    if (!testVersionId && version.state !== "PUBLISHED") throw new Error("Active agent version is not published");
    return structuredClone(version);
  }
  async publish(context: TrustedBusinessContext, agentId: string, versionId: string, actorId: string): Promise<void> {
    const version = await this.repository.getVersion(context, versionId);
    if (!version || version.agentId !== agentId || version.state === "ARCHIVED") throw new Error("Version cannot be published");
    if (!this.evaluations) throw new Error("CURRENT_EVALUATION_REQUIRED");
    assertEvaluationAllowsPublish(await this.evaluations.latestForVersion(context.businessId, versionId), version);
    assertAgentVersionCompatible(version.config);
    await this.repository.selectPublishedVersion(context, agentId, versionId, actorId, version.revision ?? 1);
  }
  async rollback(context: TrustedBusinessContext, agentId: string, versionId: string, actorId: string): Promise<void> {
    const version = await this.repository.getVersion(context, versionId);
    if (!version || version.agentId !== agentId || !version.publishedAt) throw new Error("ROLLBACK_TARGET_INVALID");
    if (!this.evaluations) throw new Error("CURRENT_EVALUATION_REQUIRED");
    assertEvaluationAllowsPublish(await this.evaluations.latestForVersion(context.businessId, versionId), version);
    assertAgentVersionCompatible(version.config);
    await this.repository.selectPublishedVersion(context, agentId, versionId, actorId, version.revision ?? 1);
  }
}

export function assertAgentVersionCompatible(config: AgentVersionConfig) {
  const policy = config.responseTimingPolicy;
  if (policy.minPreSendDelayMs > policy.maxPreSendDelayMs || policy.maxPreSendDelayMs > policy.maxCustomerWaitMs) throw new Error("INCOMPATIBLE_TIMING_POLICY");
  if (!config.disclosurePolicy.discloseWhenAsked || !/automated|ai|virtual/i.test(config.disclosurePolicy.statement)) throw new Error("UNTRUTHFUL_DISCLOSURE_POLICY");
  if (config.browserPolicy.enabled && !config.browserPolicy.allowedDomains.length) throw new Error("BROWSER_DOMAINS_REQUIRED");
  if (config.knowledgePolicy.enabled && !config.knowledgePolicy.sourceIds.length) throw new Error("KNOWLEDGE_SOURCES_REQUIRED");
}

/** Returns a request-scoped model variant without changing the persisted version snapshot. */
export function selectRuntimeModelVariant(version: AgentVersion, enabled: boolean): AgentVersion {
  const primary = version.config.models.primary; const fallback = version.config.models.fallback;
  if (!enabled || !fallback || fallback.provider !== primary.provider || fallback.model === primary.model) return version;
  return { ...version, config: { ...version.config, models: { ...version.config.models, primary: fallback, fallback: primary } } };
}
