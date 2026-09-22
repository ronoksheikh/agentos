# Phase 1 — AgentOS Core (No Channels)

## Before implementing this phase

1. Read `ARCHITECTURE.md` and `plan.md` completely.
2. Read this plan and inspect the repository; there are no earlier phase completion notes for this phase. If `.git` does not exist at the project root, initialize the repository now and create the initial planning-baseline commit before application implementation; this is pre-authorized and follows the repository-hygiene rules in `ARCHITECTURE.md`.
3. Record implementation facts in `docs/completion/phase1.md` only after this phase is actually completed.
4. Preserve this phase's public contracts in every later phase. Do not introduce Meta, website, or any channel-specific dependency.

## Goal

Build the channel-agnostic, tenant-ready AgentOS foundation: a bounded runtime that consumes normalized internal input, builds context, uses typed tools and replaceable models, emits structured actions, persists safe traces, and publishes safe runtime activity. It must be testable without HTTP or a real model provider.

## Inherited From Previous Phases

No implementation phase precedes this one. It inherits the permanent constraints in `ARCHITECTURE.md`: modular monolith, ULIDs, PostgreSQL/Drizzle, Zod, Bun workspace conventions, trusted tenant context, redaction, no hidden reasoning storage, and future compatibility.

## New Contracts Introduced In This Phase

Establish these as stable package/module public APIs:

- `TrustedBusinessContext`: server-created `businessId`, principal/source, optional agent/conversation/customer identity, trace ID, capability grants, and cancellation signal.
- `AgentEvent`: internal event with ULID `id`, `schemaVersion`, semantic `type` (`message.received` and `system.trigger` initially), generic `channel`, trusted scope references, `occurredAt`, dedupe/source metadata, and validated payload. It must have no Facebook-shaped fields.
- `AgentRuntime.run(input): Promise<AgentRunResult>` with run ID, selected agent version, trusted context, event, test/debug mode, validated `AgentAction[]`, status, usage/timing, and safe errors.
- `AgentAction` / `UniversalChannelAction` boundary: channel-independent actions such as `SendMessage`, `SendImage`, `SendFile`, `SendProduct`, `ReplyToMessage`, and `ReactToMessage` remain separate from domain actions such as `RequestHuman`, `Remember`, `UpdateMemory`, `PinMessage`, `UnpinMessage`, `MarkPendingAction`, and `ResolvePendingAction`. Neither calls a channel SDK or exposes a channel-specific model tool. A future comment-specific action must be added compatibly only when these generic actions cannot express the target without ambiguity.
- `ChannelAdapter`, `ChannelRegistry`, `ChannelCapabilities`, and `PresenceController` interfaces as contract-only foundations; no production adapter is built in this phase.
- `ModelProvider`, `ToolRegistry`, `AgentTool`, `ToolExecutionContext`, `ContextEngine`, `MemoryService`, `RealtimeBus`, and trace repository interfaces.
- Canonical realtime envelope with ID, schema version, type, occurred time, business/conversation/run/trace references, safe payload, and optional sequence. Initial events cover run/context/model/tool/action/memory lifecycle and failures.

Later phases may add compatible event/action variants and optional fields. They must not change the meaning of these contracts or make runtime arguments channel-specific.

## Scope

### Runtime and models

Create the clear `agent-runtime` orchestration module. The bounded loop is: load active/test agent version; build context; resolve allowed tools; call model; validate tool requests; execute allowed tools with trusted context; append safe tool results; produce validated actions; persist observable facts; apply internal state actions; emit realtime lifecycle events; complete, fail, or cancel. Enforce per-version step, tool-call, runtime, context-budget, and output limits.

Implement a vendor-neutral `ModelProvider`. A first provider adapter may be selected during implementation, but only the adapter imports its SDK. Define provider result metadata for model/provider, usage, timeout, retryability, and safe error classification. Include a deterministic `FakeModelProvider`; core tests must not call a paid remote model. Define model configuration references for primary/fallback/vision now, but defer actual fallback routing and vision execution.

### Trusted tenancy and auth-ready foundation

Introduce `Business`, `User`, agency membership, business membership, session/auth interfaces, account state, and permission primitives sufficiently to create and verify trusted context. Do not make a client-provided `businessId` authoritative. Full login/invitation UX is Phase 2/3, but all repositories and runtime entry points must require business scoping from the start.

Define agency role capabilities for `SUPER_ADMIN`, `ADMIN`, `SUPPORT`, `DEVELOPER`, and business role capabilities for `OWNER`, `ADMIN`, `STAFF`, `VIEWER`; store permissions/capabilities in a way that supports role evolution. Use the Better Auth contract defined in `ARCHITECTURE.md`; document its actual configured adapters/settings in completion notes. Account disabling and WS authentication implementation are introduced as foundations here and completed in later phase UI work.

### Agent and configuration model

Create stable `Agent` identities and immutable `AgentVersion` configuration snapshots with `DRAFT`, `TEST`, `PUBLISHED`, and `ARCHIVED` states. A version includes instructions, tone, language, model references, enabled tools/policy, context/memory policy, runtime limits, handoff policy, `ResponseTimingPolicy` and automation/AI disclosure-policy placeholders, channel behavior placeholders, feature flags, and browser/knowledge placeholders. Publishing semantics are specified now: only an explicit publish selects the active version, and rollback is an audited version selection. Build minimal persistence/services; dashboard workflow comes in Phase 2.

### Tools and action execution boundary

Define typed Zod input/output contracts, categories, safety class (`READ`, `WRITE`, `SENSITIVE`, `DESTRUCTIVE`), redaction policy, and `ALLOW`/`DENY`/`REQUIRE_HUMAN_APPROVAL` policy evaluation. Tools inherit trusted tenant, agent, conversation, customer, run, permission, and cancellation context. Initial proof tools are memory/pin/conversation search, `request_human`, and a deterministic read-only demo lookup. Do not build commerce or browser tools yet.

Persist safe tool-call facts and action records. Side-effect action execution must be behind an idempotency-aware executor even though channels are deferred. `PresenceController` is lifecycle infrastructure rather than a tool: its future mark-seen/typing calls are not model-selectable. `request_human` may create a foundational handoff record/state, but no external inbox/channel behavior is built.

### Conversations, memory, and context

Persist business-scoped customers, customer identities, identity-link candidates/decisions, conversations, messages, rolling summaries, pinned messages, memories, pending goals/actions, business announcements, and agent runs. Customer identities are channel-specific and not auto-merged. Identity linking has explicit possible/confirmed/separate states and evidence/actor/audit fields; similar names cannot create a merge. A memory has type, content, importance/confidence, source message references, creator, validity, expiry, and supersession relation. Raw messages remain searchable under authorization.

The context engine uses the canonical layered order: instructions; business/channel information; active in-scope business announcements; customer identity/memory; summary; pins; recent window; pending goals; knowledge/tool-result placeholders; current event. It returns a bounded bundle and provenance (source type/ID/label, reason, inclusion, estimated tokens). It must never concatenate all historical messages by default. Phase 2 supplies the business-announcement authoring workflow and Phase 5 the full timing/queue enforcement.

### Realtime and trace protocol

Implement an authenticated-architecture-ready `RealtimeBus` with in-memory test adapter and a replaceable Redis-backed adapter. Persist safe agent runs, steps, tool calls, actions, error/usage/latency. Expose a minimal `/ws` protocol contract for later dashboards: authenticated handshake, server-authorized subscriptions by run/conversation/business, heartbeats, safe ordered event envelope, reconnect cursor/replay design, and stale-connection cleanup. At this phase it can be exercised through API/test clients; do not build dashboard UI.

Never stream/store raw system prompts, hidden reasoning, secrets, raw provider responses, or unsafe tool data. Redaction happens before persistence intended for display and before publish.

### Database and API baseline

Use new Drizzle migrations only. Add tenant indexes, foreign keys, lifecycle timestamps, idempotency storage where required, and transaction boundaries around state changes. Minimal API endpoints may support test runs, agent/version retrieval and editing, run details, conversation messages/memory, and WS handshake; all inputs use Zod and all reads/writes authorize business scope. Standardize `/api/...`, cursor pagination convention, ISO timestamps, and safe error envelope now.

## Tests and validation

- Unit: context order/budget/provenance, memory supersession/expiry, tool schema/policy/redaction, action validation, runtime limits/cancellation, typed error mapping.
- Integration: fake model multi-step tool loop; traces and state actions persist; safe realtime ordering; failure/cancellation path; idempotency record behavior; business A cannot read/run against business B.
- Contract: runtime contains no channel imports; event/action/realtime Zod schemas are serializable and versioned; subscriptions reject unauthorized scopes.
- Security: redaction tests prove secrets and unsafe tool fields cannot enter WS events/loggable trace projection.

## Do Not Build Yet

No website SDK, Facebook/Meta, Instagram, Telegram, WhatsApp, external webhooks, browser/search, knowledge ingestion, advanced attachment processing, queues, comment classification, client dashboard, billing, or microservices.

## Deferred To Later Phases

Phase 2 supplies the full internal dashboard, operational authentication flows, agent publishing UX, and playground. Phase 3 adds a website channel and client access. Phase 4 adds knowledge, browser, commerce/custom tools, and multimodal attachments. Phase 5 introduces universal event queues/buffering/locks. Channel integrations start in Phase 6.

## Definition of Done

1. A server-authorized test event runs through the single AgentOS runtime and returns structured actions.
2. Context includes bounded conversation/memory state with inspectable safe provenance.
3. Model tool calls are schema-validated, permission-checked, scoped, redacted, and bounded.
4. Agents use immutable version snapshots and an explicit active/published selection model.
5. Runs, steps, tool calls, actions, messages, memory, pins, summaries, and pending goals are persisted with tenant scope and trace IDs.
6. Safe realtime events and persisted run detail are available to a future UI; no hidden reasoning or secrets are exposed.
7. Tests prove tenant isolation, authorization boundaries, runtime behavior, realtime authorization, and deterministic provider testing.
8. No channel-specific code or imports exist in the runtime, context, memory, model, or tool core; channel-specific messaging methods are not model tools.
9. Relevant implementation slices and the final Phase 1 completion note are committed automatically as scoped, validated Git commits; unrelated user changes remain untouched.

## Completion Note

After implementation, write `docs/completion/phase1.md` with modules/files, migrations, actual public contracts, chosen auth/provider adapters, tests, limitations, and any approved deviations. Phase 2 must read it before changing code.
