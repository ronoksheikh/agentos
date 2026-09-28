import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ulid } from "ulid";
import { Alert, Stack } from "@mantine/core";
import { agencyCapabilities, agencyRoleSchema } from "@agentos/auth";
import { PostgresCommentAnalytics } from "@agentos/comments";
import { businesses } from "@agentos/database";
import { createTrustedBusinessContext, ulidSchema } from "@agentos/shared";
import { CommentAnalytics } from "../../../../../client/components/CommentAnalytics";
import { DashboardShell } from "../../../../components/Shell";
import { database, requireAgencyPage } from "../../../../lib/server";
import { performAgencyManualCommentAction, recordAgencyCommentReviewAction } from "./actions";

export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<{ notice?: string }> }) {
  const { businessId } = await params; if (!ulidSchema.safeParse(businessId).success) notFound();
  const access = await requireAgencyPage("conversation.read");
  const business = (await database.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, businessId)).limit(1))[0]; if (!business) notFound();
  const grants = agencyCapabilities(agencyRoleSchema.parse(access.membership.role), access.membership.capabilities);
  const context = createTrustedBusinessContext({ businessId, principal: { kind: "user", userId: access.session.user.id, sessionId: access.session.session.id }, source: "authenticated_request", traceId: ulid(), capabilityGrants: grants });
  const summary = await new PostgresCommentAnalytics(database).summary(context);
  const query = await searchParams;
  return <DashboardShell><Stack>{query.notice && <Alert color={query.notice.includes("failed") || query.notice.includes("invalid") ? "red" : "green"}>{query.notice.replaceAll("-", " ")}</Alert>}<CommentAnalytics summary={summary} businessId={businessId} canManage={grants.includes("channel.manage")} reviewAction={recordAgencyCommentReviewAction} {...(grants.includes("channel.manage") ? { manualAction: performAgencyManualCommentAction } : {})} /></Stack></DashboardShell>;
}
