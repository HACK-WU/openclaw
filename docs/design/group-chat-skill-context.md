# 多 Agent 群聊 — Skill 与上下文详细设计

> **关联需求**: [multi-agent-group-chat.md](./multi-agent-group-chat.md)
> **关联后端设计**: [group-chat-backend.md](./group-chat-backend.md)
> **版本**: v1.0 | **日期**: 2026-03-04

---

## 1. 概述

本文档涵盖群聊场景下 Agent 的 **Skill 体系**、**System Prompt 构建**、**职责提示词**、**工具策略**和**上下文压缩**的详细设计。

**核心设计原则**：

- 复用 `buildAgentSystemPrompt()` 的 `extraSystemPrompt` 注入群聊上下文
- 群聊 Skill 仅在群聊会话中生效
- 只读策略通过现有 Tool Policy Pipeline 的 `groupPolicy` 步骤实现
- 压缩核心算法复用 `compaction.ts`，定制群聊摘要 Prompt

---

## 2. group-chat-reply Skill

### 2.1 文件

```
skills/group-chat-reply/SKILL.md
```

### 2.2 SKILL.md 内容

Frontmatter: `name: group-chat-reply`, `always: false`, `emoji: "💬"`

正文内容告知 Agent：

1. 处于群聊只读模式
2. 必须用 `group_reply` 工具发送回复
3. 通过 `mentions` 参数 @ 其他 Agent
4. 避免循环、保持简洁

### 2.3 `group_reply` 工具定义 (`src/group-chat/tools/group-reply-tool.ts`)

```typescript
// 参数
type GroupReplyArgs = {
  message: string; // 回复内容，支持 Markdown
  mentions?: string[]; // 要 @ 的 agentId 列表
};

// 工厂函数，每次推理创建，绑定当前群聊上下文
function createGroupReplyTool(params: {
  groupId: string;
  agentId: string;
  onReply: (msg: string, mentions?: string[]) => Promise<{ messageId: string }>;
}): AgentTool;
```

### 2.4 Skill 注入规则

```
最终 Skill = Agent 自身 Skill + 群 Skill + group-chat-reply
```

在 `context-builder.ts` 中合并 Skill 列表后传入 `resolveSkillsPromptForRun()`。群 Skill 按名称从全局 Skill 库查找，去重合并。

---

## 3. System Prompt 构建 (`context-builder.ts`)

### 3.1 注入点

利用 `buildAgentSystemPrompt({ extraSystemPrompt })` → 渲染为 `## Group Chat Context` section（位置在 Skills 之后、Reactions 之前）。

### 3.2 extraSystemPrompt 结构

```markdown
## 群聊信息

你当前在群聊「{groupName}」(ID: {groupId}) 中。
你的身份是：**{助手/普通成员}**
你的 agentId 是：`{agentId}`
消息模式：{单播说明 / 广播说明}

### 群成员

- **Owner** (群创建者，人类用户)
- **{name}** (`{id}`) — {角色} {← 你}

### 群公告

{announcement，如果有}

### 你的职责

{职责提示词内容}

### 重要约束

- 只读模式，不可写文件/执行命令
- 使用 `group_reply` 工具发送消息
- 避免循环对话
```

### 3.3 核心函数

```typescript
export function buildGroupChatContext(params: { meta: GroupSessionEntry; agentId: string }): string;
```

按以上结构拼接各 section，返回完整字符串。

---

## 4. 职责提示词 (`role-prompt.ts`)

### 4.1 默认模板

| 角色         | 要点                                                |
| ------------ | --------------------------------------------------- |
| **助手**     | 核心协调者；处理 Owner 请求；协调成员协作；整合反馈 |
| **普通成员** | 响应 @ 消息；广播模式下积极讨论；专业领域内提供价值 |

### 4.2 解析优先级

1. 自定义职责提示词（`meta.memberRolePrompts` 中该 agentId 的 `rolePrompt`）
2. 对应角色的默认模板

### 4.3 角色变更自动切换

当助手与普通成员互换角色时，如果使用的是默认模板则自动切换为新角色的默认模板；自定义内容保持不变。

---

## 5. 工具策略 (`tool-policy.ts`)

### 5.1 只读策略

```typescript
export function buildGroupChatToolPolicy(): ToolPolicyLike {
  return {
    deny: [
      "write",
      "edit",
      "apply_patch",
      "exec",
      "bash",
      "process",
      "gateway",
      "cron",
      "agents_list",
      "sessions_send",
      "config",
      "canvas",
      "nodes",
      "message",
    ],
  };
}
```

`group_reply` 不在 deny 列表中 → 自动允许。

### 5.2 Pipeline 集成

利用现有 `buildDefaultToolPolicyPipelineSteps()` 第 7 步 `groupPolicy`，将只读策略注入。该步优先级最高。

### 5.3 工具注入

群聊 Agent 的工具列表 = 现有工具（经 Pipeline 过滤）+ `group_reply` 工具。

---

## 6. 上下文压缩 (`compaction.ts`)

### 6.1 复用现有算法

| 函数                            | 复用方式               |
| ------------------------------- | ---------------------- |
| `summarizeInStages()`           | 直接调用，传入群聊消息 |
| `summarizeWithFallback()`       | 直接调用               |
| `pruneHistoryForContextShare()` | 直接调用               |
| `estimateMessagesTokens()`      | 直接调用               |

### 6.2 群聊摘要 Prompt

关键差异：要求保留每段对话的**发言者标识**。

```
CRITICAL: For each key point, preserve WHO said it.
Format: [Owner]: ..., [AgentName (agentId)]: ...
Preserve: decisions, action items, data points, unresolved questions, conversation flow.
```

### 6.3 消息转换

将 `GroupChatMessage[]` 转为 `AgentMessage[]` 时，在 content 前加 `[Owner]` 或 `[AgentName]` 前缀。

### 6.4 压缩存储

```
~/.openclaw/group-chats/<groupId>/compaction-summary.json
```

内容：`{ summary, compactedAt, droppedMessageCount, keptMessageCount }`

### 6.5 触发条件

与单聊一致：当 Transcript Token 数 > `contextWindow * maxHistoryShare` 时触发。

### 6.6 Context Pruning

直接继承现有 Pi extension 的 Context Pruning 能力（soft trim / hard clear），无需定制。群聊 Agent 推理走 `runAgentTurnWithFallback()`，自动生效。

---

## 7. 历史消息注入

### 7.1 策略

```typescript
export function buildGroupChatHistory(params: {
  groupId: string;
  meta: GroupSessionEntry;
}): AgentMessage[] {
  const messages: AgentMessage[] = [];

  // 1. 压缩摘要（如果有）
  const summary = loadCompactionSummary(groupId);
  if (summary) {
    messages.push({ role: "system", content: `[Previous conversation summary]\n${summary}` });
  }

  // 2. 最近 historyLimit 条消息
  const recent = readGroupMessages(groupId, meta.historyLimit);
  for (const msg of recent) {
    const prefix =
      msg.sender.type === "owner" ? "[Owner]" : `[${msg.sender.agentName ?? msg.sender.agentId}]`;
    messages.push({
      role: msg.role,
      content: `${prefix} ${msg.content}`,
    });
  }

  return messages;
}
```

### 7.2 Token 预算

历史消息的 Token 预算 = `contextWindow * maxHistoryShare`（默认 50%）。超出预算时自动触发 compaction 或 pruning。

---

## 8. 完整推理上下文组装流程

```
Agent 被触发推理
      │
      ▼
1. buildGroupChatContext()
   → extraSystemPrompt（群聊信息 + 成员 + 公告 + 职责 + 约束）
      │
      ▼
2. resolveGroupChatSkills()
   → Agent Skill + 群 Skill + group-chat-reply
      │
      ▼
3. resolveSkillsPromptForRun()
   → skillsPrompt 字符串
      │
      ▼
4. buildGroupChatToolPolicy()
   → groupPolicy（deny 变更类工具）
      │
      ▼
5. prepareGroupChatTools()
   → baseTools + group_reply 工具
      │
      ▼
6. buildGroupChatHistory()
   → [压缩摘要] + [最近 N 条消息]
      │
      ▼
7. buildAgentSystemPrompt({
     extraSystemPrompt,    ← 来自步骤 1
     skillsPrompt,         ← 来自步骤 3
     toolNames,            ← 来自步骤 5
   })
   → 完整 System Prompt
      │
      ▼
8. getReplyFromConfig({
     systemPrompt,
     history,              ← 来自步骤 6
     tools,                ← 来自步骤 5
     groupToolPolicy,      ← 来自步骤 4
   })
   → Agent 推理执行
```

---

## 9. 对现有代码的改动清单

| 文件                                       | 改动类型 | 改动量  | 说明                                   |
| ------------------------------------------ | -------- | ------- | -------------------------------------- |
| `src/agents/skills/workspace.ts`           | 微改     | ~5 行   | 导出 `loadSkillEntries` 供群聊模块调用 |
| `src/agents/system-prompt.ts`              | 无改动   | 0       | 通过 `extraSystemPrompt` 参数注入      |
| `src/agents/compaction.ts`                 | 无改动   | 0       | 仅作为依赖引用                         |
| `src/agents/tool-policy-pipeline.ts`       | 无改动   | 0       | `groupPolicy` 步骤已存在               |
| `src/agents/tool-mutation.ts`              | 无改动   | 0       | 仅读取常量                             |
| **新增文件**                               |          |         |
| `src/group-chat/context-builder.ts`        | 新增     | ~150 行 | 群聊上下文构建                         |
| `src/group-chat/role-prompt.ts`            | 新增     | ~80 行  | 职责提示词管理                         |
| `src/group-chat/tool-policy.ts`            | 新增     | ~40 行  | 只读工具策略                           |
| `src/group-chat/compaction.ts`             | 新增     | ~120 行 | 群聊压缩适配                           |
| `src/group-chat/tools/group-reply-tool.ts` | 新增     | ~50 行  | group_reply 工具定义                   |
| `skills/group-chat-reply/SKILL.md`         | 新增     | ~50 行  | Skill 定义文件                         |
