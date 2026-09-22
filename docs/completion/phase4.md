# Phase 4 Completion — Knowledge, Business Tools, Browser, Attachments, and Advanced Context

## Status and boundaries

Phase 4 supplies the typed domain services, tenant-scoped PostgreSQL stores, dashboard operations, safe provider boundaries, and deterministic adapters in `plan4.md`. The single `AgentRuntime` remains channel independent and the Phase 1–3 agent version, action, authorization, handoff, realtime, and fake Web Chat contracts remain compatible. No production channel adapter, Meta integration, queue, browser worker, scheduled goal executor, TTS, payment flow, or Phase 5 topology was added.

## Modules and public contracts

| Area | Files | Main contracts |
| --- | --- | --- |
| Knowledge | `packages/knowledge/src/index.ts`, `packages/phase4-operations/src/index.ts` | `KnowledgeSource`, `KnowledgeParser`, `KnowledgeRetriever`, `KnowledgeService`, `PostgresKnowledgeRetriever`, `createKnowledgeTools` |
| Commerce | `packages/commerce/src/index.ts`, `packages/phase4-operations/src/orders.ts` | `CommerceAdapter`, `FakeCommerceAdapter`, `OrderPolicy`, `PendingOrder`, `Order`, `OrderItemSnapshot`, `ProductReference`, `OrderService`, `PostgresOrderRepository`, `createCommerceTools` |
| Custom integrations | `packages/integrations/src/index.ts`, `packages/phase4-operations/src/tool-intents.ts` | `CustomToolDefinition`, `CustomToolCatalog`, `CredentialVault`, `SafeHttpTransport`, `PinnedHttpsTransport`, `CustomToolIntentStore`, `PostgresCustomToolIntentStore` |
| Web and browser | `packages/web/src/index.ts`, `packages/phase4-operations/src/browser.ts` | `SearchProvider`, `UrlReader`, `BrowserExecutionService`, `BrowserAdapter`, `BrowserCoordinator`, `BrowserPersistence`, `PostgresBrowserRepository`, `createWebTools` |
| Attachments | `packages/attachments/src/index.ts`, `packages/phase4-operations/src/attachments.ts` | `AttachmentService`, `AttachmentPersistence`, `ObjectStorage`, `S3CompatibleObjectStorage`, `VisionProvider`, `AudioTranscriptionProvider`, `ElevenLabsAdapter`, `PostgresAttachmentRepository` |
| Context and goals | `packages/context/src/advanced.ts`, `packages/goals/src/index.ts`, `packages/memory/src/index.ts`, `packages/phase4-operations/src/index.ts` | `AdvancedContextSource`, `PendingOrderContextReader`, `GoalContextReader`, `GoalService`, `PostgresGoalContextReader`, memory provenance/deduplication |
| Apps and API | `apps/admin`, `apps/client`, `apps/api/src/phase4.ts` | Mantine operational views and server actions, `Phase4Api`, additive route catalog/capability mapping |

`packages/agents` adds versioned knowledge/browser policy fields. `packages/auth` adds explicit Phase 4 capability grants; every dashboard action derives business scope from the authenticated membership and checks it again in the operation. `packages/realtime` adds compatible high-level knowledge, browser, attachment, order, and goal events; the client projector emits allow-listed status facts only.

## Knowledge and retrieval

PDF and DOCX extraction uses `pdf-parse` and `mammoth`; text, FAQ, manual notes, policies, catalogs, CSV, and supplied URL snapshots use bounded text parsing. Live/API descriptors store a safe HTTPS reference and are not indexed as factual content. Ingestion records source status, version, checksum, size, error code, enablement, and retention. Replacement creates a new version; PostgreSQL retrieval selects only the current `READY`, enabled, unexpired version. Failed sources cannot be re-enabled as current. Deletion retains a source tombstone and audit while removing indexed chunks.

`PostgresKnowledgeRetriever` uses a GIN-backed PostgreSQL `to_tsvector('simple', content)` index, ranked full-text search, business/type/source filters, and source/chunk/version attribution. The retriever interface allows a later index implementation without changing tools or runtime. `search_knowledge`, `get_policy`, and `search_faq` are typed read tools. Stock, inventory, live price, and order-state queries are excluded from stale retrieval paths; live commerce tools are the authority. Source text enters context as bounded, explicitly untrusted excerpts.

Agency and client Mantine views show source type/status, version, errors, timestamps, size, retention, safe excerpts, attribution IDs, and authorized add/replace/reprocess/disable/delete flows. URL snapshots are supplied content; there is no background crawler. Replacement/reprocessing requires a new upload or text input because raw source bytes are not retained by the knowledge store.

## Business tools and orders

The commerce tools cover product search/details, inventory, delivery fee, order creation/read/update/cancel, customer read/update, previous orders, and customer notes. `FakeCommerceAdapter` gives deterministic live stock/price behavior where no business integration is configured. Tool registry safety classes, Zod input/output, capabilities, allowed agent versions, human approval, trusted context, cancellation, redaction, and safe tool results remain in force.

`OrderService` supports policy-owned checkout fields, required variants, payment/delivery methods, multi-message and multi-item collection, item/variant/quantity replacement, ambiguity confirmation, inventory recheck at confirmation and creation, expiry, cancellation, human takeover/resume, and status transitions. Each order contains immutable item snapshots and channel/message/agent/run provenance. Concurrent creation attempts for one pending order reconcile to one result; customer notification has its own `PENDING`/`FAILED`/`SENT` state so a failed send retries notification only.

`PostgresOrderRepository` stores scoped pending state and history, atomically commits confirmed orders with item snapshots and unique pending/order intents, reconciles duplicate intent keys, and tracks notification outcome. Client Orders has tenant-scoped filters, policy controls, status/note actions and audit-backed updates; agency views inspect source and snapshots. No payment capture or refund execution exists.

## Custom HTTP tools

Agency-managed definitions include type, method, HTTPS base/path, primitive input/output schema, output mapping, timeout/size limits, exact allowed hosts, safe headers, write-only credential reference, required grants, allowed agents, safety class, enablement, and test state. Persisted definitions can be loaded into `CustomToolCatalog` after tenant validation. Credential values live behind `CredentialVault`, never in definitions or model context.

`PinnedHttpsTransport` validates public DNS answers and pins the chosen address for the HTTPS socket. It rejects localhost/private targets, IP literals, unapproved hosts, redirects, and oversized responses. Definitions reject query-string credentials, secret-bearing schema/path names, and unsafe headers. Write intents are reserved in `custom_tool_intents`; successful validated results are reused, while uncertain HTTP outcomes become `UNKNOWN` and are never automatically resent. Read-only `GET` tools may be safely tested; write tests require the normal approval path. Safe audit records do not contain credentials, request bodies, or provider internals.

## Browser and attachments

`SearchProvider`, `UrlReader`, and `BrowserExecutionService` are replaceable interfaces. The eight web/browser tools use the existing registry. `BrowserCoordinator` isolates business/run/owner/profile, enforces allowed/denied domains, timeout, cancellation, action and egress limits, and returns bounded untrusted page data. Screenshots return an opaque ID and never enter client activity. `PostgresBrowserRepository` stores safe origin-only activity/session facts; a browser adapter owns the live profile. No Playwright worker or browser queue was created.

`AttachmentService` follows `RECEIVED -> DOWNLOADING -> PROCESSING -> READY/FAILED`, with safe retry from failure. It checks source authority, MIME/size/signature, SHA-256 hash, business-prefixed private object key, retention, and server-controlled short-lived signed inspection URLs. Derived image descriptions, transcripts, and document text carry source/version/provider/confidence metadata and are cached by content hash and policy version. Vision can fall back from a primary model to the configured provider. `ElevenLabsAdapter` is an audio transcription adapter only; no ElevenLabs dependency enters `AgentRuntime`. `PostgresAttachmentRepository` persists lifecycle and derived artifacts and supports tenant-scoped recovery after process restart. Realtime carries IDs and status, not derived text or raw media.

## Context, memory, goals, and retention

`AdvancedContextSource` adds active pending order, pending goals, attributed knowledge, and approved attachment derivatives to the existing canonical bounded context loader. Reader contracts allow PostgreSQL pending orders/goals; attachment derivatives can be recovered from persistence. The context engine still records inclusion/exclusion/provenance and keeps the recent window bounded. Memory now supports confidence, source kind/reference, deduplication, expiry, supersession, manual notes, and raw-source navigation while retaining source messages.

Goals retain business/customer/conversation/creator, trigger type and data, expiry, state, and idempotency. PostgreSQL operations can mark, list, lazily expire, and resolve them. Time/inventory/event triggers are stored only; executing them is Phase 5 work. Knowledge retention dates exclude expired sources from retrieval. Attachment retention blocks processing and signed inspection after expiry; explicit deletion removes private objects and derived records. Browser sessions expire by policy. Order snapshots and audits have no automatic deletion in Phase 4; business retention policy must govern later archival.

## Schema and migrations

Additive migrations are `0003_round_korath.sql`, `0004_cloudy_archangel.sql`, and `0005_medical_marvex.sql`. They add tenant-indexed knowledge/chunks, attachments/artifacts, browser sessions/runs, custom tools/credential references/write intents, order policies/pending orders/orders/item snapshots/intents/audits/notes, customer notes, and the supporting indexes. Migrations `0000_fixed_maelstrom.sql`, `0001_tricky_dracula.sql`, and `0002_dark_tomorrow_man.sql` were not edited. Fresh migration generation sees 51 tables and no drift after `0005`.

## Validation

- `bun run check`: strict TypeScript and 61 tests passed, 350 expectations. This includes Phase 1–3 runtime, tenancy, handoff, realtime, dashboard, and fake Web Chat regressions.
- `bun run db:generate`: 51 tables, no further schema change after `0005`.
- `bun run db:migrate` on a fresh isolated PostgreSQL database: all migrations applied successfully.
- `bun run db:phase4-smoke` on that database: passed source filtering/versioning/deletion, live descriptors, tenant isolation, pending order and order-intent persistence, notification state, policy/status/note idempotency, custom tool configuration/write intents, attachment artifact recovery/deletion, and durable goals.
- `bun run admin:build` and `bun run client:build`: production builds passed.

Focused tests cover stale-versus-live knowledge, order ambiguity/variant changes/multiple items/confirmation/recheck/notification retry, host/secret policy and uncertain write suppression, browser scope/cancellation/egress/prompt injection and safe activity, attachment type/hash/cache/fallback/transcription/failure retry, and bounded context provenance. The temporary PostgreSQL instance used only for validation is not an application dependency.

## Limitations and deviations

- Real commerce clients, external search, a production browser adapter, a private S3/R2 client, deployment credential vault, and live media transport remain adapter configuration points. Deterministic fake adapters exercise their contracts. A deployment must compose the PostgreSQL repositories with those adapters and the existing runtime; the framework-neutral `Phase4Api` is not a new standalone HTTP server.
- PostgreSQL full-text is the initial knowledge index. CSV handling is text-oriented; complex quoted CSV and OCR are not implemented. Web snapshots require supplied content, and live descriptors require a separately approved live tool. No embeddings or vector index were introduced.
- Browser download/upload policy flags are defined, but the fake adapter has no download/upload actions. Browser execution is in-process; the worker topology, durable scheduling, and replay belong to Phase 5.
- A custom HTTP write with `UNKNOWN` outcome requires explicit operator reconciliation. Automatic retry is intentionally blocked to prevent duplicate side effects.
- The repository instruction referenced a `ponytail` skill, but no such skill was installed or discoverable in this workspace. Bun was used throughout.

## Implementation commits

- `1d1b2bc` — attributed knowledge and conversational commerce
- `8d19e05` — browser, integrations, attachments, goals, and advanced context
- `48737f1` — additive knowledge and commerce schema
- `9f8cefc` — durable operations, APIs, and dashboards
- `9ea4d33` — tool, order, browser, and attachment hardening
- `f198ac9` — attachment and browser persistence boundaries
- `ec31b99` — durable context readers
- `a46660a` — persistent custom HTTP write intents
- `d932795` — persisted tool hydration
