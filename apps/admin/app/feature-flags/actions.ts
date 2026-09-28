"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { agencyCapabilities, agencyRoleSchema } from "@agentos/auth";
import { featureFlagKeySchema, PostgresFeatureFlags } from "@agentos/feature-flags";
import { ulidSchema } from "@agentos/shared";
import { database, requireAgencyPage } from "../../lib/server";

const flags = new PostgresFeatureFlags(database);
export async function changeFeatureFlagAction(form: FormData) {
  const businessId = String(form.get("businessId") ?? ""); let notice = "flag-updated";
  try {
    const access = await requireAgencyPage("feature_flag.manage");
    const actor = { userId: access.session.user.id, grants: agencyCapabilities(agencyRoleSchema.parse(access.membership.role), access.membership.capabilities) };
    const key = featureFlagKeySchema.parse(form.get("key"));
    const revision = Number(form.get("expectedRevision"));
    if (form.get("scope") === "tenant") {
      const id = ulidSchema.parse(businessId);
      if (form.get("mode") === "clear") await flags.clearTenant(actor, id, key, revision);
      else await flags.set(actor, { businessId: id, key, enabled: form.get("enabled") === "true", expectedRevision: revision });
    } else if (form.get("scope") === "global") await flags.set(actor, { key, enabled: form.get("enabled") === "true", expectedRevision: revision });
    else throw new Error("FLAG_SCOPE_INVALID");
    revalidatePath("/feature-flags");
  } catch (error) { notice = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message.toLowerCase().replaceAll("_", "-") : "flag-update-failed"; }
  redirect(`/feature-flags?${businessId ? `business=${encodeURIComponent(businessId)}&` : ""}notice=${notice}`);
}
