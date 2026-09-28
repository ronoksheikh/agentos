import { Alert, Button, Card, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import Link from "next/link";
import { DashboardShell } from "../../components/Shell";
import { requireAgencyPage } from "../../lib/server";

export const dynamic = "force-dynamic";
export default async function SettingsPage() {
  await requireAgencyPage("business.read");
  const settings = [{ label: "System health", href: "/system-health", detail: "Readiness, worker heartbeats, queue state, and provider circuit health." }, { label: "Feature flags", href: "/feature-flags", detail: "Audited global and business-scoped rollout controls." }, { label: "Content retention", href: "/retention", detail: "Business-level age rules and explicit scheduled scrubbing." }];
  return <DashboardShell><Stack gap="lg"><div><Title order={1}>Settings</Title><Text c="dimmed">Agency controls are managed in their audited operational workspaces.</Text></div><Alert color="gray">Session security and provider credentials are deployment-managed. They are not editable in this dashboard.</Alert><SimpleGrid cols={{ base: 1, md: 3 }}>{settings.map((item) => <Card withBorder key={item.href}><Text fw={600}>{item.label}</Text><Text size="sm" c="dimmed" my="sm">{item.detail}</Text><Button component={Link} href={item.href} variant="default">Open</Button></Card>)}</SimpleGrid></Stack></DashboardShell>;
}
