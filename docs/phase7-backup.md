# Phase 7 backup and restore

`scripts/phase7-backup.ts` creates a PostgreSQL custom-format dump and a copy of the private media tree. It writes SHA-256 and byte counts for each file in `manifest.json`. The destination must be new and outside the media tree. The script uses mode 0700 for directories and a 077 process umask. A failed backup removes its incomplete destination. Restore checks every checksum, refuses an existing media destination, and requires an empty PostgreSQL database.

Use PostgreSQL client binaries with the **same major version** as the server. Set `PG_BIN_DIR` to the directory containing matching `pg_dump` and `pg_restore` if the default `PATH` differs. The script checks this before dumping or restoring. Supply database URLs and media paths from the deployment secret manager; never check backups or credentials into Git.

## Schedule and storage

Run a backup daily, before every database migration, and immediately before a planned offboarding deletion. Use a unique absolute `BACKUP_DIR` each time. Schedule it in the host/orchestrator scheduler and alert if the command exits nonzero or no new verified manifest appears within 26 hours. Keep at least 30 daily copies and monthly copies according to the approved business retention contract. Copy completed backup directories to access-controlled, encrypted offsite storage with versioning or immutability. Test decryption and retrieval as part of the monthly restore drill. The backup contains customer content and encrypted credential rows; restrict access to recovery operators and audit access. Rotate and expire backups according to the longest approved legal and tenant retention requirement.

Example, with environment variables supplied securely by the scheduler:

```sh
PG_BIN_DIR=/path/to/matching/postgres/bin \
DATABASE_URL="$DATABASE_URL" \
PRIVATE_MEDIA_DIR=/var/lib/agentos/private-media \
BACKUP_DIR=/secure/backups/agentos-2026-09-24T000000Z \
bun scripts/phase7-backup.ts backup
```

The current file-backed media storage and database have no atomic shared snapshot. Pause inbound adapters, queue workers, media writes, and agent publication during a backup used for a strict point-in-time restore. Drain in-flight work first, then create the dump/media copy, resume after the manifest appears. Daily online backups are useful for disaster recovery but may need reconciliation of objects written during the copy. A production deployment using S3/R2 instead of `FileObjectStorage` must replace the local media copy with a versioned bucket snapshot and keep its object inventory/manifest with the database dump. `pg_dump` does not include cluster roles, server settings, or WAL. This is a full daily restore point, not point-in-time recovery.

## Restore drill and incident recovery

1. Fetch a backup into a restricted directory and verify the storage provider's encryption/authenticity controls. A plain SHA-256 manifest detects corruption, not malicious replacement of both data and manifest.
2. Provision a **new, empty** PostgreSQL database of the same major version. Provision a new media path that does not exist. Do not point the command at a live database or media directory.
3. With credentials supplied securely, run:

   ```sh
   PG_BIN_DIR=/path/to/matching/postgres/bin \
   RESTORE_DATABASE_URL="$RESTORE_DATABASE_URL" \
   BACKUP_SOURCE=/secure/backups/agentos-2026-09-24T000000Z \
   RESTORE_MEDIA_DIR=/var/lib/agentos/restored-media-2026-09-24 \
   bun scripts/phase7-backup.ts restore
   ```

4. Check the migration table, business and attachment row counts, selected scoped records, media hashes, and application read paths in an isolated deployment. Use staging credentials and block outbound sends during rehearsal. Point the application to the new database/media location only after validation. Reconcile channel webhooks and queues from their durable records; never blindly replay unknown external sends.
5. Record the restore time, recovery point, verified counts, operator, and any gaps. Perform this drill monthly and after a significant schema/storage change.

The restore uses a single transaction for the database. Media is copied afterward; if media copy fails, the new database remains restored and the partial new media tree is removed. Re-run into another fresh target after fixing the source. Never treat `RESTORE_COMPLETE` alone as application acceptance.

## Migration rollout and rollback

Use additive migrations: introduce nullable/new structures, deploy readers that tolerate both shapes, backfill, then separately enable writes and enforce stricter constraints after verification. Before each migration, take a verified backup and record the app/database version. Apply migrations to staging and perform a restore drill with the same PostgreSQL major version. Production rollback should first revert application traffic and feature flags where possible; applied migrations are not edited or automatically reversed. For a destructive migration or failed data backfill, restore into a new database from the pre-migration snapshot and switch over only after consistency checks. Preserve the failed database for investigation under restricted access.

## Verified local drill, 2026-09-24

On a disposable PostgreSQL 16.15 database, migrated the schema, inserted one test business, and created one file under a tenant-prefixed attachment object key. Backup using PostgreSQL 16.15 client binaries completed with one media file. Restore into a separate empty database completed; the business row count was one and source/restored media SHA-256 both equaled `06ef5892a96037b4eaac8d9b3dd5ee8765933a1f199b36cea53d2a163e091ae0`. A repeat restore rejected the populated database with `RESTORE_DATABASE_NOT_EMPTY`. The first attempt with PostgreSQL 18 client binaries against the 16 server failed; the script now detects a client/server major mismatch before backup or restore.
