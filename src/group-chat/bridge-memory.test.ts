import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkMergeCooldown,
  cleanupGroupMemory,
  clearMergeState,
  ensureProjectMemoryFiles,
  ensureTempMemoryFiles,
  getMergeState,
  getMemoryStatus,
  isEmptyTemplate,
  markMemoryDirty,
  markMergeComplete,
  markMergeStart,
  resolveProjectMemoryPaths,
  resolveTempMemoryPaths,
  sanitizeGroupDirName,
  scanAgentMemoryFiles,
  shouldInjectMemoryContent,
  shouldInjectMemoryPrompt,
  checkMemoryBeforeDissolve,
  _test,
} from "./bridge-memory.js";

// ─── sanitizeGroupDirName ───

describe("sanitizeGroupDirName", () => {
  it("passes through safe names unchanged", () => {
    expect(sanitizeGroupDirName("项目开发组", "id1")).toBe("项目开发组");
  });

  it("replaces slashes and backslashes", () => {
    expect(sanitizeGroupDirName("a/b\\c", "id1")).toBe("a_b_c");
  });

  it("replaces double dots", () => {
    expect(sanitizeGroupDirName("a..b", "id1")).toBe("a_b");
  });

  it("replaces colons and special chars", () => {
    expect(sanitizeGroupDirName('a:b*c?"d', "id1")).toBe("a_b_c_d");
  });

  it("falls back to group-{hash} for empty name", () => {
    const result = sanitizeGroupDirName("", "test-id");
    expect(result).toMatch(/^group-[a-f0-9]{7}$/);
  });

  it("falls back to group-{hash} for all-illegal chars", () => {
    const result = sanitizeGroupDirName("///\\\\", "test-id");
    expect(result).toMatch(/^group-[a-f0-9]{7}$/);
  });

  it("truncates long names with hash suffix", () => {
    const longName = "a".repeat(100);
    const result = sanitizeGroupDirName(longName, "id1");
    expect(result.length).toBeLessThanOrEqual(64);
    expect(result).toMatch(/-[a-f0-9]{7}$/);
  });

  it("keeps names at max length", () => {
    const exactName = "a".repeat(64);
    expect(sanitizeGroupDirName(exactName, "id1")).toBe(exactName);
  });
});

// ─── Path Resolution ───

describe("resolveProjectMemoryPaths", () => {
  it("returns correct paths for project memory mode", () => {
    const paths = resolveProjectMemoryPaths("/project", "devgroup", "claude-code");
    expect(paths.dir).toBe(path.join("/project", ".openclaw", "devgroup"));
    expect(paths.projectLevelMemoryFile).toBe(path.join("/project", ".openclaw", "MEMORY.md"));
    expect(paths.sharedMemoryFile).toBe(
      path.join("/project", ".openclaw", "devgroup", "MEMORY.md"),
    );
    expect(paths.sharedSessionFile).toBe(
      path.join("/project", ".openclaw", "devgroup", "SESSION.md"),
    );
    expect(paths.agentMemoryFile).toBe(
      path.join("/project", ".openclaw", "devgroup", "claude-code.md"),
    );
  });
});

describe("resolveTempMemoryPaths", () => {
  it("returns correct paths for temp memory mode", () => {
    const paths = resolveTempMemoryPaths("/state", "group-123", "opencode");
    expect(paths.dir).toBe(path.join("/state", "group-memory", "group-123"));
    expect(paths.agentMemoryFile).toBe(
      path.join("/state", "group-memory", "group-123", "opencode.md"),
    );
  });
});

// ─── isEmptyTemplate ───

describe("isEmptyTemplate", () => {
  it("returns true for MEMORY.md template", () => {
    expect(isEmptyTemplate(_test.MEMORY_TEMPLATE)).toBe(true);
  });

  it("returns true for SESSION.md template", () => {
    expect(isEmptyTemplate(_test.SESSION_TEMPLATE)).toBe(true);
  });

  it("returns true for agent memory template", () => {
    expect(isEmptyTemplate(_test.agentMemoryTemplate("claude-code"))).toBe(true);
  });

  it("returns false for content with bullet points", () => {
    expect(isEmptyTemplate(`# Project Memory\n\n## 架构决策\n\n- JWT 认证\n`)).toBe(false);
  });

  it("returns false for content with plain text", () => {
    expect(isEmptyTemplate("Some actual content")).toBe(false);
  });

  it("returns true for heading-only content", () => {
    expect(isEmptyTemplate("# Title\n\n## Section\n\n### Sub")).toBe(true);
  });
});

// ─── Injection Frequency ───

describe("shouldInjectMemoryContent", () => {
  it("always injects on first interaction", () => {
    expect(shouldInjectMemoryContent(true, 0, 6)).toBe(true);
    expect(shouldInjectMemoryContent(true, 5, 6)).toBe(true);
  });

  it("does not inject at count 0 for non-first interaction", () => {
    expect(shouldInjectMemoryContent(false, 0, 6)).toBe(false);
  });

  it("injects at multiples of interval", () => {
    expect(shouldInjectMemoryContent(false, 6, 6)).toBe(true);
    expect(shouldInjectMemoryContent(false, 12, 6)).toBe(true);
    expect(shouldInjectMemoryContent(false, 18, 6)).toBe(true);
  });

  it("does not inject at non-multiples", () => {
    expect(shouldInjectMemoryContent(false, 1, 6)).toBe(false);
    expect(shouldInjectMemoryContent(false, 3, 6)).toBe(false);
    expect(shouldInjectMemoryContent(false, 7, 6)).toBe(false);
  });
});

describe("shouldInjectMemoryPrompt", () => {
  it("always injects on first interaction", () => {
    expect(shouldInjectMemoryPrompt(true, 0, 5)).toBe(true);
  });

  it("injects at multiples of 5", () => {
    expect(shouldInjectMemoryPrompt(false, 5, 5)).toBe(true);
    expect(shouldInjectMemoryPrompt(false, 10, 5)).toBe(true);
  });

  it("does not inject at non-multiples", () => {
    expect(shouldInjectMemoryPrompt(false, 3, 5)).toBe(false);
    expect(shouldInjectMemoryPrompt(false, 7, 5)).toBe(false);
  });
});

// ─── Merge Cooldown ───

describe("merge cooldown", () => {
  const groupId = "test-group";

  beforeEach(() => {
    clearMergeState(groupId);
  });

  it("allows first merge", () => {
    const result = checkMergeCooldown(groupId, "auto");
    expect(result.allowed).toBe(true);
  });

  it("rejects during active merge", () => {
    markMergeStart(groupId);
    const result = checkMergeCooldown(groupId, "auto");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("merging");
  });

  it("rejects during cooldown", () => {
    markMergeComplete(groupId, "auto");
    const result = checkMergeCooldown(groupId, "auto", 60_000);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("cooldown");
    expect(result.cooldownRemainMs).toBeGreaterThan(0);
  });

  it("allows after cooldown expires", () => {
    const state = getMergeState(groupId);
    state.lastMergeAt = Date.now() - 400_000; // 6.7 minutes ago
    state.dirtyAfterMerge = true;
    const result = checkMergeCooldown(groupId, "auto", 300_000);
    expect(result.allowed).toBe(true);
  });

  it("rejects auto merge when not dirty", () => {
    const state = getMergeState(groupId);
    state.dirtyAfterMerge = false;
    state.lastMergeAt = Date.now() - 400_000;
    const result = checkMergeCooldown(groupId, "auto", 300_000);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("no-dirty");
  });

  it("allows manual merge even when not dirty", () => {
    const state = getMergeState(groupId);
    state.dirtyAfterMerge = false;
    state.lastMergeAt = Date.now() - 400_000;
    const result = checkMergeCooldown(groupId, "manual-merge", 300_000);
    expect(result.allowed).toBe(true);
  });

  it("releases lock on merge timeout", () => {
    markMergeStart(groupId);
    const state = getMergeState(groupId);
    state.mergingStartedAt = Date.now() - 200_000; // 3.3 minutes ago (> 3 min timeout)
    const result = checkMergeCooldown(groupId, "auto");
    expect(result.allowed).toBe(true);
  });

  it("markMemoryDirty sets dirtyAfterMerge", () => {
    markMergeComplete(groupId, "auto");
    expect(getMergeState(groupId).dirtyAfterMerge).toBe(false);
    markMemoryDirty(groupId);
    expect(getMergeState(groupId).dirtyAfterMerge).toBe(true);
  });
});

// ─── File Operations (with temp dirs) ───

describe("file operations", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-memory-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("ensureProjectMemoryFiles", () => {
    it("creates all required files", async () => {
      await ensureProjectMemoryFiles(tmpDir, "testgroup", "claude-code");
      const dir = path.join(tmpDir, ".openclaw", "testgroup");

      const memory = await fs.readFile(path.join(dir, "MEMORY.md"), "utf-8");
      expect(memory).toContain("# Project Memory");

      const session = await fs.readFile(path.join(dir, "SESSION.md"), "utf-8");
      expect(session).toContain("# Session Notes");

      const agent = await fs.readFile(path.join(dir, "claude-code.md"), "utf-8");
      expect(agent).toContain("# claude-code Memory");

      const projectLevel = await fs.readFile(path.join(tmpDir, ".openclaw", "MEMORY.md"), "utf-8");
      expect(projectLevel).toContain("跨群聊");
    });

    it("does not overwrite existing files", async () => {
      await ensureProjectMemoryFiles(tmpDir, "testgroup", "claude-code");
      const memPath = path.join(tmpDir, ".openclaw", "testgroup", "MEMORY.md");
      await fs.writeFile(memPath, "custom content");
      await ensureProjectMemoryFiles(tmpDir, "testgroup", "claude-code");
      const content = await fs.readFile(memPath, "utf-8");
      expect(content).toBe("custom content");
    });

    it("inherits project-level memory", async () => {
      const baseDir = path.join(tmpDir, ".openclaw");
      await fs.mkdir(baseDir, { recursive: true });
      await fs.writeFile(
        path.join(baseDir, "MEMORY.md"),
        "# Project Memory\n\n## 架构决策\n\n- JWT 认证\n",
      );

      await ensureProjectMemoryFiles(tmpDir, "newgroup", "agent1");
      const content = await fs.readFile(path.join(baseDir, "newgroup", "MEMORY.md"), "utf-8");
      expect(content).toContain("JWT 认证");
    });
  });

  describe("ensureTempMemoryFiles", () => {
    it("creates agent memory file", async () => {
      await ensureTempMemoryFiles(tmpDir, "group-123", "opencode");
      const content = await fs.readFile(
        path.join(tmpDir, "group-memory", "group-123", "opencode.md"),
        "utf-8",
      );
      expect(content).toContain("# opencode Memory");
    });
  });

  describe("scanAgentMemoryFiles", () => {
    it("returns agent memory files excluding shared files", async () => {
      const dir = path.join(tmpDir, "scan-test");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "MEMORY.md"), "");
      await fs.writeFile(path.join(dir, "SESSION.md"), "");
      await fs.writeFile(path.join(dir, "claude-code.md"), "");
      await fs.writeFile(path.join(dir, "opencode.md"), "");

      const files = await scanAgentMemoryFiles(dir);
      expect(files).toHaveLength(2);
      expect(files.map((f) => path.basename(f)).toSorted()).toEqual([
        "claude-code.md",
        "opencode.md",
      ]);
    });

    it("returns empty array for non-existent directory", async () => {
      const files = await scanAgentMemoryFiles("/non/existent/dir");
      expect(files).toEqual([]);
    });
  });

  describe("getMemoryStatus", () => {
    it("reports correct status for project memory mode", async () => {
      await ensureProjectMemoryFiles(tmpDir, "statusgroup", "agent1");
      const status = await getMemoryStatus({
        projectDir: tmpDir,
        stateDir: tmpDir,
        groupId: "g1",
        groupName: "statusgroup",
        agentIds: ["agent1"],
        maxSizeKB: 50,
      });

      expect(status.files).toHaveLength(3); // MEMORY.md, SESSION.md, agent1.md
      expect(status.totalSize).toBeGreaterThan(0);
      expect(status.maxSizeKB).toBe(50);
      expect(status.warning).toBe("ok");
    });

    it("reports approaching-limit warning", async () => {
      await ensureProjectMemoryFiles(tmpDir, "warngroup", "agent1");
      const memPath = path.join(tmpDir, ".openclaw", "warngroup", "MEMORY.md");
      await fs.writeFile(memPath, "x".repeat(42 * 1024)); // 42KB → 84% of 50KB

      const status = await getMemoryStatus({
        projectDir: tmpDir,
        stateDir: tmpDir,
        groupId: "g1",
        groupName: "warngroup",
        agentIds: ["agent1"],
        maxSizeKB: 50,
      });

      expect(status.warning).toBe("approaching-limit");
    });
  });

  describe("checkMemoryBeforeDissolve", () => {
    it("returns false for non-existent memory", async () => {
      const result = await checkMemoryBeforeDissolve(tmpDir, "nonexistent");
      expect(result.hasMemory).toBe(false);
    });

    it("returns false for empty template memory", async () => {
      await ensureProjectMemoryFiles(tmpDir, "dissolvegroup", "agent1");
      const result = await checkMemoryBeforeDissolve(tmpDir, "dissolvegroup");
      expect(result.hasMemory).toBe(false);
    });

    it("returns true for memory with content", async () => {
      await ensureProjectMemoryFiles(tmpDir, "dissolvegroup2", "agent1");
      const memPath = path.join(tmpDir, ".openclaw", "dissolvegroup2", "MEMORY.md");
      await fs.writeFile(memPath, "# Project Memory\n\n## 架构决策\n\n- Real content here\n");
      const result = await checkMemoryBeforeDissolve(tmpDir, "dissolvegroup2");
      expect(result.hasMemory).toBe(true);
      expect(result.memorySize).toBeGreaterThan(0);
    });

    it("returns false when projectDir is undefined", async () => {
      const result = await checkMemoryBeforeDissolve(undefined, "any");
      expect(result.hasMemory).toBe(false);
    });
  });

  describe("cleanupGroupMemory", () => {
    it("removes project memory directory", async () => {
      await ensureProjectMemoryFiles(tmpDir, "cleangroup", "agent1");
      const dir = path.join(tmpDir, ".openclaw", "cleangroup");
      expect(
        await fs
          .access(dir)
          .then(() => true)
          .catch(() => false),
      ).toBe(true);

      await cleanupGroupMemory({
        projectDir: tmpDir,
        stateDir: tmpDir,
        groupId: "g1",
        groupName: "cleangroup",
      });

      expect(
        await fs
          .access(dir)
          .then(() => true)
          .catch(() => false),
      ).toBe(false);
    });

    it("removes temp memory directory", async () => {
      await ensureTempMemoryFiles(tmpDir, "temp-group", "agent1");
      const dir = path.join(tmpDir, "group-memory", "temp-group");
      expect(
        await fs
          .access(dir)
          .then(() => true)
          .catch(() => false),
      ).toBe(true);

      await cleanupGroupMemory({
        projectDir: undefined,
        stateDir: tmpDir,
        groupId: "temp-group",
        groupName: "temp-group",
      });

      expect(
        await fs
          .access(dir)
          .then(() => true)
          .catch(() => false),
      ).toBe(false);
    });
  });
});
