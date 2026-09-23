import assert from "node:assert/strict";
import { ulid } from "ulid";
import { RemoteBrowserAdapter, type BrowserPolicy } from "@agentos/web";

const endpoint = process.env.BROWSER_WORKER_URL ?? "http://127.0.0.1:4317";
const token = process.env.BROWSER_WORKER_TOKEN ?? "";
const adapter = new RemoteBrowserAdapter(endpoint, token);
const policy: BrowserPolicy = { allowedDomains: ["browser.test"], deniedDomains: [], timeoutMs: 30_000, maxActions: 20, maxEgress: 20, allowDownloads: false, allowUploads: false };
const signal = new AbortController().signal;
const businessA = ulid(), businessB = ulid(), sessionA = ulid(), sessionB = ulid();

await adapter.open(sessionA, "https://browser.test/", signal, businessA, policy);
await adapter.open(sessionB, "https://browser.test/", signal, businessB, policy);
await adapter.type(sessionA, "#name", "Tenant A", signal);
await adapter.click(sessionA, "#go", signal);
assert.equal(await adapter.extract(sessionA, "#result", signal), "Tenant A");
assert.equal(await adapter.extract(sessionB, "#result", signal), "Ready");
assert.ok((await adapter.screenshot(sessionA, signal)).objectRef.startsWith(`${businessA}/screenshots/${sessionA}/`));
assert.ok((await adapter.screenshot(sessionB, signal)).objectRef.startsWith(`${businessB}/screenshots/${sessionB}/`));

const restart = Bun.spawn(["docker", "compose", "-f", "docker-compose.browser.yml", "-f", "tests/browser.compose.yml", "restart", "browser-worker"], { stdout: "inherit", stderr: "inherit" });
assert.equal(await restart.exited, 0);
let ready = false;
for (let attempt = 0; attempt < 40; attempt++) {
  try { ready = (await fetch(new URL("/health", endpoint), { signal: AbortSignal.timeout(1000) })).ok; } catch { ready = false; }
  if (ready) break;
  await Bun.sleep(250);
}
assert.ok(ready, "Browser Use worker did not recover after restart");
await assert.rejects(adapter.extract(sessionA, "#result", signal));
await assert.rejects(adapter.extract(sessionB, "#result", signal));

const freshId = ulid();
const fresh = await adapter.open(freshId, "https://browser.test/", signal, businessA, policy);
assert.equal(fresh.title, "AgentOS browser test");
await adapter.close(freshId);
console.log("Browser Use restart passed: isolated tenants, private screenshots, stale-session rejection, and fresh-session recovery.");
