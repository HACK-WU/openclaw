import { describe, expect, it } from "vitest";
import { buildPlanModeAssistantPrompt, buildPlanModeExecutorPrompt } from "./plan-mode-context.js";
import type { GroupSessionEntry } from "./types.js";

function makeMeta(overrides?: Partial<GroupSessionEntry>): GroupSessionEntry {
  return {
    groupId: "g1",
    messageMode: "unicast",
    members: [
      { agentId: "a1", role: "assistant", joinedAt: 0 },
      { agentId: "a2", role: "member", joinedAt: 0 },
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

describe("plan-mode-context", () => {
  describe("buildPlanModeAssistantPrompt", () => {
    it("returns coordinator prompt with plan mode header", () => {
      const prompt = buildPlanModeAssistantPrompt(makeMeta());
      expect(prompt).toContain("### 计划模式 — 你是协调者");
    });

    it("includes workflow steps: clarify, assign, plan, execute, summarize", () => {
      const prompt = buildPlanModeAssistantPrompt(makeMeta());
      expect(prompt).toContain("澄清（可选）");
      expect(prompt).toContain("分工");
      expect(prompt).toContain("计划");
      expect(prompt).toContain("执行");
      expect(prompt).toContain("总结");
    });

    it("includes collaboration file references: jobs.md, PLAN.md, PROGRESS.md, RESULTS.md", () => {
      const prompt = buildPlanModeAssistantPrompt(makeMeta());
      expect(prompt).toContain("jobs.md");
      expect(prompt).toContain("PLAN.md");
      expect(prompt).toContain("PROGRESS.md");
      expect(prompt).toContain("RESULTS.md");
    });

    it("includes .openclaw-group/ directory path", () => {
      const prompt = buildPlanModeAssistantPrompt(makeMeta());
      expect(prompt).toContain(".openclaw-group/");
    });

    it("injects maxRounds into safety limits", () => {
      const prompt = buildPlanModeAssistantPrompt(makeMeta({ maxRounds: 30 }));
      expect(prompt).toContain("maxRounds=30");
      // maxPlanRounds = floor(30/2) = 15
      expect(prompt).toContain("15 轮计划循环");
    });

    it("injects chainTimeout into safety limits (default 900000 = 15 min)", () => {
      const prompt = buildPlanModeAssistantPrompt(makeMeta());
      expect(prompt).toContain("15 分钟");
    });

    it("injects custom chainTimeout correctly", () => {
      const prompt = buildPlanModeAssistantPrompt(makeMeta({ chainTimeout: 600_000 }));
      expect(prompt).toContain("10 分钟");
    });

    it("includes project directory when available", () => {
      const prompt = buildPlanModeAssistantPrompt(
        makeMeta({ project: { directory: "/home/user/project" } }),
      );
      expect(prompt).toContain("/home/user/project");
      expect(prompt).toContain("项目目录");
    });

    it("omits project directory when not set", () => {
      const prompt = buildPlanModeAssistantPrompt(makeMeta());
      expect(prompt).not.toContain("项目目录");
    });

    it("includes decision criteria section", () => {
      const prompt = buildPlanModeAssistantPrompt(makeMeta());
      expect(prompt).toContain("决策准则");
      expect(prompt).toContain("RESULTS.md");
    });

    it("includes file format specifications", () => {
      const prompt = buildPlanModeAssistantPrompt(makeMeta());
      expect(prompt).toContain("分工格式");
      expect(prompt).toContain("计划格式");
      expect(prompt).toContain("进度格式");
    });

    it("includes executor trigger examples", () => {
      const prompt = buildPlanModeAssistantPrompt(makeMeta());
      expect(prompt).toContain("@backend");
      expect(prompt).toContain("PROGRESS.md");
    });
  });

  describe("buildPlanModeExecutorPrompt", () => {
    it("returns executor prompt with correct header", () => {
      const prompt = buildPlanModeExecutorPrompt(makeMeta());
      expect(prompt).toContain("### 计划模式 — 你是执行者");
    });

    it("includes executor workflow steps", () => {
      const prompt = buildPlanModeExecutorPrompt(makeMeta());
      expect(prompt).toContain("阅读计划");
      expect(prompt).toContain("了解职责");
      expect(prompt).toContain("执行任务");
      expect(prompt).toContain("更新进度");
    });

    it("references PLAN.md, jobs.md, and PROGRESS.md", () => {
      const prompt = buildPlanModeExecutorPrompt(makeMeta());
      expect(prompt).toContain(".openclaw-group/PLAN.md");
      expect(prompt).toContain(".openclaw-group/jobs.md");
      expect(prompt).toContain(".openclaw-group/PROGRESS.md");
    });

    it("includes progress update format with status markers", () => {
      const prompt = buildPlanModeExecutorPrompt(makeMeta());
      expect(prompt).toContain("已完成");
      expect(prompt).toContain("失败");
      expect(prompt).toContain("需重做");
    });

    it("includes note about only updating own steps", () => {
      const prompt = buildPlanModeExecutorPrompt(makeMeta());
      expect(prompt).toContain("只更新你自己负责的步骤");
    });

    it("includes bridge section when member has bridge config", () => {
      const prompt = buildPlanModeExecutorPrompt(
        makeMeta({
          members: [
            { agentId: "a1", role: "assistant", joinedAt: 0 },
            {
              agentId: "a2",
              role: "member",
              joinedAt: 0,
              bridge: {
                cliType: "claude-code",
                command: "claude",
              },
            },
          ],
        }),
      );
      expect(prompt).toContain("Bridge Agent 特殊说明");
      expect(prompt).toContain("CLI 工具");
    });

    it("omits bridge section when no members have bridge config", () => {
      const prompt = buildPlanModeExecutorPrompt(makeMeta());
      expect(prompt).not.toContain("Bridge Agent 特殊说明");
    });
  });
});
