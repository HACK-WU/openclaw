# CLI Agent 核心文件注入实现方案

> 本文档描述 CLI Agent 首次交互时注入核心文件说明的后台实现方案。

## 1. 功能概述

### 1.1 目标

在 CLI Agent **首次交互**时，告知 CLI 以下核心文件路径及其作用：

| 文件             | 作用                                      |
| ---------------- | ----------------------------------------- |
| `IDENTITY.md`    | 身份定义（名称、类型、风格、emoji、头像） |
| `PERSONALITY.md` | 性格定义（思维方式、沟通风格、决策倾向）  |
| `SOUL.md`        | 行为准则与核心价值观                      |
| `AGENTS.md`      | 项目规范与开发指南                        |
| `TOOLS.md`       | 环境特定配置与设备信息                    |

### 1.2 注入时机

- **首次交互**：CLI Agent 被首次 @mention 时注入完整的核心文件说明
- **后续交互**：不重复注入，避免冗余

### 1.3 注入位置

核心文件说明位于**系统上下文上方**，消息结构如下：

```
核心文件说明
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

使用现有的 `resolveCliAgentWorkspaceDir()` 函数获取核心文件存储目录：

```typescript
// src/agents/cli-agent-scope.ts

/**
 * 解析 CLI Agent 身份文件存储目录
 * 返回: {stateDir}/cli-agents/{agentId}/
 */
export function resolveCliAgentWorkspaceDir(
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveCliAgentsRootDir(env), agentId);
}
```

### 2.3 实现代码

```typescript
// src/group-chat/bridge-context.ts

import { resolveCliAgentWorkspaceDir } from "../agents/cli-agent-scope.js";

/**
 * 构建核心文件说明区块
 *
 * @param agentId - CLI Agent ID
 * @param env - 环境变量（用于解析状态目录）
 */
export function buildCoreFilesSection(
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  // 获取 CLI Agent 身份文件存储目录
  const workspaceDir = resolveCliAgentWorkspaceDir(agentId, env);

  const lines = [
    "# ================================================================================",
    "# 核心文件说明（这些是你需要了解的关键文件）",
    "# ================================================================================",
    "",
    "# ─── 身份与记忆 ───",
    "",
    "# IDENTITY.md — 你是谁",
    `# 路径：${workspaceDir}/IDENTITY.md`,
    "# 作用：定义你的身份信息（名称、类型、风格、emoji、头像）",
    "#       这是你的"身份证"，帮助你建立自我认知",
    "",
    "# PERSONALITY.md — 你的性格",
    `# 路径：${workspaceDir}/PERSONALITY.md`,
    "# 作用：定义你的性格特征（思维方式、沟通风格、决策倾向）",
    "#       让你拥有独特的工作风格和视角",
    "",
    "# SOUL.md — 你的灵魂",
    `# 路径：${workspaceDir}/SOUL.md`,
    "# 作用：定义你的核心价值观和行为准则",
    "#       这是你作为"真正的助手"而非"聊天机器人"的指南",
    "",
    "# ─── 项目与工具 ───",
    "",
    "# AGENTS.md — 项目指南",
    `# 路径：${workspaceDir}/AGENTS.md`,
    "# 作用：项目级别的开发规范和指南",
    "#       这是你理解项目工作方式的主要参考",
    "",
    "# TOOLS.md — 工具与环境笔记",
    `# 路径：${workspaceDir}/TOOLS.md`,
    "# 作用：存储环境特定的配置和设备信息",
    "#       这是你的"本地速查表"，帮助你适应特定环境",
    "",
    "# ─── 建议 ───",
    "",
    "# 首次进入新项目时，建议按以下顺序阅读：",
    "# 1. IDENTITY.md → 了解自己的身份",
    "# 2. PERSONALITY.md → 理解自己的性格特征",
    "# 3. SOUL.md → 掌握行为准则",
    "# 4. AGENTS.md → 掌握项目规范",
    "# 5. TOOLS.md → 熟悉环境配置",
    "",
    "# ================================================================================",
  ];

  return lines.join("\n");
}
```

### 2.4 集成到上下文构建流程

在 `buildCliContextMessage()` 函数中集成核心文件说明：

```typescript
// src/group-chat/bridge-trigger.ts

import { buildCoreFilesSection } from "./bridge-context.js";

function buildCliContextMessage(params: {
  meta: GroupSessionEntry;
  groupId: string;
  agentId: string;
  transcriptSnapshot: GroupChatMessage[];
  isFirstInteraction: boolean;
  bridgeConfig: BridgeConfig;
}): { contextMessage: string; requestContent: string; roleReminderSent: boolean } {
  const { meta, groupId, agentId, transcriptSnapshot, isFirstInteraction } = params;

  const sections: string[] = [];
  let roleReminderSent = false;

  // ─── 首次交互：核心文件说明 ───
  if (isFirstInteraction) {
    sections.push(buildCoreFilesSection(agentId));
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

| 文件                               | 修改内容                                         |
| ---------------------------------- | ------------------------------------------------ |
| `src/group-chat/bridge-context.ts` | 新增 `buildCoreFilesSection()` 函数              |
| `src/group-chat/bridge-trigger.ts` | 修改 `buildCliContextMessage()` 集成核心文件说明 |

### 3.2 已有的依赖

| 文件                            | 用途                                 |
| ------------------------------- | ------------------------------------ |
| `src/agents/cli-agent-scope.ts` | `resolveCliAgentWorkspaceDir()` 函数 |
| `src/config/paths.ts`           | `resolveStateDir()` 函数             |

---

## 4. 测试要点

### 4.1 单元测试

```typescript
// src/group-chat/bridge-context.test.ts

import { buildCoreFilesSection } from "./bridge-context.js";
import { resolveCliAgentWorkspaceDir } from "../agents/cli-agent-scope.js";

vi.mock("../agents/cli-agent-scope.js", () => ({
  resolveCliAgentWorkspaceDir: vi.fn((agentId: string) => `/mock-state/cli-agents/${agentId}`),
}));

describe("buildCoreFilesSection", () => {
  it("should include agent workspace directory in paths", () => {
    const result = buildCoreFilesSection("test-agent");
    expect(result).toContain("/mock-state/cli-agents/test-agent/IDENTITY.md");
    expect(result).toContain("/mock-state/cli-agents/test-agent/PERSONALITY.md");
    expect(result).toContain("/mock-state/cli-agents/test-agent/SOUL.md");
    expect(result).toContain("/mock-state/cli-agents/test-agent/AGENTS.md");
    expect(result).toContain("/mock-state/cli-agents/test-agent/TOOLS.md");
  });

  it("should include all five core files", () => {
    const result = buildCoreFilesSection("test-agent");
    expect(result).toContain("IDENTITY.md");
    expect(result).toContain("PERSONALITY.md");
    expect(result).toContain("SOUL.md");
    expect(result).toContain("AGENTS.md");
    expect(result).toContain("TOOLS.md");
  });

  it("should include file descriptions", () => {
    const result = buildCoreFilesSection("test-agent");
    expect(result).toContain("你是谁");
    expect(result).toContain("你的性格");
    expect(result).toContain("你的灵魂");
    expect(result).toContain("项目指南");
    expect(result).toContain("工具与环境笔记");
  });
});
```

### 4.2 集成测试

- 验证首次交互时核心文件说明出现在系统上下文上方
- 验证后续交互不包含核心文件说明
- 验证路径使用 `resolveCliAgentWorkspaceDir()` 正确解析

---

## 5. 关键区别：身份文件目录 vs 工作目录

| 概念                   | 路径                               | 用途                                 |
| ---------------------- | ---------------------------------- | ------------------------------------ |
| **身份文件存储目录**   | `{stateDir}/cli-agents/{agentId}/` | 存储 IDENTITY.md 等核心文件          |
| **CLI Agent 工作目录** | 用户配置的 `cwd` 或群聊项目目录    | CLI 进程启动的工作目录，用于执行任务 |

**重要**：这两个目录是**独立的**，身份文件始终存储在固定的状态目录下，不受 `cwd` 配置影响。

---

## 6. 关联文档

- [CLI Agent 上下文管理](../design/group-chat-bridge/cli-agent-context.md) — 完整设计文档
- [CLI Agent 管理](../design/group-chat-bridge/cli-agent-management.md) — CLI Agent 存储与配置
- [CLI Agent Core Files 扩展设计](../design/ui/group-chat/core-files-extension-design.md) — Core Files 页面设计
- [CLI Agent 性格系统设计](../design/ui/group-chat/cli-agent-personality-system.md) — PERSONALITY.md 详细设计
