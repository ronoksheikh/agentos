import { and, desc, eq } from "drizzle-orm";
import { Alert, Badge, Button, Card, Stack, Table, Text, Title } from "@mantine/core";
import Link from "next/link";
import { agents, businesses, agentVersions } from "@agentos/database";
import { DashboardShell } from "../../components/Shell";
import { database, requireAgencyPage } from "../../lib/server";

export const dynamic = "force-dynamic";
export default async function AgentsPage() {
  await requireAgencyPage("agent.manage");
  try {
    const rows = await database.select({ id: agents.id, name: agents.name, business: businesses.name, businessId: agents.businessId, activeVersionId: agents.activeVersionId, version: agentVersions.version, versionState: agentVersions.state, updatedAt: agents.updatedAt }).from(agents).innerJoin(businesses, eq(agents.businessId, businesses.id)).leftJoin(agentVersions, and(eq(agents.businessId, agentVersions.businessId), eq(agents.activeVersionId, agentVersions.id))).orderBy(desc(agents.updatedAt)).limit(200);
    return <DashboardShell><Stack gap="lg"><div><Title order={1}>Agents & versions</Title><Text c="dimmed">Published agent pointers across agency businesses. Draft editing and publication run through business-scoped controls.</Text></div><Card withBorder><Table.ScrollContainer minWidth={760}><Table striped highlightOnHover><Table.Thead><Table.Tr>{["Agent", "Business", "Active version", "Version state", "Updated (UTC)", "Workspace"].map((heading) => <Table.Th key={heading}>{heading}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{rows.length ? rows.map((row) => <Table.Tr key={row.id}><Table.Td><Text fw={600}>{row.name}</Text><Text size="xs" c="dimmed" ff="monospace">{row.id}</Text></Table.Td><Table.Td>{row.business}</Table.Td><Table.Td>{row.version ?? "No active version"}</Table.Td><Table.Td><Badge color={row.versionState === "PUBLISHED" ? "green" : "gray"}>{row.versionState ?? "UNPUBLISHED"}</Badge></Table.Td><Table.Td>{row.updatedAt.toISOString()}</Table.Td><Table.Td><Button component={Link} href={`/businesses/${row.businessId}`} size="xs" variant="default">Open business</Button></Table.Td></Table.Tr>) : <Table.Tr><Table.Td colSpan={6}><Text c="dimmed" ta="center" py="md">No agents are registered yet.</Text></Table.Td></Table.Tr>}</Table.Tbody></Table></Table.ScrollContainer></Card></Stack></DashboardShell>;
  } catch { return <DashboardShell><Alert color="red" title="Agents are temporarily unavailable">Agent records could not be loaded. Try again later or check System Health.</Alert></DashboardShell>; }
}
