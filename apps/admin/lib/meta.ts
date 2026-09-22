import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { agencyCapabilities, agencyRoleSchema } from "@agentos/auth";
import { businesses } from "@agentos/database";
import { FacebookMessengerAdapter, GraphMetaApi, MessengerWebhook, MetaConnectionService, PostgresCredentialVault } from "@agentos/channels";
import { createTrustedBusinessContext, ulidSchema } from "@agentos/shared";
import { database, requireAgencyPage } from "./server";

const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`${name}_REQUIRED`); return value; };

export function metaServices() {
  const appId = required("META_APP_ID");
  const appSecret = required("META_APP_SECRET");
  const api = new GraphMetaApi(appId, appSecret);
  const vault = PostgresCredentialVault.fromEnvironment(database);
  const connections = new MetaConnectionService(database, api, vault, appId, required("META_OAUTH_REDIRECT_URI"), required("META_WEBHOOK_CALLBACK_URL"));
  const adapter = new FacebookMessengerAdapter(database, api, vault, appSecret);
  const webhook = new MessengerWebhook(database, adapter, connections, appSecret, required("META_WEBHOOK_VERIFY_TOKEN"));
  return { connections, webhook };
}

export async function agencyMetaContext(businessId: string) {
  ulidSchema.parse(businessId);
  const access = await requireAgencyPage("channel.manage");
  const business = (await database.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, businessId)).limit(1))[0];
  if (!business) throw new Error("BUSINESS_NOT_FOUND");
  return createTrustedBusinessContext({ businessId, principal: { kind: "user", userId: access.session.user.id, sessionId: access.session.session.id }, source: "authenticated_request", traceId: ulid(), capabilityGrants: agencyCapabilities(agencyRoleSchema.parse(access.membership.role), access.membership.capabilities) });
}
