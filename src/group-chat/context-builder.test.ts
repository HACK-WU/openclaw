import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sanitizeGroupDirName } from "./bridge-memory.js";
import { buildGroupChatContext } from "./context-builder.js";
import type { GroupSessionEntry } from "./types.js";

// ─── Test Helpers ───

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
    maxRounds: 20,
    maxConsecutive: 3,
    historyLimit: 50,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/** Default params for first interaction */
function firstInteractionParams(meta: GroupSessionEntry, agentId: string) {
  return {
    meta,
    agentId,
    groupId: meta.groupId,
    isFirstInteraction: true,
    interactionCount: 0,
    lastRoleReminderAt: 0,
  };
}

/** Params for subsequent interactions */
function subsequentParams(
  meta: GroupSessionEntry,
  agentId: string,
  overrides?: { interactionCount?: number; lastRoleReminderAt?: number },
) {
  return {
    meta,
    agentId,
    groupId: meta.groupId,
    isFirstInteraction: false,
    interactionCount: overrides?.interactionCount ?? 3,
    lastRoleReminderAt: overrides?.lastRoleReminderAt ?? 0,
  };
}

describe("context-builder", () => {
  // ─── Basic Context ───

  it("returns empty content for non-member agent", async () => {
    const result = await buildGroupChatContext(firstInteractionParams(makeMeta(), "unknown"));
    expect(result.content).toBe("");
    expect(result.roleReminderSent).toBe(false);
  });

  it("includes group name and agent role for assistant", async () => {
    const result = await buildGroupChatContext(firstInteractionParams(makeMeta(), "coder"));
    expect(result.content).toContain("Test Group");
    expect(result.content).toContain("Assistant (coordinator)");
    expect(result.content).toContain("`coder`");
  });

  it("labels member role correctly", async () => {
    const result = await buildGroupChatContext(firstInteractionParams(makeMeta(), "reviewer"));
    expect(result.content).toContain("Member");
    expect(result.content).not.toContain("coordinator");
  });

  it("includes all group members with Owner", async () => {
    const result = await buildGroupChatContext(firstInteractionParams(makeMeta(), "coder"));
    expect(result.content).toContain("**coder**");
    expect(result.content).toContain("**reviewer**");
    expect(result.content).toContain("← you");
    expect(result.content).toContain("**Owner**");
  });

  it("includes announcement when present", async () => {
    const meta = makeMeta({ announcement: "Sprint planning today" });
    const result = await buildGroupChatContext(firstInteractionParams(meta, "coder"));
    expect(result.content).toContain("Sprint planning today");
    expect(result.content).toContain("Announcement");
  });

  it("omits announcement section when empty", async () => {
    const result = await buildGroupChatContext(firstInteractionParams(makeMeta(), "coder"));
    expect(result.content).not.toContain("Announcement");
  });

  // ─── Announcement Interval ───

  it("injects announcement on first interaction", async () => {
    const meta = makeMeta({ announcement: "Sprint planning today" });
    const result = await buildGroupChatContext(firstInteractionParams(meta, "coder"));
    expect(result.content).toContain("Sprint planning today");
  });

  it("skips announcement on subsequent non-interval interactions", async () => {
    const meta = makeMeta({ announcement: "Sprint planning today" });
    const result = await buildGroupChatContext({
      ...subsequentParams(meta, "coder", { interactionCount: 3 }),
    });
    expect(result.content).not.toContain("Sprint planning today");
  });

  it("injects announcement at default interval (7)", async () => {
    const meta = makeMeta({ announcement: "Sprint planning today" });
    const result = await buildGroupChatContext({
      ...subsequentParams(meta, "coder", { interactionCount: 7 }),
    });
    expect(result.content).toContain("Sprint planning today");
  });

  it("respects custom announcementInterval", async () => {
    const meta = makeMeta({ announcement: "Sprint planning today" });
    const result = await buildGroupChatContext({
      ...subsequentParams(meta, "coder", { interactionCount: 3 }),
      contextConfig: { announcementInterval: 3 },
    });
    expect(result.content).toContain("Sprint planning today");
  });

  it("skips announcement when custom interval not reached", async () => {
    const meta = makeMeta({ announcement: "Sprint planning today" });
    const result = await buildGroupChatContext({
      ...subsequentParams(meta, "coder", { interactionCount: 4 }),
      contextConfig: { announcementInterval: 3 },
    });
    expect(result.content).not.toContain("Sprint planning today");
  });

  it("describes unicast mode", async () => {
    const result = await buildGroupChatContext(firstInteractionParams(makeMeta(), "coder"));
    expect(result.content).toContain("Unicast");
  });

  it("describes broadcast mode", async () => {
    const meta = makeMeta({ messageMode: "broadcast" });
    const result = await buildGroupChatContext(firstInteractionParams(meta, "coder"));
    expect(result.content).toContain("Broadcast");
  });

  it("includes constraints for LLM agents", async () => {
    const result = await buildGroupChatContext(firstInteractionParams(makeMeta(), "coder"));
    expect(result.content).toContain("OpenClaw core configuration is read-only");
    expect(result.content).toContain("Always respond when @-mentioned");
    expect(result.content).toContain("Communication Guide");
  });

  it("uses custom role prompt when provided", async () => {
    const meta = makeMeta({
      memberRolePrompts: [{ agentId: "coder", rolePrompt: "You focus on Python only." }],
    });
    const result = await buildGroupChatContext(firstInteractionParams(meta, "coder"));
    expect(result.content).toContain("You focus on Python only.");
  });

  // ─── Role Reminder Interval (#2) ───

  describe("role reminder interval", () => {
    it("injects full role prompt on first interaction", async () => {
      const result = await buildGroupChatContext(firstInteractionParams(makeMeta(), "coder"));
      expect(result.content).toContain("### Your Role");
      expect(result.content).not.toContain("### Role Reminder");
      expect(result.roleReminderSent).toBe(false);
    });

    it("does not inject role prompt on subsequent interaction when interval not reached", async () => {
      const result = await buildGroupChatContext(
        subsequentParams(makeMeta(), "coder", {
          interactionCount: 3,
          lastRoleReminderAt: 0,
        }),
      );
      // interval default = 5, 3 - 0 = 3 < 5 → no reminder
      expect(result.content).not.toContain("### Your Role");
      expect(result.content).not.toContain("### Role Reminder");
      expect(result.roleReminderSent).toBe(false);
    });

    it("injects role reminder when interval reached", async () => {
      const result = await buildGroupChatContext(
        subsequentParams(makeMeta(), "coder", {
          interactionCount: 5,
          lastRoleReminderAt: 0,
        }),
      );
      // 5 - 0 = 5 >= 5 → reminder sent
      expect(result.content).toContain("### Role Reminder");
      expect(result.content).toContain("Assistant (coordinator)");
      expect(result.roleReminderSent).toBe(true);
    });

    it("respects custom roleReminderInterval", async () => {
      const result = await buildGroupChatContext({
        ...subsequentParams(makeMeta(), "coder", {
          interactionCount: 2,
          lastRoleReminderAt: 0,
        }),
        contextConfig: { roleReminderInterval: 2 },
      });
      // 2 - 0 = 2 >= 2 → reminder sent
      expect(result.content).toContain("### Role Reminder");
      expect(result.roleReminderSent).toBe(true);
    });

    it("resets reminder tracking after lastRoleReminderAt update", async () => {
      const result = await buildGroupChatContext(
        subsequentParams(makeMeta(), "coder", {
          interactionCount: 8,
          lastRoleReminderAt: 5,
        }),
      );
      // 8 - 5 = 3 < 5 → no reminder
      expect(result.content).not.toContain("### Role Reminder");
      expect(result.roleReminderSent).toBe(false);
    });

    it("includes rolePrompt in role reminder", async () => {
      const meta = makeMeta({
        memberRolePrompts: [{ agentId: "coder", rolePrompt: "You are a code reviewer." }],
      });
      const result = await buildGroupChatContext(
        subsequentParams(meta, "coder", {
          interactionCount: 10,
          lastRoleReminderAt: 0,
        }),
      );
      expect(result.content).toContain("### Role Reminder");
      expect(result.content).toContain("You are a code reviewer.");
    });
  });

  // ─── Memory Injection (#8) ───

  describe("memory injection", () => {
    it("injects memory paths section for project with directory", async () => {
      const meta = makeMeta({
        project: { directory: "/tmp/test-project" },
      });
      const result = await buildGroupChatContext(firstInteractionParams(meta, "coder"));
      expect(result.content).toContain("### Project Memory");
      expect(result.content).toContain("Shared permanent memory");
      expect(result.content).toContain("read/write");
    });

    it("injects memory paths even without bridge members", async () => {
      // No bridge members — should still inject memory
      const meta = makeMeta({
        project: { directory: "/tmp/test-project" },
        members: [
          { agentId: "coder", role: "assistant", joinedAt: 0 },
          { agentId: "reviewer", role: "member", joinedAt: 0 },
        ],
      });
      const result = await buildGroupChatContext(firstInteractionParams(meta, "coder"));
      expect(result.content).toContain("### Project Memory");
    });

    it("injects temp mode memory section when no project directory", async () => {
      const result = await buildGroupChatContext(firstInteractionParams(makeMeta(), "coder"));
      expect(result.content).toContain("Temp Mode");
      expect(result.content).toContain("read/write");
    });

    it("injects memory content on first interaction", async () => {
      const tmpDir = `/tmp/test-ctx-builder-${Date.now()}`;
      const groupDirName = sanitizeGroupDirName("Test Group", "g1");
      const groupDir = path.join(tmpDir, ".openclaw", groupDirName);
      await fs.mkdir(groupDir, { recursive: true });
      await fs.writeFile(
        path.join(groupDir, "MEMORY.md"),
        "# Important Decision\n\nUse TypeScript.",
      );
      await fs.writeFile(
        path.join(groupDir, "SESSION.md"),
        "# Session Notes\n\n## 当前任务\n\nImplement Phase 3",
      );

      try {
        const meta = makeMeta({
          project: { directory: tmpDir },
        });
        const result = await buildGroupChatContext(firstInteractionParams(meta, "coder"));
        expect(result.content).toContain("Memory Content");
        expect(result.content).toContain("Use TypeScript");
        expect(result.content).toContain("Implement Phase 3");
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("skips memory content when interval not reached", async () => {
      const tmpDir = `/tmp/test-ctx-builder-${Date.now()}`;
      const groupDirName = sanitizeGroupDirName("Test Group", "g1");
      const groupDir = path.join(tmpDir, ".openclaw", groupDirName);
      await fs.mkdir(groupDir, { recursive: true });
      await fs.writeFile(path.join(groupDir, "MEMORY.md"), "# Important\n\nSome content");

      try {
        const meta = makeMeta({
          project: { directory: tmpDir },
        });
        // interactionCount=3, contentInterval default=6 → 3 % 6 != 0 → skip
        const result = await buildGroupChatContext(
          subsequentParams(meta, "coder", { interactionCount: 3 }),
        );
        expect(result.content).toContain("### Project Memory");
        expect(result.content).not.toContain("Memory Content");
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("injects memory management prompt on first interaction", async () => {
      const meta = makeMeta({
        project: { directory: "/tmp/nonexistent-for-test" },
      });
      const result = await buildGroupChatContext(firstInteractionParams(meta, "coder"));
      expect(result.content).toContain("Memory System Guidelines");
      expect(result.content).toContain("read and write");
      expect(result.content).toContain("do NOT modify");
    });

    it("skips memory management prompt when interval not reached", async () => {
      const meta = makeMeta({
        project: { directory: "/tmp/nonexistent-for-test" },
      });
      // interactionCount=2, promptInterval default=5 → 2 % 5 != 0 → skip
      const result = await buildGroupChatContext(
        subsequentParams(meta, "coder", { interactionCount: 2 }),
      );
      expect(result.content).not.toContain("Memory System Guidelines");
    });
  });

  // ─── Core Files Injection (#14) ───

  describe("core files injection", () => {
    let tmpStateDir: string;
    let identityDir: string;
    const originalEnv = process.env;

    beforeEach(async () => {
      tmpStateDir = `/tmp/test-core-files-${Date.now()}`;
      identityDir = path.join(tmpStateDir, "cli-agents", "coder");
      await fs.mkdir(identityDir, { recursive: true });

      // Set OPENCLAW_STATE_DIR so resolveCliAgentIdentityDir finds our temp dir
      process.env = { ...originalEnv, OPENCLAW_STATE_DIR: tmpStateDir };
    });

    afterEach(async () => {
      process.env = originalEnv;
      await fs.rm(tmpStateDir, { recursive: true, force: true });
    });

    it("injects core file content on first interaction", async () => {
      await fs.writeFile(path.join(identityDir, "PERSONALITY.md"), "You are helpful and kind.");
      await fs.writeFile(path.join(identityDir, "SOUL.md"), "Always be honest.");

      const result = await buildGroupChatContext(firstInteractionParams(makeMeta(), "coder"));
      expect(result.content).toContain("### Core Files");
      expect(result.content).toContain("You are helpful and kind.");
      expect(result.content).toContain("Always be honest.");
    });

    it("injects core file paths on first interaction", async () => {
      await fs.writeFile(path.join(identityDir, "PERSONALITY.md"), "test");

      const result = await buildGroupChatContext(firstInteractionParams(makeMeta(), "coder"));
      expect(result.content).toContain("### Core File Paths");
      expect(result.content).toContain("PERSONALITY.md");
      expect(result.content).toContain("SOUL.md");
      expect(result.content).toContain("AGENTS.md");
    });

    it("injects only paths on subsequent interactions", async () => {
      await fs.writeFile(path.join(identityDir, "PERSONALITY.md"), "You are helpful.");

      const result = await buildGroupChatContext(subsequentParams(makeMeta(), "coder"));
      expect(result.content).toContain("### Core File Paths");
      expect(result.content).not.toContain("### Core Files");
      expect(result.content).not.toContain("You are helpful.");
    });

    it("skips core files when identity directory does not exist", async () => {
      // Use an agent that has no identity dir
      const result = await buildGroupChatContext(firstInteractionParams(makeMeta(), "reviewer"));
      expect(result.content).not.toContain("Core Files");
      expect(result.content).not.toContain("Core File Paths");
    });
  });
});
