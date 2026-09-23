"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ulid } from "ulid";
import { z } from "zod";
import { businessCapabilities, businessRoleSchema } from "@agentos/auth";
import { PostgresCommentAnalytics } from "@agentos/comments";
import { createTrustedBusinessContext, ulidSchema } from "@agentos/shared";
import { database, requireClientPage } from "../lib/server";

const analytics = new PostgresCommentAnalytics(database);
export async function recordClientCommentReviewAction(form: FormData) {
  const businessId = String(form.get("businessId") ?? ""); let notice = "review-recorded";
  try {
    ulidSchema.parse(businessId); const decisionId = ulidSchema.parse(String(form.get("decisionId") ?? ""));
    const disposition = z.enum(["ACKNOWLEDGED", "FOLLOW_UP_REQUIRED", "EXTERNAL_CHECKED"]).parse(form.get("disposition"));
    const access = await requireClientPage("conversation.manage", businessId);
    const context = createTrustedBusinessContext({ businessId: access.membership.businessId, principal: { kind: "user", userId: access.session.user.id, sessionId: access.session.session.id }, source: "authenticated_request", traceId: ulid(), capabilityGrants: businessCapabilities(businessRoleSchema.parse(access.membership.role), access.membership.capabilities) });
    await analytics.markReviewed(context, decisionId, disposition); revalidatePath("/comment-analytics");
  } catch (error) { notice = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message.toLowerCase().replaceAll("_", "-") : "review-failed"; }
  redirect(`/comment-analytics?business=${encodeURIComponent(businessId)}&notice=${notice}`);
}
