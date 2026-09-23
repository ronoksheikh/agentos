"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PostgresCommentAnalytics } from "@agentos/comments";
import { ulidSchema } from "@agentos/shared";
import { agencyMetaContext } from "../../../../lib/meta";
import { database } from "../../../../lib/server";

const analytics = new PostgresCommentAnalytics(database);
export async function recordAgencyCommentReviewAction(form: FormData) {
  const businessId = String(form.get("businessId") ?? ""); let notice = "review-recorded";
  try {
    const context = await agencyMetaContext(businessId); const decisionId = ulidSchema.parse(String(form.get("decisionId") ?? ""));
    const disposition = z.enum(["ACKNOWLEDGED", "FOLLOW_UP_REQUIRED", "EXTERNAL_CHECKED"]).parse(form.get("disposition"));
    await analytics.markReviewed(context, decisionId, disposition); revalidatePath(`/businesses/${businessId}/comments`);
  } catch (error) { notice = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message.toLowerCase().replaceAll("_", "-") : "review-failed"; }
  redirect(`/businesses/${encodeURIComponent(businessId)}/comments?notice=${notice}`);
}
