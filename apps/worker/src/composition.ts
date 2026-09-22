import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { AgentRuntime } from "@agentos/agent-runtime";
import { AgentVersionService } from "@agentos/agents";
import { DeferredChannelActionExecutor } from "@agentos/actions";
import { AttachmentService, ElevenLabsAdapter, ElevenLabsHttpClient, FileObjectStorage } from "@agentos/attachments";
import { FacebookMessengerAdapter, GraphMetaApi, InMemoryChannelRegistry, MessengerMediaDownloader, PostgresCredentialVault, PostgresMessengerAssetResolver, RegistryPresenceController } from "@agentos/channels";
import { LayeredContextEngine } from "@agentos/context";
import { DefaultKnowledgeParser } from "@agentos/knowledge";
import { OpenAIResponsesProvider, OpenAIVisionProvider } from "@agentos/models";
import { PostgresAgentVersionRepository, PostgresRealtimeBus, PostgresRuntimeActionRepository, PostgresRuntimeContextSource, PostgresRuntimeDomainActions, PostgresRuntimeTraceRepository } from "@agentos/phase6";
import { PostgresAttachmentRepository, PostgresBrowserRepository } from "@agentos/phase4-operations";
import { ToolRegistry, type ToolExecutionContext } from "@agentos/tools";
import { BrowserCoordinator, RemoteBrowserAdapter, createWebTools, type BrowserPolicy } from "@agentos/web";
import { PinnedUrlReader } from "@agentos/web";
import { createTrustedBusinessContext } from "@agentos/shared";
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
  const presence = new RegistryPresenceController(registry);
  const realtime = new PostgresRealtimeBus(db);
  const parser = new DefaultKnowledgeParser();
  const attachmentService = new AttachmentService(storage, new MessengerMediaDownloader(vault, required("META_MEDIA_ALLOWED_HOSTS").split(",").map((host) => host.trim()).filter(Boolean)), new OpenAIVisionProvider(required("OPENAI_API_KEY"), required("OPENAI_VISION_MODEL")), process.env.ELEVENLABS_API_KEY ? new ElevenLabsAdapter(new ElevenLabsHttpClient(), async () => required("ELEVENLABS_API_KEY")) : null, { async extract(bytes, mimeType) { return parser.parse(mimeType === "application/pdf" ? "PDF" : mimeType.includes("wordprocessingml") ? "DOCX" : "TEXT", bytes); } }, realtime, undefined, new PostgresAttachmentRepository(db));
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
    versions: new AgentVersionService(new PostgresAgentVersionRepository(db)),
    contextEngine: new LayeredContextEngine(new PostgresRuntimeContextSource(db)),
    models: new OpenAIResponsesProvider(required("OPENAI_API_KEY")),
    tools,
    actions: new DeferredChannelActionExecutor(new PostgresRuntimeActionRepository(db), new PostgresRuntimeDomainActions(db)),
    traces: new PostgresRuntimeTraceRepository(db), realtime, presence,
  });
  return { db, redisUrl, runtime, registry, presence, realtime, attachment, capabilities: async () => ["conversation.read", "handoff.request", ...(browserUrl ? ["browser.use"] : [])] };
}
