# Phase 5 — Universal Events, Queueing, Buffering, Locks, and Durable Work

## Before implementing this phase

1. Read `ARCHITECTURE.md`, `plan.md`, and every `plan1.md`–`plan4.md` completely.
2. Read all available completion notes through `docs/completion/phase4.md`.
3. Inspect the live website flow, attachment/browser interfaces, action idempotency model, data migrations, and tests.
4. Move work behind the universal event pipeline by adapting existing channels/processors. Do not change AgentOS into a webhook consumer or alter semantic actions merely to suit BullMQ.

## Goal

Create the durable, generic processing layer required for bursty and retrying external channels: typed universal events, unified ChannelAdapter/Registry routing, presence lifecycle, quick inbound acknowledgement, deduplication, queues, per-conversation serialization, configurable message accumulation and outbound timing, idempotent action execution, scheduled goals, long-job lifecycle, cancellation, and operational recovery.

## Inherited From Previous Phases

- The single normalized runtime, trusted execution/tenant context, structured actions, tool safety and idempotency boundary.
- WebChatAdapter contract/fake adapter, client/agency realtime projections, ownership/handoff behavior.
- Attachment/browser/knowledge/custom-tool contracts and existing safe progress events.

Do not send raw channel payloads into the runtime. Do not run expensive model/browser/media work in webhook request lifetimes. Do not use queues for simple synchronous reads/writes. Do not assume a retry means a side effect did not happen.

## New Contracts Introduced In This Phase

- Versioned `UniversalEvent` and raw-event record: ULID/event schema version, event type, business/channel/connection scope, conversation/customer references, occurrence timestamp, dedupe key, source metadata, validated payload, lifecycle, attempt state, trace ID.
- Adapter inbound contract: verify → dedupe/persist raw event → normalize → enqueue/route → rapid acknowledgement.
- `ChannelRegistry` and `PresenceController` lifecycle contract: route Universal Actions by trusted conversation channel; mark seen only on actual processing; typing only during final response composition; cleanup on all terminal states.
- `EventRouter` and specialized processor interface; processors own event-type policy, not AgentRuntime.
- Durable job contracts for normalized events, conversation runs, attachment jobs, browser jobs, outbound delivery, scheduled triggers, retries and dead letters.
- Conversation serialization/lease and message batch contracts; delivery scheduling policy is separate from processing.
- `ResponseTimingPolicy` evaluation/result contract: bounded per-business/agent/channel pacing inputs, urgency/maximum-wait limits, safe channel-activity lifecycle, and traceable scheduling decision.
- Side-effect idempotency record/action state and safe event replay/recovery contract.

## Scope

### Universal events and adapter inbound path

Formalize Zod-backed event schemas for `message.received`, `attachment.received`, `comment.created`, `reaction.created`, `message.delivered`, `message.read`, `order.created`, `order.updated`, `inventory.updated`, `scheduled.triggered`, `handoff.resolved`, and reserved future types. Not every event invokes AgentOS. Include `schemaVersion`, event ID, dedupe key, business/channel/connection IDs, source identity, occurrence timestamp, optional conversation/customer identity, payload, trace correlation, and processing state.

Each ChannelAdapter's inbound components verify source/authentication, derive a stable raw-source id/dedupe key, persist raw event under retention/redaction policy, normalize with validation, enqueue appropriate work, and acknowledge immediately. Persist external event/message IDs, external timestamps, sender/connection references, reply-to/parent relationships, edit/delete state, and attachment references whenever supplied and supported. Invalid/unauthorized events are safely rejected/audited. Duplicate deliveries must return a successful acknowledged result when the external protocol expects it without creating duplicate internal effects.

### Router and processors

Create a clear `events` module with schema, repository, dedupe, router, replay, and processing-state APIs. Route message events to `MessageProcessor`; attachment events to attachment work; delivery/read updates to lightweight state updates; inventory/order/scheduled events to explicit processors; reserve comments for Phase 7. Processors decide whether a particular event is ignored, persisted, batched, scheduled, triggers a goal, invokes runtime, or creates an action. Preserve event/action trace correlation end-to-end.

Validate the fake WebChatAdapter contract through adapter inbound normalization → router/processor → runtime → Universal Action → Channel Registry → adapter execution. The first production use of this durable path is `FacebookMessengerAdapter` in Phase 6. This is an architectural migration only; client dashboard contracts should not regress.

### BullMQ/Redis queues and worker topology

Introduce Redis/BullMQ where durable background behavior is required. Keep `apps/api`, `apps/worker`, and optional `apps/browser-worker` in one monorepo/modular monolith; deployment can begin with one worker process. Queues may include normalized events, conversation runs, delayed outbound delivery, attachment processing, browser work, scheduled triggers, and dead-letter/replay. Jobs carry minimal validated, tenant-scoped references—not secrets or arbitrary model output.

Configure fair workload-aware scheduling at global, Page/channel connection, and business limits. A Page receiving forty active conversations may process several conversations concurrently within configured limits, with urgent work prioritized and ordinary conversations fairly interleaved. It must not exhaust global capacity for another business or starve low-volume conversations. Per-conversation work remains keyed/serialized regardless of priority; priority may move a conversation ahead of unrelated work, never reorder its own messages.

Set queue names, job payload schemas, attempt/backoff policy, timeout, priority, cancellation state, trace propagation, metrics, and retention. Use exponential backoff for transient `MODEL_ERROR`, `TOOL_ERROR`, `CHANNEL_ERROR`, eligible `AUTH_ERROR`, `TIMEOUT`, `BROWSER_ERROR`, and `ATTACHMENT_ERROR`; classify `VALIDATION_ERROR`/`PERMISSION_ERROR` as non-retryable. Never blindly retry destructive writes or unknown external send outcomes; recover through idempotency/status lookup.

### Conversation batching, serialization, and natural delivery timing

`MessageProcessor` persists every inbound message immediately with a monotonic conversation sequence. It uses the applicable `ResponseTimingPolicy` quiet/debounce window and maximum accumulation cap per business/agent/channel to group rapid messages in one conversation into a single batch/run. A batch stores the included message IDs and upper sequence so the runtime and realtime UI can truthfully report “received 3 messages / combined message batch.” Attachments may extend readiness only within a bounded policy window; urgent transactional/system events may bypass buffering. Example: “bhai” → “black ta” → “XL ache?” becomes one runtime input while all three messages remain separately searchable and visible.

Only one active mutation/runtime sequence may own a conversation. Use keyed queue ordering and/or Redis leases with owner tokens, bounded TTL/renewal, crash recovery, and observability. Different conversations run concurrently. Before side effects, confirm current ownership/state; on lock loss, avoid unsafe continuation and let idempotency/retry reconcile.

When a new inbound customer message arrives while a run is checking inventory, using a browser, or preparing an unsent reply, append it to the ordered conversation and record a newer sequence. Before final dispatch compare the run’s included sequence to the latest inbound sequence. If the reply is now clearly stale, suppress it and enqueue a follow-up batch; if it can be safely refreshed, incorporate the new message; if it remains valid, send it then process a follow-up. Do not create overlapping responses or cancel every active run merely because a short clarification arrived. This policy must also honor human takeover, paused conversation, disabled agent/business, and disconnected-channel states.

Separate actual processing from delivery scheduling. Implement `ResponseTimingPolicy` as a deterministic-within-bounds decision function, not fixed delays or unconstrained randomness. It receives safe operational inputs such as batch size, response length band, complexity/tool/browser/media involvement, current queue age/workload, urgency, channel capability, and configured business/agent/channel rules. It returns bounded debounce, typing/activity, optional short pause/restart, and pre-send delay decisions plus a hard latest-send deadline.

Short simple replies can receive little or no optional delay; complex replies or legitimate tool/browser/media work can have longer bounded pacing. Use a small seeded/bounded variability range to avoid perfectly predictable timing, but never random chaos. Critical transactional/urgent results bypass optional delay, and all paths respect maximum wait limits so customers are not left waiting unnecessarily. Do not use timing to falsely claim human behavior; the configured disclosure policy remains authoritative for direct automation/AI questions.

Persist scheduled delivery/cancellation/idempotency state and a safe timing-decision summary. `PresenceController` requests mark-seen/typing through Channel Registry and capability-checked adapter infrastructure: mark seen once only after a worker acquires the conversation; start typing only when final customer-facing composition starts; briefly pause/restart when a new batch or real composition-state transition warrants it; renew sparingly if required; and stop on send, failure, timeout, stale-response cancellation, handoff, pause, or disconnect. It is not an LLM tool, must not mark messages seen while queued/buffered, must not show typing across generic tool/browser work, and must not hide queue overload or create indefinite artificial waiting.

### Side effects, cancellation, scheduled goals, and long jobs

Centralize action execution state: created, executing, completed, failed, cancelled, unknown/reconciliation-needed. Persist idempotency key with the business/action/external target scope before execution. Ensure webhook retries, job retries, API retries, and worker crashes cannot duplicate outbound messages, orders, refunds, handoffs, moderation decisions, or schedules.

For conversational orders, serialize pending-order mutations under the same conversation ownership/sequence rules. `create_order` uses the persisted order-intent key and reconciliation result, never a blind retry. A successful create followed by failed delivery produces a notification-retry job linked to the existing order; it must not re-enter order creation. New customer messages changing product/variant/quantity update/reconcile the active pending order in sequence; handoff/pause/cancellation halts autonomous checkout while preserving state for an authorized human.

Activate persistent pending goals through event/time triggers: e.g. inventory update wakes “notify customer when Black XL returns,” time wakes a follow-up. Track created-by, target customer/conversation, state, expiration, dedupe, retries, result, and cancellation. Support cancellation for agent runs, browser work, delayed messages, and long tasks initiated by authorized admin, human takeover, timeouts, or shutdown. Publish safe progress/status without exposing secrets/reasoning.

### Reliability, operations, APIs, and data

Add new migrations for raw/normalized events, processing state, queue/replay metadata, conversation batch/lock state as needed, job/action idempotency, schedules/goals, cancellations, and dead-letter references. Use transactional/outbox-like handoff where needed so committed state is not silently lost before enqueue. Do not mutate historical migrations.

Provide agency-authorized operational APIs/UI for event list/detail (redacted raw access), failures, queue depth, retries/DLQ, replay with safeguards, active locks/batches, cancelled work, and scheduled goals. A replay must be explicit, scoped, audited, dedupe-aware, and default to a dry-run/safe mode where viable. Report queue depth, lag, duplicate rate, lock contention, message-to-reply latency, retry/failure categories, browser/attachment job state, and provider/channel errors.

## Tests and validation

- Event contract: normalization/version validation, raw event retention/redaction, router choices, ignored events do not run AgentOS.
- Adapter inbound: fast acknowledgement under slow model/media work; duplicate webhooks/events process once; malformed/auth-invalid inputs fail safely.
- Queue: crash/restart recovery, retries/backoff/DLQ classification, cancellation, replay authorization/audit, trace propagation.
- Buffer/lock: three rapid messages create one run with preserved IDs/order; bounded attachment wait and maximum wait/urgent bypass; two workers serialize one conversation but different conversations parallelize; expired/crashed lease recovery cannot double-send.
- Timing/workload: short versus complex/tool/browser/media replies use bounded policy pacing; typing pause/restart/stop obeys capability and state changes; urgent transactional results bypass optional delay; maximum wait is enforced; forty conversations are fairly concurrent without breaking per-conversation ordering or starving other businesses.
- Presence: RECEIVED/QUEUED/buffered messages do not mark seen; PROCESSING marks seen once when supported; COMPOSING starts typing when supported; refresh/cleanup works on send, failure, timeout, cancellation, stale response, takeover, pause, and disconnect.
- Run freshness: a new “XL lagbe” message arriving during an inventory run cannot produce an obviously stale final response; safe refresh/suppress/follow-up behavior remains ordered and ownership-aware.
- Idempotency: duplicate message/order/handoff/schedule/action attempts collapse correctly, including ambiguous external-result recovery.
- Order reliability: simultaneous customer changes remain ordered; pending-order mutation and creation serialize correctly; duplicate webhooks/jobs cannot create duplicate orders; create-success/send-failure retries only notification; inventory/tool/browser failures, takeover, and expiry reconcile visible pending-order state.
- Scheduling: natural delivery timing is configurable/cancellable and urgent result bypass works; inventory/time triggers fire goals once or idempotently.
- Regression: website SDK/client realtime/handoff/attachments/browser contracts still work through the durable path; disabled/paused/disconnected entities do not auto-reply, and external message/reply/timestamp metadata remains available.

## Do Not Build Yet

No production Messenger adapter before Phase 6, production WebChatAdapter, Instagram/Telegram/WhatsApp adapters, Facebook comment policy/replies, payment/billing engine, or distributed microservice redesign.

## Deferred To Later Phases

Phase 6 supplies the first production adapter, `FacebookMessengerAdapter`, using this pipeline and credential model. Phase 7 implements the reserved Comment Processor, analytics, trial lifecycle UI/operations, broader production security/backup/retention drills, and agent evaluations. Later channels add one adapter to the registry rather than changing AgentOS.

## Definition of Done

1. Adapter inbound events are durably normalized, deduplicated, routed, processed, and acknowledged without changing the runtime’s channel-agnostic contract; a fake WebChatAdapter proves contract conformance without production deployment.
2. Conversation bursts are configurable and safe; per-conversation ordering is serialized while unrelated conversations remain parallel.
3. All material side effects withstand retries/crashes through persisted idempotency and reconciliation-aware action state.
4. Long/attachment/browser/scheduled work supports progress, retry classification, timeout, cancellation, DLQ/replay, and safe observability.
5. Natural delivery timing is separate from processing and never delays urgent reliability-sensitive work.
6. Queue, lock, idempotency, replay, tenant, and website regression tests pass.

## Completion Note

After implementation, write `docs/completion/phase5.md` with event/job schemas, queue/lock/buffer design, idempotency/replay semantics, migration and worker topology, operations surfaces, tests, limitations, and deviations. Phase 6 must read it first.
