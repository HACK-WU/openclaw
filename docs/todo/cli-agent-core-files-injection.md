# CLI Agent 核心文件注入实现方案

> 本文档描述 CLI Agent 首次交互时注入核心文件说明的后台实现方案。

## 1. 功能概述

### 1.1 目标

在 CLI Agent **首次交互**时，告知 CLI 以下核心文件路径及其作用：

| 文件          | 作用                                      |
| ------------- | ----------------------------------------- |
| `IDENTITY.md` | 身份定义（名称、类型、风格、emoji、头像） |
| `SOUL.md`     | 行为准则与核心价值观                      |
| `AGENTS.md`   | 项目规范与开发指南                        |
| `TOOLS.md`    | 环境特定配置与设备信息                    |

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

### 2.1 工作空间目录解析

文件路径使用 `${workspaceDir}` 动态变量，解析优先级：

| 优先级    | 来源           | 配置路径                        |
| --------- | -------------- | ------------------------------- |
| 1（最高） | 群聊项目目录   | `GroupConfig.project.directory` |
| 2（最低） | Agent 工作空间 | CLI Agent 管理页面配置          |

### 2.2 实现代码

```typescript
// src/group-chat/bridge-context.ts

/**
 * 解析 CLI Agent 的工作空间目录
 */
export function resolveWorkspaceDir(params: {
  groupConfig?: GroupConfig;
  bridgeConfig: BridgeConfig;
}): string {
  const { groupConfig, bridgeConfig } = params;

  // 优先级 1：群聊项目目录
  if (groupConfig?.project?.directory) {
    return groupConfig.project.directory;
  }

  // 优先级 2：Agent 工作空间配置
  if (bridgeConfig.cwd) {
    return bridgeConfig.cwd;
  }

  // 默认值：当前进程工作目录
  return process.cwd();
}

/**
 * 构建核心文件说明区块
 */
export function buildCoreFilesSection(workspaceDir: string): string {
  const lines = [
    "# ================================================================================",
    "# 核心文件说明（这些是你需要了解的关键文件）",
    "# ================================================================================",
    "",
    "# IDENTITY.md — 你是谁",
    `# 路径：${workspaceDir}/IDENTITY.md`,
    "# 作用：定义你的身份信息（名称、类型、风格、emoji、头像）",
    "",
    "# SOUL.md — 你的灵魂",
    `# 路径：${workspaceDir}/SOUL.md`,
    "# 作用：定义你的核心价值观和行为准则",
    "",
    "# AGENTS.md — 项目指南",
    `# 路径：${workspaceDir}/AGENTS.md`,
    "# 作用：项目级别的开发规范和指南",
    "",
    "# TOOLS.md — 工具与环境笔记",
    `# 路径：${workspaceDir}/TOOLS.md`,
    "# 作用：存储环境特定的配置和设备信息",
    "",
    "# ================================================================================",
  ];

  return lines.join("\n");
}
```

### 2.3 集成到上下文构建流程

在 `buildCliContextMessage()` 函数中集成核心文件说明：

```typescript
// src/group-chat/bridge-context.ts

export async function buildCliContextMessage(params: {
  meta: GroupSessionEntry;
  groupId: string;
  agentId: string;
  transcriptSnapshot: GroupChatMessage[];
  isFirstInteraction: boolean;
  bridgeConfig: BridgeConfig;
}): Promise<{ contextMessage: string; requestContent: string }> {
  const { meta, groupId, agentId, transcriptSnapshot, isFirstInteraction, bridgeConfig } = params;

  const sections: string[] = [];

  // ─── 首次交互：核心文件说明 ───
  if (isFirstInteraction) {
    const workspaceDir = resolveWorkspaceDir({
      groupConfig: meta.config,
      bridgeConfig,
    });
    sections.push(buildCoreFilesSection(workspaceDir));
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
  };
}
```

---

## 3. 文件清单

### 3.1 需要修改的文件

| 文件                               | 修改内容                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/group-chat/bridge-context.ts` | 新增 `resolveWorkspaceDir()`、`buildCoreFilesSection()`，修改 `buildCliContextMessage()` |
| `src/group-chat/bridge-types.ts`   | 确认 `BridgeConfig` 类型包含 `cwd` 字段                                                  |

### 3.2 类型定义

```typescript
// src/group-chat/bridge-types.ts

export type BridgeConfig = {
  /** CLI Agent 显示名称 */
  name?: string;
  /** CLI Agent emoji 图标 */
  emoji?: string;
  /** CLI 工具类型 */
  type: CliType;
  /** CLI 启动命令 */
  command: string;
  /** CLI 启动参数 */
  args?: string[];
  /** 工作目录（用于 ${workspaceDir} 解析） */
  cwd?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 单次回复超时（毫秒） */
  timeout?: number;
  /** 尾部修剪标记正则 */
  tailTrimMarker?: string;
};

export type GroupConfig = {
  id: string;
  name: string;
  announcement?: string;
  members: GroupMember[];
  project?: {
    /** 项目目录（用于 ${workspaceDir} 解析，优先级最高） */
    directory?: string;
    docs?: string[];
  };
  contextConfig?: {
    maxMessages?: number;
    maxCharacters?: number;
    includeSystemMessages?: boolean;
    roleReminderInterval?: number;
  };
};
```

---

## 4. 测试要点

### 4.1 单元测试

```typescript
// src/group-chat/bridge-context.test.ts

describe("resolveWorkspaceDir", () => {
  it("should prefer group project directory", () => {
    const result = resolveWorkspaceDir({
      groupConfig: { project: { directory: "/project/group" } } as any,
      bridgeConfig: { cwd: "/project/agent" } as any,
    });
    expect(result).toBe("/project/group");
  });

  it("should fallback to bridge config cwd", () => {
    const result = resolveWorkspaceDir({
      groupConfig: {} as any,
      bridgeConfig: { cwd: "/project/agent" } as any,
    });
    expect(result).toBe("/project/agent");
  });

  it("should fallback to process.cwd()", () => {
    const result = resolveWorkspaceDir({
      groupConfig: {} as any,
      bridgeConfig: {} as any,
    });
    expect(result).toBe(process.cwd());
  });
});

describe("buildCoreFilesSection", () => {
  it("should include workspace directory in paths", () => {
    const result = buildCoreFilesSection("/workspace/test");
    expect(result).toContain("/workspace/test/IDENTITY.md");
    expect(result).toContain("/workspace/test/SOUL.md");
    expect(result).toContain("/workspace/test/AGENTS.md");
    expect(result).toContain("/workspace/test/TOOLS.md");
  });
});
```

### 4.2 集成测试

- 验证首次交互时核心文件说明出现在系统上下文上方
- 验证后续交互不包含核心文件说明
- 验证路径动态替换正确

---

## 5. 关联文档

- [CLI Agent 上下文管理](../design/group-chat-bridge/cli-agent-context.md) — 完整设计文档
- [CLI Agent 管理](../design/group-chat-bridge/cli-agent-management.md) — CLI Agent 存储与配置
