import { selectRuntimeModelVariant, type AgentVersion } from "@agentos/agents";
import type { RuntimeVersionSelector } from "@agentos/agent-runtime";
import type { FeatureFlagKey } from "@agentos/feature-flags";
import type { TrustedBusinessContext } from "@agentos/shared";

type EffectiveFlagReader = { effective(businessId: string, key: FeatureFlagKey): Promise<boolean> };

export function featureFlaggedRuntimeSelector(flags: EffectiveFlagReader): RuntimeVersionSelector {
  return async (context: TrustedBusinessContext, version: AgentVersion) => selectRuntimeModelVariant(version, await flags.effective(context.businessId, "runtime_variant"));
}
