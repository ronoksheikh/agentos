# Phase 4 — Knowledge, Business Tools, Browser, Attachments, and Advanced Context

## Before implementing this phase

1. Read `ARCHITECTURE.md`, `plan.md`, and `plan1.md` through `plan3.md` completely.
2. Read all available completion notes through `docs/completion/phase3.md`.
3. Inspect current exports, database schema, policies, test adapters, and website/client behavior.
4. Extend the single runtime and its tool/context/action boundaries. Do not let a vendor SDK, browser implementation, attachment provider, or custom client API leak into `agent-runtime`.

## Goal

Make AgentOS a useful business operator while preserving safety and replaceability: source-backed knowledge, approved business/custom tools, web/search and isolated browser access, attachment processing with vision/transcription abstractions, and smarter bounded context/memory.

## Inherited From Previous Phases

- Trusted tenant/tool execution context; versioned agent configuration and tool safety policy.
- WebChatAdapter contract/fake adapter and client-safe realtime projection; client/agency authorization and handoff ownership.
- Runtime/context/memory/action/trace contracts, safe event envelope, auditing, idempotency conventions, and no-hidden-reasoning rule.

New tools must use the same registry and safety policy. New information must enter context through provenance/budget selection. Attachment processing must not block a channel request. Browsing must not turn browser credentials or web page text into trusted instructions.

## New Contracts Introduced In This Phase

- `KnowledgeSource`, ingestion job/result, retrieval result with source attribution, source lifecycle `PENDING`/`PROCESSING`/`READY`/`FAILED`.
- `Attachment` and processing lifecycle `RECEIVED`/`DOWNLOADING`/`PROCESSING`/`READY`/`FAILED`, object-reference and safe derived-artifact contracts.
- `VisionProvider` and `AudioTranscriptionProvider`; `ElevenLabsAdapter` is the first planned audio adapter, not a runtime dependency.
- `SearchProvider`, `UrlReader`, `BrowserExecutionService`, browser session/run/activity/cancellation contracts.
- Custom HTTP tool definition contract including schema, host policy, secret reference, output mapping, limits, and audit metadata.
- Context selection metadata for retrieval/tool/attachment sources, memory confidence/supersession/expiry, and persistent goals waiting for a future trigger.
- Industry-agnostic `OrderPolicy`, `PendingOrder`, `Order`, immutable `OrderItemSnapshot`, structured `ProductReference`, order-source/provenance, confirmation, lifecycle, and order-intent idempotency contracts.

## Scope

### Knowledge lifecycle

Implement business-scoped source creation for PDFs, DOCX/text documents, plain text, FAQ entries, URLs/web-page snapshots, CSV where useful, product catalogs, manual notes, policies, and API-backed/live source descriptors without exposing raw secrets. Ingestion parses, chunks/indexes, records version/checksum, status/error, source attribution, and reindex/update/delete lifecycle. Use user-visible source states `UPLOADED`, `PROCESSING`, `READY`, `FAILED`, and `OUTDATED` (map safely to the architecture-level lifecycle where needed). Start with PostgreSQL full-text and metadata filtering if suitable; keep retrieval behind an interface and add embeddings/vector search only when evidence warrants it.

Agency Knowledge UI lists source, type, status, last updated, processing state, size, errors, enablement, and safe inspect/answer-attribution links where available. Authorized users can add, edit where the source type allows, replace, reprocess, disable, delete, and inspect source metadata/content according to retention and role policy. Replacing/reprocessing must preserve a safe provenance/version trail. A failed or outdated source must be visible and must not silently be presented as current. Structured volatile facts such as stock, price, and live order state always prefer a permitted live tool/API over retrieval.

Expose `search_knowledge`, `get_policy`, and `search_faq` as read-only typed tools. Return concise results with source IDs/labels/URLs/versions so runtime and dashboards can attribute them. Structured volatile facts such as stock, price, or current order state must use live tools/APIs rather than stale knowledge. Client/agency UI may manage sources/status according to roles; never make unreviewed raw ingest content instructions with higher priority than agent/business policy.

### Business, customer, and custom HTTP tools

Add reusable domain services and tools: `search_products`, `get_product`, `check_inventory`, `calculate_delivery_fee`, `create_order`, `get_order`, `update_order`, `cancel_order`, `get_customer`, `update_customer`, `get_previous_orders`, `add_customer_note`, and tags as appropriate. Implement only integrations/data access actually available; use deterministic fake adapters in tests. Classify tools correctly—read versus write/sensitive/destructive—and enforce agent policy, conversation ownership, trusted context, validation, idempotency, audit, and safe redaction. Cancellation/refund behavior remains strongly gated.

### Conversational orders and order operations

Implement reusable conversational ordering behind the channel-independent runtime/tool/action contracts, using internal/fake adapter tests until the first production Messenger adapter arrives in Phase 6. Do not create a channel-specific checkout path or force the customer to visit a website. An agent resolves an unambiguous product, checks live variant inventory where available, collects only the business-required missing fields naturally over multiple messages, summarizes the proposed order, and requests confirmation when policy requires it. If product identity is uncertain, it asks for confirmation rather than guessing.

Add an `OrderPolicy` settings UI/API per business: inbox-order enablement; required/optional checkout fields and Zod validation; product/variant/quantity requirements; confirmation rule; payment/COD options; delivery rules; allowed statuses; pending-order expiry; enabled website product discovery; and handoff conditions. Fields are not globally hardcoded: a clothing business can require color/size while a cosmetics business need not. Version/agent configuration may constrain which agents can use ordering, but the policy remains business-owned structured data.

Persist a business/customer/conversation-scoped `PendingOrder` as high-priority context, with products/variants/quantities, collected and missing fields, source messages, validation state, confirmation state, source channel, selected agent/version/run, expiry, and state history. Support multiple items. “XL na, L den” updates the existing pending order; cancellation/expiry closes it safely; human takeover leaves it visible/editable to authorized staff. Do not use only summaries or free-form memory for this state.

Add an `Order` and immutable order-item snapshots. Record order number, business/customer/conversation, source/channel, originating message references, agent run/version, structured customer/name/phone/address/district/delivery/payment/notes fields as configured, confirmation state, status, and timestamps. Snapshot product/variant identity/name/SKU where available, quantity, price/discount/total/currency at creation time. Preserve canonical product reference separately from canonical URL. Use the compatible lifecycle `DRAFT`, `COLLECTING_INFO`, `AWAITING_CONFIRMATION`, `CONFIRMED`, `PROCESSING`, `SHIPPED`, `DELIVERED`, plus cancelled/failed/expired and approved business-specific terminal states.

`create_order` is a `WRITE`/idempotent commerce operation using a persisted order-intent key tied to business, conversation, and pending order. It rechecks live inventory before confirmation/create when available and reconciles an existing result before retrying. If creation succeeds but `send_message` fails, retain/retrieve the existing order and retry only the customer notification. Do not generate another order. `update_order`/`cancel_order` enforce ownership, field/status transition permissions, audits, and idempotency as applicable.

Build the client Orders section and agency order inspection. Authorized users can list/search/filter by order number, customer, phone, product/variant, source/channel, conversation, time, status, payment state/method, and agent/human origin; open the originating conversation and associated AgentRun; view immutable item/provenance details; update permitted status/details, cancel, and add internal notes. Every operational change is audited. Use Mantine tables/forms/status badges/drawers by default, with clear pending/confirmed/failed/expired/loading/empty states.

### Custom tools

Agency admins can manage a business-scoped Custom Tools catalog without changing AgentOS itself. Tool types start with approved HTTP API tools and webhook/action tools, alongside internal platform tools; future plugin/tool types must use the same registry/policy. The UI supports name, description, type, method, URL/base/path template, input schema, output mapping, timeout, safety classification, permissions, allowed agents, enablement, and safe test status. Header/API credentials are selected as write-only credential-vault references, never plaintext in a definition or retrievable after saving. Role policy must prevent unrestricted dangerous tool creation by client users; agency capabilities and business owner/admin approvals remain explicit.

Approved custom HTTP tools use configuration rather than arbitrary network access: name/description, Zod input/output schema or controlled JSON-schema translation, base URL/path template, method, headers/auth secret reference, allowed hosts, timeout, request/response size limits, retries by method/idempotency, output mapping, and safe audit fields. Block localhost/private-network SSRF paths, open redirects, unapproved DNS targets, and raw secret interpolation. The model receives a tool description/schema, never credential values. At runtime, every configured tool still receives trusted tenant context and enforces permission, timeout, validation, safe logging, and required idempotency.

### Search and browser abstraction

Add `web_search` and `read_url` behind replaceable providers. Return bounded, structured snippets and sources; validate URLs and apply policy/redaction.

Add browser tools named `browser_open`, `browser_click`, `browser_type`, `browser_extract`, `browser_screenshot`, and `browser_close` behind `BrowserExecutionService`. Browser Use/Playwright can be an implementation chosen by adapters, but AgentOS imports only interfaces. Initial execution may live in the monolith; design it so Phase 5/operations can run it in `apps/browser-worker` without changing runtime callers.

Product discovery prefers `search_products`/catalog/inventory tools. If they are unavailable or insufficient and the business policy explicitly enables it, browser/web tools may inspect the approved client website for public product candidates, canonical URL, and useful description/price signals. Browser discovery is not an authoritative inventory or order system unless explicitly configured. It returns structured candidates and uncertainty; multiple plausible products require customer confirmation. A product URL may be sent through the existing channel action/capability path and later rendered as a richer product card without changing the product/order contract.

Sessions belong to a business and run (or explicitly authorized reusable business session), have an owner, timeout, step/action/egress limits, cancellation, safe activity events, and audit record. Enforce domain allowlists/denylists, credential-vault references, download/upload policy, isolated profiles, sensitive screenshot handling, and result limits. Treat page content as untrusted data and defend against prompt injection: it cannot alter system policy, permission grants, or tool scope. Never expose browser credentials, typed secrets, raw session state, or unsafe screenshots in model/client realtime payloads.

### Attachment and multimodal pipeline

Introduce asynchronous attachment work without holding a webhook/widget request open. Validate source/type/size/content hash, safely download, scan/inspect according to deployment policy, store in business-prefixed S3/R2-compatible object storage, and maintain retention/deletion metadata. Use signed server-controlled URLs. Persist original metadata and safe processing results; emit safe `attachment.processing`, `.ready`, `.failed` activity. Agency attachment views expose status, type, size, safe metadata, processing errors, and authorized inspection—not raw provider internals.

For images, select a vision-capable primary model when configured or route through `VisionProvider`; cache policy-safe derived understanding by content hash/version so duplicates are not repeatedly processed. For audio/voice notes, normalize through `AudioTranscriptionProvider` with `ElevenLabsAdapter` planned first: voice received → download → transcription started → transcript ready → normalized message context. Store transcript/status/language/confidence/source reference and pass only approved transcript/metadata into normal message context. Realtime can safely show “Transcribing voice message” and “Transcript ready.” Documents/images and useful video metadata follow equivalent metadata/derived-result rules. TTS/voice responses are explicitly deferred.

The future WebChatAdapter may accept attachments only after this pipeline is ready and its public SDK security rules are extended; Phase 6 reuses the same pipeline for Messenger media.

### Advanced context, memory, search, and goals

Complete context budgeting across instructions, business/channel policy, identity, memories, summary, pins, recent window, pending goals, retrieved knowledge, safe tool results, attachment derivatives, and current event. Record inclusion/exclusion and source provenance. Improve rolling summarization but retain searchable raw source messages. Add memory confidence, dedupe, provenance, manual notes, expiry, superseding, and source recovery.

Strengthen pending actions into persistent goals such as “notify when Black XL returns” or “follow up tomorrow,” with customer/conversation/creator, trigger type, state, expiration, and idempotency. Phase 4 supplies storage and tools such as `mark_pending_action`/`resolve_pending_action`; Phase 5 supplies event/time triggering.

### Data, API, UI, and realtime

Use new migrations for sources/chunks/indexes, attachments/derived artifacts, browser sessions/runs, tool/integration configs, secret references, goal state, order policy/pending orders/orders/item snapshots/order idempotency/order audits, and required audits. Scope/index all by business. Add internal/client-safe APIs/UI incrementally for knowledge sources, approved tool configs/status, browser/run inspection, attachment status, memories/pins/goals, Orders/order detail, and safe traces. Agent configuration can enable sources/tools/browser/order capability only through versioned policy and feature flags.

Extend safe realtime schemas compatibly for browser and attachment lifecycle and high-level knowledge/tool activity. Client projection remains least-privilege; internal views may be more detailed but still redact secrets and hidden reasoning.

## Tests and validation

- Knowledge ingest/reindex/delete, tenant filtering, retrieval relevance fixtures, source attribution, and stale-live-data routing.
- Tool policy/safety tests: trusted context cannot be overridden, write idempotency, ownership/human approval gates, fake commerce adapters.
- Conversational orders: ambiguous product confirmation; configurable required-field collection; multi-item/variant/quantity changes; pending-order resume/expiry/cancel; confirmation and inventory recheck; human takeover; immutable price snapshots; order search/audit; create success plus send failure retries notification without duplicating the order.
- Custom HTTP: host allowlist, SSRF/private-IP blocks, secret redaction, timeout/size limits, retry policy, audit trail.
- Browser: isolated tenant/run sessions, domain policy, cancellation/timeout, prompt-injection fixtures, credential/screenshot redaction, safe realtime activity.
- Attachments: validation/size/type/hash dedupe, async lifecycle, signed/object scope, image provider fallback/cache, ElevenLabs adapter fake transcript, failure/retry-safe states.
- Context/memory/goals: bounded selection/provenance, summary/pin/raw-source recovery, supersession/expiry, pending goal persistence.
- Regression: fake WebChatAdapter contract, client dashboard/handoff flows, and future adapter boundaries continue through unchanged runtime/action contracts.

## Do Not Build Yet

No Meta SDK/webhooks/tokens, comment processor, high-volume universal event queue migration, global scheduled-job execution, TTS, a complete custom inbox, payment/billing engine, or microservices.

## Deferred To Later Phases

Phase 5 operationalizes durable event processing, conversation buffering/locks, delayed delivery, attachment jobs, browser workers, scheduled triggers, retries/DLQ, cancellation, and replay. Phase 6 attaches Meta media through this pipeline. Phase 7 uses knowledge/tools for comment policy and adds production-wide analytics/hardening.

## Definition of Done

1. Agent versions can safely use attributed knowledge, conversational-order/business tools, and bounded custom integrations without violating tenant/permission/idempotency rules.
2. Browser and web capabilities are replaceable, isolated, cancellable, policy constrained, auditable, and safely observable.
3. Images and voice/audio flow through reusable asynchronous attachment, vision, and transcription abstractions; ElevenLabs is adapter-only.
4. Context remains bounded and source-aware while preserving raw history, pins, memory lifecycle, and durable pending goals.
5. All new APIs/realtime/UI uphold role, tenant, redaction, and Mantine consistency requirements.
6. Inbox-native orders can be collected, confirmed, created, inspected, and operationally updated across the generic channel/runtime/tool architecture without duplicate orders or mutable historical item facts.
7. The listed safety, provider-failure, attachment, order, and regression tests pass.

## Completion Note

After implementation, create `docs/completion/phase4.md` with knowledge/search strategy, provider adapters, tool policies/integrations, attachment/browser architecture, migrations, retention choices, tests, limitations, and deviations. Phase 5 must read it first.
