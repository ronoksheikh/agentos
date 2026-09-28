# Phase 7 retention inventory

## Scheduled cleanup

The worker runs expiry cleanup and age based content scrubbing at startup and every minute. Each pass is limited to 100 rows per category per business. A failed pass logs a safe error code and does not stop event processing. Scrubbing is idempotent across repeated passes and worker instances.

| Data | Expiry source | Result |
| --- | --- | --- |
| Raw inbound envelope metadata | `raw_inbound_events.retention_until` (seven days at ingress) | Existing Phase 5 sweep removes payload hash, external event ID, and byte count; dedupe key and processing status remain. |
| Web Chat rate counters | Bucket `expires_at` | Existing Phase 5 sweep deletes old buckets. |
| Attachment object and derived transcript/vision/document text | `attachments.retention_until` | Deletes the tenant-prefixed private object, derived artifacts, and attachment row after expiry, then writes a scoped audit record. In-flight rows are skipped until terminal. |
| Knowledge source and indexed chunks | `knowledge_sources.retention_until` | Deletes chunks, clears title/URL/checksum/size, marks the source deleted and disabled, and writes an audit record. |
| Message text and lifecycle details | Per-business `messages_days` | Clears old message text and lifecycle details, retaining message IDs, routing state, and idempotency identifiers. |
| Processed universal event payload/source | Per-business `event_payload_days` | Scrubs processed events only. Pending or unprocessed events remain intact. Event IDs, type, state, and dedupe keys remain. |
| Completed run, step, tool, and action details | Per-business `trace_details_days` | Clears step facts, tool input/output/error, action payload, and safe run error. Run status and usage remain; running jobs are excluded. |
| Realtime and client projection payloads | Per-business `realtime_payload_days` | Replaces old payloads while preserving event type, sequence, and replay ordering. |
| Browser URLs | Per-business `browser_history_days` | Clears old safe URLs while keeping status/action codes. Browser screenshots live in bounded tmpfs and are removed when sessions close or the worker container restarts. |
| Facebook comment text and author IDs | Per-business `comment_text_days` | Clears old comment text and author external IDs and replaces linked classifier details with a redacted marker. Decision state/action result remain. |
| Customer profiles and saved context | Per-business `customer_content_days` | Clears aged customer display names/tags, identity metadata, verification timestamps and match evidence, memory and summary text, pin labels, and customer note text. Customer, identity, memory, conversation, and message IDs remain; channel/external identity keys remain for routing and deduplication. |
| Order note text | Per-business `order_notes_days` | Replaces aged freeform order notes with a redaction marker. Order, item, total, status, and accounting records remain intact. |
| Closed goal content | Per-business `resolved_goals_days` | Replaces descriptions and trigger payloads of aged goals whose state is no longer `PENDING`. Active goals and execution/idempotency records remain. |
| Expired announcement content | Per-business `expired_announcements_days` | Replaces content and clears channel/agent targeting for announcements expired before the configured cutoff; marks them inactive. Current announcements remain. |
| Older audit metadata | Per-business `audit_metadata_days` | Replaces safe metadata with a redaction marker while preserving action, target, actor, and timestamp. Retention-policy change records and global audit records are excluded. |

Attachment and knowledge APIs exclude expired content before the physical sweep. A failed private object deletion leaves its row for retry. Object keys are checked against business and attachment IDs. Audit entries retain only IDs, counts, category, cutoff, and policy revision.

## Business policy controls

Migration `0018_nostalgic_nicolaos.sql` adds `business_retention_policies`; `0019_luxuriant_namor.sql` adds the customer-context age rule; `0021_lying_pepper_potts.sql` adds the order-note, closed-goal, and expired-announcement age rules; `0022_far_robbie_robertson.sql` adds audit-metadata aging. Policy is disabled by default, and each category remains unset until an agency ADMIN or SUPER_ADMIN configures it on the Content Retention page. Enabling scheduled scrubbing requires explicit confirmation. Empty category rules retain that content. Policy edits are revision checked and audited. Trial expiry does not enable or run these rules.

## Remaining policy and deletion work

Age rules leave external channel identity keys intact for routing and deduplication. Order note text, closed goal content, expired announcement content, and older business audit metadata can be scrubbed under separate business rules. Financial order, order item, order audit, active goal, goal execution, audit event identity, retention-policy audit metadata, and backup records remain intact pending accounting, legal-hold, and operational retention schedules. The restricted operator purge exists after export and legal-hold review; see `docs/phase7-offboarding.md`. It removes business-scoped database rows and private media while retaining one global deletion audit row. External-provider records and backups are governed separately; complete legal erasure cannot be claimed until they expire or are independently erased.

Before an approved offboarding purge, revoke channel credentials and visitor sessions, disable sites/automation, drain work and unknown sends, export permitted data, then verify the approved deletion plan. Trial expiry must never trigger data deletion.

## Verification

`bun run db:phase7-retention` on disposable PostgreSQL 16 verified attachment/object and knowledge/chunk cleanup, scoped audit records, cross-tenant survival, and a zero-change second sweep.

`DATABASE_URL=<disposable PostgreSQL URL> bun run db:phase7-retention-policy` verifies policy default-off, explicit confirmation, authorization, revision conflict, tenant isolation, pending-event and active-goal preservation, event/profile/memory/summary/pin/customer-note/order-note/closed-goal/expired-announcement/audit-metadata scrubbing, order accounting and audit identity preservation, identity-key preservation, content-free audit output, and repeated-sweep idempotency. The migration and drill passed on a fresh disposable PostgreSQL 16 database. Neither drill used a production object store or performed legal offboarding signoff.
