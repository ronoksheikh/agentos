# Phase 5 Completion — Universal Events and Durable Work

## Status and boundaries

Phase 5 adds the generic durable processing path in `plan5.md`. The fake Web Chat adapter proves inbound normalization through PostgreSQL, BullMQ, the channel-independent `AgentRuntime`, and outbound adapter execution. This is a modular-monolith foundation for future production channels. It does not deploy a production Web Chat transport, Messenger adapter, Meta webhook, or other external channel.

## Modules and public contracts

| Area | Main modules | Contract |
| --- | --- | --- |
| Events and inbound | `packages/events/src/universal.ts`, `packages/phase5/src/processor.ts`, `packages/website-sdk/src/index.ts` | Zod `UniversalEvent` version `1.0`, controlled `RawEventRecord`, `InboundGateway`, `EventRouter`, adapter `normalizeUniversalInbound` |
| Durable state | `packages/phase5/src/store.ts`, `packages/database/src/schema.ts` | Transactional raw/event/message/batch/work insertion, monotonic inbound sequence, effect intents, goal activations, raw retention |
| Work queues | `packages/phase5/src/contracts.ts`, `packages/phase5/src/queue.ts`, `apps/worker/src/index.ts` | Versioned `WorkJob` reference, six BullMQ queues, outbox pump, retry classification, Redis conversation lease, worker composition |
| Runtime and delivery | `packages/phase5/src/processor.ts`, `packages/agent-runtime/src/index.ts`, `packages/channels/src/index.ts` | Batch processing, freshness check, deferred delivery, reconciliation, capability-aware presence, compatible `deliveryManaged` runtime option |
| Operations | `packages/phase5/src/operations.ts`, `apps/api/src/phase5.ts`, `apps/admin/app/failures-queues` | Agency-scoped status, audited dry-run/replay/cancel, queue and lock metrics, Mantine work/event/goal view |

`UniversalEvent` carries an event ID and schema version; business, channel, connection, optional conversation/customer; type-specific validated payload; external source/event/message/parent identifiers; occurred and received timestamps; dedupe key; raw record and trace IDs. Message records retain each internal/external ID, source timestamp, reply reference, attachment references, and conversation sequence. The raw record stores a SHA-256 digest, byte count, receipt/dedupe state, duplicate count, and retention deadline, rather than an unrestricted external payload. Retention scrubs expired source IDs and digest while normalized records remain available. Invalid and unauthorized inbound attempts receive safe errors and audit records. The fake adapter acknowledges after the database transaction without waiting for runtime work.

`WorkJob` contains only schema version, work ID, business ID, trace ID, and work kind. The worker loads authoritative work and payload from PostgreSQL. Event routing marks comment/reaction events ignored pending Phase 7 policy; delivery/read events update message lifecycle without an agent run; attachment and browser jobs invoke supplied processors; inventory/order/custom/scheduled events activate pending goals.

## Queue, locking, and batching design

Migration `0006_shiny_wiccan.sql` adds `raw_inbound_events`, `universal_events`, `message_batches`, `work_items`, `effect_intents`, and `goal_executions`, with tenant and dedupe indexes. Migration `0007_remarkable_trauma.sql` adds raw duplicate counts. Migrations `0000`–`0005` remain unchanged. Inbound raw receipt, normalized events, messages, batch changes, and `work_items` enqueue intents commit in one PostgreSQL transaction. The pump scans due intents and puts minimal references into EVENT, CONVERSATION, OUTBOUND, ATTACHMENT, BROWSER, and GOAL BullMQ queues. Redis AOF and the PostgreSQL recovery scan cover process and queue restarts; the work row remains the source of truth. Failed work ends in a PostgreSQL `DEAD` state with a safe failure code. Attempts, bounded exponential backoff, hard timeout, cancellation polling, queue retention, and trace IDs are explicit.

The pump interleaves due work across businesses. Global, business, and connection concurrency slots bound bursts. Each conversation has a renewable Redis lease with an owner token; an old owner cannot renew or release a replacement lease. Work acquires that lease before a run or effect, and stale `RUNNING`/`QUEUED` rows can be recovered. A conversation's earlier batch and earlier reserved delivery must clear before its next batch starts. Separate conversations can run concurrently, including on another business during a forty-conversation burst.

Each inbound message is persisted immediately. A configurable quiet window and maximum wait combine rapid messages into one ordered batch with individual searchable message IDs and an upper sequence. Urgent input bypasses the quiet wait; attachment readiness waits have a separate cap. The worker builds one runtime input from the ordered batch, then compares its upper sequence against current input and automation eligibility before reserving or dispatching a reply. A newer clarification suppresses the stale reply and its later batch runs in sequence. Human ownership, pause, disabled businesses/agents, and disconnected channels prevent autonomous delivery.

## Timing, presence, and side effects

`evaluateResponseTiming` is separate from processing. It bounds optional delay using response size, batch size, queue age, configured policy, maximum customer wait, urgency, and seeded variability; its input contract also accepts tool/browser/media involvement. Business, agent, and channel policy fields are merged before evaluation. Urgent and transactional results bypass optional delay. Delivery is persisted as an effect intent and delayed work item. `RegistryPresenceController` uses channel capabilities to mark seen on `PROCESSING`, show typing on `COMPOSING`, and stop typing on send/failure/cancellation/suppression/timeout/handoff/pause/disconnect. Queued and buffered messages do not mark seen. Presence never enters the tool registry.

Outbound effects reserve a business-scoped idempotency key before execution. An ambiguous transport result becomes `UNKNOWN`; a reconciliation-capable adapter can resolve it without resending. A definite failed order notification can be retried from the existing order/effect without recreating the order. Write tools check conversation freshness before execution. PostgreSQL pending-order save and order commit lock the conversation row and compare the worker's included inbound sequence and AI ownership; existing order intents remain unique. Pending time, inventory, order, and supported custom-event goals create one durable goal execution per goal. Operators can cancel work and dry-run replay; real replay requires a safe state, agency capability, tenant scope, and an audit record. Unknown external effects require reconciliation rather than blind replay.

The agency `Events & queues` page and `Phase5Api` façade expose scoped work/event/batch/goal/effect state, queue depth, pending lag, duplicate rate, lock contention, average message-to-reply time, failure codes, and guarded actions. Realtime adds safe batch/delivery progress variants without raw content, credentials, prompts, or reasoning.

## Validation

- `bun run check`: strict TypeScript and **65 tests, 367 expectations** passed, including Phase 1–4 regressions.
- `bun run db:generate`: 57 tables; no schema drift after migration `0007`.
- `bun run admin:build` and `bun run client:build`: both production builds passed. Next.js emitted nonblocking cache and workspace-root warnings.
- Fresh isolated PostgreSQL database: all migrations applied. `bun run db:phase5-smoke` passed using live PostgreSQL and Redis: fast fake-adapter acknowledgement, dedupe, three ordered messages in one run, delivery/read status and ignored comments, notification-only retry, ambiguous-send reconciliation, stale-reply suppression under two workers, order sequence guard and idempotent commit, lease replacement, forty-conversation fairness, recovery, replay authorization, cancellation, raw retention, and one-shot time/inventory/custom goals.
- With Redis AOF enabled, `bun run db:phase5-restart prepare`, an actual Redis shutdown/restart, then `verify` proved a queued BullMQ job survived and completed once.

## Limits and deviations

- `apps/worker` requires a deployment-supplied `PHASE5_WORKER_COMPOSITION_MODULE` for runtime, trusted providers, channel registry, and optional attachment/browser processors. The framework-neutral `Phase5Api` is an application boundary, not a newly deployed HTTP server. No production channel/provider deployment was verified.
- The timing function accepts tool/browser/media complexity, but the current `AgentRunResult` does not yet supply those flags to the scheduler. Its live scheduling decision uses batch size, response size, queue age, urgency, policy, and seeded variability. Typing starts when final actions are formed; it is not shown during model/tool/browser work. Adapter-specific typing refresh and transport timeouts still need a production channel drill.
- Cancellation is cooperative for active work. Once an external send has begun, an operator cannot guarantee it was prevented; the recorded effect and adapter reconciliation determine its outcome. Ambiguous effects are held for reconciliation.
- The fake adapter and deterministic Phase 4 service compositions prove the boundaries. Production attachment/browser executors, live commerce integrations, production webhook authentication, and channel-specific status semantics remain future composition work. Comment automation remains Phase 7 work.

## Implementation commits

- `d6fc45c` — durable event, schema, queue, and worker foundation.
- `d906435` — processing, operations, order freshness, migrations, and live validation.
