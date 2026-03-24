# CLI Agent 上下文管理

> 本文档定义 CLI Agent 的上下文管理机制，包括上下文构建、消息格式、截断策略、增量更新等。适用于群聊中 CLI Agent 被触发时的上下文注入流程。

## 1. 上下文管理概述

### 1.1 为什么 CLI Agent 需要特殊的上下文管理

CLI Agent 与通用 Agent 有本质区别：

| 维度       | 通用 Agent                           | CLI Agent                  |
| ---------- | ------------------------------------ | -------------------------- |
| 推理方式   | LLM API 调用                         | PTY stdin/stdout           |
| 上下文注入 | System Prompt + Conversation History | 构建文本消息写入 PTY stdin |
| 状态保持   | 无状态（每次调用独立）               | 有状态（PTY 进程持续运行） |
| 上下文容量 | 由 LLM 上下文窗口限制                | 由 CLI 工具内部实现决定    |

**核心挑战**：

1. **输入混淆**：直接将上下文文本写入 PTY stdin，CLI 会把它当作用户的键盘输入来处理
2. **命令误执行**：上下文中包含类似命令的文本（如 `git status`），CLI 可能错误执行
3. **上下文过长**：群聊历史消息很多时，可能导致上下文超出 CLI 处理能力
4. **状态保持**：CLI 进程持续运行，需要区分"首次交互"和"后续交互"

### 1.2 上下文管理目标

1. **安全注入**：上下文消息被 CLI 识别为元信息，不会误执行
2. **身份明确**：CLI 清楚知道自己在群聊中的身份和角色
3. **高效传输**：避免重复传输已知的上下文，利用 CLI 的状态保持能力
4. **可控截断**：防止上下文过长导致性能问题

---

## 2. 上下文消息格式

### 2.1 核心原则

1. **明确身份**：告诉 CLI "你是谁"以及"你的角色"
2. **区分上下文与输入**：使用分隔线和注释标记，避免 CLI 把上下文当作用户输入执行
3. **结构清晰**：系统信息、历史记录、实际请求分区明确

### 2.2 为什么必须使用注释标记

直接将上下文文本写入 PTY stdin，CLI 会把它当作用户的键盘输入来处理。如果上下文中包含类似命令的文本（如 `git status`、`npm install`），CLI 可能会错误地执行这些内容。

**解决方案**：用注释语法包裹上下文，让 CLI 知道"这些是元信息，不需要执行"。

### 2.3 注释语法选择

不同 CLI 的注释语法可能不同，需要根据目标 CLI 选择：

| CLI 工具    | 注释语法                   | 示例                    |
| ----------- | -------------------------- | ----------------------- |
| Claude Code | 支持 Markdown/自然语言分隔 | `---` 分隔线 + 文字说明 |
| OpenCode    | 支持 `#` 注释              | `# 这是注释`            |
| 通用 Shell  | 支持 `#` 注释              | `# 这是注释`            |
| 自定义 CLI  | 由配置指定                 | `commentPrefix: "#"`    |

### 2.4 推荐格式（兼容性最好）

```
# ================================================================================
# 系统上下文（这是群聊环境信息，非用户输入，请勿执行）
# ================================================================================

# 你的身份：${displayName}（${displayEmoji} CLI Agent）
# 你的角色：${displayRole}

# 群聊信息：
# - 群名：项目开发组
# - 成员：architect（架构师）、${displayName}（你）、opencode（代码审查）
# - 公告：使用 React + Express 技术栈

# 最近对话（仅供参考）：
# > architect: 我来设计 JWT 认证方案
# > architect: @${displayName} 请实现后端 API
# > ${displayName}: 收到，开始实现...

# ================================================================================
# 用户请求（以下是实际需要处理的输入）
# ================================================================================

请继续完成认证 API 的实现

# ================================================================================
```

> **注**：`${displayName}`、`${displayEmoji}`、`${displayRole}` 为动态填充变量，来源见 [9.3 身份与角色数据来源](#93-身份与角色数据来源)。

### 2.5 格式元素说明

| 元素                       | 作用                                            |
| -------------------------- | ----------------------------------------------- |
| 分隔线 `# ====...`         | 视觉分隔，CLI 能识别区块边界                    |
| "系统上下文（非用户输入）" | 明确告诉 CLI 这不是需要执行的输入               |
| "你的身份"                 | CLI 知道自己在群聊中的名字（用于识别 @mention） |
| "你的角色"                 | CLI 知道自己的职责定位（影响响应风格和决策）    |
| 成员列表含角色             | CLI 知道其他成员是谁、各自负责什么              |
| "用户请求" 区块            | 唯一需要 CLI 处理的实际输入                     |

---

## 3. 交互模式：首次 vs 后续

### 3.1 概念

CLI 进程持续运行（PTY 保持活跃），CLI 可以"看到"之前的对话历史。因此后续交互不需要重复发送完整上下文，但仍需**定期提醒角色信息**，避免 CLI 在长对话中"遗忘"自己的身份。

### 3.2 交互类型

| 交互类型       | 发送内容              | 说明                                         |
| -------------- | --------------------- | -------------------------------------------- |
| 首次 @mention  | 完整上下文            | 身份 + 角色 + 成员 + 完整历史对话 + 当前请求 |
| 后续 @mention  | 增量上下文            | 仅新消息 + 当前请求                          |
| 定期角色提醒   | 增量上下文 + 角色提醒 | 每隔 N 次交互发送一次角色提醒                |
| CLI 重启后首次 | 完整上下文            | 视为新的首次交互                             |

### 3.3 角色提醒间隔策略

**为什么不是每次都提醒**：

- 如果 CLI 状态保持良好，频繁提醒是冗余的
- 减少上下文长度，提高效率
- 但仍需定期提醒以防止 CLI 在长对话中遗忘身份

**间隔配置**：

| 参数                   | 默认值 | 说明                                            |
| ---------------------- | ------ | ----------------------------------------------- |
| `roleReminderInterval` | 5      | 每隔 N 次交互提醒一次角色（首次交互不计入计数） |

**实现逻辑**：

```typescript
// PTY 状态中记录交互次数
type BridgePtyState = {
  // ...其他字段
  interactionCount: number; // 交互计数器
  lastRoleReminderAt: number; // 上次角色提醒时的交互次数
};

// 判断是否需要发送角色提醒
function shouldSendRoleReminder(ptyState: BridgePtyState, interval: number): boolean {
  return ptyState.interactionCount - ptyState.lastRoleReminderAt >= interval;
}
```

### 3.4 首次交互格式

首次交互时，系统会**读取** `PERSONALITY.md`、`SOUL.md`、`AGENTS.md` 三个文件的内容并注入：

```
# ================================================================================
# 核心文件内容（定义你的性格、行为准则和项目规范）
# ================================================================================

# ─── PERSONALITY.md — 你的性格 ───
# 路径：{stateDir}/cli-agents/{agentId}/PERSONALITY.md

# [PERSONALITY.md 文件内容，每行以 # 开头]
# 例如：
# # 性格：严谨架构师
#
# ## 思维方式
# - 关注系统长期演进
# - 优先考虑可维护性
# ...

# ─── SOUL.md — 你的灵魂 ───
# 路径：{stateDir}/cli-agents/{agentId}/SOUL.md

# [SOUL.md 文件内容，每行以 # 开头]
# 例如：
# # SOUL.md - 工程师之魂
#
# ## 编码原则
# - 写出可以工作的代码
# - 保持简洁
# ...

# ─── AGENTS.md — 项目指南 ───
# 路径：{stateDir}/cli-agents/{agentId}/AGENTS.md

# [AGENTS.md 文件内容，每行以 # 开头]
# 例如：
# # CLI Agent: CodeBuddy
#
# ## 行为指引
# - 收到群聊消息时，理解上下文后执行相应工作
# ...

# ================================================================================
# 系统上下文（这是群聊环境信息，非用户输入，请勿执行）
# ================================================================================

# 你的身份：${displayName}（${displayEmoji} CLI Agent）
# 你的角色：${displayRole}

# 群聊信息：
# - 群名：项目开发组
# - 成员：architect（架构师）、${displayName}（你）、opencode（代码审查）
# - 公告：使用 React + Express 技术栈

# 最近对话（仅供参考）：
# > architect: 我来设计 JWT 认证方案
# > architect: @${displayName} 请实现后端 API
# > ${displayName}: 收到，开始实现...

# ================================================================================
# 用户请求（以下是实际需要处理的输入）
# ================================================================================

请继续完成认证 API 的实现

# ================================================================================
```

### 3.5 后续交互格式（增量上下文）

后续交互分为两种情况：**普通增量**和**带角色提醒的增量**。

**重要**：后续每次对话都会注入核心文件**路径说明**（不读取内容），提醒 CLI 这些文件的位置。

#### 3.5.1 普通增量（未达到提醒间隔）

```
# ================================================================================
# 核心文件路径（需要时可自行读取）
# ================================================================================

# ─── 身份与记忆 ───

# IDENTITY.md — 你是谁
# 路径：{stateDir}/cli-agents/{agentId}/IDENTITY.md

# PERSONALITY.md — 你的性格
# 路径：{stateDir}/cli-agents/{agentId}/PERSONALITY.md

# SOUL.md — 你的灵魂
# 路径：{stateDir}/cli-agents/{agentId}/SOUL.md

# ─── 项目与工具 ───

# AGENTS.md — 项目指南
# 路径：{stateDir}/cli-agents/{agentId}/AGENTS.md

# TOOLS.md — 工具与环境笔记
# 路径：{stateDir}/cli-agents/{agentId}/TOOLS.md

# ================================================================================
# 增量上下文（自上次交互以来的新消息）
# ================================================================================

# 新增对话：
# > architect: API 结构需要调整
# > architect: @claude-code 请修改路由层

# ================================================================================
# 用户请求（以下是实际需要处理的输入）
# ================================================================================

好的，我来修改路由层

# ================================================================================
```

#### 3.5.2 带角色提醒的增量（达到提醒间隔）

```
# ================================================================================
# 核心文件路径（需要时可自行读取）
# ================================================================================

# ─── 身份与记忆 ───

# IDENTITY.md — 你是谁
# 路径：{stateDir}/cli-agents/{agentId}/IDENTITY.md

# PERSONALITY.md — 你的性格
# 路径：{stateDir}/cli-agents/{agentId}/PERSONALITY.md

# SOUL.md — 你的灵魂
# 路径：{stateDir}/cli-agents/{agentId}/SOUL.md

# ─── 项目与工具 ───

# AGENTS.md — 项目指南
# 路径：{stateDir}/cli-agents/{agentId}/AGENTS.md

# TOOLS.md — 工具与环境笔记
# 路径：{stateDir}/cli-agents/{agentId}/TOOLS.md

# ================================================================================
# 角色提醒（请保持角色一致性）
# ================================================================================

# 你的身份：${displayName}（${displayEmoji} CLI Agent）
# 你的角色：${displayRole}

# ================================================================================
# 增量上下文（自上次交互以来的新消息）
# ================================================================================

# 新增对话：
# > architect: API 结构需要调整
# > architect: @${displayName} 请修改路由层

# ================================================================================
# 用户请求（以下是实际需要处理的输入）
# ================================================================================

好的，我来修改路由层

# ================================================================================
```

### 3.6 为什么采用间隔提醒策略

| 策略         | 优点               | 缺点                       |
| ------------ | ------------------ | -------------------------- |
| 每次都提醒   | 确保角色一致性     | 冗余信息多，增加上下文长度 |
| 从不提醒     | 上下文简洁         | 长对话可能遗忘身份         |
| **间隔提醒** | 平衡简洁性与一致性 | 需要额外配置参数           |

**间隔提醒的优势**：

1. **减少冗余**：如果 CLI 状态保持良好，不需要频繁提醒
2. **保持一致性**：定期提醒防止长对话中遗忘身份
3. **可配置**：根据不同 CLI 的行为特点调整间隔

---

## 4. 上下文截断策略

### 4.1 问题

首次 @mention 时传输"完整上下文"，如果群聊历史消息很多，可能导致上下文过长，超出 CLI 处理能力或导致性能问题。

### 4.2 截断参数

| 参数         | 默认值     | 说明                            |
| ------------ | ---------- | ------------------------------- |
| 最大消息数   | 30 条      | 最多传输最近 N 条消息           |
| 最大字符数   | 50,000     | 上下文总字符数上限              |
| 单条消息截断 | 2,000 字符 | 超长消息截断并添加 `[...]` 标记 |

### 4.3 截断优先级

1. **优先保留最近消息**：从最新的消息开始，向前截取
2. **优先保留 @mention 消息**：包含 CLI Agent @mention 的消息优先级更高
3. **系统消息可选**：系统消息（如成员加入/退出）可省略

### 4.4 截断提示格式

```
# ================================================================================
# 历史对话（最近 30 条，已省略更早的消息）
# ================================================================================

# > [省略了 15 条更早的消息]
# > architect: 我来设计 JWT 认证方案
# > architect: @claude-code 请实现后端 API
# ...
```

---

## 5. 群聊级上下文配置

### 5.1 配置参数

Owner 可在群聊设置中调整上下文数量上限：

```typescript
// 群聊配置扩展
export type GroupConfig = {
  id: string;
  name: string;
  announcement?: string;
  members: GroupMember[];
  project?: {
    directory?: string;
    docs?: string[];
  };
  // 上下文配置
  contextConfig?: {
    maxMessages?: number; // 最大消息数，默认 30
    maxCharacters?: number; // 最大字符数，默认 50,000
    includeSystemMessages?: boolean; // 是否包含系统消息，默认 false
    roleReminderInterval?: number; // 角色提醒间隔，默认 5（每 5 次交互提醒一次）
  };
};
```

### 5.2 配置校验

| 参数                   | 最小值 | 最大值  | 默认值 |
| ---------------------- | ------ | ------- | ------ |
| `maxMessages`          | 5      | 100     | 30     |
| `maxCharacters`        | 10,000 | 200,000 | 50,000 |
| `roleReminderInterval` | 1      | 20      | 5      |

### 5.3 前端配置 UI

```
┌──────────────────────────────────────┐
│ 群聊设置                              │
│                                      │
│ ─── 上下文配置 ───                    │
│                                      │
│ 最大消息数：   [30    ] 条           │
│              CLI Agent 被触发时最多   │
│              获取的历史消息数量        │
│                                      │
│ 最大字符数：   [50000 ] 字符         │
│              防止上下文过长           │
│                                      │
│ 包含系统消息： [ ]                   │
│              是否将成员加入/退出等    │
│              系统消息包含在上下文中    │
│                                      │
│ [保存修改]                           │
└──────────────────────────────────────┘
```

---

## 6. 项目上下文注入

### 6.1 项目说明文档

**用途**：让 CLI Agent 更好地了解项目上下文，提高协作质量。

**工作方式**：

- 群聊配置中指定文档路径（如 `README.md`、`ARCHITECTURE.md`、`docs/guide.md`）
- 支持配置**多个文档路径**
- CLI Agent 被触发时，系统自动将项目说明文档内容注入到上下文中
- CLI Agent 可以根据文档中的信息理解项目结构、技术栈、编码规范等

**支持的文档格式**：

- Markdown (`.md`)
- 纯文本 (`.txt`)
- 其他可读文本文件

### 6.2 项目说明文档注入格式

```
# ================================================================================
# 项目上下文（这是项目背景信息，非用户输入）
# ================================================================================

# 项目说明文档：README.md
# ────────────────────────────────────────────────────────────────────────────────

# [README.md 内容]

# 项目说明文档：ARCHITECTURE.md
# ────────────────────────────────────────────────────────────────────────────────

# [ARCHITECTURE.md 内容]

# ================================================================================
```

### 6.3 项目目录与 CLI 启动目录

**核心原则**：群聊项目目录**不覆盖** Agent 管理页面配置的工作空间配置本身，但**会影响 CLI Agent 的启动目录**。

**优先级**：

| 配置           | 来源           | 作用                              | 优先级                         |
| -------------- | -------------- | --------------------------------- | ------------------------------ |
| 群聊项目目录   | 群聊设置       | CLI 启动时的 `cwd` + 产出文件目录 | 高（设置后优先使用）           |
| Agent 工作空间 | Agent 管理页面 | CLI 启动时的 `cwd`（回退值）      | 低（群聊未设置项目目录时使用） |

### 6.4 核心 Agent 文件注入策略

**核心文件存储位置**：CLI Agent 的核心文件存储在**身份文件存储目录**，这是一个固定位置：

```
{stateDir}/cli-agents/{agentId}/
```

由 `resolveCliAgentIdentityDir(agentId)` 函数解析，与 CLI Agent 配置的工作目录 (`cwd`) 无关。

#### 6.4.1 注入策略概览

| 交互类型         | 注入内容                                                                                             | 说明                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **首次启动**     | ① 读取并注入 `PERSONALITY.md`、`SOUL.md`、`AGENTS.md` **文件内容**<br>② 注入所有核心文件**路径说明** | 让 CLI 立即了解自己的性格、行为准则和项目规范，并知道所有核心文件的位置 |
| **后续每次对话** | 注入核心文件**路径说明**（不读取内容）                                                               | 提醒 CLI 这些文件的位置，需要时可自行读取                               |

#### 6.4.2 首次启动：文件内容注入

首次交互时，系统会：

1. **读取并注入**以下三个文件的内容
2. **同时注入**所有核心文件的路径说明（见 6.4.3 节）

| 文件             | 注入内容 | 作用                                     |
| ---------------- | -------- | ---------------------------------------- |
| `PERSONALITY.md` | 文件内容 | 性格定义（思维方式、沟通风格、决策倾向） |
| `SOUL.md`        | 文件内容 | 行为准则与核心价值观                     |
| `AGENTS.md`      | 文件内容 | 项目规范与开发指南                       |

**注入格式**：

```
# ================================================================================
# 核心文件内容（定义你的性格、行为准则和项目规范）
# ================================================================================

# ─── PERSONALITY.md — 你的性格 ───
# 路径：{stateDir}/cli-agents/{agentId}/PERSONALITY.md

[PERSONALITY.md 文件内容]

# ─── SOUL.md — 你的灵魂 ───
# 路径：{stateDir}/cli-agents/{agentId}/SOUL.md

[SOUL.md 文件内容]

# ─── AGENTS.md — 项目指南 ───
# 路径：{stateDir}/cli-agents/{agentId}/AGENTS.md

[AGENTS.md 文件内容]

# ================================================================================

[紧接着注入 6.4.3 节的路径说明]
```

**注意**：`IDENTITY.md` 和 `TOOLS.md` 不在首次注入时读取内容，原因如下：

- `IDENTITY.md`：身份信息已通过系统上下文中的"你的身份"字段提供
- `TOOLS.md`：环境特定配置，CLI 可根据需要自行读取

#### 6.4.3 核心文件路径说明注入

首次启动和后续每次对话时，系统都会注入核心文件的**路径说明**（不读取文件内容），提醒 CLI 这些文件的位置：

```
# ================================================================================
# 核心文件路径（需要时可自行读取）
# ================================================================================

# ─── 身份与记忆 ───

# IDENTITY.md — 你是谁
# 路径：{stateDir}/cli-agents/{agentId}/IDENTITY.md

# PERSONALITY.md — 你的性格
# 路径：{stateDir}/cli-agents/{agentId}/PERSONALITY.md

# SOUL.md — 你的灵魂
# 路径：{stateDir}/cli-agents/{agentId}/SOUL.md

# ─── 项目与工具 ───

# AGENTS.md — 项目指南
# 路径：{stateDir}/cli-agents/{agentId}/AGENTS.md

# TOOLS.md — 工具与环境笔记
# 路径：{stateDir}/cli-agents/{agentId}/TOOLS.md

# ================================================================================
```

#### 6.4.4 文件作用总结

| 文件             | 路径变量                                         | 核心作用                     | 首次注入 | 后续注入 |
| ---------------- | ------------------------------------------------ | ---------------------------- | -------- | -------- |
| `IDENTITY.md`    | `{stateDir}/cli-agents/{agentId}/IDENTITY.md`    | 身份定义（名称、类型、风格） | 路径     | 路径     |
| `PERSONALITY.md` | `{stateDir}/cli-agents/{agentId}/PERSONALITY.md` | 性格定义（思维方式、风格）   | **内容** | 路径     |
| `SOUL.md`        | `{stateDir}/cli-agents/{agentId}/SOUL.md`        | 行为准则与核心价值观         | **内容** | 路径     |
| `AGENTS.md`      | `{stateDir}/cli-agents/{agentId}/AGENTS.md`      | 项目规范与开发指南           | **内容** | 路径     |
| `TOOLS.md`       | `{stateDir}/cli-agents/{agentId}/TOOLS.md`       | 环境特定配置与设备信息       | 路径     | 路径     |

#### 6.4.5 设计考量

**为什么首次注入文件内容**：

- CLI Agent 启动时需要立即了解自己的性格、行为准则和项目规范
- 避免首次交互时 CLI 还需要额外读取文件才能开始工作
- 提供完整的上下文，让 CLI 能够正确理解自己的角色定位

**为什么后续只注入路径**：

- 文件内容已在首次注入，CLI 已知晓
- 减少上下文长度，提高效率
- 提供路径提醒，CLI 可在需要时自行读取最新内容

---

## 7. CLI 行为类型

### 7.1 CLI 行为假设

| CLI 行为类型 | 说明                                       | 上下文策略   |
| ------------ | ------------------------------------------ | ------------ |
| 状态保持型   | CLI 维护内部对话历史，stdin 输入追加到历史 | 增量上下文   |
| 无状态型     | CLI 只处理当前输入，不维护历史             | 完整上下文   |
| 混合型       | CLI 有短期记忆但会遗忘                     | 需要测试确定 |

> **注**：当前实现默认使用增量上下文模式，因为大多数现代 CLI 工具（如 Claude Code、CodeBuddy）都支持状态保持。

---

## 8. 实现要点

### 8.1 上下文消息构建位置

上下文消息在 `bridge-trigger.ts` 中构建，由 `triggerBridgeAgent()` 函数调用。

### 8.2 增量上下文实现

```typescript
// 在 bridge-pty.ts 中记录最后一次交互的 transcript 索引和交互计数
type BridgePtyState = {
  lastTranscriptIndex: number;     // 最后一次交互的 transcript 索引
  interactionCount: number;        // 交互计数器（首次交互后开始计数）
  lastRoleReminderAt: number;      // 上次角色提醒时的交互次数
  isFirstInteraction: boolean;     // 是否首次交互
};

// 后续触发时，只提取该索引之后的新消息
function getIncrementalMessages(
  transcript: TranscriptMessage[],
  lastIndex: number,
): TranscriptMessage[] {
  return transcript.slice(lastIndex + 1);
}

// 判断是否需要发送角色提醒
function shouldSendRoleReminder(
  ptyState: BridgePtyState,
  interval: number, // 默认 5
): boolean {
  if (ptyState.isFirstInteraction) {
    return false; // 首次交互已包含角色信息，无需额外提醒
  }
  return ptyState.interactionCount - ptyState.lastRoleReminderAt >= interval;
}
}
```

### 8.3 CLI 重启检测

如果 CLI 进程重启（崩溃恢复），重置为"首次交互"模式：

```typescript
function handlePtyRestart(groupId: string, agentId: string): void {
  // 重置状态
  ptyStates.set(`${groupId}:${agentId}`, {
    lastTranscriptIndex: 0,
    interactionCount: 0,
    lastRoleReminderAt: 0,
    isFirstInteraction: true,
  });
}
```

---

## 9. 上下文注入流程

### 9.1 完整流程

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
triggerBridgeAgent(params, member.bridge)
    │
    ├── 1. 确保 PTY 进程运行
    │      检查是否有活跃的 PTY(groupId, agentId)
    │      ├── 有 → 复用
    │      └── 无 → 创建新 PTY
    │
    ├── 2. 构建上下文消息
    │      buildCliContextMessage()
    │      ├── 判断首次/后续交互
    │      ├── 获取群公告
    │      ├── 获取项目说明文档内容
    │      ├── 获取历史消息（完整/增量）
    │      ├── 应用截断策略
    │      └── 格式化为注释包裹的消息
    │
    ├── 3. 写入 PTY stdin
    │      pty.write(contextMessage + "\n")
    │
    ├── 4. 实时推送终端数据
    │      pty.onData → group.terminal 事件
    │
    ├── 5. 完成检测
    │      空闲 8 秒无输出 → 判定完成
    │
    └── 6. 纯文本提取 + 消息广播
           从终端缓冲区提取文本
           group.stream final → 纯文本消息
           appendGroupMessage() → 持久化
```

### 9.2 上下文构建函数

```typescript
async function buildCliContextMessage(params: {
  meta: GroupSessionEntry;
  groupId: string;
  agentId: string;
  transcriptSnapshot: GroupChatMessage[];
  isFirstInteraction: boolean;
  bridgeConfig: BridgeConfig;
}): Promise<{ contextMessage: string; requestContent: string; roleReminderSent: boolean }> {
  const {
    meta,
    groupId,
    agentId,
    transcriptSnapshot,
    isFirstInteraction,
    bridgeConfig, // ← CLI Agent 配置（包含 name、emoji 等）
  } = params;

  const member = meta.members.find((m) => m.agentId === agentId);

  // ─── 身份信息动态填充 ───
  // 显示名称优先级：bridgeConfig.name > member.agentName > agentId
  const displayName = bridgeConfig.name ?? member?.agentName ?? agentId;
  // 显示 emoji：bridgeConfig.emoji 或默认值
  const displayEmoji = bridgeConfig.emoji ?? "🔧";
  // 角色描述：member.rolePrompt 或默认值
  const displayRole = member?.rolePrompt ?? "协作成员";

  // 判断首次/后续交互
  // ...

  if (isFirstInteraction) {
    sections.push(
      "# ================================================================================",
      "# 系统上下文（这是群聊环境信息，非用户输入，请勿执行）",
      "# ================================================================================",
      "",
      `# 你的身份：${displayName}（${displayEmoji} CLI Agent）`,
      `# 你的角色：${displayRole}`,
      "",
      "# 群聊信息：",
      `# - 群名：${meta.groupName ?? meta.groupId}`,
      // ...
    );
  }
  // ...
}
```

### 9.3 身份与角色数据来源

| 字段           | 来源                 | 优先级    | 说明                            |
| -------------- | -------------------- | --------- | ------------------------------- |
| `displayName`  | `bridgeConfig.name`  | 1（最高） | CLI Agent 注册时配置的名称      |
|                | `member.agentName`   | 2         | 群聊成员配置中的名称            |
|                | `agentId`            | 3（最低） | 兜底值，使用系统标识符          |
| `displayEmoji` | `bridgeConfig.emoji` | 1         | CLI Agent 配置的 emoji          |
|                | `"🔧"`               | 2         | 默认值                          |
| `displayRole`  | `member.rolePrompt`  | 1         | 群聊中为该 Agent 设置的角色描述 |
|                | `"协作成员"`         | 2         | 默认值                          |

**数据流**：

```
cli-agents/bridge.json
├── CliAgentEntry { id, name, emoji, type, command, ... }
│
↓ resolveBridgeForMember() [group.ts]
│
├── BridgeConfig { name, emoji, type, command, ... }  ← 需保留 name/emoji
│
↓ 存储到 GroupMember.bridge
│
├── buildCliContextMessage()
│
└── "你的身份：${bridgeConfig.name}（${bridgeConfig.emoji} CLI Agent）"
```

### 9.4 BridgeConfig 类型定义

`BridgeConfig` 必须包含 `name` 和 `emoji` 字段：

```typescript
// src/group-chat/bridge-types.ts
export type BridgeConfig = {
  /** CLI Agent 显示名称（来自 cli-agents/bridge.json） */
  name?: string;
  /** CLI Agent emoji 图标 */
  emoji?: string;
  /** CLI 工具类型 */
  type: CliType;
  /** CLI 启动命令 */
  command: string;
  /** CLI 启动参数 */
  args?: string[];
  /** 工作目录 */
  cwd?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 单次回复超时（毫秒） */
  timeout?: number;
  /** 尾部修剪标记正则 */
  tailTrimMarker?: string;
};
```

### 9.5 数据转换：CliAgentEntry → BridgeConfig

在将 CLI Agent 加入群聊时，需要保留 `name` 和 `emoji`：

```typescript
// src/gateway/server-methods/group.ts
function resolveBridgeForMember(member: {
  agentId: string;
  bridge?: BridgeConfig;
}): BridgeConfig | undefined {
  if (member.bridge) {
    return member.bridge;
  }
  const cliEntry = findCliAgentEntry(member.agentId);
  if (!cliEntry) {
    return undefined;
  }
  return {
    name: cliEntry.name, // ← 必须保留
    emoji: cliEntry.emoji, // ← 必须保留
    type: cliEntry.type,
    command: cliEntry.command,
    args: cliEntry.args,
    cwd: cliEntry.cwd,
    env: cliEntry.env,
    timeout: cliEntry.timeout,
    tailTrimMarker: cliEntry.tailTrimMarker,
  };
}
```

---

## 10. 关联文档

- [CLI Agent 管理](./cli-agent-management.md) — CLI Agent 独立存储、独立工作空间、网关 API
- [前端组件设计](./frontend-components.md) — 终端组件、双通道输出、完成检测
- [技术实现](./implementation.md) — 文件清单、模块设计、实施阶段
