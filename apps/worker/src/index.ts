import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AgentRuntime } from "@agentos/agent-runtime";
import type { ChannelRegistry, PresenceController } from "@agentos/channels";
import type { RealtimeBus } from "@agentos/realtime";
import { EventRouter, Phase5Processor, Phase5Queues, Phase5Store } from "@agentos/phase5";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { effectIntents, serviceHeartbeats } from "@agentos/database";

export interface WorkerDependencies {
  db: NodePgDatabase; redisUrl: string; runtime: AgentRuntime; registry: ChannelRegistry; presence: PresenceController;
  realtime?: RealtimeBus; capabilities?: (businessId: string, agentId: string) => Promise<string[]>;
  attachment?: ConstructorParameters<typeof EventRouter>[1]; browser?: ConstructorParameters<typeof EventRouter>[2];
  comments?: ConstructorParameters<typeof EventRouter>[3];
  trialSweep?: () => Promise<number>;
  retentionSweep?: () => Promise<void>;
  providerCircuitState?: () => string;
}

export async function startPhase5Worker(deps: WorkerDependencies) {
  const instanceId = ulid();
  const heartbeat = () => deps.db.insert(serviceHeartbeats).values({ instanceId, service: "agentos-worker", lastSeenAt: new Date() }).onConflictDoUpdate({ target: serviceHeartbeats.instanceId, set: { lastSeenAt: new Date() } });
  const providerInstanceId = ulid();
  const providerHeartbeat = () => {
    if (!deps.providerCircuitState) return Promise.resolve();
    const service = `agentos-model-circuit-${deps.providerCircuitState() === "closed" ? "closed" : "open"}`;
    return deps.db.insert(serviceHeartbeats).values({ instanceId: providerInstanceId, service, lastSeenAt: new Date() }).onConflictDoUpdate({ target: serviceHeartbeats.instanceId, set: { service, lastSeenAt: new Date() } });
  };
  const store = new Phase5Store(deps.db);
  const queues = new Phase5Queues(store, deps.redisUrl);
  const router = new EventRouter(store, deps.attachment, deps.browser, deps.comments);
  const processor = new Phase5Processor({ store, runtime: deps.runtime, registry: deps.registry, presence: deps.presence, router, ...(deps.realtime ? { realtime: deps.realtime } : {}), ...(deps.capabilities ? { capabilities: deps.capabilities } : {}) });
  await queues.recover();
  await deps.trialSweep?.();
  await deps.retentionSweep?.().catch(() => { console.error("RETENTION_SWEEP_FAILED"); });
  await store.scheduleDueGoals();
  await heartbeat();
  await providerHeartbeat();
  const stopWorkers = queues.start((work, signal, lease) => processor.handle(work, signal, lease));
  await queues.pump();
  const reconciliationTimer = setInterval(() => { void store.db.select({ id: effectIntents.id, businessId: effectIntents.businessId }).from(effectIntents).where(eq(effectIntents.state, "UNKNOWN")).limit(50).then((effects) => Promise.all(effects.map((effect) => processor.reconcileUnknownEffect(effect.businessId, effect.id).catch(() => "UNKNOWN")))).catch(() => {}); }, 30_000);
  const trialTimer = setInterval(() => { void deps.trialSweep?.().catch(() => {}); }, 60_000);
  let retentionRunning = false;
  const retentionTimer = setInterval(() => {
    if (!deps.retentionSweep || retentionRunning) return;
    retentionRunning = true;
    void deps.retentionSweep().catch(() => { console.error("RETENTION_SWEEP_FAILED"); }).finally(() => { retentionRunning = false; });
  }, 60_000);
  const heartbeatTimer = setInterval(() => { void Promise.all([heartbeat(), providerHeartbeat()]).catch(() => { console.error("WORKER_HEARTBEAT_FAILED"); }); }, 20_000);
  return async () => { clearInterval(reconciliationTimer); clearInterval(trialTimer); clearInterval(retentionTimer); clearInterval(heartbeatTimer); await stopWorkers(); await queues.close(); await deps.db.delete(serviceHeartbeats).where(eq(serviceHeartbeats.instanceId, instanceId)); if (deps.providerCircuitState) await deps.db.delete(serviceHeartbeats).where(eq(serviceHeartbeats.instanceId, providerInstanceId)); };
}

if (import.meta.main) {
  const modulePath = process.env.PHASE5_WORKER_COMPOSITION_MODULE ?? "./composition.ts";
  const { createWorkerDependencies } = await import(modulePath) as { createWorkerDependencies: () => Promise<WorkerDependencies> };
  const stop = await startPhase5Worker(await createWorkerDependencies());
  process.on("SIGTERM", () => { void stop().then(() => process.exit(0)); });
  process.on("SIGINT", () => { void stop().then(() => process.exit(0)); });
}
