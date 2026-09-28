# Phase 7 in-dashboard notifications

The client overview reads the latest 20 notification rows for the authenticated user and selected business. It projects only notification ID, type, severity, conversation ID, creation time, and acknowledgement time; the stored `safePayload` is not sent to the browser. A user can acknowledge only their own row in their current business, and acknowledgement is idempotent. The client action rechecks active membership and `notification.manage` on submission.

| Type | Producer | Behavior |
| --- | --- | --- |
| `HANDOFF_REQUESTED` | `PostgresRuntimeDomainActions` | Written in the same transaction as a newly created handoff, once per current business member. Dedupe follows the handoff request; severity reflects its safe priority. Payload contains priority only. |
| `AGENT_RUN_FAILED` | `Phase5Processor` | Written after a non-retryable failed AgentOS run, once per run and business member. Retryable failures and cancellations do not notify. Payload contains the safe error code only. |
| `QUEUE_WORK_DEAD` | `Phase5Store.finishWork` | Written transactionally when durable work reaches `DEAD`, once per work item and business member. Payload contains the work kind and safe failure code only. |
| `COMMENT_REVIEW` | Facebook comment processor | Written for business members when a comment requires review. The inbox hides the private payload and links to the comment review page only when its conversation is available. |
| Trial lifecycle types | Trial lifecycle service | Written for business members when the recorded trial event occurs. |

The existing notification table's unique key makes producer retries idempotent per business, recipient, and dedupe key. The read path scopes by both authenticated business and user; acknowledgement also filters on both before updating. It does not reveal another user's notifications, raw payloads, prompts, or provider errors.

Validation: the PostgreSQL client analytics drill verifies per-user/per-business inbox filtering, payload omission, acknowledgment authorization/idempotency, and handoff notification creation for all business members with duplicate handoff action suppression. The Phase 5 PostgreSQL/Redis integration verifies terminal run-failure notifications and dead-work notification deduplication with safe payloads. UI tests verify the overview inbox and safe handoff label. Channel disconnect/reauthorization and stale-handoff notifications still need durable producers before those alert types can be claimed as delivered.
