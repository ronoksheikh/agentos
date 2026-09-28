# Phase 7 feature flags

Migration `0016_luxuriant_dragon_man.sql` makes global keys unique in the existing `feature_flags` table. `PostgresFeatureFlags` resolves a business override first, then a global row, then a built-in default. Agency changes require `feature_flag.manage`, use an expected revision, and write an audit record. Removing a business override returns it to the global value. The agency Feature Flags page exposes only gates with an active server-side consumer.

| Key | Built-in default | Server-side consumer |
| --- | --- | --- |
| `browser` | Enabled, preserving the prior production browser policy | The worker checks the effective value before granting `browser.use` to a run. Agent-version browser policy and domain controls still apply. |
| `comment_ai` | Disabled | The comment processor checks the effective value for every decision. Page policy, observed Meta capabilities, ownership, and business eligibility remain additional gates. |
| `advanced_memory` | Disabled | The worker context source checks the effective value for every context build. When off, saved customer memories are removed before context reaches the model; global and business overrides both apply. |
| `experimental_tools` | Disabled | Adds the server-owned `experimental_tools.use` grant. Experimental tools remain hidden from model tool descriptions and denied at execution unless enabled by the agent version. The current consumer is `browser_research`, which also requires browser availability, `browser.use`, browser version policy, and approved domains. |
| `runtime_variant` | Disabled | On each server-side run, promotes an agent version's configured same-provider fallback model to primary and keeps the configured primary as retry fallback. The immutable saved version and revision do not change. If no compatible fallback is configured, the normal primary remains selected. |

Both gates support audited global defaults and business overrides, so operators can stage them for one business at a time. Evaluation runs use the currently effective runtime variant; changing a flag takes effect on subsequent runs. The existing Page comment policy form may also set a business `comment_ai` override for compatibility; the general Feature Flags view shows its current revision.

Validation: fresh migration, `bun run db:phase7-feature-flags` for global/tenant precedence, inheritance, optimistic revision, authorization, audit, browser and experimental-tool capability grants, and advanced-memory override resolution; `bun run check` includes tests for tool gating and model selection. `tests/phase7-feature-flags-context.test.ts` verifies disabled memory is stripped before model context while other context layers remain. The fake Meta comment drill passed after switching decision-time flag reads to the effective resolver. Live rollout still requires a controlled tenant and provider checks.
