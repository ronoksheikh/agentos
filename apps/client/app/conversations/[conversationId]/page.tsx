import { Alert, Badge, Button, Card, Group, Stack, Text, Textarea, TextInput, Title } from "@mantine/core";
import { notFound } from "next/navigation";
import { ulid } from "ulid";
import { businessCapabilities, businessRoleSchema } from "@agentos/auth";
import { PostgresHandoffOperations } from "@agentos/handoff";
import { createTrustedBusinessContext, ulidSchema } from "@agentos/shared";
import { ClientShell } from "../../../components/Shell";
import { database, requireClientPage } from "../../../lib/server";
import { resolveAction, resumeAgentAction, sendWebsiteReplyAction, takeOverAction } from "./actions";

export const dynamic = "force-dynamic";
const operations = new PostgresHandoffOperations(database);
export default async function Page({ params, searchParams }: { params: Promise<{ conversationId: string }>; searchParams: Promise<{ business?: string; notice?: string }> }) {
  const { conversationId } = await params; if (!ulidSchema.safeParse(conversationId).success) notFound();
  const query = await searchParams; const access = await requireClientPage("conversation.read", query.business);
  const businessId = access.membership.businessId; const grants = businessCapabilities(businessRoleSchema.parse(access.membership.role), access.membership.capabilities);
  const context = createTrustedBusinessContext({ businessId, principal: { kind: "user", userId: access.session.user.id, sessionId: access.session.session.id }, source: "authenticated_request", traceId: ulid(), capabilityGrants: grants });
  const detail = await operations.detail(context, conversationId).catch((error) => { if (error instanceof Error && error.message === "CONVERSATION_NOT_FOUND") notFound(); throw error; });
  const canManage = grants.includes("handoff.manage"); const handoff = detail.handoff; const actorId = access.session.user.id;
  const fields = <><input type="hidden" name="businessId" value={businessId} /><input type="hidden" name="conversationId" value={conversationId} /></>;
  return <ClientShell businessId={businessId} businessName={access.membership.businessName} role={access.membership.role} businesses={access.businesses}><Stack gap="lg">
    <Group justify="space-between"><div><Title order={1}>{detail.customerName || "Conversation"}</Title><Text c="dimmed">{detail.channel} · {conversationId}</Text></div><Badge color={detail.ownership === "AI_ACTIVE" ? "green" : "orange"}>{detail.ownership.replaceAll("_", " ")}</Badge></Group>
    {query.notice && <Alert color={query.notice.includes("failed") || query.notice.includes("invalid") || query.notice.includes("required") || query.notice.includes("unavailable") ? "red" : "green"}>{query.notice.replaceAll("-", " ")}</Alert>}
    {handoff && <Card withBorder><Stack gap="xs"><Group justify="space-between"><Text fw={600}>Human handoff</Text><Badge color={handoff.priority === "URGENT" ? "red" : "orange"}>{handoff.priority}</Badge></Group><Text size="sm">{handoff.reason}</Text><Text size="xs" c="dimmed">State: {handoff.state.replaceAll("_", " ")}{handoff.assignedTo === actorId ? " · assigned to you" : handoff.assignedTo ? " · assigned to another teammate" : ""}</Text>{handoff.resolution && <Text size="sm">Resolution: {handoff.resolution}</Text>}</Stack></Card>}
    <Card withBorder><Text fw={600} mb="md">Messages</Text><Stack gap="sm">{detail.messages.length ? detail.messages.map((message) => <Card key={message.id} withBorder padding="sm"><Group justify="space-between"><Badge variant="light">{message.senderKind}</Badge><Text size="xs" c="dimmed">{message.occurredAt.slice(0, 16).replace("T", " ")} UTC</Text></Group><Text mt="xs" style={{ whiteSpace: "pre-wrap" }}>{message.text || "Attachment or non-text message"}</Text></Card>) : <Text c="dimmed">No messages yet.</Text>}</Stack></Card>
    <Alert color="gray" title="Client-safe view">Provider details, credentials, internal prompts, tool values, traces, and hidden reasoning are not shown.</Alert>
    {canManage && handoff && <Group align="start">
      {["HANDOFF_REQUESTED", "PAUSED"].includes(handoff.state) && <form action={takeOverAction}>{fields}<Button type="submit">Take over</Button></form>}
      {["HANDOFF_REQUESTED", "HUMAN_ACTIVE", "PAUSED"].includes(handoff.state) && <form action={resolveAction}>{fields}<Stack gap="xs"><TextInput name="resolution" label="Resolution" maxLength={1000} required /><Button type="submit" variant="light">Mark resolved</Button></Stack></form>}
      {["RESOLVED", "PAUSED"].includes(handoff.state) && <form action={resumeAgentAction}>{fields}<Button type="submit" variant="light">Resume Agent</Button></form>}
    </Group>}
    {canManage && handoff?.state === "HUMAN_ACTIVE" && handoff.assignedTo === actorId && detail.channel === "web_chat" && <Card withBorder><form action={sendWebsiteReplyAction}><Stack gap="xs">{fields}<input type="hidden" name="idempotencyKey" value={ulid()} /><Textarea name="message" label="Reply to visitor" minRows={3} maxLength={4000} required /><Button type="submit">Send reply</Button><Text size="xs" c="dimmed">The visitor receives this through the active Website Chat session. Only the assigned teammate can send.</Text></Stack></form></Card>}
  </Stack></ClientShell>;
}
