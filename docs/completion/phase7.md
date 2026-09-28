# Phase 7 implementation and verification report

**Status: not complete; release blocked.** The Phase 7 implementation has substantial offline coverage, but this report does not declare the phase complete or authorize production rollout. Live provider, merchant-site, and Meta acceptance checks remain unavailable.

This report records repository state and evidence as of 2026-09-28. The upstream `browser-use/browser-use` repository was not modified; AgentOS pins and runs its open-source package in the isolated worker.

## Delivered modules and contracts

- **Browser Use:** Production composition replaces the Phase 6 raw CDP/Chromium worker with `browser-use==0.13.10`, its supported `browser-use install` browser provisioning, the existing TypeScript `BrowserAdapter`/coordinator/tools/jobs boundary, and a narrow authenticated egress/model gateway. Browser Use Cloud and Pi are not configured. Session isolation, per-session HTTPS egress, domain and action limits, deadlines, cancellation, safe progress, private ephemeral screenshots, restart recovery, and untrusted page content are documented in `docs/phase7-browser-use.md`.
- **Removed browser implementation:** Commit `ffd4360` deleted `apps/browser-worker/Dockerfile`, `apps/browser-worker/src/cdp.ts`, and `apps/browser-worker/src/index.ts`. The former `apps/browser-worker/src/egress.ts` became the generic `apps/browser-egress/src/index.ts`; the Python worker is `apps/browser-use-worker/worker.py` with its own Dockerfile. The old `browser-worker:start` script and `BROWSER_CHROME_PATH` configuration were removed. Generic contracts and deterministic test fakes remain.
- **Providers:** The official OpenAI TypeScript SDK is behind existing model and vision interfaces. The worker configures `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, optional `OPENAI_FALLBACK_MODEL`, `OPENAI_VISION_MODEL`, and `OPENAI_TIMEOUT_MS`; it probes required endpoint capabilities and uses the approved primary or configured vision fallback. Published agent instructions remain authoritative. Optional `OPENAI_CLASSIFIER_MODEL` selects a structured comment labeler and is probed at startup for JSON category output; model labels are review-only and fall back to deterministic rules on provider or parsing errors. ElevenLabs transcription is configured through `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL`, `ELEVENLABS_ENDPOINT`, and `ELEVENLABS_TIMEOUT_MS`. Safe placeholders are in `.env.example`; no real credentials were committed. Mock endpoint/provider tests passed; live endpoint compatibility and transcription remain unverified without approved credentials and samples.
- **Real Website Chat:** Production composition registers `WebChatAdapter` with durable visitor sessions and the shared universal event/action worker path. Public routes are `POST /api/web-chat/v1/bootstrap`, `GET|DELETE /api/web-chat/v1/session`, and `GET|POST /api/web-chat/v1/messages`. Exact origins, signed visitor sessions, tenant/site/agent binding, expiry and revocation, rate limits, ordered/deduplicated inbound messages, idempotent outbound delivery, and text-only attachment rejection are enforced. An assigned staff member can take over a handoff and send idempotent text replies through the active visitor poll session. The fake adapter remains test-only.
- **Facebook comments:** Signed Page feed additions enter the shared event router and typed `CommentProcessor`. The processor loads scoped post data, verified same-post parent text, and manager-mapped one-item catalog text pinned to the approved catalog version; it classifies into bounded typed outcomes, applies conservative policy, and routes allowed AI replies through the same runtime in `draftOnly` mode and a server-bound `ReplyToComment` action. Verified reply/hide capabilities, author checks, handoff ownership, idempotency, review, audit, client-safe realtime, business-scoped analytics, and authorized manager manual reply/hide controls are implemented. Manual writes require explicit `channel.manage`, verified Page capability flags and token scope, and are recorded with actor attribution. Default automation and deletion are off. Meta capability details and external blockers are in `docs/phase7-comments.md`.
- **Operations and client features:** The one-calendar-month trial lifecycle has audited agency controls, notifications, and no automatic data deletion. Client analytics include scoped operational counts and a documented 30-day delivery-qualified first-response/handoff cohort. In-dashboard notifications now have per-user/business isolation and producers for handoffs, stale handoffs, terminal run failures, dead queue work, Messenger reauthorization, comment review, and trial lifecycle events. Feature flags gate browser, comment AI, and advanced memory at runtime. A 15-case evaluation suite gates publication; fixtures also pass through `AgentRuntime` with external actions suppressed. Worker readiness/heartbeats and provider-circuit health are exposed. Retention, offboarding, and PostgreSQL/private-media backup/restore procedures have disposable-database drills.

## Additive database migrations

Applied migrations were not edited. Phase 7 adds:

- `0010_great_mephisto.sql` — durable Website Chat visitor conversation binding and shared rate-limit buckets.
- `0011_nervous_william_stryker.sql` — Page posts/comments, typed decisions, and comment policy persistence.
- `0012_tidy_stature.sql` and `0013_legacy_trial_backfill.sql` — trial expiry behavior and preservation of undated legacy trials as active service.
- `0014_salty_loki.sql` — audited comment review dispositions.
- `0015_glossy_microbe.sql` — service heartbeats.
- `0016_luxuriant_dragon_man.sql` — global feature-flag uniqueness.
- `0017_gigantic_wonder_man.sql` — safe persisted evaluation results.
- `0018_nostalgic_nicolaos.sql` and `0019_luxuriant_namor.sql` — opt-in business content retention and customer-context age policy.

Notification producers use the existing notification table; stale deadlines use the existing handoff columns, so the latest notification work required no migration.

## Validation evidence

Latest repository checks after the notification and parent-context changes:

- `bun run check` — passed, 90 tests and 502 assertions after adding classifier startup-probe coverage.
- `bun run admin:build` — passed.
- `bun run client:build` — passed. Next.js still warns that it inferred `/Users/ronoksheik/pnpm-lock.yaml` as the workspace root and reports the existing optional `@valkey/valkey-glide` resolution warning from BullMQ; compilation and type checks completed.
- Fresh disposable PostgreSQL 16 migrations plus `scripts/phase7-client-analytics-integration.ts` — passed scoped analytics, delivery-qualified response timing, user/tenant inbox isolation, handoff/stale/dead-queue notification deduplication, acknowledgement authorization, and handoff idempotency.
- Fresh disposable PostgreSQL 16 migrations plus `scripts/phase7-comments-integration.ts` — passed signed feed, dedupe, scoped Graph context, verified parent text and version-pinned product context reaching classifier/reply drafting, cross-tenant and stale/multi-item mapping rejection, safe keep/handoff, runtime reply, manual reply/hide with actor attribution and replay idempotency, uncertain outcome handling, author/human ownership guards, audit/realtime, and reauthorization-notification deduplication.
- `scripts/phase7-browser-restart.ts` and `scripts/phase6-browser-integration.ts` passed their documented controlled-site drills: navigation, form input, extraction, screenshot privacy, policy denial, cancellation, timeout, safe progress, cross-tenant isolation, stale-session rejection after worker restart, and session recovery. These test deterministic Browser/Actor operations and do not prove live model-backed research.
- `scripts/phase7-webchat-integration.ts` and its built Next.js HTTP drill passed controlled local origin bootstrap/send/dedupe/poll/revocation, tenant and origin controls, fake-model adapter execution, handoff suppression, and human reply visibility.
- Disposable PostgreSQL drills for trial, comments, feature flags, evaluations, retention, backup/restore, offboarding, provider configuration, and health are described in their `docs/phase7-*.md` records.

The full `bun run db:phase5-smoke` passed on a fresh disposable PostgreSQL 16 database and an isolated Redis 8.10.2 instance. It covered signed-inbound batching, notification failure/retry, lease replacement, 40-conversation fairness across two businesses, recovery, replay authorization, and one-shot goals. A prior run against a different local service setup timed out in the fairness section; the isolated rerun completed successfully.

## Security and operational decisions

- Secrets stay in server environment/vault paths. The Browser Use container does not receive database, Redis, Meta, ElevenLabs, or general vault credentials. Its optional research model uses a narrow gateway with public-DNS pinning and a single approved Chat Completions model.
- Browser uploads/downloads are disabled. Screenshot bytes remain private and ephemeral; only opaque IDs can be returned. No stealth, CAPTCHA, proxy anonymity, or cloud-service guarantee is claimed.
- Comment and Website Chat content remains untrusted. Comment deletion stays unavailable; ambiguous external writes are not blindly retried. Uncertain comments default to keep/review.
- Client reads and notifications filter by authenticated business and, for inbox rows, authenticated user. Notification payloads are not projected to the client. Acknowledgement rechecks membership and capability.
- Retention is opt-in and bounded. Existing external identity keys, orders/order notes, active goals, audit history, and backup copies are not automatically scrubbed by the new age policy. Legal erasure is not claimed until external providers and backup copies are covered separately.
- Backup manifests detect accidental corruption, not malicious replacement. The local file-backed media copy is not an atomic shared PostgreSQL/object-store snapshot; the runbook requires draining writers for strict restore points.

## Open release gates and limitations

1. **Live OpenAI-compatible endpoint and ElevenLabs:** Supply approved development/staging/production credentials and endpoint/model choices, verify Responses, tool calls, structured output, images, and transcription against those exact services, then record observed results. Mock compatibility is not live acceptance.
2. **Live Meta Page:** Supply an approved Meta app and authorized Page/token with the required scopes, subscribe the Page feed, receive a signed controlled comment, run read/reply/hide tests, observe the Page result, and verify Page-authored replies do not loop. This was not available, so no live Meta write is claimed.
3. **Website Chat acceptance:** Embed the production SDK on an authorized merchant staging site, verify origin/CORS and visitor experience, and observe a human reply through its polling client. Local HTTP tests are not merchant-site acceptance.
4. **Browser model-backed research:** Supply an approved compatible endpoint/key and verify bounded `browser_research` output on a controlled site. The AgentOS Responses probe does not establish Browser Use Chat Completions compatibility.
5. **Comment workflow gaps:** The optional model classifier is review-only and has no production quality comparison. Deletion remains intentionally unavailable.
6. **Analytics limits:** Validated conversation question categories, customer objections, attributed conversion/revenue, and cost estimates are unavailable in the persisted source data. Do not infer them from comment categories or unrelated orders.
7. **Reserved flags:** `experimental_tools` and `runtime_variant` have disabled defaults but no production consumers. They remain hidden from the agency form.
8. **Retention scope:** Order/order-note, active-goal, business-announcement, audit-age, and backup-copy retention remain separate policy work. External identity keys remain for routing/dedupe.

Other explicit contracts, definitions, and operating procedures are in `docs/phase7-browser-use.md`, `docs/phase7-webchat.md`, `docs/phase7-comments.md`, `docs/phase7-metrics.md`, `docs/phase7-notifications.md`, `docs/phase7-trial.md`, `docs/phase7-flags.md`, `docs/phase7-evaluations.md`, `docs/phase7-health.md`, `docs/phase7-retention.md`, `docs/phase7-backup.md`, and `docs/phase7-offboarding.md`.

## Phase 7 commits

The Phase 7 implementation commits from Browser Use cutover through the notification/context work are recorded in `git log`; the range includes `ffd4360` (Browser Use cutover), `340f438` (production Website Chat), `f5cdab9` (comment processing), provider and operations milestones through `08b523d`, notification/context slices through `96c2a2d`, manual comment actions `f2ac7f0`, and upstream Browser Use guidance `fd25d58`. No push, PR, or deployment was performed.
