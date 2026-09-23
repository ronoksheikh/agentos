import { ulid } from "ulid";
import { businessCapabilities, businessRoleSchema } from "@agentos/auth";
import { PostgresClientDashboard } from "@agentos/client-operations";
import { createTrustedBusinessContext } from "@agentos/shared";
import { database, type requireClientPage } from "./server";

const dashboard = new PostgresClientDashboard(database);
export function loadClientDashboard(access: Awaited<ReturnType<typeof requireClientPage>>, section: string, filter: { unread?: boolean; urgent?: boolean; failed?: boolean } = {}) {
  return dashboard.snapshot(createTrustedBusinessContext({ businessId: access.membership.businessId, principal: { kind: "user", userId: access.session.user.id, sessionId: access.session.session.id }, source: "authenticated_request", traceId: ulid(), capabilityGrants: businessCapabilities(businessRoleSchema.parse(access.membership.role), access.membership.capabilities) }), section, filter);
}
