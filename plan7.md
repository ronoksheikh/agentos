# Phase 7 — Browser Use, Web Chat, Comments, Providers, and Production Readiness

## Before implementing this phase

1. Read `ARCHITECTURE.md`, `plan.md`, and all `plan1.md`–`plan6.md` files completely.
2. Read every available completion note through `docs/completion/phase6.md`; treat actual shipped contracts as the starting point.
3. Verify current Meta comment/moderation capabilities and requirements from authoritative documentation before implementation.
4. Read `docs/completion/phase6.md` as delivered evidence, not proof of live Meta or browser production readiness: those validations were explicitly incomplete. Inventory the Phase 6 CDP worker/bridge and its consumers before planning deletion.
5. Verify the current open-source [`browser-use/browser-use`](https://github.com/browser-use/browser-use) self-hosted Docker/Python integration, supported local-browser provisioning, model configuration, lifecycle, and security behavior from its official sources. Do not substitute Browser Use Pi, the hosted Cloud API, or a custom CDP/Playwright driver.
6. Reuse the universal event router, specialized processor boundary, runtime, action executor, channel adapter, policy/permission, tenancy, credentials, realtime, audit, and evaluation foundations. Do not build a second comment chatbot or put policy decisions directly in a Meta webhook.

## Goal

Complete the first operational agency release: policy-driven Facebook Comment Processing Unit, safe AgentOS comment replies, a real website chat channel, self-hosted Browser Use browser execution, configurable OpenAI-compatible model and ElevenLabs providers, meaningful client/agency analytics, transparent one-month free trial lifecycle, and practical security/reliability/retention/backup/observability/evaluation hardening. This phase requires high-reasoning, end-to-end implementation and validation; it is not a superficial feature checklist. Do not invoke the ponytail skill for this phase.

## Inherited From Previous Phases

- Phase 1–4 runtime, agent versions, tool classes, context/memory/knowledge/browser/attachment provider abstractions, safe trace/realtime and tenant/security guarantees.
- Phase 5 universal events, `EventRouter`, jobs/retries/DLQ/replay, conversation locks/buffers, action idempotency, scheduled work, cancellation, operational metrics.
- Phase 6 implemented `FacebookMessengerAdapter` inbound normalization, page capabilities/credential model, Messenger data mappings, handoff reference behavior, and dashboards. Its live Meta Page check and full browser integration drill were **not** completed; treat these as release gates, not verified capabilities.
- Phase 3/5 test-only `FakeWebChatAdapter` and website SDK/session contracts; Phase 4 browser and media/provider boundaries; Phase 6 OpenAI Responses/vision composition and isolated custom CDP/Chromium worker. Preserve their public contracts while replacing only the production implementations called out below.

Comments arrive as `comment.created` universal events and must remain normalized/persisted/deduplicated before processing. The Comment Processor may invoke the same runtime only for an approved natural-language reply. Meta/platform limitations override any planned moderation action.

## New Contracts Introduced In This Phase

- `CommentProcessor`, `CommentClassifier`, `CommentPolicyEngine`, post/comment-context loader, moderation/reply action executor, and redacted decision/audit record.
- Versioned `CommentClassification` result and explicit policy outcomes `KEEP`, `HIDE`, `REPLY`, `HANDOFF`, and `DELETE` only when a business policy and verified channel capability explicitly allow it.
- Comment/post analytics event and metric definitions with source/attribution caveats.
- Business trial/lifecycle policy (`TRIAL`, `ACTIVE`, `PAUSED`, `EXPIRED`, `CANCELLED`), `trialStartedAt`, `trialEndsAt`, agency override, and post-expiry service behavior configuration.
- Published-agent evaluation suite/run/result contract and production operations/retention/backup/restore verification conventions.
- Production `WebChatAdapter` implementing the shared `ChannelAdapter` contract; the fake adapter remains test-only and unregistered in production.
- Browser Use execution bridge and result mapping behind existing `BrowserAdapter`/`BrowserExecutionService`, with a documented cutover/removal path for Phase 6's custom CDP production worker.
- Environment/secret-backed OpenAI SDK provider configuration (base URL, API key, model IDs and capabilities) and ElevenLabs transcription configuration, without changing the generic runtime/provider interfaces.

## Scope

### Phase 6 reconciliation and production cutover

Before new features, compare the shipped repository against `ARCHITECTURE.md`, every phase plan, and completion notes 1–6. Record gaps with severity, owners, evidence, and whether Phase 7 must close them or explicitly defer them. Do not mark a feature complete just because a completion note names it. Preserve applied migrations and stable public contracts. For every replacement, identify all references, jobs, env/config values, Docker artifacts, tests, and rollout/rollback consequences before removing code. Keep a single production registration for each channel or browser provider; production must never fall back silently to a fake.

### Self-hosted Browser Use AI browser agent

Use the **open-source AI browser agent in [`browser-use/browser-use`](https://github.com/browser-use/browser-use)** as the production browser executor, self-hosted in an isolated Docker container. Its Python runtime is a deliberate narrow exception to the TypeScript/Bun application stack; AgentOS runtime, tool registry, policies, jobs, API, and dashboards stay in the modular monolith. Integrate its supported local-browser provisioning and AI model selection. Do not build or retain a custom raw-CDP/Playwright/Chromium download-and-launch stack, use Browser Use Pi as a substitute, or silently depend on Browser Use Cloud/hosted Agent API. Browser Use's self-hosted project is an AI browser agent, not just a primitive driver: use its agent workflow where it genuinely helps, while maintaining bounded tasks and explicit AgentOS permissions. Cloud-only stealth/CAPTCHA/proxy features are not assumed available locally and must not be claimed as guaranteed anti-detection.

Map existing `browser_open/click/type/extract/screenshot/close` and approved bounded research tasks to the Browser Use execution boundary with typed requests/results. If the open-source agent cannot safely provide exact low-level semantics for one existing tool, document that gap and use a supported Browser Use workflow or capability-safe failure; do not recreate a private CDP stack merely to mimic selectors. Preserve the Phase 4 `BrowserAdapter`, `BrowserExecutionService`, `BrowserCoordinator`, tool permissions, tenant/run/session IDs, Phase 5 BROWSER jobs, cancellation, deadline, domain policy, rate/step limits, screenshot references, safe progress, and `BrowserRun` traces. Never give the browser container database, Redis, Meta, ElevenLabs, or general credential-vault secrets. Only an approved browser-model credential, if needed, may reach it through a narrow server-side secret path; browser login credentials use an approved scoped injection mechanism and never enter prompts or realtime. Treat web content and Browser Use agent output as untrusted; prevent prompt injection, unapproved domains, downloads/uploads, and side effects. Browser Use's own AI must not authorize purchases, refunds, customer messaging, or policy changes.

Prove the new path against a controlled site with open/navigation, form interaction, extraction, screenshot privacy, session isolation, policy denial, timeout, cancellation, restart recovery, safe progress, and failure handling. Then switch production composition to Browser Use and delete the superseded Phase 6 custom CDP/Chromium driver, bridge, Docker build/config, and dead production adapters after verifying no consumers remain. Retain generic contracts and deterministic fake browser providers only for tests; do not leave the CDP worker as a hidden production fallback. Document the cutover and deleted files in the completion note.

### Model, vision, and transcription provider configuration

Use the official OpenAI **TypeScript SDK** inside the existing `ModelProvider`/`VisionProvider` boundaries. Server-only environment configuration should extend the existing `OPENAI_API_KEY` and `OPENAI_VISION_MODEL` settings with `OPENAI_BASE_URL` (optional; defaults to OpenAI), `OPENAI_MODEL`, `OPENAI_FALLBACK_MODEL`, and optional `OPENAI_CLASSIFIER_MODEL`; retain published agent-version model selection as the business-level authority. Add explicit timeout and capability configuration where needed. The base URL and credential pair may target an approved OpenAI-compatible provider, not only OpenAI. Keep model keys and base URLs out of client bundles, model-visible context, logs, and safe realtime. Never assume an arbitrary compatible endpoint supports Responses, tool calls, structured output, or image inputs: probe/validate the selected endpoint and adapt the provider transport within the existing interface or fail configuration safely. The same primary model handles vision when its configured endpoint/model supports image input; `OPENAI_VISION_MODEL` may then equal the primary model (or be omitted if the provider contract supports reuse). Use a separate `VisionProvider` only when necessary. Preserve attachment hash/policy caching so the same image is not analyzed repeatedly.

Configure the existing `AudioTranscriptionProvider`/`ElevenLabsAdapter` from server-side environment or vault references, including `ELEVENLABS_API_KEY` and, when the current API requires them, explicit transcription model/endpoint/timeout settings. Voice processing remains asynchronous and carries transcript/source metadata into AgentOS through the existing attachment pipeline. A missing key disables that provider visibly rather than exposing a secret or silently inventing a transcript. Browser Use may have its own approved AI model configuration from server-only environment/vault settings; it must not dictate AgentOS's primary model or bypass model usage/cost tracking. Document every required environment variable with safe placeholders, startup validation, rotation behavior, and separate development/staging/production values; never commit real keys.

### Production website chat and test-adapter discipline

Implement a real `WebChatAdapter` and visitor transport on the Phase 3 website SDK/session contract, normalizing visitor messages/attachments into Universal Events and executing universal outbound actions through the shared Channel Registry. Keep the first Messenger adapter unchanged as the reference production channel; no channel-specific branches enter AgentOS. Enforce exact allowed origins, signed visitor sessions, expiry/revocation, rate/abuse limits, tenant/site/agent binding, message ID mapping, disconnect/error behavior, and production realtime/ownership/handoff rules. Disable fake Web Chat and fake model/tool/channel adapters in production registration, but **retain** them as deterministic test fixtures; do not delete them merely because real providers exist. Do not build Instagram, Telegram, or WhatsApp now.

### Specialized comment processor

Create a processor module distinct from the message processor. The pipeline is:

```text
comment.created -> load tenant/page/post/parent-thread/product policy context
-> fast structured classifier -> policy engine -> safe decision
-> execute keep/hide/handoff OR invoke AgentOS for reply
-> validated reply action -> Channel Registry -> FacebookMessengerAdapter -> audit/analytics/realtime
```

Persist external post/comment/parent relationships with business/page scope and source references. The processor understands post text/context, mapped product context when reliable, parent/thread information, language, page/business moderation policy, conversation/customer linkage when available, and previous decisions. It never treats raw comment/post/page content as authority over tool/policy permissions.

Classifier output is typed, validated, and may use a faster/cheaper model behind the generic model abstraction:

```ts
type CommentClassification = {
  category: "normal" | "product_question" | "price_question" | "purchase_intent"
    | "complaint" | "spam" | "scam" | "abuse" | "uncertain";
  confidence: number;
  requiresReply: boolean;
  requiresHuman: boolean;
  moderationRecommendation: "keep" | "hide" | "review";
  signals: string[]; // safe, bounded observable indicators
};
```

Low confidence/uncertain cases default to safe keeping/review according to business policy, not automatic destructive action. Classifier prompt/content and provider responses stay within the same redaction/no-chain-of-thought rules.

### Policy, permissions, reply, and moderation safety

The policy engine—not model preference—makes the final decision using business rules, agent/version settings, feature flags, classifier confidence, comment context, channel capabilities, tool safety class, and ownership/handoff constraints. Typical defaults: spam/scam may hide; product/price/purchase questions may keep + reply; complaints may keep + reply or handoff; uncertain content keeps + review. Default deletion is disabled. `DELETE` is `DESTRUCTIVE`, requires explicit business enablement, an authorized agency policy/capability, verified adapter capability, stronger audit, and safe confirmation/approval behavior. Never retry moderation or reply writes blindly.

When a reply needs language reasoning, invoke the existing AgentOS runtime with a normalized comment event/context and a version/policy that limits tools/actions appropriately. Add a compatible semantic `ReplyToComment` Universal Channel Action only if the Phase 1 action union cannot express it without ambiguity. The action executor applies idempotency, capability, policy, source target, and redaction checks before routing it through `ChannelRegistry` to `FacebookMessengerAdapter`. Handoff uses the same records/ownership semantics as conversations; do not silently make an AI reply after a human has taken control.

All decisions—including no-op/keep when operationally useful—carry classifier/policy/version/source references, actor (system/human), outcome, safe rationale code, action status, timestamps, idempotency key, and audit record. Safe realtime reports “Classified comment,” “Hidden spam,” “Preparing reply,” or “Needs human review,” never hidden reasoning or sensitive raw data beyond the viewer’s permitted comment content.

### Dashboards and analytics

Extend the client Mantine dashboard with Overview, Performance, Conversations, Needs Attention, Human Handoffs, Customers, Orders where integrated, Agent Activity, Comment Analytics, Knowledge, Team, and Settings. Extend agency admin with cross-business onboarding, pages/channels, agents/versions/playground, tools/integrations, traces/tool/browser runs, webhooks/events/failures/queues, usage/costs, system health, users, audit, and feature flags. Keep feature scope incremental and role-filtered; prefer Mantine primitives and shared visual rules.

Define metric names, grain, source, timezone, filters, freshness, and caveats before building charts. Client metrics include conversations, AI-handled rate, handoff rate, first-response latency, customers helped, top question categories, customer objections, comment processed/categories/moderation/replies/reviews, agent activity, and needs-attention count. Where attributable journey events exist, provide a conversion funnel such as conversation or comment intent → handoff/order initiation → completed order; never infer funnel conversion from unrelated events. Orders/revenue attribution appear only where an explicit reliable link exists; label unavailable/estimated attribution honestly. Business insights are evidence-backed summaries of validated trends, such as recurring objections, unanswered questions, delivery friction, or product demand; they must link to metric/source scope and never present model speculation as fact. Agency views add classifier confidence/review overrides, channel failures, queue/provider health, usage/cost by business/agent/run/model/tool/browser, and trial status.

Use business-scoped aggregation/query paths and authorization; no analytics endpoint may leak another tenant. Keep operational chart UI understandable, responsive, dark/light capable, and not developer-heavy for clients.

### Trial lifecycle, feature flags, and notifications

Implement the agency offer as one month unlimited free, no setup cost, no commitment. On approved activation set `trialStartedAt`/`trialEndsAt`, lifecycle status, configurable service behavior on expiry, and agency override. Do not destroy business data at expiry and do not secretly throttle normal trial use while promising unlimited. Track internal usage/costs and provide transparent extreme-abuse/error emergency controls with audit/notification; this is not a payment/billing engine.

Use business-scoped/global feature flags for browser, comment AI, advanced memory, model/runtime variants, experimental tools, and staged rollout. Flag changes are authorized/audited and checked server-side. General notifications initially arrive in-dashboard for handoffs, run failures, disconnects/reauthorization, critical integration/queue issues, trial events, and actionable alerts; architecture remains ready for email/other delivery adapters.

### Production hardening and operations

Complete a proportionate production checklist:

- Security: authorization/tenant isolation audit, secure session/CSRF/cookie posture, input/rate/abuse controls, webhook verification, secret encryption/redaction/access reviews, tool/browser policy checks, dependency/process review, and audit-log integrity/access controls.
- Reliability: provider timeout/retry/fallback/circuit-breaker policies; no blind destructive retries; DLQ/replay procedures; graceful shutdown/draining; API/worker/browser health/readiness; connection and queue monitoring.
- Data: documented per-business retention/deletion for raw events, messages, traces, files, attachments/transcripts, browser screenshots, logs; offboarding workflow; PostgreSQL and needed object-storage backup schedules; tested restore procedure; migration rollout/rollback safety.
- Observability: trace IDs across adapter-inbound/event/job/run/tool/browser/action/channel; redacted structured logs; API/worker/browser status, queue depth/lag/failed jobs, provider/channel state, realtime connections, average latency/error rate, model/tool/browser usage/cost.

### Evaluation and regression

Create deterministic fixtures/fake providers and a published-agent evaluation runner. Evaluation cases include price question, unavailable product, rapid three-message burst, image, voice note/transcript, return/refund, angry customer, ambiguous product, unknown information, browser lookup, handoff, tool/provider failure, model timeout, and comment moderation/reply/escalation. Each case has scoped expected actions/policies/safety assertions, not a demand for hidden reasoning. Run relevant regression suites before publishing material agent-version changes and retain safe result metadata/diffs.

## Tests and validation

- Comment normalization/dedupe/processor fixtures, post/parent/product context, tenant/page isolation, classifier schema and low-confidence safe defaults.
- Policy matrix: feature flag/role/capability/ownership combinations; no deletion by default; destructive confirmation; idempotent hide/reply/handoff; retry/replay behavior.
- End-to-end fake Meta flow: comment → classifier/policy → runtime reply only where allowed → adapter; human handoff suppresses auto reply; safe realtime/audit/analytics events.
- Analytics: metric formulas/grain/timezone/filter correctness, tenant isolation, source attribution caveats, conversion-funnel event-link requirements, evidence-backed objection/insight summaries, and no invented revenue claims.
- Trial: start/override/expire/pause behavior, client visibility, no automatic deletion, alerts/audit.
- Browser cutover: the self-hosted Browser Use AI agent executes controlled tasks through existing job/tool contracts; tenant/policy/credential boundaries, cancellation/restart/screenshot privacy, and safe traces hold. No custom CDP production worker, hosted Browser Use dependency, or production fake fallback remains.
- Provider configuration: the official OpenAI SDK works with an approved configured base URL/model/API key; unsupported Responses/tools/vision capabilities fail safely or use an explicitly tested compatible path; primary-model vision and separate fallback both work; ElevenLabs configuration transcribes through the existing provider boundary and redacts credentials.
- Production Web Chat: signed visitor sessions and origin controls, real inbound-to-outbound adapter path, tenant isolation, dedupe/order/idempotency, attachments/handoffs, and fake-adapter exclusion from production composition.
- Phase 6 release gates: complete the previously skipped full browser integration drill against the replacement path and live Meta Page/webhook/test-message/reply verification with authorized credentials before claiming those paths production-ready.
- Security/operations: RBAC and WS tests, redaction/secrets, rate limits, backups/restore drill, migration procedure, health checks, DLQ/replay, provider outage/circuit behavior, retention/offboarding tests.
- Evaluation: fixture coverage and regression gating for published versions; all prior phase regression suites remain green.

## Do Not Build Yet

Do not turn the product into a public self-serve SaaS, build a bespoke full human inbox, assume billing/payments, add unverified destructive Meta operations, split the monolith into microservices, or rewrite shared runtime/event/channel contracts. Do not build another custom CDP/Playwright browser engine or assume self-hosted Browser Use includes hosted stealth services. Instagram, Telegram, WhatsApp, email, TTS, and richer commerce integrations remain future compatible extensions.

## Deferred To Later Phases

Future work adds one `ChannelAdapter` implementation per remaining channel, each with private inbound parsing/normalization helpers and a registry entry; deeper ecommerce/attribution, email notifications, TTS/voice response, advanced A/B rollout, richer BI, and additional provider implementations remain separate extensions. Browser Use Cloud or another hosted browser service requires a later explicit decision; it is not a hidden fallback for the self-hosted open-source deployment. Each must read this plan, `ARCHITECTURE.md`, and all completion notes, then extend—not replace—the contracts.

## Definition of Done

1. Facebook comments flow through the generic event router to a specialized, typed, tenant-safe Comment Processor.
2. Classification and policy safely choose keep/hide/reply/handoff; destructive delete remains explicitly gated, capability-verified, audited, and non-default.
3. Agent comment replies use the one AgentOS runtime and semantic action/adapter path with ownership, idempotency, and redaction protection.
4. Client and agency dashboards provide role-scoped, Mantine-consistent operational/analytic views with trustworthy metric definitions.
5. Trial status supports the stated one-month unlimited/no-commitment offer with agency controls, audit, notifications, and no automatic data loss.
6. The production browser path uses the self-hosted `browser-use/browser-use` AI browser agent, not the custom Phase 6 CDP implementation; isolation/policy/cancellation/privacy/controlled-site tests pass and superseded production browser code is removed without breaking generic contracts.
7. The official OpenAI SDK accepts approved environment-configured OpenAI-compatible endpoint credentials/models with validated feature support; primary-model vision or fallback vision and ElevenLabs transcription run through existing provider boundaries with safe secret handling.
8. A real Web Chat adapter uses the shared contract and secure Phase 3 visitor/session rules; fake adapters remain test-only and cannot be registered in production.
9. Security, tenancy, realtime, provider resilience, queue/replay, retention, backup/restore, health, audit, and evaluation validation passes. Live Meta Page and previously skipped browser end-to-end verification are completed before marking those integrations production-ready; otherwise record an explicit release blocker.
10. The result remains a buildable modular monolith ready for future channel adapters rather than a Facebook-specific product.

## Completion Note

After implementation, write `docs/completion/phase7.md` with comment policy/classifier/provider details, verified Meta capabilities and live-test evidence or blocker, real Web Chat registration, Browser Use open-source version/Docker/model configuration and controlled-site evidence, deleted CDP production files, official OpenAI SDK/compatible endpoint and vision/ElevenLabs configuration, metric definitions, trial operations, hardening/backup/retention evidence, evaluation suite, migrations/APIs, tests, limitations, and deviations. Record the cross-plan/completion audit and unresolved gaps.
