# Phase 6 — Facebook Messenger Reference Adapter and Meta Credentials

## Before implementing this phase

1. Read `ARCHITECTURE.md`, `plan.md`, and every preceding phase plan completely.
2. Read all available completion notes through `docs/completion/phase5.md`.
3. Inspect actual universal event, queue, lock, action idempotency, attachment, handoff, credentials, channel capability, and dashboard contracts.
4. Verify current Meta requirements, permissions, webhook signatures, token behavior, and permitted capabilities from authoritative Meta documentation during implementation. Do not copy speculative API names or URLs from this planning document.
5. Verify the current Browser Use TypeScript integration, runtime requirements, and local-browser support from its official documentation before replacing Phase 4's fake browser adapter in non-test composition.

## Goal

Deliver the first and only initial production channel implementation: `FacebookMessengerAdapter`. It is the reference implementation of the shared `ChannelAdapter` contract, translating Meta Messenger inbound/outbound behavior through Universal Events and Universal Channel Actions while keeping Meta credentials business-scoped, secret-safe, observable, and out of AgentOS core. Also connect a real Browser Use-backed browser implementation to the existing Phase 4 browser contracts so approved browser tools can operate a real browser; this is a tool provider, not another channel adapter.

## Inherited From Previous Phases

- Runtime accepts only normalized events and returns Universal Channel Actions; processors own execution policy and adapters own channel calls.
- Unified `ChannelAdapter` inbound contract, `ChannelRegistry`, raw-event persistence, rapid acknowledgement, queues, dedupe, buffering, locks, `ResponseTimingPolicy`/`PresenceController`, retry/idempotency, cancellation, action lifecycle, and safe realtime.
- Generalized encrypted credential references, business/channel connection model, attachment pipeline, handoff ownership, capabilities, client/agency RBAC and audit rules.
- Phase 4 `BrowserAdapter`/`BrowserExecutionService`/`BrowserCoordinator` policy boundary and Phase 5 BROWSER work queue; their current fake browser adapter is for deterministic tests only.

Do not pass a Meta webhook body to `AgentRuntime`, call a model/browser while a webhook is open, store page tokens in plaintext, send tokens to a model/UI/log/trace, or create Messenger-specific branches in core tools/context/runtime.

## New Contracts Introduced In This Phase

- `FacebookMessengerAdapter`, registered under `facebook_messenger`, as the first reference implementation of the shared `ChannelAdapter` contract. Its private module may contain Meta webhook verification, normalizer, API client, presence integration, attachment mapping, and connection services; none is a second external channel boundary.
- Facebook `ChannelConnection` subtype/settings: external page identity, display metadata, assigned published agent, connection/page status, granted capabilities, encrypted credential reference(s), token lifecycle metadata, health/webhook state, and business-scoped response policy.
- Two agency-only connection flows that converge on the same secure connection record: preferred OAuth/automatic Page selection and controlled manual Page setup with write-only credentials.
- A gated Page connection verification state machine: `DRAFT`, `CREDENTIALS_VERIFIED`, `WEBHOOK_VERIFIED`, `TEST_PENDING`, `CONNECTED`, `FAILED`, `NEEDS_REAUTHORIZATION` (and an explicit paused/disabled operational state where appropriate).
- Normalized mapping and source metadata contract for Messenger messages, attachments, deliveries, reads, and reserved `comment.created` events.
- Messenger capability declaration and adapter mapping for `SendMessage`, `SendImage`, `SendFile` where verified, `ReplyToMessage`, `ReactToMessage` where verified, mark-seen, typing on/off, delivery/read state, and external-open behavior; unavailable Universal Channel Actions must fail with a typed capability error, not improvisation.
- Secure connection/onboarding/re-authorization workflow and redacted operational health contract.
- A production Browser Use-backed adapter/composition for the existing browser boundary, with an isolated browser execution environment, session lifecycle, cancellation, progress, and safe result projection. Keep the fake adapter for tests.

## Scope

### General credentials and Meta connection security

Use the generalized business-scoped credential layer, not a new Facebook token table that stores secrets directly. Page/user/token material is encrypted at rest with key/version metadata or held as a managed secret reference; decryption happens only server-side at point of use. Access is restricted to the Meta adapter/service; all logs, traces, errors, audit metadata, realtime payloads, database queries returned to UI, browser state, and model context use redacted references/status only.

Model connection state such as `DISCONNECTED`, `CONNECTED`, `NEEDS_REAUTHORIZATION`, `ERROR`, and optional `PAUSED`; record granted scopes/capabilities, safe expiry/refresh metadata, last verified/last webhook/last error timestamps, and health checks. Exact token refresh semantics must follow current Meta documentation. Connection changes, credential updates, reauthorization, assignment, pause/resume, and disconnection are audited and notify appropriate agency/client users without leaking values.

### Page connection wizard: OAuth and manual setup

The agency dashboard provides two explicit paths; both are restricted to authorized agency capabilities and create the same business-scoped connection model.

**Preferred OAuth/automatic path:** Add Facebook Page → authenticated Meta OAuth/login → choose an authorized Page → backend obtains the currently required credentials → verify Page identity/capabilities → configure/confirm webhook subscription → controlled test → activate. The UI never receives or persists raw page credentials outside the server credential vault flow.

**Manual path:** the agency may enter Page ID and the currently required Page access token/Meta credential, plus app-related identifiers or webhook setup values only if verified current Meta requirements need them. The wizard displays the canonical webhook callback URL and the required verification information for an administrator to configure in Meta Developer Dashboard. It presents a write-only Page Access Token input; after save it shows only safe presence, replacement, and verification state. Stored tokens must never be revealed again through the UI/API. Verification tokens/secrets are generated/stored/rotated server-side and are never broadly displayed after initial controlled setup; the dashboard may show a deliberately copyable setup value only to an authorized agency user when policy permits, then show redacted status.

Manual entry is not activation. Both flows enter the same gated sequence: (1) verify credentials; (2) verify that the expected Page identity was found; (3) verify webhook endpoint/subscription; (4) enter `TEST_PENDING` and instruct the agency to send a real controlled Messenger test message; (5) confirm receipt, correct business/page/conversation routing, and allowed reply capability; (6) send a controlled test reply only where current policy/platform support permits; (7) mark `CONNECTED` and optionally enable live automation. A critical next step stays unavailable until the prior required check succeeds. Failure diagnostics distinguish credential, Page identity, webhook/signature/subscription, test-message receipt/routing, reply capability, permission, and transient provider failures without revealing secrets. Current Meta permission names and callback requirements are verified at implementation time, not hardcoded here.

### Messenger adapter inbound handling

Keep implementation isolated under a channel module such as `channels/facebook-messenger`; only `FacebookMessengerAdapter` and its private helpers import Meta SDK/API code. Register exactly one initial production adapter:

```ts
channelRegistry.register("facebook_messenger", facebookMessengerAdapter);
```

The adapter's inbound webhook handler (unless verified requirements force a different private topology) owns verification and incoming notifications. Its order is mandatory:

```text
receive -> verify current Meta signature/handshake -> identify configured page/connection
-> derive dedupe key -> persist controlled raw event -> normalize -> enqueue
-> return protocol-required success quickly
```

It never waits for AgentOS, attachment download, browser work, or outbound reply. Unknown/unconfigured pages, invalid signatures, malformed payloads, and permission failures are safely recorded/rejected according to Meta protocol. Webhook retry dedupe uses provider event/message IDs plus a defensible fallback strategy; repeated input must not produce duplicate messages/actions.

The connection wizard's test-message verification uses this exact adapter inbound path and records evidence (received source event, selected page/business, normalized conversation/message, and optional controlled reply result) in safe connection diagnostics. Test traffic is visibly labeled and must not accidentally trigger normal customer automation or production side effects beyond the narrow approved verification action.

### Normalization, customer identity, and attachments

Normalize supported Messenger text into `message.received`; normalize delivery/read receipts into generic status events; preserve `attachment.received` and message attachment references for the existing attachment pipeline; reserve comment events for Phase 7. Filter Page/self/echo messages before customer processing while retaining safe diagnostics when needed. Preserve channel message IDs, sender/page/thread IDs, external timestamps, reply-to relationships, attachment metadata, and edit/delete semantics when Meta supports them. Maintain safe raw source metadata and external IDs separately from internal ULIDs.

Resolve the business/page/assigned agent server-side from the channel connection. Create or look up a Facebook-scoped `CustomerIdentity`; do not merge it with website/Instagram identities merely by a matching display name. Map external thread/conversation identifiers to business-scoped conversations. Message burst policy, ownership/handoff state, and existing conversation locks apply unchanged.

When the business has enabled conversational ordering, Messenger uses the existing pending-order/context/commerce-tool flow from Phase 4. The Facebook module only supplies channel/source metadata and renders generic product/message actions according to capabilities; it must not collect Messenger-specific checkout fields or create a separate order model. An order created from this path records `MESSENGER` source, originating message IDs, conversation, Page connection, and generic order provenance.

### `FacebookMessengerAdapter` capabilities and outbound execution

The adapter translates validated Universal Channel Actions to currently supported Messenger operations: `SendMessage`, `SendImage`, `SendFile`, `ReplyToMessage`, and `ReactToMessage`, plus `PresenceController` requests for mark-seen and typing. It also handles delivery/read callbacks and external conversation reference lookup. Declare capabilities such as `canSendText`, `canSendImage`, `canSendFile`, `canReact`, `canMarkSeen`, `canShowTyping`, `canReplyToMessage`, and `canOpenExternalConversation` based on verified platform support and page configuration. It must enforce outgoing idempotency, map external Meta message IDs to internal message/action records, and translate transient/permanent/rate-limit errors to the Phase-5 typed failure and retry policy.

For supported capabilities, the normal message path is policy-driven:

```text
accepted/buffered/queued message (no seen, no typing)
-> worker acquires the serialized conversation / run begins (mark seen once when supported)
-> AgentOS context, model, tools, browser, and media work (no blanket typing)
-> final customer-facing response composition begins (typing on)
-> bounded delivery timing if appropriate -> Universal Channel Action -> adapter send/reply
-> typing off
```

`PresenceController` owns this lifecycle; it is infrastructure, not an LLM tool or a Messenger branch in AgentRuntime. It may pause/restart typing for a genuine composition-state change or newer batch, and renew only where the current Meta capability requires it. It must clean up typing on successful send, send failure, timeout, cancellation, stale-response suppression, human takeover, pause, disabled agent/business, or channel disconnect. Do not mark messages seen merely because they are waiting in a queue, and do not keep typing through generic internal tool/browser work. Capability checks and current Meta API verification determine exact calls; AgentOS itself remains unaware of Messenger details.

Do not assume an external Messenger/Business Suite deep-link is always reliable. `getExternalConversationUrl` returns a verified URL when possible; otherwise return the best safe page/Business Suite reference and relevant external identifiers for authorized UI display. It must never fabricate a link.

### Handoffs, page settings, dashboards, and notifications

Reuse the Phase 3 handoff record. On `request_human`, retain Facebook channel/page/conversation references and external link/reference if available, notify in-dashboard, and honor page/business policy for automatic pause. A human takeover stops agent replies by default; resolve and explicit resume keep existing semantics.

Agency UI: business pages/connections list, OAuth and Manual Setup entry points, assigned agent/version, page capabilities, connection health, webhook activity/errors, paused/live setting, channel-specific `ResponseTimingPolicy` overrides within business maximums, buffer/delivery/handoff policy, and a Mantine Stepper-style verification wizard. The manual screen presents Page ID, write-only Page Access Token/required credential, verified-required app fields, webhook callback URL, and controlled verification-token instructions with copy/status affordances as allowed by policy. Progress shows concrete safe diagnostics such as “Page credentials valid,” “Page found,” “Webhook subscribed,” “Waiting for test Messenger message,” “Test message routed to correct business,” and “Reply capability verified.” It also provides clear loading, retry, failed, needs-reauthorization, and connected states.

Client UI: Facebook conversation filtering, safe realtime view, handoff external-open action/reference, delivery/send failure status, and connection health appropriate to role. Both use existing Next.js/Mantine rules and role/tenant enforcement; neither can view/edit stored token material.

### Real Browser Use execution for existing browser tools

Replace fake-only browser composition for approved non-test runs with an adapter from the Browser Use project family. The main `browser-use/browser-use` open-source library is Python, while AgentOS remains TypeScript; evaluate the official TypeScript Browser Use Pi package (`@browser_use/pi`) and its local Chrome option first. Verify its current Bun/Node requirements and upgrade the project's declared Bun/runtime versions coherently if needed. Do not introduce Python into `AgentRuntime`, silently switch to paid Browser Use Cloud, or assume that an SDK's worker is a security sandbox. If the current TypeScript Browser Use API cannot satisfy the existing `BrowserAdapter`/`BrowserExecutionService` methods safely, document the concrete mismatch and use a small TypeScript Browser Use ecosystem/CDP adapter only with a deliberate, compatible contract decision.

Run the real browser in a dedicated, isolated worker/container within the same monorepo and Phase 5 BROWSER work topology. Keep business/run/session ownership, domain and egress policy, per-run limits, timeouts, cancellation, storage and screenshot redaction, credential-vault access, safe activity events, and cleanup/recovery under the existing `BrowserCoordinator`. Never give browser-generated code unrestricted access to AgentOS files, database credentials, or unrelated network destinations. The fake adapter remains for deterministic tests; non-test composition must use the real adapter or fail closed with a visible unavailable status, never quietly return fixture data.

Prove open/navigation, click, type, extract, screenshot reference, close, cancellation, timeout, policy denial, and safe progress against a controlled test site using a real browser. Where Browser Use offers a higher-level autonomous task interface, keep its output bounded and untrusted and do not let it bypass existing tool permissions or perform unapproved side effects. Browser work remains separate from Messenger webhook acknowledgement and channel presence timing.

### API, data, operations, and tests

Use new migrations for connection/page metadata, credential references/audit, external message/thread mappings, page settings/capabilities, health/re-auth notifications, and any source mapping required. Do not alter historical migrations. APIs authorize agency/client scope and keep credential writes server-side; client-facing APIs expose safe connection status only.

Add health metrics for webhook volume/verification failures, normalized-event lag, page connection/re-auth state, channel send success/error/latency, duplicate rate, and token/permission issues. Follow phase-5 replay/DLQ rules: replay is audited/scoped/idempotent and avoids blindly resending irreversible messages.

## Tests and validation

- OAuth and manual setup tests: both paths create only encrypted/write-only credential references; no stored token can be read back; invalid Page ID/token/configuration is diagnosed and cannot reach `CONNECTED`.
- Verification-wizard tests: required steps are gated; credential/Page identity/webhook/test-message routing/controlled reply evidence advances the correct state; failure/retry/reauthorization diagnostics are safe; test traffic does not invoke normal automation.
- Verification/signature tests use fixtures derived from current Meta documentation; invalid or replayed signatures fail safely.
- Adapter inbound webhook handling returns rapidly while a model, attachment, or browser job is intentionally slow; raw event/normalization/enqueue has correct state.
- Page/business routing: multiple pages and businesses remain isolated; forged page/thread/customer IDs cannot cross scope.
- Deduplication/idempotency: duplicate webhook/message/action/retry results in one internal message and one external send effect.
- Reference-adapter end-to-end with a fake Meta API: Messenger text → `FacebookMessengerAdapter` → normalized event → buffer/lock/runtime → Channel Registry/PresenceController → capability-checked Universal Channel Action → `FacebookMessengerAdapter` response. Verify external/internal message mapping, self/echo filtering, attachments, replies/references, delivery/read updates, rate-limit/backoff, and outbound idempotency. Enabled conversational order uses the existing pending-order/create-order path and records Messenger provenance; delivery/read updates do not spuriously run AgentOS.
- Credential/redaction: ciphertext/reference only at rest and no token in logs, audit, API, WS, client UI, model input, or trace projection; reauth/error state works.
- Capability/activity/handoff: unsupported action typed failure; queued/buffered messages do not mark seen; seen begins only after worker acquisition; typing begins only at final composition and stops reliably on every terminal state; page settings respected; external-open URL only when verified; human takeover blocks automation.
- Existing fake WebChat contract/event/queue/client tests remain green; no production WebChat adapter is introduced.
- Real-browser integration: a controlled local test site proves all supported browser operations, isolated sessions, domain/egress denial, cancellation/timeout, screenshot handling, worker recovery, safe realtime progress, and fail-closed behavior when browser infrastructure is unavailable. Fake adapter tests remain deterministic and are not presented as proof of real-browser operation.

## Do Not Build Yet

No Facebook comment decision/reply/moderation logic, production Instagram/WhatsApp/Telegram/WebChat adapters, custom human inbox, billing, or a rewrite of shared event/runtime/tool/credential architecture.

## Deferred To Later Phases

Phase 7 activates normalized Facebook comments through the specialized Comment Processor, adds policy-driven moderation/replies/analytics, completes trial lifecycle and system hardening, and expands regression/evaluation operations. Instagram, Telegram, WhatsApp, and WebChat later register their own adapters against the same contract; none requires an AgentRuntime rewrite.

## Definition of Done

1. Multiple Pages can be connected to distinct businesses/agents through either OAuth or manual write-only setup, with encrypted, redacted, reauthorizable credential references.
2. A Page cannot become connected/live until credentials, identity, webhook, real test-message routing, and applicable reply capability have passed the gated verification flow.
3. `FacebookMessengerAdapter` proves the shared `ChannelAdapter`/registry, Universal Event/Action, capability, presence, attachment, message-ID mapping, retry, and observability contracts without Meta-specific runtime branches.
4. Webhooks verify, persist/deduplicate/normalize/enqueue, and acknowledge promptly under failures/load.
5. Customer identity, messages, attachments, buffering, ownership/handoffs, realtime, retries, and idempotency preserve tenant/channel contracts.
6. Agency/client dashboards safely manage/view page operations without credential exposure.
7. Current-Meta contract tests and all integration/security/regression tests pass.
8. Approved non-test browser work uses a verified, isolated Browser Use-backed TypeScript adapter through the existing browser tools and Phase 5 BROWSER queue; real-browser integration tests pass and fake-only results cannot be mistaken for production behavior.

## Completion Note

After implementation, write `docs/completion/phase6.md` with verified Meta assumptions/version, page connection fields/states, webhook/normalization mappings, adapter capabilities, credential handling, Browser Use package/runtime choice and isolation model, real-browser test evidence, migrations/APIs, tests, limitations, and deviations. Phase 7 must read it first.
