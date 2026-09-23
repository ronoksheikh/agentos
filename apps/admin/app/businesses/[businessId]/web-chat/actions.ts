"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ulid } from "ulid";
import { agencyCapabilities, agencyRoleSchema } from "@agentos/auth";
import { createTrustedBusinessContext } from "@agentos/shared";
import { requireAgencyPage } from "../../../../lib/server";
import { webChatService } from "../../../../lib/web-chat";

async function context(businessId: string) {
  const access = await requireAgencyPage("channel.manage");
  return createTrustedBusinessContext({ businessId, principal: { kind: "user", userId: access.session.user.id, sessionId: access.session.session.id }, source: "authenticated_request", traceId: ulid(), capabilityGrants: agencyCapabilities(agencyRoleSchema.parse(access.membership.role), access.membership.capabilities) });
}
export async function createWebChatSite(form: FormData) {
  const businessId = String(form.get("businessId") ?? "");
  try {
    await webChatService().createSite(await context(businessId), { businessId, agentId: String(form.get("agentId") ?? ""), allowedOrigins: String(form.get("allowedOrigins") ?? "").split(/\s+/).filter(Boolean), requestsPerMinute: Number(form.get("requestsPerMinute") ?? 60) });
    revalidatePath(`/businesses/${businessId}/web-chat`);
  } catch { redirect(`/businesses/${businessId}/web-chat?result=error`); }
  redirect(`/businesses/${businessId}/web-chat?result=created`);
}
export async function setWebChatSiteEnabled(form: FormData) {
  const businessId = String(form.get("businessId") ?? "");
  try {
    await webChatService().setSiteEnabled(await context(businessId), String(form.get("siteId") ?? ""), form.get("enabled") === "true");
    revalidatePath(`/businesses/${businessId}/web-chat`);
  } catch { redirect(`/businesses/${businessId}/web-chat?result=error`); }
  redirect(`/businesses/${businessId}/web-chat?result=updated`);
}
