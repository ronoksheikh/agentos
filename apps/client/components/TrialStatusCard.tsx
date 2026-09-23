import { Alert, Badge, Card, Group, Text } from "@mantine/core";
import { businessAutomationAllowed } from "@agentos/shared";

export function TrialStatusCard({ trial }: { trial: { state: "TRIAL" | "ACTIVE" | "PAUSED" | "EXPIRED" | "CANCELLED"; disabled: boolean; trialStartedAt: Date | null; trialEndsAt: Date | null; trialExpiryBehavior: "PAUSE_AUTOMATION" | "CONTINUE_AUTOMATION" } }) {
  const serviceOn = businessAutomationAllowed(trial);
  const reachedEnd = trial.state === "TRIAL" && Boolean(trial.trialEndsAt && trial.trialEndsAt <= new Date());
  const detail = trial.state === "TRIAL" && !trial.trialStartedAt ? "Your agency has not activated the trial yet."
    : reachedEnd ? "The trial reached its end. AI and new visitor chat are paused while the agency updates service status. Your records remain available."
    : trial.state === "TRIAL" ? `Your one month free trial ends ${trial.trialEndsAt?.toISOString() ?? "when scheduled"}. Normal use is unlimited, with no setup cost or commitment.`
    : trial.state === "EXPIRED" && trial.trialExpiryBehavior === "CONTINUE_AUTOMATION" ? "The trial ended. Your agency is continuing AI service. Your records remain available."
    : trial.state === "EXPIRED" ? "The trial ended. AI and new visitor chat are paused; your records remain available."
    : trial.state === "ACTIVE" ? "Your agency has activated ongoing service. Trial dates remain visible in your record."
    : "AI service is paused. Your records remain available.";
  return <Card withBorder><Group justify="space-between"><Text fw={600}>Service and trial</Text><Badge color={serviceOn ? "green" : "orange"}>{reachedEnd ? "EXPIRED" : trial.state}{trial.disabled ? " · disabled" : ""}</Badge></Group><Text size="sm" mt="xs">{detail}</Text>{trial.disabled && <Alert mt="xs" color="orange">Service is temporarily disabled. Contact your agency administrator.</Alert>}</Card>;
}
