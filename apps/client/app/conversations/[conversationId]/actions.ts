"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ulid } from "ulid";
import { businessCapabilities, businessRoleSchema } from "@agentos/auth";
import { PostgresHandoffOperations } from "@agentos/handoff";
import { createTrustedBusinessContext, ulidSchema, type TrustedBusinessContext } from "@agentos/shared";
import { database, requireClientPage } from "../../../lib/server";

const operations = new PostgresHandoffOperations(database);
const value = (form: FormData, name: string) => String(form.get(name) ?? "");
async function apply(form: FormData, action: (trusted: TrustedBusinessContext, conversationId: string) => Promise<unknown>, success: string) {
  const businessId = value(form, "businessId"); const conversationId = value(form, "conversationId"); let notice = success;
  try { ulidSchema.parse(conversationId); await action(await trusted(businessId), conversationId); revalidatePath(`/conversations/${conversationId}`); }
  catch (error) { notice = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message.toLowerCase().replaceAll("_", "-") : "operation-failed"; }
  redirect(`/conversations/${encodeURIComponent(conversationId)}?business=${encodeURIComponent(businessId)}&notice=${encodeURIComponent(notice)}`);
}
async function trusted(businessId: string) {
  ulidSchema.parse(businessId); const access = await requireClientPage("handoff.manage", businessId);
  return createTrustedBusinessContext({ businessId: access.membership.businessId, principal: { kind: "user", userId: access.session.user.id, sessionId: access.session.session.id }, source: "authenticated_request", traceId: ulid(), capabilityGrants: businessCapabilities(businessRoleSchema.parse(access.membership.role), access.membership.capabilities) });
}
export async function takeOverAction(form: FormData) { await apply(form, (context, id) => operations.takeOver(context, id), "taken-over"); }
export async function resolveAction(form: FormData) { await apply(form, (context, id) => operations.resolve(context, id, value(form, "resolution")), "resolved"); }
export async function resumeAgentAction(form: FormData) { await apply(form, (context, id) => operations.resumeAgent(context, id), "agent-resumed"); }
export async function sendWebsiteReplyAction(form: FormData) { await apply(form, (context, id) => operations.sendWebsiteReply(context, id, value(form, "message"), value(form, "idempotencyKey")), "reply-sent"); }
