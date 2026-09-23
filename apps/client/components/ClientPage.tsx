import { Alert, Badge, Card, Group, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import Link from "next/link";
import { CLIENT_COUNTER_LINKS, type PostgresClientDashboard } from "@agentos/client-operations";

type Snapshot = Awaited<ReturnType<PostgresClientDashboard["snapshot"]>>;
const utc = (value: string) => `${value.slice(0, 16).replace("T", " ")} UTC`;
const copy: Record<string, [string, string]> = {
  overview: ["Overview", "Current activity for your business."],
  conversations: ["Conversations", "Recent customer conversations."],
  "needs-attention": ["Needs attention", "Unresolved requests for a person."],
  customers: ["Customers", "Customer activity for this business."],
  "agent-activity": ["Agent activity", "Recent runs and failures."],
  team: ["Team", "Business memberships and permissions."],
  settings: ["Settings", "Business and channel settings."],
};

export function ClientPage({ section, businessId, snapshot }: { section: string; businessId: string; snapshot: Snapshot }) {
  const [title, description] = copy[section] ?? [section, "Business workspace"];
  const counters = [
    { key: "unreadConversations", label: "Unread conversations", value: snapshot.counters.unreadConversations },
    { key: "unresolvedHandoffs", label: "Unresolved handoffs", value: snapshot.counters.unresolvedHandoffs },
    { key: "failedRuns", label: "Failed runs · 7 days", value: snapshot.counters.failedRuns },
    { key: "urgentIssues", label: "Urgent conversations", value: snapshot.counters.urgentIssues },
  ] as const;
  const conversationLink = (id: string) => `/conversations/${encodeURIComponent(id)}?business=${encodeURIComponent(businessId)}`;
  return <Stack gap="lg">
    <Group justify="space-between" align="start"><div><Title order={1}>{title}</Title><Text c="dimmed">{description}</Text></div><Badge variant="outline">Updated {utc(snapshot.asOf)}</Badge></Group>
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>{counters.map((counter) => <Card withBorder key={counter.key} component={Link} href={`${CLIENT_COUNTER_LINKS[counter.key]}&business=${encodeURIComponent(businessId)}`}><Text size="xs" c="dimmed">{counter.label}</Text><Text className="client-metric" fw={700} fz={30}>{counter.value}</Text></Card>)}</SimpleGrid>
    {section === "needs-attention" && <Alert title="Human ownership pauses AI replies">Open a conversation to review the request and available actions.</Alert>}
    {section === "agent-activity" ? <Card withBorder><Text fw={600} mb="md">Recent agent runs</Text>{snapshot.runs.length ? <Table.ScrollContainer minWidth={640}><Table striped><Table.Thead><Table.Tr><Table.Th>Agent</Table.Th><Table.Th>Status</Table.Th><Table.Th>Started</Table.Th><Table.Th>Completed</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{snapshot.runs.map((run) => <Table.Tr key={run.id}><Table.Td>{run.agentName}</Table.Td><Table.Td><Badge color={run.status === "FAILED" ? "red" : run.status === "COMPLETED" ? "green" : "gray"}>{run.status}</Badge></Table.Td><Table.Td>{utc(run.startedAt)}</Table.Td><Table.Td>{run.completedAt ? utc(run.completedAt) : "—"}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer> : <Text c="dimmed">No matching agent runs yet.</Text>}</Card> : null}
    {section === "needs-attention" ? <Card withBorder><Text fw={600} mb="md">Unresolved handoffs</Text>{snapshot.attention.length ? <Table.ScrollContainer minWidth={640}><Table striped highlightOnHover><Table.Thead><Table.Tr><Table.Th>Customer</Table.Th><Table.Th>Channel</Table.Th><Table.Th>State</Table.Th><Table.Th>Priority</Table.Th><Table.Th>Updated</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{snapshot.attention.map((row) => <Table.Tr key={row.id}><Table.Td><Link href={conversationLink(row.conversationId)}>{row.customerName || "Unnamed customer"}</Link></Table.Td><Table.Td>{row.channel}</Table.Td><Table.Td>{row.state.replaceAll("_", " ")}</Table.Td><Table.Td><Badge color={row.priority === "URGENT" ? "red" : "orange"}>{row.priority}</Badge></Table.Td><Table.Td>{utc(row.updatedAt)}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer> : <Text c="dimmed">No unresolved handoffs.</Text>}</Card> : null}
    {!new Set(["agent-activity", "needs-attention"]).has(section) ? <Card withBorder><Text fw={600} mb="md">Recent conversations</Text>{snapshot.recent.length ? <Table.ScrollContainer minWidth={640}><Table striped highlightOnHover><Table.Thead><Table.Tr><Table.Th>Customer</Table.Th><Table.Th>Channel</Table.Th><Table.Th>Ownership</Table.Th><Table.Th>Updated</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{snapshot.recent.map((row) => <Table.Tr key={row.id}><Table.Td><Link href={conversationLink(row.id)}>{row.customerName || "Unnamed customer"}</Link>{row.unread && <Badge size="xs" ml="xs">Unread</Badge>}</Table.Td><Table.Td>{row.channel}</Table.Td><Table.Td><Badge color={row.urgent ? "red" : row.ownership === "AI_ACTIVE" ? "green" : "orange"}>{row.ownership.replaceAll("_", " ")}</Badge></Table.Td><Table.Td>{utc(row.updatedAt)}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer> : <Text c="dimmed">No matching conversations yet.</Text>}</Card> : null}
    <Text size="xs" c="dimmed">Counts are current business records; failed runs cover the previous seven days. Test conversations are excluded.</Text>
  </Stack>;
}
