# CLI Agent 独立管理设计

> 本文档定义 CLI Agent 与通用 Agent 的隔离方案，涵盖独立存储、独立工作空间、独立 UI 面板、测试启动、群聊触发行为等。

## 0. 背景与问题

### 0.1 当前现状

CLI Agent 的创建流程复用了通用 Agent 的 `agents.create` API，导致 CLI Agent 被写入 `openclaw.json` 的 `agents.list` 中，与通用 Agent 混在一起：

```
当前创建流程（有问题）：
  前端 createCliAgent()
    → agents.create → 写入 openclaw.json agents.list ❌
    → agents.files.set("bridge.json") → 写入通用 agent workspace ❌
    → agents.files.set("IDENTITY.md") → 标记 Theme: CLI Agent ❌
```

**问题列表**：

| #   | 问题         | 表现                                                                                                                             |
| --- | ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 配置混杂     | CLI Agent 被写入 `openclaw.json` 的 agents.list，和通用 Agent 混在一起                                                           |
| 2   | UI 不区分    | CLI Agent 的 Overview 展示模型选择、Skill Filter 等通用 Agent 配置，毫无意义                                                     |
| 3   | Tab 完全一致 | CLI Agent 显示 Overview / Files / Tools / Skills / Channels / Cron Jobs 六个 Tab，CLI Agent 不需要 Skills / Channels / Cron Jobs |
| 4   | 群聊行为错误 | @CLI Agent 时走 LLM 推理，而非启动 CLI 进程 + 上下文注入 + PTY 交互                                                              |
| 5   | 无独立目录   | CLI Agent 复用通用 Agent 的 workspace 目录，默认文件（AGENTS.md, SOUL.md 等）对 CLI Agent 无意义                                 |
| 6   | 无测试能力   | 无法在创建或管理页面测试 CLI 能否正常启动                                                                                        |
| 7   | 名称/ID 混乱 | 创建通用 Agent 时不支持手动指定 AgentID；Agent 名称和 AgentID 的职责边界不清晰；包含中文的名称无法作为合法 AgentID               |

### 0.2 设计目标

**CLI Agent 是完全不同于通用 Agent 的实体类型**，需要在存储层、目录结构、UI 层、交互层全面独立。同时，需要统一规范 Agent 名称与 AgentID 的职责边界（适用于通用 Agent 和 CLI Agent）。

---

## 1. 独立存储

### 1.1 不复用 `agents.list` 和 `openclaw.json`

CLI Agent **不写入** `openclaw.json`。通用 Agent 的配置项（`model`、`skills`、`runtime`、`sandbox` 等）对 CLI Agent 无意义。

### 1.2 独立配置文件：`cli-agents/bridge.json`

所有 CLI Agent 的元信息统一存储在 `~/.openclaw-dev/cli-agents/bridge.json` 中。这是一个**全局注册表**，读取所有 CLI Agent 只需读取这一个文件，无需遍历各子目录：

```jsonc
// ~/.openclaw-dev/cli-agents/bridge.json
{
  "agents": [
    {
      "id": "codebuddy",
      "name": "CodeBuddy",
      "emoji": "🛠️",
      "type": "codebuddy",
      "command": "codebuddy",
      "args": [],
      "cwd": "/home/user/project",
      "env": {},
      "timeout": 300000,
    },
    {
      "id": "claude_code",
      "name": "Claude Code",
      "emoji": "🤖",
      "type": "claude-code",
      "command": "claude",
      "args": [],
      "cwd": "/home/user/project",
      "env": {},
      "timeout": 300000,
    },
  ],
}
```

**设计要点**：

- **单文件集中管理**：所有 CLI Agent 的注册信息（id、name、emoji、command、args、env、timeout 等）都在一个文件中，避免分散到各子目录导致读取困难
- **与 `openclaw.json` 完全隔离**：CLI Agent 信息不污染通用 Agent 的配置文件
- **CLI 配置即元信息**：每个 agent 条目直接包含 CLI 启动参数（command、args、cwd、env、timeout），无需再去子目录读取

### 1.3 TypeScript 类型定义

```typescript
// src/config/types.cli-agents.ts（新文件）

export type CliAgentEntry = {
  /** 系统内部标识符，仅限 [a-zA-Z0-9_]，用于目录名、数据传输、API 参数等 */
  id: string;
  /** 用户可见的显示名称，允许中文/空格等任意字符，用于 UI 展示、@mention 显示 */
  name: string;
  /** Agent 图标 */
  emoji?: string;
  /** CLI 类型预设（codebuddy / claude-code / opencode / custom） */
  type: string;
  /** CLI 启动命令 */
  command: string;
  /** CLI 启动参数 */
  args?: string[];
  /** CLI 工作目录 */
  cwd?: string;
  /** CLI 环境变量 */
  env?: Record<string, string>;
  /** 单次回复超时（毫秒） */
  timeout?: number;
};

export type CliBridgeConfig = {
  agents: CliAgentEntry[];
};
```

> 注意：`openclaw.json` 主配置类型**不需要**扩展。CLI Agent 完全独立于通用配置。

### 1.4 CLI Agent 配置 CRUD

新建 `src/commands/cli-agents.config.ts`，提供 CLI Agent 专用的 CRUD 函数。所有操作都是对 `cli-agents/bridge.json` 的读写：

```typescript
// src/commands/cli-agents.config.ts（新文件）

/** 读取 bridge.json，返回所有 CLI Agent 列表 */
export function loadCliBridgeConfig(rootDir: string): CliBridgeConfig;

/** 保存 bridge.json */
export function saveCliBridgeConfig(rootDir: string, config: CliBridgeConfig): void;

/** 列出所有 CLI Agent */
export function listCliAgentEntries(rootDir: string): CliAgentEntry[];

/** 查找单个 CLI Agent */
export function findCliAgentEntry(rootDir: string, agentId: string): CliAgentEntry | undefined;

/** 添加或更新 CLI Agent（upsert） */
export function upsertCliAgentEntry(rootDir: string, entry: CliAgentEntry): void;

/** 删除 CLI Agent（从 bridge.json 移除 + 删除工作空间目录） */
export function removeCliAgentEntry(rootDir: string, agentId: string): void;
```

---

## 2. 独立工作空间目录

### 2.1 目录结构

```
~/.openclaw-dev/cli-agents/
├── bridge.json                   ← 全局注册表（所有 CLI Agent 的元信息）
│
├── codebuddy/                    ← CLI Agent "codebuddy" 的工作空间
│   ├── IDENTITY.md               ← 身份信息
│   └── AGENTS.md                 ← Agent 描述/行为指引
│
├── claude_code/                  ← CLI Agent "claude_code" 的工作空间
│   ├── IDENTITY.md
│   └── AGENTS.md
│
└── opencode/                     ← CLI Agent "opencode" 的工作空间
    ├── IDENTITY.md
    └── AGENTS.md
```

**设计要点**：

- `bridge.json` 放在 `cli-agents/` 根目录下，作为**全局注册表**记录所有 CLI Agent 的元信息（id、name、command、args、env、timeout 等）
- **读取所有 CLI Agent 信息只需读取一个文件**，无需遍历各子目录
- 各 CLI Agent 的子目录（`cli-agents/{agentId}/`）仅存放该 Agent 的**个性化文件**（IDENTITY.md、AGENTS.md 等）
- **目录名 = agentId**，即 `cli-agents/{agentId}/` 就是该 CLI Agent 的工作空间

### 2.2 基础目录解析

```typescript
// src/agents/cli-agent-scope.ts（新文件）

import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

/**
 * 解析 CLI Agent 的根目录。
 * 默认值：~/.openclaw-dev/cli-agents/
 */
export function resolveCliAgentsRootDir(env: NodeJS.ProcessEnv = process.env): string {
  const stateDir = resolveStateDir(env);
  return path.join(stateDir, "cli-agents");
}

/**
 * 解析 bridge.json 的完整路径。
 * 即 ~/.openclaw-dev/cli-agents/bridge.json
 */
export function resolveCliBridgeConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveCliAgentsRootDir(env), "bridge.json");
}

/**
 * 解析单个 CLI Agent 的工作空间目录。
 * 即 ~/.openclaw-dev/cli-agents/{agentId}/
 */
export function resolveCliAgentWorkspaceDir(
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveCliAgentsRootDir(env), agentId);
}
```

### 2.3 默认文件内容

创建 CLI Agent 时，自动在其工作空间子目录中生成以下文件（CLI 配置信息已统一写入根目录 `bridge.json`）：

#### `IDENTITY.md` — 身份信息

```markdown
- Name: CodeBuddy
- Emoji: 🛠️
- Type: CLI Agent
- CLI: codebuddy
```

#### `AGENTS.md` — Agent 描述

```markdown
# CLI Agent: CodeBuddy

此 Agent 通过 CLI 工具执行任务，拥有完整的文件读写和命令执行能力。

## 行为指引

- 收到群聊消息时，理解上下文后执行相应工作
- 完成后在回复中使用 @mention 通知相关成员
- 遵循群公告中的技术栈和代码规范
- 不在输出中打印敏感信息（API Key、密码等）
```

### 2.4 与通用 Agent workspace 的对比

| 维度         | 通用 Agent workspace                                                           | CLI Agent workspace                                 |
| ------------ | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| 元信息存储   | `openclaw.json` agents.list                                                    | `cli-agents/bridge.json`（统一注册表）              |
| 工作空间位置 | `~/.openclaw-dev/workspace/` 或自定义                                          | `~/.openclaw-dev/cli-agents/{agentId}/`             |
| 默认文件     | AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md, BOOTSTRAP.md | IDENTITY.md, AGENTS.md（CLI 配置在 bridge.json 中） |
| 用途         | LLM 推理上下文、提示词、记忆                                                   | 身份标识、行为指引                                  |
| 模型配置     | 有（model 字段）                                                               | **无**（CLI Agent 不走 LLM）                        |

---

## 3. 网关 API

### 3.1 新增 RPC 方法

CLI Agent 使用独立的 RPC 命名空间 `cliAgents.*`，不复用 `agents.*`：

| 方法                   | 说明                | 参数                                                                       |
| ---------------------- | ------------------- | -------------------------------------------------------------------------- |
| `cliAgents.list`       | 列出所有 CLI Agent  | —                                                                          |
| `cliAgents.create`     | 创建 CLI Agent      | `{ agentId, name, cliType, command, args?, cwd?, env?, timeout?, emoji? }` |
| `cliAgents.update`     | 更新 CLI Agent 配置 | `{ agentId, ...可更新字段 }`                                               |
| `cliAgents.delete`     | 删除 CLI Agent      | `{ agentId }`                                                              |
| `cliAgents.files.list` | 列出工作空间文件    | `{ agentId }`                                                              |
| `cliAgents.files.get`  | 读取工作空间文件    | `{ agentId, name }`                                                        |
| `cliAgents.files.set`  | 写入工作空间文件    | `{ agentId, name, content }`                                               |
| `cliAgents.test`       | 测试启动 CLI        | `{ agentId }`                                                              |

### 3.2 `cliAgents.create` 处理流程

```
前端调用 cliAgents.create
    ↓
参数校验：
    ├── agentId 格式校验：/^[a-zA-Z0-9_]+$/（不允许中文、空格、特殊字符）
    ├── agentId 唯一性：不能与已有通用 Agent 或 CLI Agent 的 ID 重复
    ├── name 唯一性：不能与已有通用 Agent 或 CLI Agent 的名称重复
    └── command 非空
    ↓
计算 workspace 路径 = cli-agents/{agentId}/
    ↓
创建 workspace 子目录
    ↓
生成默认文件：
    ├── cli-agents/{agentId}/IDENTITY.md（身份信息）
    └── cli-agents/{agentId}/AGENTS.md（Agent 描述）
    ↓
追加 agent 条目到 cli-agents/bridge.json 全局注册表
    ↓
返回 { ok: true, agentId, workspace }
```

### 3.3 `cliAgents.files` 允许的文件白名单

CLI Agent 工作空间子目录中允许操作的文件（不包含 `bridge.json`，因为 bridge.json 在根目录统一管理，通过 `cliAgents.create/update` 操作）：

```typescript
const CLI_AGENT_ALLOWED_FILES = new Set<string>([
  "IDENTITY.md", // 身份信息
  "AGENTS.md", // Agent 描述/行为指引
]);
```

### 3.4 `cliAgents.test` 测试启动

```
前端调用 cliAgents.test({ agentId })
    ↓
从 cli-agents/bridge.json 读取对应 agent 的配置
    ↓
步骤 1：命令存在性检查
    which/where ${command}
    ├── 存在 → 继续
    └── 不存在 → 返回 { ok: false, error: "命令不存在" }
    ↓
步骤 2：工作目录可达性检查
    fs.access(cwd)
    ├── 可访问 → 继续
    └── 不可访问 → 返回 { ok: false, error: "工作目录不可访问" }
    ↓
步骤 3：创建临时 PTY 进程
    createPty(command, args, { cwd, env })
    ↓
步骤 4：输入测试指令 "hello\n"
    pty.write("hello\n")
    ↓
步骤 5：实时推送终端数据
    pty.onData → ws.send("cliAgents.testOutput", { agentId, data })
    ↓
等待 CLI 首次输出（最长 10 秒超时）
    ├── 有输出 → 测试通过，继续推送数据
    └── 超时 → 返回 { ok: false, error: "CLI 启动超时" }
    ↓
前端关闭弹框 或 30 秒自动超时
    ↓
发送 SIGTERM → 5 秒后 SIGKILL → 清理 PTY
    ↓
返回 { ok: true }
```

### 3.5 `cliAgents.testStop` 停止测试

```
前端关闭测试弹框时调用 cliAgents.testStop({ agentId })
    ↓
找到测试 PTY 进程
    ↓
SIGTERM → 5 秒 → SIGKILL → 释放
```

---

## 4. 前端 UI

### 4.1 Agent 列表分区

左侧 Agent 列表按类型分区展示：

```
┌──────────────────────────────────┐
│ 智能体管理                        │
│                                  │
│ Agents                [Refresh]  │
│ 3 configured                     │
│                                  │
│ ── 通用 Agent ── [+ Add]         │
│ ┌──────────────────────────────┐ │
│ │ 🤖 Main          DEFAULT    │ │
│ │ 🤖 Architect                │ │
│ │ 🤖 Reviewer                 │ │
│ └──────────────────────────────┘ │
│                                  │
│ ── CLI Agent ── [+ Add]          │
│ ┌──────────────────────────────┐ │
│ │ 🛠️ CodeBuddy    CLI         │ │
│ │ 🤖 Claude Code  CLI         │ │
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```

**显示规则**：

- 列表中所有位置**只展示 Agent 名称（name）**，不展示 AgentID
- CLI Agent 条目右侧显示 `CLI` 标签徽章
- 列表分为两个区域：「通用 Agent」和「CLI Agent」，各自有独立的 `[+ Add]` 按钮

### 4.2 CLI Agent Tab 结构

选中 CLI Agent 后，右侧面板**只展示 3 个 Tab**：

```typescript
// CLI Agent 的 Tab 列表
const cliAgentTabs = [
  { id: "overview", label: "Overview" },
  { id: "files", label: "Files" },
  { id: "test", label: "Test" },
];
```

对比通用 Agent 的 6 个 Tab：

| Tab       | 通用 Agent | CLI Agent | 说明                        |
| --------- | ---------- | --------- | --------------------------- |
| Overview  | ✅         | ✅        | 内容不同（见 4.3）          |
| Files     | ✅         | ✅        | 相同（展示工作空间文件）    |
| Tools     | ✅         | ❌        | CLI Agent 不配置 LLM 工具   |
| Skills    | ✅         | ❌        | CLI Agent 不使用 Skill 系统 |
| Channels  | ✅         | ❌        | CLI Agent 不绑定消息通道    |
| Cron Jobs | ✅         | ❌        | CLI Agent 不设定定时任务    |
| Test      | ❌         | ✅        | CLI Agent 专属测试功能      |

### 4.3 CLI Agent Overview 面板

CLI Agent 的 Overview 展示的是 CLI 相关配置，**不展示**模型选择、Skill Filter 等通用 Agent 配置项：

```
┌──────────────────────────────────────────────┐
│ 🛠️ CodeBuddy                                 │
│ CLI Agent workspace and configuration.       │
│                                              │
│ [Overview]  [Files]  [Test]                  │
│                                              │
│ ─── Overview ───                              │
│                                              │
│ Identity                                      │
│ ┌────────────────────────────────────────┐   │
│ │ Agent 名称    CodeBuddy               │   │
│ │ Agent ID      codebuddy               │   │
│ │ Emoji         🛠️                      │   │
│ └────────────────────────────────────────┘   │
│                                              │
│ CLI Configuration                             │
│ ┌────────────────────────────────────────┐   │
│ │ CLI Type      codebuddy               │   │
│ │ Command       codebuddy               │   │
│ │ Arguments     (none)                   │   │
│ │ Working Dir   /home/user/project       │   │
│ └────────────────────────────────────────┘   │
│                                              │
│ Timeout                                       │
│ ┌────────────────────────────────────────┐   │
│ │ Reply Timeout 300s (5 min)             │   │
│ │ Idle Timeout  600s (10 min)            │   │
│ └────────────────────────────────────────┘   │
│                                              │
│ Environment Variables                         │
│ ┌────────────────────────────────────────┐   │
│ │ ANTHROPIC_API_KEY  sk-***...***        │   │
│ │ (values are masked for security)       │   │
│ └────────────────────────────────────────┘   │
│                                              │
│ Workspace                                     │
│ ┌────────────────────────────────────────┐   │
│ │ ~/.openclaw-dev/cli-agents/codebuddy   │   │
│ └────────────────────────────────────────┘   │
│                                              │
│                          [Reload Config] [Save]│
└──────────────────────────────────────────────┘
```

**Overview 中不展示以下内容**（这些属于通用 Agent）：

- Primary Model / Fallbacks（CLI Agent 不走 LLM）
- Skills Filter
- 「设为默认」按钮（CLI Agent 不能作为默认 Agent）

**Overview 是唯一展示 AgentID 的地方**，其他所有 UI 位置（列表、群聊、@mention）都只展示 Agent 名称。

### 4.4 CLI Agent Test 面板

Test Tab 提供一键测试 CLI 启动能力：

```
┌──────────────────────────────────────────────┐
│ ─── Test ───                                  │
│                                              │
│ 测试 CLI Agent 能否正常启动和响应。            │
│ 点击测试后将启动 CLI 进程，输入 "hello"       │
│ 并展示终端输出。                               │
│                                              │
│           [🧪 Start Test]                     │
│                                              │
│ 上次测试: 2026-03-13 10:28  ✅ 通过           │
└──────────────────────────────────────────────┘
```

点击 `[🧪 Start Test]` 后弹出**终端测试弹框**：

```
┌──────────────────────────────────────────────┐
│ 测试 CLI Agent: codebuddy            [✕ 关闭] │
│ ─────────────────────────────────────────────│
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ $ codebuddy                              │ │
│ │                                          │ │
│ │ CodeBuddy CLI v2.1.0                     │ │
│ │ > hello                                  │ │
│ │                                          │ │
│ │ Hello! I'm CodeBuddy, ready to help.     │ │
│ │ How can I assist you today?              │ │
│ │                                          │ │
│ │ █                                        │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ 状态: ✅ CLI 已正常启动并响应                  │
│                                              │
│                              [关闭并终止 CLI]  │
└──────────────────────────────────────────────┘
```

**弹框特性**：

- 内嵌 xterm.js 终端实例，实时渲染后台 PTY 输出
- 只读模式（用户不能在终端中输入）
- 关闭弹框时自动终止测试 CLI 进程（调用 `cliAgents.testStop`）
- 底部状态栏显示启动结果

### 4.5 CLI Agent 创建对话框

创建 CLI Agent 时也支持内联测试：

```
┌──────────────────────────────────────────────┐
│ 添加 CLI Agent                                │
│ 添加外部 CLI 编码工具作为 Agent，可在群聊中使用。│
│                                              │
│ CLI 类型    [codebuddy ▾]                     │
│             claude-code / opencode /          │
│             codebuddy / custom                │
│                                              │
│ Agent 名称  [CodeBuddy           ]  ← 自动填充 │
│ Agent ID    [codebuddy            ] ← 默认=名称│
│ Agent 图标  [🛠️]                   ← 自动填充 │
│                                              │
│ ⚠️ Agent ID 仅允许字母、数字、下划线          │
│                                              │
│ ─── CLI 配置 ───                               │
│                                              │
│ 启动命令    [codebuddy            ] ← 自动填充 │
│ 启动参数    [                     ] ← 可选     │
│                                              │
│ ─── 环境变量 ───                               │
│                                              │
│ [+ 添加环境变量]                               │
│                                              │
│ ─── 超时配置 ───                               │
│                                              │
│ 单次回复超时  [300     ] 秒                    │
│                                              │
│ ─── 测试 ───                                   │
│                                              │
│ [🧪 测试启动]                                  │
│                                              │
│ [取消]                          [创建]         │
└──────────────────────────────────────────────┘
```

**Agent 名称与 AgentID 的交互逻辑**：

1. 用户输入 **Agent 名称**（显示名），这是主要输入字段
2. **AgentID 默认自动同步为 Agent 名称的值**（当名称满足格式要求时）
3. 当 Agent 名称包含中文或其他非法字符（不满足 `/^[a-zA-Z0-9_]+$/`）时：
   - AgentID 字段清空，不自动填充
   - 显示提示：**"Agent 名称包含中文/特殊字符，请手动指定 Agent ID（仅限字母、数字、下划线）"**
   - 用户必须手动输入合法的 AgentID
4. AgentID 字段始终可编辑（用户可主动修改，即使名称合法也允许手动指定不同的 ID）
5. 提交前校验：
   - Agent 名称全局唯一（跨通用 Agent + CLI Agent）
   - AgentID 全局唯一（跨通用 Agent + CLI Agent）
   - AgentID 格式合法（`/^[a-zA-Z0-9_]+$/`）

**创建时测试的交互流程**：与独立 Test Tab 的弹框交互一致（弹出终端弹框 → 启动 CLI → 输入 hello → 实时展示输出 → 关闭弹框终止进程）。

**不同之处**：

- 创建时测试使用**临时 PTY 进程**，不写入配置
- 测试通过不是创建的前置条件（用户可以跳过测试直接创建）
- 测试使用用户在表单中填写的当前值（command、args、env），而非已保存的 bridge.json

### 4.6 创建流程

```
前端填写表单
    ↓
前端校验：
    ├── Agent 名称非空、唯一
    ├── AgentID 格式合法（/^[a-zA-Z0-9_]+$/）、唯一
    └── AgentID 非空
    ↓
点击 [创建]
    ↓
调用 cliAgents.create({
    agentId, name, cliType, command, args, env, timeout, emoji
})
    ↓
后端：
    ├── 生成 agentId
    ├── 创建 cli-agents/{agentId}/ 子目录
    ├── 写入 cli-agents/{agentId}/IDENTITY.md
    ├── 写入 cli-agents/{agentId}/AGENTS.md
    └── 追加 cli-agents/bridge.json agents[]（全局注册表）
    ↓
返回 { ok, agentId, workspace }
    ↓
前端刷新 Agent 列表，选中新创建的 CLI Agent
```

---

## 5. 群聊中的 CLI Agent 行为

### 5.1 当前问题

CLI Agent 目前在群聊中被当作普通 Agent 处理：收到 @mention 后走 LLM 推理（`dispatchInboundMessage` → `getReplyFromConfig`），返回一段 LLM 生成的文本。

**正确行为**：@CLI Agent 时应该启动 CLI 进程，注入上下文，通过 PTY 交互。

### 5.2 群聊成员的 Bridge 配置来源

当前架构中，`GroupMember.bridge` 字段存储在群聊元数据中。这个字段的数据来源需要从 CLI Agent 的全局注册表中读取：

```
群聊添加 CLI Agent 成员
    ↓
从 cli-agents/bridge.json 读取对应 agent 的配置
    ↓
将配置转换为 BridgeConfig 赋值给 GroupMember.bridge
    ↓
保存群聊元数据（meta.json）
```

### 5.3 @CLI Agent 的触发流程

```
用户发送 @CodeBuddy 请实现登录功能
    ↓
前端解析 @mention：展示名称 "CodeBuddy" → 实际发送 agentId "codebuddy"
    ↓
resolveDispatchTargets() → 目标 agentId: codebuddy
    ↓
triggerAgentReasoning()
    ↓
检查 member.bridge → 存在
    ↓
triggerBridgeAgent(params, member.bridge)    ← 走 Bridge 路径
    │
    ├── 1. 确保 PTY 进程运行
    │      检查是否有活跃的 PTY(groupId, agentId)
    │      ├── 有 → 复用
    │      └── 无 → 创建新 PTY
    │            command/args/cwd/env 来自 member.bridge
    │            （bridge 数据在加入群聊时从 cli-agents/bridge.json 读入）
    │
    ├── 2. 构建上下文消息（详见 [CLI Agent 上下文](./cli-agent-context.md)）
    │      buildCliContextMessage()
    │      ├── 判断首次/后续交互
    │      ├── 获取群公告、项目说明文档
    │      ├── 获取历史消息（完整/增量）
    │      └── 格式化为注释包裹的消息
    │
    ├── 3. 写入 PTY stdin
    │      pty.write(contextMessage + "\n")
    │      等待 CLI 处理输入
    │
    ├── 4. 实时推送终端数据
    │      pty.onData → group.terminal 事件
    │      前端 xterm.js 实时渲染
    │
    ├── 5. 完成检测
    │      空闲 8 秒无输出 → 判定完成
    │      或全局超时 5 分钟
    │
    ├── 6. 纯文本提取
    │      从 PTY 缓冲区 strip-ansi 提取文本
    │      或从前端 xterm.js buffer 提取
    │
    └── 7. 消息广播 + 写入 transcript
           group.stream final → 纯文本消息
           appendGroupMessage() → 持久化
```

> **上下文消息格式、首次/后续交互模式、截断策略等详见 [CLI Agent 上下文](./cli-agent-context.md) 文档。**

### 5.4 与通用 Agent 触发的对比

| 维度       | 通用 Agent                           | CLI Agent                                          |
| ---------- | ------------------------------------ | -------------------------------------------------- |
| 触发入口   | `triggerAgentReasoning()`            | `triggerAgentReasoning()` → `triggerBridgeAgent()` |
| 推理方式   | LLM API (dispatchInboundMessage)     | PTY stdin/stdout                                   |
| 上下文注入 | system prompt + conversation history | 构建文本消息写入 PTY stdin                         |
| 输出通道   | group.stream (delta/final)           | group.terminal + group.stream (final)              |
| 前端展示   | 文本气泡 (流式)                      | 终端组件 (xterm.js) + 完成后纯文本气泡             |
| 中止方式   | AbortController (取消 LLM 请求)      | SIGTERM → SIGKILL (终止 PTY 进程)                  |

### 5.5 CLI Agent 加入群聊的识别

前端在添加群聊成员时，需要区分通用 Agent 和 CLI Agent：

```
添加群聊成员 → 成员选择列表
    ↓
展示两类可选 Agent（均展示 Agent 名称）：
    ├── 通用 Agent（从 agents.list 读取）
    │     标记为 🤖    展示名称如 "Main"
    └── CLI Agent（从 cli-agents/bridge.json 读取）
          标记为 🔧 CLI  展示名称如 "CodeBuddy"

用户选择 CLI Agent 加入群聊
    ↓
后端从 cli-agents/bridge.json 读取对应 agent 的完整配置
    ↓
GroupMember = { agentId, name（Agent 名称）, bridge: BridgeConfig }
    ↓
保存群聊元数据（存储 agentId，显示用 name）
```

**群聊中的显示规则**：

- 群聊成员列表展示 **Agent 名称**（如 "CodeBuddy"），不展示 AgentID
- 群聊消息气泡的发送者名称显示 **Agent 名称**
- @mention 选择列表中展示 **Agent 名称**（如 "@CodeBuddy"）
- 用户在输入框 @mention 时输入的是 **Agent 名称**
- **实际数据传输（消息发送、API 调用）使用 AgentID**

---

## 6. 实现清单

### 6.1 后端新增文件

| 文件                                       | 说明                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `src/config/types.cli-agents.ts`           | CliAgentEntry / CliBridgeConfig 类型定义                                              |
| `src/commands/cli-agents.config.ts`        | CLI Agent 配置 CRUD（list/find/upsert/remove）                                        |
| `src/agents/cli-agent-scope.ts`            | CLI Agent 目录解析（resolveCliAgentsRootDir / resolveCliAgentWorkspaceDir）           |
| `src/agents/agent-id-validation.ts`        | AgentID 格式校验（isValidAgentId / canAutoGenerateAgentId / validateAgentUniqueness） |
| `src/gateway/server-methods/cli-agents.ts` | `cliAgents.*` RPC 方法实现                                                            |

### 6.2 后端修改文件

| 文件                                   | 修改内容                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `src/gateway/server-methods/agents.ts` | `agents.create` 接受可选 `agentId` 参数；增加 AgentID 格式校验 + 全局唯一性校验 |
| `src/gateway/server-methods-list.ts`   | 注册 `cliAgents.*` 方法                                                         |
| `src/gateway/method-scopes.ts`         | 添加 `cliAgents.*` 权限作用域                                                   |
| `src/group-chat/group-store.ts`        | 添加成员时从 `cli-agents/bridge.json` 读取配置填充 `member.bridge`              |

### 6.3 前端修改文件

| 文件                              | 修改内容                                                                                                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/src/ui/views/agents.ts`       | 分区列表展示 Agent 名称（非 ID）；CLI Agent Tab 限制为 Overview、Files、Test；CLI Agent 专属 Overview 面板展示 AgentID；通用 Agent 创建对话框增加 AgentID 字段；CLI Agent 创建对话框使用 Agent 名称 + AgentID 双字段             |
| `ui/src/ui/controllers/agents.ts` | `createCliAgent()` 改用 `cliAgents.create` API（传递 agentId + name）；通用 `createAgent()` 支持传递 agentId；新增 `testCliAgent()` / `stopCliAgentTest()`；新增 `loadCliAgents()`；新增 AgentID 格式校验 + 名称/ID 自动同步逻辑 |
| `ui/src/ui/views/group-chat.ts`   | 群聊成员列表/消息气泡展示 Agent 名称；@mention 选择列表展示名称、发送用 agentId                                                                                                                                                  |

### 6.4 前端新增文件

| 文件                                | 说明                                                    |
| ----------------------------------- | ------------------------------------------------------- |
| `ui/src/ui/views/cli-agent-test.ts` | 测试终端弹框组件（xterm.js 实例 + 关闭按钮 + 状态指示） |

### 6.5 实施阶段

| 阶段                 | 内容                                                                                    | 预估     |
| -------------------- | --------------------------------------------------------------------------------------- | -------- |
| **P0: 名称/ID 规范** | AgentID 校验函数、通用 Agent 创建支持 agentId、前端名称/ID 双字段 + 自动同步 + 中文提示 | 基础设施 |
| **P1: 存储与目录**   | 类型定义、bridge.json CRUD、目录解析、网关 API（cliAgents.create/list/delete/files.\*） | 后端核心 |
| **P2: 前端管理**     | 列表分区（展示名称）、CLI Agent 专属 Tab（Overview/Files/Test）、创建对话框             | 前端核心 |
| **P3: 测试功能**     | cliAgents.test API、终端测试弹框、创建时内联测试                                        | 闭环功能 |
| **P4: 群聊集成**     | 成员添加识别 CLI Agent、展示名称/传输 ID、bridge.json 读取、GroupMember.bridge 填充     | 打通群聊 |

---

## 7. Agent 名称与 AgentID 规范

> 本章规范**适用于所有 Agent 类型**（通用 Agent 和 CLI Agent），不仅限于 CLI Agent。

### 7.1 字段定义

| 字段                     | 定义               | 格式限制                                      | 唯一性                                  |
| ------------------------ | ------------------ | --------------------------------------------- | --------------------------------------- |
| **Agent 名称**（`name`） | 用户可见的显示名称 | 无限制，可包含中文、空格、特殊字符            | ✅ 全局唯一（跨通用 Agent + CLI Agent） |
| **AgentID**（`id`）      | 系统内部标识符     | **仅限 `[a-zA-Z0-9_]`**（字母、数字、下划线） | ✅ 全局唯一（跨通用 Agent + CLI Agent） |

### 7.2 显示规则

**核心原则：除了 Overview 页面外，所有 UI 位置只展示 Agent 名称，不展示 AgentID。**

| 场景                | 展示内容                      | 传输/存储内容        |
| ------------------- | ----------------------------- | -------------------- |
| Agent 列表（左侧）  | Agent 名称                    | —                    |
| Agent Overview 页面 | Agent 名称 **+** AgentID      | —                    |
| 群聊成员列表        | Agent 名称                    | agentId              |
| 群聊消息气泡发送者  | Agent 名称                    | agentId              |
| @mention 选择列表   | Agent 名称（如 "@CodeBuddy"） | —                    |
| @mention 输入       | 用户输入 Agent 名称           | 发送时替换为 agentId |
| API 数据传输        | —                             | agentId              |
| 目录名/文件路径     | —                             | agentId              |

### 7.3 创建时的默认行为

无论是通用 Agent 还是 CLI Agent，创建时遵循以下规则：

1. 用户输入 **Agent 名称**（这是主要输入字段）
2. **AgentID 默认与 Agent 名称一致**（当名称满足 `/^[a-zA-Z0-9_]+$/` 时自动同步）
3. 当 Agent 名称**包含中文或其他非法字符**时：
   - AgentID 字段清空，**不自动填充**
   - 显示提示文案：_"Agent 名称包含非法字符，请手动指定 Agent ID（仅限字母、数字、下划线）"_
   - 用户必须手动输入合法的 AgentID
4. AgentID 字段**始终可编辑**（即使名称合法，用户也可以主动修改为不同的 ID）

```
用户输入 Agent 名称
    ↓
检查名称是否满足 /^[a-zA-Z0-9_]+$/
    ├── 满足 → AgentID 自动同步为名称
    └── 不满足（含中文/空格/特殊字符）
          → AgentID 清空
          → 显示提示："请手动指定 Agent ID"
          → 用户手动输入
    ↓
提交前校验：
    ├── Agent 名称非空 + 全局唯一
    ├── AgentID 非空 + 格式合法 + 全局唯一
    └── 通过 → 允许创建
```

### 7.4 通用 Agent 创建的变更

**当前问题**：通用 Agent 创建时不支持手动指定 AgentID，AgentID 由后端自动从名称生成。

**需要修改**：通用 Agent 创建对话框增加 **AgentID 字段**，交互逻辑与 CLI Agent 一致：

```
┌──────────────────────────────────────────────┐
│ 添加 Agent                                    │
│                                              │
│ Agent 名称   [我的助手            ]            │
│ Agent ID     [                    ]  ← 需手动 │
│              ⚠️ Agent 名称包含中文，请手动指定  │
│              Agent ID（仅限字母、数字、下划线） │
│                                              │
│ ...（其他通用 Agent 配置字段）                  │
│                                              │
│ [取消]                          [创建]         │
└──────────────────────────────────────────────┘
```

对应后端 `agents.create` API 也需要接受可选的 `agentId` 参数：

- 如果前端传了 `agentId`，使用前端指定的值
- 如果前端没传，后端从 `name` 自动生成（保持向后兼容）
- 后端同样需要做格式校验和唯一性校验

### 7.5 格式校验函数

```typescript
/** AgentID 合法性正则 */
const AGENT_ID_PATTERN = /^[a-zA-Z0-9_]+$/;

/** 校验 AgentID 格式是否合法 */
export function isValidAgentId(id: string): boolean {
  return AGENT_ID_PATTERN.test(id) && id.length > 0;
}

/** 检查 Agent 名称是否可以自动作为 AgentID（不含中文/特殊字符） */
export function canAutoGenerateAgentId(name: string): boolean {
  return AGENT_ID_PATTERN.test(name);
}

/**
 * 校验 AgentID 和 Agent 名称的全局唯一性。
 * 检查范围包括通用 Agent（openclaw.json agents.list）
 * 和 CLI Agent（cli-agents/bridge.json agents[]）。
 */
export function validateAgentUniqueness(
  agentId: string,
  agentName: string,
  existingAgents: Array<{ id: string; name: string }>,
  existingCliAgents: Array<{ id: string; name: string }>,
): { valid: boolean; error?: string };
```

### 7.6 举例

| Agent 名称    | AgentID                | 说明                                                       |
| ------------- | ---------------------- | ---------------------------------------------------------- |
| `claude-code` | `claude-code`（自动）  | ❌ 非法，`-` 不允许 → AgentID 需手动指定，如 `claude_code` |
| `CodeBuddy`   | `CodeBuddy`（自动）    | ✅ 合法                                                    |
| `codebuddy`   | `codebuddy`（自动）    | ✅ 合法                                                    |
| `我的助手`    | `my_assistant`（手动） | 名称含中文，需手动指定                                     |
| `Main Agent`  | `Main_Agent`（手动）   | 名称含空格，需手动指定                                     |
| `reviewer`    | `reviewer`（自动）     | ✅ 合法                                                    |

---

## 8. 数据迁移

### 8.1 现有 CLI Agent 的迁移

如果已有通过旧方式（`agents.create` + `agents.files.set("bridge.json")`）创建的 CLI Agent，需要迁移到新体系：

```
扫描 agents.list[] 中的每个 agent
    ↓
检查其 workspace 目录下是否存在 bridge.json
    或 IDENTITY.md 中 Theme 以 "CLI Agent" 开头
    ├── 是 → 这是一个 CLI Agent
    │     ├── 读取旧 workspace 下的 bridge.json 内容
    │     ├── 在 cli-agents/{agentId}/ 创建新工作空间目录
    │     ├── 复制 IDENTITY.md + AGENTS.md 到新目录
    │     ├── 将 CLI 配置追加到 cli-agents/bridge.json 全局注册表
    │     └── 从 agents.list[] 中移除该条目
    └── 否 → 跳过（通用 Agent）
```

### 8.2 迁移兼容性

- 迁移在首次加载新版本时自动执行
- 迁移前备份 `openclaw.json`
- 迁移失败不影响系统启动（降级为旧行为）
- 迁移日志输出到 stderr，便于排查问题
