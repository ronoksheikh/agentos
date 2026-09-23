# Phase 7 trial lifecycle

The offer is one calendar month of unlimited normal use, with no setup cost or commitment. An agency administrator starts it explicitly. The start/end timestamps are stored on `businesses`; `oneCalendarMonthFrom` preserves the UTC time and clamps dates such as January 31 to the last day of February. No payment or billing system is implied.

`PostgresTrialService` authorizes `business.manage` for activation, extension, expiry behavior, and state overrides. Each mutation is audited. Business members receive in-dashboard notifications on activation, three days before expiry, at expiry, on extension, and on service override. The worker sweeps due trials every minute; request-time eligibility also uses the dates, so a delayed sweep cannot silently keep an expired trial running.

At expiry, the default behavior pauses AI and new Website Chat sessions while keeping business data and staff access. An agency administrator can explicitly choose continued automation under agency sponsorship, extend the trial, or set the service to ACTIVE, PAUSED, or CANCELLED. `businessAutomationAllowed` is checked by the Phase 5 worker, Website Chat bootstrap/session validation, and the Facebook comment policy. Existing pre-Phase-7 `TRIAL` businesses without dates are moved to ACTIVE by migration `0013_legacy_trial_backfill.sql` so introducing dated eligibility does not interrupt their existing service. New businesses remain awaiting explicit trial activation.

Agency and client dashboards display the current state, dates, and expiry effect. Client views do not expose agency controls. Expiry and cancellation never delete records; retention and offboarding have separate procedures.

Validation: migration `0012_tidy_stature.sql` and the legacy backfill migrated cleanly. `scripts/phase7-trial-integration.ts` covers month-end dates, authorization, activation replay, warning dedupe, expiry, notifications, extension, sponsorship, pause, and retained data. The Website Chat integration drill covers dated expiry denial and an explicit continue override. No live subscription or billing claim is made.
