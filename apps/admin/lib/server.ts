import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createBetterAuth, requireAgencyCapability, agencyRoleSchema } from "@agentos/auth";
import { agencyMemberships, users } from "@agentos/database";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://agentos:agentos@localhost:5432/agentos";
const authSecret = process.env.BETTER_AUTH_SECRET ?? "development-only-secret-change-me-now";
export const database = drizzle(new Pool({ connectionString: databaseUrl }));
export const auth = createBetterAuth(database, authSecret, process.env.BETTER_AUTH_URL ?? "http://localhost:3000");

export async function requireAgencyPage(capability: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const rows = await database.select({ id: users.id, state: users.state, role: agencyMemberships.role, capabilities: agencyMemberships.capabilities }).from(users).innerJoin(agencyMemberships, eq(agencyMemberships.userId, users.id)).where(and(eq(users.id, session.user.id), eq(users.state, "ACTIVE"))).limit(1);
  const row = rows[0]; if (!row) redirect("/sign-in?reason=disabled");
  requireAgencyCapability({ role: agencyRoleSchema.parse(row.role), capabilities: row.capabilities }, capability);
  return { session, membership: row };
}
