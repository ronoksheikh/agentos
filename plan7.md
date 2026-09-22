# Phase 7 — Comment Processing, Analytics, Trial Lifecycle, and Production Hardening

## Before implementing this phase

1. Read `ARCHITECTURE.md`, `plan.md`, and all `plan1.md`–`plan6.md` files completely.
2. Read every available completion note through `docs/completion/phase6.md`; treat actual shipped contracts as the starting point.
3. Verify current Meta comment/moderation capabilities and requirements from authoritative documentation before implementation.
4. Reuse the universal event router, specialized processor boundary, runtime, action executor, channel adapter, policy/permission, tenancy, credentials, realtime, audit, and evaluation foundations. Do not build a second comment chatbot or put policy decisions directly in a Meta webhook.

## Goal

Complete the first operational agency release: policy-driven Facebook Comment Processing Unit, safe AgentOS comment replies, meaningful client/agency analytics, transparent one-month free trial lifecycle, and practical security/reliability/retention/backup/observability/evaluation hardening.

## Inherited From Previous Phases

- Phase 1–4 runtime, agent versions, tool classes, context/memory/knowledge/browser/attachment provider abstractions, safe trace/realtime and tenant/security guarantees.
- Phase 5 universal events, `EventRouter`, jobs/retries/DLQ/replay, conversation locks/buffers, action idempotency, scheduled work, cancellation, operational metrics.
- Phase 6 verified `FacebookMessengerAdapter` inbound normalization, page capabilities/credential model, Messenger data mappings, handoff reference behavior, and dashboards.

Comments arrive as `comment.created` universal events and must remain normalized/persisted/deduplicated before processing. The Comment Processor may invoke the same runtime only for an approved natural-language reply. Meta/platform limitations override any planned moderation action.

## New Contracts Introduced In This Phase

- `CommentProcessor`, `CommentClassifier`, `CommentPolicyEngine`, post/comment-context loader, moderation/reply action executor, and redacted decision/audit record.
- Versioned `CommentClassification` result and explicit policy outcomes `KEEP`, `HIDE`, `REPLY`, `HANDOFF`, and `DELETE` only when a business policy and verified channel capability explicitly allow it.
- Comment/post analytics event and metric definitions with source/attribution caveats.
- Business trial/lifecycle policy (`TRIAL`, `ACTIVE`, `PAUSED`, `EXPIRED`, `CANCELLED`), `trialStartedAt`, `trialEndsAt`, agency override, and post-expiry service behavior configuration.
- Published-agent evaluation suite/run/result contract and production operations/retention/backup/restore verification conventions.

## Scope

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
- Security/operations: RBAC and WS tests, redaction/secrets, rate limits, backups/restore drill, migration procedure, health checks, DLQ/replay, provider outage/circuit behavior, retention/offboarding tests.
- Evaluation: fixture coverage and regression gating for published versions; all prior phase regression suites remain green.

## Do Not Build Yet

Do not turn the product into a public self-serve SaaS, build a bespoke full human inbox, assume billing/payments, add unverified destructive Meta operations, split the monolith into microservices, or rewrite shared runtime/event/channel contracts. Instagram, Telegram, WhatsApp, email, TTS, and richer commerce integrations remain future compatible extensions.

## Deferred To Later Phases

Future work adds one `ChannelAdapter` implementation per channel, each with private inbound parsing/normalization helpers and a registry entry; deeper ecommerce/attribution, email notifications, TTS/voice response, advanced A/B rollout, richer BI, and provider implementations remain separate extensions. Each must read this plan, `ARCHITECTURE.md`, and all completion notes, then extend—not replace—the contracts.

## Definition of Done

1. Facebook comments flow through the generic event router to a specialized, typed, tenant-safe Comment Processor.
2. Classification and policy safely choose keep/hide/reply/handoff; destructive delete remains explicitly gated, capability-verified, audited, and non-default.
3. Agent comment replies use the one AgentOS runtime and semantic action/adapter path with ownership, idempotency, and redaction protection.
4. Client and agency dashboards provide role-scoped, Mantine-consistent operational/analytic views with trustworthy metric definitions.
5. Trial status supports the stated one-month unlimited/no-commitment offer with agency controls, audit, notifications, and no automatic data loss.
6. Security, tenancy, realtime, provider resilience, queue/replay, retention, backup/restore, health, audit, and evaluation validation passes.
7. The result remains a buildable modular monolith ready for future channel adapters rather than a Facebook-specific product.

## Completion Note

After implementation, write `docs/completion/phase7.md` with comment policy/classifier/provider details, verified Meta capabilities, metric definitions, trial operations, hardening/backup/retention evidence, evaluation suite, migrations/APIs, tests, limitations, and deviations.
