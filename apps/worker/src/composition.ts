import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { AgentRuntime } from "@agentos/agent-runtime";
import { AgentVersionService } from "@agentos/agents";
import { DeferredChannelActionExecutor } from "@agentos/actions";
import { AttachmentService, ElevenLabsAdapter, ElevenLabsHttpClient, FileObjectStorage } from "@agentos/attachments";
import { FacebookMessengerAdapter, GraphMetaApi, InMemoryChannelRegistry, MessengerMediaDownloader, PostgresCredentialVault, PostgresMessengerAssetResolver, RegistryPresenceController } from "@agentos/channels";
import { LayeredContextEngine } from "@agentos/context";
import { PostgresCommentProcessor, PostgresCommentWriteExecutor, RuleCommentClassifier } from "@agentos/comments";
import { DefaultKnowledgeParser } from "@agentos/knowledge";
import { CircuitBreakerModelProvider, OpenAICommentClassifier, OpenAIResponsesProvider, OpenAIVisionProvider, verifyOpenAICommentClassifier, verifyOpenAIEndpoint } from "@agentos/models";
import { PostgresAgentEvaluationRepository, PostgresAgentVersionRepository, PostgresRealtimeBus, PostgresRuntimeActionRepository, PostgresRuntimeContextSource, PostgresRuntimeDomainActions, PostgresRuntimeTraceRepository } from "@agentos/phase6";
import { PostgresAttachmentRepository, PostgresBrowserRepository, PostgresBusinessContentRetention, PostgresExpiredContentRetention } from "@agentos/phase4-operations";
import { ToolRegistry, type ToolExecutionContext } from "@agentos/tools";
import { BrowserCoordinator, RemoteBrowserAdapter, createWebTools, type BrowserPolicy } from "@agentos/web";
import { PinnedUrlReader } from "@agentos/web";
import { createTrustedBusinessContext } from "@agentos/shared";
import { PostgresWebChatService, WebChatAdapter } from "@agentos/website-sdk";
import { PostgresTrialService } from "@agentos/trial";
import { PostgresFeatureFlags, runtimeCapabilityGrants } from "@agentos/feature-flags";
import { FeatureFlaggedContextSource } from "./feature-flagged-context";
import { ulid } from "ulid";
import type { WorkerDependencies } from "./index";

const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`${name}_REQUIRED`); return value; };

/** Default approved worker composition. No fake channel, browser, or model provider is installed. */
export async function createWorkerDependencies(): Promise<WorkerDependencies> {
  const databaseUrl = required("DATABASE_URL"); const redisUrl = required("REDIS_URL");
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool); await pool.query("select 1");
  const api = new GraphMetaApi(required("META_APP_ID"), required("META_APP_SECRET"));
  const vault = PostgresCredentialVault.fromEnvironment(db);
  const storage = new FileObjectStorage(required("PRIVATE_MEDIA_DIR"), required("PUBLIC_MEDIA_BASE_URL"), required("MEDIA_SIGNING_KEY"));
  const registry = new InMemoryChannelRegistry();
  registry.register(new FacebookMessengerAdapter(db, api, vault, required("META_APP_SECRET"), new PostgresMessengerAssetResolver(db, storage)));
  registry.register(new WebChatAdapter(new PostgresWebChatService(db, required("VISITOR_SESSION_SECRET"))));
  const presence = new RegistryPresenceController(registry);
  const realtime = new PostgresRealtimeBus(db);
  const featureFlags = new PostgresFeatureFlags(db);
  const parser = new DefaultKnowledgeParser();
  const openaiConfig = { apiKey: required("OPENAI_API_KEY"), ...(process.env.OPENAI_BASE_URL ? { baseURL: process.env.OPENAI_BASE_URL } : {}), ...(process.env.OPENAI_TIMEOUT_MS ? { timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS) } : {}), ...(process.env.OPENAI_FALLBACK_MODEL ? { fallbackModel: process.env.OPENAI_FALLBACK_MODEL } : {}) };
  const visionModel = await verifyOpenAIEndpoint(openaiConfig, required("OPENAI_MODEL"), process.env.OPENAI_VISION_MODEL);
  if (process.env.OPENAI_CLASSIFIER_MODEL) await verifyOpenAICommentClassifier(openaiConfig, process.env.OPENAI_CLASSIFIER_MODEL);
  const modelProvider = new CircuitBreakerModelProvider(new OpenAIResponsesProvider(openaiConfig));
  const attachmentService = new AttachmentService(storage, new MessengerMediaDownloader(vault, required("META_MEDIA_ALLOWED_HOSTS").split(",").map((host) => host.trim()).filter(Boolean)), new OpenAIVisionProvider(openaiConfig, visionModel), process.env.ELEVENLABS_API_KEY ? new ElevenLabsAdapter(new ElevenLabsHttpClient({ ...(process.env.ELEVENLABS_ENDPOINT ? { endpoint: process.env.ELEVENLABS_ENDPOINT } : {}), ...(process.env.ELEVENLABS_MODEL ? { model: process.env.ELEVENLABS_MODEL } : {}), ...(process.env.ELEVENLABS_TIMEOUT_MS ? { timeoutMs: Number(process.env.ELEVENLABS_TIMEOUT_MS) } : {}) }), async () => required("ELEVENLABS_API_KEY")) : null, { async extract(bytes, mimeType) { return parser.parse(mimeType === "application/pdf" ? "PDF" : mimeType.includes("wordprocessingml") ? "DOCX" : "TEXT", bytes); } }, realtime, undefined, new PostgresAttachmentRepository(db));
  const attachment: NonNullable<WorkerDependencies["attachment"]> = async (event, signal) => {
    if (event.type !== "attachment.received") return;
    const trusted = createTrustedBusinessContext({ businessId: event.businessId, principal: { kind: "system", service: "messenger-media" }, source: "internal_system", ...(event.conversationId ? { conversationId: event.conversationId } : {}), traceId: event.traceId, capabilityGrants: [] }, signal);
    const { attachment: record } = await attachmentService.recover(trusted, event.payload.attachmentId);
    const processed = await attachmentService.process(trusted, record.id);
    if (processed.attachment.status === "READY") await vault.revoke(trusted, record.sourceRef, "meta_attachment_url").catch(() => {});
  };
  const tools = new ToolRegistry();
  const browserUrl = process.env.BROWSER_WORKER_URL;
  if (browserUrl) {
    const browserPersistence = new PostgresBrowserRepository(db);
    await browserPersistence.recoverLostSessions();
    const browser = new BrowserCoordinator(new RemoteBrowserAdapter(browserUrl, required("BROWSER_WORKER_TOKEN")), (context: ToolExecutionContext): BrowserPolicy => {
      const approved = (context as ToolExecutionContext & { approvedBrowserPolicy?: { enabled: boolean; allowedDomains: string[]; deniedDomains: string[]; maxActions: number; maxEgress: number } }).approvedBrowserPolicy;
      if (!approved?.enabled || !approved.allowedDomains.length) throw new Error("BROWSER_POLICY_DENIED");
      return { allowedDomains: approved.allowedDomains, deniedDomains: approved.deniedDomains, maxActions: approved.maxActions, maxEgress: approved.maxEgress, timeoutMs: 30_000, allowDownloads: false, allowUploads: false };
    }, undefined, realtime, browserPersistence);
    for (const tool of createWebTools({ async search() { throw new Error("SEARCH_PROVIDER_UNAVAILABLE"); } }, new PinnedUrlReader(), browser, () => []).filter((tool) => tool.category === "browser")) tools.register(tool);
  }
  const runtime = new AgentRuntime({
    versions: new AgentVersionService(new PostgresAgentVersionRepository(db), new PostgresAgentEvaluationRepository(db)),
    contextEngine: new LayeredContextEngine(new FeatureFlaggedContextSource(new PostgresRuntimeContextSource(db), featureFlags)),
    models: modelProvider,
    tools,
    actions: new DeferredChannelActionExecutor(new PostgresRuntimeActionRepository(db), new PostgresRuntimeDomainActions(db)),
    traces: new PostgresRuntimeTraceRepository(db), realtime, presence,
  });
  const commentClassifier = process.env.OPENAI_CLASSIFIER_MODEL ? new OpenAICommentClassifier(openaiConfig, process.env.OPENAI_CLASSIFIER_MODEL) : new RuleCommentClassifier();
  const commentProcessor = new PostgresCommentProcessor(db, api, vault, realtime, commentClassifier, new PostgresCommentWriteExecutor(db, runtime, registry));
  const expiredContentRetention = new PostgresExpiredContentRetention(db, storage); const businessContentRetention = new PostgresBusinessContentRetention(db);
  return { db, redisUrl, runtime, registry, presence, realtime, attachment, comments: (event, signal) => commentProcessor.process(event, signal).then(() => {}), trialSweep: () => new PostgresTrialService(db).expireDue(), retentionSweep: async () => { await expiredContentRetention.sweep(); await businessContentRetention.sweep(); }, providerCircuitState: () => modelProvider.status().state, capabilities: (businessId) => runtimeCapabilityGrants(featureFlags, businessId, Boolean(browserUrl)) };
}
