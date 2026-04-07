# 项目级记忆文件

> 本文档定义群聊的项目级记忆文件机制，包括共享记忆、Agent 专属记忆、助理 Agent 合并机制、上下文注入、提示词设计、前端记忆管理 UI 和群聊解散时的记忆整理流程。

## 1. 概述

### 1.1 背景

当前 CLI Agent 的上下文管理（见 [CLI Agent 上下文](./cli-agent-context.md)）将身份文件存储在 `{stateDir}/cli-agents/{agentId}/` 下，描述的是 **Agent 自身**的身份和性格。

但在群聊协作中，CLI Agent 还需要一种机制来存储和回忆**项目级知识**——架构决策、编码约定、踩过的坑、当前工作进度等。这些知识应该**跟随项目**而非跟随 Agent。

### 1.2 两种模式

| 模式             | 条件                                | 记忆存储位置                          | 特点                                                  |
| ---------------- | ----------------------------------- | ------------------------------------- | ----------------------------------------------------- |
| **项目记忆模式** | 群聊关联了项目（`projectDir` 存在） | `{projectDir}/.openclaw/{groupName}/` | 完整记忆系统，支持共享+专属                           |
| **临时记忆模式** | 群聊未关联项目                      | `{stateDir}/group-memory/{groupId}/`  | 仅启用 Agent 专属记忆，无共享记忆，群聊解散时全部清理 |

### 1.3 核心设计

在记忆目录下维护两类记忆文件：

| 类型           | 文件           | 读写权限                           | 用途                      |
| -------------- | -------------- | ---------------------------------- | ------------------------- |
| 共享永久记忆   | `MEMORY.md`    | 仅助理 Agent 读写，其他 Agent 只读 | 项目级长期知识            |
| 共享临时记忆   | `SESSION.md`   | 仅助理 Agent 读写，其他 Agent 只读 | 当前会话上下文            |
| Agent 专属记忆 | `{agentId}.md` | 仅对应 Agent 读写                  | Agent 自己的临时/永久记忆 |

> **注**：临时记忆模式下不创建 `MEMORY.md` 和 `SESSION.md`，仅创建 Agent 专属记忆文件。

### 1.4 核心设计原则

1. **跟随项目**：项目记忆文件存在于项目目录下，与代码同仓库
2. **按群隔离**：每个群聊在 `.openclaw/` 下有独立的子目录（以群名称命名），多群聊关联同一项目时互不干扰
3. **各自写各自的文件**：每个 Agent 只写自己的专属文件，助理 Agent 只写两个共享文件，**冲突从结构上消除**
4. **助理 Agent 是记忆管理者**：负责汇总合并各 Agent 的记忆到共享文件，其他 Agent 不修改共享文件
5. **Agent 自主判断**：Agent 自己决定是否需要记住什么，但内容必须简短、关键
6. **惰性去重**：Agent 不需要主动读取共享文件来做去重。只有在正常工作中恰好读到共享文件内容时，发现自己的记忆已被包含且共享文件中的内容不比自己的更粗略，才清理自己的重复条目
7. **共享记忆简短原则**：共享记忆中的内容应保持高度概括和精炼。如果 Agent 专属记忆中有更详细的版本，Agent 应保留自己的详细版本，不做去重

---

## 2. 文件设计

### 2.1 目录结构

#### 2.1.1 项目记忆模式（关联项目）

```
{projectDir}/
├── .openclaw/                    # OpenClaw 项目配置目录
│   ├── 项目开发组/               # 群名称作为子目录
│   │   ├── MEMORY.md             # 共享永久记忆（仅助理 Agent 可写）
│   │   ├── SESSION.md            # 共享临时记忆（仅助理 Agent 可写）
│   │   ├── claude-code.md        # claude-code 专属记忆
│   │   └── opencode.md           # opencode 专属记忆
│   ├── 前端小组/                 # 另一个群聊
│   │   ├── MEMORY.md
│   │   ├── SESSION.md
│   │   └── codebuddy.md
│   └── MEMORY.md                 # 项目级共享记忆（跨群聊提取，见 §6.5）
├── src/
├── docs/
└── ...
```

> **`.gitignore` 建议**：
>
> ```gitignore
> # OpenClaw 群聊记忆
> .openclaw/*/SESSION.md
> .openclaw/*/*.md
> !.openclaw/*/MEMORY.md
> !.openclaw/MEMORY.md
> ```
>
> 即：`MEMORY.md` 不加入 `.gitignore`（可提交到 Git 共享给团队），其他文件加入 `.gitignore`。

#### 2.1.2 临时记忆模式（未关联项目）

```
{stateDir}/group-memory/{groupId}/
├── claude-code.md                # Agent 专属记忆
└── opencode.md                   # Agent 专属记忆
```

> 临时记忆模式下没有 `MEMORY.md` 和 `SESSION.md`。群聊解散时整个目录删除。

### 2.2 共享永久记忆 `MEMORY.md`

**用途**：存储与项目相关的长期知识，跨会话共享。

**写入权限**：仅助理 Agent（bridge-assistant）可写。其他 CLI Agent 只读。

**内容要求**：

- 只记录**与项目相关**的关键信息，与本次对话无关
- 内容简短精炼，避免冗余
- 去重：不重复记录已存在的信息

**典型内容**：

```markdown
# Project Memory

## 架构决策

- JWT 认证，token 24h，refresh token 7d
- PostgreSQL + Prisma
- 三层架构：Controller → Service → Repository

## 代码结构

- 认证模块：src/auth/（JWT 生成/验证、OAuth 回调）
- API 路由注册：src/routes/index.ts，按 v1/v2 分目录
- 中间件：src/middleware/（auth、rateLimit、errorHandler）
- 数据库模型：prisma/schema.prisma，迁移在 prisma/migrations/
- 定时任务：src/scheduler.ts（基于 node-cron）

## 编码约定

- API 路由放 `src/routes/`，异步函数必须有 try-catch
- 使用 pino 日志

## 踩坑记录

- Prisma findMany 的 skip 不支持超过 100000
- Alpine Linux 下 node-pty 需额外 build deps

## 项目知识

- React 19 + TypeScript / Express 4.x / Docker Compose

## 其他
```

### 2.3 共享临时记忆 `SESSION.md`

**用途**：存储当前会话的整体上下文，帮助所有 Agent 了解全局进展。

**写入权限**：仅助理 Agent 可写（在汇总时更新）。其他 CLI Agent 只读。

**内容要求**：

- 当前正在做什么、进度如何、结果如何
- 待确认事项、临时约定
- 内容简短，只记关键信息

**典型内容**：

```markdown
# Session Notes

## 当前任务

- 实现 JWT token 刷新功能

## 进展

- 后端: refresh 端点已完成，待联调
- 前端: 拦截器已完成，等待后端

## 待确认

- refresh token 存 httpOnly cookie 还是 localStorage？

## 未完成

- token 黑名单机制
- 单元测试

## 其他
```

### 2.4 Agent 专属记忆 `{agentId}.md`

**用途**：每个 CLI Agent 自己的临时和永久记忆，记录该 Agent 认为需要记住的关键信息。

**写入权限**：仅对应 Agent 可读写。其他 Agent 和助理 Agent **不修改**此文件。

**内容要求**：

- Agent 自主判断是否需要记住
- 内容必须简短，只记关键信息
- 分为永久记忆和临时记忆两个部分

**典型内容**（`claude-code.md`）：

```markdown
# claude-code Memory

## Permanent

- auth 模块 JWT secret 通过环境变量 AUTH_SECRET 注入
- Prisma SQLite 下不支持 enum，改用 string 类型
- refresh token 逻辑在 src/auth/refresh.ts，依赖 src/auth/jwt.ts 的 verifyToken()
- 数据库连接池配置在 src/config/database.ts，默认 pool_size=10
- src/utils/retry.ts 提供统一重试逻辑（指数退避，最多 3 次）

## Session

- 正在实现 /api/v2/auth/refresh
- 需要 architect 确认 refresh token 存储方案
```

### 2.5 项目级共享记忆 `{projectDir}/.openclaw/MEMORY.md`

**用途**：跨群聊的项目级知识。当某个群聊解散时，助理 Agent 会将该群的共享记忆中有价值的部分提取到此文件。

**写入权限**：仅在群聊解散流程中，由助理 Agent 写入。

**典型内容**：

```markdown
# Project Memory（跨群聊）

## 架构决策

- JWT 认证，token 24h，refresh token 7d（来源：项目开发组）
- 前端使用 React 19 + Zustand（来源：前端小组）

## 踩坑记录

- Prisma findMany 的 skip 不支持超过 100000（来源：项目开发组）
```

### 2.6 与现有文件的职责边界

| 文件               | 位置                                      | 视角               | 示例                            |
| ------------------ | ----------------------------------------- | ------------------ | ------------------------------- |
| `IDENTITY.md`      | `{stateDir}/cli-agents/{agentId}/`        | Agent 身份         | "我是后端工程师"                |
| `PERSONALITY.md`   | `{stateDir}/cli-agents/{agentId}/`        | Agent 性格         | "严谨、关注可维护性"            |
| `AGENTS.md`        | `{stateDir}/cli-agents/{agentId}/`        | Agent 行为规范     | "收到消息时先理解上下文"        |
| `TOOLS.md`         | `{stateDir}/cli-agents/{agentId}/`        | 环境笔记           | "docker compose up 启动数据库"  |
| **`MEMORY.md`**    | **`{projectDir}/.openclaw/{groupName}/`** | **共享项目知识**   | **"本项目使用 JWT 认证"**       |
| **`SESSION.md`**   | **`{projectDir}/.openclaw/{groupName}/`** | **共享会话上下文** | **"正在实现 token 刷新"**       |
| **`{agentId}.md`** | **`{projectDir}/.openclaw/{groupName}/`** | **Agent 专属记忆** | **"我发现 Prisma 不支持 enum"** |

---

## 3. 读写权限模型

### 3.1 权限矩阵

| 文件           | CLI Agent          | 助理 Agent | 系统               |
| -------------- | ------------------ | ---------- | ------------------ |
| `MEMORY.md`    | 只读               | **读写**   | 读写（初始化模板） |
| `SESSION.md`   | 只读               | **读写**   | 读写（解散时清理） |
| `{agentId}.md` | **读写**（仅自己） | 只读       | 只读               |

### 3.2 为什么这样设计

1. **共享文件只有一个写者**：助理 Agent 是唯一的共享文件写者，不存在并发冲突
2. **Agent 专属文件只有一个写者**：每个 Agent 只写自己的文件，不存在并发冲突
3. **冲突从结构上消除**：不需要文件锁、分区标记或写入协议

---

## 4. 助理 Agent 合并机制

### 4.1 触发时机

助理 Agent 的汇总合并有两种触发方式：

1. **自动触发**：由现有的**发起者汇总机制**触发（见 [发起者汇总](../group-chat-initiator-summary.md)）。当群聊满足汇总条件时，汇总提示词中包含记忆合并指令
2. **手动触发**：用户在前端记忆管理面板点击"合并记忆"或"精简记忆"按钮，系统在群聊中自动 @助理 Agent 并给出相应指令（见 §6）

### 4.2 合并冷却（Cooldown）机制

频繁触发记忆合并会浪费 token（助理 Agent 每次都要读取所有记忆文件并推理）、产生无意义的空合并、甚至在并发情况下导致写冲突。因此引入冷却机制进行防护。

#### 4.2.1 冷却状态

在群聊状态中维护以下字段：

```typescript
interface MemoryMergeState {
  lastMergeAt: number | null; // 上次合并完成的时间戳（ms）
  lastMergeSource: "auto" | "manual-merge" | "manual-compact" | null; // 上次触发来源
  dirtyAfterMerge: boolean; // 上次合并后是否有 Agent 写入新记忆
  merging: boolean; // 是否正在执行合并
  mergingStartedAt: number | null; // 合并开始时间（用于超时保护）
}
```

#### 4.2.2 冷却规则

| 规则             | 说明                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **冷却期**       | 上次合并完成后 **5 分钟**内，拒绝新的合并请求（可配置）                                                                                             |
| **自动触发跳过** | 发起者汇总时，如果在冷却期内，跳过记忆合并指令。汇总的其他工作（如对话总结）不受影响                                                                |
| **手动触发排队** | 用户点击"合并记忆"/"精简记忆"按钮时，如果在冷却期内，前端弹出提示"距上次合并不到 X 分钟，是否强制执行？"，用户确认后才发送                          |
| **脏标记检查**   | 自动触发时额外检查 `dirtyAfterMerge`：如果上次合并后没有任何 Agent 写入过记忆文件，即使冷却期已过也跳过（无新内容，合并无意义）。手动触发不受此限制 |
| **并发锁**       | 如果一次合并正在进行中（助理 Agent 尚未完成），新的合并请求直接丢弃。通过 `merging` 标记实现                                                        |
| **合并超时保护** | 如果 `merging` 为 true 超过 **3 分钟**仍未完成，自动释放锁（`merging = false`）。防止助理 Agent PTY 崩溃或卡死导致锁永久占用                        |

#### 4.2.3 合并完成检测

系统如何知道助理 Agent 完成了合并？有两种互补机制：

1. **文件变更检测（主要）**：系统监听 `MEMORY.md` 和 `SESSION.md` 的文件变更（`fs.watch` 或 `mtime` 检查）。当助理 Agent 写入这两个文件后，视为合并完成。设置一个短暂的去抖动（2 秒），等待两个文件都写入完毕后标记完成
2. **回复检测（辅助）**：助理 Agent 在合并提示词中被要求完成后回复确认消息。系统检测到助理 Agent 的回复中包含"合并完成"/"精简完成"等关键词时，也标记完成
3. **超时兜底**：如果 3 分钟内以上两种机制都未触发，自动释放锁并记录警告日志

#### 4.2.4 冷却流程

```
收到合并请求（自动/手动）
    │
    ├── 检查 merging == true?
    │      └── 是 → 丢弃请求，提示"合并正在进行中"
    │
    ├── 检查冷却期（now - lastMergeAt < cooldown）?
    │      └── 是 →
    │           ├── 自动触发 → 静默跳过
    │           └── 手动触发 → 前端弹出确认"距上次合并不到 X 分钟"
    │                            ├── 用户确认 → 继续执行
    │                            └── 用户取消 → 丢弃
    │
    ├── 自动触发时额外检查 dirtyAfterMerge?
    │      └── false → 静默跳过（无新内容）
    │
    ├── 设置 merging = true
    ├── 执行合并（见 §4.3 合并流程）
    ├── 合并完成后：
    │      ├── merging = false
    │      ├── lastMergeAt = now
    │      ├── lastMergeSource = 触发来源
    │      └── dirtyAfterMerge = false（重置）
    └── done
```

#### 4.2.5 脏标记更新

当系统检测到任何 Agent 写入了其专属记忆文件 `{agentId}.md` 时，将 `dirtyAfterMerge` 设为 `true`。

检测方式有两种（任选其一）：

1. **文件监听（推荐）**：通过 `fs.watch` 监听记忆目录，当 `*.md` 文件（排除 `MEMORY.md` / `SESSION.md`）发生变更时触发
2. **惰性检查**：在自动触发合并前，比较各 Agent 记忆文件的 `mtime` 与 `lastMergeAt`

### 4.3 合并流程

```
助理 Agent 收到合并指令
    │
    ├── 1. 读取 MEMORY.md（当前共享永久记忆）
    ├── 2. 读取 SESSION.md（当前共享临时记忆）
    ├── 3. 扫描并读取当前群聊目录下所有 {agentId}.md 文件
    │
    ├── 4. 对比分析
    │      - 各 Agent 专属记忆中，哪些内容已在 MEMORY.md/SESSION.md 中
    │      - 哪些是新的、有价值的信息需要合并
    │      - 是否有过时或冗余的内容需要精简
    │
    ├── 5. 更新 MEMORY.md
    │      - 提取与项目相关的关键永久信息，追加或更新
    │      - 去重：不重复已有内容
    │      - 保持简短概括
    │      - 如果接近 50KB 上限，精简旧的、不再重要的条目
    │
    ├── 6. 更新 SESSION.md
    │      - 汇总当前会话进展、进度、待确认事项
    │      - 合并各 Agent 的临时记忆
    │      - 保持简短
    │
    └── 7. 不修改任何 {agentId}.md 文件
```

### 4.4 助理 Agent 合并提示词

> **注入方式**：合并提示词**由前端作为对话消息发送**（消息类型为系统指令，页面不显示给用户），不需要后端在上下文中注入。前端在发送时动态填充文件路径和 Agent 列表。

当触发合并时，前端发送以下消息（@助理 Agent），Agent 专属记忆文件列表由前端动态扫描目录获得：

```
# ================================================================================
# 记忆合并任务
# ================================================================================

# 你现在需要执行记忆合并。请按以下步骤操作：

# 1. 读取共享记忆文件：
#    - {memoryDir}/MEMORY.md（共享永久记忆）
#    - {memoryDir}/SESSION.md（共享临时记忆）

# 2. 读取所有 Agent 专属记忆文件：
{agentFileList}

# 3. 更新 MEMORY.md（共享永久记忆）：
#    - 从各 Agent 专属记忆的 Permanent 部分提取与项目相关的关键信息
#    - 只记录重要内容：架构决策、代码结构、编码约定、踩坑记录、项目知识
#    - 特别注意提取代码结构知识：关键模块路径、核心架构分层、重要文件职责
#      （这些信息能帮助所有 Agent 避免重复搜索代码库）
#    - 不要记录与项目无关的内容
#    - 去重：如果信息已存在于 MEMORY.md 中，跳过
#    - 保持内容简短概括，用一两句话总结关键点
#    - 如果文件大小接近 50KB，请精简旧的、不再重要的条目
#    - 注意：这是所有 Agent 共享的文件，信息对所有人可见

# 4. 更新 SESSION.md（共享临时记忆）：
#    - 汇总当前会话的进展：正在做什么、进度如何、结果如何
#    - 合并各 Agent 专属记忆的 Session 部分
#    - 整理待确认事项和临时约定
#    - 保持内容简短精炼

# 5. 不要修改任何 {agentId}.md 文件！
#    - 你只负责更新 MEMORY.md 和 SESSION.md
#    - 各 Agent 会自行管理自己文件中的内容
```

> `{agentFileList}` 由前端动态生成，扫描 `{memoryDir}/` 下的 `*.md` 文件，排除 `MEMORY.md` 和 `SESSION.md`，格式如：
>
> ```
> #    - {memoryDir}/claude-code.md
> #    - {memoryDir}/opencode.md
> ```

### 4.5 精简记忆提示词

> **注入方式**：同 §4.4，由前端作为对话消息发送（页面不显示）。

当用户点击"精简记忆"按钮时，前端发送以下消息（@助理 Agent）：

```
# ================================================================================
# 记忆精简任务
# ================================================================================

# 记忆文件占用空间较大，请帮忙精简。

# 1. 读取 {memoryDir}/MEMORY.md
# 2. 审查每一条记忆：
#    - 是否仍然有效？（已完成的任务、已废弃的决策可以删除）
#    - 是否有重复或冗余？（合并相似条目）
#    - 是否过于冗长？（用更简短的表述替代）
# 3. 重写 MEMORY.md，保持结构不变，精简内容
# 4. 同样审查并精简 {memoryDir}/SESSION.md
```

---

## 5. CLI Agent 提示词设计

### 5.1 记忆管理提示词（降频注入）

> **注入频率**：不需要每次对话都注入完整的记忆管理提示词。采用**降频注入**策略：PTY 启动时首次注入，之后每 **5 次交互**注入一次。在未注入的交互中，Agent 仍能正常工作（记忆文件路径和内容照常提供），只是缺少详细的写入规则提醒——但 Agent 在前几次交互中已经学会了规则。

在 `buildCliContextMessage()` 构建上下文时，按降频策略注入以下记忆管理指令。注入位置在群聊历史消息之前、用户请求之前。

```
# ================================================================================
# 项目记忆系统
# ================================================================================

# 你在群聊中有一个专属记忆文件，用于存储你认为需要记住的关键信息。
# 此外还有两个共享记忆文件，由助理 Agent 维护，所有 Agent 共享。

# 文件路径：
# - 你的专属记忆：{memoryDir}/{agentId}.md
# - 共享永久记忆：{memoryDir}/MEMORY.md（只读，不要修改）
# - 共享临时记忆：{memoryDir}/SESSION.md（只读，不要修改）

# ─── 写入规则 ───
#
# 1. 你只能写入自己的专属记忆文件 {agentId}.md，不能修改 MEMORY.md 和 SESSION.md
#
# 2. 以下情况应该记录到 Permanent 部分（与项目相关的长期知识）：
#    ✅ 发现了项目的 bug 或奇怪行为（如 "Prisma SQLite 下不支持 enum"）
#    ✅ 技术选型变化或架构决策（如 "从 REST 迁移到 GraphQL"）
#    ✅ 某个方案被否决及其原因（如 "Redis 缓存方案因成本放弃，改用本地缓存"）
#    ✅ 发现了未文档化的 API 行为或环境特性
#    ✅ 编码约定或团队规范的变更
#
# 3. 以下情况应该记录到 Session 部分（当前工作进展）：
#    ✅ 当前正在实现的功能及进度
#    ✅ 遇到的阻塞问题和待确认事项
#    ✅ 与其他 Agent 的协作约定
#
# 4. 以下情况不应该记录：
#    ❌ 执行了常规命令（如 npm install、git pull）
#    ❌ 读取了某个文件的内容
#    ❌ 中间调试步骤和临时尝试
#    ❌ 显而易见的项目信息（如 "项目使用 TypeScript"——README 已说明）
#
# 5. 写入前先读取文件现有内容，避免重复
# 6. 内容必须简短，每条记忆用一两句话概括关键信息
# 7. 使用简洁的 Markdown 格式，保持文件结构清晰

# ─── 代码知识记忆（开发项目重点） ───
#
# 如果你正在参与的是一个开发项目（有源代码目录），请特别注意记录以下代码相关知识。
# 这些记忆能帮助你（和其他 Agent）避免反复搜索代码库，显著提升工作效率：
#
# ✅ **关键代码路径**：核心模块/文件的位置和职责
#    例："认证逻辑在 src/auth/jwt.ts，中间件在 src/middleware/auth.ts"
#    例："API 路由统一注册在 src/routes/index.ts，按 v1/v2 分目录"
#
# ✅ **核心架构**：项目的整体架构模式和分层
#    例："三层架构：Controller(src/controllers) → Service(src/services) → Repository(src/repos)"
#    例："微服务通过 gRPC 通信，proto 定义在 proto/ 目录"
#
# ✅ **关键模块作用**：重要模块/类/函数的简要说明
#    例："TaskScheduler(src/scheduler.ts) 负责定时任务，基于 node-cron"
#    例："src/utils/retry.ts 提供统一的重试逻辑，指数退避，最多 3 次"
#
# ✅ **数据流和依赖关系**：模块间的调用关系和数据流向
#    例："请求流程：nginx → Express(8080) → AuthMiddleware → Router → Controller"
#    例："消息队列：Producer(src/mq/publish.ts) → RabbitMQ → Consumer(src/mq/consume.ts)"
#
# ⚠️ 不要记录代码的具体实现细节（如函数体内容），只记路径和职责概要
# ⚠️ 保持精简，每条不超过一两句话

# ─── 去重规则 ───
#
# 不要为了去重而刻意去读取共享记忆文件。只有在你正常工作过程中恰好读到了
# MEMORY.md 或 SESSION.md 的内容时，如果发现自己专属记忆中的某条内容已经
# 被共享记忆完整包含（且共享记忆中的表述不比你的更粗略），才从自己的文件中
# 删除该条目。
#
# 如果你的专属记忆比共享记忆更详细（例如你记录了具体的环境变量名，而共享记
# 忆只说了"通过环境变量注入"），请保留你的详细版本，不要删除。

# ─── 文件格式 ───
#
# # {agentId} Memory
#
# ## Permanent
#
# - （与项目相关的永久记忆）
#
# ## Session
#
# - （当前会话的临时记忆）
```

### 5.2 临时记忆管理提示词（未关联项目时注入）

当群聊未关联项目时，使用简化版提示词。不涉及共享记忆文件，仅管理 Agent 专属记忆。

```
# ================================================================================
# 记忆系统（临时模式）
# ================================================================================

# 你在群聊中有一个专属记忆文件，用于存储你认为需要记住的关键信息。
# 当前群聊未关联项目，没有共享记忆文件。

# 文件路径：
# - 你的专属记忆：{agentMemoryFile}

# ─── 写入规则 ───
#
# 1. 以下情况应该记录到 Permanent 部分：
#    ✅ 发现了重要的技术细节或 bug
#    ✅ 重要的决策及其原因
#    ✅ 发现的未文档化行为或环境特性
#
# 2. 以下情况应该记录到 Session 部分：
#    ✅ 当前正在做的事情及进度
#    ✅ 遇到的阻塞问题和待确认事项
#
# 3. 以下情况不应该记录：
#    ❌ 常规操作（如运行命令、读文件）
#    ❌ 中间调试步骤和临时尝试
#
# 4. 写入前先读取文件现有内容，避免重复
# 5. 内容必须简短，每条记忆用一两句话概括

# ─── 文件格式 ───
#
# # {agentId} Memory
#
# ## Permanent
#
# - （永久记忆）
#
# ## Session
#
# - （临时记忆）
```

### 5.3 注入策略

| 文件           | PTY 启动时                     | 后续交互                                       |
| -------------- | ------------------------------ | ---------------------------------------------- |
| `MEMORY.md`    | 注入文件内容                   | **只注入路径**，不注入内容                     |
| `SESSION.md`   | 注入文件内容                   | **每次都注入内容**（内容短、变化频繁）         |
| `{agentId}.md` | 注入文件内容（如存在）         | **每次都注入内容**（Agent 需要看到自己的记忆） |
| 记忆管理提示词 | **首次注入** + 每 5 次交互注入 | 降频注入（节省 token）                         |

> **注**："PTY 启动时"等同于 `cli-agent-context.md` 中定义的"首次交互"——即 PTY 进程创建后的第一次交互。PTY 重启（包括崩溃恢复）视为新的"PTY 启动"。

**设计理由**：

- `MEMORY.md` 后续只给路径：内容长、不常变，Agent 需要时可自行读取
- `SESSION.md` 每次注入内容：内容短、变化频繁，Agent 需要了解当前会话全局进展
- `{agentId}.md` 每次注入内容：Agent 需要看到自己之前记了什么，决定是否需要补充
- 记忆管理提示词**降频注入**：Agent 在首次交互时已学会写入规则，后续无需每次重复。每 5 次交互提醒一次即可保持行为一致性，同时节省 token 开销。如果检测到 Agent 出现不遵守规则的行为（如写入了 MEMORY.md），可在下次交互中强制注入提示词

### 5.4 完整注入格式

#### 5.4.1 PTY 启动时（首次交互）

```
# ================================================================================
# 项目记忆（项目级知识，非用户输入）
# ================================================================================

# ─── 共享永久记忆 ───
# 路径：{memoryDir}/MEMORY.md（只读，不要修改）

# [MEMORY.md 文件内容]

# ─── 共享临时记忆 ───
# 路径：{memoryDir}/SESSION.md（只读，不要修改）

# [SESSION.md 文件内容，如为空则跳过]

# ─── 你的专属记忆 ───
# 路径：{memoryDir}/{agentId}.md（只有你可以读写）

# [{agentId}.md 文件内容，如不存在则跳过]

# ================================================================================
# 记忆管理指令
# ================================================================================

# 你在群聊中有一个专属记忆文件...
# （完整的记忆管理提示词，见 5.1 节）

# ================================================================================
```

#### 5.4.2 后续交互

```
# ================================================================================
# 项目记忆路径
# ================================================================================

# MEMORY.md — 共享永久记忆（只读）
# 路径：{memoryDir}/MEMORY.md

# SESSION.md — 共享临时记忆（只读）
# 路径：{memoryDir}/SESSION.md

# {agentId}.md — 你的专属记忆（读写）
# 路径：{memoryDir}/{agentId}.md

# ================================================================================
# 共享临时记忆（最新快照）
# ================================================================================

# [SESSION.md 文件内容，如为空则跳过]

# ================================================================================
# 你的专属记忆（最新快照）
# ================================================================================

# [{agentId}.md 文件内容，如为空则跳过]

# ================================================================================
# 记忆管理指令（每 5 次交互注入，非每次注入时此段省略）
# ================================================================================

# 你在群聊中有一个专属记忆文件...
# （完整的记忆管理提示词，见 5.1 节）

# ================================================================================
```

### 5.5 上下文注入顺序

项目上下文注入的完整顺序（在群聊历史之前）：

```
1. 核心文件内容（PERSONALITY.md / SOUL.md / AGENTS.md）  ← PTY 启动时
2. 核心文件路径说明                                        ← 每次交互
3. 角色提醒（如需要）                                      ← 达到间隔时
4. 项目说明文档（README.md / ARCHITECTURE.md 等）          ← 群聊配置的 docs
5. 项目记忆（MEMORY.md + SESSION.md + {agentId}.md）       ← 本次新增
6. 记忆管理指令                                            ← 降频（首次 + 每5次）
7. 群聊历史消息                                            ← 完整/增量
8. 用户请求
```

---

## 6. 前端记忆管理面板

### 6.1 面板位置

在群聊设置/信息面板中新增"记忆管理"区块，展示当前群聊的所有记忆文件状态。

### 6.2 面板 UI

```
┌──────────────────────────────────────────────────────────────┐
│ 📝 记忆管理                                                  │
│                                                              │
│ ─── 共享记忆 ───                                             │
│                                                              │
│ MEMORY.md     12.3 KB    [预览] [编辑]                      │
│ SESSION.md     2.1 KB    [预览] [编辑]                      │
│                                                              │
│ ─── Agent 专属记忆 ───                                       │
│                                                              │
│ claude-code.md   3.4 KB  [预览] [编辑]                      │
│ opencode.md      1.8 KB  [预览] [编辑]                      │
│ codebuddy.md     missing                                     │
│                                                              │
│ ─── 总计 ───                                                 │
│                                                              │
│ 总大小：19.6 KB / 50 KB  ⚙️ 可设置                           │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━░░░░░░░░░░░░░░░░░░░  39% │
│                                                              │
│ [合并记忆]  [精简记忆]                                       │
│ 上次合并：3 分钟前（自动触发）                                │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 6.3 文件状态展示

| 文件           | 存在时显示               | 不存在时显示 |
| -------------- | ------------------------ | ------------ |
| `MEMORY.md`    | 文件大小 + [预览] [编辑] | `missing`    |
| `SESSION.md`   | 文件大小 + [预览] [编辑] | `missing`    |
| `{agentId}.md` | 文件大小 + [预览] [编辑] | `missing`    |

### 6.4 大小预警

> 记忆文件大小上限默认 **50KB**，支持在群聊设置中自定义调整（`memory.maxSize`，单位 KB）。预警阈值为上限的 80%。

- 总大小接近上限的 **80%**（默认 40KB）时，进度条变为黄色并显示提示：`⚠️ 记忆文件总大小接近上限（{maxSize}KB），建议精简`
- 总大小超过上限（默认 50KB）时，进度条变为红色并显示提示：`🔴 记忆文件已超过 {maxSize}KB 上限，请立即精简`

### 6.5 操作按钮

#### "合并记忆"按钮

点击后，前端执行以下动作：

1. **页面提示**：在群聊区域或面板中显示 toast 提示 `ℹ️ 已发送记忆合并指令，助理 Agent 正在处理...`
2. **发送不可见消息**：在群聊中发送一条**不可见的系统指令消息**（页面不显示，但作为对话内容传入），@助理 Agent：

```
@助理Agent 请执行记忆合并，将各 Agent 专属记忆中的关键信息汇总到共享记忆文件中。
```

3. 前端同时将 §4.4 中的合并提示词作为消息内容一并发送
4. **完成提示**：当系统检测到合并完成（见 §4.2.3 合并完成检测），在页面显示 toast 提示 `✅ 记忆合并完成`

#### "精简记忆"按钮

点击后，前端执行以下动作：

1. **页面提示**：显示 toast 提示 `ℹ️ 已发送记忆精简指令，助理 Agent 正在处理...`
2. **发送不可见消息**：在群聊中发送一条**不可见的系统指令消息**（同上），@助理 Agent：

```
@助理Agent 请精简记忆文件，清理过时、冗余或过于冗长的记忆条目。
```

3. 前端同时将 §4.5 中的精简提示词作为消息内容一并发送
4. **完成提示**：当系统检测到精简完成，在页面显示 toast 提示 `✅ 记忆精简完成`

#### 按钮冷却状态（见 §4.2）

"合并记忆"和"精简记忆"按钮受合并冷却机制约束：

| 状态             | 按钮表现                                                    | 说明                    |
| ---------------- | ----------------------------------------------------------- | ----------------------- |
| **合并进行中**   | 灰化 + 旋转图标 + 文字变为"合并中..."                       | 助理 Agent 正在执行合并 |
| **冷却期内**     | 灰化 + 显示剩余时间 "X 分钟后可用"                          | 距上次合并不足 5 分钟   |
| **冷却期内强制** | 点击后弹出确认框"距上次合并不到 X 分钟，确定要再次执行吗？" | 允许用户强制触发        |
| **可用**         | 正常可点击                                                  | 冷却期已过              |

**上次合并信息**：在按钮下方显示一行小字，如 `上次合并：3 分钟前（自动触发）`，帮助用户判断是否需要再次合并。

#### "预览"按钮

打开一个只读弹窗，展示 Markdown 渲染后的文件内容。

#### "编辑"按钮

打开一个编辑弹窗，支持直接修改文件内容（Markdown 编辑器）。保存后直接写入文件。

> **注**：临时记忆模式下不显示"合并记忆"和"精简记忆"按钮（没有共享记忆文件）。

### 6.6 记忆配置项

记忆管理面板中的 `⚙️` 入口（或群聊设置页）提供以下可配置项：

| 配置项       | 键名             | 默认值 | 说明                       |
| ------------ | ---------------- | ------ | -------------------------- |
| 记忆大小上限 | `memory.maxSize` | 50 KB  | 所有记忆文件总大小的上限值 |

> 这些配置项存储在群聊配置中，由前端面板提供设置 UI。后端在计算预警阈值和 `MemoryStatus` 时读取该配置。

---

## 7. 生命周期管理

### 7.1 共享永久记忆 `MEMORY.md`

| 事件            | 行为                                                        |
| --------------- | ----------------------------------------------------------- |
| 群聊关联项目    | 系统创建目录 `{projectDir}/.openclaw/{groupName}/` 和空模板 |
| 助理 Agent 汇总 | 读取各 Agent 记忆，合并写入                                 |
| 群聊解散        | 见 §7.4（需先整理到上级 MEMORY.md 才能解散）                |
| CLI 进程重启    | 不受影响（文件在项目目录下）                                |

### 7.2 共享临时记忆 `SESSION.md`

| 事件                 | 行为                           |
| -------------------- | ------------------------------ |
| 会话开始（首次交互） | 系统创建空文件                 |
| 助理 Agent 汇总      | 更新会话进展和进度             |
| 群聊解散             | 系统删除（随群聊目录一起清理） |

> **注**：SESSION.md **仅在群聊解散时**回收清理，不在 PTY 空闲回收时清空。这确保了会话上下文在群聊存续期间始终保持。

**内容膨胀防护**：如果群聊存续数周，SESSION.md 可能持续增长。助理 Agent 在每次汇总时应遵循以下淘汰策略：

- **覆盖而非追加**：SESSION.md 的内容是**全量替换**而非追加。每次汇总时，助理 Agent 重新整理当前会话状态，而非在末尾追加
- **精简提示词兜底**：合并提示词（§4.4）中已要求"保持简短精炼"，助理 Agent 应自主精简过时内容
- **大小上限**：如果 SESSION.md 超过 **10KB**，助理 Agent 在汇总时应更激进地精简（删除已完成任务、过时的待确认事项等）

### 7.3 Agent 专属记忆 `{agentId}.md`

| 事件             | 行为                                                 |
| ---------------- | ---------------------------------------------------- |
| Agent PTY 启动时 | 系统创建空文件（如不存在）                           |
| Agent 工作中     | Agent 自主写入                                       |
| 助理 Agent 汇总  | **助理 Agent 不修改此文件**                          |
| Agent 惰性去重   | Agent 在正常工作中读到共享文件时，发现完全重复才清理 |
| PTY 空闲回收     | **不删除**（Agent 可能下次还需参考）                 |
| 群聊解散         | 随群聊目录一起清理                                   |

### 7.4 群聊解散流程

群聊解散时，系统需要确保群聊级共享记忆中的有价值信息不丢失。

**流程**：

1. 用户点击"解散群聊"
2. 系统检测该群聊目录下是否有非空的 `MEMORY.md`
3. 如果有非空记忆，**阻止解散**并弹出提示：

```
┌──────────────────────────────────────────────────────────────┐
│ ⚠️ 解散群聊                                                  │
│                                                              │
│ 该群聊包含共享记忆文件（MEMORY.md），解散前需要整理。         │
│                                                              │
│ 请先将有价值的记忆提取到项目级共享记忆中，                    │
│ 然后清空群聊级记忆文件后才能解散。                            │
│                                                              │
│ [整理记忆并解散]   [强制解散]   [取消]                       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

4. 如果用户点击"整理记忆并解散"：
   - 前端在群聊中发送一条不可见的系统指令消息，@助理 Agent，内容为以下提示词：

```
# ================================================================================
# 群聊即将解散 — 记忆整理任务
# ================================================================================

# 当前群聊即将解散。请将本群共享记忆中有价值的内容提取到项目级共享记忆中。

# 1. 读取当前群聊共享记忆：
#    - {memoryDir}/MEMORY.md

# 2. 读取项目级共享记忆：
#    - {projectDir}/.openclaw/MEMORY.md

# 3. 将当前群聊 MEMORY.md 中有价值的、与项目相关的长期知识提取到项目级
#    MEMORY.md 中。每条记忆末尾标注来源群聊名称（如 "（来源：项目开发组）"）。

# 4. 去重：如果内容已存在于项目级 MEMORY.md 中，跳过。

# 5. 完成后，清空当前群聊的 MEMORY.md（写入空模板）。

# 6. 完成后回复"记忆整理完成，可以解散群聊。"
```

- 助理 Agent 完成整理后回复确认
- 系统检测到 MEMORY.md 已被清空（或恢复为空模板），执行解散

5. 如果用户点击"强制解散"：
   - 跳过整理步骤，直接删除群聊目录
   - 记忆数据将丢失，系统给出最终确认提示

### 7.5 目录创建

PTY 启动时（首次交互），系统自动创建记忆目录和必要的文件。

**新群关联项目时的初始化**：如果项目级共享记忆 `{projectDir}/.openclaw/MEMORY.md` 已有内容（来自之前解散的群聊），系统在创建新群聊的 `MEMORY.md` 时，将项目级记忆的内容作为初始内容写入（而非空模板）。这样新群中的 Agent 从一开始就能获得前序群聊积累的项目知识。

```typescript
// 初始化群聊 MEMORY.md 时的逻辑
const projectLevelMemory = await readFileOrNull(projectLevelMemoryFile);
if (projectLevelMemory && !isEmptyTemplate(projectLevelMemory)) {
  // 项目级记忆存在且非空 → 用它作为新群的初始共享记忆
  await writeIfNotExists(sharedMemoryFile, projectLevelMemory);
} else {
  await writeIfNotExists(sharedMemoryFile, MEMORY_TEMPLATE);
}
```

**MEMORY.md 初始模板**：

```markdown
# Project Memory

## 架构决策

## 代码结构

## 编码约定

## 踩坑记录

## 项目知识

## 其他
```

**SESSION.md 初始模板**：

```markdown
# Session Notes

## 当前任务

## 进展

## 待确认

## 未完成

## 其他
```

**`{agentId}.md` 初始模板**：

```markdown
# {agentId} Memory

## Permanent

## Session
```

---

## 8. 实现细节

### 8.1 路径解析

```typescript
// src/group-chat/bridge-memory.ts

/**
 * 解析项目记忆模式的记忆文件路径
 * 记忆文件按群名称隔离在 .openclaw/{groupName}/ 下
 */
function resolveProjectMemoryPaths(
  projectDir: string,
  groupName: string,
  agentId: string,
): {
  dir: string;
  projectLevelMemoryFile: string; // .openclaw/MEMORY.md（跨群聊）
  sharedMemoryFile: string; // .openclaw/{groupName}/MEMORY.md
  sharedSessionFile: string; // .openclaw/{groupName}/SESSION.md
  agentMemoryFile: string; // .openclaw/{groupName}/{agentId}.md
} {
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

/**
 * 解析临时记忆模式的记忆文件路径
 * 未关联项目时，记忆文件存储在 stateDir 下
 */
function resolveTempMemoryPaths(
  stateDir: string,
  groupId: string,
  agentId: string,
): {
  dir: string;
  agentMemoryFile: string; // {stateDir}/group-memory/{groupId}/{agentId}.md
} {
  const dir = path.join(stateDir, "group-memory", groupId);
  return {
    dir,
    agentMemoryFile: path.join(dir, `${agentId}.md`),
  };
}
```

### 8.2 文件初始化

```typescript
/**
 * 确保项目记忆文件存在（项目记忆模式）
 */
async function ensureProjectMemoryFiles(
  projectDir: string,
  groupName: string,
  agentId: string,
): Promise<void> {
  const { dir, projectLevelMemoryFile, sharedMemoryFile, sharedSessionFile, agentMemoryFile } =
    resolveProjectMemoryPaths(projectDir, groupName, agentId);

  await fs.mkdir(dir, { recursive: true });
  await writeIfNotExists(projectLevelMemoryFile, PROJECT_MEMORY_TEMPLATE);
  await writeIfNotExists(sharedMemoryFile, MEMORY_TEMPLATE);
  await writeIfNotExists(sharedSessionFile, SESSION_TEMPLATE);
  await writeIfNotExists(agentMemoryFile, agentMemoryTemplate(agentId));
}

/**
 * 确保临时记忆文件存在（临时记忆模式）
 */
async function ensureTempMemoryFiles(
  stateDir: string,
  groupId: string,
  agentId: string,
): Promise<void> {
  const { dir, agentMemoryFile } = resolveTempMemoryPaths(stateDir, groupId, agentId);

  await fs.mkdir(dir, { recursive: true });
  await writeIfNotExists(agentMemoryFile, agentMemoryTemplate(agentId));
}
```

### 8.3 动态扫描 Agent 记忆文件

```typescript
/**
 * 扫描记忆目录下所有 Agent 专属记忆文件
 * 排除 MEMORY.md 和 SESSION.md
 */
async function scanAgentMemoryFiles(memoryDir: string): Promise<string[]> {
  const files = await fs.readdir(memoryDir);
  return files
    .filter((f) => f.endsWith(".md") && f !== "MEMORY.md" && f !== "SESSION.md")
    .map((f) => path.join(memoryDir, f));
}
```

### 8.4 合并冷却机制实现

```typescript
// src/group-chat/bridge-memory.ts

const DEFAULT_MERGE_COOLDOWN_MS = 5 * 60 * 1000; // 5 分钟
const MERGE_TIMEOUT_MS = 3 * 60 * 1000; // 3 分钟超时保护

interface MemoryMergeState {
  lastMergeAt: number | null;
  lastMergeSource: "auto" | "manual-merge" | "manual-compact" | null;
  dirtyAfterMerge: boolean;
  merging: boolean;
  mergingStartedAt: number | null; // 合并开始时间（用于超时保护）
}

// 每个群聊维护一个合并状态（存储在群聊运行时状态中）
const mergeStates = new Map<string, MemoryMergeState>();

function getMergeState(groupId: string): MemoryMergeState {
  if (!mergeStates.has(groupId)) {
    mergeStates.set(groupId, {
      lastMergeAt: null,
      lastMergeSource: null,
      dirtyAfterMerge: true, // 初始视为脏，首次合并应执行
      merging: false,
      mergingStartedAt: null,
    });
  }
  return mergeStates.get(groupId)!;
}

/**
 * 检查是否可以执行合并
 * @returns { allowed, reason, cooldownRemainMs }
 */
function checkMergeCooldown(
  groupId: string,
  source: "auto" | "manual-merge" | "manual-compact",
  cooldownMs: number = DEFAULT_MERGE_COOLDOWN_MS,
): {
  allowed: boolean;
  reason?: "merging" | "cooldown" | "no-dirty";
  cooldownRemainMs?: number;
} {
  const state = getMergeState(groupId);

  // 0. 超时保护：如果合并已超过 3 分钟，自动释放锁
  if (state.merging && state.mergingStartedAt) {
    if (Date.now() - state.mergingStartedAt > MERGE_TIMEOUT_MS) {
      console.warn(`[memory] merge timeout for group ${groupId}, releasing lock`);
      state.merging = false;
      state.mergingStartedAt = null;
    }
  }

  // 1. 正在合并中 → 拒绝
  if (state.merging) {
    return { allowed: false, reason: "merging" };
  }

  // 2. 冷却期检查
  if (state.lastMergeAt) {
    const elapsed = Date.now() - state.lastMergeAt;
    if (elapsed < cooldownMs) {
      // 自动触发 → 静默跳过；手动触发 → 返回让前端决定是否强制
      return {
        allowed: false,
        reason: "cooldown",
        cooldownRemainMs: cooldownMs - elapsed,
      };
    }
  }

  // 3. 自动触发时额外检查脏标记
  if (source === "auto" && !state.dirtyAfterMerge) {
    return { allowed: false, reason: "no-dirty" };
  }

  return { allowed: true };
}

/**
 * 标记合并开始
 */
function markMergeStart(groupId: string): void {
  const state = getMergeState(groupId);
  state.merging = true;
  state.mergingStartedAt = Date.now();
}

/**
 * 标记合并完成
 */
function markMergeComplete(
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

/**
 * 当检测到 Agent 写入记忆文件时调用
 */
function markMemoryDirty(groupId: string): void {
  const state = getMergeState(groupId);
  state.dirtyAfterMerge = true;
}
```

### 8.5 上下文构建集成

```typescript
// 在 buildCliContextMessage() 中

const projectDir = meta?.config?.project?.directory;
const groupName = meta?.groupName ?? meta?.groupId;

// 交互计数器（用于记忆管理提示词降频注入）
const MEMORY_PROMPT_INTERVAL = 5; // 每 5 次交互注入一次记忆管理提示词

if (projectDir) {
  // 项目记忆模式
  const { sharedMemoryFile, sharedSessionFile, agentMemoryFile } = resolveProjectMemoryPaths(
    projectDir,
    groupName,
    agentId,
  );
  await ensureProjectMemoryFiles(projectDir, groupName, agentId);

  if (isFirstInteraction) {
    // PTY 启动时：注入 MEMORY.md 内容
    const memoryContent = await fs.readFile(sharedMemoryFile, "utf-8");
    sections.push(
      "# ─── 共享永久记忆 ───",
      `# 路径：${sharedMemoryFile}（只读，不要修改）`,
      "",
      ...memoryContent.split("\n").map((line) => `# ${line}`),
    );
  } else {
    // 后续：只注入 MEMORY.md 路径
    sections.push(`# MEMORY.md — 共享永久记忆（只读）`, `# 路径：${sharedMemoryFile}`);
  }

  // SESSION.md：每次注入内容
  const sessionContent = await fs.readFile(sharedSessionFile, "utf-8");
  if (!isEmptyTemplate(sessionContent)) {
    sections.push(
      "# ─── 共享临时记忆（只读） ───",
      ...sessionContent.split("\n").map((line) => `# ${line}`),
    );
  }

  // Agent 专属记忆：每次注入内容
  if (await fs.exists(agentMemoryFile)) {
    const agentContent = await fs.readFile(agentMemoryFile, "utf-8");
    if (!isEmptyTemplate(agentContent)) {
      sections.push(
        "# ─── 你的专属记忆（读写） ───",
        ...agentContent.split("\n").map((line) => `# ${line}`),
      );
    }
  }

  // 记忆管理指令：降频注入（首次 + 每 N 次交互）
  const shouldInjectMemoryPrompt =
    isFirstInteraction || interactionCount % MEMORY_PROMPT_INTERVAL === 0;
  if (shouldInjectMemoryPrompt) {
    sections.push(
      ...buildMemoryManagementPrompt(sharedMemoryFile, sharedSessionFile, agentMemoryFile, agentId),
    );
  }
} else {
  // 临时记忆模式：只有 Agent 专属记忆
  const { agentMemoryFile } = resolveTempMemoryPaths(stateDir, groupId, agentId);
  await ensureTempMemoryFiles(stateDir, groupId, agentId);

  if (await fs.exists(agentMemoryFile)) {
    const agentContent = await fs.readFile(agentMemoryFile, "utf-8");
    if (!isEmptyTemplate(agentContent)) {
      sections.push(
        "# ─── 你的专属记忆（读写） ───",
        ...agentContent.split("\n").map((line) => `# ${line}`),
      );
    }
  }

  // 临时记忆模式的简化提示词（见 §5.2）：同样降频注入
  const shouldInjectMemoryPrompt =
    isFirstInteraction || interactionCount % MEMORY_PROMPT_INTERVAL === 0;
  if (shouldInjectMemoryPrompt) {
    sections.push(...buildTempMemoryManagementPrompt(agentMemoryFile, agentId));
  }
}
```

### 8.6 群聊解散清理

```typescript
/**
 * 群聊解散时检查是否有未整理的共享记忆
 */
async function checkMemoryBeforeDissolve(
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

/**
 * 群聊解散后清理记忆目录
 */
async function cleanupGroupMemory(
  projectDir: string | undefined,
  stateDir: string,
  groupId: string,
  groupName: string,
): Promise<void> {
  if (projectDir) {
    // 项目记忆模式：删除群聊子目录
    const groupMemoryDir = path.join(projectDir, ".openclaw", groupName);
    await fs.rm(groupMemoryDir, { recursive: true, force: true });
  } else {
    // 临时记忆模式：删除 stateDir 下的目录
    const tempDir = path.join(stateDir, "group-memory", groupId);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
```

### 8.7 记忆文件状态查询（供前端面板使用）

```typescript
/**
 * 获取记忆文件状态（供前端记忆管理面板使用）
 * @param maxSizeKB 记忆文件总大小上限（KB），默认 50，可通过群聊配置 memory.maxSize 覆盖
 */
async function getMemoryStatus(
  projectDir: string | undefined,
  stateDir: string,
  groupId: string,
  groupName: string,
  agentIds: string[],
  maxSizeKB: number = 50,
): Promise<MemoryStatus> {
  const files: MemoryFileInfo[] = [];
  let totalSize = 0;

  if (projectDir) {
    const baseDir = path.join(projectDir, ".openclaw", groupName);

    // 共享记忆文件
    for (const name of ["MEMORY.md", "SESSION.md"]) {
      const filePath = path.join(baseDir, name);
      const info = await getFileInfo(filePath);
      files.push({ name, ...info });
      totalSize += info.size;
    }

    // Agent 专属记忆文件
    for (const agentId of agentIds) {
      const filePath = path.join(baseDir, `${agentId}.md`);
      const info = await getFileInfo(filePath);
      files.push({ name: `${agentId}.md`, ...info });
      totalSize += info.size;
    }
  } else {
    // 临时记忆模式
    const baseDir = path.join(stateDir, "group-memory", groupId);
    for (const agentId of agentIds) {
      const filePath = path.join(baseDir, `${agentId}.md`);
      const info = await getFileInfo(filePath);
      files.push({ name: `${agentId}.md`, ...info });
      totalSize += info.size;
    }
  }

  const maxBytes = maxSizeKB * 1024;
  const warningThresholdBytes = maxBytes * 0.8; // 80%

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

type MemoryFileInfo = {
  name: string;
  exists: boolean;
  size: number; // bytes, 0 if not exists
};

type MemoryStatus = {
  files: MemoryFileInfo[];
  totalSize: number;
  maxSize: number; // bytes
  maxSizeKB: number; // KB（原始配置值，供前端展示）
  warning: "ok" | "approaching-limit" | "over-limit";
};
```

---

## 9. 改动范围

| 文件                                     | 改动               | 说明                                                                                                             |
| ---------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `src/group-chat/bridge-memory.ts`        | **新增** (~320 行) | 路径解析、模板定义、文件初始化（含项目级记忆继承）、提示词构建、状态查询、扫描、清理、合并冷却机制（含超时保护） |
| `src/group-chat/bridge-trigger.ts`       | ~50 行             | `buildCliContextMessage()` 集成项目记忆/临时记忆注入                                                             |
| `src/gateway/server-methods/group.ts`    | ~30 行             | 群聊解散时检查记忆、触发整理流程                                                                                 |
| `ui/src/ui/views/group-settings.ts`      | ~120 行            | 记忆管理面板 UI（文件列表、大小展示、预警、操作按钮）                                                            |
| `ui/src/ui/components/memory-preview.ts` | **新增** (~80 行)  | 记忆文件预览/编辑弹窗组件                                                                                        |
| `cli-agent-context.md`                   | ~10 行             | 同步更新注入流程说明，增加记忆系统引用                                                                           |
| `README.md`（导航表）                    | ~3 行              | 增加本文档的导航链接                                                                                             |

**总改动量**：~613 行新增/修改代码，无现有文件破坏性修改。

---

## 10. 安全考量

1. **路径遍历**：`projectDir` 和 `groupName` 必须经过校验，防止路径遍历攻击。`groupName` 中的特殊字符（如 `/`、`..`、`\`）需要被过滤或转义
2. **文件大小**：各文件总大小默认上限 50KB（可通过 `memory.maxSize` 配置调整），防止上下文过长。前端面板实时展示大小并提供预警（达到 80% 时黄色预警，超过上限时红色告警）
3. **权限隔离**：通过提示词约束读写权限（CLI Agent 是 AI，能理解并遵守规则）
4. **群名称安全**：群名称作为目录名使用时，需要做文件系统安全处理：
   - **非法字符过滤**：去除 `/`、`\`、`..`、`:` 等文件系统非法/危险字符，替换为 `_`
   - **长度限制**：目录名不超过 64 字符（含 sanitize 后），超长部分截断并追加短 hash（如前 56 字符 + `-` + 7 字符 hash）
   - **重名处理**：如果同一项目下有两个同名群聊（sanitize 后同名），在目录名后追加群聊 ID 的短 hash（如 `项目开发组-a3f2b1c/`）。系统在创建目录时检测冲突，仅在冲突时追加后缀
   - **空名称**：群名称为空或全为非法字符时，fallback 使用 `group-{groupId短hash}` 作为目录名

---

## 11. 未来扩展

- **记忆版本控制**：`MEMORY.md` 的变更历史可通过 Git 追踪
- **冷却期可配置**：允许 Owner 在群聊设置中自定义合并冷却期（当前默认 5 分钟，见 §6.6 可配置项）
- **记忆大小上限可配置**：已在 §6.6 纳入设计（`memory.maxSize`）
- **记忆导出**：支持将记忆文件导出为其他格式（如 JSON）
- **跨项目记忆**：Agent 在不同项目中积累的通用知识可共享

---

## 12. 关联文档

- [CLI Agent 上下文](./cli-agent-context.md) — 上下文消息格式、首次/后续交互、截断策略
- [发起者汇总机制](../group-chat-initiator-summary.md) — 助理 Agent 合并的自动触发机制
- [技术实现](./implementation.md) — 文件清单、模块设计、实施阶段
