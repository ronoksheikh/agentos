import { z } from "zod";

export const ulidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/i, "Expected a ULID");
export const isoDateTimeSchema = z.iso.datetime({ offset: true });
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
);

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type MaybePromise<T> = T | Promise<T>;

export const trustedPrincipalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: ulidSchema, sessionId: z.string().min(1) }),
  z.object({ kind: z.literal("system"), service: z.string().min(1) }),
  z.object({ kind: z.literal("adapter"), connectionId: ulidSchema }),
]);

export const trustedBusinessContextSchema = z.object({
  businessId: ulidSchema,
  principal: trustedPrincipalSchema,
  source: z.enum(["authenticated_request", "verified_adapter", "internal_system", "test_harness"]),
  agentId: ulidSchema.optional(),
  conversationId: ulidSchema.optional(),
  customerId: ulidSchema.optional(),
  traceId: ulidSchema,
  capabilityGrants: z.array(z.string().min(1)).default([]),
});

export type TrustedBusinessContextData = z.infer<typeof trustedBusinessContextSchema>;
export type TrustedBusinessContext = TrustedBusinessContextData & { cancellationSignal: AbortSignal; includedInboundSequence?: number; conversationLease?: { assertOwner(): Promise<void> }; assertConversationFresh?: () => Promise<void> };

export function createTrustedBusinessContext(
  data: TrustedBusinessContextData,
  cancellationSignal: AbortSignal = new AbortController().signal,
): TrustedBusinessContext {
  return { ...trustedBusinessContextSchema.parse(data), cancellationSignal };
}

export const apiErrorEnvelopeSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: ulidSchema,
  details: z.record(z.string(), jsonValueSchema).optional(),
});

export const cursorPageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export class AgentOSError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly safeDetails?: Record<string, JsonValue>,
  ) {
    super(message);
    this.name = "AgentOSError";
  }
}

const secretKey = /token|secret|password|authorization|cookie|credential|api[-_]?key/i;

export function redactSafe(value: unknown, unsafeKeys: readonly string[] = []): JsonValue {
  const blocked = new Set(unsafeKeys.map((key) => key.toLowerCase()));
  const visit = (input: unknown, seen: WeakSet<object>): JsonValue => {
    if (input === null || typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input === "number") return Number.isFinite(input) ? input : String(input);
    if (typeof input === "bigint") return input.toString();
    if (typeof input === "undefined" || typeof input === "function" || typeof input === "symbol") return "[REDACTED]";
    if (input instanceof Date) return input.toISOString();
    if (typeof input === "object") {
      if (seen.has(input)) return "[REDACTED]";
      seen.add(input);
      if (Array.isArray(input)) return input.map((item) => visit(item, seen));
      const output: Record<string, JsonValue> = {};
      for (const [key, item] of Object.entries(input)) {
        output[key] = secretKey.test(key) || blocked.has(key.toLowerCase()) ? "[REDACTED]" : visit(item, seen);
      }
      return output;
    }
    return String(input);
  };
  return visit(value, new WeakSet());
}

export const nowIso = () => new Date().toISOString();

export function businessAutomationAllowed(business: { state: "TRIAL" | "ACTIVE" | "PAUSED" | "EXPIRED" | "CANCELLED"; disabled: boolean; trialStartedAt?: Date | null; trialEndsAt?: Date | null; trialExpiryBehavior?: "PAUSE_AUTOMATION" | "CONTINUE_AUTOMATION" }, now = new Date()) {
  if (business.disabled) return false;
  if (business.state === "ACTIVE") return true;
  if (business.state === "TRIAL") return Boolean(business.trialStartedAt && business.trialEndsAt && business.trialStartedAt <= now && business.trialEndsAt > now);
  return business.state === "EXPIRED" && business.trialExpiryBehavior === "CONTINUE_AUTOMATION";
}
