# Phase 3 — Client Dashboard, Handoffs, and Web Chat Contract Surface

## Before implementing this phase

1. Read `ARCHITECTURE.md`, `plan.md`, `plan1.md`, and `plan2.md` completely.
2. Read `docs/completion/phase1.md` and `docs/completion/phase2.md` if present.
3. Inspect actual runtime, authentication, agent-version, realtime, and audit contracts before adding code.
4. Reuse the canonical Universal Event → processor → runtime → Universal Action → Channel Registry → adapter path. Do not create a website-only runtime, unauthenticated client data path, a production Web Chat adapter, or a custom human inbox.

## Goal

Introduce the business-facing operational dashboard and handoff workflow while defining a secure Web Chat SDK/`WebChatAdapter` contract surface for future delivery. The first production channel remains Messenger in Phase 6; Phase 3 may use only an explicit fake/test Web Chat adapter where needed to validate contracts without becoming a production channel.

## Inherited From Previous Phases

- Phase 1's normalized `AgentEvent`, runtime/tool/context/Universal Action contracts, ChannelAdapter/Registry/PresenceController foundations, safe traces/realtime envelope, tenant context, customer/conversation/memory models, and action executor boundary.
- Phase 2's session authentication, membership/capability checks, business onboarding, agent draft/test/published version behavior, internal dashboard, audit logs, and feature flags.

The future Web Chat adapter may create a verified visitor session, but it does not grant arbitrary business access. Client users are ordinary authenticated users with business memberships, not a separate authorization bypass. The runtime never sees raw browser SDK authority tokens or decides tenant scope.

## New Contracts Introduced In This Phase

- `WebChatAdapter` contract target conforming to the shared `ChannelAdapter` interface; internally it may later own visitor-session verification, inbound parsing/normalization, transport, and capability mapping.
- Website installation/public-client-key and signed visitor-session protocol with allowed-origin checks and SDK versioning.
- Client-safe realtime projection contract, distinct from internal agency-safe projection.
- Conversation ownership and handoff lifecycle: `AI_ACTIVE`, `HANDOFF_REQUESTED`, `HUMAN_ACTIVE`, `PAUSED`, `RESOLVED`; handoff assignment/acknowledgement/resolve/resume semantics.
- Client dashboard permission matrix for `OWNER`, `ADMIN`, `STAFF`, and `VIEWER` (at minimum owner/admin manage team and agent-facing settings; staff handle conversations/handoffs; viewers have read-only scope; precise capabilities live centrally).
- Client-safe conversation search, realtime counter, and handoff-notification/acknowledgement contracts; email delivery remains deferred.

## Scope

### Website SDK and Web Chat contract

Define an independently buildable Bun workspace package only if the future SDK needs external publishing/embedding. It uses a public agent/site key, never a secret:

```html
<script src="https://cdn.example.com/agent.js" data-agent="public_agent_key"></script>
```

The future server path resolves the public key to a business, published agent, allowed site configuration, and capabilities. Require exact/controlled allowed origins, CORS policy, rate limits, abuse controls, SDK semantic versioning/backward compatibility, and short-lived signed anonymous visitor sessions. Another website cannot freely embed or impersonate the business's agent. Do not expose database IDs, model/provider credentials, or long-lived bearer secrets in the SDK.

The future SDK uses a small accessible UI and may send only safe explicit context: URL, title, consented page/product/cart references supplied by the host, and visitor message/attachment metadata. It must not scrape arbitrary DOM/private form data by default. Its future adapter can use authenticated WebSocket or a secure request/response transport; the server validates the visitor session and origin on every operation.

Server flow:

```text
visitor message -> WebChatAdapter inbound verification/normalization
-> Universal Event/message processor entry -> AgentOS Runtime
-> Universal Action -> Channel Registry -> WebChatAdapter.execute() -> visitor transport
```

This is a contract and optional fake/test-adapter surface only. Do not deploy `WebChatAdapter` as a production channel in this phase. Its future implementation must use the Phase 5 durable universal-event path without changing runtime/action contracts.

### Client authentication, dashboard, and isolation

Implement client invitation acceptance, login/logout/reset, account disable enforcement, multi-business membership selection, and membership management according to Phase 2 auth conventions. All API and WebSocket requests resolve accessible businesses server-side. A user-provided business ID, public SDK key, customer ID, or conversation ID never authorizes cross-business data.

Build the client Next.js + Mantine app. Use Mantine components and themes, support dark/light, and retain the clean minimal operational visual language. Initial pages: Overview, Conversations, Conversation detail, Needs Attention/Handoffs, Customers, Agent Activity/status, Team, and Settings appropriate to role. Conversation search supports authorized lookup/filter by customer name, verified phone, order ID, conversation ID, message text, tags, channel, handoff state, date, unread state, and agent. Defer advanced performance/orders/knowledge/comment pages to later phases.

Overview and navigation show role-scoped realtime counters for unread conversations, unresolved handoffs, failed agent runs, and urgent issues. Each counter has an explicit definition and opens the corresponding filtered list; it is not merely a notification badge. Defer cross-business agency aggregate counts to the internal dashboard.

Client detail views show their business's customer/agent messages, ownership state, safe statuses, safe tool/browser placeholders, final message delivery state, and handoff state. Use operational empty/loading/error/retry states rather than blank panels. They never show full internal prompt configuration, credentials, provider details, raw traces, security metadata, hidden reasoning, or unsafe tool input/output.

### Authenticated realtime protocol

Extend the canonical WebSocket protocol, not a parallel client stream. Handshake authenticates a user session or verified visitor session according to endpoint audience. The server computes permitted client topics (business/conversation/handoff/run) and projects events for client visibility. Support ping/heartbeat, stale cleanup, bounded reconnect/replay cursor, authorization on subscribe/unsubscribe, event sequence where needed, and rate limits.

Client-safe events can express facts such as “Agent received 3 messages,” “Combined message batch,” “Customer context loaded,” “Checking inventory,” “Transcribing voice message,” “Preparing reply,” “Message sent,” or “Handoff requested.” Strip raw prompt/context text, provider payloads, secrets, headers/tokens, raw sensitive tool values, security flags, and agency-only metadata. Persisted run views use the same projection rules. Realtime counter updates are idempotent/replay-safe and scoped to the user’s authorized business memberships. Phase 4 supplies actual attachment/browser work; this phase only preserves the compatible activity vocabulary.

### Handoff and ownership

Implement the initial lightweight handoff—not a full custom multi-agent inbox. `request_human` creates a handoff record containing business/conversation/customer/channel, reason, priority, safe summary, external reference nullable, state, assignment, acknowledgement/resolve timestamps, actor records, stale SLA metadata, and idempotency key. It emits audit/notification/realtime events.

Handoff cards show customer, business, channel, reason, priority, short safe summary, created time, local conversation link, and an external-channel link when one exists. Authorized users can Take Over, Open External Chat when supported, Mark Resolved, and Resume Agent; controls reflect ownership/channel capability and must not imply an action is available when it is not. When an authorized human accepts/takes ownership, transition the conversation to `HUMAN_ACTIVE` and prevent automatic AgentOS replies. A policy may allow explicitly configured exceptions, but default behavior must fail safe. Resolution records outcome; an authorized explicit “resume AgentOS” transition returns ownership to `AI_ACTIVE`.

New/urgent handoffs generate deduplicated realtime dashboard notifications with priority/severity and per-user acknowledgement state. When the browser permission is granted, authorized users may receive browser notifications; denial/unavailability is a non-failing preference state. Acknowledging a notification does not resolve or take over the handoff. Notify on stale/urgent handoffs in-dashboard. Website handoffs open the local conversation; later Meta handoffs add external references through the same field. Email is explicitly deferred.

### Data, API, and observability

Use new migrations for website installation/site configuration, visitor sessions/identities, client memberships if not already complete, handoffs, ownership state/history, notification records, and event projection/replay support as needed. Index business + external visitor/session/conversation lookups. Retention controls and delete behavior remain compatible with architecture policy.

Thin APIs cover public SDK session/bootstrap/message operations, authenticated client dashboard data, conversation search/counters, handoff accept/assign/notification-acknowledge/resolve/resume, team membership, and WebSocket connection/subscription. Side effects use idempotency keys; state transitions are transactional and audited.

## Tests and validation

- SDK/contract integration: allowed origin/site rules, invalid/expired visitor-session rejection, no secret/business leakage, safe page-context normalization, rate limiting, and fake `WebChatAdapter` conformance.
- Contract end-to-end: a fake Web Chat message reaches the existing runtime through Universal Events and its Universal Action resolves through the registry; no visitor/session can reach another business/agent/conversation.
- Client RBAC: all four business roles, cross-business/multi-membership checks, disabled account session/WS rejection, server-authorized subscriptions/replay.
- Projection: internal trace facts are correctly transformed; banned prompt/secret/unsafe fields never reach client transport or persisted client query.
- Handoff: create/idempotent retry, ownership blocks AI reply, assignment/acknowledgement, resolve then explicit resume, deduplicated priority notification/browser-permission behavior, stale notification, audit entries.
- Search/counters: every supported filter is tenant/role scoped; counter definitions match filtered records, realtime replay does not double count, and a counter never exposes another business.
- UI smoke/e2e: responsive Mantine conversation and Needs Attention views in dark/light modes.

## Do Not Build Yet

No production Web Chat adapter, Meta/Facebook adapter, comment processing, browser automation, web search, advanced knowledge ingestion, arbitrary commerce/custom HTTP tools, full orders/performance analytics, billing, or durable multi-worker queue pipeline.

## Deferred To Later Phases

Phase 4 adds knowledge, conversational-order/business/custom tools, the client Orders dashboard, web/browser capability, context enhancement, and attachments/multimodal work. Phase 5 makes future channel processing durable with universal events, registry/presence lifecycle, queues, buffering, locks, idempotent order execution, and delayed delivery. Phase 6 delivers the first production adapter, `FacebookMessengerAdapter`; a production WebChatAdapter and all other channel adapters remain compatible future work. Phase 7 expands client analytics and comments.

## Definition of Done

1. The future Web Chat SDK/adapter contract is secure by design (approved domains, signed visitor sessions, tenant isolation, and no secrets) and has a fake/test adapter proving conformance.
2. The Web Chat contract uses one Universal Event/runtime/Universal Action/registry/adapter architecture and does not modify AgentOS for website specifics.
3. Client members authenticate, are strictly isolated to authorized businesses, and see safe live/persisted operational activity.
4. A handoff is created, visible, auditable, ownership-aware, and can be explicitly resolved/resumed without unwanted AI replies.
5. Website/client API, realtime, SDK, RBAC, projection, and handoff tests pass.
6. No production Web Chat, Meta, browser, advanced tool, or later queue architecture is implemented prematurely.

## Completion Note

After implementation, write `docs/completion/phase3.md` with SDK protocol/version, WebChatAdapter contract/fake adapter boundaries, client roles/pages, handoff state transitions, migrations/APIs, safe projection rules, tests, and deviations. Phase 4 must read it first.
