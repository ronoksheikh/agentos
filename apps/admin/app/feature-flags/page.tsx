import { asc } from "drizzle-orm";
import { Alert, Badge, Button, Card, Group, NativeSelect, Stack, Text, Title } from "@mantine/core";
import Link from "next/link";
import { agencyCapabilities, agencyRoleSchema } from "@agentos/auth";
import { businesses } from "@agentos/database";
import { PostgresFeatureFlags } from "@agentos/feature-flags";
import { DashboardShell } from "../../components/Shell";
import { database, requireAgencyPage } from "../../lib/server";
import { changeFeatureFlagAction } from "./actions";

export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ business?: string; notice?: string }> }) {
  const access = await requireAgencyPage("feature_flag.manage"); const query = await searchParams;
  const businessList = await database.select({ id: businesses.id, name: businesses.name }).from(businesses).orderBy(asc(businesses.name)).limit(100);
  const selected = businessList.find((business) => business.id === query.business);
  const actor = { userId: access.session.user.id, grants: agencyCapabilities(agencyRoleSchema.parse(access.membership.role), access.membership.capabilities) };
  const flags = await new PostgresFeatureFlags(database).list(actor, selected?.id);
  const visible = flags.filter((flag) => flag.key === "browser" || flag.key === "comment_ai");
  return <DashboardShell><Stack gap="lg"><Title order={1}>Feature flags</Title><Text c="dimmed">Audited global defaults and business overrides. Changes take effect on the next server-side decision.</Text>{query.notice && <Alert color={query.notice.includes("failed") || query.notice.includes("invalid") || query.notice.includes("concurrent") ? "red" : "blue"}>{query.notice.replaceAll("-", " ")}</Alert>}
    <Group><Button component={Link} href="/feature-flags" size="xs" variant={!selected ? "filled" : "default"}>Global</Button>{businessList.map((business) => <Button key={business.id} component={Link} href={`/feature-flags?business=${encodeURIComponent(business.id)}`} size="xs" variant={selected?.id === business.id ? "filled" : "default"}>{business.name}</Button>)}</Group>
    {visible.map((flag) => <Card withBorder key={flag.key}><Stack gap="sm"><Group justify="space-between"><div><Title order={3}>{flag.key === "browser" ? "Browser tools" : "Comment AI"}</Title><Text size="sm" c="dimmed">{flag.key === "browser" ? "Controls the browser.use capability granted to the worker." : "Controls automated Page comment decisions alongside Page policy and verified capabilities."}</Text></div><Badge color={flag.effective ? "green" : "gray"}>{flag.effective ? "Enabled" : "Disabled"}</Badge></Group><Text size="xs">Built-in default: {flag.defaultEnabled ? "on" : "off"}. Global: {flag.global ? `${flag.global.enabled ? "on" : "off"} (revision ${flag.global.revision})` : "inherits built-in"}. {selected && `Business: ${flag.tenant ? `${flag.tenant.enabled ? "on" : "off"} (revision ${flag.tenant.revision})` : "inherits global"}.`}</Text>
      <form action={changeFeatureFlagAction}><Group align="end"><input type="hidden" name="scope" value={selected ? "tenant" : "global"} /><input type="hidden" name="businessId" value={selected?.id ?? ""} /><input type="hidden" name="key" value={flag.key} /><input type="hidden" name="expectedRevision" value={selected ? flag.tenant?.revision ?? 0 : flag.global?.revision ?? 0} /><NativeSelect name="enabled" label={selected ? "Business override" : "Global value"} defaultValue={selected ? String(flag.tenant?.enabled ?? flag.effective) : String(flag.global?.enabled ?? flag.defaultEnabled)} data={[{ value: "true", label: "Enabled" }, { value: "false", label: "Disabled" }]} /><Button type="submit" size="sm">Save</Button></Group></form>
      {selected && flag.tenant && <form action={changeFeatureFlagAction}><input type="hidden" name="scope" value="tenant" /><input type="hidden" name="mode" value="clear" /><input type="hidden" name="businessId" value={selected.id} /><input type="hidden" name="key" value={flag.key} /><input type="hidden" name="expectedRevision" value={flag.tenant.revision} /><Button type="submit" variant="light" size="xs">Inherit global value</Button></form>}
    </Stack></Card>)}<Text size="xs" c="dimmed">Advanced memory, runtime variants, and experimental tools remain unavailable until their server-side consumers are implemented and evaluated.</Text></Stack></DashboardShell>;
}
