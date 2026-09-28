"use client";

import { useActionState } from "react";
import { Alert, Button, Card, NativeSelect, Stack, Text, Textarea, Title } from "@mantine/core";
import { runAgentPlaygroundAction, type PlaygroundActionState } from "../app/agent-playground/actions";

const initialState: PlaygroundActionState = { outcome: "idle", message: "" };
export function AgentPlaygroundForm(props: { businessId: string; agentId: string; versionId: string }) {
  const [state, action, pending] = useActionState(runAgentPlaygroundAction, initialState);
  return <Card withBorder><Stack gap="md">
    <Title order={2} size="h3">Run a preview</Title>
    <Alert color="yellow" title="Isolated test run">The prompt is sent to the configured model. It is not saved with the run. Tools are hidden and generated actions are previewed without delivery.</Alert>
    <form action={action}><Stack gap="sm">
      <input type="hidden" name="businessId" value={props.businessId} /><input type="hidden" name="agentId" value={props.agentId} /><input type="hidden" name="versionId" value={props.versionId} />
      <NativeSelect name="fixture" label="Scenario" defaultValue="WEB_CHAT" data={[{ value: "WEB_CHAT", label: "Website chat" }, { value: "MESSENGER", label: "Messenger" }, { value: "COMMENT", label: "Facebook comment" }, { value: "IMAGE", label: "Image message (text only)" }, { value: "VOICE_TRANSCRIPT", label: "Voice transcript" }]} />
      <Textarea name="text" label="Synthetic customer message" required minRows={4} maxLength={4_000} description="Up to 4,000 characters. Avoid entering real customer or secret data." />
      <Button type="submit" loading={pending} w="fit-content">Run preview</Button>
    </Stack></form>
    {state.outcome !== "idle" && <Alert color={state.outcome === "success" ? "green" : "red"} title={state.outcome === "success" ? "Preview result" : "Preview unavailable"}>{state.message}</Alert>}
    {state.result && <Stack gap="sm"><Text size="sm">Run {state.result.status.toLowerCase()} · {state.result.usage.inputTokens + state.result.usage.outputTokens} reported tokens · {state.result.usage.latencyMs} ms · version {state.result.versionId}</Text>{state.result.draftMessages.map((message, index) => <Card key={index} withBorder><Text size="xs" c="dimmed" mb="xs">Draft message {index + 1}</Text><Text style={{ whiteSpace: "pre-wrap" }}>{message}</Text></Card>)}{state.result.otherActionTypes.length > 0 && <Text size="sm">Other proposed actions: {state.result.otherActionTypes.join(", ")}. These were not applied.</Text>}{!state.result.draftMessages.length && !state.result.otherActionTypes.length && <Text size="sm" c="dimmed">The run completed without a customer-facing message.</Text>}</Stack>}
  </Stack></Card>;
}
