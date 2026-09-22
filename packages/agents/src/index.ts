import { z } from "zod";
import { isoDateTimeSchema, ulidSchema, type TrustedBusinessContext } from "@agentos/shared";

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
  minPreSendDelayMs: z.number().int().min(0).max(60_000).default(0),
  maxPreSendDelayMs: z.number().int().min(0).max(120_000).default(5_000),
  maxCustomerWaitMs: z.number().int().min(100).max(300_000).default(60_000),
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
  responseTimingPolicy: responseTimingPolicySchema.default({ debounceMs: 0, minPreSendDelayMs: 0, maxPreSendDelayMs: 5_000, maxCustomerWaitMs: 60_000, urgencyBypass: true, typing: { enabled: true, refreshMs: 8_000 } }),
  disclosurePolicy: z.object({ discloseWhenAsked: z.boolean().default(true), statement: z.string().max(1_000).default("I am an automated assistant.") }).default({ discloseWhenAsked: true, statement: "I am an automated assistant." }),
  channelBehavior: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  featureFlags: z.record(z.string(), z.boolean()).default({}),
  browserPolicy: z.object({ enabled: z.literal(false).default(false), allowedDomains: z.array(z.string()).default([]) }).default({ enabled: false, allowedDomains: [] }),
  knowledgePolicy: z.object({ enabled: z.literal(false).default(false), sourceIds: z.array(ulidSchema).default([]) }).default({ enabled: false, sourceIds: [] }),
});

export const agentSchema = z.object({ id: ulidSchema, businessId: ulidSchema, name: z.string().min(1), activeVersionId: ulidSchema.nullable(), createdAt: isoDateTimeSchema, updatedAt: isoDateTimeSchema });
export const agentVersionSchema = z.object({ id: ulidSchema, businessId: ulidSchema, agentId: ulidSchema, version: z.number().int().positive(), state: agentVersionStateSchema, config: agentVersionConfigSchema, createdBy: ulidSchema, createdAt: isoDateTimeSchema, publishedAt: isoDateTimeSchema.nullable() });
export type Agent = z.infer<typeof agentSchema>;
export type AgentVersion = z.infer<typeof agentVersionSchema>;
export type AgentVersionConfig = z.infer<typeof agentVersionConfigSchema>;

export interface AgentVersionRepository {
  getAgent(context: TrustedBusinessContext, agentId: string): Promise<Agent | null>;
  getVersion(context: TrustedBusinessContext, versionId: string): Promise<AgentVersion | null>;
  getActiveVersion(context: TrustedBusinessContext, agentId: string): Promise<AgentVersion | null>;
  saveVersion(context: TrustedBusinessContext, version: AgentVersion): Promise<void>;
  selectPublishedVersion(context: TrustedBusinessContext, agentId: string, versionId: string, actorId: string): Promise<void>;
}

export class AgentVersionService {
  constructor(private readonly repository: AgentVersionRepository) {}
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
    await this.repository.selectPublishedVersion(context, agentId, versionId, actorId);
  }
}
