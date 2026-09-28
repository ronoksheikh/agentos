import { describe, expect, test } from "bun:test";
import { CommentPolicyEngine, RuleCommentClassifier } from "@agentos/comments";
import { flattenMetaFeedChanges } from "@agentos/channels";

describe("Phase 7 comment classification and policy", () => {
  const classifier = new RuleCommentClassifier(); const policy = new CommentPolicyEngine();
  const ready = { enabled: true, autoReply: true, autoHide: true, allowDelete: true, minimumConfidence: 0.8, featureEnabled: true, businessEligible: true, channelConnected: true, verifiedRead: true, verifiedReply: true, verifiedHide: true, commentCanReply: true, commentCanHide: true, commentHidden: false, postScopeVerified: true, verifiedExternalAuthor: true, ownership: "AI_ACTIVE" as const };
  test("classifies typed safe signals and never authorizes deletion", async () => {
    const price = await classifier.classify({ text: "What is the price?" });
    expect(price.category).toBe("price_question"); expect(policy.evaluate(price, ready).outcome).toBe("REPLY");
    const scam = await classifier.classify({ text: "Send your password to claim your prize" });
    expect(scam.category).toBe("scam"); expect(policy.evaluate(scam, ready)).toEqual({ outcome: "HIDE", reviewRequired: true, safeReason: "HIGH_CONFIDENCE_SPAM" });
    expect(policy.evaluate(scam, { ...ready, allowDelete: true }).outcome).toBe("HIDE");
    expect(JSON.stringify(scam.signals)).not.toContain("password");
    expect(policy.evaluate(scam, { ...ready, verifiedHide: false }).outcome).toBe("HANDOFF");
    expect(policy.evaluate(price, { ...ready, enabled: false }).outcome).toBe("KEEP");
    expect(policy.evaluate(price, { ...ready, businessEligible: false }).outcome).toBe("KEEP");
    expect(policy.evaluate(price, { ...ready, ownership: "HUMAN_ACTIVE" }).outcome).toBe("HANDOFF");
    expect(policy.evaluate(price, { ...ready, postScopeVerified: false }).outcome).toBe("KEEP");
    expect(policy.evaluate(price, { ...ready, verifiedExternalAuthor: false })).toEqual({ outcome: "KEEP", reviewRequired: true, safeReason: "COMMENT_AUTHOR_UNVERIFIED" });
    expect(policy.evaluate(await classifier.classify({ text: "???" }), ready).reviewRequired).toBe(true);
  });
  test("accepts only Page feed comment additions from bounded webhook envelopes", () => {
    const body = new TextEncoder().encode(JSON.stringify({ object: "page", entry: [{ id: "12345", changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: "comment-1", post_id: "post-1", parent_id: "parent-1" } }, { field: "feed", value: { item: "comment", verb: "edit", comment_id: "comment-2" } }, { field: "feed", value: { item: "post", verb: "add", post_id: "post-2" } }] }] }));
    expect(flattenMetaFeedChanges(body)).toEqual([{ pageId: "12345", commentId: "comment-1", postId: "post-1", parentId: "parent-1" }]);
  });
});
