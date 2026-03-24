import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCoreFilesContentSection, buildCoreFilesPathSection } from "./bridge-context.js";

vi.mock("../agents/cli-agent-scope.js", () => ({
  resolveCliAgentIdentityDir: vi.fn((agentId: string) => `/mock-state/cli-agents/${agentId}`),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: vi.fn(),
  },
}));

vi.mock("../logging.js", () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("buildCoreFilesContentSection", () => {
  it("should read and include PERSONALITY.md, SOUL.md, AGENTS.md content", async () => {
    const mockReadFile = vi.mocked(fs.readFile);
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.includes("PERSONALITY.md")) {
        return "性格内容";
      }
      if (filePath.includes("SOUL.md")) {
        return "灵魂内容";
      }
      if (filePath.includes("AGENTS.md")) {
        return "项目指南内容";
      }
      throw new Error("File not found");
    });

    const result = await buildCoreFilesContentSection("test-agent");

    expect(result).toContain("PERSONALITY.md");
    expect(result).toContain("SOUL.md");
    expect(result).toContain("AGENTS.md");
    expect(result).toContain("# 性格内容");
    expect(result).toContain("# 灵魂内容");
    expect(result).toContain("# 项目指南内容");
  });

  it("should include file paths in content section", async () => {
    const mockReadFile = vi.mocked(fs.readFile);
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.includes("PERSONALITY.md")) {
        return "性格内容";
      }
      if (filePath.includes("SOUL.md")) {
        return "灵魂内容";
      }
      if (filePath.includes("AGENTS.md")) {
        return "项目指南内容";
      }
      throw new Error("File not found");
    });

    const result = await buildCoreFilesContentSection("test-agent");

    // 验证路径使用身份文件存储目录
    expect(result).toContain(path.join("/mock-state/cli-agents/test-agent", "PERSONALITY.md"));
    expect(result).toContain(path.join("/mock-state/cli-agents/test-agent", "SOUL.md"));
    expect(result).toContain(path.join("/mock-state/cli-agents/test-agent", "AGENTS.md"));
  });

  it("should handle missing files gracefully", async () => {
    const mockReadFile = vi.mocked(fs.readFile);
    mockReadFile.mockRejectedValue(new Error("File not found"));

    const result = await buildCoreFilesContentSection("test-agent");

    expect(result).toContain("[文件不存在或为空]");
    // 应该有 3 个 [文件不存在或为空]（每个文件一个）
    const matches = result.match(/\[文件不存在或为空\]/g);
    expect(matches).toHaveLength(3);
  });

  it("should handle empty file content as missing", async () => {
    const mockReadFile = vi.mocked(fs.readFile);
    mockReadFile.mockResolvedValue("   \n  \n  ");

    const result = await buildCoreFilesContentSection("test-agent");

    expect(result).toContain("[文件不存在或为空]");
  });

  it("should not include IDENTITY.md and TOOLS.md content", async () => {
    const mockReadFile = vi.mocked(fs.readFile);
    mockReadFile.mockResolvedValue("some content");

    const result = await buildCoreFilesContentSection("test-agent");

    // IDENTITY.md 和 TOOLS.md 不在首次内容注入中
    expect(result).not.toContain("IDENTITY.md — 你是谁");
    expect(result).not.toContain("TOOLS.md — 工具与环境笔记");
  });

  it("should prefix each content line with #", async () => {
    const mockReadFile = vi.mocked(fs.readFile);
    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.includes("PERSONALITY.md")) {
        return "line1\nline2\nline3";
      }
      if (filePath.includes("SOUL.md")) {
        return "soul line";
      }
      if (filePath.includes("AGENTS.md")) {
        return "agents line";
      }
      throw new Error("File not found");
    });

    const result = await buildCoreFilesContentSection("test-agent");

    expect(result).toContain("# line1");
    expect(result).toContain("# line2");
    expect(result).toContain("# line3");
    expect(result).toContain("# soul line");
    expect(result).toContain("# agents line");
  });

  it("should include section header and footer", async () => {
    const mockReadFile = vi.mocked(fs.readFile);
    mockReadFile.mockRejectedValue(new Error("File not found"));

    const result = await buildCoreFilesContentSection("test-agent");

    expect(result).toContain("核心文件内容（定义你的性格、行为准则和项目规范）");
    // 区块应以分隔线开始和结束
    const lines = result.split("\n");
    expect(lines[0]).toContain("====");
    expect(lines[lines.length - 1]).toContain("====");
  });

  it("should read files in parallel", async () => {
    let callOrder: string[] = [];
    const mockReadFile = vi.mocked(fs.readFile);
    mockReadFile.mockImplementation(async (filePath: string) => {
      const fileName = path.basename(filePath);
      callOrder.push(fileName);
      // 模拟异步延迟
      await new Promise((r) => setTimeout(r, 10));
      return `content of ${fileName}`;
    });

    await buildCoreFilesContentSection("test-agent");

    // 应该并行调用 3 次
    expect(mockReadFile).toHaveBeenCalledTimes(3);
  });
});

describe("buildCoreFilesPathSection", () => {
  it("should include all five core file paths", () => {
    const result = buildCoreFilesPathSection("test-agent");

    // 验证路径使用的是身份文件存储目录，而非工作目录
    expect(result).toContain(path.join("/mock-state/cli-agents/test-agent", "IDENTITY.md"));
    expect(result).toContain(path.join("/mock-state/cli-agents/test-agent", "PERSONALITY.md"));
    expect(result).toContain(path.join("/mock-state/cli-agents/test-agent", "SOUL.md"));
    expect(result).toContain(path.join("/mock-state/cli-agents/test-agent", "AGENTS.md"));
    expect(result).toContain(path.join("/mock-state/cli-agents/test-agent", "TOOLS.md"));
  });

  it("should not read file contents", () => {
    const mockReadFile = vi.mocked(fs.readFile);

    buildCoreFilesPathSection("test-agent");

    // 不应该调用文件读取
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("should include section header and footer", () => {
    const result = buildCoreFilesPathSection("test-agent");

    expect(result).toContain("核心文件路径（需要时可自行读取）");
    const lines = result.split("\n");
    expect(lines[0]).toContain("====");
    expect(lines[lines.length - 1]).toContain("====");
  });

  it("should include file descriptions", () => {
    const result = buildCoreFilesPathSection("test-agent");

    expect(result).toContain("IDENTITY.md — 你是谁");
    expect(result).toContain("PERSONALITY.md — 你的性格");
    expect(result).toContain("SOUL.md — 你的灵魂");
    expect(result).toContain("AGENTS.md — 项目指南");
    expect(result).toContain("TOOLS.md — 工具与环境笔记");
  });

  it("should include category separators", () => {
    const result = buildCoreFilesPathSection("test-agent");

    expect(result).toContain("身份与记忆");
    expect(result).toContain("项目与工具");
  });

  it("should be a synchronous function (no file I/O)", () => {
    // buildCoreFilesPathSection 是同步函数，返回值不是 Promise
    const result = buildCoreFilesPathSection("test-agent");

    expect(typeof result).toBe("string");
    // 不是 Promise
    expect(result).not.toHaveProperty("then");
  });
});
