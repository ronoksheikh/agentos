import { strict as assert } from "node:assert";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { ulid } from "ulid";
import * as db from "@agentos/database";
import { readAgencyUsage } from "../apps/admin/lib/usage";
import { readAgencyOverview } from "../apps/admin/lib/overview";
import { readAgencyBrowserRuns, readAgencyHandoffs, readAgencyIntegrations, readAgencyRuns } from "../apps/admin/lib/agency-operations";

const connectionString = process.env.DATABASE_URL;
if (!connectionString || !new URL(connectionString).pathname.match(/^\/agentos_phase7_usage_[a-z0-9_]+$/i)) throw new Error("USAGE_INTEGRATION_REQUIRES_DISPOSABLE_DATABASE");
const pool = new Pool({ connectionString });
const database = drizzle(pool);
const businessId = ulid(); const agentId = ulid(); const versionId = ulid(); const userId = ulid(); const customerId = ulid(); const conversationId = ulid(); const runId = ulid(); const failedRunId = ulid(); const sessionId = ulid(); const connectionId = ulid();
const businessName = `Usage Drill ${businessId}`; const agentName = `Usage Agent ${agentId}`;

try {
  await database.insert(db.users).values({ id: userId, name: "Usage Drill", email: `${userId}@example.invalid` });
  await database.insert(db.businesses).values({ id: businessId, name: businessName });
  await database.insert(db.agents).values({ id: agentId, businessId, name: agentName });
  await database.insert(db.agentVersions).values({ id: versionId, businessId, agentId, version: 1, state: "PUBLISHED", config: {}, createdBy: userId });
  await database.insert(db.agentRuns).values({ id: runId, businessId, agentId, agentVersionId: versionId, eventId: ulid(), traceId: ulid(), status: "COMPLETED", startedAt: new Date(), completedAt: new Date(), usage: { inputTokens: 12, outputTokens: 7, toolCalls: 1, steps: 1, latencyMs: 20 } });
  await database.insert(db.agentRuns).values({ id: failedRunId, businessId, agentId, agentVersionId: versionId, eventId: ulid(), traceId: ulid(), status: "FAILED", startedAt: new Date(), completedAt: new Date(), usage: { inputTokens: 0, outputTokens: 0, toolCalls: 0, steps: 1, latencyMs: 20 } });
  await database.insert(db.customers).values({ id: customerId, businessId });
  await database.insert(db.conversations).values({ id: conversationId, businessId, customerId, agentId, channel: "web_chat", unread: true, urgent: true, isTest: false });
  await database.insert(db.handoffs).values({ id: ulid(), businessId, conversationId, customerId, channel: "web_chat", reason: "Usage drill", traceId: ulid(), idempotencyKey: `usage:${runId}`, state: "HANDOFF_REQUESTED" });
  await database.insert(db.agentSteps).values({ id: ulid(), businessId, runId, traceId: ulid(), sequence: 1, kind: "MODEL", status: "COMPLETED", safeFacts: { provider: "integration-provider", model: "integration-model", usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 } }, occurredAt: new Date() });
  await database.insert(db.toolCalls).values({ id: ulid(), businessId, runId, traceId: ulid(), toolName: "integration_tool", status: "SUCCEEDED", safeInput: {}, occurredAt: new Date() });
  await database.insert(db.browserSessions).values({ id: sessionId, businessId, runId, ownerId: userId, profileId: "usage-drill", safeUrl: "https://example.invalid/", status: "CLOSED", expiresAt: new Date(Date.now() + 60_000) });
  await database.insert(db.browserRuns).values({ id: ulid(), businessId, sessionId, runId, action: "extract", status: "COMPLETED", occurredAt: new Date() });
  await database.insert(db.channelConnections).values({ id: connectionId, businessId, channel: "facebook_messenger", externalPageId: "test-page-id", agentId, setupMethod: "manual" });
  await database.insert(db.commentClassifierUsages).values([{ id: ulid(), businessId, connectionId, agentId, provider: "openai", model: "classifier-test", inputTokens: 21, outputTokens: 7, labelAccepted: true, latencyMs: 30 }, { id: ulid(), businessId, connectionId, agentId, provider: "openai", model: "classifier-test", inputTokens: 9, outputTokens: 4, labelAccepted: false, latencyMs: 40 }]);
  await database.insert(db.websiteSites).values({ id: ulid(), businessId, agentId, publicKey: ulid(), allowedOrigins: ["https://shop.example.invalid"] });

  const usage = await readAgencyUsage(database, new Date(Date.now() - 30 * 24 * 60 * 60_000));
  assert.equal(Number(usage.totals.runs), 2);
  assert.equal(Number(usage.totals.inputTokens), 12);
  assert.equal(Number(usage.totals.outputTokens), 7);
  assert.equal(Number(usage.totals.toolCalls), 1);
  assert.ok(usage.modelRows.some((row) => row.business === businessName && row.agent === agentName && row.provider === "integration-provider" && row.model === "integration-model" && Number(row.inputTokens) === 12 && Number(row.outputTokens) === 7));
  assert.ok(usage.classifierRows.some((row) => row.business === businessName && row.agent === agentName && row.provider === "openai" && row.model === "classifier-test" && Number(row.requests) === 2 && Number(row.inputTokens) === 30 && Number(row.outputTokens) === 11 && Number(row.parsedLabels) === 1 && Number(row.fallbackLabels) === 1));
  assert.ok(usage.runRows.some((row) => row.runId === runId && Number(row.inputTokens) === 12));
  assert.ok(usage.toolRows.some((row) => row.business === businessName && row.tool === "integration_tool" && Number(row.calls) === 1));
  assert.ok(usage.browserRows.some((row) => row.business === businessName && row.action === "extract" && Number(row.runs) === 1));
  const overview = await readAgencyOverview(database);
  assert.equal(overview.businesses, 1); assert.equal(overview.unread, 1); assert.equal(overview.handoffs, 1); assert.equal(overview.failedRuns, 1);
  const runRows = await readAgencyRuns(database); const browserActivity = await readAgencyBrowserRuns(database); const handoffRows = await readAgencyHandoffs(database); const integrations = await readAgencyIntegrations(database);
  assert.ok(runRows.some((row) => row.id === runId && row.business === businessName && row.agent === agentName));
  assert.ok(browserActivity.some((row) => row.business === businessName && row.action === "extract"));
  assert.ok(handoffRows.some((row) => row.business === businessName && row.conversationId === conversationId));
  assert.equal(integrations.connections[0]?.business, businessName); assert.equal(integrations.sites[0]?.originCount, 1);
  console.log("Phase 7 agency analytics: live overview, runtime and classifier usage, run, browser, handoff, and integration views passed");
} finally { await pool.end(); }
