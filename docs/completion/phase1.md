# Phase 1 Completion — AgentOS Core

## Status

Phase 1 is complete. The repository now contains a Bun-managed, Node.js-compatible TypeScript modular monolith foundation. It runs a server-authorized normalized event through one channel-independent runtime using deterministic model and in-memory infrastructure in tests. No Phase 2 work or production channel implementation was started.

## What was built

- A bounded `AgentRuntime` orchestration loop that resolves an active or explicitly selected test agent version, builds budgeted context, calls a replaceable model, validates and policy-checks tool calls, validates structured actions, applies internal state actions behind an idempotency boundary, records safe trace facts, and emits safe ordered realtime events.
- Trusted business context, principal, role/capability, session-authentication, trusted-context authorization, and realtime-scope authorization contracts.
- Stable `Agent` identity and immutable `AgentVersion` snapshot contracts with `DRAFT`, `TEST`, `PUBLISHED`, and `ARCHIVED` states, explicit active-version selection, and audited publish/rollback-compatible selection semantics.
- Generic `AgentEvent` schemas for `message.received` and `system.trigger` with ULIDs, versioning, tenant scope, generic channel identity, occurrence time, dedupe data, and redacted safe source metadata.
- Separate universal channel and domain action unions. Universal channel actions are persisted as deferred because Phase 1 has no production adapter. Domain actions support handoff, memory, pin, and pending-goal state.
- Contract-only `ChannelAdapter`, `ChannelRegistry`, `ChannelCapabilities`, and `PresenceController`, including capability-driven seen/typing lifecycle semantics. No adapter implementation or channel SDK was added.
- Vendor-neutral `ModelProvider` and deterministic scripted `FakeModelProvider`, including safe typed error/usage metadata. No paid or remote model is called.
- Typed `AgentTool`, `ToolRegistry`, safety classes, policy outcomes, schema validation, trusted execution context, capability checks, and input/output redaction. Proof tools cover memory search, conversation search, pinning, human handoff, and deterministic read-only lookup.
- Bounded layered context with the canonical order, source provenance, token estimates, excluded-item provenance, recent-message windows, active announcements, memories, summaries, pins, pending goals, safe tool results, and the current event.
- Memory creation, expiry filtering, and immutable supersession; in-memory conversation state for deterministic tests; foundational handoff and pending-goal application.
- Safe trace/run/tool/action repositories, action idempotency, an in-memory realtime bus, a replaceable Redis transport wrapper, audience-safe redaction, ordered replay, subscription authorization, heartbeat/staleness settings, and `/ws` client/server message contracts.
- A small API boundary for `/api/runs/test` that treats a requested `businessId` only as an authorization candidate and constructs execution from a server-authorized `TrustedBusinessContext`.
- Standard API path/error/cursor primitives and environment/configuration baselines.

## Modules and important files

- `apps/api/src/index.ts` — server-authorized test-run and API/WS path contracts.
- `packages/agent-runtime` — the single channel-independent runtime.
- `packages/agents` — agent/version configuration, limits, publishing semantics, and services.
- `packages/auth` — Better Auth factory, principals, role capabilities, and authorization interfaces.
- `packages/events` — versioned normalized internal events.
- `packages/actions` — universal/domain actions and idempotent executor.
- `packages/channels` — contract-only adapter, capabilities, registry, and presence controller.
- `packages/context`, `packages/memory`, `packages/conversations` — bounded context and state contracts/services.
- `packages/models`, `packages/tools` — model abstraction, fake provider, tool contracts, policy, and proof tools.
- `packages/realtime`, `packages/trace` — safe realtime protocol and observable trace contracts.
- `packages/persistence` — tenant-checking in-memory repositories used by deterministic tests.
- `packages/database` — Drizzle PostgreSQL schema and generated migration.
- `packages/shared` — ULID/ISO/JSON schemas, trusted context, safe errors, and recursive redaction.
- `tests` — unit, integration, contract, authorization, and security coverage.

## Public contracts introduced

- `TrustedBusinessContext`, `AuthenticatedPrincipal`, `SessionAuthenticator`, `TrustedContextAuthorizer`, and `RealtimeScopeAuthorizer`.
- `AgentEvent` and `agentEventSchema` (`schemaVersion: "1.0"`).
- `AgentRuntime.run(AgentRunInput): Promise<AgentRunResult>`.
- `AgentAction`, `UniversalChannelAction`, `DomainAction`, their Zod schemas, `ActionRepository`, and `IdempotentActionExecutor`.
- `ChannelAdapter`, `ChannelRegistry`, `ChannelCapabilities`, `PresenceController`, and presence lifecycle types.
- `Agent`, `AgentVersion`, `AgentVersionConfig`, `AgentVersionRepository`, and `AgentVersionService`.
- `ModelProvider`, `ModelRequest`, `ModelResponse`, and `FakeModelProvider`.
- `AgentTool`, `ToolRegistry`, `ToolExecutionContext`, `ToolPolicyEvaluator`, and proof-tool service ports.
- `ContextEngine`, `ContextSource`, `ContextBundle`, and context provenance schemas.
- `MemoryService` and `MemoryRepository`.
- `TraceRepository`, safe run/step/tool-call records, `RealtimeBus`, `RealtimeEnvelope` (`schemaVersion: "1.0"), `RealtimeProtocol`, and WS message schemas.
- Standard API error envelope, cursor-page helper, and `/api/runs/test` request contract.

## Database schema and migration

Generated migration: `packages/database/migrations/0000_fixed_maelstrom.sql` with Drizzle snapshot metadata.

It creates 26 tables: Better Auth account/session/user/verification storage; businesses and agency/business memberships; agents and versions; customers, channel-generic identities, and identity-link decisions; conversations, messages, summaries, pins, memories, pending goals, and announcements; agent runs, steps, tool calls, actions, handoffs, realtime events, and audit logs.

Tenant-owned tables carry `business_id`. The migration includes tenant-leading lookup indexes, lifecycle timestamps, foreign keys, monotonic message sequence uniqueness, immutable version-number uniqueness, and business-scoped idempotency constraints for actions, pending goals, and handoffs. The migration was generated and checked for schema drift but was not applied because no Phase 1 PostgreSQL instance or `DATABASE_URL` was supplied.

## Authentication and provider configuration

Better Auth is configured once through the PostgreSQL Drizzle adapter with the explicit Drizzle `user`, `session`, `account`, and `verification` tables. Email/password is enabled, email verification is not yet required, sessions expire after seven days and refresh daily, cookie caching is disabled, and secure cookies are enabled when the configured base URL uses HTTPS. MFA, OAuth/passkeys, invitation flows, and UI are deferred as planned. Disabled-account rejection exists at the API and realtime protocol boundaries.

The only model adapter is `FakeModelProvider`, intentionally deterministic and remote-free. Primary/fallback/vision references exist in version configuration; fallback routing and vision execution remain deferred.

## Important decisions

- The runtime does not import `packages/channels`; it accepts a structural lifecycle observer. This keeps presence lifecycle integration possible without creating a channel dependency in the runtime core.
- Universal channel actions are validated and idempotently recorded as `DEFERRED`. Channel execution belongs to later registry/adapter integration phases.
- Raw prompts, model payloads, and model reasoning are not trace fields. Traces contain only bounded observable facts and already-redacted tool projections.
- In-memory repositories are first-class deterministic test adapters. PostgreSQL production repositories remain a later implementation slice; the durable schema is established now.
- Redis realtime support is a replaceable transport wrapper only. No Redis server, queue, lock, or BullMQ dependency was introduced.

## Tests and validation

Final validation commands:

- `bun run db:generate` — 26 tables detected; no schema drift and no new migration required.
- `bun run check` — TypeScript strict typecheck passed; 17 tests passed with 59 assertions.

Coverage includes canonical context order/budget/provenance, bounded recent history, memory expiry/supersession, immutable version snapshots and explicit publishing, role capabilities, tool schema/policy/capability/redaction behavior, action idempotency, deterministic multi-step model/tool execution, persisted traces/state actions, safe ordered realtime replay, disabled/unauthorized subscriptions, runtime cancellation and limits, typed provider errors, server-authorized test runs, cross-business rejection, versioned serializable contracts, and a static assertion that the runtime has no channel/provider-specific imports.

## Known limitations and deferred work

- PostgreSQL repositories and a live migration/application smoke test are not included; tests use tenant-checking in-memory adapters.
- `/ws` is a protocol/service contract rather than a listening network server. Authenticated handshake wiring, connection management, and production Redis fan-out are completed with dashboard/realtime phases.
- No production model provider, fallback router, vision execution, production channel adapter, channel action dispatch, queue, lock, webhook, attachment pipeline, browser/search, knowledge ingestion, dashboard, or commerce feature exists.
- Presence is exercised through a lifecycle observer contract; full processor/registry lifecycle integration is Phase 5.
- Full Better Auth route/UI flows, invitations, password reset, session administration, and membership management are deferred to Phase 2/3.
- `RequestHuman` creates foundational in-memory state only; operational handoff ownership and notifications are later phases.

## Deviations

- The repository instruction requested the `ponytail` skill, but that skill was not present in the available skill catalog for this session. Implementation proceeded using `ARCHITECTURE.md`, `plan.md`, and `plan1.md`; no substitute skill behavior was invented.
- No product/architecture scope deviation from `plan1.md` was made.

## Commits

- `6b792a4 feat(phase1): establish AgentOS core foundation`
- `3e4050e test(phase1): verify runtime safety and tenancy`
- The completion note is committed separately as the final Phase 1 documentation slice.
