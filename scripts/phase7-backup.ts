import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { Pool } from "pg";

type FileEntry = { path: string; bytes: number; sha256: string };
type Manifest = { version: 1; createdAt: string; postgresMajor: number; files: FileEntry[] };
const objectPath = /^[0-9A-HJKMNP-TV-Z]{26}\/attachments\/[0-9A-HJKMNP-TV-Z]{26}\/[a-f0-9]{64}$/i;
const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`${name}_REQUIRED`); return value; };
const inside = (parent: string, child: string) => child === parent || child.startsWith(`${parent}${sep}`);
const hash = async (path: string) => { const digest = createHash("sha256"); for await (const chunk of createReadStream(path)) digest.update(chunk); return digest.digest("hex"); };

async function files(root: string, prefix = ""): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await files(root, path));
    else if (entry.isFile() && objectPath.test(path)) result.push(path);
    else throw new Error("MEDIA_TREE_UNSAFE");
  }
  return result.sort();
}

function pgEnvironment(databaseUrl: string) {
  const url = new URL(databaseUrl);
  if (!/[A-Za-z0-9_.-]+/.test(url.hostname) || !url.pathname.slice(1) || !["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("DATABASE_URL_INVALID");
  const sslmode = url.searchParams.get("sslmode");
  return { ...process.env, PGHOST: url.hostname, PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: decodeURIComponent(url.pathname.slice(1)), ...(sslmode ? { PGSSLMODE: sslmode } : {}) };
}

const binary = (command: string) => process.env.PG_BIN_DIR ? join(process.env.PG_BIN_DIR, command) : command;
async function postgres(command: string, args: string[], databaseUrl: string) {
  const proc = Bun.spawn([binary(command), ...args], { env: pgEnvironment(databaseUrl), stdout: "ignore", stderr: "pipe" });
  await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${command.toUpperCase().replaceAll("-", "_")}_FAILED_${code}`);
}

async function postgresMajor(databaseUrl: string, command: "pg_dump" | "pg_restore") {
  const pool = new Pool({ connectionString: databaseUrl });
  let major: number;
  try {
    const result = await pool.query<{ server_version_num: string }>("show server_version_num");
    major = Math.floor(Number(result.rows[0]?.server_version_num) / 10000);
  } finally { await pool.end(); }
  const proc = Bun.spawn([binary(command), "--version"], { stdout: "pipe", stderr: "ignore" });
  const version = await new Response(proc.stdout).text();
  if (await proc.exited !== 0 || !version.includes(` ${major}.`)) throw new Error("POSTGRES_CLIENT_SERVER_VERSION_MISMATCH");
  return major;
}

async function backup() {
  const databaseUrl = required("DATABASE_URL");
  const mediaRoot = resolve(required("PRIVATE_MEDIA_DIR"));
  const destination = resolve(required("BACKUP_DIR"));
  if (!isAbsolute(required("BACKUP_DIR")) || inside(mediaRoot, destination) || inside(destination, mediaRoot)) throw new Error("BACKUP_PATH_INVALID");
  if (!(await lstat(mediaRoot)).isDirectory()) throw new Error("MEDIA_ROOT_INVALID");
  try { await lstat(destination); throw new Error("BACKUP_DESTINATION_EXISTS"); } catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== "ENOENT") throw error; }
  const major = await postgresMajor(databaseUrl, "pg_dump");
  await mkdir(destination, { mode: 0o700 });
  try {
    await postgres("pg_dump", ["-Fc", "--no-owner", "--no-acl", "-f", join(destination, "database.dump")], databaseUrl);
    const entries: FileEntry[] = [];
    const mediaDestination = join(destination, "media");
    await mkdir(mediaDestination, { mode: 0o700 });
    for (const path of await files(mediaRoot)) {
      const source = join(mediaRoot, path);
      if (!(await lstat(source)).isFile()) throw new Error("MEDIA_TREE_UNSAFE");
      const target = join(mediaDestination, path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await copyFile(source, target);
      await chmod(target, 0o600);
      const stat = await lstat(target);
      entries.push({ path, bytes: stat.size, sha256: await hash(target) });
    }
    const dbPath = join(destination, "database.dump");
    const dbStat = await lstat(dbPath);
    const manifest: Manifest = { version: 1, createdAt: new Date().toISOString(), postgresMajor: major, files: [{ path: "database.dump", bytes: dbStat.size, sha256: await hash(dbPath) }, ...entries] };
    await writeFile(join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    console.log(`BACKUP_COMPLETE files=${entries.length} directory=${destination}`);
  } catch (error) { await rm(destination, { recursive: true, force: true }); throw error; }
}

async function restore() {
  const databaseUrl = required("RESTORE_DATABASE_URL");
  const source = resolve(required("BACKUP_SOURCE"));
  const mediaTarget = resolve(required("RESTORE_MEDIA_DIR"));
  if (!isAbsolute(required("BACKUP_SOURCE")) || !isAbsolute(required("RESTORE_MEDIA_DIR")) || inside(source, mediaTarget) || inside(mediaTarget, source)) throw new Error("RESTORE_PATH_INVALID");
  const manifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8")) as Manifest;
  if (manifest.version !== 1 || !Number.isInteger(manifest.postgresMajor) || !Array.isArray(manifest.files) || manifest.files[0]?.path !== "database.dump") throw new Error("BACKUP_FORMAT_INVALID");
  const seen = new Set<string>();
  for (const entry of manifest.files) {
    if (typeof entry.path !== "string" || entry.path !== "database.dump" && !objectPath.test(entry.path) || seen.has(entry.path) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("BACKUP_FORMAT_INVALID");
    seen.add(entry.path);
    const path = entry.path === "database.dump" ? join(source, entry.path) : join(source, "media", entry.path);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size !== entry.bytes || await hash(path) !== entry.sha256) throw new Error("BACKUP_INTEGRITY_FAILED");
  }
  const actualMedia = await files(join(source, "media"));
  if (actualMedia.length !== seen.size - 1 || actualMedia.some((path) => !seen.has(path))) throw new Error("BACKUP_FORMAT_INVALID");
  if (await postgresMajor(databaseUrl, "pg_restore") !== manifest.postgresMajor) throw new Error("BACKUP_SERVER_VERSION_MISMATCH");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const tables = await pool.query<{ count: string }>("select count(*)::text as count from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'");
    if (Number(tables.rows[0]?.count) !== 0) throw new Error("RESTORE_DATABASE_NOT_EMPTY");
  } finally { await pool.end(); }
  try { await lstat(mediaTarget); throw new Error("RESTORE_MEDIA_EXISTS"); } catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== "ENOENT") throw error; }
  await postgres("pg_restore", ["--single-transaction", "--exit-on-error", "--no-owner", "--no-acl", "-d", decodeURIComponent(new URL(databaseUrl).pathname.slice(1)), join(source, "database.dump")], databaseUrl);
  await mkdir(mediaTarget, { recursive: true, mode: 0o700 });
  try {
    for (const entry of manifest.files.slice(1)) {
      const destination = join(mediaTarget, entry.path);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await copyFile(join(source, "media", entry.path), destination);
      await chmod(destination, 0o600);
    }
  } catch (error) { await rm(mediaTarget, { recursive: true, force: true }); throw error; }
  console.log(`RESTORE_COMPLETE files=${manifest.files.length - 1} media=${mediaTarget}`);
}

process.umask(0o077);
const mode = process.argv[2];
if (mode === "backup") await backup();
else if (mode === "restore") await restore();
else throw new Error("Usage: bun scripts/phase7-backup.ts backup|restore");
