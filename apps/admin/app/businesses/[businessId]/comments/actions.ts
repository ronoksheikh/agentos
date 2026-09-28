"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PostgresCommentAnalytics, PostgresManualCommentOperations } from "@agentos/comments";
import { ulidSchema } from "@agentos/shared";
import { agencyMetaContext, metaServices } from "../../../../lib/meta";
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

export async function performAgencyManualCommentAction(form: FormData) {
  const businessId = String(form.get("businessId") ?? ""); let notice = "comment-action-completed";
  try {
    const context = await agencyMetaContext(businessId);
    const commentId = ulidSchema.parse(String(form.get("commentId") ?? ""));
    const requestId = ulidSchema.parse(String(form.get("requestId") ?? ""));
    const mode = z.enum(["REPLY", "HIDE"]).parse(form.get("mode"));
    const text = mode === "REPLY" ? String(form.get("text") ?? "") : undefined;
    await new PostgresManualCommentOperations(database, metaServices().adapter).apply(context, { commentId, requestId, mode, ...(text !== undefined ? { text } : {}) });
    revalidatePath(`/businesses/${businessId}/comments`);
  } catch (error) { notice = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message.toLowerCase().replaceAll("_", "-") : "comment-action-failed"; }
  redirect(`/businesses/${encodeURIComponent(businessId)}/comments?notice=${notice}`);
}

export async function mapAgencyCommentProductSourceAction(form: FormData) {
  const businessId = String(form.get("businessId") ?? ""); let notice = "product-mapping-saved";
  try {
    const context = await agencyMetaContext(businessId);
    const postId = ulidSchema.parse(String(form.get("postId") ?? ""));
    const sourceValue = String(form.get("sourceId") ?? "");
    await analytics.mapPostProductSource(context, postId, sourceValue || null);
    revalidatePath(`/businesses/${businessId}/comments`);
  } catch (error) { notice = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message.toLowerCase().replaceAll("_", "-") : "product-mapping-failed"; }
  redirect(`/businesses/${encodeURIComponent(businessId)}/comments?notice=${notice}`);
}
