import { desc, eq } from "drizzle-orm";
import { Alert, Card, Stack, Table, Text, Title } from "@mantine/core";
import { auditLogs, businesses } from "@agentos/database";
import { DashboardShell } from "../../components/Shell";
import { database, requireAgencyPage } from "../../lib/server";

export const dynamic = "force-dynamic";
export default async function AuditLogsPage() {
  await requireAgencyPage("audit.read");
  try {
    const rows = await database.select({ id: auditLogs.id, business: businesses.name, actorId: auditLogs.actorId, action: auditLogs.action, targetType: auditLogs.targetType, targetId: auditLogs.targetId, occurredAt: auditLogs.occurredAt }).from(auditLogs).leftJoin(businesses, eq(auditLogs.businessId, businesses.id)).orderBy(desc(auditLogs.occurredAt)).limit(200);
    return <DashboardShell><Stack gap="lg"><div><Title order={1}>Audit logs</Title><Text c="dimmed">Latest 200 control-plane audit records. Metadata and customer content are not displayed.</Text></div><Card withBorder><Table.ScrollContainer minWidth={760}><Table striped><Table.Thead><Table.Tr>{["Occurred (UTC)", "Business", "Actor", "Action", "Target", "Record"].map((heading) => <Table.Th key={heading}>{heading}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{rows.length ? rows.map((row) => <Table.Tr key={row.id}><Table.Td>{row.occurredAt.toISOString()}</Table.Td><Table.Td>{row.business ?? "Agency-wide"}</Table.Td><Table.Td><Text size="xs" ff="monospace">{row.actorId}</Text></Table.Td><Table.Td>{row.action}</Table.Td><Table.Td>{row.targetType}</Table.Td><Table.Td><Text size="xs" ff="monospace">{row.targetId}</Text></Table.Td></Table.Tr>) : <Table.Tr><Table.Td colSpan={6}><Text c="dimmed" ta="center" py="md">No audit entries recorded yet.</Text></Table.Td></Table.Tr>}</Table.Tbody></Table></Table.ScrollContainer></Card></Stack></DashboardShell>;
  } catch { return <DashboardShell><Alert color="red" title="Audit records are temporarily unavailable">Audit records could not be loaded. Try again later or check System Health.</Alert></DashboardShell>; }
}
