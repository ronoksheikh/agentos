# Phase 7 agent evaluations

`packages/agents/src/evaluation.ts` defines the versioned `phase7-v1` deterministic suite and its runner contract. Fifteen fixtures cover product price and availability, a three-message burst, image and voice input, returns, complaints, ambiguity, unknown information, approved browser lookup, handoff, tool/provider failure, model timeout, and comment reply/review outcomes. An execution adapter receives the immutable candidate version plus one fixture and returns only a safe status, allow-listed action/outcome types, and an optional safe failure code.

The runner checks required and forbidden outcomes, action-count limits, expected run status, and regressions against the preceding run for the same immutable version. Persisted results contain the version/business IDs, suite version, timestamps, case IDs, safe action types/statuses, failed check codes, and regression case IDs. Fixture text, prompts, model context, replies, tool arguments, and hidden reasoning are never stored. The latest result must pass the current suite before `AgentVersionService.publish` selects that version.

`AgentRuntimeEvaluationAdapter` sends each fixture through the normal event validation, trusted-context, context-building, model-provider, action validation, trace, and run-status paths. It runs with the `evaluation` system principal and `draftOnly`, which hides tools and suppresses external action execution. The adapter accepts a runtime factory so callers can provide the production runtime composition; tests use deterministic fake provider responses and assert fixture input reaches runtime context and no actions escape. It does not claim to test model quality or real provider behavior. The Postgres persistence drill still uses fixed expected outcomes to isolate repository and publish-gate behavior.

`agent_evaluation_runs` is additive migration `0017_gigantic_wonder_man.sql`. The Postgres result repository verifies the business/agent/version relationship before inserting a result, and reads the latest result within business and version scope. The runner is adapter-based so a controlled fake can exercise deterministic regression checks without sending customer actions.

Validation:

- `bun test tests/phase7-evaluations.test.ts tests/agents-auth.test.ts` checks fixture coverage, safe persistence shape, forbidden actions, regression diffs, and publish blocking.
- `bun test tests/phase7-evaluations.test.ts` also drives all 15 fixtures through `AgentRuntime` with a deterministic fake provider, confirms the input reaches current-event context, and checks external action execution stays suppressed.
- `DATABASE_URL=<disposable PostgreSQL URL> bun run db:migrate` applies the additive migration.
- `DATABASE_URL=<disposable PostgreSQL URL> bun run db:phase7-evaluations` checks the persisted result repository, safe result round-trip, regression handling, blocked publish, successful publish, and cleanup.

The deterministic Postgres integration currently supplies fixed expected outcomes. A production model-backed release comparison still requires the configured endpoint and representative approved test data; external-provider behavior is not implied by the fixture suite or runtime adapter test.
