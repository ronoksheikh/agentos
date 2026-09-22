import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { ulid } from "ulid";
import { agentActionSchema } from "@agentos/actions";
import { agentEventSchema } from "@agentos/events";
import { InMemoryRealtimeBus, RealtimeProtocol, realtimeEnvelopeSchema } from "@agentos/realtime";
import { ids } from "./helpers";

describe("public contracts and safe realtime", () => {
  test("versioned event, action, and realtime schemas serialize", () => {
    const action = agentActionSchema.parse({ id: ulid(), schemaVersion: "1.0", type: "SendMessage", idempotencyKey: "send:1", text: "hello" });
    const event = agentEventSchema.parse({ id: ulid(), schemaVersion: "1.0", type: "system.trigger", businessId: ids.businessA, channel: "internal", occurredAt: new Date().toISOString(), dedupeKey: "trigger:1", source: { kind: "system", metadata: { authorization: "Bearer secret" } }, payload: { name: "test", data: {} } });
    expect(JSON.parse(JSON.stringify(action)).schemaVersion).toBe("1.0"); expect(event.source.metadata).toEqual({ authorization: "[REDACTED]" });
    expect(realtimeEnvelopeSchema.safeParse({ id: ulid(), schemaVersion: "1.0", type: "run.started", occurredAt: new Date().toISOString(), businessId: ids.businessA, traceId: ids.trace, payload: {} }).success).toBe(true);
  });

  test("redacts before publish, orders events, and authorizes replay scope", async () => {
    const bus = new InMemoryRealtimeBus(); await bus.publish({ type: "run.started", businessId: ids.businessA, runId: ulid(), traceId: ids.trace, payload: { token: "secret", nested: { password: "secret" } } }); await bus.publish({ type: "run.completed", businessId: ids.businessA, traceId: ids.trace, payload: { ok: true } });
    const principal = { userId: ids.user, sessionId: "s", accountState: "ACTIVE" as const };
    const allowed = new RealtimeProtocol({ async canSubscribe(_principal, scope) { return scope.businessId === ids.businessA; } }, bus);
    const events = await allowed.subscribe(principal, { businessId: ids.businessA }); expect(events.map((item) => item.sequence)).toEqual([1, 2]); expect(events[0]?.payload).toEqual({ token: "[REDACTED]", nested: { password: "[REDACTED]" } });
    await expect(allowed.subscribe(principal, { businessId: ids.businessB })).rejects.toThrow("UNAUTHORIZED_SUBSCRIPTION");
    await expect(allowed.subscribe({ ...principal, accountState: "DISABLED" }, { businessId: ids.businessA })).rejects.toThrow("UNAUTHORIZED_SUBSCRIPTION");
  });

  test("runtime source has no channel module or provider-specific imports", async () => {
    const source = await readFile(new URL("../packages/agent-runtime/src/index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/facebook|meta|instagram|telegram|whatsapp|webchat/i); expect(source).not.toMatch(/from ["']@agentos\/channels/);
  });
});
