import { and, eq, lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@agentos/database";
import type { BrowserActivity, BrowserPersistence, BrowserSession } from "@agentos/web";
import type { ToolExecutionContext } from "@agentos/tools";

const safeUrl = (raw: string) => new URL(raw).origin.slice(0, 500);
export class PostgresBrowserRepository implements BrowserPersistence {
  constructor(private readonly db: NodePgDatabase) {}
  async recoverLostSessions() { await this.db.update(schema.browserSessions).set({ status: "FAILED", updatedAt: new Date() }).where(and(eq(schema.browserSessions.status, "OPEN"), lt(schema.browserSessions.expiresAt, new Date()))); }
  async saveSession(context: ToolExecutionContext, session: BrowserSession) {
    if (session.businessId !== context.businessId || session.runId !== context.runId) throw new Error("BROWSER_SCOPE_INVALID");
    const previous = (await this.db.select({ businessId: schema.browserSessions.businessId }).from(schema.browserSessions).where(eq(schema.browserSessions.id, session.id)).limit(1))[0];
    if (previous && previous.businessId !== context.businessId) throw new Error("BROWSER_SCOPE_INVALID");
    const values = { safeUrl: safeUrl(session.url), status: session.status, actions: session.actions, egress: session.egress, updatedAt: new Date() };
    if (previous) await this.db.update(schema.browserSessions).set(values).where(and(eq(schema.browserSessions.id, session.id), eq(schema.browserSessions.businessId, context.businessId)));
    else await this.db.insert(schema.browserSessions).values({ id: session.id, businessId: context.businessId, runId: context.runId, ownerId: session.ownerId, profileId: session.profileId, expiresAt: new Date(session.expiresAt), createdAt: new Date(session.createdAt), ...values });
  }
  async recordActivity(context: ToolExecutionContext, activity: BrowserActivity) {
    if (activity.businessId !== context.businessId || activity.runId !== context.runId) throw new Error("BROWSER_SCOPE_INVALID");
    await this.db.insert(schema.browserRuns).values({ id: activity.id, businessId: context.businessId, sessionId: activity.sessionId, runId: context.runId, action: activity.action, status: activity.status, safeUrl: activity.safeUrl ? safeUrl(activity.safeUrl) : null, occurredAt: new Date(activity.at) });
  }
}
