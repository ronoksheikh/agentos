import { desc, eq } from "drizzle-orm";
import { Alert, Badge, Card, Stack, Table, Text, Title } from "@mantine/core";
import { agencyMemberships, businesses, invitations, users } from "@agentos/database";
import { DashboardShell } from "../../components/Shell";
import { InvitationForm } from "../../components/InvitationForm";
import { database, requireAgencyPage } from "../../lib/server";

export const dynamic = "force-dynamic";
export default async function TeamPage() {
  await requireAgencyPage("agency.manage");
  try {
    const [members, inviteRows] = await Promise.all([
      database.select({ name: users.name, email: users.email, state: users.state, role: agencyMemberships.role, updatedAt: agencyMemberships.updatedAt }).from(agencyMemberships).innerJoin(users, eq(agencyMemberships.userId, users.id)).orderBy(desc(agencyMemberships.updatedAt)).limit(200),
      database.select({ email: invitations.email, scope: invitations.scope, role: invitations.role, business: businesses.name, expiresAt: invitations.expiresAt, acceptedAt: invitations.acceptedAt }).from(invitations).leftJoin(businesses, eq(invitations.businessId, businesses.id)).where(eq(invitations.scope, "AGENCY")).orderBy(desc(invitations.createdAt)).limit(200),
    ]);
    return <DashboardShell><Stack gap="lg"><div><Title order={1}>Team & invitations</Title><Text c="dimmed">Agency membership and invitation status. Invitation tokens and session credentials are never displayed.</Text></div><Card withBorder><InvitationForm scope="AGENCY" /></Card><Title order={3}>Agency members</Title><Card withBorder><Table.ScrollContainer minWidth={680}><Table striped><Table.Thead><Table.Tr>{["Name", "Email", "Role", "Account", "Updated (UTC)"].map((heading) => <Table.Th key={heading}>{heading}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{members.length ? members.map((member) => <Table.Tr key={member.email}><Table.Td>{member.name}</Table.Td><Table.Td>{member.email}</Table.Td><Table.Td>{member.role}</Table.Td><Table.Td><Badge color={member.state === "ACTIVE" ? "green" : "gray"}>{member.state}</Badge></Table.Td><Table.Td>{member.updatedAt.toISOString()}</Table.Td></Table.Tr>) : <Table.Tr><Table.Td colSpan={5}><Text c="dimmed" ta="center" py="md">No agency members found.</Text></Table.Td></Table.Tr>}</Table.Tbody></Table></Table.ScrollContainer></Card><Title order={3}>Recent agency invitations</Title><Card withBorder><Table.ScrollContainer minWidth={680}><Table striped><Table.Thead><Table.Tr>{["Email", "Role", "Status", "Expires (UTC)"].map((heading) => <Table.Th key={heading}>{heading}</Table.Th>)}</Table.Tr></Table.Thead><Table.Tbody>{inviteRows.length ? inviteRows.map((invite, index) => <Table.Tr key={`${invite.email}:${index}`}><Table.Td>{invite.email}</Table.Td><Table.Td>{invite.role}</Table.Td><Table.Td>{invite.acceptedAt ? "Accepted" : invite.expiresAt <= new Date() ? "Expired" : "Pending"}</Table.Td><Table.Td>{invite.expiresAt.toISOString()}</Table.Td></Table.Tr>) : <Table.Tr><Table.Td colSpan={4}><Text c="dimmed" ta="center" py="md">No invitations recorded.</Text></Table.Td></Table.Tr>}</Table.Tbody></Table></Table.ScrollContainer></Card></Stack></DashboardShell>;
  } catch { return <DashboardShell><Alert color="red" title="Team data is temporarily unavailable">Membership records could not be loaded. Try again later or check System Health.</Alert></DashboardShell>; }
}
