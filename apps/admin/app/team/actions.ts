"use server";

import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { ulid } from "ulid";
import { z } from "zod";
import { agencyRoleSchema, businessRoleSchema } from "@agentos/auth";
import { auditLogs, businesses, invitations } from "@agentos/database";
import { database, requireAgencyPage } from "../../lib/server";
import { createInvitationLink, persistInvitation } from "../../lib/invitations";

type InvitationState = { kind: "idle" | "success" | "error"; message: string };

const baseSchema = z.object({ scope: z.enum(["AGENCY", "BUSINESS"]), email: z.string().trim().toLowerCase().pipe(z.email()), role: z.string().min(1), businessId: z.string().optional() });

export async function createInvitationAction(_previous: InvitationState, form: FormData): Promise<InvitationState> {
  const raw = baseSchema.safeParse({ scope: form.get("scope"), email: form.get("email"), role: form.get("role"), businessId: form.get("businessId") || undefined });
  if (!raw.success) return { kind: "error", message: "Enter a valid email and role." };
  const input = raw.data;
  if (input.scope === "AGENCY" && input.businessId) return { kind: "error", message: "Agency invitations cannot be scoped to a business." };
  if (input.scope === "BUSINESS" && !input.businessId) return { kind: "error", message: "Choose a business for this invitation." };
  let role: string;
  try { role = input.scope === "AGENCY" ? agencyRoleSchema.parse(input.role) : businessRoleSchema.parse(input.role); }
  catch { return { kind: "error", message: "The selected role is invalid." }; }

  const access = await requireAgencyPage(input.scope === "AGENCY" ? "agency.manage" : "business.manage");
  const emailGateway = process.env.AUTH_EMAIL_WEBHOOK_URL;
  const appBase = input.scope === "AGENCY" ? process.env.BETTER_AUTH_URL : process.env.CLIENT_BETTER_AUTH_URL;
  if (!emailGateway || !appBase) return { kind: "error", message: "Invitation email delivery is not configured." };
  let invitationBase: string;
  try {
    const base = new URL(appBase);
    if (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname)) throw new Error("INVITATION_BASE_URL_INVALID");
    invitationBase = base.toString();
  } catch { return { kind: "error", message: "Invitation email delivery is not configured." }; }

  const now = new Date();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  let businessName: string | undefined;
  if (input.scope === "BUSINESS") {
    const business = (await database.select({ name: businesses.name }).from(businesses).where(eq(businesses.id, input.businessId!)).limit(1))[0];
    if (!business) return { kind: "error", message: "The selected business could not be found." };
    businessName = business.name;
  }

  let record: { id: string; expiresAt: Date };
  try {
    record = await persistInvitation(database, { scope: input.scope, ...(input.businessId ? { businessId: input.businessId } : {}), email: input.email, role, actorId: access.session.user.id, tokenHash, now });
  } catch (error) {
    if (error instanceof Error && error.message === "ALREADY_MEMBER") return { kind: "error", message: "This email already has access to the selected scope." };
    if (error instanceof Error && error.message === "INVITATION_ALREADY_PENDING") return { kind: "error", message: "An unexpired invitation already exists for this email." };
    return { kind: "error", message: "The invitation could not be created." };
  }

  const delivery = await fetch(emailGateway, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ template: input.scope === "AGENCY" ? "agency-invitation" : "business-invitation", recipient: input.email, url: createInvitationLink(invitationBase, token), expiresAt: record.expiresAt.toISOString(), ...(businessName ? { businessName } : {}) }),
    signal: AbortSignal.timeout(8_000),
  }).then((response) => response.ok).catch(() => false);
  if (!delivery) {
    await database.transaction(async (tx) => {
      await tx.update(invitations).set({ expiresAt: now, updatedAt: now }).where(eq(invitations.id, record.id));
      await tx.insert(auditLogs).values({ id: ulid(), businessId: input.scope === "BUSINESS" ? input.businessId! : null, actorId: access.session.user.id, action: "invitation.delivery_failed", targetType: "invitation", targetId: record.id, safeMetadata: { scope: input.scope } });
    });
    return { kind: "error", message: "The invitation email was not accepted by the configured delivery service; the link was expired." };
  }

  revalidatePath("/team");
  if (input.businessId) revalidatePath(`/businesses/${input.businessId}`);
  return { kind: "success", message: `Invitation email sent to ${input.email}. It expires in 72 hours.` };
}
