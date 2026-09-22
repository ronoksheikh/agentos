"use client";
import { AppShell, Burger, Button, Group, NavLink, ScrollArea, Stack, Text, Title, ActionIcon, useMantineColorScheme } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import Link from "next/link";
import { sections } from "./navigation";

const hrefFor = (name: string) => name === "Overview" ? "/" : `/${name.toLowerCase().replaceAll(" & ", "-").replaceAll(" ", "-")}`;

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [opened, { toggle }] = useDisclosure(); const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  return <AppShell header={{ height: 64 }} navbar={{ width: 248, breakpoint: "sm", collapsed: { mobile: !opened } }} padding="lg">
    <AppShell.Header><Group h="100%" px="lg" justify="space-between"><Group><Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" /><Title order={3}>AgentOS</Title><Text c="dimmed" size="sm">Agency control plane</Text></Group><ActionIcon variant="default" aria-label="Toggle color scheme" onClick={() => toggleColorScheme()}>{colorScheme === "dark" ? "☀" : "◐"}</ActionIcon></Group></AppShell.Header>
    <AppShell.Navbar p="sm"><AppShell.Section grow component={ScrollArea}><Stack gap={2}>{sections.map((name) => <NavLink key={name} component={Link} href={hrefFor(name)} label={name} />)}</Stack></AppShell.Section><AppShell.Section><Stack gap="xs"><Button variant="subtle" color="gray" size="xs" onClick={async () => { await fetch("/api/auth/sign-out", { method: "POST" }); window.location.assign("/sign-in"); }}>Sign out</Button><Text size="xs" c="dimmed">Internal agency access only</Text></Stack></AppShell.Section></AppShell.Navbar>
    <AppShell.Main>{children}</AppShell.Main>
  </AppShell>;
}
