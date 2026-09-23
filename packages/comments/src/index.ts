import { z } from "zod";

export const commentClassificationSchema = z.object({
  schemaVersion: z.literal("1.0"),
  category: z.enum(["normal", "product_question", "price_question", "purchase_intent", "complaint", "spam", "scam", "abuse", "uncertain"]),
  confidence: z.number().min(0).max(1),
  requiresReply: z.boolean(),
  requiresHuman: z.boolean(),
  moderationRecommendation: z.enum(["keep", "hide", "review"]),
  signals: z.array(z.string().min(1).max(80)).max(10),
});
export type CommentClassification = z.infer<typeof commentClassificationSchema>;
export interface CommentClassifier { classify(input: { text: string; postText?: string | null; parentText?: string | null; signal?: AbortSignal }): Promise<CommentClassification> }

/** Conservative deterministic classifier. No raw text is placed in signals or audit metadata. */
export class RuleCommentClassifier implements CommentClassifier {
  async classify(input: { text: string; signal?: AbortSignal }): Promise<CommentClassification> {
    if (input.signal?.aborted) throw new Error("CANCELLED");
    const text = input.text.trim().slice(0, 10_000).toLowerCase();
    const result = (category: CommentClassification["category"], confidence: number, requiresReply: boolean, requiresHuman: boolean, moderationRecommendation: CommentClassification["moderationRecommendation"], signal: string) => commentClassificationSchema.parse({ schemaVersion: "1.0", category, confidence, requiresReply, requiresHuman, moderationRecommendation, signals: [signal] });
    if (!text) return result("uncertain", 0.1, false, true, "review", "empty_text");
    if (/(?:verify your account|send your password|crypto wallet|guaranteed profit|claim your prize)/i.test(text)) return result("scam", 0.92, false, true, "hide", "credential_or_payment_lure");
    if (/(?:free followers|click my profile|promo code|visit my page)/i.test(text) && /https?:\/\/|www\./i.test(text)) return result("spam", 0.88, false, false, "hide", "unsolicited_link_promotion");
    if (/(?:refund|broken|damaged|not working|never arrived|complaint|ফেরত|নষ্ট)/i.test(text)) return result("complaint", 0.84, true, true, "keep", "service_complaint");
    if (/(?:price|cost|how much|দাম|কত টাকা)/i.test(text)) return result("price_question", 0.9, true, false, "keep", "price_question");
    if (/(?:buy|purchase|order now|কিনতে চাই|অর্ডার)/i.test(text)) return result("purchase_intent", 0.82, true, false, "keep", "purchase_language");
    if (/(?:size|color|colour|available|in stock|সাইজ|রঙ|আছে)/i.test(text)) return result("product_question", 0.8, true, false, "keep", "product_attribute_question");
    if (/(?:idiot|stupid|hate you)/i.test(text)) return result("abuse", 0.72, false, true, "review", "abusive_language");
    return result("normal", 0.55, false, false, "review", "no_strong_signal");
  }
}

export const commentPolicyInputSchema = z.object({
  enabled: z.boolean(), autoReply: z.boolean(), autoHide: z.boolean(), allowDelete: z.boolean(), minimumConfidence: z.number().min(0).max(1),
  featureEnabled: z.boolean(), channelConnected: z.boolean(), verifiedRead: z.boolean(), verifiedReply: z.boolean(), verifiedHide: z.boolean(),
  commentCanReply: z.boolean(), commentCanHide: z.boolean(), commentHidden: z.boolean(), postScopeVerified: z.boolean(), verifiedExternalAuthor: z.boolean(),
  ownership: z.enum(["AI_ACTIVE", "HANDOFF_REQUESTED", "HUMAN_ACTIVE", "PAUSED", "RESOLVED"]).optional(),
});
export type CommentPolicyInput = z.infer<typeof commentPolicyInputSchema>;
export const commentDecisionSchema = z.object({ outcome: z.enum(["KEEP", "HIDE", "REPLY", "HANDOFF", "DELETE"]), reviewRequired: z.boolean(), safeReason: z.string().min(1).max(100) });
export type CommentDecision = z.infer<typeof commentDecisionSchema>;

/** Deletion is intentionally unreachable until the separately verified destructive workflow exists. */
export class CommentPolicyEngine {
  evaluate(classification: CommentClassification, unsafeInput: CommentPolicyInput): CommentDecision {
    const input = commentPolicyInputSchema.parse(unsafeInput); const result = (outcome: CommentDecision["outcome"], reviewRequired: boolean, safeReason: string) => commentDecisionSchema.parse({ outcome, reviewRequired, safeReason });
    if (!input.enabled || !input.featureEnabled) return result("KEEP", false, "COMMENT_AUTOMATION_DISABLED");
    if (!input.channelConnected || !input.verifiedRead || !input.postScopeVerified) return result("KEEP", true, "COMMENT_SCOPE_UNVERIFIED");
    if (!input.verifiedExternalAuthor) return result("KEEP", true, "COMMENT_AUTHOR_UNVERIFIED");
    if (classification.category === "uncertain" || classification.confidence < input.minimumConfidence) return result("KEEP", true, "CLASSIFICATION_REVIEW");
    if (input.ownership === "HUMAN_ACTIVE" || input.ownership === "HANDOFF_REQUESTED") return result("HANDOFF", true, "HUMAN_OWNS_CONVERSATION");
    if ((classification.category === "spam" || classification.category === "scam") && input.autoHide && input.verifiedHide && input.commentCanHide && !input.commentHidden) return result("HIDE", classification.requiresHuman, "HIGH_CONFIDENCE_SPAM");
    if (classification.requiresHuman) return result("HANDOFF", true, "HUMAN_REVIEW_REQUIRED");
    if (classification.requiresReply && input.autoReply && input.verifiedReply && input.commentCanReply && input.ownership !== "PAUSED") return result("REPLY", false, "APPROVED_COMMENT_REPLY");
    return result("KEEP", classification.moderationRecommendation === "review", "NO_APPROVED_ACTION");
  }
}

export * from "./processor";
export * from "./writes";
export * from "./policies";
