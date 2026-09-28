"use client";

import { Alert, Button, Center, Paper, PasswordInput, Stack, TextInput, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useEffect, useState } from "react";

export default function AcceptInvitationPage() {
  const [state, setState] = useState("");
  const [token, setToken] = useState("");
  const form = useForm({ initialValues: { name: "", password: "" }, validate: { name: (value) => value ? null : "Name is required", password: (value) => value.length >= 12 ? null : "Use at least 12 characters" } });
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    setToken(value);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    if (!value) setState("Missing invitation token.");
  }, []);
  return <Center mih="100vh" p="md"><Paper withBorder p="xl" w="100%" maw={420}><form onSubmit={form.onSubmit(async (values) => {
    if (!token) return setState("Missing invitation token.");
    const response = await fetch("/api/invitations/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, ...values }) });
    setState(response.ok ? "Invitation accepted. You can now sign in." : "Invitation is invalid, expired, or already used.");
  })}><Stack><Title order={2}>Accept agency invitation</Title>{state && <Alert color={state.startsWith("Invitation accepted") ? "green" : "red"}>{state}</Alert>}<TextInput label="Name" {...form.getInputProps("name")} /><PasswordInput label="Password" {...form.getInputProps("password")} /><Button type="submit" disabled={!token}>Accept invitation</Button></Stack></form></Paper></Center>;
}
