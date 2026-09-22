# Phase 2 — Internal Agency Dashboard, Authentication, and Agent Playground

## Before implementing this phase

1. Read `ARCHITECTURE.md`, `plan.md`, and `plan1.md` completely.
2. Read `docs/completion/phase1.md` if it exists; reconcile its actual contracts with this plan before changing code.
3. Inspect the current repository, tests, migrations, and exported Phase 1 interfaces.
4. Extend the Phase 1 runtime, tenancy, realtime, trace, and agent-version contracts. Do not bypass them with frontend-only logic or create a dashboard-specific runtime.

## Goal

Provide the agency’s authenticated internal control plane: business onboarding, team access, agent draft/test/publish lifecycle, tool policy configuration, safe operational inspection, and a disposable Agent Playground. This is the first complete administration experience, not a client dashboard.

## Inherited From Previous Phases

- `TrustedBusinessContext`, tenant-scoped repositories, session/auth foundations, agency/client role capabilities, and ULID/API conventions.
- Agent/version states and explicit publish/rollback semantics.
- `AgentRuntime.run`, `AgentEvent`, `AgentAction`, model/tool/context/memory interfaces, safety classes, trace persistence, safe realtime envelope, and authorization model.
- Conversation ownership/handoff primitives are preserved but their client workflow is deferred to Phase 3.

Do not redefine runtime inputs, put tool execution in Next.js route/UI code, make `businessId` from a form authoritative, mutate an active agent version in place, or expose prompts/secrets/hidden reasoning.

## New Contracts Introduced In This Phase

- Complete server-side agency authentication workflows: login, logout, password reset, invitation, session revocation, disabled-account enforcement, and agency membership administration.
- Business onboarding state machine: `CREATED`, `CLIENT_INVITED`, `BUSINESS_INFO_READY`, `KNOWLEDGE_PENDING`, `AGENT_CONFIGURED`, `AGENT_TESTED`, `CHANNEL_PENDING`, `PUBLISHED`, `LIVE` (names may vary but transitions must be explicit/audited).
- Agent configuration service and API: draft editing, test-version selection, immutable publish, rollback, archive, and optimistic concurrency/version checks.
- Internal-safe realtime projection and run-detail query contract for agency operators.
- Initial business-scoped feature-flag service and immutable-ish audit log contract.
- Agency operational-query contracts for tenant-scoped conversation search, counters, temporary business announcements, and notification acknowledgement; client-facing equivalents are Phase 3.

## Scope

### Authentication and authorization

Implement Better Auth consistently for the internal web app/API as required by `ARCHITECTURE.md`. Password reset tokens, invitations, sessions, and membership changes must be secure, expiring, auditable, and server-authorized. Enforce agency capabilities for `SUPER_ADMIN`, `ADMIN`, `SUPPORT`, and `DEVELOPER`; use capability checks rather than scattered string-role checks.

Agency users can administer platform-level concerns only as permitted. They must choose/enter a business context only after access is checked server-side. An account may be disabled, which invalidates active sessions and WebSocket access. Prepare client-membership tables/APIs but do not yet expose a client login/dashboard experience. MFA/OAuth/passkeys remain deferred.

### Internal Next.js + Mantine application

Create the agency app using Next.js App Router and Mantine. Use Mantine components, form support, data displays, drawers/modals, notifications, layout primitives, and theme system by default. Support light/dark modes and a clean black/white/minimal operational aesthetic. Do not create generic custom controls that duplicate Mantine.

Core pages are: Overview; Businesses; Business onboarding/detail; Agents; Agent versions; Agent Playground; Tools; Customers; Conversations; Memories/pins/pending goals; Runs/Tool calls; Handoffs; Integrations placeholders; Failures/queues placeholders; Audit logs; Feature flags; Team/users; Settings. Pages may initially be progressively implemented, but routes must honor authorization and safe tenant scope.

### Business onboarding and operations

Agency users can create/edit/disable businesses, invite client team members for later activation, see onboarding progress, assign agents, and view entity lists scoped to that business. The business workspace navigation is designed now around Business Profile, Agent Configuration, Facebook Pages, Website Agent, Knowledge, Custom Tools, Integrations, Customers, Conversations, Orders, Memories, Handoffs, Analytics, Team, and Settings; later-phase destinations can be clearly marked unavailable rather than omitted ambiguously.

Business Profile stores structured, editable information: business name/description, tone and supported languages, opening hours, contacts, locations, delivery information, return/refund policies, order rules, escalation rules, brand instructions, and common questions. Keep an Order Settings placeholder for the later business-specific checkout fields/validation, confirmation, delivery/payment, lifecycle, inbox-order, discovery, expiry, and handoff policy; do not invent one global checkout form in Phase 2. These fields have individual schemas and context roles; do not concatenate them into one uncontrolled system prompt. Knowledge documents and live integrations remain separate entities introduced later.

Add an agency-only Temporary Operational Context/Emergency Mode panel. An admin can create, edit, activate/deactivate, and expire a time-bounded announcement with content, priority, start/end, affected agents/channels, and safe audit/source metadata—for example a delivery delay, stock outage, or cutoff notice. It is visibly distinct from permanent agent instructions, appears in a clear active/expired status list, and relies on Phase 1 context provenance so only active in-scope entries affect relevant runs. Show onboarding checklist/status, useful empty/error/success states, and a clear disabled-business state. Do not create channel connections yet. Business life-cycle/trial UI is Phase 7, although state fields can remain compatible.

### Agent configuration and versions

Expose all Phase 1 configuration through understandable sections: General, Instructions, Tone, Languages, Model, Fallback model, Tools, Knowledge, Memory, Channels, Response timing, Handoff rules, Comment rules, Browser access, Safety/permissions, Disclosure policy, and Version. Response timing config exposes the bounded `ResponseTimingPolicy` values appropriate to the current phase (timing bands, maximum wait, urgency bypass, channel activity preference, and business/channel overrides), not unbounded random delay controls. Disclosure policy clearly controls how the agent answers direct automation/AI questions and must not permit false human claims. Some sections remain read-only placeholders until their phase arrives, but their relationship to the immutable version must be clear. Validate with Zod both client-side where helpful and server-side always.

Draft edits cannot alter the active published snapshot. The UI must make the selected version/status obvious. Testing can use a draft/test version; publishing performs permission checks, compatibility validation, active-version switch transaction, and audit record. Rollback selects a prior version, never overwrites it. Show version provenance, diff/metadata where practical, creation actor/time, and known evaluation status placeholder.

### Agent Playground and safe run inspection

The playground creates clearly marked disposable, business-scoped test conversations and uses the existing runtime with an explicit version selection and test mode. It must not send external messages, mutate production customer state, or access production destructive tools unless an explicit protected test adapter exists. Support a channel simulation selector that starts with generic/fake-WebChat input and can simulate Messenger message, comment, image message, and voice-message transcript/attachment fixtures through the same normalized-event contracts. A simulation is not a production adapter or proof of current channel capability.

Support sending test inputs, reset/delete test conversation according to retention, live safe event timeline, final actions, context source provenance, safe tool summaries, usage/latency, errors, and created test memories/pins. The timeline should reserve stable activity presentation for batch formation, context source counts, tool/browser/attachment state, typing/channel actions, delivery outcome, and safe failure categories.

Run and conversation detail pages load persisted Phase 1 traces after live streams end. The UI may show “Context loaded,” “Searching customer memory,” or a safe tool result summary; it must not show raw system prompts, provider payloads, secrets, hidden reasoning, or unsafe tool data.

### Realtime, audit, API, and data

Authenticate WebSocket handshake with the same validated server session. The server derives allowed businesses/runs/conversations and rejects unauthorized topics; reconnect/replay must retain Phase 1 envelope compatibility. Do not trust UI-selected scope IDs.

Add thin `/api/...` endpoints for agency session/team/business/onboarding, business announcements, agents/versions/publish/rollback, playground conversation/messages, run/tool/action queries, conversations/memory/pins/goals, tools/policies, audit logs, and feature flags. Provide the agency memory inspector queries needed to view customer/business memories, pinned messages, summaries, and pending actions with safe content, type, importance, creator, timestamps, expiration/status, source-message references, and source-conversation navigation. Editing, removal, pin/unpin, and marking stale/outdated must be authorized, auditable, and never expose hidden reasoning.

Add tenant-scoped agency conversation search by customer name, verified phone, order ID, conversation ID, message text, tags, channel, business, handoff state, date, unread state, and agent. Define unread counter semantics and expose realtime-safe counters for unread conversations, unresolved handoffs, failed runs, and urgent issues; results/counters link to the same authorized filtered datasets and do not count replayed realtime events twice. Identity-link candidates/confirmed/separate decisions are inspectable and auditable but should not create automatic cross-channel merges.

Use cursor pagination and standard errors. Every material action (business change, invitation/role, agent publication/rollback, tool permission, flag change, memory edit) emits a redacted audit record. Use new Drizzle migrations only and tenant indexes where introduced.

## Tests and validation

- Auth/session integration: login/logout/reset/invitation, disabled user loses API and WS access, agency role/capability denial.
- Authorization: an agency user sees only permitted businesses; all APIs and subscriptions reject forged business/conversation/run IDs.
- Agent versions: draft isolation, test selection, atomic publish, rollback, archive, concurrent-edit conflict, audit trail.
- Playground: creates disposable test state, routes through the canonical runtime, blocks external/destructive side effects, persists/replays safe trace.
- Business configuration/memory inspector: structured profile fields remain separated from knowledge; source navigation, expiry/outdated state, role restrictions, and audit behavior work.
- Operational controls: announcement activation/expiry affects only in-scope context with provenance; timing/disclosure validation is bounded; search filters and counters are tenant-safe, realtime-consistent, and do not double count.
- UI smoke/e2e: sign-in, business creation, agent draft and publish flow, test run timeline, dark/light theme.
- Regression: Phase 1 runtime/context/tool/realtime/tenant tests remain green.

## Do Not Build Yet

No website SDK/widget, client dashboard or client login experience, Facebook/Meta, other channels, browser automation, web search, knowledge ingestion, rich commerce tools, comment processing, billing, or a bespoke human inbox.

## Deferred To Later Phases

Phase 3 activates client membership access, website visitor identity and dashboard, client-safe realtime projections, and handoff ownership UX. Phase 4 brings knowledge/browser/attachments and advanced tools. Phase 5 adds queue operations panels with real queue infrastructure. Meta integration begins in Phase 6; trial lifecycle is completed in Phase 7.

## Definition of Done

1. Agency users securely authenticate and perform only capability-authorized actions; disabled users and unauthorized WS subscriptions fail closed.
2. Operators can onboard a business, configure an agent draft, safely test it, publish a version, roll back, and inspect audits.
3. The playground and inspector use the one existing runtime and safe persisted/realtime traces.
4. Internal UI is Next.js + Mantine, responsive, dark/light capable, and avoids unnecessary custom primitives.
5. Tenant isolation, publish semantics, safe test boundaries, and auth behavior are automatically tested.
6. No client-facing channel, Meta, browser, or later-phase runtime behavior is smuggled into this phase.

## Completion Note

After implementation, create `docs/completion/phase2.md` describing UI/apps, auth library/configuration, APIs, migrations, version/publish semantics, tests, limitations, and deviations. Phase 3 must read it first.
