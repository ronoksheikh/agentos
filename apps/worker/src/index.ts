import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { AgentRuntime } from "@agentos/agent-runtime";
import type { ChannelRegistry, PresenceController } from "@agentos/channels";
import type { RealtimeBus } from "@agentos/realtime";
import { EventRouter, Phase5Processor, Phase5Queues, Phase5Store } from "@agentos/phase5";
import { eq } from "drizzle-orm";
import { effectIntents } from "@agentos/database";

export interface WorkerDependencies {
  db: NodePgDatabase; redisUrl: string; runtime: AgentRuntime; registry: ChannelRegistry; presence: PresenceController;
  realtime?: RealtimeBus; capabilities?: (businessId: string, agentId: string) => Promise<string[]>;
  attachment?: ConstructorParameters<typeof EventRouter>[1]; browser?: ConstructorParameters<typeof EventRouter>[2];
}

export async function startPhase5Worker(deps: WorkerDependencies) {
  const store = new Phase5Store(deps.db);
  const queues = new Phase5Queues(store, deps.redisUrl);
  const router = new EventRouter(store, deps.attachment, deps.browser);
  const processor = new Phase5Processor({ store, runtime: deps.runtime, registry: deps.registry, presence: deps.presence, router, ...(deps.realtime ? { realtime: deps.realtime } : {}), ...(deps.capabilities ? { capabilities: deps.capabilities } : {}) });
  await queues.recover();
  await store.scheduleDueGoals();
  const stopWorkers = queues.start((work, signal, lease) => processor.handle(work, signal, lease));
  await queues.pump();
  const reconciliationTimer = setInterval(() => { void store.db.select({ id: effectIntents.id, businessId: effectIntents.businessId }).from(effectIntents).where(eq(effectIntents.state, "UNKNOWN")).limit(50).then((effects) => Promise.all(effects.map((effect) => processor.reconcileUnknownEffect(effect.businessId, effect.id).catch(() => "UNKNOWN")))).catch(() => {}); }, 30_000);
  return async () => { clearInterval(reconciliationTimer); await stopWorkers(); await queues.close(); };
}

if (import.meta.main) {
  const modulePath = process.env.PHASE5_WORKER_COMPOSITION_MODULE ?? "./composition.ts";
  const { createWorkerDependencies } = await import(modulePath) as { createWorkerDependencies: () => Promise<WorkerDependencies> };
  const stop = await startPhase5Worker(await createWorkerDependencies());
  process.on("SIGTERM", () => { void stop().then(() => process.exit(0)); });
  process.on("SIGINT", () => { void stop().then(() => process.exit(0)); });
}
