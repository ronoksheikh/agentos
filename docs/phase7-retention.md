# Phase 7 retention inventory

## Implemented cleanup

The worker runs `PostgresExpiredContentRetention.sweep()` at startup and every minute, one bounded batch of up to 100 attachments and 100 knowledge sources each time. It does not overlap sweep runs. One failed sweep emits only a safe error code and does not stop event processing. The database remains the source of truth.

| Data | Expiry source | Result |
| --- | --- | --- |
| Raw inbound envelope metadata | `raw_inbound_events.retention_until` (currently seven days at ingress) | Existing hourly Phase 5 sweep removes payload hash, external event ID, and byte count, and records `PURGED`; dedupe key and processing status remain. |
| Web Chat rate counters | Bucket `expires_at` | Existing Phase 5 sweep deletes old buckets. |
| Attachment object and derived transcript/vision/document text | `attachments.retention_until` | New sweep deletes the tenant-prefixed private object, derived artifacts, and attachment row after expiry, then writes a scoped audit record. In-flight `DOWNLOADING`/`PROCESSING` rows are skipped until terminal. |
| Knowledge source and indexed chunks | `knowledge_sources.retention_until` | New sweep deletes all chunks, clears title/URL/checksum/size, marks source `DELETED` and disabled, and writes a scoped audit record. |

The attachment and knowledge source APIs already refuse or exclude expired content before the physical sweep. A failed object deletion leaves the database row for retry, preventing a false record of completed deletion. Object keys are checked against business and attachment IDs before deletion. Audit entries carry IDs and counts/state only, not the deleted content.

## Remaining policy and deletion work

The current expiry values are set per record. There is not yet a business-level retention policy for messages, universal event payloads, traces/tool inputs, realtime projections, comments, browser history, orders, customer data, and audit logs. Some records have no expiry, so this sweep does **not** make per-business deletion complete. An offboarding request must currently be handled by a restricted, documented operator process after export and legal-hold review; there is no verified self-service cascade or tombstone workflow yet. Do not claim a tenant is erased merely because its expired media and knowledge were swept.

Before enabling broader scheduled deletion, add a reviewed per-business policy and classify every dependent table by required idempotency, financial, legal, and audit retention. Redact or delete content in dependency order; retain only minimal IDs needed for deduplication and compliance. Revoke channel credentials and visitor sessions, disable sites/automation, drain work and unknown sends, export permitted data, then execute and verify the approved deletion plan, including backups at their expiry. A trial expiry must never trigger deletion.

## Verification

`DATABASE_URL=...agentos_phase7_retention_... bun scripts/phase7-retention-integration.ts` on a freshly migrated disposable database inserted two businesses, one expired and one current attachment and knowledge source. It verified object and artifact deletion, chunk deletion, scrubbed source metadata, two scoped audit rows, survival of the other business's data, and a zero-change second sweep. This does not cover a production object store or legal offboarding signoff.
