import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { ulid } from "ulid";
import * as schema from "@agentos/database";
import { Phase5Queues, Phase5Store } from "@agentos/phase5";

const [mode, stateFile] = process.argv.slice(2);
if (!process.env.DATABASE_URL || !process.env.REDIS_URL || !stateFile || !["prepare", "verify"].includes(mode ?? "")) throw new Error("Usage: phase5-restart-check.ts prepare|verify <state-file> with DATABASE_URL and REDIS_URL");
const pool = new Pool({ connectionString: process.env.DATABASE_URL }); const store = new Phase5Store(drizzle(pool)); const queues = new Phase5Queues(store, process.env.REDIS_URL);
try {
  if (mode === "prepare") {
    const businessId = ulid(); const workId = ulid();
    await store.db.insert(schema.businesses).values({ id: businessId, name: "Phase5 restart check", state: "ACTIVE" });
    await store.db.insert(schema.workItems).values({ id: workId, businessId, kind: "BROWSER", resourceId: ulid(), traceId: ulid(), state: "PENDING", runAt: new Date() });
    await queues.pump();
    assert.equal((await store.getWork(businessId, workId)).state, "QUEUED");
    assert.ok(await queues.queues.BROWSER.getJob(workId));
    await writeFile(stateFile, JSON.stringify({ businessId, workId }));
    console.log("Prepared durable queued job", workId);
  } else {
    const { businessId, workId } = JSON.parse(await readFile(stateFile, "utf8")) as { businessId: string; workId: string };
    assert.equal((await store.getWork(businessId, workId)).state, "QUEUED");
    assert.ok(await queues.queues.BROWSER.getJob(workId), "BullMQ job did not survive Redis restart");
    let handled = 0; const stop = queues.start(async (work) => { if (work.id === workId) handled++; }, { concurrency: 2 });
    const end = Date.now() + 10_000; while (Date.now() < end && (await store.getWork(businessId, workId)).state !== "COMPLETED") await Bun.sleep(50);
    assert.equal((await store.getWork(businessId, workId)).state, "COMPLETED"); assert.equal(handled, 1);
    await stop(); console.log("Recovered queued job after Redis restart", workId);
  }
} finally { await queues.close(); await pool.end(); }
