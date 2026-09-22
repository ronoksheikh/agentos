# Phase 7 implementation ledger

This is a working audit, not a completion claim. `ARCHITECTURE.md`, `plan.md`, plans 1–7, and completion notes 1–6 were read before editing. The starting tree was clean on `main`. Baseline `bun run check` passed: 67 tests, 376 assertions.

| Gap | Severity | Owner | Evidence and required closure | State |
| --- | --- | --- | --- | --- |
| Production browser uses Phase 6 custom CDP/Chromium | Release blocker | Phase 7 browser | `apps/browser-worker/src/cdp.ts`, `packages/web/src/remote.ts`, `docker-compose.browser.yml`; full Phase 6 browser drill was skipped. Replace with self-hosted `browser-use/browser-use`, prove isolation/operations, then remove old production path. | Open |
| OpenAI provider used raw fetch and hardcoded endpoint | High | Phase 7 providers | Official SDK transport, configurable endpoint/model/timeout, native function calls, startup capability probe, and primary/optional fallback vision are implemented and mocked in tests. An approved credential is still needed for the live probe. | Offline path complete; live blocked |
| ElevenLabs was optional but model/endpoint/timeout were hardcoded | Medium | Phase 7 providers | Server environment configuration and secret-safe transport tests are implemented. Live transcription awaits an approved key and sample. | Offline path complete; live blocked |
| Web Chat is a fake contract only | Release blocker | Phase 7 Web Chat | `FakeWebChatAdapter` in `packages/website-sdk`; no production visitor message route or delivery transport, and only Messenger is registered by worker composition. | Open |
| Comments are persisted but ignored | Release blocker | Phase 7 comments | `packages/phase5/src/processor.ts` marks `comment.created` `IGNORED/POLICY_DEFERRED`; current event payload contains only a comment ID. Meta comment capabilities could not be confirmed from accessible official developer pages (429), so no destructive capability may be enabled without later verification. | Open |
| Analytics, trial, evaluation, retention, backup, and operational health incomplete | High | Phase 7 operations | Phase 7 plan scope is not present as working production paths; earlier dashboards contain placeholders and some service façades lack mounted general HTTP routes. | Open |
| Live Meta Page verification | External release blocker | Deployment owner | Phase 6 note explicitly says no authorized Page/credentials/test message and reply were observed. Requires authorized Meta app and Page plus controlled end-to-end drill. | Open |

## Milestones

1. Baseline and audit — source reading, code inventory, clean-tree check, baseline tests completed. Continue recording findings as implementation reveals them.
2. Provider configuration — official OpenAI SDK, endpoint capability validation, primary/fallback vision, ElevenLabs configuration, mocked contract tests, live endpoint drill when credentials are provided.
3. Browser Use cutover — official open-source Python worker, TypeScript bridge, controlled-site validation and removal of CDP production code.
4. Real Web Chat — durable visitor sessions, production adapter and transport, end-to-end and tenant-security tests.
5. Facebook comments — verified Meta contract, normalization, policy/classification, safe actions, persistence, analytics and fake Meta drill.
6. Product/operations — role-scoped analytics, trial lifecycle, flags/notifications, evaluation, retention/offboarding, backup/restore and health.
7. Final validation — database smoke, `bun run check`, both builds, browser integration, release blockers, `docs/completion/phase7.md`, scoped commits and clean tree.

## Validation so far

- Provider slice: `bun run check` passed with 72 tests and 393 assertions. `bun run admin:build` and `bun run client:build` passed. The endpoint probe and ElevenLabs transport were exercised with controlled mock endpoints; no live provider credentials were available.

## Source checks

- Browser Use official repository: <https://github.com/browser-use/browser-use> and its Dockerfile: <https://github.com/browser-use/browser-use/blob/main/Dockerfile>. The open-source Python `Agent`/`Browser` path is separate from the hosted service.
- Official OpenAI SDK configuration and Responses docs: <https://github.com/openai/openai-node/blob/main/docs/configuration.md> and <https://github.com/openai/openai-node/blob/main/docs/responses.md>.
- ElevenLabs transcription API: <https://elevenlabs.io/docs/api-reference/speech-to-text/convert>.
- Meta developer comment reference was attempted at <https://developers.facebook.com/docs/graph-api/reference/comment/> but returned HTTP 429. Do not infer current destructive permissions from third-party pages.
