import type { AgentEvent, UniversalEvent } from "@agentos/events";
import type { UniversalChannelAction } from "@agentos/actions";
import type { TrustedBusinessContext } from "@agentos/shared";
import { z } from "zod";

export const channelCapabilitiesSchema = z.object({
  canSendText: z.boolean(), canSendImage: z.boolean(), canSendFile: z.boolean(), canSendProduct: z.boolean(),
  canReact: z.boolean(), canReplyToMessage: z.boolean(), canReplyToComment: z.boolean(), canHideComment: z.boolean(),
  canDeleteComment: z.boolean(), canMarkSeen: z.boolean(), canShowTyping: z.boolean(), canOpenExternalConversation: z.boolean(),
  supportsMessageEdits: z.boolean(), supportsMessageDeletes: z.boolean(),
});
export type ChannelCapabilities = z.infer<typeof channelCapabilitiesSchema>;
export type PresenceOperation = "MARK_SEEN" | "TYPING_ON" | "TYPING_REFRESH" | "TYPING_OFF";

export interface ChannelAdapter {
  readonly channel: string;
  verifyInbound(request: { headers: Headers; body: Uint8Array }): Promise<{ verified: boolean; safeReason?: string }>;
  normalizeInbound(request: { headers: Headers; body: Uint8Array }, context: TrustedBusinessContext): Promise<AgentEvent[]>;
  normalizeUniversalInbound?(request: { headers: Headers; body: Uint8Array }, context: TrustedBusinessContext): Promise<UniversalEvent[]>;
  execute(context: TrustedBusinessContext, action: UniversalChannelAction): Promise<{ externalId?: string; status: "EXECUTED" | "SKIPPED"; safeReason?: string }>;
  capabilities(context: TrustedBusinessContext): Promise<ChannelCapabilities>;
  presence(context: TrustedBusinessContext, operation: PresenceOperation): Promise<{ status: "EXECUTED" | "SKIPPED"; safeReason?: string }>;
  health(context: TrustedBusinessContext): Promise<{ status: "HEALTHY" | "DEGRADED" | "UNAVAILABLE"; checkedAt: string; safeMessage?: string }>;
  reconcile?(context: TrustedBusinessContext, action: UniversalChannelAction): Promise<{ status: "EXECUTED" | "NOT_FOUND" | "UNKNOWN"; externalId?: string }>;
}

export interface ChannelRegistry {
  register(adapter: ChannelAdapter): void;
  resolve(channel: string): ChannelAdapter | null;
}

export class InMemoryChannelRegistry implements ChannelRegistry {
  private readonly adapters = new Map<string, ChannelAdapter>();
  register(adapter: ChannelAdapter): void { if (this.adapters.has(adapter.channel)) throw new Error(`Adapter already registered: ${adapter.channel}`); this.adapters.set(adapter.channel, adapter); }
  resolve(channel: string): ChannelAdapter | null { return this.adapters.get(channel) ?? null; }
}

export type PresenceLifecycleState = "RECEIVED" | "QUEUED" | "PROCESSING" | "COMPOSING" | "SENDING" | "SENT" | "FAILED" | "CANCELLED" | "SUPPRESSED" | "TIMEOUT" | "HANDOFF" | "PAUSED" | "DISCONNECTED";
export interface PresenceController { transition(context: TrustedBusinessContext, channel: string, state: PresenceLifecycleState): Promise<void>; }

export class RegistryPresenceController implements PresenceController {
  private readonly seen = new Set<string>();
  private readonly typing = new Map<string, number>();
  constructor(private readonly registry: ChannelRegistry) {}
  async transition(context: TrustedBusinessContext, channel: string, state: PresenceLifecycleState): Promise<void> {
    const adapter = this.registry.resolve(channel); if (!adapter) return;
    const key = `${context.businessId}:${context.conversationId ?? "none"}:${context.traceId}`;
    if (["SENT", "FAILED", "CANCELLED", "SUPPRESSED", "TIMEOUT", "HANDOFF", "PAUSED", "DISCONNECTED"].includes(state)) {
      const wasTyping = this.typing.has(key); this.typing.delete(key); this.seen.delete(key);
      if (wasTyping) await adapter.presence(context, "TYPING_OFF").catch(() => {});
      return;
    }
    const capabilities = await adapter.capabilities(context);
    if (state === "PROCESSING" && capabilities.canMarkSeen && !this.seen.has(key)) { await adapter.presence(context, "MARK_SEEN"); this.seen.add(key); }
    if (state === "COMPOSING" && capabilities.canShowTyping) { const prior = this.typing.get(key); if (!prior) { await adapter.presence(context, "TYPING_ON"); this.typing.set(key, Date.now()); } else if (Date.now() - prior >= 8_000) { await adapter.presence(context, "TYPING_REFRESH"); this.typing.set(key, Date.now()); } }
  }
}

export * from "./facebook-messenger";
