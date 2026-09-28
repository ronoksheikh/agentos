import { describe, expect, it } from "bun:test";
import { FeatureFlaggedContextSource } from "../apps/worker/src/feature-flagged-context";
import { event, createAgentFixture, trusted } from "./helpers";

describe("feature flag context gates", () => {
  it("removes saved customer memories before they reach model context when disabled", async () => {
    const calls: Array<[string, string]> = [];
    const source = {
      async load() { return { customer_memory: [{ sourceId: "memory", label: "Customer memory", reason: "Saved preference", content: "private preference" }], business: [{ sourceId: "business", label: "Business", reason: "Policy", content: "public policy" }] }; },
    };
    const flags = { async effective(businessId: string, key: "advanced_memory") { calls.push([businessId, key]); return false; } };
    const gated = await new FeatureFlaggedContextSource(source, flags).load(trusted(), createAgentFixture().version, event());
    expect(gated.customer_memory).toBeUndefined();
    expect(gated.business?.[0]?.content).toBe("public policy");
    expect(calls).toEqual([[trusted().businessId, "advanced_memory"]]);
  });

  it("keeps memories when the effective business/global flag is enabled", async () => {
    const source = { async load() { return { customer_memory: [{ sourceId: "memory", label: "Customer memory", reason: "Saved preference", content: "private preference" }] }; } };
    const flags = { async effective() { return true; } };
    const context = trusted();
    const gated = await new FeatureFlaggedContextSource(source, flags).load(context, createAgentFixture().version, event(context.businessId));
    expect(gated.customer_memory?.[0]?.content).toBe("private preference");
  });
});
