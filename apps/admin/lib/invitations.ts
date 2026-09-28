import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ulid } from "ulid";
import { agencyMemberships, auditLogs, businessMemberships, invitations, users } from "@agentos/database";

export function createInvitationLink(acceptanceBase: string, token: string) {
  const link = new URL("/accept-invitation", acceptanceBase);
  link.hash = new URLSearchParams({ token }).toString();
  return link.toString();
}

export async function deliverInvitationEmail(input: { endpoint: string; template: "agency-invitation" | "business-invitation"; recipient: string; url: string; expiresAt: string; businessName?: string; fetcher?: (input: string, init: RequestInit) => Promise<{ ok: boolean }> }) {
  const fetcher = input.fetcher ?? fetch;
  try {
    const response = await fetcher(input.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ template: input.template, recipient: input.recipient, url: input.url, expiresAt: input.expiresAt, ...(input.businessName ? { businessName: input.businessName } : {}) }),
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function expireUndeliveredInvitation(database: NodePgDatabase, input: { invitationId: string; scope: "AGENCY"; actorId: string; now: Date }): Promise<boolean>;
export async function expireUndeliveredInvitation(database: NodePgDatabase, input: { invitationId: string; scope: "BUSINESS"; businessId: string; actorId: string; now: Date }): Promise<boolean>;
export async function expireUndeliveredInvitation(database: NodePgDatabase, input: { invitationId: string; scope: "AGENCY" | "BUSINESS"; businessId?: string; actorId: string; now: Date }) {
  if (input.scope === "BUSINESS" && !input.businessId) throw new Error("INVITATION_BUSINESS_REQUIRED");
  return database.transaction(async (tx) => {
    const rows = await tx.update(invitations).set({ expiresAt: input.now, updatedAt: input.now }).where(and(
      eq(invitations.id, input.invitationId), eq(invitations.scope, input.scope), isNull(invitations.acceptedAt), gt(invitations.expiresAt, input.now),
      input.scope === "AGENCY" ? isNull(invitations.businessId) : eq(invitations.businessId, input.businessId!),
    )).returning({ id: invitations.id });
    if (!rows.length) return false;
    await tx.insert(auditLogs).values({ id: ulid(), businessId: input.scope === "BUSINESS" ? input.businessId! : null, actorId: input.actorId, action: "invitation.delivery_failed", targetType: "invitation", targetId: input.invitationId, safeMetadata: { scope: input.scope } });
    return true;
  });
}

export async function persistInvitation(database: NodePgDatabase, input: { scope: "AGENCY" | "BUSINESS"; businessId?: string; email: string; role: string; actorId: string; tokenHash: string; now: Date }) {
  const id = ulid();
  const email = input.email.trim().toLowerCase();
  const expiresAt = new Date(input.now.getTime() + 72 * 60 * 60 * 1000);
  await database.transaction(async (tx) => {
    const lockKey = `${input.scope}:${input.businessId ?? "agency"}:${email}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const existingMember = input.scope === "AGENCY"
      ? (await tx.select({ id: agencyMemberships.id }).from(agencyMemberships).innerJoin(users, eq(agencyMemberships.userId, users.id)).where(sql`lower(${users.email}) = ${email}`).limit(1))[0]
      : (await tx.select({ id: businessMemberships.id }).from(businessMemberships).innerJoin(users, eq(businessMemberships.userId, users.id)).where(and(eq(businessMemberships.businessId, input.businessId!), sql`lower(${users.email}) = ${email}`)).limit(1))[0];
    if (existingMember) throw new Error("ALREADY_MEMBER");
    const scopeCondition = input.scope === "AGENCY" ? isNull(invitations.businessId) : eq(invitations.businessId, input.businessId!);
    const pending = (await tx.select({ id: invitations.id }).from(invitations).where(and(eq(invitations.scope, input.scope), scopeCondition, sql`lower(${invitations.email}) = ${email}`, isNull(invitations.acceptedAt), gt(invitations.expiresAt, input.now))).limit(1))[0];
    if (pending) throw new Error("INVITATION_ALREADY_PENDING");
    await tx.insert(invitations).values({ id, email, scope: input.scope, role: input.role, businessId: input.scope === "BUSINESS" ? input.businessId! : null, tokenHash: input.tokenHash, invitedBy: input.actorId, expiresAt });
    await tx.insert(auditLogs).values({ id: ulid(), businessId: input.scope === "BUSINESS" ? input.businessId! : null, actorId: input.actorId, action: "invitation.created", targetType: "invitation", targetId: id, safeMetadata: { scope: input.scope, role: input.role, expiresAt: expiresAt.toISOString() } });
  });
  return { id, expiresAt };
}
