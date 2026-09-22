import { eq } from "drizzle-orm";
import { Alert, Badge, Button, Card, Group, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { agents, businesses } from "@agentos/database";
import { DashboardShell } from "../../../../components/Shell";
import { database } from "../../../../lib/server";
import { agencyMetaContext, metaServices } from "../../../../lib/meta";
import { activateMetaPageAction, beginMetaOAuthAction, pauseMetaPageAction, saveManualPageAction, selectMetaPageAction, sendMetaTestReplyAction, subscribeMetaPageAction, verifyMetaCredentialAction, verifyMetaWebhookAction } from "./actions";

export const dynamic = "force-dynamic";
const stateMessage: Record<string, string> = {
  DRAFT: "Verify the Page token and identity.", CREDENTIALS_VERIFIED: "Subscribe the Page, then verify the webhook handshake.", TEST_PENDING: "Send a real Messenger test message to this Page, then verify a controlled reply.", CONNECTED: "Page is connected.", NEEDS_REAUTHORIZATION: "Meta rejected the credential. Save a new Page token or reconnect with OAuth.", FAILED: "Verification failed. Review the diagnostic and try again."
};
function Hidden({ businessId, connectionId }: { businessId: string; connectionId?: string }) { return <><input type="hidden" name="businessId" value={businessId} />{connectionId && <input type="hidden" name="connectionId" value={connectionId} />}</>; }
export default async function MessengerPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<{ status?: string; oauthState?: string }> }) {
  const { businessId } = await params;
  const query = await searchParams;
  const trusted = await agencyMetaContext(businessId);
  const business = (await database.select({ name: businesses.name }).from(businesses).where(eq(businesses.id, businessId)).limit(1))[0]!;
  const agentsList = await database.select({ id: agents.id, name: agents.name, activeVersionId: agents.activeVersionId }).from(agents).where(eq(agents.businessId, businessId));
  let services: ReturnType<typeof metaServices> | null = null;
  try { services = metaServices(); } catch { /* Deployment setup remains visible below. */ }
  const connections = services ? await services.connections.list(trusted) : [];
  let oauthPages: { id: string; name: string }[] = [];
  if (query.oauthState && services) { try { oauthPages = await services.connections.oauthPages(trusted, query.oauthState); } catch { /* Expired state is reflected by empty selection. */ } }
  const instructions = services ? await services.connections.setupInstructions(trusted) : null;
  return <DashboardShell>
    <Stack gap="lg">
      <Title order={2}>Facebook Messenger Pages</Title>
      {query.status && <Alert color={query.status.includes("failed") || query.status.includes("error") || query.status.includes("missing") ? "red" : "blue"}>{query.status.replaceAll("-", " ")}</Alert>}
      {!services && <Alert color="red">Messenger server configuration is incomplete. Set META_APP_ID, META_APP_SECRET, META_OAUTH_REDIRECT_URI, META_WEBHOOK_CALLBACK_URL, META_WEBHOOK_VERIFY_TOKEN and CREDENTIAL_ENCRYPTION_KEY.</Alert>}
      {instructions && <Card withBorder><Stack gap="xs"><Text fw={600}>Meta application setup</Text><Text size="sm">Webhook callback: <code>{instructions.callbackUrl}</code></Text><Text size="sm">Graph API: {instructions.graphVersion}</Text><Text size="sm">Verification token configured: {instructions.verifyTokenPresent ? "Yes" : "No"}.</Text>{"initialVerificationToken" in instructions && <Text size="sm">Initial verification token for Meta App setup: <code>{instructions.initialVerificationToken}</code>. It is hidden here after the first successful handshake.</Text>}<Text size="sm">Enable pages_messaging, pages_show_list and pages_manage_metadata in your Meta App. Meta must verify the callback before Page activation.</Text></Stack></Card>}
      {services && <Card withBorder><Stack><Text fw={600}>Connect a Page with OAuth</Text><form action={beginMetaOAuthAction}><Stack gap="sm"><Hidden businessId={businessId} /><select name="agentId" required aria-label="Published agent"><option value="">Choose a published agent</option>{agentsList.filter((agent) => agent.activeVersionId).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><Button type="submit">Continue with Meta</Button></Stack></form></Stack></Card>}
      {query.oauthState && <Card withBorder><Stack><Text fw={600}>Choose an authorized Page</Text>{oauthPages.length ? oauthPages.map((page) => <form action={selectMetaPageAction} key={page.id}><Hidden businessId={businessId} /><input type="hidden" name="stateId" value={query.oauthState} /><input type="hidden" name="pageId" value={page.id} /><Button type="submit" variant="light">{page.name} ({page.id})</Button></form>) : <Text size="sm">No authorized Pages were returned or this selection expired. Restart OAuth.</Text>}</Stack></Card>}
      {services && <Card withBorder><Stack><Text fw={600}>Manual Page setup</Text><Text size="sm">Use a Page access token with the required Messenger permissions. The token is encrypted on submission and is never shown again.</Text><form action={saveManualPageAction}><Stack gap="sm"><Hidden businessId={businessId} /><TextInput name="pageId" label="Page ID" required /><PasswordInput name="pageToken" label="Page access token" required /><select name="agentId" required aria-label="Published agent"><option value="">Choose a published agent</option>{agentsList.filter((agent) => agent.activeVersionId).map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><Button type="submit">Save Page securely</Button></Stack></form></Stack></Card>}
      {connections.map((connection) => <Card withBorder key={connection.id}><Stack gap="sm"><Group justify="space-between"><Text fw={700}>{connection.displayName ?? connection.pageId}</Text><Badge color={connection.state === "CONNECTED" && !connection.paused ? "green" : connection.state === "FAILED" || connection.state === "NEEDS_REAUTHORIZATION" ? "red" : "yellow"}>{connection.state}{connection.paused ? " · paused" : ""}</Badge></Group><Text size="sm">{stateMessage[connection.state] ?? "Review Page status."}</Text>{connection.lastErrorCode && <Alert color="red">{connection.lastErrorCode}</Alert>}<Text size="xs">Token saved: {connection.tokenPresent ? "Yes" : "No"} · Webhook verified: {connection.webhookVerifiedAt ? "Yes" : "No"} · Test received: {connection.testMessageReceived ? "Yes" : "No"} · Reply verified: {connection.replyVerifiedAt ? "Yes" : "No"}</Text><Group>
        {connection.state === "DRAFT" && <form action={verifyMetaCredentialAction}><Hidden businessId={businessId} connectionId={connection.id} /><Button type="submit" size="xs">Verify credentials</Button></form>}
        {connection.state === "CREDENTIALS_VERIFIED" && <><form action={subscribeMetaPageAction}><Hidden businessId={businessId} connectionId={connection.id} /><Button type="submit" size="xs" variant="light">Subscribe Page</Button></form><form action={verifyMetaWebhookAction}><Hidden businessId={businessId} connectionId={connection.id} /><Button type="submit" size="xs">Verify webhook</Button></form></>}
        {connection.state === "TEST_PENDING" && connection.testMessageReceived && !connection.replyVerifiedAt && <form action={sendMetaTestReplyAction}><Hidden businessId={businessId} connectionId={connection.id} /><Group><TextInput name="replyText" defaultValue="Messenger connection test confirmed." aria-label="Test reply" required /><Button type="submit" size="xs">Send test reply</Button></Group></form>}
        {connection.state === "TEST_PENDING" && connection.replyVerifiedAt && <form action={activateMetaPageAction}><Hidden businessId={businessId} connectionId={connection.id} /><Button type="submit" size="xs">Activate Page</Button></form>}
        {connection.state === "CONNECTED" && <form action={pauseMetaPageAction}><Hidden businessId={businessId} connectionId={connection.id} /><input type="hidden" name="paused" value={connection.paused ? "false" : "true"} /><Button type="submit" size="xs" color={connection.paused ? "green" : "orange"}>{connection.paused ? "Resume" : "Pause"}</Button></form>}
      </Group></Stack></Card>)}
    </Stack>
  </DashboardShell>;
}
