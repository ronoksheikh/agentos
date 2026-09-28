"use client";

import { Alert, Button, Group, Select, Stack, Text, TextInput } from "@mantine/core";
import { useActionState } from "react";
import { createInvitationAction } from "../app/team/actions";

const agencyRoles = ["ADMIN", "SUPPORT", "DEVELOPER", "SUPER_ADMIN"];
const businessRoles = ["OWNER", "ADMIN", "STAFF", "VIEWER"];

export function InvitationForm({ scope, businessId }: { scope: "AGENCY" | "BUSINESS"; businessId?: string }) {
  const [state, action, pending] = useActionState(createInvitationAction, { kind: "idle" as const, message: "" });
  const roles = scope === "AGENCY" ? agencyRoles : businessRoles;
  return <Stack gap="sm"><Text fw={600}>{scope === "AGENCY" ? "Invite agency member" : "Invite client team member"}</Text><form action={action}><Stack gap="sm"><input type="hidden" name="scope" value={scope} />{businessId && <input type="hidden" name="businessId" value={businessId} />}<TextInput name="email" type="email" label="Email address" required maxLength={320} /><Select name="role" label="Role" data={roles} defaultValue={scope === "AGENCY" ? "SUPPORT" : "STAFF"} required /><Group justify="space-between" align="center"><Text size="xs" c="dimmed">The invitation expires after 72 hours and is sent by the configured email gateway.</Text><Button type="submit" loading={pending}>Send invitation</Button></Group></Stack></form>{state.kind !== "idle" && <Alert color={state.kind === "success" ? "green" : "red"} role="status">{state.message}</Alert>}</Stack>;
}
