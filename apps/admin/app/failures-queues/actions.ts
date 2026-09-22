"use server";

import { redirect } from "next/navigation";
import { agencyRoleSchema } from "@agentos/auth";
import { Phase5Operations, Phase5Store } from "@agentos/phase5";
import { database, requireAgencyPage } from "../../lib/server";

export async function replayWork(form: FormData) {
  const { session, membership } = await requireAgencyPage("queue.replay");
  const businessId = String(form.get("businessId") ?? ""); const workId = String(form.get("workId") ?? "");
  const dryRun = form.get("confirm") !== "yes";
  const result = await new Phase5Operations(new Phase5Store(database)).replay({ userId: session.user.id, role: agencyRoleSchema.parse(membership.role), capabilities: membership.capabilities }, { businessId, workId, dryRun });
  redirect(`/failures-queues?businessId=${encodeURIComponent(businessId)}&result=${dryRun ? "previewed" : "replayed"}${dryRun ? `&previewWorkId=${encodeURIComponent(workId)}&safe=${result.safe ? "yes" : "no"}` : ""}`);
}

export async function cancelWork(form: FormData) {
  const { session, membership } = await requireAgencyPage("queue.replay");
  const businessId = String(form.get("businessId") ?? ""); const workId = String(form.get("workId") ?? "");
  await new Phase5Operations(new Phase5Store(database)).cancel({ userId: session.user.id, role: agencyRoleSchema.parse(membership.role), capabilities: membership.capabilities }, businessId, workId);
  redirect(`/failures-queues?businessId=${encodeURIComponent(businessId)}&result=cancelled`);
}
