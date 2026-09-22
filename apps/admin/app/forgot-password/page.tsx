"use client";
import { Alert, Button, Center, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useState } from "react";

export default function ForgotPasswordPage() { const [sent, setSent] = useState(false); const form = useForm({ initialValues: { email: "" }, validate: { email: (v) => /^\S+@\S+$/.test(v) ? null : "Enter a valid email" } }); return <Center mih="100vh" p="md"><Paper withBorder p="xl" w="100%" maw={420}><form onSubmit={form.onSubmit(async ({ email }) => { await fetch("/api/auth/request-password-reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, redirectTo: "/reset-password" }) }); setSent(true); })}><Stack><Title order={2}>Reset password</Title><Text c="dimmed">If an active account exists, an expiring reset link will be delivered.</Text>{sent && <Alert color="green">Check your email for the reset link.</Alert>}<TextInput label="Email" {...form.getInputProps("email")} /><Button type="submit">Send reset link</Button></Stack></form></Paper></Center>; }
