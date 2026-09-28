import { Alert, Badge, Card, Stack, Table, Text, Title } from "@mantine/core";
import { DashboardShell } from "./Shell";
import { database, requireAgencyPage } from "../lib/server";
import { readAgencyBrowserRuns, readAgencyHandoffs, readAgencyIntegrations, readAgencyRuns } from "../lib/agency-operations";

function DataTable({ headers, rows, empty }: { headers: string[]; rows: React.ReactNode[][]; empty: string }) {
  return <Card withBorder><Table.ScrollContainer minWidth={700}><Table striped highlightOnHover><Table.Thead><Table.Tr>{headers.map((header) => <Table.Th key={header}>{header}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{rows.length ? rows.map((cells, row) => <Table.Tr key={row}>{cells.map((cell, index) => <Table.Td key={index}>{cell}</Table.Td>)}</Table.Tr>) : <Table.Tr><Table.Td colSpan={headers.length}><Text c="dimmed" ta="center" py="md">{empty}</Text></Table.Td></Table.Tr>}</Table.Tbody></Table></Table.ScrollContainer></Card>;
}

export async function AgencyOperationsView({ section }: { section: "runs" | "browser-runs" | "handoffs" | "integrations" }) {
  await requireAgencyPage(section === "handoffs" ? "conversation.read" : "run.read");
  const common = { runs: ["Runs", "The latest 100 runs across agency businesses. Error display is limited to safe typed codes."], "browser-runs": ["Browser runs", "The latest 100 browser operations. Page URLs and screenshots are not shown."], handoffs: ["Handoffs", "The latest 100 ownership handoffs. Customer text and freeform reasons are not projected."], integrations: ["Integrations", "Connection state and safe operational timestamps across agency businesses; credentials and Page identifiers are never displayed."] } as const;
  const [title, description] = common[section];
  try {
    if (section === "runs") {
      const rows = await readAgencyRuns(database);
      return <DashboardShell><Stack gap="lg"><Title order={1}>{title}</Title><Text c="dimmed">{description}</Text><DataTable headers={["Run", "Business", "Agent", "Status", "Started (UTC)", "Input tokens", "Output tokens", "Tools", "Safe code"]} empty="No runs recorded yet." rows={rows.map((row) => [<Text size="xs" ff="monospace">{row.id}</Text>, row.business, row.agent, <Badge color={row.status === "FAILED" ? "red" : row.status === "COMPLETED" ? "green" : "gray"}>{row.status}</Badge>, row.startedAt.toISOString(), Number(row.inputTokens).toLocaleString("en-US"), Number(row.outputTokens).toLocaleString("en-US"), Number(row.toolCalls).toLocaleString("en-US"), row.errorCode ?? "—"])}/></Stack></DashboardShell>;
    }
    if (section === "browser-runs") {
      const rows = await readAgencyBrowserRuns(database);
      return <DashboardShell><Stack gap="lg"><Title order={1}>{title}</Title><Text c="dimmed">{description}</Text><DataTable headers={["Activity", "Business", "Agent", "Action", "Status", "Safe code", "Occurred (UTC)"]} empty="No browser activity recorded yet." rows={rows.map((row) => [<Text size="xs" ff="monospace">{row.id}</Text>, row.business, row.agent, row.action, <Badge color={row.status === "FAILED" ? "red" : "green"}>{row.status}</Badge>, row.safeCode ?? "—", row.occurredAt.toISOString()])}/></Stack></DashboardShell>;
    }
    if (section === "handoffs") {
      const rows = await readAgencyHandoffs(database);
      return <DashboardShell><Stack gap="lg"><Title order={1}>{title}</Title><Text c="dimmed">{description}</Text><DataTable headers={["Handoff", "Business", "Conversation", "Agent", "Channel", "Priority", "State", "Assigned", "Created (UTC)"]} empty="No handoffs recorded yet." rows={rows.map((row) => [<Text size="xs" ff="monospace">{row.id}</Text>, row.business, <Text size="xs" ff="monospace">{row.conversationId}</Text>, row.agent ?? "—", row.channel, row.priority, row.state, row.assignedTo ? "Assigned" : "Unassigned", row.createdAt.toISOString()])}/></Stack></DashboardShell>;
    }
    const data = await readAgencyIntegrations(database);
    return <DashboardShell><Stack gap="lg"><Title order={1}>{title}</Title><Text c="dimmed">{description}</Text><Title order={3}>Channel connections</Title><DataTable headers={["Business", "Channel", "State", "Automation", "Last webhook (UTC)", "Credential expiry", "Safe status"]} empty="No channel connections configured." rows={data.connections.map((row) => [row.business, row.channel, row.state, row.paused ? "Paused" : "Active", row.lastWebhookAt?.toISOString() ?? "Never", row.tokenExpiresAt?.toISOString() ?? "Unknown", row.lastErrorCode ?? "—"])}/><Title order={3}>Website chat sites</Title><DataTable headers={["Business", "Enabled", "Allowed origins", "Updated (UTC)"]} empty="No Website Chat sites configured." rows={data.sites.map((row) => [row.business, row.enabled ? "Yes" : "No", Number(row.originCount), row.updatedAt.toISOString()])}/></Stack></DashboardShell>;
  } catch {
    return <DashboardShell><Alert color="red" title={`${title} are temporarily unavailable`}>Operational data could not be loaded. Try again later or check System Health.</Alert></DashboardShell>;
  }
}
