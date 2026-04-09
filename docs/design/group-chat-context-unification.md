# Group Chat 上下文注入统一方案

> 状态：Draft
> 日期：2026-04-09
> 关联文件：`src/group-chat/agent-trigger.ts`、`src/group-chat/context-builder.ts`、`src/group-chat/bridge-trigger.ts`、`src/group-chat/bridge-context.ts`、`src/group-chat/bridge-memory.ts`、`src/group-chat/bridge-types.ts`

---

## 1. 问题概述

Group Chat 中存在两条 Agent 触发路径：

- **LLM Agent**：`agent-trigger.ts` → `context-builder.ts` → `dispatchInboundMessage()`
- **Bridge Agent**：`bridge-trigger.ts` → `buildCliContextMessage()` → PTY stdin

两条路径的上下文注入逻辑存在**系统性不一致**，导致：

1. `ContextConfig` 中的 `roleReminderInterval`、`memory.*` 等配置对 LLM Agent 完全无效，前端配置面板给用户造成"能配置"的假象
2. 群公告、成员列表、约束等关键信息在两条路径中注入策略不同
3. LLM Agent 缺少记忆系统和核心文件注入

---

## 2. 15 项维度对比

| #   | 维度               | LLM Agent 现状                     | Bridge Agent 现状                            | 决策                                         |
| --- | ------------------ | ---------------------------------- | -------------------------------------------- | -------------------------------------------- |
| 1   | 群公告             | ✅ 每次注入                        | ❌ 仅首次注入                                | **统一为 LLM 策略**：每次都注入              |
| 2   | 角色/身份信息      | 每次全量注入（含 rolePrompt）      | 首次全量 + 后续按间隔提醒（不含 rolePrompt） | **统一为 Bridge 策略**：首次全量 + 间隔提醒  |
| 3   | 成员列表           | ✅ 每次注入（含 Owner）            | 仅首次注入（不含 Owner）                     | **统一为 LLM 策略**：每次都注入，含 Owner    |
| 4   | 通信指南（@规则）  | ✅ 每次注入                        | ❌ 不注入                                    | **不修改**：保持现状                         |
| 5   | 约束（读写权限）   | ✅ 每次注入                        | ❌ 不注入（死代码）                          | **统一为 LLM 策略**：每次都注入              |
| 6   | 项目目录           | 仅作 workspaceDirOverride          | 首次在上下文中注入路径                       | 保持差异（可接受）                           |
| 7   | 项目文档 (docs)    | ❌ 不注入                          | 仅首次注入路径列表                           | **不修改**                                   |
| 8   | 记忆系统           | 仅路径引用（依赖 Bridge 成员存在） | 完整系统（路径+内容+管理提示，按间隔控制）   | **统一为 Bridge 策略**：LLM 补上完整记忆注入 |
| 9   | 对话历史           | 每次全量重建，简单截断             | 首次全量 + 后续增量                          | **不修改**                                   |
| 10  | Thinking 标签      | ✅ 去除 `<think>` 标签             | ❌ 不处理                                    | **不修改**                                   |
| 11  | 单条消息截断       | ❌ 无限制                          | ✅ 2000 字符截断                             | **不修改**                                   |
| 12  | 交互计数           | ❌ 无状态，无计数器                | ✅ `BridgePtyState.interactionCount`         | **单独调整**：LLM 新增计数器                 |
| 13  | ContextConfig 生效 | 仅 3 个字段生效                    | 全部字段生效                                 | **修复**：全部字段对两条路径统一生效         |
| 14  | 核心文件           | 不在群聊模块处理                   | 首次注入内容 + 每次注入路径                  | **统一为 Bridge 策略**：LLM 补上核心文件注入 |
| 15  | Plan Mode          | Assistant + Executor 均注入        | 仅 Executor（非 assistant）注入              | 保持差异（设计合理）                         |

---

## 3. ContextConfig 字段清单

```typescript
// bridge-types.ts

type ContextConfig = {
  maxMessages?: number; // 上下文最大消息数。Default 30
  maxCharacters?: number; // 上下文最大字符数。Default 50_000
  includeSystemMessages?: boolean; // 是否包含系统消息。Default false
  roleReminderInterval?: number; // 角色提醒间隔（每 N 次交互）。Default 5
  memory?: MemoryContextConfig; // 记忆配置
};

type MemoryContextConfig = {
  maxSize?: number; // 记忆文件大小上限 KB。Default 50
  contentInterval?: number; // 记忆内容注入间隔（每 N 次交互）。Default 6
  promptInterval?: number; // 记忆管理提示注入间隔（每 N 次交互）。Default 5
};
```

**当前生效情况：**

| 字段                     | LLM Agent | Bridge Agent |
| ------------------------ | --------- | ------------ |
| `maxMessages`            | ✅        | ✅           |
| `maxCharacters`          | ✅        | ✅           |
| `includeSystemMessages`  | ✅        | ✅           |
| `roleReminderInterval`   | ❌ 无效   | ✅           |
| `memory.maxSize`         | ❌ 无效   | ✅           |
| `memory.contentInterval` | ❌ 无效   | ✅           |
| `memory.promptInterval`  | ❌ 无效   | ✅           |

**目标：** 全部字段对两条路径统一生效。

---

## 4. 修改方案

### 4.1 Phase 1：LLM Agent 新增交互计数器（#12）

**前置依赖**：无
**被依赖**：#2、#8、#13、#14

LLM Agent 当前是无状态的——每次调用 `triggerAgentReasoning()` 都是独立的。需要引入一个持久化的交互计数器。

**方案：新增 `LlmAgentState` + 内存 Map 管理**

```
文件：src/group-chat/llm-agent-state.ts（新建）
```

- 定义 `LlmAgentState` 类型，包含：
  - `interactionCount: number` — 交互计数（每次 `triggerAgentReasoning` 完成后递增）
  - `isFirstInteraction: boolean` — 是否首次交互
  - `lastRoleReminderAt: number` — 上次角色提醒时的 interactionCount
- 使用 `Map<string, LlmAgentState>` 管理，key 为 `${groupId}:${agentId}`
- 导出 `getLlmAgentState(groupId, agentId)` / `incrementLlmInteraction(groupId, agentId)` / `resetLlmAgentState(groupId, agentId)`
- 生命周期：跟随群聊 session，群解散时清理

**修改文件：**

| 文件                                | 改动                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `src/group-chat/llm-agent-state.ts` | **新建** — LlmAgentState 类型 + Map + get/increment/reset               |
| `src/group-chat/agent-trigger.ts`   | 在 `triggerAgentReasoning()` 成功返回前调用 `incrementLlmInteraction()` |

---

### 4.2 Phase 2：Bridge 侧统一为 LLM 策略（#1、#3、#5）

**前置依赖**：无（与 Phase 1 可并行）

#### 4.2.1 #1 群公告 — Bridge 改为每次注入

**当前**：`bridge-trigger.ts` 的 `buildCliContextMessage()` 中，`meta.announcement` 仅在 `isFirstInteraction` 分支内注入。

**改动**：将公告注入逻辑从 `isFirstInteraction` 分支提取到外部，后续交互也注入。

```
文件：src/group-chat/bridge-trigger.ts
位置：buildCliContextMessage() 函数
改动：将 announcement 注入移到 isFirstInteraction 条件外部
```

#### 4.2.2 #3 成员列表 — Bridge 改为每次注入 + 补 Owner

**当前**：成员列表仅在 `isFirstInteraction` 分支内注入，且不含 Owner。

**改动**：

1. 将成员列表注入移到 `isFirstInteraction` 条件外部
2. 在成员列表中添加 `Owner（群主/用户）`

```
文件：src/group-chat/bridge-trigger.ts
位置：buildCliContextMessage() 函数
改动：成员列表移到外部 + 添加 Owner
```

#### 4.2.3 #5 约束 — Bridge 补上注入 + 清理死代码

**当前**：

- `context-builder.ts` 第 128-144 行写了 Bridge Agent 的约束（含"不要输出敏感信息"），但由于 `agent-trigger.ts` 第 227-229 行 Bridge 分支直接 return，这段代码永远不执行 → 死代码
- Bridge 路径 `buildCliContextMessage()` 中完全没有约束注入

**改动**：

1. 在 `bridge-trigger.ts` 的 `buildCliContextMessage()` 中新增约束注入（每次都注入）
2. `context-builder.ts` 中的 Bridge 约束分支不再是死代码（但实际不需要改，因为 LLM 路径到不了 Bridge 分支），加注释说明

```
文件：src/group-chat/bridge-trigger.ts
位置：buildCliContextMessage() 函数
改动：在上下文中添加约束注入区块
```

---

### 4.3 Phase 3：LLM 侧统一为 Bridge 策略（#2、#8、#14）

**前置依赖**：Phase 1（需要交互计数器）

#### 4.3.1 #2 角色/身份信息 — LLM 改为首次全量 + 间隔提醒

**当前**：`context-builder.ts` 的 `buildGroupChatContext()` 每次都全量注入角色信息（Group Info + Member list + Role Prompt）。

**改动**：

1. `buildGroupChatContext()` 增加 `isFirstInteraction` 和 `interactionCount` 参数
2. 首次交互：注入完整角色信息（含 rolePrompt）
3. 后续交互：仅在 `interactionCount - lastRoleReminderAt >= roleReminderInterval` 时注入简化版角色提醒
4. 角色提醒内容需包含 rolePrompt（修复 Bridge 当前的遗漏）

```
文件：src/group-chat/context-builder.ts
改动：buildGroupChatContext() 增加条件判断参数
文件：src/group-chat/agent-trigger.ts
改动：调用 buildGroupChatContext() 时传入状态参数
```

#### 4.3.2 #8 记忆系统 — LLM 补上完整记忆注入

**当前**：LLM Agent 在 `context-builder.ts` 第 147-175 行仅注入记忆文件路径（且依赖群内有 Bridge 成员），没有内容注入、没有管理规则。

**改动**：

1. 移除 `hasBridgeMembers` 条件——不管群内有没有 Bridge 成员，LLM Agent 都应该知道记忆系统
2. 复用 `bridge-memory.ts` 中的 `shouldInjectMemoryContent()` / `shouldInjectMemoryPrompt()` 判断注入时机
3. 利用 Phase 1 的 `LlmAgentState.interactionCount` 驱动间隔控制
4. 注入内容：
   - 每次交互：记忆文件路径
   - 按 `contentInterval` 间隔：记忆文件内容（读取 MEMORY.md / SESSION.md / agent.md）
   - 按 `promptInterval` 间隔：记忆管理提示
5. 注入方式：将记忆内容拼接到 `GroupSystemPrompt`（而非 Bridge 的 `# 注释` 方式）

```
文件：src/group-chat/context-builder.ts
改动：重写记忆注入逻辑，移除 hasBridgeMembers 条件，增加内容和管理提示注入
文件：src/group-chat/agent-trigger.ts
改动：传入 interactionCount 供 context-builder 使用
```

**注意**：LLM Agent 是 read-only 模式，无法写记忆文件，所以记忆管理提示需调整措辞——告知 LLM Agent "记忆文件由 Bridge Agent 维护，你仅有读取权限"。

#### 4.3.3 #14 核心文件 — LLM 补上注入

**当前**：LLM Agent 的核心文件（PERSONALITY.md / SOUL.md / AGENTS.md）不在群聊模块处理，而是由 LLM pipeline 的 system prompt 阶段处理。群聊模块完全不涉及。

**改动**：

1. 在 `context-builder.ts` 中新增核心文件注入逻辑
2. 复用 `bridge-context.ts` 的 `buildCoreFilesContentSection()` / `buildCoreFilesPathSection()`
3. 首次交互：注入文件内容 + 路径
4. 后续交互：仅注入路径

```
文件：src/group-chat/context-builder.ts
改动：增加核心文件注入区块，复用 bridge-context.ts 的函数
文件：src/group-chat/agent-trigger.ts
改动：传入 isFirstInteraction 参数
```

---

### 4.4 Phase 4：ContextConfig 全字段生效验证（#13）

**前置依赖**：Phase 1 + Phase 3

Phase 1~3 完成后，ContextConfig 的所有字段应自然对两条路径统一生效：

| 字段                     | 生效机制                                   |
| ------------------------ | ------------------------------------------ |
| `maxMessages`            | 已生效（无需改动）                         |
| `maxCharacters`          | 已生效（无需改动）                         |
| `includeSystemMessages`  | 已生效（无需改动）                         |
| `roleReminderInterval`   | Phase 1 计数器 + Phase 3.1 角色提醒 → 生效 |
| `memory.maxSize`         | Phase 3.2 记忆注入 → 生效                  |
| `memory.contentInterval` | Phase 1 计数器 + Phase 3.2 记忆注入 → 生效 |
| `memory.promptInterval`  | Phase 1 计数器 + Phase 3.2 记忆注入 → 生效 |

**验证**：编写测试用例确认每个字段在两条路径下的行为一致。

---

## 5. 实施顺序

```
Phase 1 ──────────────────┐
(LLM 计数器 #12)          │
                          ├──→ Phase 3 ──→ Phase 4
Phase 2 ──────────────────┘    (#2,#8,#14)  (#13 验证)
(Bridge 修复 #1,#3,#5)
```

- Phase 1 和 Phase 2 可并行
- Phase 3 依赖 Phase 1
- Phase 4 是验证阶段，依赖 Phase 1 + Phase 3

---

## 6. 涉及文件清单

| 文件                                | Phase | 改动类型                 |
| ----------------------------------- | ----- | ------------------------ |
| `src/group-chat/llm-agent-state.ts` | 1     | **新建**                 |
| `src/group-chat/agent-trigger.ts`   | 1, 3  | 修改                     |
| `src/group-chat/bridge-trigger.ts`  | 2     | 修改                     |
| `src/group-chat/context-builder.ts` | 3     | 修改                     |
| `src/group-chat/bridge-types.ts`    | —     | 无需修改（类型定义不变） |

---

## 7. 不修改项（设计合理的差异）

| #   | 维度          | 理由                                                                                                               |
| --- | ------------- | ------------------------------------------------------------------------------------------------------------------ |
| 4   | 通信指南      | Bridge Agent 通过 PTY stdin 注入 `#` 注释格式，不适合注入 Markdown 表格；LLM Agent 通过 system prompt 注入无此限制 |
| 7   | 项目文档      | Bridge Agent 需要知道文档路径以便 `cat` 读取；LLM Agent 由 pipeline 处理                                           |
| 9   | 对话历史      | 全量 vs 增量是 PTY 架构决定的；LLM 每次独立调用只能全量                                                            |
| 10  | Thinking 标签 | Bridge Agent 的 PTY 输出由外部 CLI 控制，无法在群聊模块层面去除                                                    |
| 11  | 单条消息截断  | Bridge Agent 的 PTY 输入有字符限制，LLM 由 token 限制自然控制                                                      |
