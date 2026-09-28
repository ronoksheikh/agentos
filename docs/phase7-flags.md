# Phase 7 feature flags

Migration `0016_luxuriant_dragon_man.sql` makes global keys unique in the existing `feature_flags` table. `PostgresFeatureFlags` resolves a business override first, then a global row, then a built-in default. Agency changes require `feature_flag.manage`, use an expected revision, and write an audit record. Removing a business override returns it to the global value. The agency Feature Flags page exposes only gates with an active server-side consumer.

| Key | Built-in default | Server-side consumer |
| --- | --- | --- |
| `browser` | Enabled, preserving the prior production browser policy | The worker checks the effective value before granting `browser.use` to a run. Agent-version browser policy and domain controls still apply. |
| `comment_ai` | Disabled | The comment processor checks the effective value for every decision. Page policy, observed Meta capabilities, ownership, and business eligibility remain additional gates. |
| `advanced_memory` | Disabled | The worker context source checks the effective value for every context build. When off, saved customer memories are removed before context reaches the model; global and business overrides both apply. |

`experimental_tools` and `runtime_variant` remain reserved keys with disabled defaults. They stay absent from the agency form until production consumers and evaluation gates exist. The existing Page comment policy form may also set a business `comment_ai` override for compatibility; the general Feature Flags view shows its current revision.

Validation: fresh migration, `scripts/phase7-feature-flags-integration.ts` for global/tenant precedence, inheritance, optimistic revision, authorization, audit, browser capability grants, and advanced-memory override resolution; `tests/phase7-feature-flags-context.test.ts` verifies disabled memory is stripped before model context while other context layers remain. The fake Meta comment drill passed after switching decision-time flag reads to the effective resolver. Live rollout still requires a controlled tenant and provider checks.
