# Phase 3 Completion — Client Dashboard, Handoffs, and Web Chat Contract Surface

## Status

Phase 3 is complete. AgentOS now has an authenticated business/client dashboard, centralized business-role authorization, client-safe realtime projection, lightweight handoff ownership and notifications, and a secure future Web Chat SDK/adapter contract proven with a fake adapter. No production Web Chat transport, external channel adapter, queue, browser/search, commerce, attachment pipeline, or Phase 4 work was added.

## Modules and files

- `apps/client` — Next.js App Router + Mantine client application with Better Auth routes, invitation acceptance, login/logout/reset, multi-business selection, responsive light/dark shell, counters, overview, conversations/detail, needs attention, customers, agent activity, team, and settings.
- `apps/api/src/client.ts` and `apps/api/src/index.ts` — thin client API facade, client route catalog, shared search input, and capability mapping.
- `packages/auth` — business capability matrix/helpers, membership administration, business invitation/client login workflows, disabled-account checks, and membership/resource-backed realtime authorization.
- `packages/client-operations` — tenant-safe client conversation search/detail/counters and persisted-run activity projection.
- `packages/handoff` — handoff lifecycle, ownership history, RequestHuman bridge, assignment, acknowledgement, resolution, explicit resume, stale alerts, notification preference/deduplication, realtime, and audit hooks.
- `packages/realtime` — compatible event variants, unsubscribe, heartbeat/staleness/rate-limit behavior, and strict allow-listed client projection.
- `packages/website-sdk` — SDK protocol/site configuration, exact-origin/CORS policy, signed short-lived visitor sessions, rate limiting, safe page context, fake `WebChatAdapter`, and canonical test-flow helper.
- `packages/database` — additive Phase 3 schema and migration.
- `tests/phase3-*.test.ts(x)` — SDK, fake adapter, auth/RBAC, tenancy, WS, projection, handoff, notifications, search/counters, API, and Mantine smoke coverage.

## Public contracts

- `BusinessMembershipService`, `businessCapabilities`, `requireBusinessCapability`, and `BusinessMembershipRealtimeAuthorizer`.
- `ClientActorResolver`, `ClientDashboardService`, `ClientConversation`, and `CLIENT_COUNTER_LINKS`.
- `OwnershipState`, `HandoffRecord`, `HandoffService`, `HandoffDomainActionHandler`, `ClientNotification`, and the validated handoff schemas.
- `ClientRealtimeProjector`, `ClientActivity`, compatible realtime event variants, unsubscribe, heartbeat, stale detection, replay cursor, and per-connection request limiting.
- `WebsiteContractService`, `WebsiteSiteConfiguration`, `VerifiedVisitorSession`, `FakeWebChatAdapter`, `runFakeWebChatFlow`, `WEB_CHAT_CHANNEL`, and `WEB_CHAT_SDK_PROTOCOL_VERSION`.
- `ClientApi` plus the Phase 3 additions to `API_PATHS` and `endpointCapabilities`.

Phase 1 and Phase 2 contracts remain compatible. `AgentRuntime` was not changed and still imports no channel adapter. The fake Web Chat path normalizes an `AgentEvent`, invokes the existing runtime, validates returned `UniversalChannelAction` values, resolves the existing `ChannelRegistry`, and executes only the registered fake adapter.

## Client role matrix

| Capability area | OWNER | ADMIN | STAFF | VIEWER |
| --- | --- | --- | --- | --- |
| Read business/conversations/runs | Yes | Yes | Yes | Yes |
| Manage conversations/handoffs/notifications | Yes | Yes | Yes | No |
| Execute agent/test operations | Yes | Yes | Yes | No |
| Manage memories | No default grant | No default grant | Yes | No |
| Manage agents/settings | Yes | Yes | No | No |
| Manage team membership | Yes | Yes | No | No |
| Manage business profile | Yes | No default grant | No | No |

Capabilities are checked server-side. A route/query business, conversation, customer, run, public key, or visitor identifier is only a lookup candidate. Active user state, authoritative membership, and resource ownership determine access. Client protected pages recheck the Better Auth session, account state, business state, and membership from PostgreSQL.

## Web Chat SDK protocol and fake boundary

- Protocol version: `1.0.0`; accepted SDK versions are compatible `1.x.y` values.
- Bootstrap uses a unique public site key, exact configured origin, enabled site, compatible version, and a per-site/origin request limit.
- The bootstrap response contains a 15-minute HMAC-SHA256 signed visitor token, visitor ID, expiry, protocol version, and public capabilities. It does not expose business IDs, agent IDs, database IDs, secrets, provider data, or credentials.
- Every fake inbound operation revalidates signature, expiry, origin, enabled site, business/agent binding, and rate limits.
- Page context retains only normalized URL origin/path, bounded title, consent flag, and consented product/cart references. Query strings, fragments, arbitrary DOM, and unconsented commerce references are excluded.
- `FakeWebChatAdapter` is test-only. It has no public widget, visitor transport, listening WebSocket, CDN artifact, production registration, or external messaging behavior.

## Handoff lifecycle

The states are `AI_ACTIVE -> HANDOFF_REQUESTED -> HUMAN_ACTIVE -> RESOLVED`, with `PAUSED` supported as an explicit operational state and `RESOLVED/PAUSED -> AI_ACTIVE` only through `resumeAgent`.

`RequestHuman` reaches `HandoffService` through `HandoffDomainActionHandler`, using trusted conversation resolution for customer, channel, external reference, and notification recipients. Creation is business/idempotency-key scoped and records reason, priority, safe summary, assignment, acknowledgement, resolution, SLA/stale metadata, audit, notification, and realtime facts. Taking over sets human ownership and stops automatic replies through the ownership guard. Resolving never resumes AI. Opening an external chat is represented only when a trusted HTTPS reference and channel capability exist; the example UI disables the control otherwise.

New, urgent, and stale notifications use stable per-user dedupe keys. Acknowledgement is user-scoped and does not take over or resolve a handoff. Browser delivery preferences support enabled, denied, unavailable, and disabled without making handoff creation fail. Email remains deferred.

## APIs

Authenticated client contracts cover accessible businesses, conversation search/detail, counters, client-safe run activity, team membership capability, handoff list/take-over/resolve/resume, and notification acknowledgement. Public contract-only paths cover `/api/web-chat/v1/bootstrap` and `/api/web-chat/v1/session`; no public visitor-message transport is shipped.

Search supports customer/message/free text, verified phone, order ID, conversation ID, tag, channel, handoff state, date range, unread state, and agent, with cursor pagination and strict business filtering. Counter links resolve to the matching authorized filtered views and replayed counter event IDs are applied once.

## Safe projection rules

Client realtime and persisted activity are rebuilt from an allow-list. Visible milestones are limited to agent started, customer context loaded, combined batch, approved tool activity, preparing reply, reply sent, run failed, handoff requested/updated, and conversation updated. Optional numeric counts are bounded integers.

The projection does not carry internal payload fields, prompt/context text, provider/model details, credentials, tokens, authorization headers, security metadata, raw traces, hidden reasoning, or tool input/output. Conversation query results also pass through client-field redaction before return.

## Database and migration

Additive migration: `packages/database/migrations/0002_dark_tomorrow_man.sql`. Applied migrations `0000_fixed_maelstrom.sql` and `0001_tricky_dracula.sql` were not edited.

The schema now has 34 tables. Phase 3 adds `website_sites`, `visitor_sessions`, `conversation_ownership_history`, `notification_preferences`, and `client_projection_events`; extends handoffs with customer/channel/external reference, assignment, acknowledgement, resolution, priority enum, and stale-SLA fields; and links notifications to handoffs/conversations. Tenant-leading indexes cover site/visitor lookup, handoff attention queues, ownership history, notification preferences, and replay/idempotency state.

## Validation

- `bun run check` — strict TypeScript passed; 42 tests passed with 238 expectations, including every Phase 1 and Phase 2 regression.
- `bun run db:generate` — 34 tables detected; no schema drift and no new migration required after `0002_dark_tomorrow_man.sql`.
- `bun run client:build` — optimized Next.js production build passed for all client/auth routes.
- `bun run admin:build` — Phase 2 admin production build regression passed.

Coverage proves exact origin/CORS rules, compatible SDK versioning, expired/invalid visitor rejection, rate limits, safe page context, no tenant leakage, fake adapter conformance, canonical runtime/registry execution, all business roles, multi-business and cross-business isolation, disabled sessions, resource-backed WS authorization, replay/unsubscribe/heartbeat/staleness/rate limits, strict projection redaction, RequestHuman integration, handoff idempotency/ownership/resolution/resume, browser notification preferences, stale/deduplicated notifications, supported search filters, counter semantics, and Mantine route/theme smoke behavior.

## Limitations and deferred work

- Domain services remain deterministic in-memory adapters for tests, matching the Phase 1/2 repository strategy; the durable PostgreSQL schema and Better Auth client routes are present, but a listening general API host and live database migration smoke test require deployment infrastructure.
- Dashboard record lists use deliberate safe example/empty/loading/retry states until connected to that deployed API host. Server-rendered access is authoritative; example data grants no access.
- No production Web Chat SDK bundle, widget, adapter, public message endpoint, production visitor WebSocket, or external customer messaging exists.
- No email notification delivery, bespoke inbox, external channel, queues, browser/search, knowledge ingestion, attachments, commerce, billing, or advanced analytics were added.

## Deviations

- The repository instruction required the `ponytail` skill, but no such skill was available in the session. Implementation proceeded from the complete architecture/plans/completion notes without inventing substitute skill behavior.
- No product or architecture scope deviation from `plan3.md` was made. UI validation uses deterministic server-rendered Mantine smoke tests plus optimized production builds rather than browser automation, which remains explicitly out of scope.

## Commits

- `5ce8b0c feat(phase3): add client handoff and web chat contracts`
- `f418e7f feat(phase3): persist handoff and visitor contracts`
- `fcbfe97 feat(phase3): build authenticated client dashboard`
- `15e8d7d feat(phase3): gate external handoff navigation`
- The completion note and related environment contract are committed as the final Phase 3 documentation slice.
