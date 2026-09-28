# Phase 7 agent evaluations

`packages/agents/src/evaluation.ts` defines the versioned `phase7-v1` deterministic suite and its runner contract. Fifteen fixtures cover product price and availability, a three-message burst, image and voice input, returns, complaints, ambiguity, unknown information, approved browser lookup, handoff, tool/provider failure, model timeout, and comment reply/review outcomes. An execution adapter receives the immutable candidate version plus one fixture and returns only a safe status, allow-listed action/outcome types, and an optional safe failure code.

The runner checks required and forbidden outcomes, action-count limits, expected run status, and regressions against the preceding run for the same immutable version. Persisted results contain the version/business IDs, suite version, timestamps, case IDs, safe action types/statuses, failed check codes, and regression case IDs. Fixture text, prompts, model context, replies, tool arguments, and hidden reasoning are never stored. The latest result must pass the current suite before `AgentVersionService.publish` selects that version.

`agent_evaluation_runs` is additive migration `0017_gigantic_wonder_man.sql`. The Postgres result repository verifies the business/agent/version relationship before inserting a result, and reads the latest result within business and version scope. The runner is adapter-based so a controlled fake can exercise deterministic regression checks without sending customer actions.

Validation:

- `bun test tests/phase7-evaluations.test.ts tests/agents-auth.test.ts` checks fixture coverage, safe persistence shape, forbidden actions, regression diffs, and publish blocking.
- `DATABASE_URL=<disposable PostgreSQL URL> bun run db:migrate` applies the additive migration.
- `DATABASE_URL=<disposable PostgreSQL URL> bun run db:phase7-evaluations` checks the persisted result repository, safe result round-trip, regression handling, blocked publish, successful publish, and cleanup.

The deterministic integration currently supplies an execution adapter with fixed expected outcomes. A production model-backed release comparison still requires the configured endpoint and representative approved test data; external-provider behavior is not implied by this fixture suite.
