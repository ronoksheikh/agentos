# Phase 6 completion

## Delivered

Phase 6 adds Facebook Messenger as the first production channel, a real worker composition, private media handling, Messenger Page onboarding, and a real isolated Chromium browser adapter. The runtime continues to use the existing universal event/action and durable Phase 5 worker contracts; it contains no Meta imports or Messenger-specific branches.

Key modules:

- `packages/channels/src/facebook-messenger/` contains the Graph API client, FacebookMessengerAdapter, raw webhook verification and normalization, encrypted credentials, OAuth/manual Page setup, connection state gates, presence and media URL handling.
- `apps/admin/app/api/webhooks/meta/messenger/` and `apps/admin/app/api/meta/oauth/callback/` provide the Meta entry points. The agency Messenger view and client connection status view expose safe onboarding and diagnostics.
- `apps/worker/src/composition.ts` wires PostgreSQL/Redis, the Messenger adapter, OpenAI Responses and vision providers, private media processing, realtime, and optional browser tools. Production composition does not register fake providers.
- `packages/attachments/src/file-storage.ts` and the private media route store originals outside public paths and issue short-lived signed HTTPS reads.
- `apps/browser-worker/`, `packages/web/src/remote.ts`, and `docker-compose.browser.yml` provide the local browser worker and narrow host bridge. The worker runs Chromium with no AgentOS service credentials and routes HTTPS through a per-session host allowlist proxy.
- `packages/phase4-operations/src/orders.ts` records Messenger connection/Page and verifies same-tenant source message provenance on orders.

## Meta contract and assumptions

The adapter targets Graph API **v26.0**. Official Meta material was checked for Page `MESSAGE` task access, `pages_messaging`, Page `/messages` sends, text and image payloads, `mark_seen`, typing actions, and Messenger webhook signatures. The implementation uses `pages_show_list`, `pages_messaging`, and `pages_manage_metadata` for OAuth and subscription setup. Review current Meta app requirements and complete required app review before production use. The configured version and permissions must be revisited when Meta changes its API.

References: [Meta Messenger Platform API](https://www.postman.com/meta/messenger-platform-api/documentation/iyp204x/messenger-platform-api), [Meta Send API](https://www.postman.com/meta/messenger-platform-api/folder/7cc3gd2/send-api).

Implemented outbound capabilities are text and verified HTTPS image URLs, plus seen and typing presence. File sends, message replies, reactions, and product payload sends are not enabled as native capabilities; unsupported reply/reaction/file actions return `CAPABILITY_UNAVAILABLE`, and product actions use the existing approved text fallback. These API operations were not verified for this adapter. Text over 2,000 characters returns a safe capability error. Sends are idempotency-keyed; definitive rate limits retry through Phase 5 backoff, while ambiguous outcomes remain UNKNOWN pending reconciliation.

Webhook requests are signature-checked against the exact raw body before payload trust. Page ID resolves the connection and tenant server-side. Duplicates are serialized and deduplicated in the durable event path; echo/Page messages are filtered. Text, image/audio/document references, reply IDs, external IDs, source timestamps, and delivery/read receipts map into universal events and tenant-scoped message records. The webhook schedules media processing and acknowledges without running the agent or downloading attachment bytes inline.

## Page lifecycle and secrets

A Page moves through `DRAFT`, `CREDENTIALS_VERIFIED`, `TEST_PENDING`, and `CONNECTED`; failures can set `FAILED` or `NEEDS_REAUTHORIZATION`. Activation checks the Page identity and subscription again and requires a verified credential, Meta webhook handshake, actual inbound test message for the Page/business, and a controlled reply within the supported response window. The test conversation remains paused after activation. Human handoff, paused Pages, stale conversations, and closed response windows block automatic replies.

OAuth uses one-use, expiring, actor- and tenant-scoped state. Manual setup accepts Page ID and write-only Page token for an authorized agency manager. AES-256-GCM credentials are held in the database vault with key versioning. Tokens and media source URLs do not enter model context, trace, audit metadata, realtime, or browser responses. OAuth tokens are revoked after Page selection. Reauthorization pauses a connection.

## Browser implementation and evidence

The project's declared package manager is Bun 1.3.14; browser containers use `oven/bun:1.3.14`. The local Chromium image built with Chromium **153.0.8010.52** for the build host architecture. Browser Use Pi was evaluated from its official TypeScript quickstart and browser API: its current interface centers on accessibility/coordinate actions and generated JavaScript, and does not provide the selector-based `click`, `type`, and `extract` contract. Running generated JavaScript without additional isolation would grant broad filesystem and network access. The selected implementation is a fixed-operation TypeScript CDP adapter in the Browser Use ecosystem; Browser Use Cloud is not used.

The browser worker uses an internal Docker network, a read-only image filesystem, ephemeral browser profiles/screenshots, dropped Linux capabilities, no-new-privileges, resource limits, a per-session proxy, public-IP DNS checks, exact allowed domains, and CDP request interception. It receives no database, Redis, Meta, OpenAI, credential-vault, or media secrets. The host bridge only forwards authenticated browser control requests. Session timeouts kill Chromium; screenshots remain private and only opaque references cross back into AgentOS.

The browser images built successfully. A prior direct controlled-site smoke in the isolated container exercised real Chromium open, selector type/click, extraction, and close. At the user's direction, the full `scripts/phase6-browser-integration.ts` run was skipped in this completion turn; timeout, cancellation, screenshot privacy, policy denial, restart recovery, and safe realtime progress therefore lack fresh end-to-end evidence here. The script and test-only compose override are available for that verification. Do not treat Phase 6 as fully production verified until that run and live Page validation are complete.

Browser Use references: [Browser Use Pi quickstart](https://github.com/browser-use/browser-use-pi/blob/main/docs/quickstart.md), [browser API](https://github.com/browser-use/browser-use-pi/blob/main/docs/browser.md).

## Migrations and verification

Migrations `0000` through `0007` were preserved. `0008_hot_magdalene.sql` adds Phase 6 integration tables; `0009_damp_cyclops.sql` adds order Page/connection provenance. `bun run db:generate` completed with no schema changes after generation.

Verification completed:

- `bun run check`: TypeScript passed; 67 tests passed.
- `bun run admin:build` and `bun run client:build`: passed.
- `bun run db:phase5-smoke`: PostgreSQL/Redis smoke passed.
- `bun run db:phase6-messenger`: PostgreSQL/Redis durable path passed for manual and OAuth setup, encrypted credentials, verification gates, signed webhook, duplicate and echo filtering, reply references, delivery/read receipts, async media, paused test conversation, rate-limit retry, ambiguous-send reconciliation, unsupported capability, reauthorization, presence, tenant isolation, and order provenance.
- Browser Docker images built. No live Meta app credentials or test Page were available, so live Page verification remains **unverified**. The full browser integration script was skipped as stated above.

## Commits

- `234f4c2` — `feat(phase6): add Messenger onboarding and durable adapter`
- `2b2e9b4` — `feat(phase6): process Messenger media and preserve order provenance`
- `3cdbf64` — `feat(phase6): add isolated Chromium browser worker`
- The completion record is committed separately after validation.
