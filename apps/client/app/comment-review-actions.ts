"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ulid } from "ulid";
import { z } from "zod";
import { businessCapabilities, businessRoleSchema } from "@agentos/auth";
import { PostgresCommentAnalytics, PostgresManualCommentOperations } from "@agentos/comments";
import { FacebookMessengerAdapter, GraphMetaApi, PostgresCredentialVault } from "@agentos/channels";
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

export async function performClientManualCommentAction(form: FormData) {
  const businessId = String(form.get("businessId") ?? ""); let notice = "comment-action-completed";
  try {
    ulidSchema.parse(businessId);
    const commentId = ulidSchema.parse(String(form.get("commentId") ?? ""));
    const requestId = ulidSchema.parse(String(form.get("requestId") ?? ""));
    const mode = z.enum(["REPLY", "HIDE"]).parse(form.get("mode"));
    const text = mode === "REPLY" ? String(form.get("text") ?? "") : undefined;
    const access = await requireClientPage("channel.manage", businessId);
    const context = createTrustedBusinessContext({ businessId: access.membership.businessId, principal: { kind: "user", userId: access.session.user.id, sessionId: access.session.session.id }, source: "authenticated_request", traceId: ulid(), capabilityGrants: businessCapabilities(businessRoleSchema.parse(access.membership.role), access.membership.capabilities) });
    const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`${name}_REQUIRED`); return value; };
    const appSecret = required("META_APP_SECRET");
    const api = new GraphMetaApi(required("META_APP_ID"), appSecret);
    const vault = PostgresCredentialVault.fromEnvironment(database);
    const adapter = new FacebookMessengerAdapter(database, api, vault, appSecret);
    await new PostgresManualCommentOperations(database, adapter).apply(context, { commentId, requestId, mode, ...(text !== undefined ? { text } : {}) });
    revalidatePath("/comment-analytics");
  } catch (error) { notice = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message.toLowerCase().replaceAll("_", "-") : "comment-action-failed"; }
  redirect(`/comment-analytics?business=${encodeURIComponent(businessId)}&notice=${notice}`);
}
