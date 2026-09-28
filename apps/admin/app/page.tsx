import { Alert, Badge, Card, Group, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { DashboardShell } from "../components/Shell";
import { database, requireAgencyPage } from "../lib/server";
import { readAgencyOverview } from "../lib/overview";

export const dynamic = "force-dynamic";
export default async function OverviewPage() {
  await requireAgencyPage("business.read");
  try {
    const overview = await readAgencyOverview(database);
    const metrics = [["Businesses", overview.businesses, "All registered businesses"], ["Unread", overview.unread, "Current unread conversations; tests excluded"], ["Open handoffs", overview.handoffs, "Requested, human active, or paused; tests excluded"], ["Failed runs · 7 days", overview.failedRuns, "All run kinds started in the rolling 7-day window"]] as const;
    return <DashboardShell><Stack gap="xl"><div><Badge variant="outline" color="dark">Live operations</Badge><Title order={1} mt="sm">Overview</Title><Text c="dimmed">Agency-wide operational counts · Updated {overview.asOf} (UTC)</Text></div><SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>{metrics.map(([label, value, detail]) => <Card withBorder key={label}><Text size="xs" c="dimmed">{label}</Text><Text className="metric" fw={700} fz={34}>{Number(value).toLocaleString("en-US")}</Text><Text size="xs" c="dimmed" mt="xs">{detail}</Text></Card>)}</SimpleGrid><Alert color="gray">Client and business-specific reporting is available in the selected business workspace. See Usage for model tokens and tool/browser activity.</Alert></Stack></DashboardShell>;
  } catch {
    return <DashboardShell><Stack gap="lg"><Title order={1}>Overview</Title><Alert color="red" title="Agency overview is temporarily unavailable">Operational counts could not be loaded. Try again later or check System Health.</Alert></Stack></DashboardShell>;
  }
}
