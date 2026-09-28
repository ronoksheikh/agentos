import { Alert, Badge, Card, Grid, Group, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { DashboardShell } from "../../components/Shell";
import { database, requireAgencyPage } from "../../lib/server";
import { readAgencyUsage } from "../../lib/usage";

export const dynamic = "force-dynamic";

export default async function AgencyUsagePage() {
  await requireAgencyPage("run.read");
  const since = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const { totals: total, modelRows, runRows, toolRows, browserRows } = await readAgencyUsage(database, since);
  const number = (value: number | bigint) => Number(value).toLocaleString("en-US");
  const empty = (columns: number, message: string) => <Table.Tr><Table.Td colSpan={columns}><Text c="dimmed" ta="center" py="md">{message}</Text></Table.Td></Table.Tr>;
  return <DashboardShell><Stack gap="lg">
    <Group justify="space-between" align="start"><div><Title order={1}>Usage</Title><Text c="dimmed">Persisted model tokens, run counts, tool calls, and browser actions across the agency.</Text></div><Badge variant="light">Rolling 30 days · UTC</Badge></Group>
    <Alert color="gray" title="Provider costs are unavailable">Token and action counts come from AgentOS records. Dollar costs are not estimated because approved endpoint prices and provider invoices are not available here. Model classifier usage is not included yet.</Alert>
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
      {[["Runs", number(total.runs)], ["Input tokens", number(total.inputTokens)], ["Output tokens", number(total.outputTokens)], ["Tool calls", number(total.toolCalls)]].map(([label, value]) => <Card withBorder key={label}><Text size="xs" c="dimmed">{label}</Text><Text fw={700} fz={28}>{value}</Text></Card>)}
    </SimpleGrid>
    <Grid>
      <Grid.Col span={12}><Card withBorder><Title order={3} mb="sm">Model usage by business and agent</Title><Table.ScrollContainer minWidth={760}><Table striped><Table.Thead><Table.Tr>{["Business", "Agent", "Provider", "Model", "Completed calls", "Input tokens", "Output tokens"].map((v) => <Table.Th key={v}>{v}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{modelRows.length ? modelRows.map((row, i) => <Table.Tr key={`${row.business}:${row.agent}:${row.provider}:${row.model}:${i}`}><Table.Td>{row.business}</Table.Td><Table.Td>{row.agent}</Table.Td><Table.Td>{row.provider}</Table.Td><Table.Td>{row.model}</Table.Td><Table.Td>{number(row.requests)}</Table.Td><Table.Td>{number(row.inputTokens)}</Table.Td><Table.Td>{number(row.outputTokens)}</Table.Td></Table.Tr>) : empty(7, "No completed model calls in this period.")}</Table.Tbody></Table></Table.ScrollContainer></Card></Grid.Col>
      <Grid.Col span={{ base: 12, lg: 6 }}><Card withBorder><Title order={3} mb="sm">Tool usage by business and agent</Title><Table.ScrollContainer minWidth={520}><Table striped><Table.Thead><Table.Tr>{["Business", "Agent", "Tool", "Calls", "Failures"].map((v) => <Table.Th key={v}>{v}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{toolRows.length ? toolRows.map((row, i) => <Table.Tr key={`${row.business}:${row.agent}:${row.tool}:${i}`}><Table.Td>{row.business}</Table.Td><Table.Td>{row.agent}</Table.Td><Table.Td>{row.tool}</Table.Td><Table.Td>{number(row.calls)}</Table.Td><Table.Td>{number(row.failures)}</Table.Td></Table.Tr>) : empty(5, "No tool calls in this period.")}</Table.Tbody></Table></Table.ScrollContainer></Card></Grid.Col>
      <Grid.Col span={{ base: 12, lg: 6 }}><Card withBorder><Title order={3} mb="sm">Browser activity by business and agent</Title><Table.ScrollContainer minWidth={520}><Table striped><Table.Thead><Table.Tr>{["Business", "Agent", "Action", "Runs", "Failures"].map((v) => <Table.Th key={v}>{v}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{browserRows.length ? browserRows.map((row, i) => <Table.Tr key={`${row.business}:${row.agent}:${row.action}:${i}`}><Table.Td>{row.business}</Table.Td><Table.Td>{row.agent}</Table.Td><Table.Td>{row.action}</Table.Td><Table.Td>{number(row.runs)}</Table.Td><Table.Td>{number(row.failures)}</Table.Td></Table.Tr>) : empty(5, "No browser activity in this period.")}</Table.Tbody></Table></Table.ScrollContainer></Card></Grid.Col>
      <Grid.Col span={12}><Card withBorder><Title order={3} mb="sm">Recent runs</Title><Table.ScrollContainer minWidth={720}><Table striped><Table.Thead><Table.Tr>{["Run", "Business", "Agent", "Status", "Started (UTC)", "Input tokens", "Output tokens", "Tool calls"].map((v) => <Table.Th key={v}>{v}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{runRows.length ? runRows.map((row) => <Table.Tr key={row.runId}><Table.Td><Text size="xs" ff="monospace">{row.runId}</Text></Table.Td><Table.Td>{row.business}</Table.Td><Table.Td>{row.agent}</Table.Td><Table.Td>{row.status}</Table.Td><Table.Td>{row.startedAt.toISOString()}</Table.Td><Table.Td>{number(row.inputTokens)}</Table.Td><Table.Td>{number(row.outputTokens)}</Table.Td><Table.Td>{number(row.toolCalls)}</Table.Td></Table.Tr>) : empty(8, "No runs in this period.")}</Table.Tbody></Table></Table.ScrollContainer></Card></Grid.Col>
    </Grid>
  </Stack></DashboardShell>;
}
