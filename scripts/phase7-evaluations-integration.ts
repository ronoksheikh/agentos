import assert from "node:assert/strict";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as dbs from "@agentos/database";
import { AgentVersionService, agentVersionConfigSchema, runAgentEvaluation, type AgentEvaluationCase } from "@agentos/agents";
import { createTrustedBusinessContext } from "@agentos/shared";
import { PostgresAgentEvaluationRepository, PostgresAgentVersionRepository } from "@agentos/phase6";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
const pool = new Pool({ connectionString: process.env.DATABASE_URL }); const db = drizzle(pool);
const businessId = ulid(); const userId = ulid(); const agentId = ulid(); const versionId = ulid(); const results = new PostgresAgentEvaluationRepository(db);
const now = new Date();
const version = { id: versionId, businessId, agentId, version: 1, state: "DRAFT" as const, config: agentVersionConfigSchema.parse({ name: "Evaluation fixture", instructions: "Follow the safe action policy.", models: { primary: { provider: "openai", model: "fixture" } }, contextPolicy: {}, runtimeLimits: {} }), createdBy: userId, createdAt: now.toISOString(), publishedAt: null };
const context = createTrustedBusinessContext({ businessId, principal: { kind: "user", userId, sessionId: ulid() }, source: "test_harness", agentId, traceId: ulid() });
try {
  await db.insert(dbs.businesses).values({ id: businessId, name: "Evaluation integration fixture" });
  await db.insert(dbs.users).values({ id: userId, name: "Evaluation fixture operator", email: `${userId}@example.test` });
  await db.insert(dbs.agents).values({ id: agentId, businessId, name: version.config.name });
  await db.insert(dbs.agentVersions).values({ id: versionId, businessId, agentId, version: 1, state: "DRAFT", config: version.config, createdBy: userId });

  const execute = async (_version: typeof version, scenario: AgentEvaluationCase) => scenario.expectedStatus === "FAILED"
    ? { status: "FAILED" as const, actionTypes: [], safeFailureCode: "MODEL_TIMEOUT" }
    : { status: "COMPLETED" as const, actionTypes: [...scenario.expectedActions] };
  const failed = await runAgentEvaluation({ version, results, async execute(_version, scenario) { return scenario.id === "handoff" ? { status: "COMPLETED", actionTypes: ["SendMessage"] } : execute(_version, scenario); } });
  assert.equal(failed.status, "FAILED");
  const versions = new AgentVersionService(new PostgresAgentVersionRepository(db), results);
  await assert.rejects(versions.publish(context, agentId, versionId, userId), /CURRENT_EVALUATION_REQUIRED/);

  const passed = await runAgentEvaluation({ version, results, execute });
  assert.equal(passed.status, "PASSED");
  await versions.publish(context, agentId, versionId, userId);
  const stored = await results.latestForVersion(businessId, versionId);
  assert.equal(stored?.status, "PASSED");
  assert.equal(JSON.stringify(stored).includes("How much does the blue backpack cost?"), false);
  assert.equal((await db.select({ id: dbs.agentEvaluationRuns.id }).from(dbs.agentEvaluationRuns).where(and(eq(dbs.agentEvaluationRuns.businessId, businessId), eq(dbs.agentEvaluationRuns.agentVersionId, versionId)))).length, 2);
  console.log("Phase 7 evaluations: persistent safe results, regression comparison, and publish gate passed");
} finally {
  await db.delete(dbs.agentEvaluationRuns).where(eq(dbs.agentEvaluationRuns.businessId, businessId));
  await db.delete(dbs.agentVersions).where(eq(dbs.agentVersions.businessId, businessId));
  await db.delete(dbs.agents).where(eq(dbs.agents.businessId, businessId));
  await db.delete(dbs.auditLogs).where(eq(dbs.auditLogs.businessId, businessId));
  await db.delete(dbs.users).where(eq(dbs.users.id, userId));
  await db.delete(dbs.businesses).where(eq(dbs.businesses.id, businessId));
  await pool.end();
}
