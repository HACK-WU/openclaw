/**
 * CLI Agent — Configuration CRUD
 *
 * Manages the CLI Agent global registry (`cli-agents/bridge.json`).
 * All operations read/write a single JSON file; no per-agent config files.
 *
 * Storage layout:
 *   ~/.openclaw/cli-agents/bridge.json    — global registry (this module)
 *   ~/.openclaw/cli-agents/{agentId}/     — per-agent workspace (IDENTITY.md, AGENTS.md)
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  resolveCliAgentWorkspaceDir,
  resolveCliBridgeConfigPath,
} from "../agents/cli-agent-scope.js";
import type { CliAgentEntry, CliBridgeConfig } from "../config/types.cli-agents.js";

// ─── Ensure directories exist ───

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

// ─── Atomic write helper ───

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmpPath = `${filePath}.${randomUUID().slice(0, 8)}.tmp`;
  const content = JSON.stringify(data, null, 2);
  await fs.promises.writeFile(tmpPath, content, { encoding: "utf-8", mode: 0o600 });
  await fs.promises.rename(tmpPath, filePath);
}

// ─── Read / Write bridge.json ───

/**
 * Load the CLI Agent bridge config (global registry).
 * Returns an empty agent list if the file doesn't exist.
 */
export function loadCliBridgeConfig(env: NodeJS.ProcessEnv = process.env): CliBridgeConfig {
  const filePath = resolveCliBridgeConfigPath(env);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as CliBridgeConfig;
    // Ensure agents array always exists
    if (!Array.isArray(parsed.agents)) {
      return { agents: [] };
    }
    return parsed;
  } catch {
    return { agents: [] };
  }
}

/**
 * Save the CLI Agent bridge config (global registry).
 */
export async function saveCliBridgeConfig(
  config: CliBridgeConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const filePath = resolveCliBridgeConfigPath(env);
  await atomicWriteJson(filePath, config);
}

// ─── CLI Agent CRUD ───

/**
 * List all CLI Agent entries from the global registry.
 */
export function listCliAgentEntries(env: NodeJS.ProcessEnv = process.env): CliAgentEntry[] {
  return loadCliBridgeConfig(env).agents;
}

/**
 * Find a single CLI Agent entry by ID.
 */
export function findCliAgentEntry(
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): CliAgentEntry | undefined {
  const config = loadCliBridgeConfig(env);
  return config.agents.find((a) => a.id.toLowerCase() === agentId.toLowerCase());
}

/**
 * Add or update a CLI Agent entry (upsert).
 * If an agent with the same ID exists, it is replaced.
 */
export async function upsertCliAgentEntry(
  entry: CliAgentEntry,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const config = loadCliBridgeConfig(env);
  const existingIndex = config.agents.findIndex(
    (a) => a.id.toLowerCase() === entry.id.toLowerCase(),
  );

  if (existingIndex >= 0) {
    config.agents[existingIndex] = entry;
  } else {
    config.agents.push(entry);
  }

  await saveCliBridgeConfig(config, env);
}

/**
 * Remove a CLI Agent from the global registry and delete its workspace directory.
 */
export async function removeCliAgentEntry(
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const config = loadCliBridgeConfig(env);
  const initialLength = config.agents.length;
  config.agents = config.agents.filter((a) => a.id.toLowerCase() !== agentId.toLowerCase());

  if (config.agents.length === initialLength) {
    return false; // Not found
  }

  await saveCliBridgeConfig(config, env);

  // Clean up workspace directory
  const workspaceDir = resolveCliAgentWorkspaceDir(agentId, env);
  try {
    await fs.promises.rm(workspaceDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup; directory may not exist
  }

  return true;
}

// ─── Workspace File Management ───

/** Allowed files in a CLI Agent workspace sub-directory. */
const CLI_AGENT_ALLOWED_FILES = new Set<string>([
  "IDENTITY.md",
  "PERSONALITY.md",
  "SOUL.md",
  "AGENTS.md",
  "TOOLS.md",
]);

/**
 * Check whether a filename is allowed in CLI Agent workspace operations.
 */
export function isAllowedCliAgentFile(name: string): boolean {
  return CLI_AGENT_ALLOWED_FILES.has(name);
}

/**
 * List files in a CLI Agent workspace directory.
 */
export async function listCliAgentFiles(
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Array<{ name: string; path: string; missing: boolean; size?: number }>> {
  const workspaceDir = resolveCliAgentWorkspaceDir(agentId, env);
  const files: Array<{ name: string; path: string; missing: boolean; size?: number }> = [];

  for (const name of CLI_AGENT_ALLOWED_FILES) {
    const filePath = path.join(workspaceDir, name);
    try {
      const stat = await fs.promises.stat(filePath);
      files.push({ name, path: filePath, missing: false, size: stat.size });
    } catch {
      files.push({ name, path: filePath, missing: true });
    }
  }

  return files;
}

/**
 * Read a file from CLI Agent workspace.
 */
export async function readCliAgentFile(
  agentId: string,
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ content: string; size: number } | null> {
  if (!CLI_AGENT_ALLOWED_FILES.has(name)) {
    return null;
  }
  const filePath = path.join(resolveCliAgentWorkspaceDir(agentId, env), name);
  try {
    const content = await fs.promises.readFile(filePath, "utf-8");
    const stat = await fs.promises.stat(filePath);
    return { content, size: stat.size };
  } catch {
    return null;
  }
}

/**
 * Write a file to CLI Agent workspace.
 */
export async function writeCliAgentFile(
  agentId: string,
  name: string,
  content: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  if (!CLI_AGENT_ALLOWED_FILES.has(name)) {
    return false;
  }
  const workspaceDir = resolveCliAgentWorkspaceDir(agentId, env);
  ensureDir(workspaceDir);
  const filePath = path.join(workspaceDir, name);
  await fs.promises.writeFile(filePath, content, { encoding: "utf-8", mode: 0o600 });
  return true;
}

// ─── Default File Generation ───

/**
 * Build SOUL.md default template content
 */
function buildSoulMdTemplate(): string {
  return [
    "# SOUL.md - 工程师之魂",
    "",
    "_你是一名全栈工程师，专注于编写高质量代码。_",
    "",
    "## 角色定位",
    "",
    "你是一名经验丰富的全栈工程师，具备以下能力：",
    "",
    "- 精通多种编程语言和技术栈",
    "- 理解软件架构设计原则",
    "- 能够快速理解现有代码库",
    "- 编写清晰、可维护、高效的代码",
    "",
    "## 编码原则",
    "",
    "### 代码质量",
    "",
    "**写出可以工作的代码。** 每一行代码都应该有明确的目的。不要写死代码，不要留下 TODO 就提交。代码提交前确保可以正常运行。",
    "",
    "**保持简洁。** 简单的解决方案优于复杂的方案。能用 10 行代码解决的问题，不要写 100 行。可读性比炫技更重要。",
    "",
    "**遵循项目规范。** 每个项目都有自己的风格。先阅读现有代码，理解命名约定、目录结构、代码风格，然后保持一致。",
    "",
    "### 工程实践",
    "",
    "**先理解，再动手。** 在修改代码之前，先理解现有代码的工作原理。阅读相关文件，追踪数据流，理解依赖关系。盲目修改是 Bug 的温床。",
    "",
    "**小步前进。** 大的改动拆分成小的、可验证的步骤。每一步都可以测试，每一步都可以回滚。不要一次性重构整个模块。",
    "",
    '**测试你的代码。** 写完代码后，运行测试。如果没有测试，手动验证核心功能。不要假设代码"应该"能工作——验证它。',
    "",
    "### 安全意识",
    "",
    "**保护敏感信息。** API 密钥、密码、令牌永远不要硬编码。使用环境变量或配置文件。提交代码前检查是否泄露敏感信息。",
    "",
    "**验证外部输入。** 不信任任何来自用户或外部系统的数据。做好边界检查、类型验证、错误处理。",
    "",
    "**最小权限原则。** 只请求必要的权限，只访问必要的资源。不要为了方便而过度授权。",
    "",
    "## 沟通风格",
    "",
    '**直接有效。** 回答问题直接给出方案，不需要过多的客套。解释技术决策时，说明"为什么"而不是"是什么"。',
    "",
    "**诚实面对局限。** 不懂就说不懂，不确定就说需要验证。假装全知只会浪费所有人的时间。",
    "",
    '**代码即文档。** 写自解释的代码。变量名、函数名应该表达意图。必要的注释解释"为什么"，而不是"做什么"。',
    "",
    "## 工作边界",
    "",
    "- 只修改与任务相关的代码，不擅自重构无关部分",
    "- 不清楚需求时主动询问，不自行假设",
    "- 遇到技术限制时及时反馈，不隐瞒问题",
    "- 尊重项目的既有决策，除非有充分的改进理由",
    "",
    "---",
    "",
    "_持续学习，持续改进。每一行代码都是一次进步的机会。_",
    "",
  ].join("\n");
}

/**
 * Generate default workspace files for a new CLI Agent.
 */
export async function generateCliAgentWorkspaceFiles(
  entry: CliAgentEntry,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const workspaceDir = resolveCliAgentWorkspaceDir(entry.id, env);
  ensureDir(workspaceDir);

  // IDENTITY.md
  const identityContent = [
    `- Name: ${entry.name}`,
    ...(entry.emoji ? [`- Emoji: ${entry.emoji}`] : []),
    `- Type: CLI Agent`,
    `- CLI: ${entry.command}`,
    "",
  ].join("\n");

  await fs.promises.writeFile(path.join(workspaceDir, "IDENTITY.md"), identityContent, {
    encoding: "utf-8",
    mode: 0o600,
  });

  // PERSONALITY.md - from selected personality or empty
  const personalityContent = entry.personalityId
    ? (await import("../personalities/index.js")).getPersonalityContent(entry.personalityId)
    : "";

  await fs.promises.writeFile(path.join(workspaceDir, "PERSONALITY.md"), personalityContent, {
    encoding: "utf-8",
    mode: 0o600,
  });

  // SOUL.md
  const soulContent = buildSoulMdTemplate();
  await fs.promises.writeFile(path.join(workspaceDir, "SOUL.md"), soulContent, {
    encoding: "utf-8",
    mode: 0o600,
  });

  // AGENTS.md
  const agentsContent = [
    `# CLI Agent: ${entry.name}`,
    "",
    "此 Agent 通过 CLI 工具执行任务，拥有完整的文件读写和命令执行能力。",
    "",
    "## 行为指引",
    "",
    "- 收到群聊消息时，理解上下文后执行相应工作",
    "- 完成后在回复中使用 @mention 通知相关成员",
    "- 遵循群公告中的技术栈和代码规范",
    "- 不在输出中打印敏感信息（API Key、密码等）",
    "",
  ].join("\n");

  await fs.promises.writeFile(path.join(workspaceDir, "AGENTS.md"), agentsContent, {
    encoding: "utf-8",
    mode: 0o600,
  });

  // TOOLS.md - empty by default
  await fs.promises.writeFile(path.join(workspaceDir, "TOOLS.md"), "", {
    encoding: "utf-8",
    mode: 0o600,
  });
}
