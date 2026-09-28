import { strict as assert } from "node:assert";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { ulid } from "ulid";
import * as db from "@agentos/database";
import { expireUndeliveredInvitation, persistInvitation } from "../apps/admin/lib/invitations";

const connectionString = process.env.DATABASE_URL;
if (!connectionString || !new URL(connectionString).pathname.match(/^\/agentos_phase7_invite_[a-z0-9_]+$/i)) throw new Error("INVITATION_INTEGRATION_REQUIRES_DISPOSABLE_DATABASE");
const pool = new Pool({ connectionString });
const database = drizzle(pool);
const actorId = ulid();
const businessId = ulid();
const now = new Date();

try {
  await database.insert(db.users).values({ id: actorId, name: "Invitation Drill", email: `${actorId}@example.invalid` });
  await database.insert(db.agencyMemberships).values({ id: ulid(), userId: actorId, role: "SUPER_ADMIN" });
  await database.insert(db.businesses).values({ id: businessId, name: `Invitation Drill ${businessId}` });

  const agencyEmail = `agency-${ulid()}@example.invalid`;
  const agencyHash = "a".repeat(64);
  const agencyInvite = await persistInvitation(database, { scope: "AGENCY", email: agencyEmail, role: "SUPPORT", actorId, tokenHash: agencyHash, now });
  const agencyRow = (await database.select().from(db.invitations).where(eq(db.invitations.id, agencyInvite.id)).limit(1))[0];
  assert.equal(agencyRow.scope, "AGENCY");
  assert.equal(agencyRow.businessId, null);
  assert.equal(agencyRow.tokenHash, agencyHash);
  assert.equal(agencyRow.expiresAt.getTime() - now.getTime(), 72 * 60 * 60 * 1000);

  await assert.rejects(() => persistInvitation(database, { scope: "AGENCY", email: agencyEmail.toUpperCase(), role: "ADMIN", actorId, tokenHash: "b".repeat(64), now }), /INVITATION_ALREADY_PENDING/);

  const businessEmail = `business-${ulid()}@example.invalid`;
  const businessInvite = await persistInvitation(database, { scope: "BUSINESS", businessId, email: businessEmail, role: "STAFF", actorId, tokenHash: "c".repeat(64), now });
  const businessRow = (await database.select().from(db.invitations).where(eq(db.invitations.id, businessInvite.id)).limit(1))[0];
  assert.equal(businessRow.scope, "BUSINESS");
  assert.equal(businessRow.businessId, businessId);

  const duplicateEmail = `race-${ulid()}@example.invalid`.toLowerCase();
  const racing = await Promise.allSettled([
    persistInvitation(database, { scope: "BUSINESS", businessId, email: duplicateEmail, role: "STAFF", actorId, tokenHash: "d".repeat(64), now }),
    persistInvitation(database, { scope: "BUSINESS", businessId, email: duplicateEmail, role: "VIEWER", actorId, tokenHash: "e".repeat(64), now }),
  ]);
  assert.equal(racing.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(racing.filter((result) => result.status === "rejected").length, 1);
  const raceRows = await database.select().from(db.invitations).where(and(eq(db.invitations.businessId, businessId), eq(db.invitations.email, duplicateEmail)));
  assert.equal(raceRows.length, 1);

  const failedEmail = "failed-" + ulid() + "@example.invalid";
  const failedInvite = await persistInvitation(database, { scope: "BUSINESS", businessId, email: failedEmail, role: "VIEWER", actorId, tokenHash: "f".repeat(64), now });
  const failedAt = new Date(now.getTime() + 1_000);
  assert.equal(await expireUndeliveredInvitation(database, { invitationId: failedInvite.id, scope: "BUSINESS", businessId, actorId, now: failedAt }), true);
  const failedRow = (await database.select().from(db.invitations).where(eq(db.invitations.id, failedInvite.id)).limit(1))[0]!;
  assert.equal(failedRow.expiresAt.getTime(), failedAt.getTime());
  const failedAudit = (await database.select().from(db.auditLogs).where(and(eq(db.auditLogs.targetId, failedInvite.id), eq(db.auditLogs.action, "invitation.delivery_failed"))).limit(1))[0]!;
  assert.deepEqual(failedAudit.safeMetadata, { scope: "BUSINESS" });

  const acceptedEmail = "accepted-" + ulid() + "@example.invalid";
  const acceptedInvite = await persistInvitation(database, { scope: "BUSINESS", businessId, email: acceptedEmail, role: "VIEWER", actorId, tokenHash: "g".repeat(64), now });
  const acceptedAt = new Date(now.getTime() + 500);
  await database.update(db.invitations).set({ acceptedAt, updatedAt: acceptedAt }).where(eq(db.invitations.id, acceptedInvite.id));
  assert.equal(await expireUndeliveredInvitation(database, { invitationId: acceptedInvite.id, scope: "BUSINESS", businessId, actorId, now: failedAt }), false);
  const acceptedRow = (await database.select().from(db.invitations).where(eq(db.invitations.id, acceptedInvite.id)).limit(1))[0]!;
  assert.equal(acceptedRow.expiresAt.getTime(), acceptedInvite.expiresAt.getTime());
  assert.equal(acceptedRow.acceptedAt?.getTime(), acceptedAt.getTime());

  const auditRows = await database.select().from(db.auditLogs).where(and(eq(db.auditLogs.actorId, actorId), eq(db.auditLogs.action, "invitation.created")));
  assert.equal(auditRows.length, 5);
  assert.ok(auditRows.every((row) => !JSON.stringify(row.safeMetadata).includes(agencyHash)));
  console.log("Phase 7 invitations: agency/business scoping, hashed token storage, expiry, audit, duplicate checks, concurrent issuance, delivery-failure expiry, and accepted-link race protection passed");
} finally {
  await pool.end();
}
