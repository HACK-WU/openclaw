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
const CLI_AGENT_ALLOWED_FILES = new Set<string>(["IDENTITY.md", "AGENTS.md"]);

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
}
