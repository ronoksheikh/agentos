import { Alert, Button, Stack, Text, Title } from "@mantine/core";
import Link from "next/link";

const pageCopy: Record<string, { title: string; description: string }> = {
  businesses: { title: "Businesses", description: "Onboarding, structured profiles, assignments, and operational announcements." },
  agents: { title: "Agents & versions", description: "Draft safely, test explicit snapshots, publish atomically, and roll back." },
  "agent-playground": { title: "Agent Playground", description: "Run isolated previews against saved agent versions with tools and external actions suppressed." },
  tools: { title: "Tools", description: "Review tool safety classes, grants, and business policy outcomes." },
  knowledge: { title: "Knowledge", description: "Inspect source lifecycle, attribution, errors, and versions within a business workspace." },
  orders: { title: "Orders", description: "Inspect confirmed conversational orders, immutable snapshots, and source provenance." },
  attachments: { title: "Attachments", description: "Inspect media processing status and safe derived metadata." },
  "browser-runs": { title: "Browser runs", description: "Inspect isolated browser activity without page secrets or screenshots." },
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
  if (["knowledge", "orders", "attachments", "browser-runs"].includes(section)) return <Stack gap="lg"><Title order={1}>{copy.title}</Title><Text c="dimmed">{copy.description}</Text><Alert title="Choose a business" color="gray">Phase 4 records are scoped to one business. Open its workspace to inspect the live table.</Alert><Button component={Link} href="/businesses" variant="default" w="fit-content">Open businesses</Button></Stack>;
  return <Stack gap="lg"><Title order={1}>{copy.title}</Title><Text c="dimmed" maw={720}>{copy.description}</Text>
    {deferred ? <Alert title="Planned foundation" color="gray">This area does not have an operational data view yet.</Alert> : <Alert title="Live data view unavailable" color="gray">This route is a navigation placeholder. Open a business workspace for records that are currently available.</Alert>}
    <Button component={Link} href="/businesses" variant="default" w="fit-content">Open businesses</Button>
  </Stack>;
}
