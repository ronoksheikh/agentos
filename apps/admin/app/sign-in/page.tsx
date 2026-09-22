"use client";
import { Alert, Button, Center, Paper, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useState } from "react";

export default function SignInPage() {
  const [error, setError] = useState(""); const form = useForm({ initialValues: { email: "", password: "" }, validate: { email: (v) => /^\S+@\S+$/.test(v) ? null : "Enter a valid email", password: (v) => v.length ? null : "Password is required" } });
  const submit = form.onSubmit(async (values) => { setError(""); const response = await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) }); if (!response.ok) { setError("Sign-in failed. Check your credentials or account status."); return; } window.location.assign("/"); });
  return <Center mih="100vh" p="md"><Paper withBorder p="xl" w="100%" maw={420}><form onSubmit={submit}><Stack><div><Title order={2}>Agency sign in</Title><Text c="dimmed" size="sm">Authorized AgentOS operators only</Text></div>{error && <Alert color="red">{error}</Alert>}<TextInput label="Email" autoComplete="email" {...form.getInputProps("email")} /><PasswordInput label="Password" autoComplete="current-password" {...form.getInputProps("password")} /><Button type="submit" loading={form.submitting}>Sign in</Button><Text size="xs" c="dimmed">Password reset and invitation acceptance use expiring server-issued links.</Text></Stack></form></Paper></Center>;
}
