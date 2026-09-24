import { and, eq, gte, sql } from "drizzle-orm";
import Redis from "ioredis";
import { channelConnections, serviceHeartbeats, workItems } from "@agentos/database";
import { database } from "./server";

async function redisReachable() {
  const url = process.env.REDIS_URL; if (!url) return false;
  const client = new Redis(url, { lazyConnect: true, connectTimeout: 2000, maxRetriesPerRequest: 0, retryStrategy: () => null });
  try { await client.connect(); return (await client.ping()) === "PONG"; }
  catch { return false; }
  finally { client.disconnect(); }
}
export async function apiReadiness() {
  const [databaseReady, redisReady] = await Promise.all([
    process.env.DATABASE_URL ? database.select({ instanceId: serviceHeartbeats.instanceId }).from(serviceHeartbeats).limit(1).then(() => true).catch(() => false) : Promise.resolve(false),
    redisReachable(),
  ]);
  return { ready: databaseReady && redisReady, databaseReady, redisReady };
}
export async function operationalHealth() {
  const now = new Date(); const api = await apiReadiness();
  const browserUrl = process.env.BROWSER_WORKER_URL;
  const browser = browserUrl ? await (async () => { try { return (await fetch(new URL("/health", browserUrl), { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } })() : null;
  if (!api.databaseReady) return { asOf: now.toISOString(), api, browser, liveWorkers: 0, work: {}, channels: {}, providerConfiguration: { model: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL), transcription: Boolean(process.env.ELEVENLABS_API_KEY), meta: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET) } };
  const [workers, work, channels] = await Promise.all([
    database.select({ count: sql<number>`count(*)::int` }).from(serviceHeartbeats).where(and(eq(serviceHeartbeats.service, "agentos-worker"), gte(serviceHeartbeats.lastSeenAt, new Date(now.getTime() - 90_000)))),
    database.select({ state: workItems.state, count: sql<number>`count(*)::int` }).from(workItems).groupBy(workItems.state),
    database.select({ state: channelConnections.state, count: sql<number>`count(*)::int` }).from(channelConnections).groupBy(channelConnections.state),
  ]);
  return { asOf: now.toISOString(), api, browser, liveWorkers: workers[0]?.count ?? 0, work: Object.fromEntries(work.map((row) => [row.state, row.count])), channels: Object.fromEntries(channels.map((row) => [row.state, row.count])), providerConfiguration: { model: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL), transcription: Boolean(process.env.ELEVENLABS_API_KEY), meta: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET) } };
}
