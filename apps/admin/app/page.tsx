import { Badge, Card, Group, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { DashboardShell } from "../components/Shell";
import { requireAgencyPage } from "../lib/server";

export const dynamic = "force-dynamic";
export default async function OverviewPage() {
  await requireAgencyPage("business.read");
  return <DashboardShell><Stack gap="xl"><div><Badge variant="outline" color="dark">Live operations</Badge><Title order={1} mt="sm">Overview</Title><Text c="dimmed">A safe, tenant-aware view of agency operations.</Text></div><SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>{[["Businesses", "24"], ["Unread", "12"], ["Handoffs", "3"], ["Failed runs", "1"]].map(([label, value]) => <Card withBorder key={label}><Text size="xs" c="dimmed">{label}</Text><Text className="metric" fw={700} fz={34}>{value}</Text></Card>)}</SimpleGrid></Stack></DashboardShell>;
}
