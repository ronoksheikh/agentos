import { desc, eq } from "drizzle-orm";
import { Alert, Badge, Card, Stack, Table, Text, Title } from "@mantine/core";
import { businesses, customTools } from "@agentos/database";
import { DashboardShell } from "../../components/Shell";
import { database, requireAgencyPage } from "../../lib/server";

export const dynamic = "force-dynamic";
export default async function ToolsPage() {
  await requireAgencyPage("tool_policy.manage");
  try {
    const rows = await database.select({ business: businesses.name, name: customTools.name, type: customTools.type, method: customTools.method, safetyClass: customTools.safetyClass, enabled: customTools.enabled, testState: customTools.testState, updatedAt: customTools.updatedAt }).from(customTools).innerJoin(businesses, eq(customTools.businessId, businesses.id)).orderBy(desc(customTools.updatedAt)).limit(200);
    return <DashboardShell><Stack gap="lg"><div><Title order={1}>Tools</Title><Text c="dimmed">Custom tool grants and safety state across agency businesses. Endpoint details and credentials are hidden.</Text></div><Card withBorder><Table.ScrollContainer minWidth={680}><Table striped><Table.Thead><Table.Tr>{["Business", "Tool", "Type", "Method", "Safety", "Enabled", "Test state", "Updated (UTC)"].map((heading) => <Table.Th key={heading}>{heading}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{rows.length ? rows.map((row, i) => <Table.Tr key={`${row.business}:${row.name}:${i}`}><Table.Td>{row.business}</Table.Td><Table.Td>{row.name}</Table.Td><Table.Td>{row.type}</Table.Td><Table.Td>{row.method}</Table.Td><Table.Td>{row.safetyClass}</Table.Td><Table.Td><Badge color={row.enabled ? "green" : "gray"}>{row.enabled ? "Enabled" : "Disabled"}</Badge></Table.Td><Table.Td>{row.testState}</Table.Td><Table.Td>{row.updatedAt.toISOString()}</Table.Td></Table.Tr>) : <Table.Tr><Table.Td colSpan={8}><Text c="dimmed" ta="center" py="md">No custom tools configured yet.</Text></Table.Td></Table.Tr>}</Table.Tbody></Table></Table.ScrollContainer></Card></Stack></DashboardShell>;
  } catch { return <DashboardShell><Alert color="red" title="Tool records are temporarily unavailable">Tool records could not be loaded. Try again later or check System Health.</Alert></DashboardShell>; }
}
