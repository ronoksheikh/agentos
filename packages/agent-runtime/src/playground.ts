import { ulid } from "ulid";
import { z } from "zod";
import { createTrustedBusinessContext } from "@agentos/shared";
import type { AgentVersion } from "@agentos/agents";
import type { AgentRuntime, AgentRunResult } from "./index";

export const playgroundInputSchema = z.object({
  text: z.string().trim().min(1).max(4_000),
  fixture: z.enum(["WEB_CHAT", "MESSENGER", "COMMENT", "IMAGE", "VOICE_TRANSCRIPT"]),
});
export type PlaygroundInput = z.infer<typeof playgroundInputSchema>;

export type PlaygroundResult = Pick<AgentRunResult, "status" | "usage" | "safeError"> & {
  versionId: string;
  draftMessages: string[];
  draftActionTypes: string[];
  otherActionTypes: string[];
};

/** Runs one isolated preview through AgentRuntime without tools or external actions. */
export class AgentRuntimePlaygroundAdapter {
  constructor(private readonly createRuntime: (version: AgentVersion) => AgentRuntime) {}

  async execute(version: AgentVersion, input: PlaygroundInput): Promise<PlaygroundResult> {
    const parsed = playgroundInputSchema.parse(input);
    const traceId = ulid();
    const conversationId = ulid();
    const event = {
      id: ulid(), schemaVersion: "1.0" as const, type: "message.received" as const,
      businessId: version.businessId, channel: `simulation:${parsed.fixture.toLowerCase()}`,
      conversationId, occurredAt: new Date().toISOString(), dedupeKey: `playground:${ulid()}`,
      source: { kind: "test" as const, metadata: { fixture: parsed.fixture } },
      payload: { messageId: ulid(), text: parsed.text, attachmentIds: [], inboundSequence: 1 },
    };
    const context = createTrustedBusinessContext({
      businessId: version.businessId,
      principal: { kind: "system", service: "playground" },
      source: "test_harness", agentId: version.agentId, conversationId, traceId,
      capabilityGrants: [],
    });
    const result = await this.createRuntime(version).run({ context, event, agentId: version.agentId, testVersionId: version.id, draftOnly: true });
    return {
      versionId: version.id,
      status: result.status,
      draftMessages: result.actions.flatMap((action) => {
        if (action.type === "SendMessage" || action.type === "ReplyToMessage" || action.type === "ReplyToComment") return [action.text];
        if (action.type === "SendProduct") return [action.fallbackText];
        return [];
      }),
      draftActionTypes: [...new Set(result.actions.filter((action) => ["SendMessage", "ReplyToMessage", "ReplyToComment", "SendProduct"].includes(action.type)).map((action) => action.type))],
      otherActionTypes: [...new Set(result.actions.filter((action) => !["SendMessage", "ReplyToMessage", "ReplyToComment", "SendProduct"].includes(action.type)).map((action) => action.type))],
      usage: result.usage,
      ...(result.safeError ? { safeError: result.safeError } : {}),
    };
  }
}
