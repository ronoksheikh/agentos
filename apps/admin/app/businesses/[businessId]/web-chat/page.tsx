import { and, eq } from "drizzle-orm";
import { Alert, Badge, Button, Card, Group, NumberInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { agents, businesses, websiteSites } from "@agentos/database";
import { DashboardShell } from "../../../../components/Shell";
import { database, requireAgencyPage } from "../../../../lib/server";
import { createWebChatSite, setWebChatSiteEnabled } from "./actions";

export const dynamic = "force-dynamic";
export default async function WebChatSitesPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<{ result?: string }> }) {
  const { businessId } = await params; const query = await searchParams; await requireAgencyPage("channel.manage");
  const [business, agentRows, sites] = await Promise.all([
    database.select({ name: businesses.name }).from(businesses).where(eq(businesses.id, businessId)).limit(1),
    database.select({ id: agents.id, name: agents.name }).from(agents).where(eq(agents.businessId, businessId)),
    database.select().from(websiteSites).where(eq(websiteSites.businessId, businessId)),
  ]);
  if (!business[0]) return <DashboardShell><Alert color="red">Business not found.</Alert></DashboardShell>;
  return <DashboardShell><Stack><div><Title order={1}>Website chat</Title><Text c="dimmed">{business[0].name} · Add exact HTTPS origins, then enable a site after its agent is ready.</Text></div>{query.result && <Alert color={query.result === "error" ? "red" : "green"}>{query.result === "error" ? "The change could not be saved." : `Site ${query.result}.`}</Alert>}<Card withBorder><Title order={3}>Create site</Title><form action={createWebChatSite}><input type="hidden" name="businessId" value={businessId} /><Stack mt="md"><TextInput name="agentId" label="Agent ID" description={agentRows.map((agent) => `${agent.name}: ${agent.id}`).join(" · ") || "Create an agent first."} required /><TextInput name="allowedOrigins" label="Allowed origins" placeholder="https://shop.example" description="Exact origins, separated by spaces. Paths and wildcards are not accepted." required /><NumberInput name="requestsPerMinute" label="Requests per minute" defaultValue={60} min={1} max={600} /><Button type="submit" disabled={!agentRows.length}>Create disabled site</Button></Stack></form></Card>{sites.length ? sites.map((site) => <Card withBorder key={site.id}><Group justify="space-between"><div><Text fw={600}>{site.publicKey}</Text><Text size="sm" c="dimmed">{site.allowedOrigins.join(", ")} · Agent {site.agentId} · {site.requestsPerMinute}/min</Text></div><Badge color={site.enabled ? "green" : "gray"}>{site.enabled ? "Enabled" : "Disabled"}</Badge></Group><form action={setWebChatSiteEnabled}><input type="hidden" name="businessId" value={businessId} /><input type="hidden" name="siteId" value={site.id} /><input type="hidden" name="enabled" value={site.enabled ? "false" : "true"} /><Button mt="md" variant={site.enabled ? "outline" : "filled"} type="submit">{site.enabled ? "Disable and revoke sessions" : "Enable"}</Button></form></Card>) : <Alert color="gray">No website chat sites yet.</Alert>}</Stack></DashboardShell>;
}
