import { describe, expect, test } from "bun:test";
import { ulid } from "ulid";
import { AgentVersionService } from "@agentos/agents";
import { roleCapabilities } from "@agentos/auth";
import { InMemoryAgentVersionRepository } from "@agentos/persistence";
import { createAgentFixture, ids, trusted } from "./helpers";

describe("agent versions and auth-ready roles", () => {
  test("keeps version snapshots immutable and changes live selection only on publish", async () => {
    const repository = new InMemoryAgentVersionRepository(); const first = createAgentFixture(); repository.seed({ ...first.agent, activeVersionId: first.version.id }, [first.version]);
    const draft = { ...structuredClone(first.version), id: ulid(), version: 2, state: "DRAFT" as const, publishedAt: null, config: { ...first.version.config, tone: "warm" } };
    await repository.saveVersion(trusted(), draft); await expect(repository.saveVersion(trusted(), { ...draft, config: { ...draft.config, tone: "changed" } })).rejects.toThrow("IMMUTABLE_VERSION_EXISTS");
    expect((await repository.getActiveVersion(trusted(), ids.agent))?.id).toBe(first.version.id);
    await new AgentVersionService(repository).publish(trusted(), ids.agent, draft.id, ids.user);
    expect((await repository.getActiveVersion(trusted(), ids.agent))?.id).toBe(draft.id); expect(repository.audits).toHaveLength(1);
  });

  test("defines evolvable agency and business capability grants", () => {
    expect(roleCapabilities.agency.SUPER_ADMIN).toContain("business.manage"); expect(roleCapabilities.agency.DEVELOPER).toContain("run.execute");
    expect(roleCapabilities.business.OWNER).toContain("member.manage"); expect(roleCapabilities.business.VIEWER).not.toContain("agent.manage");
  });
});
