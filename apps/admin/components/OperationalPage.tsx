import { Alert, Badge, Button, Card, Grid, Group, Progress, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";

const pageCopy: Record<string, { title: string; description: string }> = {
  businesses: { title: "Businesses", description: "Onboarding, structured profiles, assignments, and operational announcements." },
  agents: { title: "Agents & versions", description: "Draft safely, test explicit snapshots, publish atomically, and roll back." },
  "agent-playground": { title: "Agent Playground", description: "Disposable simulations through the canonical runtime. External effects stay blocked." },
  tools: { title: "Tools", description: "Review tool safety classes, grants, and business policy outcomes." },
  customers: { title: "Customers", description: "Business-scoped identities and auditable match decisions." },
  conversations: { title: "Conversations", description: "Authorized search by customer, phone, order, message, tag, state, channel, date, unread, and agent." },
  memories: { title: "Memories & context", description: "Inspect memories, pins, summaries, pending goals, provenance, expiry, and outdated state." },
  runs: { title: "Runs & tool calls", description: "Safe facts, context provenance, actions, usage, latency, and typed failures." },
  handoffs: { title: "Handoffs", description: "Inspect unresolved requests. Ownership workflow arrives with the client dashboard." },
  integrations: { title: "Integrations", description: "Connection management is intentionally unavailable until later phases." },
  "failures-queues": { title: "Failures & queues", description: "Queue infrastructure is intentionally deferred to Phase 5." },
  "audit-logs": { title: "Audit logs", description: "Append-only, redacted records of material control-plane changes." },
  "feature-flags": { title: "Feature flags", description: "Audited global and business-scoped capability rollout." },
  team: { title: "Team & invitations", description: "Agency roles, client invitations for later activation, and session revocation." },
  settings: { title: "Settings", description: "Agency preferences, session security, and retention placeholders." },
};

export function OperationalPage({ section }: { section: string }) {
  const copy = pageCopy[section] ?? { title: section, description: "Authorized operational workspace." }; const deferred = ["integrations", "failures-queues", "handoffs"].includes(section);
  return <Stack gap="lg"><Group justify="space-between" align="start"><div><Title order={1}>{copy.title}</Title><Text c="dimmed" maw={720}>{copy.description}</Text></div><Button>{section === "businesses" ? "Onboard business" : "Create"}</Button></Group>
    {deferred && <Alert title="Planned foundation" color="gray">The data contract is visible, but execution is deferred by the Phase 2 boundary.</Alert>}
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>{["Unread conversations", "Unresolved handoffs", "Failed runs", "Urgent issues"].map((label, i) => <Card withBorder key={label}><Text size="xs" c="dimmed">{label}</Text><Text className="metric" fw={700} fz={30}>{[12, 3, 1, 2][i]}</Text></Card>)}</SimpleGrid>
    <Grid><Grid.Col span={{ base: 12, lg: 8 }}><Card withBorder><Group justify="space-between" mb="md"><Text fw={600}>Operational records</Text><Badge variant="light">Tenant scoped</Badge></Group><Table.ScrollContainer minWidth={560}><Table striped highlightOnHover><Table.Thead><Table.Tr><Table.Th>Name</Table.Th><Table.Th>Status</Table.Th><Table.Th>Updated</Table.Th></Table.Tr></Table.Thead><Table.Tbody><Table.Tr><Table.Td>Example record</Table.Td><Table.Td><Badge color="dark">Ready</Badge></Table.Td><Table.Td>Just now</Table.Td></Table.Tr></Table.Tbody></Table></Table.ScrollContainer></Card></Grid.Col><Grid.Col span={{ base: 12, lg: 4 }}><Card withBorder><Text fw={600}>Onboarding progress</Text><Progress value={62} my="md" color="dark" /><Text size="sm" c="dimmed">Structured profile and agent configuration are ready. Channels remain pending.</Text></Card></Grid.Col></Grid>
  </Stack>;
}
