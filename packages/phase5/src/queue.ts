import { ulid } from "ulid";
import { Queue, Worker, type Job } from "bullmq";
import Redis from "ioredis";
import { and, eq, lt, sql } from "drizzle-orm";
import * as dbs from "@agentos/database";
import { classifyFailure, workJobSchema, type WorkJob, type WorkKind } from "./contracts";
import { Phase5Store } from "./store";

const queueName: Record<WorkKind, string> = { EVENT: "agentos-events", CONVERSATION: "agentos-conversations", OUTBOUND: "agentos-outbound", ATTACHMENT: "agentos-attachments", BROWSER: "agentos-browser", GOAL: "agentos-goals" };
const kinds = Object.keys(queueName) as WorkKind[];
const leaseScript = "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) else return 0 end";
const releaseScript = "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";
const acquireSlotScript = "redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',ARGV[1]); if redis.call('ZCARD',KEYS[1]) >= tonumber(ARGV[2]) then return 0 end; redis.call('ZADD',KEYS[1],ARGV[3],ARGV[4]); redis.call('PEXPIRE',KEYS[1],ARGV[5]); return 1";

export class RedisConversationLease {
  readonly token = ulid(); private timer?: ReturnType<typeof setInterval>; private lost = false;
  constructor(private readonly redis: Redis, readonly key: string, private readonly ttlMs = 15_000) {}
  async acquire(signal?: AbortSignal) {
    if (signal?.aborted) return false;
    const acquired = await this.redis.set(this.key, this.token, "PX", this.ttlMs, "NX");
    if (acquired !== "OK") return false;
    this.timer = setInterval(() => { void this.redis.eval(leaseScript, 1, this.key, this.token, String(this.ttlMs)).then((value) => { if (value !== 1) this.lost = true; }).catch(() => { this.lost = true; }); }, Math.floor(this.ttlMs / 3));
    return true;
  }
  async assertOwner() { if (this.lost || await this.redis.get(this.key) !== this.token) throw Object.assign(new Error("Conversation lease lost"), { code: "LOCK_LOST" }); }
  async release() { if (this.timer) clearInterval(this.timer); await this.redis.eval(releaseScript, 1, this.key, this.token); }
}

export class Phase5Queues {
  readonly redis: Redis; readonly queues: Record<WorkKind, Queue<WorkJob>>;
  constructor(readonly store: Phase5Store, redisUrl: string) {
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queues = Object.fromEntries(kinds.map((kind) => [kind, new Queue<WorkJob>(queueName[kind], { connection: this.redis, defaultJobOptions: { removeOnComplete: true, removeOnFail: true } })])) as Record<WorkKind, Queue<WorkJob>>;
  }
  /** Recovered outbox rows are re-enqueued; job IDs collapse duplicate pumps. */
  async pump() {
    const due = await this.store.listDue(1_000);
    const groups = new Map<string, typeof due>();
    for (const row of due) { const group = groups.get(row.businessId) ?? []; group.push(row); groups.set(row.businessId, group); }
    const fair = [] as typeof due;
    while ([...groups.values()].some((group) => group.length)) for (const group of groups.values()) { const row = group.shift(); if (row) fair.push(row); }
    for (const row of fair) {
      await this.store.markQueued(row.id);
      const job = workJobSchema.parse({ schemaVersion: "1.0", workId: row.id, businessId: row.businessId, traceId: row.traceId, kind: row.kind });
      await this.queues[job.kind].add(job.kind, job, { jobId: row.id, priority: row.priority, attempts: 1 });
    }
    return fair.length;
  }
  async recover(staleMs = 60_000) {
    const cutoff = new Date(Date.now() - staleMs);
    const rows = await this.store.db.update(dbs.workItems).set({ state: "PENDING", runAt: new Date(), updatedAt: new Date(), safeCode: "WORKER_RECOVERY" }).where(and(sql`${dbs.workItems.state} IN ('QUEUED','RUNNING')`, lt(dbs.workItems.updatedAt, cutoff))).returning({ id: dbs.workItems.id });
    return rows.length;
  }
  private async slot(key: string, cap: number, token: string, ttlMs: number) { return await this.redis.eval(acquireSlotScript, 1, key, String(Date.now()), String(cap), String(Date.now() + ttlMs), token, String(ttlMs * 2)) === 1; }
  private async releaseSlot(key: string, token: string) { await this.redis.zrem(key, token); }
  start(handler: (work: Awaited<ReturnType<Phase5Store["getWork"]>>, signal: AbortSignal, lease: RedisConversationLease | null) => Promise<void>, options: { concurrency?: number; businessConcurrency?: number; connectionConcurrency?: number; timeoutMs?: number } = {}) {
    const workers: Worker[] = []; const concurrency = options.concurrency ?? 8; const businessCap = options.businessConcurrency ?? 3; const connectionCap = options.connectionConcurrency ?? 2; const timeoutMs = options.timeoutMs ?? 60_000;
    const process = async (unsafe: Job<WorkJob>) => {
      const ref = workJobSchema.parse(unsafe.data);
      let work = await this.store.getWork(ref.businessId, ref.workId);
      if (work.kind !== ref.kind || work.traceId !== ref.traceId || work.state === "CANCELLED") return;
      if (work.state !== "QUEUED") return;
      const token = ulid(); const businessSlot = `agentos:slot:business:${ref.businessId}`; const connectionSlot = work.connectionId ? `agentos:slot:connection:${ref.businessId}:${work.connectionId}` : null;
      if (!await this.slot(businessSlot, businessCap, token, timeoutMs)) { await this.store.reschedule(ref.businessId, ref.workId, new Date(Date.now() + 250), "BUSINESS_BUSY"); return; }
      let connectionHeld = false; let globalHeld = false; let lease: RedisConversationLease | null = null;
      try {
        globalHeld = await this.slot("agentos:slot:global", concurrency, token, timeoutMs); if (!globalHeld) { await this.store.reschedule(ref.businessId, ref.workId, new Date(Date.now() + 250), "GLOBAL_BUSY"); return; }
        if (connectionSlot) { connectionHeld = await this.slot(connectionSlot, connectionCap, token, timeoutMs); if (!connectionHeld) { await this.store.reschedule(ref.businessId, ref.workId, new Date(Date.now() + 250), "CONNECTION_BUSY"); return; } }
        if (work.conversationId) { lease = new RedisConversationLease(this.redis, `agentos:conversation:${ref.businessId}:${work.conversationId}`); if (!await lease.acquire()) { await this.store.reschedule(ref.businessId, ref.workId, new Date(Date.now() + 250), "LOCK_BUSY"); return; } }
        const started = await this.store.startWork(ref.businessId, ref.workId);
        if (!started) return; work = started;
        const abort = new AbortController(); const timer = setTimeout(() => abort.abort("TIMEOUT"), timeoutMs);
        const poll = setInterval(() => { void this.store.getWork(ref.businessId, ref.workId).then((latest) => { if (latest.state === "CANCELLED") abort.abort("CANCELLED"); }).catch(() => abort.abort("WORK_UNAVAILABLE")); }, 1_000);
        try { await handler(work, abort.signal, lease); if (abort.signal.aborted) throw Object.assign(new Error("Work aborted"), { code: String(abort.signal.reason) }); await lease?.assertOwner(); const latest = await this.store.getWork(ref.businessId, ref.workId); if (latest.state === "RUNNING") await this.store.finishWork(ref.businessId, ref.workId, "COMPLETED"); }
        catch (error) { const code = error instanceof Error && "code" in error ? String(error.code) : abort.signal.aborted ? String(abort.signal.reason) : "UNKNOWN"; const classification = classifyFailure(code); if (code === "CANCELLED") await this.store.finishWork(ref.businessId, ref.workId, "CANCELLED", code); else if (classification.retryable && work.attempt < work.maxAttempts) await this.store.reschedule(ref.businessId, ref.workId, new Date(Date.now() + Math.min(30_000, 500 * 2 ** (work.attempt - 1))), code); else await this.store.finishWork(ref.businessId, ref.workId, "DEAD", code); }
        finally { clearTimeout(timer); clearInterval(poll); }
      } finally { await lease?.release(); if (connectionSlot && connectionHeld) await this.releaseSlot(connectionSlot, token); if (globalHeld) await this.releaseSlot("agentos:slot:global", token); await this.releaseSlot(businessSlot, token); }
    };
    for (const kind of kinds) workers.push(new Worker(queueName[kind], process, { connection: this.redis, concurrency }));
    const pumpTimer = setInterval(() => { void this.pump().catch(() => {}); }, 250);
    const recoveryTimer = setInterval(() => { void this.recover().catch(() => {}); }, 30_000);
    const goalTimer = setInterval(() => { void this.store.scheduleDueGoals().catch(() => {}); }, 15_000);
    return async () => { clearInterval(pumpTimer); clearInterval(recoveryTimer); clearInterval(goalTimer); await Promise.all(workers.map((worker) => worker.close())); };
  }
  async metrics() { return Object.fromEntries(await Promise.all(kinds.map(async (kind) => [kind, await this.queues[kind].getJobCounts("waiting", "active", "delayed", "failed")]))); }
  async close() { await Promise.all(Object.values(this.queues).map((queue) => queue.close())); await this.redis.quit(); }
}
