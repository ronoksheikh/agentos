# Phase 2 Completion — Internal Agency Control Plane

## Status

Phase 2 is complete. AgentOS now has an authenticated internal agency control plane, additive operational domain services, a Next.js App Router + Mantine administration application, safe playground orchestration through the Phase 1 `AgentRuntime`, additive Drizzle persistence, and deterministic Phase 2 coverage. No Phase 3 client dashboard, production channel adapter, queue, browser/search, knowledge ingestion, commerce implementation, or external channel was added.

## What was built

- Complete agency account workflows for login/logout, password reset, expiring one-use invitations, session revocation, disabled-account rejection, and agency membership administration. Password and invitation tokens are never stored in plaintext by the deterministic application service.
- Expanded capability grants for `SUPER_ADMIN`, `ADMIN`, `SUPPORT`, and `DEVELOPER`, with reusable server-side capability checks instead of UI role branching.
- Better Auth continues as the browser session authority. Its Next.js handler uses the Phase 1 Drizzle tables, 12-character minimum passwords, one-hour reset tokens, reset-time session revocation, secure-cookie behavior, and a database session-create hook that rejects disabled users.
- `AuthenticatedRealtimeConnection`, which requires the same server-issued session token before the existing `RealtimeProtocol` permits a server-authorized subscription. Disabled or forged business/run/conversation scope fails closed.
- Explicit business onboarding transitions, structured business profile validation, business disable/enable and agent assignment, and audited temporary operational announcements with priority, activation window, agent/channel scope, automatic expiry, and context provenance.
- Immutable managed agent drafts with test selection, optimistic revision checks, compatibility validation, atomic active-selection semantics, publish, rollback, archive, and audit records. Bounded timing and truthful automation disclosure are enforced at publish.
- Business-scoped conversation search and filters, replay-deduplicated event application, and counters with defined semantics for unread conversations, unresolved handoffs, failed runs, and urgent issues.
- Memory inspection with safe content, expiry/outdated projection, source conversation/message navigation, authorized edits, and audit records; the service also provides stores for pins, summaries, and pending goals.
- Audited global/business feature flags and append-only safe audit querying with cursor pagination.
- A disposable `AgentPlaygroundService` that creates business-scoped test conversations, uses explicit test-version selection and `test_harness` context, removes destructive capability grants, emits only generic simulation channel identities, and calls the one Phase 1 `AgentRuntime` with debug-safe context provenance. The existing Phase 1 deferred channel action executor remains the effect boundary, so simulations do not dispatch external messages.
- Thin, authorization-oriented operational API façade and a complete `/api/...` route catalog for sessions/users/invitations, businesses/onboarding/announcements, agents/versions, playground, traces/runs/tools/actions, conversations/memory/pins/goals, tool policies, audits, flags, and counters. Inputs use Zod, errors use request IDs and safe envelopes, and list contracts use cursors.
- Next.js App Router administration app with Mantine theme, AppShell, forms, cards, tables, badges, alerts, tabs, accordion, responsive navigation, notifications, and automatic light/dark modes. It includes sign-in, reset, invitation acceptance, logout, overview, business workspace, agent-version editor, and authorized routes for every Phase 2 operational area.
- Clearly labeled placeholders for integrations, queues/failures, channel setup, knowledge, browser access, comments, orders, and later-phase ownership workflows.

## Main modules and files

- `apps/admin/app`, `apps/admin/components`, `apps/admin/lib/server.ts` — internal Next.js/Mantine application, auth pages/handler, server-rendered authorization, navigation, business workspace, and agent version UI.
- `apps/api/src/index.ts` — API route catalog, search/pagination schemas, endpoint capability mapping, and preserved Phase 1 test-run handler.
- `apps/api/src/control-plane.ts` — authenticated application API façade and safe error response mapping.
- `packages/auth/src/index.ts` — Better Auth factory, expanded agency capabilities, account workflow service, invitation/reset/session behavior, and membership management.
- `packages/control-plane/src/index.ts` — onboarding/profile/announcement, audit, managed agent version, operational search/counter, memory inspector, feature flag, and playground services.
- `packages/realtime/src/index.ts` — same-session authenticated WebSocket connection boundary over the preserved realtime protocol.
- `packages/database/src/schema.ts` and `packages/database/migrations/0001_tricky_dracula.sql` — additive Phase 2 persistence.
- `tests/phase2-*.test.ts(x)` and `tests/realtime-contracts.test.ts` — Phase 2 behavior, security, API, UI smoke, and WS coverage.

## Public contracts introduced or extended

- `AgencyAuthService`, `agencyCapabilities`, `requireAgencyCapability`, invitation schemas, and optional Better Auth reset-delivery/account-state hooks.
- `OnboardingState`, `BusinessProfile`, `BusinessRecord`, `BusinessAnnouncement`, `AuditRecord`, and `BusinessControlPlane`.
- `ManagedAgentVersion` and `AgentConfigurationService`.
- `OperationalQueryService`, `MemoryInspectorService`, `FeatureFlagService`, and `AgentPlaygroundService`.
- `AuthenticatedRealtimeConnection` and `RealtimeSessionValidator`.
- `API_PATHS`, `endpointCapabilities`, `conversationSearchSchema`, `cursorQuerySchema`, `AgencyControlPlaneApi`, and `safeApiResponse`.

Phase 1 contracts remain compatible: `AgentRuntime.run`, `TrustedBusinessContext`, normalized events/actions, `Agent`/`AgentVersion`, the channel contract foundations, context/memory/tool/action/trace/realtime schemas, and the original migration were not replaced. The runtime still has no channel implementation import.

## Database and migration

Migration `0001_tricky_dracula.sql` is additive and leaves `0000_fixed_maelstrom.sql` unchanged. The schema now contains 29 tables.

It adds:

- onboarding and invitation enums;
- structured business profile, onboarding state, disabled flag, and optimistic revision;
- agent-version revision, based-on provenance, and update time;
- conversation unread/urgent/tags/test-retention fields plus tenant-leading operational indexes;
- expiring hashed invitations;
- global/business feature flags with revisions;
- user-scoped deduplicated operational notifications;
- tenant-leading indexes for invitations, flags, counters/search, agent filtering, and acknowledgement queries.

The migration was generated twice; the final generation reported no schema changes. It was not applied because no Phase 2 PostgreSQL instance or deployment `DATABASE_URL` was provided.

## Authentication configuration

- Better Auth PostgreSQL/Drizzle adapter remains the only browser authentication authority.
- Email/password is enabled with a minimum length of 12, seven-day sessions, daily refresh, no cookie cache, one-hour reset tokens, and session revocation on reset.
- Secure cookies are selected for HTTPS base URLs.
- Session creation checks the authoritative `users.state`; protected pages query the current user and agency membership on the server for every access.
- Password reset delivery uses the deployment-provided `AUTH_EMAIL_WEBHOOK_URL`. Tokens/URLs are sent to that service and are never logged. Missing delivery configuration fails closed.
- Agency invitation acceptance validates a SHA-256 token hash, expiry, scope, and unused state, then creates the agency membership and audit record transactionally. Business/client invitations are stored for later activation; there is intentionally no client login or client UI.
- MFA, OAuth, and passkeys remain deferred as required.

## Agent publishing and playground decisions

- Published snapshots are immutable. Edits occur only on `DRAFT`/`TEST` records and require the expected revision.
- Publish validates timing bounds, disclosure truthfulness, and Phase 2 capability availability before changing active selection. Rollback selects an earlier previously published snapshot; it does not copy over or mutate its configuration.
- Browser and knowledge enablement fail compatibility validation because those execution paths belong to Phase 4.
- Playground fixtures use generic simulation identifiers for fake WebChat, Messenger-shaped message, comment, image, and voice-transcript cases. They are normalized test inputs, not channel adapters or claims of supported production capability.
- Observable facts, context provenance, safe tool summaries, actions, usage, latency, and safe errors are available. No raw prompts, hidden reasoning, secrets, provider payloads, or unsafe tool input/output were added to UI/realtime contracts.

## Validation

Final commands and results:

- `bun run db:generate` — 29 tables detected; no schema drift and no new migration required.
- `bun run check` — strict TypeScript passed; 31 tests passed with 165 assertions.
- `bun run admin:build` — optimized Next.js production build passed, including all dynamic protected routes and static authentication pages.

Coverage includes all Phase 1 regression tests plus login/logout/reset/invitation/revocation/disable behavior, agency capability denial, business scope filtering, WebSocket handshake/subscription authorization, draft isolation, test selection, publish/rollback/archive/conflict/audit behavior, timing/disclosure validation, playground test scoping, structured profile separation, announcement scope/expiry/provenance, memory source navigation/expiry/outdated/audit rules, search/counters/replay deduplication, feature-flag revisions, standard API errors, route capability mapping, Mantine rendering, route inventory, sign-in, and theme control.

## Known deployment limitations

- PostgreSQL-backed Phase 2 service repositories and live database migration smoke testing require a deployment database. Deterministic domain tests use the in-memory control-plane services, consistent with the Phase 1 adapter strategy; the production schema and Next.js Better Auth path are present.
- The operational API is delivered as framework-neutral authorized handlers/contracts in `apps/api`; only Better Auth and invitation acceptance are mounted as Next.js HTTP routes in this repository because a listening API host was not introduced in Phase 1. A future host can bind these handlers without moving domain logic into route code.
- Password reset/invitation delivery requires the configured internal email gateway; email infrastructure itself is outside the AgentOS phase scope.
- Dashboard list/detail surfaces intentionally use safe empty/example states until connected to a deployed PostgreSQL API host. Authorization remains server-side; these examples do not grant access or act as data authority.
- The test suite provides component/server-render smoke coverage rather than browser-driven Playwright coverage. The optimized Next build validates all routes and theme/client boundaries.
- Queue depth and integration health are placeholders because queues and production integrations are explicitly deferred.

## Deviations

- The repository instruction requested the `ponytail` skill, but it was not present in the available skill catalog. No substitute behavior was invented.
- There were no architecture or product-scope deviations from `plan2.md`. The UI smoke requirement is satisfied with deterministic rendered-component tests and production route compilation rather than a browser automation dependency, which is intentionally deferred.

## Commits

- `4af44c9 feat(phase2): add authenticated control plane services`
- `1883f5c feat(phase2): persist control plane data model`
- `fe0891e feat(phase2): build Mantine agency dashboard and APIs`
- `93a6323 feat(phase2): complete agency account workflows`
- The completion note is committed separately as the final Phase 2 documentation commit.
