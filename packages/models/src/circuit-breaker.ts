import type { ModelProvider, ModelRequest, ModelResponse } from "./index";

export type ModelCircuitState = "closed" | "open" | "half_open";
export type ModelCircuitSnapshot = { state: ModelCircuitState; consecutiveFailures: number; retryAfterMs: number };

/** Fails fast during provider outages and permits one bounded half-open probe. */
export class CircuitBreakerModelProvider implements ModelProvider {
  private failures = 0;
  private failureEpoch = 0;
  private openedAt: number | null = null;
  private probeInFlight = false;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(private readonly inner: ModelProvider, options: { failureThreshold?: number; cooldownMs?: number; now?: () => number } = {}) {
    this.threshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.now = options.now ?? Date.now;
    if (!Number.isInteger(this.threshold) || this.threshold < 1 || this.threshold > 10 || !Number.isInteger(this.cooldownMs) || this.cooldownMs < 1_000 || this.cooldownMs > 300_000) throw new Error("MODEL_CIRCUIT_CONFIGURATION_INVALID");
  }

  status(): ModelCircuitSnapshot {
    if (this.openedAt === null) return { state: "closed", consecutiveFailures: this.failures, retryAfterMs: 0 };
    const retryAfterMs = Math.max(0, this.openedAt + this.cooldownMs - this.now());
    return { state: retryAfterMs > 0 || this.probeInFlight ? "open" : "half_open", consecutiveFailures: this.failures, retryAfterMs };
  }

  private unavailable(request: ModelRequest, code: "UNAVAILABLE" | "CANCELLED" = "UNAVAILABLE"): ModelResponse {
    return { kind: "error", provider: "openai", model: request.version.config.models.primary.model, latencyMs: 0, error: { code, message: code === "CANCELLED" ? "Run cancelled" : "Model provider circuit is open", retryable: code === "UNAVAILABLE" } };
  }

  private recordFailure() {
    this.failureEpoch++;
    this.failures++;
    if (this.failures >= this.threshold) this.openedAt = this.now();
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    if (request.signal.aborted) return this.unavailable(request, "CANCELLED");
    const requestEpoch = this.failureEpoch;
    let probe = false;
    if (this.openedAt !== null) {
      if (this.now() < this.openedAt + this.cooldownMs || this.probeInFlight) return this.unavailable(request);
      this.probeInFlight = true;
      probe = true;
    }
    try {
      const response = await this.inner.generate(request);
      if (response.kind !== "error" || !response.error.retryable) {
        if (probe || requestEpoch === this.failureEpoch) { this.failures = 0; this.openedAt = null; }
      } else if (response.error.code === "CANCELLED" || request.signal.aborted) {
        if (probe) this.openedAt = this.now();
      } else if (probe) {
        this.failureEpoch++; this.failures = Math.max(this.threshold, this.failures + 1); this.openedAt = this.now();
      } else {
        this.recordFailure();
      }
      return response;
    } catch {
      if (request.signal.aborted) {
        if (probe) this.openedAt = this.now();
        return this.unavailable(request, "CANCELLED");
      }
      if (probe) { this.failureEpoch++; this.failures = Math.max(this.threshold, this.failures + 1); this.openedAt = this.now(); }
      else this.recordFailure();
      return this.unavailable(request);
    } finally {
      if (probe) this.probeInFlight = false;
    }
  }
}
