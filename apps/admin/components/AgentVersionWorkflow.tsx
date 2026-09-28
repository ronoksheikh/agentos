"use client";

import { Alert, Button, Group, Stack, Text, Textarea } from "@mantine/core";
import {
  archiveAgentVersionAction,
  publishAgentVersionAction,
  rollbackAgentVersionAction,
  runAgentEvaluationAction,
  selectAgentForTestAction,
  updateAgentDraftAction,
} from "../app/agents/actions";

type EvaluationSummary = { status: "PASSED" | "FAILED"; versionRevision?: number | undefined; suiteVersion: string; passedCases: number; failedCases: number; evaluatedAt: string; regressions: string[]; caseResults: Array<{ caseId: string; passed: boolean; failedChecks: string[] }> };

export function AgentVersionWorkflow(props: {
  agentId: string;
  businessId: string;
  versionId: string;
  state: string;
  revision: number;
  publishedAt: string | null;
  active: boolean;
  config: unknown;
  evaluation: EvaluationSummary | null;
  canManage: boolean;
  canRun: boolean;
  workflowMessage?: string | undefined;
}) {
  const editable = props.canManage && (props.state === "DRAFT" || props.state === "TEST");
  const evaluationCurrent = props.evaluation?.versionRevision === props.revision;
  const publishable = evaluationCurrent && props.evaluation?.status === "PASSED" && props.evaluation.failedCases === 0 && props.evaluation.regressions.length === 0;
  const configText = JSON.stringify(props.config, null, 2);
  return <Stack gap="lg">
    {props.workflowMessage && <Alert color={["draft-created", "draft-saved", "test-selected", "evaluation-completed", "evaluation-passed", "published", "rolled-back", "archived", "agent-created"].includes(props.workflowMessage) ? "blue" : "red"} title="Agent workflow">{props.workflowMessage.replaceAll("-", " ")}</Alert>}
    {editable && <form action={updateAgentDraftAction}><Stack gap="sm"><input type="hidden" name="agentId" value={props.agentId} /><input type="hidden" name="businessId" value={props.businessId} /><input type="hidden" name="versionId" value={props.versionId} /><input type="hidden" name="revision" value={props.revision} /><Textarea name="config" label="Agent configuration (JSON)" description="Edit the validated version configuration. Saving creates a new revision and requires a fresh evaluation." minRows={20} autosize defaultValue={configText} styles={{ input: { fontFamily: "monospace" } }} /><Button type="submit">Save draft revision</Button></Stack></form>}
    <CardlessActions agentId={props.agentId} businessId={props.businessId} versionId={props.versionId} canManage={props.canManage} canRun={props.canRun} editable={editable} publishable={publishable} state={props.state} publishedAt={props.publishedAt} active={props.active} />
    <section aria-labelledby="evaluation-heading"><Text id="evaluation-heading" fw={600}>Evaluation suite</Text><Text size="sm" c="dimmed">Runs the 15 published-agent scenarios through AgentRuntime. External tools and actions are suppressed. Fixture inputs and model context are not saved in evaluation results.</Text>{props.evaluation ? <><Text size="sm" mt="xs">{props.evaluation.status} · {props.evaluation.passedCases} passed · {props.evaluation.failedCases} failed · revision {props.evaluation.versionRevision ?? "legacy"} · {new Date(props.evaluation.evaluatedAt).toISOString()}</Text>{!evaluationCurrent && <Alert color="yellow" mt="xs">This result was run against a different configuration revision. Run the suite again before publishing.</Alert>}<details><summary>Case results</summary><Stack gap={4} mt="xs">{props.evaluation.caseResults.map((row) => <Text key={row.caseId} size="sm" c={row.passed ? "green" : "red"}>{row.passed ? "Passed" : `Failed (${row.failedChecks.join(", ")})`}: {row.caseId}</Text>)}</Stack></details></> : <Text size="sm" c="dimmed" mt="xs">No evaluation has been run for this version.</Text>}</section>
  </Stack>;
}

function CardlessActions(props: { agentId: string; businessId: string; versionId: string; canManage: boolean; canRun: boolean; editable: boolean; publishable: boolean; state: string; publishedAt: string | null; active: boolean }) {
  const hidden = <><input type="hidden" name="agentId" value={props.agentId} /><input type="hidden" name="businessId" value={props.businessId} /><input type="hidden" name="versionId" value={props.versionId} /></>;
  return <Group>
    {props.canRun && (props.state === "DRAFT" || props.state === "TEST") && <><form action={selectAgentForTestAction}>{hidden}<Button type="submit" variant="default">Select for test</Button></form><form action={runAgentEvaluationAction}>{hidden}<Button type="submit" variant="light">Run evaluation</Button></form></>}
    {props.canManage && props.publishable && !props.active && <form action={publishAgentVersionAction}>{hidden}<Button type="submit">Publish version</Button></form>}
    {props.canManage && props.publishedAt && !props.active && <form action={rollbackAgentVersionAction}>{hidden}<Button type="submit" variant="default">Roll back to this version</Button></form>}
    {props.canManage && props.editable && !props.active && <form action={archiveAgentVersionAction}>{hidden}<Button type="submit" color="red" variant="subtle">Archive draft</Button></form>}
  </Group>;
}
