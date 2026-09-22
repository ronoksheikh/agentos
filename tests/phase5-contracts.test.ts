import { describe, expect, test } from "bun:test";
import { ulid } from "ulid";
import { responseTimingPolicySchema } from "@agentos/agents";
import { InMemoryChannelRegistry, RegistryPresenceController, type ChannelAdapter, type PresenceOperation } from "@agentos/channels";
import { toRuntimeEvent, universalEventSchema } from "@agentos/events";
import { classifyFailure, evaluateResponseTiming, workJobSchema } from "@agentos/phase5";
import { createTrustedBusinessContext } from "@agentos/shared";

const businessId = ulid(); const connectionId = ulid(); const conversationId = ulid(); const traceId = ulid();
const policy = responseTimingPolicySchema.parse({ typing: {}, debounceMs: 100, maxBatchWaitMs: 500, maxCustomerWaitMs: 2_000, minPreSendDelayMs: 0, maxPreSendDelayMs: 800, variabilityMs: 100 });

describe("Phase 5 public contracts", () => {
  test("normalizes a versioned message and rejects unsupported versions and unscoped jobs", () => {
    const input = { id: ulid(), schemaVersion: "1.0", type: "message.received", businessId, channel: "fake", connectionId, conversationId, dedupeKey: "message:1", occurredAt: new Date().toISOString(), receivedAt: new Date().toISOString(), traceId, rawEventId: ulid(), source: { kind: "adapter", externalMessageId: "external-1", externalParentId: "parent-1" }, payload: { messageId: ulid(), text: "hello", attachmentIds: [], replyToExternalId: "parent-1" } };
    const event = universalEventSchema.parse(input); expect(event.type).toBe("message.received"); expect(toRuntimeEvent(event, 3).payload).toMatchObject({ inboundSequence: 3, text: "hello" });
    expect(() => universalEventSchema.parse({ ...input, schemaVersion: "2.0" })).toThrow();
    expect(() => workJobSchema.parse({ schemaVersion: "1.0", workId: ulid(), businessId, traceId, kind: "EVENT", modelOutput: "secret" })).not.toThrow();
    expect(Object.keys(workJobSchema.parse({ schemaVersion: "1.0", workId: ulid(), businessId, traceId, kind: "EVENT", modelOutput: "secret" }))).not.toContain("modelOutput");
    expect(() => workJobSchema.parse({ schemaVersion: "1.0", workId: ulid(), traceId, kind: "EVENT" })).toThrow();
  });
  test("bounds delay, bypasses urgent work, and classifies retry safety", () => {
    const short = evaluateResponseTiming({ policy, batchSize: 1, responseChars: 5, queueAgeMs: 0, elapsedMs: 0, seed: "a" });
    const complex = evaluateResponseTiming({ policy, batchSize: 3, responseChars: 1000, usedTools: true, usedBrowser: true, usedMedia: true, queueAgeMs: 0, elapsedMs: 0, seed: "a" });
    expect(complex.delayMs).toBeGreaterThan(short.delayMs); expect(complex.delayMs).toBeLessThanOrEqual(800);
    expect(evaluateResponseTiming({ policy, batchSize: 1, responseChars: 1000, queueAgeMs: 0, elapsedMs: 1_990, seed: "a" }).delayMs).toBeLessThanOrEqual(10);
    expect(evaluateResponseTiming({ policy, batchSize: 1, responseChars: 1000, queueAgeMs: 0, elapsedMs: 0, seed: "a", transactional: true }).delayMs).toBe(0);
    expect(classifyFailure("CHANNEL_ERROR").retryable).toBe(true); expect(classifyFailure("VALIDATION_ERROR").retryable).toBe(false);
  });
  test("seen and typing begin only at processing/composing and stop at every terminal state", async () => {
    const operations: PresenceOperation[] = []; const registry = new InMemoryChannelRegistry();
    const adapter: ChannelAdapter = { channel: "fake", async verifyInbound() { return { verified: true }; }, async normalizeInbound() { return []; }, async execute() { return { status: "EXECUTED" }; }, async capabilities() { return { canSendText: true, canSendImage: false, canSendFile: false, canSendProduct: false, canReact: false, canReplyToMessage: false, canReplyToComment: false, canHideComment: false, canDeleteComment: false, canMarkSeen: true, canShowTyping: true, canOpenExternalConversation: false, supportsMessageEdits: false, supportsMessageDeletes: false }; }, async presence(_context, operation) { operations.push(operation); return { status: "EXECUTED" }; }, async health() { return { status: "HEALTHY", checkedAt: new Date().toISOString() }; } };
    registry.register(adapter); const controller = new RegistryPresenceController(registry); const context = createTrustedBusinessContext({ businessId, principal: { kind: "adapter", connectionId }, source: "verified_adapter", conversationId, traceId, capabilityGrants: [] });
    await controller.transition(context, "fake", "RECEIVED"); await controller.transition(context, "fake", "QUEUED"); expect(operations).toEqual([]);
    await controller.transition(context, "fake", "PROCESSING"); await controller.transition(context, "fake", "PROCESSING"); await controller.transition(context, "fake", "COMPOSING"); await controller.transition(context, "fake", "COMPOSING"); expect(operations).toEqual(["MARK_SEEN", "TYPING_ON"]);
    for (const terminal of ["SENT", "FAILED", "CANCELLED", "SUPPRESSED", "TIMEOUT", "HANDOFF", "PAUSED", "DISCONNECTED"] as const) { await controller.transition(context, "fake", "COMPOSING"); await controller.transition(context, "fake", terminal); }
    expect(operations.filter((operation) => operation === "TYPING_OFF")).toHaveLength(8);
  });
});
