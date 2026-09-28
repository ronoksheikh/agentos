import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { Pool, type PoolClient } from "pg";
import { ulid } from "ulid";

type TableCount = { table: string; count: number };
const businessId = process.env.OFFBOARD_BUSINESS_ID ?? "";
const databaseUrl = process.env.DATABASE_URL;
const mode = process.argv[2];
if (!databaseUrl || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(businessId) || !["plan", "purge"].includes(mode ?? "")) throw new Error("Usage: OFFBOARD_BUSINESS_ID=<ULID> DATABASE_URL=<url> bun scripts/phase7-offboard.ts plan|purge");
const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;
const pool = new Pool({ connectionString: databaseUrl });

async function scopedTables(client: PoolClient) {
  const names = (await client.query<{ table_name: string }>("select c.table_name from information_schema.columns c join information_schema.tables t using (table_schema, table_name) where c.table_schema='public' and c.column_name='business_id' and t.table_type='BASE TABLE' order by c.table_name")).rows.map((row) => row.table_name);
  const set = new Set(names);
  const dependencies = await client.query<{ child: string; parent: string }>(`select child.relname as child, parent.relname as parent from pg_constraint constraint_row join pg_class child on child.oid=constraint_row.conrelid join pg_class parent on parent.oid=constraint_row.confrelid join pg_namespace namespace on namespace.oid=child.relnamespace where constraint_row.contype='f' and namespace.nspname='public'`);
  const children = new Map(names.map((name) => [name, [] as string[]]));
  for (const row of dependencies.rows) if (set.has(row.parent) && set.has(row.child) && row.parent !== row.child) children.get(row.parent)!.push(row.child);
  const active = new Set<string>(); const visited = new Set<string>(); const order: string[] = [];
  const visit = (name: string) => {
    if (active.has(name)) throw new Error("OFFBOARD_FOREIGN_KEY_CYCLE");
    if (visited.has(name)) return;
    active.add(name);
    for (const child of children.get(name) ?? []) visit(child);
    active.delete(name); visited.add(name); order.push(name);
  };
  for (const name of names) visit(name);
  return order;
}

async function inventory(client: PoolClient, tables: string[]): Promise<TableCount[]> {
  const counts: TableCount[] = [];
  for (const table of tables) {
    const result = await client.query<{ count: string }>(`select count(*)::text as count from ${quoted(table)} where business_id=$1`, [businessId]);
    counts.push({ table, count: Number(result.rows[0]!.count) });
  }
  return counts.filter((row) => row.count > 0);
}

async function verifyBackup(client: PoolClient) {
  const source = process.env.OFFBOARD_BACKUP_SOURCE;
  if (!source || !isAbsolute(source)) throw new Error("OFFBOARD_BACKUP_REQUIRED");
  const manifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8")) as { version?: number; createdAt?: string; databaseName?: string; businessIds?: string[]; files?: Array<{ path: string; sha256: string; bytes: number }> };
  const dump = manifest.files?.find((entry) => entry.path === "database.dump");
  const age = Date.now() - Date.parse(manifest.createdAt ?? "");
  const databaseName = decodeURIComponent(new URL(databaseUrl!).pathname.slice(1));
  if (manifest.version !== 2 || manifest.databaseName !== databaseName || !manifest.businessIds?.includes(businessId) || !dump || !Number.isFinite(age) || age < 0 || age > 24 * 60 * 60_000 || !/^[a-f0-9]{64}$/.test(dump.sha256)) throw new Error("OFFBOARD_BACKUP_INVALID");
  const file = join(source, "database.dump"); const stat = await lstat(file);
  if (!stat.isFile() || stat.size !== dump.bytes) throw new Error("OFFBOARD_BACKUP_INVALID");
  const digest = createHash("sha256"); for await (const chunk of createReadStream(file)) digest.update(chunk);
  if (digest.digest("hex") !== dump.sha256) throw new Error("OFFBOARD_BACKUP_INVALID");
  const backedUpObjects = new Set(manifest.files?.filter((entry) => entry.path.startsWith(`${businessId}/attachments/`) && /^[0-9A-HJKMNP-TV-Z]{26}\/attachments\/[0-9A-HJKMNP-TV-Z]{26}\/[a-f0-9]{64}$/i.test(entry.path)).map((entry) => entry.path) ?? []);
  const currentObjects = (await client.query<{ object_key: string }>("select object_key from attachments where business_id=$1 and object_key is not null", [businessId])).rows.map((row) => row.object_key);
  if (currentObjects.some((key) => !backedUpObjects.has(key))) throw new Error("OFFBOARD_BACKUP_MISSING_MEDIA");
  for (const entry of manifest.files?.filter((row) => backedUpObjects.has(row.path)) ?? []) {
    const object = join(source, "media", entry.path);
    const objectStat = await lstat(object);
    if (!objectStat.isFile() || objectStat.size !== entry.bytes) throw new Error("OFFBOARD_BACKUP_INVALID");
    const mediaDigest = createHash("sha256"); for await (const chunk of createReadStream(object)) mediaDigest.update(chunk);
    if (mediaDigest.digest("hex") !== entry.sha256) throw new Error("OFFBOARD_BACKUP_INVALID");
  }
}

async function readiness(client: PoolClient) {
  const business = (await client.query<{ state: string; disabled: boolean }>("select state, disabled from businesses where id=$1 for update", [businessId])).rows[0];
  if (!business) throw new Error("BUSINESS_NOT_FOUND");
  if (business.state !== "CANCELLED" || !business.disabled) throw new Error("OFFBOARD_BUSINESS_STILL_ACTIVE");
  const checks = [
    ["channel_connections", "paused=false"],
    ["website_sites", "enabled=true"],
    ["work_items", "state in ('PENDING','QUEUED','RUNNING')"],
    ["effect_intents", "state in ('RESERVED','EXECUTING','UNKNOWN')"],
    ["browser_sessions", "status in ('OPEN','RUNNING')"],
  ] as const;
  for (const [table, condition] of checks) {
    const found = await client.query(`select 1 from ${quoted(table)} where business_id=$1 and ${condition} limit 1`, [businessId]);
    if (found.rowCount) throw new Error(`OFFBOARD_NOT_DRAINED_${table.toUpperCase()}`);
  }
}

try {
  const client = await pool.connect();
  try {
    const tables = await scopedTables(client);
    if (tables.length < 40 || !["attachments", "business_memberships", "channel_connections", "messages", "audit_logs"].every((name) => tables.includes(name))) throw new Error("OFFBOARD_SCHEMA_UNEXPECTED");
    if (mode === "plan") {
      const business = (await client.query<{ state: string; disabled: boolean }>("select state, disabled from businesses where id=$1", [businessId])).rows[0];
      if (!business) throw new Error("BUSINESS_NOT_FOUND");
      console.log(JSON.stringify({ businessId, state: business.state, disabled: business.disabled, tables: await inventory(client, tables) }, null, 2));
    } else {
      if (process.env.OFFBOARD_CONFIRM !== `DELETE:${businessId}` || process.env.OFFBOARD_LEGAL_HOLD_CLEARED !== "1" || process.env.OFFBOARD_EXPORT_APPROVED !== "1" || process.env.OFFBOARD_EXTERNAL_TOKENS_REVOKED !== "1") throw new Error("OFFBOARD_ATTESTATION_REQUIRED");
      const operator = process.env.OFFBOARD_OPERATOR_ID;
      if (!operator || operator.length > 100 || /\s/.test(operator)) throw new Error("OFFBOARD_OPERATOR_REQUIRED");
      const mediaRoot = process.env.PRIVATE_MEDIA_DIR;
      if (!mediaRoot || !isAbsolute(mediaRoot) || resolve(mediaRoot) === "/") throw new Error("OFFBOARD_MEDIA_ROOT_INVALID");
      const mediaRootStat = await lstat(mediaRoot);
      if (!mediaRootStat.isDirectory() || mediaRootStat.isSymbolicLink()) throw new Error("OFFBOARD_MEDIA_ROOT_INVALID");
      await client.query("begin");
      try {
        await readiness(client);
        await verifyBackup(client);
        const counts = await inventory(client, tables);
        const mediaPath = join(resolve(mediaRoot), businessId);
        try {
          const businessMediaStat = await lstat(mediaPath);
          if (!businessMediaStat.isDirectory() || businessMediaStat.isSymbolicLink()) throw new Error("OFFBOARD_MEDIA_PATH_INVALID");
        } catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error; }
        await rm(mediaPath, { recursive: true, force: true });
        for (const table of tables) await client.query(`delete from ${quoted(table)} where business_id=$1`, [businessId]);
        const deleted = await client.query("delete from businesses where id=$1 returning id", [businessId]);
        if (deleted.rowCount !== 1) throw new Error("BUSINESS_NOT_FOUND");
        await client.query("insert into audit_logs (id, business_id, actor_id, action, target_type, target_id, safe_metadata) values ($1, null, $2, 'business.offboarded', 'business', $3, $4)", [ulid(), operator, businessId, JSON.stringify({ tableCounts: counts })]);
        await client.query("commit");
        console.log(JSON.stringify({ status: "OFFBOARD_PURGED", businessId, tables: counts.length }));
      } catch (error) { await client.query("rollback"); throw error; }
    }
  } finally { client.release(); }
} finally { await pool.end(); }
