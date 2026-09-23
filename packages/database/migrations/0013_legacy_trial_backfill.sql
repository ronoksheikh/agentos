-- Legacy TRIAL rows had no start/end dates but were allowed to run indefinitely.
-- Preserve that existing service as agency-sponsored ACTIVE before dated eligibility is enforced.
UPDATE "businesses"
SET "state" = 'ACTIVE', "revision" = "revision" + 1, "updated_at" = NOW()
WHERE "state" = 'TRIAL' AND "trial_started_at" IS NULL AND "trial_ends_at" IS NULL;
