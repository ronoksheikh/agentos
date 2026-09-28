import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { businessMemberships, notifications } from "@agentos/database";

export async function notifyMessengerReauthorization(db: NodePgDatabase, businessId: string, connectionId: string, safeCode: string) {
  const members = await db.select({ userId: businessMemberships.userId }).from(businessMemberships).where(eq(businessMemberships.businessId, businessId));
  if (!members.length) return;
  await db.insert(notifications).values(members.map(({ userId }) => ({ id: ulid(), businessId, userId, type: "CHANNEL_REAUTHORIZATION_REQUIRED", severity: "WARNING", dedupeKey: `channel:${connectionId}:reauthorization:${safeCode}`, safePayload: { channel: "facebook_messenger", safeCode } }))).onConflictDoNothing();
}
