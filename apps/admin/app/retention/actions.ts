"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { agencyCapabilities, agencyRoleSchema } from "@agentos/auth";
import { PostgresBusinessRetentionPolicies } from "@agentos/phase4-operations";
import { ulidSchema } from "@agentos/shared";
import { database, requireAgencyPage } from "../../lib/server";

const policies = new PostgresBusinessRetentionPolicies(database);
const days = (form: FormData, key: string) => {
  const value = String(form.get(key) ?? "").trim();
  if (!value) return null;
  if (!/^[0-9]{1,4}$/.test(value)) throw new Error("RETENTION_DAYS_INVALID");
  const parsed = Number(value);
  if (parsed < 1 || parsed > 3650) throw new Error("RETENTION_DAYS_INVALID");
  return parsed;
};

export async function saveRetentionPolicyAction(form: FormData) {
  const businessId = String(form.get("businessId") ?? "");
  let notice = "retention-updated";
  try {
    const access = await requireAgencyPage("retention.manage");
    const actor = { userId: access.session.user.id, grants: agencyCapabilities(agencyRoleSchema.parse(access.membership.role), access.membership.capabilities) };
    const id = ulidSchema.parse(businessId);
    await policies.set(actor, {
      businessId: id,
      enabled: form.get("enabled") === "true",
      expectedRevision: Number(form.get("expectedRevision")),
      messagesDays: days(form, "messagesDays"),
      eventPayloadDays: days(form, "eventPayloadDays"),
      traceDetailsDays: days(form, "traceDetailsDays"),
      realtimePayloadDays: days(form, "realtimePayloadDays"),
      browserHistoryDays: days(form, "browserHistoryDays"),
      commentTextDays: days(form, "commentTextDays"),
      customerContentDays: days(form, "customerContentDays"),
      orderNotesDays: days(form, "orderNotesDays"),
      resolvedGoalsDays: days(form, "resolvedGoalsDays"),
      expiredAnnouncementsDays: days(form, "expiredAnnouncementsDays"),
      auditMetadataDays: days(form, "auditMetadataDays"),
      confirmScrub: String(form.get("confirmScrub") ?? ""),
    });
    revalidatePath("/retention");
  } catch (error) {
    notice = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message.toLowerCase().replaceAll("_", "-") : "retention-update-failed";
  }
  redirect(`/retention?business=${encodeURIComponent(businessId)}&notice=${notice}`);
}
