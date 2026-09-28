import { desc } from "drizzle-orm";
import { Alert, Badge, Button, Card, Group, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import Link from "next/link";
import { businesses } from "@agentos/database";
import { agencyCapabilities, agencyRoleSchema } from "@agentos/auth";
import { DashboardShell } from "../../components/Shell";
import { database, requireAgencyPage } from "../../lib/server";
import { createAgencyBusinessAction } from "./actions";

export const dynamic = "force-dynamic";
export default async function BusinessesPage() {
  const access = await requireAgencyPage("business.read");
  const canCreate = agencyCapabilities(agencyRoleSchema.parse(access.membership.role), access.membership.capabilities).includes("business.manage");
  try {
    const rows = await database.select({ id: businesses.id, name: businesses.name, state: businesses.state, disabled: businesses.disabled, onboardingState: businesses.onboardingState, trialEndsAt: businesses.trialEndsAt, updatedAt: businesses.updatedAt }).from(businesses).orderBy(desc(businesses.updatedAt)).limit(200);
    return <DashboardShell><Stack gap="lg"><Group justify="space-between"><div><Title order={1}>Businesses</Title><Text c="dimmed">Registered agency businesses and their current onboarding and trial state.</Text></div><Badge variant="light">{rows.length} shown · latest 200</Badge></Group>{canCreate && <Card withBorder><Text fw={600} mb="sm">Create business</Text><form action={createAgencyBusinessAction}><Group align="end"><TextInput name="name" label="Business name" required maxLength={200} /><Button type="submit">Create and open</Button></Group><Text size="xs" c="dimmed" mt="xs">New businesses start in onboarding. Start a trial separately after setup is approved.</Text></form></Card>}<Card withBorder><Table.ScrollContainer minWidth={820}><Table striped highlightOnHover><Table.Thead><Table.Tr>{["Business", "Service state", "Onboarding", "Trial ends (UTC)", "Updated (UTC)", "Workspace"].map((heading) => <Table.Th key={heading}>{heading}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{rows.length ? rows.map((row) => <Table.Tr key={row.id}><Table.Td><Text fw={600}>{row.name}</Text><Text size="xs" c="dimmed" ff="monospace">{row.id}</Text></Table.Td><Table.Td><Badge color={row.disabled ? "red" : row.state === "ACTIVE" || row.state === "TRIAL" ? "green" : "gray"}>{row.disabled ? "DISABLED" : row.state}</Badge></Table.Td><Table.Td>{row.onboardingState}</Table.Td><Table.Td>{row.trialEndsAt?.toISOString() ?? "—"}</Table.Td><Table.Td>{row.updatedAt.toISOString()}</Table.Td><Table.Td><Button component={Link} href={`/businesses/${row.id}`} size="xs" variant="default">Open</Button></Table.Td></Table.Tr>) : <Table.Tr><Table.Td colSpan={6}><Text c="dimmed" ta="center" py="md">No businesses are registered yet.</Text></Table.Td></Table.Tr>}</Table.Tbody></Table></Table.ScrollContainer></Card></Stack></DashboardShell>;
  } catch {
    return <DashboardShell><Alert color="red" title="Businesses are temporarily unavailable">The business list could not be loaded. Try again later or check System Health.</Alert></DashboardShell>;
  }
}
