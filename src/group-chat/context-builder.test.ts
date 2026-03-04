import { describe, expect, it } from "vitest";
import { buildGroupChatContext } from "./context-builder.js";
import type { GroupSessionEntry } from "./types.js";

function makeMeta(overrides?: Partial<GroupSessionEntry>): GroupSessionEntry {
  return {
    groupId: "g1",
    groupName: "Test Group",
    messageMode: "unicast",
    members: [
      { agentId: "coder", role: "assistant", joinedAt: 0 },
      { agentId: "reviewer", role: "member", joinedAt: 0 },
    ],
    memberRolePrompts: [],
    groupSkills: [],
    maxRounds: 10,
    maxConsecutive: 3,
    historyLimit: 50,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("context-builder", () => {
  it("returns empty string for non-member agent", () => {
    const result = buildGroupChatContext({ meta: makeMeta(), agentId: "unknown" });
    expect(result).toBe("");
  });

  it("includes group name and agent role for assistant", () => {
    const result = buildGroupChatContext({ meta: makeMeta(), agentId: "coder" });
    expect(result).toContain("Test Group");
    expect(result).toContain("Assistant (coordinator)");
    expect(result).toContain("`coder`");
  });

  it("labels member role correctly", () => {
    const result = buildGroupChatContext({ meta: makeMeta(), agentId: "reviewer" });
    expect(result).toContain("Member");
    expect(result).not.toContain("coordinator");
  });

  it("includes all group members", () => {
    const result = buildGroupChatContext({ meta: makeMeta(), agentId: "coder" });
    expect(result).toContain("**coder**");
    expect(result).toContain("**reviewer**");
    expect(result).toContain("← you");
  });

  it("includes announcement when present", () => {
    const meta = makeMeta({ announcement: "Sprint planning today" });
    const result = buildGroupChatContext({ meta, agentId: "coder" });
    expect(result).toContain("Sprint planning today");
    expect(result).toContain("Announcement");
  });

  it("omits announcement section when empty", () => {
    const result = buildGroupChatContext({ meta: makeMeta(), agentId: "coder" });
    expect(result).not.toContain("Announcement");
  });

  it("describes unicast mode", () => {
    const result = buildGroupChatContext({ meta: makeMeta(), agentId: "coder" });
    expect(result).toContain("Unicast");
  });

  it("describes broadcast mode", () => {
    const meta = makeMeta({ messageMode: "broadcast" });
    const result = buildGroupChatContext({ meta, agentId: "coder" });
    expect(result).toContain("Broadcast");
  });

  it("includes read-only constraints", () => {
    const result = buildGroupChatContext({ meta: makeMeta(), agentId: "coder" });
    expect(result).toContain("read-only mode");
    expect(result).toContain("group_reply");
  });

  it("uses custom role prompt when provided", () => {
    const meta = makeMeta({
      memberRolePrompts: [{ agentId: "coder", rolePrompt: "You focus on Python only." }],
    });
    const result = buildGroupChatContext({ meta, agentId: "coder" });
    expect(result).toContain("You focus on Python only.");
  });
});
