# AgentOS — Master Implementation Roadmap

## Read this first

AgentOS is private AI automation infrastructure operated by an agency for onboarded businesses. This file defines delivery order. [`ARCHITECTURE.md`](ARCHITECTURE.md) is the permanent architecture contract and overrides a phase plan where one is less specific.

Before implementing any phase, a coding agent must:

1. Read `ARCHITECTURE.md` completely.
2. Read this master roadmap completely.
3. Read every relevant earlier `planN.md` and `docs/completion/phaseN.md` when it exists.
4. Inspect the current repository, schemas, tests, and current public contracts.
5. Preserve working module boundaries and contracts; extend them rather than replacing them for local convenience.

This repository uses Bun for package/workspace operations. This roadmap authorizes planning only; implementation phases must not be started until separately requested.

## Product and architectural outcome

AgentOS is a channel-agnostic runtime. Each external channel is represented by one unified `ChannelAdapter`:

```text
Channel <-> ChannelAdapter -> Universal Event -> Event Router
        -> Specialized Processor -> AgentOS Runtime -> Universal Actions
        -> Channel Registry -> ChannelAdapter.execute()
```

The same runtime will eventually serve Website Chat, Facebook Messenger and comments, Instagram, Telegram, WhatsApp, and future channels. No phase may make the runtime Facebook-specific or create a second runtime for a channel. The initial production channel implementation is **only** `FacebookMessengerAdapter`; future adapters are contract targets, not simultaneous scope.

The project is a TypeScript modular monolith in one Bun-managed monorepo: Node.js-compatible backend processes, Next.js + Mantine dashboards, PostgreSQL/Drizzle, Zod, and Redis/BullMQ only where durable asynchronous execution, locking, delayed delivery, or fan-out is genuinely needed. Do not redesign it as microservices.

## Delivery sequence

| Phase | Plan | Outcome | Must remain deferred |
| --- | --- | --- | --- |
| 1 | `plan1.md` | Channel-independent runtime foundation, tenant/auth-ready contracts, context/memory/actions/tools, tracing and safe realtime protocol | Channels, UI products, queues, Meta |
| 2 | `plan2.md` | Internal agency dashboard, authentication/RBAC foundation, structured business setup, agent configuration/versioning, memory inspection, and playground | Client dashboard, website SDK, external channels |
| 3 | `plan3.md` | Client dashboard, authenticated realtime, handoff ownership, and WebChatAdapter contract/test surface (not a production channel) | Production Web Chat, Meta, browser, rich knowledge/attachments |
| 4 | `plan4.md` | Multi-source knowledge, conversational orders and commerce tools, dashboard-configured business/custom tools, browser/search, multimodal attachment pipeline, advanced context | High-volume processor infrastructure, Meta |
| 5 | `plan5.md` | Universal event path, registry/presence lifecycle, BullMQ work, buffering, serialization, retry/idempotency, schedules/background jobs | Production channel adapter and comment automation |
| 6 | `plan6.md` | First production `FacebookMessengerAdapter`: OAuth/manual Page setup, gated verification/test flow, secure Meta credentials, plus a real Browser Use-backed browser adapter for existing web tools | All other production channel adapters, comment policy/replies, final hardening |
| 7 | `plan7.md` | Comment Processing Unit, real Web Chat adapter, self-hosted open-source Browser Use AI browser agent replacing the Phase 6 custom CDP production path, configurable OpenAI SDK/compatible model and ElevenLabs providers, analytics, trial lifecycle, production hardening/evaluation | Instagram/Telegram/WhatsApp and incremental later features |

Cross-cutting foundations may appear earlier when later work needs a stable contract. For example, Phase 1 establishes trusted tenant context and realtime envelopes; Phase 2 implements full agency authentication/configuration UX; Phase 3 extends access to business users. Earlier contracts are not permission to build later product features prematurely.

Phase 6's completion note records a custom isolated CDP/Chromium browser implementation and incomplete live Meta/full browser verification, despite the earlier Browser Use intent in `plan6.md`. Phase 7 explicitly replaces that production browser path with the self-hosted open-source `browser-use/browser-use` AI browser agent, completes those verification gates, and activates real Web Chat. Treat `plan6.md` as historical phase scope, its completion note as delivered evidence, and `plan7.md` as the current cutover requirement.

## Global invariants every phase must preserve

- Business/tenant isolation is mandatory in database queries, events, cache/queue keys, attachments, credentials, traces, realtime, and UI/API authorization. The model never selects a `businessId` or arbitrary customer identity.
- Users authenticate server-side. Agency and client memberships are separate scopes; authorization never derives from a client-provided business ID. WebSocket subscriptions are server-authorized.
- Agent configurations are immutable version snapshots (`DRAFT`, `TEST`, `PUBLISHED`, `ARCHIVED`); live behavior changes only on explicit publish or audited rollback.
- AgentOS consumes Universal Events and emits channel-independent Universal Actions. Channel Registry routing and adapters handle channel APIs/capabilities; channel-specific communication methods are never model tools.
- Context is layered and budgeted, with searchable source history, pins, summaries, provenance, memory lifecycle, and pending goals. It is never the entire raw chat transcript by default.
- Rapid messages are persisted individually but may be batched into one ordered run. New input during a run is checked before final dispatch so the platform avoids stale/out-of-order replies.
- `ResponseTimingPolicy` and `PresenceController` provide bounded, queue-aware conversation pacing: seen starts only when actual processing begins, typing primarily begins at final response composition, and both are capability-driven adapter infrastructure rather than Facebook-specific runtime logic or model tools.
- Phase 1 initializes Git and commits the planning baseline when the project is not already a repository. Every phase thereafter automatically creates small, relevant, validated commits under the repository-hygiene rules in `ARCHITECTURE.md`; agents do not ask for confirmation, but must preserve unrelated working-tree changes and never push remotely unless separately asked.
- Temporary operational announcements enter only relevant active context; identity matching, search, notifications, and dashboard counters remain tenant-scoped, auditable, and replay-safe.
- Tools receive trusted execution context and enforce `READ`/`WRITE`/`SENSITIVE`/`DESTRUCTIVE` policy. All consequential effects are idempotent.
- Secrets and credentials are encrypted/referenced server-side and redacted from model context, logs, dashboard streams, browser activity, and browser clients.
- Realtime shows observable activity, never hidden reasoning, prompts, secrets, or unsafe raw provider data.
- Existing migrations are never casually edited; new database changes use new migrations. Do not install, scaffold, or implement unrelated architecture while executing a phase.

## Required planning sections

Every phase plan contains and implementation agents must honor:

- **Before implementing this phase** reading instructions.
- **Inherited From Previous Phases** and public contracts that may not be casually changed.
- **New Contracts Introduced In This Phase**.
- bounded implementation scope, database/API/UI work, validation, and security considerations.
- **Do Not Build Yet**, **Deferred To Later Phases**, and **Definition of Done**.
- an implementation completion-note requirement at `docs/completion/phaseN.md`.

## Long-term target capabilities

The delivered system incrementally gains: agency/client RBAC, onboarding, agent versioning and evaluations; the Messenger reference adapter and then compatible future channel adapters; human ownership/handoffs; attachment/vision/audio abstractions; knowledge and business data tools; browser isolation; typed universal events and comment processing; scheduled customer goals; safe realtime operational visibility; feature flags; costs/usage; audit, retention, backups, health, and trial lifecycle controls.

Future work such as Instagram, Telegram, WhatsApp, TTS, richer commerce integrations, A/B version rollout, and richer analytics must be added as compatible adapters/modules. Do not treat Phase 7 as permission to rewrite the runtime.

## Completion-note convention

After a phase actually ships, its implementer writes `docs/completion/phaseN.md` with built modules/files, public contracts, schema changes/migrations, decisions, tests, limitations, and deviations. Planning work does not create these files. A later agent must treat the note as factual implementation context and reconcile it with the plan before modifying code.
