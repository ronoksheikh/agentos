"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ulid } from "ulid";
import { z } from "zod";
import { businessProfileSchema } from "@agentos/control-plane";
import { auditLogs, businesses } from "@agentos/database";
import { database, requireAgencyPage } from "../../lib/server";

export async function createAgencyBusinessAction(form: FormData) {
  const name = z.string().trim().min(1).max(200).parse(form.get("name"));
  const access = await requireAgencyPage("business.manage");
  const id = ulid();
  const profile = businessProfileSchema.parse({ identity: { name, description: "" } });
  await database.transaction(async (tx) => {
    await tx.insert(businesses).values({ id, name, state: "PAUSED", profile });
    await tx.insert(auditLogs).values({ id: ulid(), businessId: id, actorId: access.session.user.id, action: "business.created", targetType: "business", targetId: id, safeMetadata: { state: "PAUSED", onboardingState: "CREATED" } });
  });
  revalidatePath("/businesses");
  redirect(`/businesses/${id}`);
}
