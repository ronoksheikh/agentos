import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import { agencyMemberships, auditLogs, invitations } from "@agentos/database";
import { agencyRoleSchema } from "@agentos/auth";
import { auth, database } from "../../../../lib/server";

const requestSchema = z.object({ token: z.string().min(32), name: z.string().min(1).max(200), password: z.string().min(12).max(128) });

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json()); const hash = createHash("sha256").update(body.token).digest("hex");
    const invite = (await database.select().from(invitations).where(and(eq(invitations.tokenHash, hash), eq(invitations.scope, "AGENCY"), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date()))).limit(1))[0];
    if (!invite) return Response.json({ code: "INVITATION_INVALID", message: "Invitation is invalid or expired" }, { status: 400 });
    const created = await auth.api.signUpEmail({ body: { email: invite.email, password: body.password, name: body.name } });
    await database.transaction(async (tx) => {
      const accepted = await tx.update(invitations).set({ acceptedAt: new Date(), updatedAt: new Date() }).where(and(eq(invitations.id, invite.id), isNull(invitations.acceptedAt))).returning({ id: invitations.id });
      if (!accepted[0]) throw new Error("INVITATION_ALREADY_USED");
      await tx.insert(agencyMemberships).values({ id: ulid(), userId: created.user.id, role: agencyRoleSchema.parse(invite.role), capabilities: [] });
      await tx.insert(auditLogs).values({ id: ulid(), businessId: null, actorId: created.user.id, action: "invitation.accepted", targetType: "invitation", targetId: invite.id, safeMetadata: { scope: "AGENCY" } });
    });
    return Response.json({ accepted: true });
  } catch { return Response.json({ code: "INVITATION_INVALID", message: "Invitation could not be accepted" }, { status: 400 }); }
}
