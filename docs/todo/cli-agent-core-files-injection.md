# CLI Agent 核心文件注入实现方案

> 本文档描述 CLI Agent 核心文件注入的后台实现方案。

## 1. 功能概述

### 1.1 目标

在 CLI Agent 交互时注入核心文件信息：

| 文件             | 作用                                      |
| ---------------- | ----------------------------------------- |
| `IDENTITY.md`    | 身份定义（名称、类型、风格、emoji、头像） |
| `PERSONALITY.md` | 性格定义（思维方式、沟通风格、决策倾向）  |
| `SOUL.md`        | 行为准则与核心价值观                      |
| `AGENTS.md`      | 项目规范与开发指南                        |
| `TOOLS.md`       | 环境特定配置与设备信息                    |

### 1.2 注入策略

| 交互类型         | 注入内容                                                                                             | 说明                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **首次启动**     | ① 读取并注入 `PERSONALITY.md`、`SOUL.md`、`AGENTS.md` **文件内容**<br>② 注入所有核心文件**路径说明** | 让 CLI 立即了解自己的性格、行为准则和项目规范，并知道所有核心文件的位置 |
| **后续每次对话** | 注入核心文件**路径说明**（不读取内容）                                                               | 提醒 CLI 这些文件的位置，需要时可自行读取                               |

### 1.3 注入位置

核心文件信息位于**系统上下文上方**，消息结构如下：

```
首次启动：
  核心文件内容（PERSONALITY.md、SOUL.md、AGENTS.md）
      ↓
  核心文件路径说明（所有5个文件）
      ↓
  系统上下文
      ↓
  用户请求

后续对话：
  核心文件路径说明（所有5个文件）
      ↓
  系统上下文
      ↓
  用户请求
```

---

## 2. 核心实现

### 2.1 CLI Agent 身份文件存储位置

**重要**：CLI Agent 的核心文件存储位置是**固定的**，与 CLI Agent 配置的工作目录 (`cwd`) 无关。

```
{stateDir}/cli-agents/{agentId}/
├── IDENTITY.md
├── PERSONALITY.md
├── SOUL.md
├── AGENTS.md
└── TOOLS.md
```

**`stateDir` 解析逻辑**（由 `resolveStateDir()` 函数提供）：

| 优先级 | 来源                          | 说明                   |
| ------ | ----------------------------- | ---------------------- |
| 1      | `OPENCLAW_STATE_DIR` 环境变量 | 显式指定的状态目录     |
| 2      | `CLAWDBOT_STATE_DIR` 环境变量 | 兼容旧版环境变量       |
| 3      | `~/.openclaw`                 | 默认状态目录           |
| 4      | `~/.clawdbot` 等              | 兼容旧版目录（如存在） |

> **注意**：开发模式下可能使用不同的状态目录路径，因此设计文档中使用 `{stateDir}` 而非固定路径。

### 2.2 目录解析函数

使用现有的 `resolveCliAgentIdentityDir()` 函数获取核心文件存储目录：

```typescript
// src/agents/cli-agent-scope.ts

/**
 * 解析 CLI Agent 身份文件存储目录
 * 返回: {stateDir}/cli-agents/{agentId}/
 */
export function resolveCliAgentIdentityDir(
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveCliAgentsRootDir(env), agentId);
}
```

### 2.3 实现代码

```typescript
// src/group-chat/bridge-context.ts

import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveCliAgentIdentityDir } from "../agents/cli-agent-scope.js";
import { getLogger } from "../logging.js";

const logger = getLogger("bridge-context");

/**
 * 需要在首次交互时读取内容的核心文件列表
 */
const FIRST_INTERACTION_CONTENT_FILES = ["PERSONALITY.md", "SOUL.md", "AGENTS.md"] as const;

/**
 * 所有核心文件列表
 */
const ALL_CORE_FILES = [
  "IDENTITY.md",
  "PERSONALITY.md",
  "SOUL.md",
  "AGENTS.md",
  "TOOLS.md",
] as const;

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
  } catch (error) {
    // 文件不存在或读取失败，返回 null
    logger.debug(`Core file not found or unreadable: ${filePath}`);
    return null;
  }
}

/**
 * 构建首次交互的核心文件内容区块
 *
 * 读取 PERSONALITY.md、SOUL.md、AGENTS.md 的内容并注入
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

  // 读取并注入 PERSONALITY.md、SOUL.md、AGENTS.md 的内容
  for (const fileName of FIRST_INTERACTION_CONTENT_FILES) {
    const content = await readCoreFileContent(identityDir, fileName);
    const fileTitle = getFileTitle(fileName);

    lines.push(`# ─── ${fileName} — ${fileTitle} ───`);
    lines.push(`# 路径：${identityDir}/${fileName}`);
    lines.push("");

    if (content) {
      // 将文件内容每行添加 # 前缀
      const contentLines = content.split("\n").map((line) => `# ${line}`);
      lines.push(...contentLines);
    } else {
      lines.push(`# [文件不存在或为空]`);
    }
    lines.push("");
  }

  lines.push("# ================================================================================");

  return lines.join("\n");
}

/**
 * 构建后续交互的核心文件路径区块
 *
 * 仅注入文件路径说明，不读取文件内容
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
    `# 路径：${identityDir}/IDENTITY.md`,
    "",
    "# PERSONALITY.md — 你的性格",
    `# 路径：${identityDir}/PERSONALITY.md`,
    "",
    "# SOUL.md — 你的灵魂",
    `# 路径：${identityDir}/SOUL.md`,
    "",
    "# ─── 项目与工具 ───",
    "",
    "# AGENTS.md — 项目指南",
    `# 路径：${identityDir}/AGENTS.md`,
    "",
    "# TOOLS.md — 工具与环境笔记",
    `# 路径：${identityDir}/TOOLS.md`,
    "",
    "# ================================================================================",
  ];

  return lines.join("\n");
}

/**
 * 获取文件的中文标题
 */
function getFileTitle(fileName: string): string {
  const titles: Record<string, string> = {
    "IDENTITY.md": "你是谁",
    "PERSONALITY.md": "你的性格",
    "SOUL.md": "你的灵魂",
    "AGENTS.md": "项目指南",
    "TOOLS.md": "工具与环境笔记",
  };
  return titles[fileName] ?? fileName;
}
```

### 2.4 集成到上下文构建流程

在 `buildCliContextMessage()` 函数中集成核心文件注入：

```typescript
// src/group-chat/bridge-trigger.ts

import { buildCoreFilesContentSection, buildCoreFilesPathSection } from "./bridge-context.js";

async function buildCliContextMessage(params: {
  meta: GroupSessionEntry;
  groupId: string;
  agentId: string;
  transcriptSnapshot: GroupChatMessage[];
  isFirstInteraction: boolean;
  bridgeConfig: BridgeConfig;
}): Promise<{ contextMessage: string; requestContent: string; roleReminderSent: boolean }> {
  const { meta, groupId, agentId, transcriptSnapshot, isFirstInteraction } = params;

  const sections: string[] = [];
  let roleReminderSent = false;

  // ─── 核心文件注入 ───
  if (isFirstInteraction) {
    // 首次交互：① 注入文件内容 ② 注入所有文件路径说明
    sections.push(await buildCoreFilesContentSection(agentId));
    sections.push(buildCoreFilesPathSection(agentId));
  } else {
    // 后续交互：仅注入路径说明
    sections.push(buildCoreFilesPathSection(agentId));
  }

  // ─── 系统上下文 ───
  if (isFirstInteraction) {
    sections.push(buildSystemContextSection(params));
    sections.push(buildHistorySection(transcriptSnapshot));
  } else {
    // 后续交互：增量上下文
    sections.push(buildIncrementalSection(params));
  }

  // ─── 用户请求 ───
  sections.push(buildRequestSection(params));

  return {
    contextMessage: sections.join("\n\n"),
    requestContent: extractRequestContent(params),
    roleReminderSent,
  };
}
```

---

## 3. 文件清单

### 3.1 需要修改的文件

| 文件                               | 修改内容                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `src/group-chat/bridge-context.ts` | 新增 `buildCoreFilesContentSection()` 和 `buildCoreFilesPathSection()` 函数 |
| `src/group-chat/bridge-trigger.ts` | 修改 `buildCliContextMessage()` 集成核心文件注入逻辑                        |

### 3.2 已有的依赖

| 文件                            | 用途                                |
| ------------------------------- | ----------------------------------- |
| `src/agents/cli-agent-scope.ts` | `resolveCliAgentIdentityDir()` 函数 |
| `src/config/paths.ts`           | `resolveStateDir()` 函数            |

---

## 4. 测试要点

### 4.1 单元测试

```typescript
// src/group-chat/bridge-context.test.ts

import { buildCoreFilesContentSection, buildCoreFilesPathSection } from "./bridge-context.js";
import { resolveCliAgentIdentityDir } from "../agents/cli-agent-scope.js";
import { promises as fs } from "node:fs";

vi.mock("../agents/cli-agent-scope.js", () => ({
  resolveCliAgentIdentityDir: vi.fn((agentId: string) => `/mock-state/cli-agents/${agentId}`),
}));

vi.mock("node:fs", () => ({
  promises: {
    readFile: vi.fn(),
  },
}));

describe("buildCoreFilesContentSection", () => {
  it("should read and include PERSONALITY.md, SOUL.md, AGENTS.md content", async () => {
    const mockFs = vi.mocked(fs.readFile);
    mockFs.mockImplementation(async (path: string) => {
      if (path.includes("PERSONALITY.md")) return "性格内容";
      if (path.includes("SOUL.md")) return "灵魂内容";
      if (path.includes("AGENTS.md")) return "项目指南内容";
      throw new Error("File not found");
    });

    const result = await buildCoreFilesContentSection("test-agent");

    expect(result).toContain("PERSONALITY.md");
    expect(result).toContain("SOUL.md");
    expect(result).toContain("AGENTS.md");
    expect(result).toContain("性格内容");
    expect(result).toContain("灵魂内容");
    expect(result).toContain("项目指南内容");
  });

  it("should handle missing files gracefully", async () => {
    const mockFs = vi.mocked(fs.readFile);
    mockFs.mockRejectedValue(new Error("File not found"));

    const result = await buildCoreFilesContentSection("test-agent");

    expect(result).toContain("[文件不存在或为空]");
  });

  it("should not include IDENTITY.md and TOOLS.md content", async () => {
    const result = await buildCoreFilesContentSection("test-agent");

    // IDENTITY.md 和 TOOLS.md 不在首次内容注入中
    expect(result).not.toContain("IDENTITY.md — 你是谁");
    expect(result).not.toContain("TOOLS.md — 工具与环境笔记");
  });
});

describe("buildCoreFilesPathSection", () => {
  it("should include all five core file paths", () => {
    const result = buildCoreFilesPathSection("test-agent");

    // 验证路径使用的是身份文件存储目录，而非工作目录
    expect(result).toContain("/mock-state/cli-agents/test-agent/IDENTITY.md");
    expect(result).toContain("/mock-state/cli-agents/test-agent/PERSONALITY.md");
    expect(result).toContain("/mock-state/cli-agents/test-agent/SOUL.md");
    expect(result).toContain("/mock-state/cli-agents/test-agent/AGENTS.md");
    expect(result).toContain("/mock-state/cli-agents/test-agent/TOOLS.md");
  });

  it("should not read file contents", () => {
    const mockFs = vi.mocked(fs.readFile);

    buildCoreFilesPathSection("test-agent");

    // 不应该调用文件读取
    expect(mockFs).not.toHaveBeenCalled();
  });
});
```

### 4.2 集成测试

- 验证首次交互时：① 注入 `PERSONALITY.md`、`SOUL.md`、`AGENTS.md` 的文件内容 ② 同时注入所有核心文件路径说明
- 验证后续交互时仅注入核心文件路径说明
- 验证路径使用 `resolveCliAgentIdentityDir()` 正确解析
- 验证文件不存在时的优雅降级

---

## 5. 关键区别

### 5.1 身份文件目录 vs 工作目录

| 概念                   | 路径                               | 用途                                 |
| ---------------------- | ---------------------------------- | ------------------------------------ |
| **身份文件存储目录**   | `{stateDir}/cli-agents/{agentId}/` | 存储 IDENTITY.md 等核心文件          |
| **CLI Agent 工作目录** | 用户配置的 `cwd` 或群聊项目目录    | CLI 进程启动的工作目录，用于执行任务 |

**重要**：这两个目录是**独立的**，身份文件始终存储在固定的状态目录下，不受 `cwd` 配置影响。

### 5.2 首次注入 vs 后续注入

| 维度         | 首次启动                                                                  | 后续对话                   |
| ------------ | ------------------------------------------------------------------------- | -------------------------- |
| **注入内容** | ① `PERSONALITY.md`、`SOUL.md`、`AGENTS.md` 内容<br>② 所有核心文件路径说明 | 所有核心文件路径说明       |
| **是否读取** | 是（异步读取三个文件内容）                                                | 否（仅构建路径字符串）     |
| **目的**     | 让 CLI 立即了解自己的性格、行为准则和项目规范，并知道所有核心文件的位置   | 提醒文件位置，供需要时读取 |

---

## 6. 关联文档

- [CLI Agent 上下文管理](../design/group-chat-bridge/cli-agent-context.md) — 完整设计文档
- [CLI Agent 管理](../design/group-chat-bridge/cli-agent-management.md) — CLI Agent 存储与配置
- [CLI Agent Core Files 扩展设计](../design/ui/group-chat/core-files-extension-design.md) — Core Files 页面设计
- [CLI Agent 性格系统设计](../design/ui/group-chat/cli-agent-personality-system.md) — PERSONALITY.md 详细设计
