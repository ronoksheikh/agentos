import { and, asc, desc, eq } from "drizzle-orm";
import { Alert, Badge, Button, Card, Group, NativeSelect, Stack, Text, Title } from "@mantine/core";
import { agentVersions, agents, businesses } from "@agentos/database";
import { DashboardShell } from "../../components/Shell";
import { AgentPlaygroundForm } from "../../components/AgentPlaygroundForm";
import { database, requireAgencyPage } from "../../lib/server";

export const dynamic = "force-dynamic";
export default async function AgentPlaygroundPage({ searchParams }: { searchParams: Promise<{ business?: string; version?: string }> }) {
  await requireAgencyPage("run.execute");
  const query = await searchParams;
  const businessRows = await database.select({ id: businesses.id, name: businesses.name }).from(businesses).orderBy(asc(businesses.name)).limit(100);
  const businessId = businessRows.some((row) => row.id === query.business) ? query.business! : businessRows[0]?.id;
  const versionRows = businessId ? await database.select({ id: agentVersions.id, agentId: agentVersions.agentId, agentName: agents.name, version: agentVersions.version, state: agentVersions.state, revision: agentVersions.revision }).from(agentVersions).innerJoin(agents, and(eq(agents.id, agentVersions.agentId), eq(agents.businessId, agentVersions.businessId))).where(eq(agentVersions.businessId, businessId)).orderBy(desc(agentVersions.version)).limit(250) : [];
  const selected = versionRows.find((row) => row.id === query.version) ?? versionRows.find((row) => row.state === "PUBLISHED") ?? versionRows[0];
  return <DashboardShell><Stack gap="lg">
    <div><Title order={1}>Agent Playground</Title><Text c="dimmed" mt="xs">Preview a saved agent version with a synthetic message. Each run uses an isolated conversation and suppresses all tools and external actions.</Text></div>
    {!businessRows.length ? <Alert color="gray" title="No businesses available">Create a business and agent version before running a preview.</Alert> : <>
      <Card withBorder><form method="get" action="/agent-playground"><Stack gap="sm"><NativeSelect name="business" label="Business" defaultValue={businessId} data={businessRows.map((row) => ({ value: row.id, label: row.name }))} /><NativeSelect name="version" label="Agent version" defaultValue={selected?.id ?? ""} data={versionRows.map((row) => ({ value: row.id, label: `${row.agentName} · v${row.version} · ${row.state} · r${row.revision}` }))} disabled={!versionRows.length} /><Button type="submit" variant="default" w="fit-content">Load selected version</Button></Stack></form></Card>
      {selected ? <>
        <Group><Badge color={selected.state === "PUBLISHED" ? "green" : selected.state === "TEST" ? "blue" : "gray"}>{selected.state}</Badge><Text size="sm">Version {selected.version}, revision {selected.revision}</Text></Group>
        <AgentPlaygroundForm key={`${businessId}:${selected.id}`} businessId={businessId!} agentId={selected.agentId} versionId={selected.id} />
      </> : <Alert color="gray" title="No agent versions">Create an agent and draft version in the selected business workspace.</Alert>}
    </>}
  </Stack></DashboardShell>;
}
