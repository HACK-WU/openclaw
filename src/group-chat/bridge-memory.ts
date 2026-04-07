/**
 * Group Chat — Bridge Memory: Project-Level Memory Files
 *
 * Manages project-level memory files for CLI agents in group chat:
 * - Path resolution (project memory mode / temp memory mode)
 * - Group name sanitization for safe directory names
 * - Template definitions and file initialization
 * - Memory management prompt construction
 * - Injection frequency control (content + prompt independent intervals)
 * - Agent memory file scanning
 * - Merge cooldown mechanism
 * - Memory status queries (for frontend panel)
 * - Group dissolution cleanup
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getLogger } from "../logging.js";

const log = getLogger("group-chat:bridge-memory");

// ─── Constants ───

export const DEFAULT_MEMORY_MAX_SIZE_KB = 50;
export const DEFAULT_MEMORY_CONTENT_INTERVAL = 6;
export const DEFAULT_MEMORY_PROMPT_INTERVAL = 5;
const DEFAULT_MERGE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const MERGE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes timeout protection
const MAX_GROUP_DIR_NAME_LENGTH = 64;

// ─── Templates ───

const MEMORY_TEMPLATE = `# Project Memory

## 架构决策

## 代码结构

## 编码约定

## 踩坑记录

## 项目知识

## 其他
`;

const PROJECT_MEMORY_TEMPLATE = `# Project Memory（跨群聊）

## 架构决策

## 代码结构

## 编码约定

## 踩坑记录

## 项目知识

## 其他
`;

const SESSION_TEMPLATE = `# Session Notes

## 当前任务

## 进展

## 待确认

## 未完成

## 其他
`;

function agentMemoryTemplate(agentId: string): string {
  return `# ${agentId} Memory

## Permanent

## Session
`;
}

// ─── Group Name Sanitization ───

/**
 * Sanitize a group name into a safe directory name.
 * - Replace illegal/dangerous chars (/ \ .. : * ? " < > |) with _
 * - Truncate to MAX_GROUP_DIR_NAME_LENGTH, appending short hash if needed
 * - Fallback to `group-{shortHash}` for empty or all-illegal names
 */
export function sanitizeGroupDirName(groupName: string, groupId: string): string {
  const cleaned = groupName
    .replace(/[/\\:*?"<>|]+/g, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/^\.+|\.+$/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .trim();

  if (!cleaned) {
    const shortHash = createHash("sha256").update(groupId).digest("hex").slice(0, 7);
    return `group-${shortHash}`;
  }

  if (cleaned.length <= MAX_GROUP_DIR_NAME_LENGTH) {
    return cleaned;
  }

  const shortHash = createHash("sha256").update(groupName).digest("hex").slice(0, 7);
  return `${cleaned.slice(0, MAX_GROUP_DIR_NAME_LENGTH - 8)}-${shortHash}`;
}

// ─── Path Resolution ───

export type ProjectMemoryPaths = {
  dir: string;
  projectLevelMemoryFile: string;
  sharedMemoryFile: string;
  sharedSessionFile: string;
  agentMemoryFile: string;
};

export type TempMemoryPaths = {
  dir: string;
  agentMemoryFile: string;
};

export function resolveProjectMemoryPaths(
  projectDir: string,
  groupName: string,
  agentId: string,
): ProjectMemoryPaths {
  const baseDir = path.join(projectDir, ".openclaw");
  const dir = path.join(baseDir, groupName);
  return {
    dir,
    projectLevelMemoryFile: path.join(baseDir, "MEMORY.md"),
    sharedMemoryFile: path.join(dir, "MEMORY.md"),
    sharedSessionFile: path.join(dir, "SESSION.md"),
    agentMemoryFile: path.join(dir, `${agentId}.md`),
  };
}

export function resolveTempMemoryPaths(
  stateDir: string,
  groupId: string,
  agentId: string,
): TempMemoryPaths {
  const dir = path.join(stateDir, "group-memory", groupId);
  return {
    dir,
    agentMemoryFile: path.join(dir, `${agentId}.md`),
  };
}

// ─── File Initialization ───

async function writeIfNotExists(filePath: string, content: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, content, "utf-8");
  }
}

export async function ensureProjectMemoryFiles(
  projectDir: string,
  groupName: string,
  agentId: string,
): Promise<void> {
  const { dir, projectLevelMemoryFile, sharedMemoryFile, sharedSessionFile, agentMemoryFile } =
    resolveProjectMemoryPaths(projectDir, groupName, agentId);

  await fs.mkdir(dir, { recursive: true });
  await writeIfNotExists(projectLevelMemoryFile, PROJECT_MEMORY_TEMPLATE);

  // Inherit project-level memory if it has content
  const projectLevelContent = await readFileOrNull(projectLevelMemoryFile);
  if (projectLevelContent && !isEmptyTemplate(projectLevelContent)) {
    await writeIfNotExists(sharedMemoryFile, projectLevelContent);
  } else {
    await writeIfNotExists(sharedMemoryFile, MEMORY_TEMPLATE);
  }

  await writeIfNotExists(sharedSessionFile, SESSION_TEMPLATE);
  await writeIfNotExists(agentMemoryFile, agentMemoryTemplate(agentId));
}

export async function ensureTempMemoryFiles(
  stateDir: string,
  groupId: string,
  agentId: string,
): Promise<void> {
  const { dir, agentMemoryFile } = resolveTempMemoryPaths(stateDir, groupId, agentId);
  await fs.mkdir(dir, { recursive: true });
  await writeIfNotExists(agentMemoryFile, agentMemoryTemplate(agentId));
}

// ─── Template Detection ───

/**
 * Check whether file content is just an empty template (no user-written content).
 * Strips headings, section markers, and whitespace; returns true if nothing remains.
 */
export function isEmptyTemplate(content: string): boolean {
  const stripped = content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("#") && trimmed !== "---";
    })
    .join("")
    .trim();
  return stripped.length === 0;
}

// ─── File Helpers ───

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

// ─── Agent Memory File Scanning ───

export async function scanAgentMemoryFiles(memoryDir: string): Promise<string[]> {
  try {
    const files = await fs.readdir(memoryDir);
    return files
      .filter((f) => f.endsWith(".md") && f !== "MEMORY.md" && f !== "SESSION.md")
      .map((f) => path.join(memoryDir, f));
  } catch {
    return [];
  }
}

// ─── Injection Frequency ───

/**
 * Determine whether memory content should be injected this interaction.
 * Content is injected on first interaction and every `contentInterval` interactions after.
 */
export function shouldInjectMemoryContent(
  isFirstInteraction: boolean,
  interactionCount: number,
  contentInterval: number = DEFAULT_MEMORY_CONTENT_INTERVAL,
): boolean {
  if (isFirstInteraction) {
    return true;
  }
  return interactionCount > 0 && interactionCount % contentInterval === 0;
}

/**
 * Determine whether memory management prompt should be injected this interaction.
 * Prompt is injected on first interaction and every `promptInterval` interactions after.
 */
export function shouldInjectMemoryPrompt(
  isFirstInteraction: boolean,
  interactionCount: number,
  promptInterval: number = DEFAULT_MEMORY_PROMPT_INTERVAL,
): boolean {
  if (isFirstInteraction) {
    return true;
  }
  return interactionCount > 0 && interactionCount % promptInterval === 0;
}

// ─── Memory Context Building ───

/**
 * Build the memory path section (injected every interaction).
 */
export function buildMemoryPathSection(params: {
  sharedMemoryFile: string;
  sharedSessionFile: string;
  agentMemoryFile: string;
  agentId: string;
}): string[] {
  return [
    "# ================================================================================",
    "# 项目记忆路径",
    "# ================================================================================",
    "",
    `# MEMORY.md — 共享永久记忆（只读）`,
    `# 路径：${params.sharedMemoryFile}`,
    "",
    `# SESSION.md — 共享临时记忆（只读）`,
    `# 路径：${params.sharedSessionFile}`,
    "",
    `# ${params.agentId}.md — 你的专属记忆（读写）`,
    `# 路径：${params.agentMemoryFile}`,
    "",
    "# ================================================================================",
  ];
}

/**
 * Build the temp memory path section (injected every interaction, temp mode).
 */
export function buildTempMemoryPathSection(agentMemoryFile: string, agentId: string): string[] {
  return [`# ${agentId}.md — 你的专属记忆（读写），路径：${agentMemoryFile}`];
}

/**
 * Build the memory content section (injected at content interval).
 */
export async function buildMemoryContentSection(params: {
  sharedMemoryFile: string;
  sharedSessionFile: string;
  agentMemoryFile: string;
}): Promise<string[]> {
  const sections: string[] = [];

  const memoryContent = await readFileOrNull(params.sharedMemoryFile);
  if (memoryContent) {
    sections.push(
      "# ================================================================================",
      "# 共享永久记忆（最新快照）",
      "# ================================================================================",
      "",
      ...memoryContent.split("\n").map((line) => `# ${line}`),
      "",
    );
  }

  const sessionContent = await readFileOrNull(params.sharedSessionFile);
  if (sessionContent && !isEmptyTemplate(sessionContent)) {
    sections.push(
      "# ================================================================================",
      "# 共享临时记忆（最新快照）",
      "# ================================================================================",
      "",
      ...sessionContent.split("\n").map((line) => `# ${line}`),
      "",
    );
  }

  const agentContent = await readFileOrNull(params.agentMemoryFile);
  if (agentContent && !isEmptyTemplate(agentContent)) {
    sections.push(
      "# ================================================================================",
      "# 你的专属记忆（最新快照）",
      "# ================================================================================",
      "",
      ...agentContent.split("\n").map((line) => `# ${line}`),
      "",
    );
  }

  return sections;
}

/**
 * Build the temp memory content section (injected at content interval, temp mode).
 */
export async function buildTempMemoryContentSection(agentMemoryFile: string): Promise<string[]> {
  const agentContent = await readFileOrNull(agentMemoryFile);
  if (!agentContent || isEmptyTemplate(agentContent)) {
    return [];
  }

  return [
    "# ─── 你的专属记忆（最新快照） ───",
    "",
    ...agentContent.split("\n").map((line) => `# ${line}`),
    "",
  ];
}

// ─── Memory Management Prompts ───

export function buildMemoryManagementPrompt(
  sharedMemoryFile: string,
  sharedSessionFile: string,
  agentMemoryFile: string,
  agentId: string,
): string[] {
  return [
    "# ================================================================================",
    "# 项目记忆系统",
    "# ================================================================================",
    "",
    "# 你在群聊中有一个专属记忆文件，用于存储你认为需要记住的关键信息。",
    "# 此外还有两个共享记忆文件，由助理 Agent 维护，所有 Agent 共享。",
    "",
    "# 文件路径：",
    `# - 你的专属记忆：${agentMemoryFile}`,
    `# - 共享永久记忆：${sharedMemoryFile}（只读，不要修改）`,
    `# - 共享临时记忆：${sharedSessionFile}（只读，不要修改）`,
    "",
    "# ─── 写入规则 ───",
    "#",
    `# 1. 你只能写入自己的专属记忆文件 ${agentId}.md，不能修改 MEMORY.md 和 SESSION.md`,
    "#",
    "# 2. 以下情况应该记录到 Permanent 部分（与项目相关的长期知识）：",
    '#    ✅ 发现了项目的 bug 或奇怪行为（如 "Prisma SQLite 下不支持 enum"）',
    '#    ✅ 技术选型变化或架构决策（如 "从 REST 迁移到 GraphQL"）',
    '#    ✅ 某个方案被否决及其原因（如 "Redis 缓存方案因成本放弃，改用本地缓存"）',
    "#    ✅ 发现了未文档化的 API 行为或环境特性",
    "#    ✅ 编码约定或团队规范的变更",
    "#",
    "# 3. 以下情况应该记录到 Session 部分（当前工作进展）：",
    "#    ✅ 当前正在实现的功能及进度",
    "#    ✅ 遇到的阻塞问题和待确认事项",
    "#    ✅ 与其他 Agent 的协作约定",
    "#",
    "# 4. 以下情况不应该记录：",
    "#    ❌ 执行了常规命令（如 npm install、git pull）",
    "#    ❌ 读取了某个文件的内容",
    "#    ❌ 中间调试步骤和临时尝试",
    '#    ❌ 显而易见的项目信息（如 "项目使用 TypeScript"——README 已说明）',
    "#",
    "# 5. 写入前先读取文件现有内容，避免重复",
    "# 6. 内容必须简短，每条记忆用一两句话概括关键信息",
    "# 7. 使用简洁的 Markdown 格式，保持文件结构清晰",
    "",
    "# ─── 代码知识记忆（开发项目重点） ───",
    "#",
    "# 如果你正在参与的是一个开发项目（有源代码目录），请特别注意记录以下代码相关知识。",
    "# 这些记忆能帮助你（和其他 Agent）避免反复搜索代码库，显著提升工作效率：",
    "#",
    "# ✅ **关键代码路径**：核心模块/文件的位置和职责",
    '#    例："认证逻辑在 src/auth/jwt.ts，中间件在 src/middleware/auth.ts"',
    '#    例："API 路由统一注册在 src/routes/index.ts，按 v1/v2 分目录"',
    "#",
    "# ✅ **核心架构**：项目的整体架构模式和分层",
    '#    例："三层架构：Controller(src/controllers) → Service(src/services) → Repository(src/repos)"',
    '#    例："微服务通过 gRPC 通信，proto 定义在 proto/ 目录"',
    "#",
    "# ✅ **关键模块作用**：重要模块/类/函数的简要说明",
    '#    例："TaskScheduler(src/scheduler.ts) 负责定时任务，基于 node-cron"',
    '#    例："src/utils/retry.ts 提供统一的重试逻辑，指数退避，最多 3 次"',
    "#",
    "# ✅ **数据流和依赖关系**：模块间的调用关系和数据流向",
    '#    例："请求流程：nginx → Express(8080) → AuthMiddleware → Router → Controller"',
    '#    例："消息队列：Producer(src/mq/publish.ts) → RabbitMQ → Consumer(src/mq/consume.ts)"',
    "#",
    "# ⚠️ 不要记录代码的具体实现细节（如函数体内容），只记路径和职责概要",
    "# ⚠️ 保持精简，每条不超过一两句话",
    "",
    "# ─── 去重规则 ───",
    "#",
    "# 不要为了去重而刻意去读取共享记忆文件。只有在你正常工作过程中恰好读到了",
    "# MEMORY.md 或 SESSION.md 的内容时，如果发现自己专属记忆中的某条内容已经",
    "# 被共享记忆完整包含（且共享记忆中的表述不比你的更粗略），才从自己的文件中",
    "# 删除该条目。",
    "#",
    "# 如果你的专属记忆比共享记忆更详细（例如你记录了具体的环境变量名，而共享记",
    '# 忆只说了"通过环境变量注入"），请保留你的详细版本，不要删除。',
    "",
    "# ─── 文件格式 ───",
    "#",
    `# # ${agentId} Memory`,
    "#",
    "# ## Permanent",
    "#",
    "# - （与项目相关的永久记忆）",
    "#",
    "# ## Session",
    "#",
    "# - （当前会话的临时记忆）",
    "",
    "# ================================================================================",
  ];
}

export function buildTempMemoryManagementPrompt(
  agentMemoryFile: string,
  agentId: string,
): string[] {
  return [
    "# ================================================================================",
    "# 记忆系统（临时模式）",
    "# ================================================================================",
    "",
    "# 你在群聊中有一个专属记忆文件，用于存储你认为需要记住的关键信息。",
    "# 当前群聊未关联项目，没有共享记忆文件。",
    "",
    "# 文件路径：",
    `# - 你的专属记忆：${agentMemoryFile}`,
    "",
    "# ─── 写入规则 ───",
    "#",
    "# 1. 以下情况应该记录到 Permanent 部分：",
    "#    ✅ 发现了重要的技术细节或 bug",
    "#    ✅ 重要的决策及其原因",
    "#    ✅ 发现的未文档化行为或环境特性",
    "#",
    "# 2. 以下情况应该记录到 Session 部分：",
    "#    ✅ 当前正在做的事情及进度",
    "#    ✅ 遇到的阻塞问题和待确认事项",
    "#",
    "# 3. 以下情况不应该记录：",
    "#    ❌ 常规操作（如运行命令、读文件）",
    "#    ❌ 中间调试步骤和临时尝试",
    "#",
    "# 4. 写入前先读取文件现有内容，避免重复",
    "# 5. 内容必须简短，每条记忆用一两句话概括",
    "",
    "# ─── 文件格式 ───",
    "#",
    `# # ${agentId} Memory`,
    "#",
    "# ## Permanent",
    "#",
    "# - （永久记忆）",
    "#",
    "# ## Session",
    "#",
    "# - （临时记忆）",
    "",
    "# ================================================================================",
  ];
}

// ─── Merge Cooldown Mechanism ───

export interface MemoryMergeState {
  lastMergeAt: number | null;
  lastMergeSource: "auto" | "manual-merge" | "manual-compact" | null;
  dirtyAfterMerge: boolean;
  merging: boolean;
  mergingStartedAt: number | null;
}

const mergeStates = new Map<string, MemoryMergeState>();

export function getMergeState(groupId: string): MemoryMergeState {
  if (!mergeStates.has(groupId)) {
    mergeStates.set(groupId, {
      lastMergeAt: null,
      lastMergeSource: null,
      dirtyAfterMerge: true,
      merging: false,
      mergingStartedAt: null,
    });
  }
  return mergeStates.get(groupId)!;
}

export function checkMergeCooldown(
  groupId: string,
  source: "auto" | "manual-merge" | "manual-compact",
  cooldownMs: number = DEFAULT_MERGE_COOLDOWN_MS,
): {
  allowed: boolean;
  reason?: "merging" | "cooldown" | "no-dirty";
  cooldownRemainMs?: number;
} {
  const state = getMergeState(groupId);

  // Timeout protection: release lock if merge has been running > 3 minutes
  if (state.merging && state.mergingStartedAt) {
    if (Date.now() - state.mergingStartedAt > MERGE_TIMEOUT_MS) {
      log.warn(`merge timeout for group ${groupId}, releasing lock`);
      state.merging = false;
      state.mergingStartedAt = null;
    }
  }

  if (state.merging) {
    return { allowed: false, reason: "merging" };
  }

  if (state.lastMergeAt) {
    const elapsed = Date.now() - state.lastMergeAt;
    if (elapsed < cooldownMs) {
      return {
        allowed: false,
        reason: "cooldown",
        cooldownRemainMs: cooldownMs - elapsed,
      };
    }
  }

  if (source === "auto" && !state.dirtyAfterMerge) {
    return { allowed: false, reason: "no-dirty" };
  }

  return { allowed: true };
}

export function markMergeStart(groupId: string): void {
  const state = getMergeState(groupId);
  state.merging = true;
  state.mergingStartedAt = Date.now();
}

export function markMergeComplete(
  groupId: string,
  source: "auto" | "manual-merge" | "manual-compact",
): void {
  const state = getMergeState(groupId);
  state.merging = false;
  state.mergingStartedAt = null;
  state.lastMergeAt = Date.now();
  state.lastMergeSource = source;
  state.dirtyAfterMerge = false;
}

export function markMemoryDirty(groupId: string): void {
  const state = getMergeState(groupId);
  state.dirtyAfterMerge = true;
}

/** Clear merge state for a group (used on group deletion). */
export function clearMergeState(groupId: string): void {
  mergeStates.delete(groupId);
}

// ─── Memory Status (for frontend panel) ───

export type MemoryFileInfo = {
  name: string;
  exists: boolean;
  size: number;
};

export type MemoryStatus = {
  files: MemoryFileInfo[];
  totalSize: number;
  maxSize: number;
  maxSizeKB: number;
  warning: "ok" | "approaching-limit" | "over-limit";
};

async function getFileInfo(filePath: string): Promise<{ exists: boolean; size: number }> {
  try {
    const stat = await fs.stat(filePath);
    return { exists: true, size: stat.size };
  } catch {
    return { exists: false, size: 0 };
  }
}

export async function getMemoryStatus(params: {
  projectDir: string | undefined;
  stateDir: string;
  groupId: string;
  groupName: string;
  agentIds: string[];
  maxSizeKB?: number;
}): Promise<MemoryStatus> {
  const maxSizeKB = params.maxSizeKB ?? DEFAULT_MEMORY_MAX_SIZE_KB;
  const files: MemoryFileInfo[] = [];
  let totalSize = 0;

  if (params.projectDir) {
    const baseDir = path.join(params.projectDir, ".openclaw", params.groupName);

    for (const name of ["MEMORY.md", "SESSION.md"]) {
      const filePath = path.join(baseDir, name);
      const info = await getFileInfo(filePath);
      files.push({ name, ...info });
      totalSize += info.size;
    }

    for (const agentId of params.agentIds) {
      const filePath = path.join(baseDir, `${agentId}.md`);
      const info = await getFileInfo(filePath);
      files.push({ name: `${agentId}.md`, ...info });
      totalSize += info.size;
    }
  } else {
    const baseDir = path.join(params.stateDir, "group-memory", params.groupId);
    for (const agentId of params.agentIds) {
      const filePath = path.join(baseDir, `${agentId}.md`);
      const info = await getFileInfo(filePath);
      files.push({ name: `${agentId}.md`, ...info });
      totalSize += info.size;
    }
  }

  const maxBytes = maxSizeKB * 1024;
  const warningThresholdBytes = maxBytes * 0.8;

  return {
    files,
    totalSize,
    maxSize: maxBytes,
    maxSizeKB,
    warning:
      totalSize > maxBytes
        ? "over-limit"
        : totalSize > warningThresholdBytes
          ? "approaching-limit"
          : "ok",
  };
}

// ─── Dissolution Checks & Cleanup ───

export async function checkMemoryBeforeDissolve(
  projectDir: string | undefined,
  groupName: string,
): Promise<{ hasMemory: boolean; memorySize: number }> {
  if (!projectDir) {
    return { hasMemory: false, memorySize: 0 };
  }

  const memoryFile = path.join(projectDir, ".openclaw", groupName, "MEMORY.md");
  try {
    const content = await fs.readFile(memoryFile, "utf-8");
    const isEmpty = isEmptyTemplate(content);
    const size = Buffer.byteLength(content, "utf-8");
    return { hasMemory: !isEmpty, memorySize: size };
  } catch {
    return { hasMemory: false, memorySize: 0 };
  }
}

export async function cleanupGroupMemory(params: {
  projectDir: string | undefined;
  stateDir: string;
  groupId: string;
  groupName: string;
}): Promise<void> {
  if (params.projectDir) {
    const groupMemoryDir = path.join(params.projectDir, ".openclaw", params.groupName);
    await fs.rm(groupMemoryDir, { recursive: true, force: true });
  } else {
    const tempDir = path.join(params.stateDir, "group-memory", params.groupId);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
  clearMergeState(params.groupId);
}

// ─── Test Helpers ───

/** @internal for tests */
export const _test = {
  mergeStates,
  MEMORY_TEMPLATE,
  SESSION_TEMPLATE,
  PROJECT_MEMORY_TEMPLATE,
  agentMemoryTemplate,
  writeIfNotExists,
  readFileOrNull,
};
