import { describe, expect, test } from "bun:test";
import { API_PATHS, endpointCapabilities } from "../apps/api/src";
import { safeApiResponse } from "../apps/api/src/control-plane";

describe("phase 2 API contracts", () => {
  test("covers authenticated operational resources with server capabilities", () => {
    for (const key of ["session", "sessions", "users", "invitations", "businesses", "onboarding", "announcements", "agents", "agentVersion", "publishVersion", "rollbackVersion", "playgroundConversations", "playgroundMessages", "runDetail", "toolCalls", "actions", "traces", "conversations", "memories", "pins", "goals", "toolPolicies", "audits", "featureFlags", "counters"] as const) {
      expect(API_PATHS[key]).toStartWith("/api/"); expect(endpointCapabilities[API_PATHS[key]]).toBeTruthy();
    }
  });

  test("maps failures to the standard safe error envelope", async () => {
    const response = await safeApiResponse(async () => { throw new Error("CONCURRENT_EDIT"); });
    expect(response.status).toBe(409); expect(response.body.code).toBe("CONCURRENT_EDIT"); expect(response.body.requestId).toHaveLength(26); expect(JSON.stringify(response.body)).not.toContain("stack");
  });
});
