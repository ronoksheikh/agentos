import type { ContextSource } from "@agentos/context";
import type { TrustedBusinessContext } from "@agentos/shared";
import type { AgentEvent } from "@agentos/events";
import type { AgentVersion } from "@agentos/agents";
import type { FeatureFlagKey } from "@agentos/feature-flags";

type EffectiveFlagReader = { effective(businessId: string, key: FeatureFlagKey): Promise<boolean> };

/** Applies tenant/global rollout flags at context build time, before content reaches the model. */
export class FeatureFlaggedContextSource implements ContextSource {
  constructor(private readonly source: ContextSource, private readonly flags: EffectiveFlagReader) {}

  async load(context: TrustedBusinessContext, version: AgentVersion, event: AgentEvent): Promise<Awaited<ReturnType<ContextSource["load"]>>> {
    const layers = await this.source.load(context, version, event);
    if (await this.flags.effective(context.businessId, "advanced_memory")) return layers;
    const { customer_memory: _disabled, ...safeLayers } = layers;
    return safeLayers;
  }
}
