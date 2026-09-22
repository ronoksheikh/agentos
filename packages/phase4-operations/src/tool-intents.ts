import { ulid } from "ulid";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@agentos/database";
import type { CustomToolIntent, CustomToolIntentStore } from "@agentos/integrations";
import type { ToolExecutionContext } from "@agentos/tools";

/** An uncertain HTTP write is never automatically retried. An operator must reconcile it. */
export class PostgresCustomToolIntentStore implements CustomToolIntentStore {
  constructor(private readonly db: NodePgDatabase) {}
  private async row(context: ToolExecutionContext, toolId: string, key: string) { return (await this.db.select().from(schema.customToolIntents).where(and(eq(schema.customToolIntents.businessId, context.businessId), eq(schema.customToolIntents.toolId, toolId), eq(schema.customToolIntents.intentKey, key))).limit(1))[0]; }
  async inspect(context: ToolExecutionContext, toolId: string, key: string, inputHash: string): Promise<CustomToolIntent | null> { const row = await this.row(context, toolId, key); if (!row) return null; if (row.inputHash !== inputHash) throw new Error("INTENT_INPUT_CONFLICT"); return { status: row.status as CustomToolIntent["status"], inputHash, ...(row.status === "SUCCEEDED" ? { result: row.safeResult } : {}) }; }
  async reserve(context: ToolExecutionContext, toolId: string, key: string, inputHash: string): Promise<CustomToolIntent | { status: "NEW" }> {
    const inserted = await this.db.insert(schema.customToolIntents).values({ id: ulid(), businessId: context.businessId, toolId, runId: context.runId, intentKey: key, inputHash, status: "PENDING" }).onConflictDoNothing({ target: [schema.customToolIntents.businessId, schema.customToolIntents.toolId, schema.customToolIntents.intentKey] }).returning({ id: schema.customToolIntents.id });
    if (inserted.length) return { status: "NEW" };
    const prior = await this.inspect(context, toolId, key, inputHash); if (!prior) throw new Error("INTENT_RECONCILE_FAILED"); return prior;
  }
  async complete(context: ToolExecutionContext, toolId: string, key: string, result: unknown) { const updated = await this.db.update(schema.customToolIntents).set({ status: "SUCCEEDED", safeResult: result, updatedAt: new Date() }).where(and(eq(schema.customToolIntents.businessId, context.businessId), eq(schema.customToolIntents.toolId, toolId), eq(schema.customToolIntents.intentKey, key), eq(schema.customToolIntents.status, "PENDING"))).returning({ id: schema.customToolIntents.id }); if (!updated.length) throw new Error("INTENT_NOT_PENDING"); }
  async markUnknown(context: ToolExecutionContext, toolId: string, key: string) { await this.db.update(schema.customToolIntents).set({ status: "UNKNOWN", updatedAt: new Date() }).where(and(eq(schema.customToolIntents.businessId, context.businessId), eq(schema.customToolIntents.toolId, toolId), eq(schema.customToolIntents.intentKey, key), eq(schema.customToolIntents.status, "PENDING"))); }
}
