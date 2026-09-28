import { describe, expect, it } from "bun:test";
import { CircuitBreakerModelProvider, OpenAIResponsesProvider, OpenAIVisionProvider, verifyOpenAIEndpoint, type ModelProvider } from "@agentos/models";
import { ElevenLabsHttpClient } from "@agentos/attachments";
import { createAgentFixture } from "./helpers";

const reply = (output: unknown[], usage = { input_tokens: 4, output_tokens: 6, total_tokens: 10 }) => new Response(JSON.stringify({ id: "resp_test", object: "response", status: "completed", output, usage }), { headers: { "content-type": "application/json" } });
const text = (value: string) => ({ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: value, annotations: [] }] });
const fakeFetch = (impl: (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response>) => impl as typeof fetch;
const request = () => ({ runId: "01TEST", version: createAgentFixture({ models: { primary: { provider: "openai", model: "primary" } } }).version, context: { items: [], provenance: [], estimatedTokens: 0, truncated: false }, tools: [], safeToolResults: [], maxOutputTokens: 100, signal: new AbortController().signal });

describe("Phase 7 provider configuration", () => {
  it("opens after retryable provider failures, fails fast, and recovers through one half-open probe", async () => {
    let now = 10_000; let calls = 0;
    const inner: ModelProvider = { async generate() { calls++; return calls <= 2
      ? { kind: "error", provider: "openai", model: "primary", latencyMs: 0, error: { code: "UNAVAILABLE", message: "Model response unavailable", retryable: true } }
      : { kind: "actions", provider: "openai", model: "primary", latencyMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, actions: [] }; } };
    const circuit = new CircuitBreakerModelProvider(inner, { failureThreshold: 2, cooldownMs: 1_000, now: () => now });
    expect((await circuit.generate(request())).kind).toBe("error");
    expect((await circuit.generate(request())).kind).toBe("error");
    expect(circuit.status()).toEqual({ state: "open", consecutiveFailures: 2, retryAfterMs: 1_000 });
    expect((await circuit.generate(request())).kind).toBe("error");
    expect(calls).toBe(2);
    now += 1_000;
    expect(circuit.status().state).toBe("half_open");
    expect((await circuit.generate(request())).kind).toBe("actions");
    expect(circuit.status()).toEqual({ state: "closed", consecutiveFailures: 0, retryAfterMs: 0 });
  });

  it("allows only one half-open provider probe at a time", async () => {
    let now = 0; let calls = 0; let finishProbe!: (response: Awaited<ReturnType<ModelProvider["generate"]>>) => void;
    const unavailable = { kind: "error" as const, provider: "openai", model: "primary", latencyMs: 0, error: { code: "UNAVAILABLE" as const, message: "Model response unavailable", retryable: true } };
    const success = { kind: "actions" as const, provider: "openai", model: "primary", latencyMs: 1, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, actions: [] };
    const inner: ModelProvider = { generate() { calls++; if (calls === 1) return Promise.resolve(unavailable); return new Promise((resolve) => { finishProbe = resolve; }); } };
    const circuit = new CircuitBreakerModelProvider(inner, { failureThreshold: 1, cooldownMs: 1_000, now: () => now });
    await circuit.generate(request()); now += 1_000;
    const probe = circuit.generate(request());
    const concurrent = await circuit.generate(request());
    expect(concurrent.kind).toBe("error"); expect(calls).toBe(2);
    finishProbe(success); expect((await probe).kind).toBe("actions"); expect(circuit.status().state).toBe("closed");
  });

  it("uses the official Responses transport at an approved base URL and parses actions", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const fetcher = fakeFetch(async (input, init) => { calls.push({ url: String(input), auth: new Headers(init?.headers).get("authorization") }); return reply([text('{"kind":"actions","actions":[{"type":"SendMessage","text":"Hello"}]}')]); });
    const result = await new OpenAIResponsesProvider({ apiKey: "test-key", baseURL: "https://models.example/v1", fetch: fetcher }).generate(request());
    expect(calls[0]?.url).toBe("https://models.example/v1/responses");
    expect(calls[0]?.auth).toBe("Bearer test-key");
    expect(result.kind).toBe("actions");
    if (result.kind === "actions") expect(result.usage.totalTokens).toBe(10);
    expect(JSON.stringify(result)).not.toContain("test-key");
  });

  it("applies the immutable agent instructions, tone, language, and disclosure policy as system instructions", async () => {
    let sent: { instructions: string; input: string } | undefined;
    const fetcher = fakeFetch(async (_input, init) => {
      sent = JSON.parse(String(init?.body)) as { instructions: string; input: string };
      return reply([text('{"kind":"actions","actions":[{"type":"SendMessage","text":"Bonjour"}]}')]);
    });
    const version = createAgentFixture({ instructions: "Explain return windows accurately.", tone: "warm and concise", languages: ["en", "fr"], models: { primary: { provider: "openai", model: "primary" } }, disclosurePolicy: { discloseWhenAsked: true, statement: "I am Acme's automated assistant." } }).version;
    const result = await new OpenAIResponsesProvider({ apiKey: "test-key", fetch: fetcher }).generate({ ...request(), version });
    expect(result.kind).toBe("actions");
    expect(sent?.instructions).toContain("Explain return windows accurately.");
    expect(sent?.instructions).toContain("Tone: warm and concise");
    expect(sent?.instructions).toContain("en, fr");
    expect(sent?.instructions).toContain("I am Acme's automated assistant.");
    expect(sent?.input).not.toContain("Explain return windows accurately.");
  });

  it("accepts native function calls and never passes provider arguments as trusted actions", async () => {
    const fetcher = fakeFetch(async () => reply([{ type: "function_call", name: "demo_lookup", arguments: '{"query":"item"}', call_id: "call_1", status: "completed" }]));
    const result = await new OpenAIResponsesProvider({ apiKey: "test-key", fetch: fetcher }).generate({ ...request(), tools: [{ name: "demo_lookup", description: "Look up an item", inputSchema: { type: "object", properties: { query: { type: "string" } } } }] });
    expect(result.kind).toBe("tool_calls");
    if (result.kind === "tool_calls") expect(result.calls[0]).toMatchObject({ name: "demo_lookup", arguments: { query: "item" } });
  });

  it("uses only the configured fallback for a retryable primary failure", async () => {
    const seen: string[] = [];
    const fetcher = fakeFetch(async (_input, init) => { const model = (JSON.parse(String(init?.body)) as { model: string }).model; seen.push(model); return model === "primary" ? new Response("unavailable", { status: 503 }) : reply([text('{"kind":"actions","actions":[{"type":"SendMessage","text":"Recovered"}]}')]); });
    const result = await new OpenAIResponsesProvider({ apiKey: "test-key", fallbackModel: "fallback", fetch: fetcher }).generate(request());
    expect(seen).toEqual(["primary", "fallback"]);
    expect(result.kind).toBe("actions");
    if (result.kind === "actions") expect(result.model).toBe("fallback");
  });

  it("probes structured output, function calling, and primary vision with an explicit fallback", async () => {
    const seen: Array<{ model: string; kind: string }> = [];
    const fetcher = fakeFetch(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string; tools?: unknown[]; input: unknown };
      const kind = body.tools ? "tool" : Array.isArray(body.input) ? "image" : "json";
      seen.push({ model: body.model, kind });
      if (kind === "image" && body.model === "primary") return new Response("unsupported", { status: 400 });
      return reply(kind === "tool" ? [{ type: "function_call", name: "capability_probe", arguments: "{}", call_id: "call_1", status: "completed" }] : [text(kind === "json" ? '{"probe":true}' : "white")]);
    });
    const selected = await verifyOpenAIEndpoint({ apiKey: "test-key", fetch: fetcher }, "primary", "vision");
    expect(selected).toBe("vision");
    expect(seen).toEqual([{ model: "primary", kind: "json" }, { model: "primary", kind: "tool" }, { model: "primary", kind: "image" }, { model: "vision", kind: "image" }]);
    const described = await new OpenAIVisionProvider({ apiKey: "test-key", fetch: fetcher }, selected).describe(new Uint8Array([137, 80]), "image/png", new AbortController().signal);
    expect(described.text).toBe("white");
  });

  it("configures ElevenLabs transcription without exposing its key in results", async () => {
    const fetcher = fakeFetch(async (_input, init) => { expect(new Headers(init?.headers).get("xi-api-key")).toBe("test-secret"); const form = init?.body as FormData; expect(form.get("model_id")).toBe("scribe_v2"); return new Response(JSON.stringify({ text: "Hello", language_code: "en", language_probability: 0.95 })); });
    const result = await new ElevenLabsHttpClient({ fetcher, model: "scribe_v2", timeoutMs: 2000 }).transcribe({ bytes: new Uint8Array([1, 2]), mimeType: "audio/mpeg", credential: "test-secret", signal: new AbortController().signal });
    expect(result).toEqual({ text: "Hello", language: "en", confidence: 0.95, model: "scribe_v2" });
    expect(JSON.stringify(result)).not.toContain("test-secret");
  });
});
