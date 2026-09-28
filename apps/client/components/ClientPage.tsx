import { Alert, Badge, Button, Card, Group, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
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

export function ClientPage({ section, businessId, snapshot, notificationAction }: { section: string; businessId: string; snapshot: Snapshot; notificationAction?: (form: FormData) => Promise<void> }) {
  const [title, description] = copy[section] ?? [section, "Business workspace"];
  const counters = [
    { key: "unreadConversations", label: "Unread conversations", value: snapshot.counters.unreadConversations },
    { key: "unresolvedHandoffs", label: "Unresolved handoffs", value: snapshot.counters.unresolvedHandoffs },
    { key: "failedRuns", label: "Failed runs · 7 days", value: snapshot.counters.failedRuns },
    { key: "urgentIssues", label: "Urgent conversations", value: snapshot.counters.urgentIssues },
  ] as const;
  const conversationLink = (id: string) => `/conversations/${encodeURIComponent(id)}?business=${encodeURIComponent(businessId)}`;
  const performance = snapshot.performance;
  const duration = (value: number | null) => value === null ? "—" : value < 60_000 ? `${Math.round(value / 1000)} sec` : `${Math.floor(value / 60_000)} min ${Math.round((value % 60_000) / 1000)} sec`;
  return <Stack gap="lg">
    <Group justify="space-between" align="start"><div><Title order={1}>{title}</Title><Text c="dimmed">{description}</Text></div><Badge variant="outline">Updated {utc(snapshot.asOf)}</Badge></Group>
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>{counters.map((counter) => <Card withBorder key={counter.key} component={Link} href={`${CLIENT_COUNTER_LINKS[counter.key]}&business=${encodeURIComponent(businessId)}`}><Text size="xs" c="dimmed">{counter.label}</Text><Text className="client-metric" fw={700} fz={30}>{counter.value}</Text></Card>)}</SimpleGrid>
    {section === "overview" && performance && <Card withBorder><Stack gap="sm"><div><Text fw={600}>Performance · rolling 30 days</Text><Text size="xs" c="dimmed">{performance.inboundConversations} conversations with an inbound customer message. Successful persisted replies only.</Text></div><SimpleGrid cols={{ base: 2, sm: 2, lg: 4 }}>
      <div><Text size="xs" c="dimmed">AI first-response rate</Text><Text fw={700} fz={24}>{performance.aiFirstResponseRate === null ? "—" : `${performance.aiFirstResponseRate}%`}</Text><Text size="xs" c="dimmed">First successful reply was from the agent, out of all inbound conversations.</Text></div>
      <div><Text size="xs" c="dimmed">Handoff rate</Text><Text fw={700} fz={24}>{performance.handoffRate === null ? "—" : `${performance.handoffRate}%`}</Text><Text size="xs" c="dimmed">Conversations with a handoff created in this period.</Text></div>
      <div><Text size="xs" c="dimmed">Customers helped</Text><Text fw={700} fz={24}>{performance.customersHelped}</Text><Text size="xs" c="dimmed">Distinct customer records with a successful reply.</Text></div>
      <div><Text size="xs" c="dimmed">Median first-response time</Text><Text fw={700} fz={24}>{duration(performance.medianFirstResponseMs)}</Text><Text size="xs" c="dimmed">Among conversations with a successful reply.</Text></div>
    </SimpleGrid><Text size="xs" c="dimmed">AI and handoff rates use all inbound conversations in the denominator, including unanswered conversations. “Agent” and “human” replies are recorded after the channel accepts delivery. Refreshed when this page loads; timestamps and the window use UTC.</Text></Stack></Card>}
    {section === "overview" && <Card withBorder><Stack gap="sm"><Group justify="space-between"><Text fw={600}>Notifications</Text><Badge variant="light">{snapshot.notifications.filter((item) => !item.acknowledgedAt).length} unread</Badge></Group>{snapshot.notifications.length ? snapshot.notifications.map((item) => <Group key={item.id} justify="space-between" align="start" wrap="nowrap"><div><Text fw={item.acknowledgedAt ? 400 : 600}>{item.type === "HANDOFF_REQUESTED" ? "A customer needs a person" : item.type === "COMMENT_REVIEW" ? "A comment needs review" : item.type.replaceAll("_", " ").toLowerCase()}</Text><Text size="xs" c="dimmed">{item.severity} · {utc(item.createdAt)}{item.conversationId ? <> · <Link href={conversationLink(item.conversationId)}>Open conversation</Link></> : null}</Text></div>{!item.acknowledgedAt && notificationAction && <form action={notificationAction}><input type="hidden" name="businessId" value={businessId} /><input type="hidden" name="notificationId" value={item.id} /><Button type="submit" size="xs" variant="default">Mark read</Button></form>}</Group>) : <Text size="sm" c="dimmed">You’re all caught up.</Text>}</Stack></Card>}
    {section === "needs-attention" && <Alert title="Human ownership pauses AI replies">Open a conversation to review the request and available actions.</Alert>}
    {section === "agent-activity" ? <Card withBorder><Text fw={600} mb="md">Recent agent runs</Text>{snapshot.runs.length ? <Table.ScrollContainer minWidth={640}><Table striped><Table.Thead><Table.Tr><Table.Th>Agent</Table.Th><Table.Th>Status</Table.Th><Table.Th>Started</Table.Th><Table.Th>Completed</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{snapshot.runs.map((run) => <Table.Tr key={run.id}><Table.Td>{run.agentName}</Table.Td><Table.Td><Badge color={run.status === "FAILED" ? "red" : run.status === "COMPLETED" ? "green" : "gray"}>{run.status}</Badge></Table.Td><Table.Td>{utc(run.startedAt)}</Table.Td><Table.Td>{run.completedAt ? utc(run.completedAt) : "—"}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer> : <Text c="dimmed">No matching agent runs yet.</Text>}</Card> : null}
    {section === "needs-attention" ? <Card withBorder><Text fw={600} mb="md">Unresolved handoffs</Text>{snapshot.attention.length ? <Table.ScrollContainer minWidth={640}><Table striped highlightOnHover><Table.Thead><Table.Tr><Table.Th>Customer</Table.Th><Table.Th>Channel</Table.Th><Table.Th>State</Table.Th><Table.Th>Priority</Table.Th><Table.Th>Updated</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{snapshot.attention.map((row) => <Table.Tr key={row.id}><Table.Td><Link href={conversationLink(row.conversationId)}>{row.customerName || "Unnamed customer"}</Link></Table.Td><Table.Td>{row.channel}</Table.Td><Table.Td>{row.state.replaceAll("_", " ")}</Table.Td><Table.Td><Badge color={row.priority === "URGENT" ? "red" : "orange"}>{row.priority}</Badge></Table.Td><Table.Td>{utc(row.updatedAt)}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer> : <Text c="dimmed">No unresolved handoffs.</Text>}</Card> : null}
    {!new Set(["agent-activity", "needs-attention"]).has(section) ? <Card withBorder><Text fw={600} mb="md">Recent conversations</Text>{snapshot.recent.length ? <Table.ScrollContainer minWidth={640}><Table striped highlightOnHover><Table.Thead><Table.Tr><Table.Th>Customer</Table.Th><Table.Th>Channel</Table.Th><Table.Th>Ownership</Table.Th><Table.Th>Updated</Table.Th></Table.Tr></Table.Thead><Table.Tbody>{snapshot.recent.map((row) => <Table.Tr key={row.id}><Table.Td><Link href={conversationLink(row.id)}>{row.customerName || "Unnamed customer"}</Link>{row.unread && <Badge size="xs" ml="xs">Unread</Badge>}</Table.Td><Table.Td>{row.channel}</Table.Td><Table.Td><Badge color={row.urgent ? "red" : row.ownership === "AI_ACTIVE" ? "green" : "orange"}>{row.ownership.replaceAll("_", " ")}</Badge></Table.Td><Table.Td>{utc(row.updatedAt)}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer> : <Text c="dimmed">No matching conversations yet.</Text>}</Card> : null}
    <Text size="xs" c="dimmed">Counts are current business records; failed runs cover the previous seven days. Test conversations are excluded.</Text>
  </Stack>;
}
