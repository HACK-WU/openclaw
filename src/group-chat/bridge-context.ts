/**
 * Group Chat — Bridge Context: Core Files Injection
 *
 * Builds the core-files sections injected into CLI Agent context:
 * - First interaction: read & inject PERSONALITY.md / SOUL.md / AGENTS.md content + all paths
 * - Subsequent interactions: inject file paths only (no content reading)
 *
 * Core files are stored in the CLI Agent's identity directory
 * ({stateDir}/cli-agents/{agentId}/), NOT the working directory (cwd).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { resolveCliAgentIdentityDir } from "../agents/cli-agent-scope.js";
import { getLogger } from "../logging.js";

const log = getLogger("group-chat:bridge-context");

/**
 * 需要在首次交互时读取内容的核心文件列表
 */
const FIRST_INTERACTION_CONTENT_FILES = ["PERSONALITY.md", "SOUL.md", "AGENTS.md"] as const;

/**
 * 所有核心文件及其中文标题
 */
const CORE_FILE_TITLES: Record<string, string> = {
  "IDENTITY.md": "你是谁",
  "PERSONALITY.md": "你的性格",
  "SOUL.md": "你的灵魂",
  "AGENTS.md": "项目指南",
  "TOOLS.md": "工具与环境笔记",
};

/**
 * 读取单个核心文件内容
 *
 * @param identityDir - CLI Agent 身份文件存储目录
 * @param fileName - 文件名
 * @returns 文件内容，如果文件不存在则返回 null
 */
async function readCoreFileContent(identityDir: string, fileName: string): Promise<string | null> {
  const filePath = path.join(identityDir, fileName);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content.trim() || null;
  } catch {
    // 文件不存在或读取失败，返回 null
    log.debug(`Core file not found or unreadable: ${filePath}`);
    return null;
  }
}

/**
 * 构建首次交互的核心文件内容区块
 *
 * 读取 PERSONALITY.md、SOUL.md、AGENTS.md 的内容并注入。
 * 注意：此函数仅构建「内容区块」，路径区块由 buildCoreFilesPathSection() 额外注入。
 *
 * @param agentId - CLI Agent ID
 * @param env - 环境变量（用于解析状态目录）
 */
export async function buildCoreFilesContentSection(
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  // 获取 CLI Agent 身份文件存储目录（注意：这是身份文件目录，不是工作目录 cwd）
  const identityDir = resolveCliAgentIdentityDir(agentId, env);
  const lines: string[] = [];

  lines.push(
    "# ================================================================================",
    "# 核心文件内容（定义你的性格、行为准则和项目规范）",
    "# ================================================================================",
    "",
  );

  // 并行读取所有文件内容
  const readResults = await Promise.all(
    FIRST_INTERACTION_CONTENT_FILES.map(async (fileName) => ({
      fileName,
      content: await readCoreFileContent(identityDir, fileName),
    })),
  );

  for (const { fileName, content } of readResults) {
    const fileTitle = CORE_FILE_TITLES[fileName] ?? fileName;

    lines.push(`# ─── ${fileName} — ${fileTitle} ───`);
    lines.push(`# 路径：${path.join(identityDir, fileName)}`);
    lines.push("");

    if (content) {
      // 将文件内容每行添加 # 前缀
      const contentLines = content.split("\n").map((line) => `# ${line}`);
      lines.push(...contentLines);
    } else {
      lines.push("# [文件不存在或为空]");
    }
    lines.push("");
  }

  lines.push("# ================================================================================");

  return lines.join("\n");
}

/**
 * 构建核心文件路径区块
 *
 * 注入所有核心文件的路径说明，不读取文件内容。
 * 首次启动和后续每次对话都会调用此函数。
 *
 * @param agentId - CLI Agent ID
 * @param env - 环境变量（用于解析状态目录）
 */
export function buildCoreFilesPathSection(
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  // 获取 CLI Agent 身份文件存储目录（注意：这是身份文件目录，不是工作目录 cwd）
  const identityDir = resolveCliAgentIdentityDir(agentId, env);

  const lines = [
    "# ================================================================================",
    "# 核心文件路径（需要时可自行读取）",
    "# ================================================================================",
    "",
    "# ─── 身份与记忆 ───",
    "",
    "# IDENTITY.md — 你是谁",
    `# 路径：${path.join(identityDir, "IDENTITY.md")}`,
    "",
    "# PERSONALITY.md — 你的性格",
    `# 路径：${path.join(identityDir, "PERSONALITY.md")}`,
    "",
    "# SOUL.md — 你的灵魂",
    `# 路径：${path.join(identityDir, "SOUL.md")}`,
    "",
    "# ─── 项目与工具 ───",
    "",
    "# AGENTS.md — 项目指南",
    `# 路径：${path.join(identityDir, "AGENTS.md")}`,
    "",
    "# TOOLS.md — 工具与环境笔记",
    `# 路径：${path.join(identityDir, "TOOLS.md")}`,
    "",
    "# ================================================================================",
  ];

  return lines.join("\n");
}
