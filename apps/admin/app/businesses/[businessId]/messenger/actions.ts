"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { agencyMetaContext, metaServices } from "../../../../lib/meta";

const value = (form: FormData, name: string) => String(form.get(name) ?? "");
const page = (id: string, status: string) => `/businesses/${id}/messenger?status=${status}`;
async function execute(form: FormData, operation: (service: ReturnType<typeof metaServices>["connections"], context: Awaited<ReturnType<typeof agencyMetaContext>>) => Promise<unknown>, success: string) {
  const id = value(form, "businessId");
  let status = success;
  try { const context = await agencyMetaContext(id); await operation(metaServices().connections, context); revalidatePath(`/businesses/${id}/messenger`); }
  catch (error) { status = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message.toLowerCase().replaceAll("_", "-") : "operation-failed"; }
  redirect(page(id, status));
}
export async function saveManualPageAction(form: FormData) { await execute(form, (service, context) => service.manual(context, { pageId: value(form, "pageId"), pageToken: value(form, "pageToken"), agentId: value(form, "agentId") }), "page-saved"); }
export async function beginMetaOAuthAction(form: FormData) {
  const id = value(form, "businessId");
  let url: string;
  try { const context = await agencyMetaContext(id); url = (await metaServices().connections.beginOAuth(context, value(form, "agentId"))).url; }
  catch { redirect(page(id, "oauth-start-failed")); }
  redirect(url);
}
export async function selectMetaPageAction(form: FormData) { await execute(form, (service, context) => service.selectOAuthPage(context, value(form, "stateId"), value(form, "pageId")), "page-saved"); }
export async function verifyMetaCredentialAction(form: FormData) { await execute(form, (service, context) => service.verifyCredentials(context, value(form, "connectionId")), "credentials-verified"); }
export async function subscribeMetaPageAction(form: FormData) { await execute(form, (service, context) => service.subscribePage(context, value(form, "connectionId")), "page-subscribed"); }
export async function verifyMetaWebhookAction(form: FormData) { await execute(form, (service, context) => service.verifyWebhook(context, value(form, "connectionId")), "webhook-verified"); }
export async function sendMetaTestReplyAction(form: FormData) { await execute(form, (service, context) => service.controlledReply(context, value(form, "connectionId"), value(form, "replyText")), "reply-verified"); }
export async function activateMetaPageAction(form: FormData) { await execute(form, (service, context) => service.activate(context, value(form, "connectionId")), "page-connected"); }
export async function pauseMetaPageAction(form: FormData) { await execute(form, (service, context) => service.setPaused(context, value(form, "connectionId"), value(form, "paused") === "true"), "page-updated"); }
