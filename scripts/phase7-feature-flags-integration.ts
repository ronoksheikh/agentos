import assert from "node:assert/strict";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, isNull } from "drizzle-orm";
import { ulid } from "ulid";
import * as dbs from "@agentos/database";
import { PostgresFeatureFlags, runtimeCapabilityGrants } from "@agentos/feature-flags";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
const pool = new Pool({ connectionString: process.env.DATABASE_URL }); const db = drizzle(pool);
const a = ulid(); const b = ulid(); const userId = ulid(); const actor = { userId, grants: ["feature_flag.manage"] };
try {
  const existing = await db.select({ id: dbs.featureFlags.id }).from(dbs.featureFlags).where(and(isNull(dbs.featureFlags.businessId), eq(dbs.featureFlags.key, "browser"))).limit(1);
  if (existing.length) throw new Error("DISPOSABLE_DATABASE_REQUIRED");
  await db.insert(dbs.businesses).values([{ id: a, name: "Flags A" }, { id: b, name: "Flags B" }]);
  await db.insert(dbs.users).values({ id: userId, name: "Agency flags operator", email: `${userId}@example.test` });
  const flags = new PostgresFeatureFlags(db);
  assert.equal(await flags.effective(a, "browser"), true); assert.equal(await flags.effective(a, "comment_ai"), false);
  assert.ok((await runtimeCapabilityGrants(flags, a, true)).includes("browser.use"));
  assert.equal((await runtimeCapabilityGrants(flags, a, false)).includes("browser.use"), false);
  assert.equal((await flags.set(actor, { key: "browser", enabled: false, expectedRevision: 0 })).revision, 1);
  assert.equal(await flags.effective(a, "browser"), false); assert.equal(await flags.effective(b, "browser"), false);
  assert.equal((await runtimeCapabilityGrants(flags, a, true)).includes("browser.use"), false);
  assert.equal((await flags.set(actor, { businessId: a, key: "browser", enabled: true, expectedRevision: 0 })).revision, 1);
  assert.equal(await flags.effective(a, "browser"), true); assert.equal(await flags.effective(b, "browser"), false);
  assert.equal((await runtimeCapabilityGrants(flags, a, true)).includes("browser.use"), true);
  assert.equal((await runtimeCapabilityGrants(flags, b, true)).includes("browser.use"), false);
  await flags.set(actor, { key: "comment_ai", enabled: true, expectedRevision: 0 });
  assert.equal(await flags.effective(b, "comment_ai"), true);
  await flags.set(actor, { businessId: a, key: "comment_ai", enabled: false, expectedRevision: 0 });
  assert.equal(await flags.effective(a, "comment_ai"), false); assert.equal(await flags.effective(b, "comment_ai"), true);
  await assert.rejects(flags.set(actor, { businessId: a, key: "browser", enabled: false, expectedRevision: 0 }), /CONCURRENT_EDIT/);
  const listed = await flags.list(actor, a); assert.equal(listed.find((item) => item.key === "browser")?.tenant?.enabled, true);
  await flags.clearTenant(actor, a, "browser", 1); assert.equal(await flags.effective(a, "browser"), false);
  await assert.rejects(flags.clearTenant(actor, a, "browser", 1), /CONCURRENT_EDIT/);
  await assert.rejects(flags.set({ userId, grants: [] }, { key: "browser", enabled: true, expectedRevision: 1 }), /FORBIDDEN/);
  assert.ok((await db.select().from(dbs.auditLogs).where(eq(dbs.auditLogs.actorId, userId))).length >= 3);
  console.log("Phase 7 flags: global defaults, tenant overrides, inheritance, revision conflicts, authorization, and audit passed");
} finally { await pool.end(); }
