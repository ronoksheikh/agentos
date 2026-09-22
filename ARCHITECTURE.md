# AgentOS Architecture Contract

## Purpose and authority

This is the permanent technical contract for AgentOS. It applies to every phase, module, dashboard, integration, and future coding agent. `plan.md` is the delivery roadmap; the phase plans explain when to introduce pieces of this architecture. If a phase plan is less specific, this document wins. Update this document only through a deliberate, documented architectural decision.

AgentOS is private agency infrastructure: the agency onboards and operates businesses rather than launching a public self-serve SaaS initially. It is nevertheless multi-tenant from its first implementation.

## Non-negotiable principles

- Build one TypeScript modular monolith in one Bun-managed monorepo. Keep deployable processes in the same repository; do not split into microservices without a measured scaling or isolation reason.
- Use Node.js-compatible TypeScript, Next.js for web applications, Mantine UI, PostgreSQL with Drizzle ORM, Zod at boundaries, and Redis/BullMQ only for work that actually needs durable background execution, delay, fan-out, or distributed locking. Keep every deployable process Docker-compatible; containerization does not imply a microservice split.
- AgentOS is channel-agnostic. It never imports Facebook, Meta, Instagram, Telegram, WhatsApp, or website SDK implementation code.
- One `ChannelAdapter` boundary owns each external channel's inbound verification, raw-event parsing, normalization, message-ID translation, attachment metadata, capability differences, API execution, and health. Processors decide whether and how AgentOS runs; adapters execute universal channel actions with channel-specific APIs.
- Existing module boundaries and public contracts MUST NOT be rewritten merely because the current phase finds them inconvenient. Extend the architecture unless there is a documented architectural reason to change it.
- Do not create unnecessary interfaces, packages, queues, services, CQRS layers, or event sourcing. Use clear typed module functions where that is simpler.
- Never store or expose hidden chain-of-thought. Runtime traces and realtime views contain observable execution facts only.

## Canonical flow

```text
External channel / system
  <-> ChannelAdapter (verify, parse, normalize, persist/acknowledge inbound)
  -> UniversalEvent
  -> EventRouter
  -> specialized processor
  -> AgentOS Runtime
  -> UniversalChannelAction / domain action
  -> ChannelRegistry -> ChannelAdapter.execute()
  <-> external channel API
```

Facebook Messenger, Facebook comments, Instagram, Telegram, WhatsApp, Web Chat, and future integrations follow this model. An adapter may internally separate webhook/update handling, normalization, API clients, presence, and attachment mapping into files, but there is one externally visible `ChannelAdapter` abstraction. Adding an adapter never changes the runtime's understanding of a channel.

## Repository and module boundaries

Keep a pragmatic shape such as:

```text
apps/
  api/                 # HTTP API, WebSocket endpoint, webhook entry points
  worker/              # BullMQ consumers and scheduled work when introduced
  browser-worker/      # isolated browser execution when introduced
  admin/               # internal agency Next.js + Mantine application
  client/              # business-facing Next.js + Mantine application
packages/
  agent-runtime/       # orchestration loop and action interpretation boundary
  context/ memory/ models/ tools/ knowledge/
  events/ processors/ channels/ realtime/ handoff/ auth/
  database/ shared/
  website-sdk/         # only when independently embedded/published
docs/completion/
```

The exact folders may be consolidated when they remain cohesive. `agent-runtime`, `context`, `memory`, `models`, `tools`, `events/processors`, `channels`, `auth`, and `database` are logical boundaries, not an instruction to make every folder an independently deployed service.

Within `channels`, keep a small shared core (adapter contract, universal channel actions/events, capabilities, registry, and presence controller) plus channel implementations. Do not make empty production packages/adapters merely to appear multi-channel. The initial production registry contains only `facebook_messenger -> FacebookMessengerAdapter`; Instagram, Telegram, WhatsApp, and WebChat are future contract targets.

## Public contracts and compatibility

Public contracts include normalized event schemas, actions, runtime input/output, model/tool/provider interfaces, channel capabilities, realtime envelopes, API error/response conventions, identity/authorization context, and persisted lifecycle states that other modules depend on.

- Give each versioned external or cross-module schema an explicit `schemaVersion` when it can outlive a single deployment.
- Add optional fields or new discriminated-union variants compatibly. Do not silently change meanings or remove fields consumers use.
- A breaking change requires an ADR-like note in the relevant plan completion note and an update here and in affected plans, plus a migration/compatibility path.
- Do not deep-import another module's implementation internals. Import its documented public entry point.

### Repository hygiene and commits

AgentOS implementation is maintained in one Git repository. At the start of Phase 1, if the project root has no `.git` directory, the implementing agent initializes Git before creating application source code, inspects the initial planning baseline, and creates an initial documentation-baseline commit. This authorization is pre-approved: the agent does not need to request confirmation to initialize the repository or create commits for in-scope work. If no Git author identity is configured, it configures a repository-local automation identity and records that fact in the Phase 1 completion note; it must not modify global Git identity settings.

During every phase, agents inspect `git status` before work, preserve unrelated user changes, and make automatic, small, logically coherent commits after a meaningful implementation slice is complete and proportionately validated. Commit messages identify the phase and intent, for example `feat(phase1): establish agent runtime foundation`. Do not stage the entire working tree blindly, fold unrelated changes into a phase commit, create empty/checkpoint commits, or commit secrets/generated local artifacts. A phase's completion note and its directly related changes belong in its final phase commit; the resulting status should be clean except for pre-existing or explicitly unrelated work, which must be reported rather than altered.

Never use destructive Git recovery (`reset --hard`, forced checkout, or history rewriting) to obtain a clean tree. If a commit is blocked by hooks, tests, a merge conflict, or missing required information, resolve it safely when possible; otherwise preserve the changes, report the exact blocker, and document it in the completion note. Automatic commits do not authorize branches, remote pushes, pull requests, rebases, or modifications outside the current task.

### Unified channel adapter contract

Conceptually, every adapter exposes `channel`, inbound request verification, inbound normalization to `UniversalEvent[]`, execution of `UniversalChannelAction`, capability discovery, and health checking. It owns platform message IDs, replies/references, reactions, self/echo filtering, attachment metadata, delivery/read callbacks, webhook/update dedupe support, API rate-limit/error translation, and credential/connection health. Exact TypeScript names follow the repository, but no separate externally visible `FacebookGateway`, `TelegramGateway`, or channel-specific AgentOS API layer is introduced.

AgentOS consumes Universal Events and produces channel-independent Universal Actions such as `SendMessage`, `SendImage`, `SendFile`, `SendProduct`, `ReplyToMessage`, and `ReactToMessage`, alongside domain actions such as handoff and commerce. The `ChannelRegistry` resolves the adapter from trusted conversation/channel identity and calls `adapter.execute(action)`. Unsupported infrastructure capabilities skip safely; unsupported rich actions use a capability-approved fallback (for example product URL/text/image) where one exists. Channel API methods such as `facebook_send_message` or `telegram_typing` are never injected as LLM tools. Business tools remain separate.

## Identity, tenancy, and authorization

Use one consistent sortable ID format: ULID strings for application entities and request/run/event/action IDs. External provider IDs remain separate fields. All API timestamps are UTC ISO-8601 strings; database timestamps are timezone-aware UTC values.

The tenant is a `Business`. Every tenant-owned record has a `businessId` and every query, cache key, queue payload, object-storage prefix, trace, event, subscription, and integration is scoped to it. This includes users' memberships, agents, versions, customers and identities, conversations, messages, memories, knowledge, tools, credentials, channel connections, attachments, handoffs, browser sessions, schedules, analytics, audit logs, files, and work queues.

Trusted tenant context is created only on the server:

```text
authenticated request / verified adapter event
  -> server resolves account, membership, connection, or signed visitor session
  -> TrustedBusinessContext
  -> processor / AgentRuntime
  -> tools and action executors inherit trusted identity
```

The model, browser page, website SDK, route parameter, and client-supplied `businessId` are never authority. A route parameter is only a lookup candidate that must be checked against the authenticated principal. Tools receive a trusted execution context containing `businessId`, `agentId`, `conversationId`, `customerId` when known, `runId`, capability/permission grants, trace ID, and cancellation signal; they do not accept arbitrary tenant identifiers from model-generated arguments.

### Accounts, memberships, and authentication

Use Better Auth backed by PostgreSQL/Drizzle as the session-based TypeScript authentication solution. Configure it once as the shared auth boundary; do not let individual apps or phases choose competing auth libraries. Passwords use its established password-hashing integration or an equivalently established compatible implementation. Browser sessions are secure, HTTP-only cookies; API/WS authentication uses the validated session or a short-lived server-issued token, never a long-lived credential in local storage.

There is one `User` identity type plus scoped memberships:

- Agency membership roles: `SUPER_ADMIN`, `ADMIN`, `SUPPORT`, `DEVELOPER`. Permissions are capability-based so role labels can evolve.
- Business membership roles: `OWNER`, `ADMIN`, `STAFF`, `VIEWER`. A user may belong to multiple businesses.
- Account states include active and disabled. Disabled accounts lose server-side access immediately.

Plan login, logout, password reset, invitation acceptance, session revocation, membership management, and account disabling. MFA/2FA, OAuth, and passkeys are deferred extensions. Every WebSocket connection authenticates during handshake; subscription authorization is server-calculated from memberships and never trusted from a requested business/channel identifier.

## Agent configuration and publishing

An `Agent` is a business-owned stable identity. Its behavior lives in immutable `AgentVersion` snapshots with states `DRAFT`, `TEST`, `PUBLISHED`, and `ARCHIVED`. Editing a published agent creates or updates a draft; it does not mutate the live runtime configuration. Publishing atomically selects one compatible version as active. Rollback selects a prior published snapshot and is audited.

An agent version can configure: name, instructions, personality/tone, languages, primary/fallback/vision model references, enabled tools, permission grants, knowledge sources, memory and context policy, handoff and moderation rules, `ResponseTimingPolicy`, channel-specific behavior, browser access/domain policy, feature flags, max runtime steps/tool calls/output/context/runtime limits, model limits, and an automation/AI disclosure policy. Secrets are always references, never version content visible to a model or browser client. If a customer directly asks whether the agent is automated or AI, the configured disclosure policy must be followed; the agent must not falsely claim to be human.

## Runtime, models, tools, and actions

The runtime receives a normalized event and trusted context, loads the active (or explicitly selected test) agent version, builds bounded context, resolves allowed tools, performs a bounded model/tool loop, produces validated structured actions, records observable trace facts, and asks action executors to apply side effects. It has no channel-specific imports.

`ModelProvider`, `VisionProvider`, `AudioTranscriptionProvider`, search, browser, storage, and channel adapter interfaces isolate vendor SDKs. A model policy selects primary/fallback models, optionally a cheaper classifier, and a vision-capable provider. Timeouts, retryability, circuit breaking, and cost/usage accounting are provider concerns surfaced through typed results. Do not retry destructive side effects merely because a model call was retried.

The reusable tool registry describes input Zod schemas, output contracts, safety class, capability requirements, redaction rules, and execution function. Safety classes are `READ`, `WRITE`, `SENSITIVE`, and `DESTRUCTIVE`; policy outcomes are `ALLOW`, `DENY`, and `REQUIRE_HUMAN_APPROVAL`. Model output cannot bypass that policy. Initial categories are context/memory, knowledge, commerce, customer, internet/browser, human handoff, and approved custom HTTP/API tools.

Actions are semantic and structured (`SendMessage`, `SendImage`, `SendFile`, `SendProduct`, `ReplyToMessage`, `ReactToMessage`, a later compatible `ReplyToComment`, `RequestHuman`, and memory/pin/pending-goal operations). The action executor validates the current conversation ownership, tenant, permission, idempotency key, and channel capability before executing. Every material side effect has an idempotency key persisted before/with execution: outbound messages, orders, refunds, handoffs, scheduled goals, moderation actions, and external tool writes.

`PresenceController` is infrastructure, not an LLM tool or normal AgentOS action. It observes trusted run/conversation lifecycle transitions and uses the Channel Registry to ask the current adapter to perform supported presence operations: mark seen, typing on/refresh/off. Adapters declare `canMarkSeen`, `canShowTyping`, `canReplyToMessage`, `canSendText`, `canSendImage`, `canSendFile`, reactions, and other capability flags. Unsupported presence safely skips; a rich action may use an approved fallback. AgentOS never branches on Facebook, Telegram, or any channel API.

## Context, conversations, memory, and customer identity

Build context in an explicit, budgeted order:

```text
Agent instructions
Business information and policy
Channel capability/context
Customer identity
Customer memory
Conversation summary
Pinned messages
Recent message window
Pending order
Pending goals/actions
Relevant knowledge
Relevant safe tool results
Current event
```

Context selection records provenance, source IDs, inclusion reason, and token estimate. Do not dump entire histories. Keep raw historical messages searchable under tenant authorization; use rolling summaries, recent windows, explicit pins, and durable memories for continuity. Memories carry provenance/source message references, type, importance/confidence, lifecycle, expiry, and `supersededBy`; a later agent can retrieve the original source message. Pending customer commitments and scheduled work are persisted goals with state, owner, trigger, expiration, and idempotency—not vague free-text memory.

Customers are business-scoped. `CustomerIdentity` records channel-specific identifiers (Facebook, Instagram, website visitor, phone, etc.); identities are only linked when there is a reliable basis. Do not assume a cross-channel person match.

Identity matching is an explicit, auditable workflow. A matching candidate may be `POSSIBLE_MATCH`, `CONFIRMED_MATCH`, or `SEPARATE_IDENTITIES`; confirmed linkage requires a reliable signal such as verified phone number, confirmed email, known account identity, or explicit authorized/user confirmation. Similar names alone are never sufficient. Linking preserves every original channel identity and its external IDs, records matching evidence/confidence/actor/time, and supports review/unlink where safely permitted. A possible match does not merge customer records or automatically alter runtime context.

Messages preserve internal and external identity/lifecycle data: business/conversation scope, channel connection, external message ID, external parent/reply ID where supported, sender identity, channel occurrence timestamp, received/edited/deleted/delivery/read state, attachment references, and raw-event source reference. Channel timestamps are not replaced by processing time. Unsupported edit/delete/reply semantics are represented as a safe capability/state result rather than silently discarded. A disconnected channel, disabled agent, paused conversation, or disabled/deleted business is ineligible for new automated work and outbound sends; the event/action record must show the safe skip/failure reason.

### Run freshness and inbound messages during active work

Conversation serialization prevents concurrent state mutations, but it must not make an active run blind to newer customer input. Every inbound message is persisted with a monotonic conversation sequence. A run records the newest inbound sequence included in its context/batch. Before an externally visible final action is dispatched, the processor compares it with the latest customer sequence and current ownership/channel state.

When newer input exists, policy chooses one of three safe outcomes: incorporate it before finalization if the run can refresh without invalidating work; suppress/replace a clearly stale unsent response and enqueue one follow-up batch; or send a still-valid response and immediately enqueue a follow-up. Do not cancel every run reflexively, but never knowingly send an obviously obsolete answer. Queue/lock ownership ensures follow-ups execute in order, and outbound action idempotency prevents duplicates.

### Temporary operational context

`BusinessAnnouncement` (also called emergency mode) is a business-scoped, time-bounded operational context record, not a permanent prompt edit. It has safe content, priority, start/expiry time, active/inactive state, affected channels and agents, creator, audit history, and optional source/reference. Examples include temporary delivery delay, a product outage, or a holiday cutoff. Only active, in-scope announcements are selected into relevant AgentOS context; they automatically stop applying at expiry or disablement. The selector must include bounded provenance and avoid duplicating an announcement across every context section.

### Conversational orders

Conversational ordering is a reusable commerce capability, not a Messenger feature. Any channel that supports a conversation can follow:

```text
ChannelAdapter -> UniversalEvent/processor -> AgentOS -> commerce tools/actions -> Order system
```

AgentOS collects order information naturally across messages, asks only for missing or ambiguous information, summarizes the proposed order, and obtains confirmation when the business policy requires it. It never creates an order merely because product interest was detected. Product identity must be resolved through structured catalog/inventory tools where available; ambiguity requires customer confirmation rather than guessing.

Each business owns an industry-agnostic `OrderPolicy`: inbox-order enablement, required/optional checkout fields, field validation rules, product/variant/quantity requirements, confirmation requirement, COD/payment options, delivery rules, permitted lifecycle statuses, pending-order expiry, website-discovery enablement, and handoff conditions (for example custom/high-value order, uncertain product, payment issue, invalid address, or customer request). These are structured configuration, not a global rigid form or permanent prompt text.

`PendingOrder` is a durable, business/customer/conversation-scoped transactional state—not a conversation summary or ordinary memory. It tracks the selected product references/variants/quantities, collected fields, missing requirements, validation/confirmation status, originating message references, responsible agent/version/run, source channel, expiry, and state history. It is high-priority context for the relevant conversation. A customer change such as a new size or quantity updates this one pending order; a returning customer can resume it according to expiration policy. Human takeover preserves it for staff continuation.

An `Order` is created only by an idempotent commerce operation such as `create_order`, then is visible to authorized client/agency operations. It stores business, customer, conversation, channel/source (`MESSENGER`, `WEB_CHAT`, and future channel values), originating message(s), agent run/version, confirmation state, status, customer/order fields, address, payment/delivery method, notes, timestamps, and audit history. `OrderItem` records immutable snapshots of product/variant identity, name, SKU where available, quantity, unit price, discounts/totals/currency as applicable; mutable catalog data and canonical product URLs must not rewrite historical order facts. A canonical product reference is separate from its URL so URL changes do not corrupt orders.

The baseline lifecycle is configurable but semantically compatible with `DRAFT -> COLLECTING_INFO -> AWAITING_CONFIRMATION -> CONFIRMED -> PROCESSING -> SHIPPED -> DELIVERED`, plus cancelled, failed, expired, and any audited business-required terminal states. Pending order status and final order status are distinct. Multiple products per order are supported.

`create_order` carries an order-intent/idempotency key scoped to the business/conversation/pending order and must reconcile an existing result before attempting another create. Retries after a successful creation but failed customer notification retrieve the existing order and retry only the outbound notification. Inventory is rechecked before confirmation/create where a live inventory source exists; product/variant/quantity changes, customer cancellation, stale pending orders, concurrent messages, tool/browser failures, handoff, and channel-send failure all update/reconcile state rather than produce duplicate orders.

Product discovery prefers structured catalog/product/inventory APIs. When explicitly enabled and catalog data is insufficient, approved browser/web tools may inspect the client's allowed website only to identify likely public products and canonical product URLs; browser discovery is not authoritative inventory or order data unless explicitly configured. It must return a candidate/uncertainty state and ask for confirmation when more than one product fits. Future channel adapters may render the same structured product reference as text/link or a richer card according to capabilities.

## Universal events, queues, ordering, and timing

Channel adapters must verify inbound requests, deduplicate, persist raw event data with controlled retention, normalize, enqueue if work is not trivial, and acknowledge external webhooks/updates quickly. Universal events are typed, versioned, and include event ID, dedupe key, business/connection/channel scope, conversation/customer references when available, occurrence timestamp, and safe source metadata. Typical types include `message.received`, `comment.created`, `attachment.received`, reactions, delivery/read updates, inventory/order updates, scheduled triggers, and handoff resolution.

Processors—not the runtime—determine what happens. A message processor persists messages, applies a configurable per-business/channel debounce window, then runs AgentOS once for a burst. Preserve every inbound message; batch only the work. Urgent/system events may bypass the buffer. Processing is distinct from delivery timing: tools and state changes may run immediately, while a small configurable outbound scheduling delay can make a response natural. Delay policy considers length, complexity, batch size, tool/attachment/browser work, response size, and channel rules; it must not harm transactional urgency or reliability.

A batch records the included message IDs and upper inbound sequence. Attachments may wait for their required safe derived result within a bounded policy window; they must not create an unbounded delay. New messages arriving during an active run follow the freshness policy above, not a second overlapping run.

`ResponseTimingPolicy` is the single reusable pacing layer used by processors, outbound scheduling, and `PresenceController`. It is configured per business with agent/channel overrides and bounded values: debounce/minimum and maximum pre-send delay, response-length/complexity bands, tool/browser/media work bands, typing start/renew/stop behavior, optional short typing pauses, max total customer-wait time, urgency bypass, queue priority, and a small bounded variability range. It deliberately produces non-perfect timing without random chaos or a claim of human behavior.

Presence states are `RECEIVED`, `QUEUED`, `PROCESSING`, `COMPOSING`, `SENDING`, and `SENT`. RECEIVED/QUEUED do nothing: a message must not appear seen merely because the adapter accepted it, it was buffered, or it waits in a queue. After a worker acquires the conversation and an AgentRun actually begins (`PROCESSING`), the controller may mark seen once if supported. Internal context/tool/browser work does not automatically show typing. At `COMPOSING`, when the final customer-facing response is being generated, the controller may start/refresh typing; it stops after send or on failure, timeout, cancellation, stale-response cancellation, human takeover, pause, or disconnect. Critical transactional/urgent results bypass optional delay, and no policy may delay past its explicit maximum.

Queue scheduling applies fair business/page workload handling: a burst across many conversations can run up to configured global/page/business concurrency in parallel, with urgent work prioritized and ordinary work fairly interleaved. Per-conversation sequencing remains serialized; queue fairness must not reorder messages within a conversation or starve lower-volume conversations. Timing decisions and channel activity changes are observable as safe facts, not model reasoning.

Serialize mutations and agent runs per conversation using a Redis lock and/or keyed queue work. Different conversations run in parallel. Locks have ownership tokens, bounded leases/renewal, fencing-safe checks where needed, recovery after worker loss, and observability. A worker never assumes an expired lock proves a previous side effect did not happen; idempotency protects retries. BullMQ/Redis are appropriate for webhook events, buffering/delayed outbound messages, attachment processing, scheduled goals, long jobs, retries, and dead-letter queues—not ordinary synchronous database reads/writes.

## Attachments and multimodal inputs

Never keep a webhook request open for media work. The attachment pipeline records `RECEIVED`, `DOWNLOADING`, `PROCESSING`, `READY`, or `FAILED`, validates type/size/source, downloads safely, stores approved objects in business-prefixed S3/R2-compatible storage, records safe metadata/content hashes, and emits safe progress. Use signed URLs internally; no public buckets or client-visible provider credentials. Define retention/deletion and malware/scanning policy appropriate to deployment.

Use a `VisionProvider` for images. A vision-capable primary model may be selected; otherwise route through a configured vision provider and cache safe extracted results by content hash/policy so an image is not reprocessed needlessly. Supported image-use cases include customer screenshots, product photos, payment receipts, damaged-product photos, and documents rendered as images; downstream action/policy still determines whether an image can support a sensitive claim or side effect. Use `AudioTranscriptionProvider`, with `ElevenLabsAdapter` the initial planned adapter, for voice messages. The runtime receives normalized text/transcript plus approved metadata and source references; it never imports ElevenLabs directly. TTS is optional later. Documents and useful video metadata follow the same asynchronous pipeline.

## Browser and web access

Expose tools such as `web_search`, `read_url`, `browser_open`, `browser_click`, `browser_type`, `browser_extract`, `browser_screenshot`, and `browser_close` behind a browser execution abstraction. Browser Use and Playwright are replaceable implementations, not runtime dependencies. Browser sessions are isolated by business and run, timeout/cancellable, domain-policy constrained, auditable, and eventually executed in a dedicated worker/container. Apply URL allow/deny lists, download/upload controls, credential-vault references, redaction, screenshot safeguards, result limits, and defenses against web-page prompt injection. Secrets and raw credentials never enter model messages, logs, screenshots exposed to clients, or realtime payloads.

## Credentials, integrations, and secrets

Use a generalized business-scoped credential/secret model for Meta, model providers, ElevenLabs, courier/client APIs, browser logins, and search providers. Store encrypted ciphertext with key/version metadata or a managed secret-store reference; decrypt only server-side immediately before use; enforce module-specific access; redact values from logs, traces, errors, browser activity, and websocket streams. Channel connections track opaque secret references, granted capabilities, health, webhook state, and state such as `DISCONNECTED`, `CONNECTED`, `NEEDS_REAUTHORIZATION`, and `ERROR`.

Credential entry is write-only. A user may see safe presence/last-updated/verification status and intentionally replace or revoke a secret, but never retrieve its stored value through an API or UI. Connection onboarding may use OAuth or authorized manual credential entry; both produce the same encrypted credential references and verification/audit trail.

## Realtime protocol and observability

Realtime uses authenticated WebSockets for both dashboards. A canonical envelope has `id`, `schemaVersion`, `type`, `occurredAt`, `sequence` where ordered, `businessId` internally, optional `conversationId`, `runId`, `traceId`, and a safe typed payload. Event families include conversation updates; run/context/tool/browser/attachment/action lifecycle; buffering/processing; handoff; and message delivery. Client-facing projection is stricter than agency/internal projection.

Support authenticated handshake, server-authorized topic subscription, heartbeats, stale connection cleanup, rate limits, reconnect with cursor/sequence, bounded replay from persisted events, and a future Redis fan-out adapter for multi-instance deployment. Show activity such as “Checking inventory” or “Navigating to order page,” never raw prompts, provider payloads, hidden reasoning, credentials, unsafe inputs/outputs, or private security details.

Activity projection is audience-aware. Agency viewers can see detailed safe milestones—batch formation, context source counts, tool/browser/attachment status, channel activity, action/delivery outcome, and typed failure category. Client viewers see a simplified useful story—such as “Agent received 3 messages,” “Checking inventory,” “Transcribing voice message,” “Preparing response,” or “Reply sent.” Both projections apply field-level redaction before persistence/replay as well as before live publish; neither may expose hidden reasoning, prompts, access tokens, authorization headers, raw provider payloads, credentials, or unsafe tool input/output.

Persist `AgentRun`, safe `AgentStep`, `ToolCall`, `BrowserRun`, `Action`, error, latency, and usage/cost records with trace IDs. Record observable facts such as context loaded, model/tool requested, tool completed, and action executed—not chain-of-thought. Track internal cost by business, agent, conversation, run, provider/model, tool, and browser use.

## Handoffs, states, notifications, and lifecycle

Conversation ownership is explicit: `AI_ACTIVE`, `HANDOFF_REQUESTED`, `HUMAN_ACTIVE`, `PAUSED`, `RESOLVED` (equivalent names are acceptable if semantics are preserved). `request_human` creates a business-scoped handoff with reason, priority, safe summary, channel/external reference, assignment, acknowledgement, timestamps, and audit trail. When a human takes ownership, automation stops unless policy explicitly permits it. Resolving a handoff does not resume AI silently; an authorized user or policy explicitly resumes it. Detect stale handoffs and notify appropriately.

Notifications are domain events with an initial in-dashboard delivery path and future email/channel adapters. Cover handoffs, agent failures, disconnected channels, expiring authorization, and critical integration faults.

Handoff notifications carry business, handoff, conversation, priority/severity, acknowledgement state, created/updated time, and a stable dedupe key. New/urgent handoffs trigger authorized realtime dashboard notification and browser notification when the user has granted it; email is a later delivery adapter. Repeated lifecycle events update the existing notification rather than spamming duplicates. Read/acknowledged state is user-scoped and does not resolve the handoff itself.

Business lifecycle includes `TRIAL`, `ACTIVE`, `PAUSED`, `EXPIRED`, and `CANCELLED`, with `trialStartedAt`, `trialEndsAt`, and agency override/configuration. The initial offer can be one month unlimited/no setup/no commitment; record usage internally and use transparent emergency abuse controls. Expiry behavior is agency-configurable and does not delete data automatically.

## API, database, audit, security, operations

HTTP APIs live under `/api/...`, validate input/output boundaries with Zod, use a documented standard error envelope (`code`, safe `message`, `requestId`, safe field details), use cursor pagination, ISO timestamps, and require idempotency keys for side-effect endpoints. Routes stay thin; domain modules own business logic. Version only externally consumed APIs when incompatible change is unavoidable.

Conversation search is a tenant-scoped, authorized query capability rather than a dashboard-only full-text scan. It supports indexed lookup/filter by customer name, verified phone, order ID, conversation ID, message text, tags, channel, business, handoff state, date range, unread state, and agent. Results are cursor-paginated, scope-checked, relevance/time ordered as appropriate, and respect retention/redaction. Search by phone/order uses normalized controlled fields; no cross-business/global customer search is permitted.

PostgreSQL/Drizzle schema changes use new, reviewed migrations; never edit an applied historical migration casually. Use tenant-scoped indexes, foreign keys, transactions around state transitions/outbox-like side effects when needed, `createdAt`/`updatedAt`, and soft deletion only where recovery or retention requires it. Keep idempotency and raw-event processing state durable.

Audit meaningful admin/client actions (actor, business, action, target, time, safe metadata): publishing/rollback, permissions, knowledge deletion, invitations/roles, handoff decisions, channel and credential changes, feature flags. Audit records are append-only in normal operation and never include secrets.

Use development, staging, and production with separate databases, storage, secrets, and channel applications/connections where possible. Staging must not message production customers. Plan backups/restores for PostgreSQL and required object storage, migration safety, health/readiness checks, structured redacted logs, dead-letter/replay visibility, provider status, queue depth, worker/browser health, realtime connection count, latency, and error rates.

## Dashboards and UI

Both `apps/admin` and `apps/client` use Next.js and Mantine. Prefer Mantine layout, form, table, modal, drawer, notification, and theme primitives; create custom components only for genuinely domain-specific views such as conversation timelines and runtime traces. Support dark and light modes using Mantine theming. Use a restrained black/white/minimal operational visual language; avoid gratuitous gradients, generic AI decoration, and duplicate button/input/modal/card systems.

The internal agency dashboard can expose technical operations (business onboarding, agents/versions/playground, integrations, tools, traces, failures, queues, usage, health, audit, feature flags). Each business workspace should organize Business Profile, Agent Configuration, Facebook Pages, Website Agent, Knowledge, Custom Tools, Integrations, Customers, Conversations, Memories, Handoffs, Analytics, Team, and Settings. Business profile data is structured (identity/description, tone, languages, hours, contact/location/delivery data, return/refund/order/escalation rules, brand instructions, common questions) and is assembled into bounded policy/context sections; it is not a single giant system prompt. Knowledge sources remain separate, attributed, and lifecycle-managed.

The client dashboard exposes only its business’s operational view (overview, performance, conversations, needs attention/handoffs, customers/orders, agent activity, comments, knowledge/team/settings) and safe realtime projections. Both applications provide scoped conversation search and clear realtime counters for unread conversations, unresolved handoffs, failed agent runs, and urgent issues. Counters have defined query semantics, avoid double-counting/replay duplicates, update through safe realtime events, and link to the filtered operational list. Both applications require deliberate empty, loading, success, error, verification-progress, connection-health, status-badge, and retry/recovery states—not only happy-path tables. Use Mantine status, alert, stepper, notification, skeleton, and empty-state patterns before creating custom equivalents.

## Capabilities, feature flags, retention, and evaluations

Channel connections publish capabilities (for example `canSendText`, `canSendImage`, `canSendFile`, `canReact`, `canReplyToMessage`, `canReplyToComment`, `canHideComment`, `canDeleteComment`, `canMarkSeen`, `canShowTyping`, `canOpenExternalConversation`, and supported edit/delete semantics). Actions must be checked against capabilities at execution time. Feature flags may be global or business-scoped for features such as browser, comment AI, advanced memory, model/runtime versions, and experimental tools; they are audited.

Configure retention/deletion per business for conversations, raw events, traces, browser screenshots, files, audio/transcripts, analysis outputs, and logs. Provide offboarding/deletion workflows and do not retain unnecessary sensitive data indefinitely.

Maintain deterministic fake providers/adapters and a future regression suite for published agent versions. Test scenarios include price/product questions, multi-message bursts, image/audio inputs, returns/refunds, upset customers, ambiguity, browser lookup, handoff, provider/tool failure, timeout, authorization, and idempotency.

## Completion notes

After a phase is implemented, create `docs/completion/phaseN.md`. It must list what was built, modules/files created, public contracts, schema/migrations, important decisions, tests/validation, known limitations, and deviations from the corresponding plan. The next phase must read it before code changes. Do not create completion notes during planning-only work.
