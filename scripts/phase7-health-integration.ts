import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { serviceHeartbeats } from "@agentos/database";
import { apiReadiness, operationalHealth } from "../apps/admin/lib/health";
import { database } from "../apps/admin/lib/server";

if (!process.env.DATABASE_URL || !process.env.REDIS_URL) throw new Error("DATABASE_AND_REDIS_REQUIRED");
const instanceId = ulid(); const providerId = ulid();
try {
  assert.equal((await apiReadiness()).ready, true);
  await database.insert(serviceHeartbeats).values({ instanceId, service: "agentos-worker", lastSeenAt: new Date() });
  await database.insert(serviceHeartbeats).values({ instanceId: providerId, service: "agentos-model-circuit-closed", lastSeenAt: new Date() });
  const live = await operationalHealth(); assert.equal(live.api.ready, true); assert.ok(live.liveWorkers >= 1);
  assert.deepEqual(live.providerCircuit, { state: "closed", liveInstances: 1 });
  await database.update(serviceHeartbeats).set({ service: "agentos-model-circuit-open", lastSeenAt: new Date() }).where(eq(serviceHeartbeats.instanceId, providerId));
  assert.equal((await operationalHealth()).providerCircuit.state, "open");
  await database.update(serviceHeartbeats).set({ lastSeenAt: new Date(Date.now() - 120_000) }).where(eq(serviceHeartbeats.instanceId, instanceId));
  const stale = await operationalHealth(); assert.ok(stale.liveWorkers < live.liveWorkers);
  const previousRedis = process.env.REDIS_URL; delete process.env.REDIS_URL;
  try { assert.equal((await apiReadiness()).ready, false); } finally { process.env.REDIS_URL = previousRedis; }
  const previousBrowser = process.env.BROWSER_WORKER_URL; process.env.BROWSER_WORKER_URL = "invalid browser address";
  try { assert.equal((await operationalHealth()).browser, false); } finally { if (previousBrowser === undefined) delete process.env.BROWSER_WORKER_URL; else process.env.BROWSER_WORKER_URL = previousBrowser; }
  assert.equal(JSON.stringify(live).includes(process.env.DATABASE_URL), false);
  console.log("Phase 7 health: schema/Redis readiness, live/stale worker and model circuit heartbeats, browser failure, and redacted status passed");
} finally { await database.delete(serviceHeartbeats).where(eq(serviceHeartbeats.instanceId, instanceId)); await database.delete(serviceHeartbeats).where(eq(serviceHeartbeats.instanceId, providerId)); }
