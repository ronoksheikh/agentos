# Agent Playground

The agency `/agent-playground` page previews one saved `DRAFT`, `TEST`, or `PUBLISHED` agent version. Access requires the agency `run.execute` capability. Business and version IDs are checked together before each run.

Each submission uses a bounded synthetic message, a new conversation ID, no customer ID, and the selected version snapshot. Scenario choices provide a channel label; the image option is text-only, and voice scenarios use the supplied transcript text. No real conversation, attachment, or customer memory is loaded.

The page calls the configured OpenAI Responses provider through `AgentRuntime`. The playground system principal is the only new principal allowed to use the runtime's `draftOnly` mode. The runtime exposes no tools in that mode and does not execute proposed actions. The UI displays generated customer-facing message text and lists other proposed action types without their payloads. A model tool request fails safely rather than being run.

Per-request trace, realtime, action, and tool registries are in memory and are discarded after the request. A content-free `agent.playground.previewed` audit row records the version revision, scenario, status, token counts, and proposed action types. The prompt and generated text are not persisted. Previewing requires `OPENAI_API_KEY` and a configured published-version model; no provider means the page reports the missing configuration.

`bun test tests/phase7-playground.test.ts tests/runtime.integration.test.ts` covers synthetic scope, bounded input, safe draft output, disabled tools, and action suppression. `bun run check` and `bun run admin:build` passed with the route enabled. The real model and approved endpoint remain covered by the provider acceptance gate in `docs/completion/phase7.md`.
