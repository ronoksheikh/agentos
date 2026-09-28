import { ulid } from "ulid";
import { businessCapabilities, businessRoleSchema } from "@agentos/auth";
import { PostgresClientDashboard } from "@agentos/client-operations";
import { createTrustedBusinessContext } from "@agentos/shared";
import { database, type requireClientPage } from "./server";

const dashboard = new PostgresClientDashboard(database);
const clientContext = (access: Awaited<ReturnType<typeof requireClientPage>>) => createTrustedBusinessContext({ businessId: access.membership.businessId, principal: { kind: "user", userId: access.session.user.id, sessionId: access.session.session.id }, source: "authenticated_request", traceId: ulid(), capabilityGrants: businessCapabilities(businessRoleSchema.parse(access.membership.role), access.membership.capabilities) });
export function loadClientDashboard(access: Awaited<ReturnType<typeof requireClientPage>>, section: string, filter: { unread?: boolean; urgent?: boolean; failed?: boolean } = {}) {
  return dashboard.snapshot(clientContext(access), section, filter);
}
export function loadClientCustomers(access: Awaited<ReturnType<typeof requireClientPage>>, search: string) { return dashboard.customerDirectory(clientContext(access), search); }
export function loadClientTeam(access: Awaited<ReturnType<typeof requireClientPage>>) { return dashboard.teamDirectory(clientContext(access)); }
