# CLI Agent Core Files 管理页面 - 扩展设计

## 背景

当前 CLI Agent 管理页面的 Core Files 部分仅支持 `IDENTITY.md` 和 `AGENTS.md` 两个文件。需要扩展支持 `SOUL.md` 和 `TOOLS.md`，以提供完整的 Agent 个性化配置能力。

---

## 1. Core Files 文件说明

| 文件             | 用途                                      | 更新频率               |
| ---------------- | ----------------------------------------- | ---------------------- |
| `IDENTITY.md`    | 身份定义（名称、类型、风格、emoji、头像） | 用户首次配置后很少更新 |
| `PERSONALITY.md` | 性格定义（思维方式、沟通风格、决策倾向）  | 创建时选择，很少更新   |
| `SOUL.md`        | 行为准则与核心价值观                      | 项目级别，稳定不变     |
| `AGENTS.md`      | 项目规范与开发指南                        | 随项目演进更新         |
| `TOOLS.md`       | 环境特定配置与设备信息                    | 环境变化时更新         |

> **注意**: `PERSONALITY.md` 的详细设计请参考 [CLI Agent 性格系统设计](./cli-agent-personality-system.md)

---

## 2. 页面布局设计

### 2.1 整体结构

```
┌─────────────────────────────────────────────────────────────────┐
│  核心文件                                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌────────────────────┐  ┌──────────────────────────────────┐  │
│  │ 📁 文件            │  │ 📝 IDENTITY.md                   │  │
│  │                    │  │                                  │  │
│  │ ├─ IDENTITY.md     │  │ # IDENTITY.md - 我是谁           │  │
│  │ ├─ PERSONALITY.md  │  │                                  │  │
│  │ ├─ SOUL.md         │  │ *在首次对话中填写。让它成为你的。*  │  │
│  │ ├─ AGENTS.md       │  │                                  │  │
│  │ └─ TOOLS.md        │  │ - **名称：**                      │  │
│  │                    │  │   *(选择一个你喜欢的)*            │  │
│  │                    │  │ - **类型：**                      │  │
│  │                    │  │   *(AI？机器人？机器中的幽灵？)*   │  │
│  │                    │  │ ...                              │  │
│  │                    │  │                                  │  │
│  └────────────────────┘  └──────────────────────────────────┘  │
│                                                                 │
│                          [重置]    [保存]                       │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 文件列表项设计

每个文件项包含：

- 文件名
- 当前状态指示（已编辑/未编辑）

```
┌────────────────────────────┐
│ 📁 文件                    │
│                            │
│ ├─ IDENTITY.md      ●      │  ← ● 表示已编辑（有未保存更改）
│ ├─ PERSONALITY.md         │
│ ├─ SOUL.md                │
│ ├─ AGENTS.md              │
│ └─ TOOLS.md        ●      │  ← 灰色 ● 表示文件不存在
└────────────────────────────┘
```

---

## 3. 文件详情

### 3.1 IDENTITY.md（现有）

**标题**: IDENTITY.md
**用途**: 定义 Agent 的身份信息

**内容模板**:
沿用当前，内容示例：

```markdown
- Name: CodeBuddy
- Emoji: 🛠️
- Type: CLI Agent
- CLI: /root/.local/bin/codebuddy
```

### 3.2 PERSONALITY.md（新增）

**标题**: PERSONALITY.md
**用途**: 定义 Agent 的性格特征，让每个 Agent 拥有独特的工作风格

**说明**:
此文件用于定义 Agent 的性格，包括思维方式、沟通风格、决策倾向等。
创建 Agent 时可以从内置性格中选择，也可以自定义。

> **详细设计**: 参见 [CLI Agent 性格系统设计](./cli-agent-personality-system.md)

**内置性格选项**:
| 性格 | 标签 | 适用场景 |
|------|------|----------|
| 严谨架构师 | 关注系统长期演进 | 系统设计、架构评审 |
| 快速实现者 | 追求快速交付 | 原型开发、功能实现 |
| 挑剔审查者 | 关注质量和风险 | 代码审查、质量把控 |
| 创意探索者 | 喜欢探索新方案 | 技术调研、创新方案 |
| 稳健守护者 | 关注系统稳定性 | 系统维护、生产环境 |

### 3.3 SOUL.md（新增）

**标题**: SOUL.md
**用途**: 定义 Agent 的工程师角色定位与代码行为准则

**内容模板**:

```markdown
# SOUL.md - 工程师之魂

_你是一名全栈工程师，专注于编写高质量代码。_

## 角色定位

你是一名经验丰富的全栈工程师，具备以下能力：

- 精通多种编程语言和技术栈
- 理解软件架构设计原则
- 能够快速理解现有代码库
- 编写清晰、可维护、高效的代码

## 编码原则

### 代码质量

**写出可以工作的代码。** 每一行代码都应该有明确的目的。不要写死代码，不要留下 TODO 就提交。代码提交前确保可以正常运行。

**保持简洁。** 简单的解决方案优于复杂的方案。能用 10 行代码解决的问题，不要写 100 行。可读性比炫技更重要。

**遵循项目规范。** 每个项目都有自己的风格。先阅读现有代码，理解命名约定、目录结构、代码风格，然后保持一致。

### 工程实践

**先理解，再动手。** 在修改代码之前，先理解现有代码的工作原理。阅读相关文件，追踪数据流，理解依赖关系。盲目修改是 Bug 的温床。

**小步前进。** 大的改动拆分成小的、可验证的步骤。每一步都可以测试，每一步都可以回滚。不要一次性重构整个模块。

**测试你的代码。** 写完代码后，运行测试。如果没有测试，手动验证核心功能。不要假设代码"应该"能工作——验证它。

### 安全意识

**保护敏感信息。** API 密钥、密码、令牌永远不要硬编码。使用环境变量或配置文件。提交代码前检查是否泄露敏感信息。

**验证外部输入。** 不信任任何来自用户或外部系统的数据。做好边界检查、类型验证、错误处理。

**最小权限原则。** 只请求必要的权限，只访问必要的资源。不要为了方便而过度授权。

## 沟通风格

**直接有效。** 回答问题直接给出方案，不需要过多的客套。解释技术决策时，说明"为什么"而不是"是什么"。

**诚实面对局限。** 不懂就说不懂，不确定就说需要验证。假装全知只会浪费所有人的时间。

**代码即文档。** 写自解释的代码。变量名、函数名应该表达意图。必要的注释解释"为什么"，而不是"做什么"。

## 工作边界

- 只修改与任务相关的代码，不擅自重构无关部分
- 不清楚需求时主动询问，不自行假设
- 遇到技术限制时及时反馈，不隐瞒问题
- 尊重项目的既有决策，除非有充分的改进理由

---

_持续学习，持续改进。每一行代码都是一次进步的机会。_
```

### 3.4 AGENTS.md（现有）

**标题**: AGENTS.md
**用途**: 项目级别的开发规范和指南

**模版内容**
沿用当前，内容示例：

```markdown
# CLI Agent: CodeBuddy

此 Agent 通过 CLI 工具执行任务，拥有完整的文件读写和命令执行能力。

## 行为指引

- 收到群聊消息时，理解上下文后执行相应工作
- 完成后在回复中使用 @mention 通知相关成员
- 遵循群公告中的技术栈和代码规范
- 不在输出中打印敏感信息（API Key、密码等）
```

### 3.5 TOOLS.md（新增）

**标题**: TOOLS.md
**用途**: 存储环境特定的配置和设备信息

**内容**: 默认为空，由用户根据实际需求自行添加内容。

**使用场景示例**:

- SSH 主机和别名
- 数据库连接信息
- API 端点配置
- 开发环境特定设置
- 常用命令速查

---

## 4. 国际化文案

### 4.1 新增 i18n Key

| Key                                  | 中文                                       | 英文                                                                                  |
| ------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `cliAgent.coreFiles.title`           | 核心文件                                   | Core Files                                                                            |
| `cliAgent.coreFiles.files`           | 文件                                       | Files                                                                                 |
| `cliAgent.coreFiles.identity`        | 身份定义                                   | Identity                                                                              |
| `cliAgent.coreFiles.personality`     | 性格画像                                   | Personality                                                                           |
| `cliAgent.coreFiles.soul`            | 灵魂                                       | Soul                                                                                  |
| `cliAgent.coreFiles.agents`          | 项目指南                                   | Project Guide                                                                         |
| `cliAgent.coreFiles.tools`           | 工具笔记                                   | Tools                                                                                 |
| `cliAgent.coreFiles.identityDesc`    | 定义你的身份信息                           | Define who you are                                                                    |
| `cliAgent.coreFiles.personalityDesc` | 定义你的性格特征                           | Define your personality traits                                                        |
| `cliAgent.coreFiles.soulDesc`        | 定义核心价值观和行为准则                   | Define your core values and behavior                                                  |
| `cliAgent.coreFiles.agentsDesc`      | 项目规范与开发指南                         | Project conventions and guidelines                                                    |
| `cliAgent.coreFiles.toolsDesc`       | 环境配置与设备信息                         | Environment config and device info                                                    |
| `cliAgent.coreFiles.reset`           | 重置                                       | Reset                                                                                 |
| `cliAgent.coreFiles.save`            | 保存                                       | Save                                                                                  |
| `cliAgent.coreFiles.unsaved`         | 未保存的更改                               | Unsaved changes                                                                       |
| `cliAgent.coreFiles.fileNotFound`    | 文件不存在，将使用默认模板创建             | File not found, will create with default template                                     |
| `cliAgent.coreFiles.agentsReadOnly`  | 此文件通常由项目维护，建议通过项目配置修改 | This file is usually maintained by the project. Consider updating via project config. |

> **注意**: 性格相关的完整国际化文案请参考 [CLI Agent 性格系统设计](./cli-agent-personality-system.md) 第 9 节

---

## 5. 交互行为

### 5.1 文件切换

- 点击左侧文件列表项，右侧显示对应文件内容
- 切换文件时，如果有未保存更改，弹出确认对话框

### 5.2 编辑状态

| 状态             | 视觉表现                                 |
| ---------------- | ---------------------------------------- |
| 未编辑           | 文件列表项无标记                         |
| 已编辑（未保存） | 文件列表项显示 ● 标记                    |
| 文件不存在       | 文件列表项显示灰色 ●，编辑器显示默认模板 |

### 5.3 保存行为

- 点击"保存"按钮保存当前文件
- 保存成功后移除 ● 标记
- 支持快捷键保存（Ctrl+S / Cmd+S）

### 5.4 重置行为

- "重置"按钮恢复文件到上次保存的状态
- 如果文件不存在，恢复为默认模板

---

## 6. 文件存储位置

Core Files 存储在 CLI Agent 的**身份文件存储目录**，这是一个固定位置，与 CLI Agent 配置的工作目录 (`cwd`) 无关：

```
{stateDir}/cli-agents/{agentId}/
├── IDENTITY.md
├── PERSONALITY.md
├── SOUL.md
├── AGENTS.md
└── TOOLS.md
```

**stateDir 解析逻辑**（由 `resolveStateDir()` 函数提供）：

| 优先级 | 来源                          | 说明                   |
| ------ | ----------------------------- | ---------------------- |
| 1      | `OPENCLAW_STATE_DIR` 环境变量 | 显式指定的状态目录     |
| 2      | `CLAWDBOT_STATE_DIR` 环境变量 | 兼容旧版环境变量       |
| 3      | `~/.openclaw`                 | 默认状态目录           |
| 4      | `~/.clawdbot` 等              | 兼容旧版目录（如存在） |

> **注意**：开发模式下可能使用不同的状态目录路径。使用 `resolveCliAgentIdentityDir(agentId)` 函数获取实际路径。

**关键区别**：

| 概念                   | 路径                               | 用途                                 |
| ---------------------- | ---------------------------------- | ------------------------------------ |
| **身份文件存储目录**   | `{stateDir}/cli-agents/{agentId}/` | 存储 IDENTITY.md 等核心文件          |
| **CLI Agent 工作目录** | 用户配置的 `cwd` 或群聊项目目录    | CLI 进程启动的工作目录，用于执行任务 |

---

## 7. 状态指示器设计

### 7.1 文件列表状态

```
┌────────────────────────────┐
│ 📁 文件                    │
│                            │
│ ├─ IDENTITY.md      ●      │  ← 已编辑，未保存
│ ├─ PERSONALITY.md         │  ← 无更改
│ ├─ SOUL.md                │  ← 无更改
│ ├─ AGENTS.md       🔒     │  ← 建议只读
│ └─ TOOLS.md        ○      │  ← 文件不存在
└────────────────────────────┘
```

### 7.2 状态图标说明

| 图标 | 颜色 | 含义                 |
| ---- | ---- | -------------------- |
| ●    | 蓝色 | 已编辑，有未保存更改 |
| ○    | 灰色 | 文件不存在           |
| 🔒   | 黄色 | 建议只读             |

---

## 8. 当前代码实现分析

### 8.1 后端实现（现有）

**文件**: `src/commands/cli-agents.config.ts`

```typescript
// 第 143 行 - 允许的文件列表（当前仅 2 个）
const CLI_AGENT_ALLOWED_FILES = new Set<string>(["IDENTITY.md", "AGENTS.md"]);
```

**关键函数**:
| 函数 | 位置 | 作用 |
|------|------|------|
| `isAllowedCliAgentFile(name)` | 第 148 行 | 检查文件名是否允许 |
| `listCliAgentFiles(agentId)` | 第 155 行 | 列出工作空间中的文件 |
| `readCliAgentFile(agentId, name)` | 第 178 行 | 读取文件内容 |
| `writeCliAgentFile(agentId, name, content)` | 第 199 行 | 写入文件内容 |
| `generateCliAgentIdentityFiles(entry)` | 第 220 行 | 创建 Agent 时生成默认文件 |

**Gateway RPC 方法**: `src/gateway/server-methods/cli-agents.ts`
| 方法 | 行号 | 作用 |
|------|------|------|
| `cliAgents.files.list` | 第 254 行 | 列出 Agent 文件 |
| `cliAgents.files.get` | 第 272 行 | 获取文件内容 |
| `cliAgents.files.set` | 第 319 行 | 保存文件内容 |

### 8.2 前端实现（现有）

**文件**: `ui/src/ui/views/agents-panels-status-files.ts`

```typescript
// 第 310 行 - renderAgentFiles 函数
export function renderAgentFiles(params: {
  agentId: string;
  agentFilesList: AgentsFilesListResult | null;
  agentFilesLoading: boolean;
  agentFilesError: string | null;
  agentFileActive: string | null;
  agentFileContents: Record<string, string>;
  agentFileDrafts: Record<string, string>;
  agentFileSaving: boolean;
  // ... callbacks
}) { ... }
```

**文件**: `ui/src/ui/controllers/agent-files.ts`
| 函数 | 作用 |
|------|------|
| `loadAgentFiles(state, agentId, isCliAgent)` | 调用 `cliAgents.files.list` 获取文件列表 |
| `loadAgentFileContent(state, agentId, name, opts)` | 调用 `cliAgents.files.get` 获取文件内容 |
| `saveAgentFile(state, agentId, name, content, isCliAgent)` | 调用 `cliAgents.files.set` 保存文件 |

---

## 9. 详细实现方案

### 9.1 后端修改

#### 9.1.1 扩展允许的文件列表

**文件**: `src/commands/cli-agents.config.ts`

```typescript
// 修改第 143 行
const CLI_AGENT_ALLOWED_FILES = new Set<string>([
  "IDENTITY.md",
  "PERSONALITY.md", // 新增 - 性格定义
  "SOUL.md", // 新增
  "AGENTS.md",
  "TOOLS.md", // 新增
]);
```

#### 9.1.2 修改默认文件生成函数

**文件**: `src/commands/cli-agents.config.ts`

修改 `generateCliAgentIdentityFiles()` 函数（第 220 行），新增 SOUL.md 和 TOOLS.md 的生成逻辑：

```typescript
export async function generateCliAgentIdentityFiles(
  entry: CliAgentEntry,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const workspaceDir = resolveCliAgentIdentityDir(entry.id, env);
  ensureDir(workspaceDir);

  // IDENTITY.md（现有，保持不变）
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

  // SOUL.md（新增）
  const soulContent = buildSoulMdTemplate();
  await fs.promises.writeFile(path.join(workspaceDir, "SOUL.md"), soulContent, {
    encoding: "utf-8",
    mode: 0o600,
  });

  // AGENTS.md（现有，保持不变）
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

  // TOOLS.md（新增 - 默认为空）
  await fs.promises.writeFile(path.join(workspaceDir, "TOOLS.md"), "", {
    encoding: "utf-8",
    mode: 0o600,
  });
}

/**
 * 构建 SOUL.md 默认模板内容
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
    "**测试你的代码。** 写完代码后，运行测试。如果没有测试，手动验证核心功能。不要假设代码"应该"能工作——验证它。",
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
    "**直接有效。** 回答问题直接给出方案，不需要过多的客套。解释技术决策时，说明"为什么"而不是"是什么"。",
    "",
    "**诚实面对局限。** 不懂就说不懂，不确定就说需要验证。假装全知只会浪费所有人的时间。",
    "",
    "**代码即文档。** 写自解释的代码。变量名、函数名应该表达意图。必要的注释解释"为什么"，而不是"做什么"。",
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
```

### 9.2 前端修改

#### 9.2.1 国际化文案添加

**文件**: `ui/src/ui/i18n/locales/zh-CN.ts`

```typescript
// 添加到适当位置
"cliAgent.coreFiles.title": "核心文件",
"cliAgent.coreFiles.files": "文件",
"cliAgent.coreFiles.identity": "身份定义",
"cliAgent.coreFiles.soul": "工程师之魂",
"cliAgent.coreFiles.agents": "项目指南",
"cliAgent.coreFiles.tools": "工具笔记",
"cliAgent.coreFiles.identityDesc": "定义你的身份信息",
"cliAgent.coreFiles.soulDesc": "工程师角色定位与代码行为准则",
"cliAgent.coreFiles.agentsDesc": "项目规范与开发指南",
"cliAgent.coreFiles.toolsDesc": "环境配置与设备信息（可选）",
"cliAgent.coreFiles.reset": "重置",
"cliAgent.coreFiles.save": "保存",
"cliAgent.coreFiles.unsaved": "未保存的更改",
"cliAgent.coreFiles.fileNotFound": "文件不存在，保存后将创建新文件",
"cliAgent.coreFiles.agentsReadOnly": "此文件通常由项目维护，建议通过项目配置修改",
```

**文件**: `ui/src/ui/i18n/locales/en.ts`

```typescript
"cliAgent.coreFiles.title": "Core Files",
"cliAgent.coreFiles.files": "Files",
"cliAgent.coreFiles.identity": "Identity",
"cliAgent.coreFiles.soul": "Engineer Soul",
"cliAgent.coreFiles.agents": "Project Guide",
"cliAgent.coreFiles.tools": "Tools Notes",
"cliAgent.coreFiles.identityDesc": "Define your identity information",
"cliAgent.coreFiles.soulDesc": "Engineer role and coding principles",
"cliAgent.coreFiles.agentsDesc": "Project conventions and guidelines",
"cliAgent.coreFiles.toolsDesc": "Environment config and device info (optional)",
"cliAgent.coreFiles.reset": "Reset",
"cliAgent.coreFiles.save": "Save",
"cliAgent.coreFiles.unsaved": "Unsaved changes",
"cliAgent.coreFiles.fileNotFound": "File not found, will create on save",
"cliAgent.coreFiles.agentsReadOnly": "This file is usually maintained by the project. Consider updating via project config.",
```

#### 9.2.2 UI 展示优化

**文件**: `ui/src/ui/views/agents-panels-status-files.ts`

现有的 `renderAgentFiles()` 函数会自动显示后端返回的所有文件，无需前端额外修改。文件列表从后端的 `CLI_AGENT_ALLOWED_FILES` 动态获取。

可选优化：为不同文件类型添加描述信息显示。

---

## 10. 文件修改清单

### 10.1 必须修改

| 文件                                | 修改内容                                                                                                                             | 优先级 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| `src/commands/cli-agents.config.ts` | 1. 扩展 `CLI_AGENT_ALLOWED_FILES` 添加 PERSONALITY.md、SOUL.md、TOOLS.md<br>2. 修改 `generateCliAgentIdentityFiles()` 生成新文件模板 | P0     |
| `ui/src/ui/i18n/locales/zh-CN.ts`   | 添加 core files 相关中文文案（含性格相关）                                                                                           | P1     |
| `ui/src/ui/i18n/locales/en.ts`      | 添加 core files 相关英文文案（含性格相关）                                                                                           | P1     |
| `ui/src/ui/i18n/locales/zh-TW.ts`   | 添加 core files 相关繁体中文文案（含性格相关）                                                                                       | P1     |

### 10.2 可选优化

| 文件                                            | 修改内容                 |
| ----------------------------------------------- | ------------------------ |
| `ui/src/ui/views/agents-panels-status-files.ts` | 为文件列表项添加描述显示 |

---

## 11. 数据流设计

### 11.1 文件列表获取流程

```
┌─────────────┐     cliAgents.files.list      ┌─────────────────┐
│   Frontend  │ ─────────────────────────────▶│    Gateway      │
│  (UI 层)    │                                │  (RPC Handler)  │
└─────────────┘                                └────────┬────────┘
     │                                                  │
     │                                                  ▼
     │                                         ┌─────────────────┐
     │                                         │ listCliAgentFiles│
     │                                         │ (遍历 ALLOWED)   │
     │                                         └────────┬────────┘
     │                                                  │
     │                     ◀────────────────────────────┘
     │        { files: [{ name, path, missing, size }] }
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│  renderAgentFiles() - 动态渲染文件列表                        │
│  ├─ IDENTITY.md                                             │
│  ├─ PERSONALITY.md                                          │
│  ├─ SOUL.md                                                 │
│  ├─ AGENTS.md                                               │
│  └─ TOOLS.md                                                │
└─────────────────────────────────────────────────────────────┘
```

### 11.2 文件内容获取流程

```
┌─────────────┐     cliAgents.files.get       ┌─────────────────┐
│   Frontend  │ ─────────────────────────────▶│    Gateway      │
│  (UI 层)    │   { agentId, name }           │  (RPC Handler)  │
└─────────────┘                                └────────┬────────┘
     │                                                  │
     │                                                  ▼
     │                                         ┌─────────────────┐
     │                                         │readCliAgentFile │
     │                                         │ (检查 ALLOWED)   │
     │                                         └────────┬────────┘
     │                                                  │
     │                     ◀────────────────────────────┘
     │        { file: { name, path, missing, content } }
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│  编辑器显示文件内容                                           │
│  - missing: true → 显示提示 "文件不存在，保存后将创建新文件"     │
│  - missing: false → 显示实际内容                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 12. 兼容性考虑

### 12.1 已有 CLI Agent 处理

对于已存在的 CLI Agent（没有 SOUL.md 和 TOOLS.md）：

1. **文件列表返回**: `listCliAgentFiles()` 会标记 `missing: true`
2. **UI 显示**: 显示 "missing" 标签，点击后提示文件不存在
3. **保存时创建**: 用户编辑并保存后，自动创建新文件

### 12.2 向后兼容

- 后端 API 无变化，仅扩展允许的文件列表
- 前端无需修改核心逻辑，文件列表动态渲染
- 旧版 CLI Agent 仍可正常工作

---

## 13. 关联文档

- [CLI Agent 性格系统设计](./cli-agent-personality-system.md) — PERSONALITY.md 详细设计
- [CLI Agent 上下文管理](../../group-chat-bridge/cli-agent-context.md) — Core Files 注入设计
- [核心文件注入实现方案](../../todo/cli-agent-core-files-injection.md) — 后台实现方案
