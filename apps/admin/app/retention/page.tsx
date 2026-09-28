import { asc } from "drizzle-orm";
import { Alert, Badge, Button, Card, Group, NativeSelect, Stack, Text, TextInput, Title } from "@mantine/core";
import Link from "next/link";
import { businesses } from "@agentos/database";
import { PostgresBusinessRetentionPolicies } from "@agentos/phase4-operations";
import { DashboardShell } from "../../components/Shell";
import { database, requireAgencyPage } from "../../lib/server";
import { saveRetentionPolicyAction } from "./actions";

export const dynamic = "force-dynamic";
const fields = [
  ["messagesDays", "Message text (days)"],
  ["eventPayloadDays", "Processed event payloads (days)"],
  ["traceDetailsDays", "Completed run and tool details (days)"],
  ["realtimePayloadDays", "Realtime history payloads (days)"],
  ["browserHistoryDays", "Browser URLs (days)"],
  ["commentTextDays", "Comment text and author IDs (days)"],
  ["customerContentDays", "Customer context and profile notes (days)"],
  ["orderNotesDays", "Order note text (days)"],
  ["resolvedGoalsDays", "Closed goal descriptions and triggers (days)"],
  ["expiredAnnouncementsDays", "Expired announcement content (days)"],
  ["auditMetadataDays", "Audit event metadata (days)"],
  ["orderCheckoutDetailsDays", "Terminal order checkout details (days)"],
] as const;

export default async function Page({ searchParams }: { searchParams: Promise<{ business?: string; notice?: string }> }) {
  const access = await requireAgencyPage("retention.manage"); const query = await searchParams;
  const businessList = await database.select({ id: businesses.id, name: businesses.name }).from(businesses).orderBy(asc(businesses.name)).limit(100);
  const selected = businessList.find((business) => business.id === query.business);
  const actor = { userId: access.session.user.id, grants: ["retention.manage", "business.manage"] };
  const policy = selected ? await new PostgresBusinessRetentionPolicies(database).get(actor, selected.id) : null;
  return <DashboardShell><Stack gap="lg"><Title order={1}>Content retention</Title><Text c="dimmed" maw={760}>Set business specific ages for scheduled content scrubbing. Empty values keep that content category. Existing attachment and knowledge expiry continues separately.</Text>
    {query.notice && <Alert color={query.notice.includes("failed") || query.notice.includes("invalid") || query.notice.includes("required") || query.notice.includes("concurrent") ? "red" : "blue"}>{query.notice.replaceAll("-", " ")}</Alert>}
    <Group>{businessList.map((business) => <Button key={business.id} component={Link} href={`/retention?business=${encodeURIComponent(business.id)}`} size="xs" variant={selected?.id === business.id ? "filled" : "default"}>{business.name}</Button>)}</Group>
    {!selected || !policy ? <Alert color="gray" title="Choose a business">Retention rules are configured per business. No content scrubbing runs until a policy is enabled.</Alert> :
      <Card withBorder><form action={saveRetentionPolicyAction}><Stack gap="md"><Group justify="space-between"><Title order={3}>{selected.name}</Title><Badge color={policy.enabled ? "orange" : "gray"}>{policy.enabled ? "scrubbing enabled" : "disabled"}</Badge></Group>
        <input type="hidden" name="businessId" value={selected.id} /><input type="hidden" name="expectedRevision" value={policy.revision} />
        <NativeSelect name="enabled" label="Scheduled content scrubbing" defaultValue={String(policy.enabled)} data={[{ value: "false", label: "Disabled" }, { value: "true", label: "Enabled" }]} />
        {fields.map(([name, label]) => <TextInput key={name} name={name} type="number" min={1} max={3650} label={label} description="Leave empty to retain this category." defaultValue={policy[name] ?? ""} />)}
        <TextInput name="confirmScrub" label={'If enabling, type "ENABLE CONTENT SCRUBBING" to confirm'} description="Required only when turning scheduled scrubbing on." />
        <Alert color="orange" title="Content is irreversibly redacted">Scrubbing replaces old content while keeping identifiers, delivery state, financial order records, active goals, current announcements, audit event identity, and retention-policy change metadata. Checkout details are cleared only on terminal orders and closed pending orders. A backup may retain the original content until that backup expires. Trial expiration does not enable or run these rules.</Alert>
        <Button type="submit" w="fit-content">Save retention policy</Button>
      </Stack></form></Card>}
  </Stack></DashboardShell>;
}
