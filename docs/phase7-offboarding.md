# Phase 7 business offboarding

Offboarding is a restricted operator procedure. It is deliberately separate from trial expiry, which pauses or continues automation according to the business setting and never deletes data.

## Prepare

1. Confirm the request and scope with the authorized business owner. Complete any required export and legal-hold review. Revoke channel credentials with Meta and any other external providers, then disable the business, cancel it, disable website sites, and pause every channel connection. Record the external revocation, export decision, legal review, and operator identity.
2. Drain all work items to terminal states and resolve every reserved, executing, or unknown outbound effect through provider reconciliation. Close active browser sessions. The purge preflight rejects work in `PENDING`/`QUEUED`/`RUNNING`, outbound effects in `RESERVED`/`EXECUTING`/`UNKNOWN`, unpaused connections, enabled sites, or open/running browser sessions.
3. Run a read-only inventory. It prints only business ID, lifecycle state, disabled state, and nonzero table counts:

   ```sh
   OFFBOARD_BUSINESS_ID=<business-ulid> \
   DATABASE_URL="$DATABASE_URL" \
   bun scripts/phase7-offboard.ts plan
   ```

4. Pause adapters and workers for the business, take a new verified database/media backup, and confirm the generated v2 manifest names the target database and business and includes every object referenced by its attachment rows. The backup must be less than 24 hours old. The backup must be encrypted and retained only for the approved recovery/retention period.

## Purge

Only a designated recovery operator should run this after preparation. Values below come from the secret manager/operator process; do not put secrets in shell history. `OFFBOARD_EXPORT_APPROVED=1` records that export was completed or explicitly declined by the authorized owner. `OFFBOARD_EXTERNAL_TOKENS_REVOKED=1` and `OFFBOARD_LEGAL_HOLD_CLEARED=1` are operator attestations; the script cannot verify external-provider revocation or a legal decision.

```sh
OFFBOARD_BUSINESS_ID=<business-ulid> \
OFFBOARD_CONFIRM=DELETE:<business-ulid> \
OFFBOARD_OPERATOR_ID=<operator-id> \
OFFBOARD_BACKUP_SOURCE=/secure/backups/<new-backup> \
OFFBOARD_LEGAL_HOLD_CLEARED=1 \
OFFBOARD_EXPORT_APPROVED=1 \
OFFBOARD_EXTERNAL_TOKENS_REVOKED=1 \
DATABASE_URL="$DATABASE_URL" \
PRIVATE_MEDIA_DIR=/var/lib/agentos/private-media \
bun scripts/phase7-offboard.ts purge
```

The command checks the target is disabled and cancelled, confirms a fresh backup for the same database contains the business and all currently referenced attachment objects, validates media checksums, and checks draining conditions while holding the business row lock. It removes the business's private media directory, deletes all rows with that business ID in foreign-key dependency order, deletes the business row, and records one global audit entry containing table counts and the operator ID. If an unknown non-scoped reference or future schema dependency prevents deletion, the database transaction rolls back and the operator must investigate. Media is removed before database commit; if the transaction fails, restore media from the verified backup before retrying.

Shared global user accounts remain; this procedure removes only their membership in the offboarded business. Authorship and other businesses' memberships are preserved. Expired database/media backup copies still contain recoverable tenant data until their scheduled expiry. External provider systems and legal erasure requests need their own verified procedures. The script does not claim those copies or systems were erased.

## Verification

Use `scripts/phase7-offboard-integration.ts prepare|verify` only with a disposable database whose name contains `agentos_phase7_offboard` and a disposable media root. The 2026-09-25 local PostgreSQL 16 drill created two businesses with conversations, messages, attachments/artifacts, knowledge sources/chunks, and a shared user. It confirmed plan inventory, refusal without attestations and with a mismatched backup, a successful purge with a fresh database-matched backup, removal of the target business/media/content, preservation of the other business and shared user, and a global audit row.
