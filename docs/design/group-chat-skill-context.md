# 多 Agent 群聊 — Skill 与上下文详细设计（v2 前端驱动方案）

> **关联需求**: [multi-agent-group-chat.md](./multi-agent-group-chat.md)
> **关联后端设计**: [group-chat-backend.md](./group-chat-backend.md)
> **版本**: v2.0 | **日期**: 2026-03-06

---

## 1. 概述

本文档涵盖群聊场景下 Agent 的 **Skill 体系**、**System Prompt 构建**、**职责提示词**、**工具策略**以及 **Agent 间消息转发**的详细设计。

### 1.1 核心设计原则

- **前端驱动**：Agent 间的对话链路由前端检测和转发，后台不做自动 dispatch
- **零专用工具**：不需要 `group_reply` 工具，Agent 直接在回复文本中用特殊标记 `<<@agentId>>` 来 @提及其他成员
- **所见即所得**：所有 Agent 间的对话对用户完全可见，等价于用户手动操作
- **后台兜底**：后台提供频次限流，防止前端异常导致死循环

### 1.2 与 v1 设计的主要差异

| 维度         | v1（后台驱动）                  | v2（前端驱动）                             |
| ------------ | ------------------------------- | ------------------------------------------ |
| Agent 间对话 | 后台 `group_reply` 工具递归触发 | 前端检测 `<<@>>` 标记后模拟发送            |
| 专用工具     | 需要 `group-reply-tool.ts`      | ❌ 不需要                                  |
| Skill 合并   | `resolveGroupChatSkills()`      | ❌ 不需要，仅更新 SKILL.md 内容            |
| 压缩适配     | `compaction.ts` 群聊定制        | ❌ 不需要，复用现有 compaction             |
| 历史注入     | `buildGroupChatHistory()`       | ❌ 不需要，`agent-trigger.ts` 现有逻辑足够 |
| 后台改动量   | ~440 行新增                     | ~20 行修改                                 |
| 对话可见性   | 后台黑盒递归，前端只看到结果    | 全链路前端可见                             |

---

## 2. group-chat-reply Skill

### 2.1 文件

```
skills/group-chat-reply/SKILL.md
```

### 2.2 SKILL.md 内容

Frontmatter: `name: group-chat-reply`, `always: false`, `emoji: "💬"`

正文核心内容（需要更新）：

```markdown
# Group Chat Reply

You are currently participating in a **group chat** with multiple agents and a human Owner.

## Communication Rules

1. **Reply directly** — your response text is your message in this group chat
2. **To mention another agent**, use the special marker format `<<@agentId>>` in your reply text
   - Example: `<<@backend>> please check the database connection pool config`
   - Only use agentIds that exist in the group member list
   - The `<<@agentId>>` marker will be displayed as `@agentId` in the chat UI
3. **Do NOT reply if not addressed** — in unicast mode, only respond when you are the designated recipient or @-mentioned
4. **Avoid circular conversations** — if the task is complete, do not continue mentioning others

## Mention Format

CRITICAL: When you need to direct a message to another agent, you MUST use the double angle bracket format:

✅ Correct: `<<@main>>` `<<@backend>>` `<<@test>>`
❌ Wrong: `@main` `@backend` (plain @ will NOT trigger routing)

## Read-Only Mode

You are operating in **read-only mode** within this group chat:

- ✅ You CAN: read files, search, query status, use memory
- ❌ You CANNOT: write files, execute commands, modify configurations, send messages to other sessions

## Best Practices

- Keep replies concise and focused on the topic
- When you need another agent's expertise, use `<<@agentId>>` with a clear request
- If you're the assistant (coordinator), help integrate responses from other members
- If you're a regular member, contribute your expertise when asked
- Do NOT mention agents unnecessarily — only when their input is actually needed
```

### 2.3 Skill 注入规则

不需要额外的 Skill 合并逻辑。`group-chat-reply` Skill 通过现有的 `skillFilter` 机制在群聊推理时注入（`agent-trigger.ts` 已有 `skillFilter: meta.groupSkills`）。

---

## 3. System Prompt 构建 (`context-builder.ts`)

### 3.1 注入点

不变：利用 `buildAgentSystemPrompt({ extraSystemPrompt })` → 渲染为 `## Group Chat Context` section。

### 3.2 extraSystemPrompt 结构

```markdown
## Group Chat Context

You are currently in group chat "{groupName}" (ID: {groupId}).
Your role: **{Assistant (coordinator) / Member}**
Your agentId: `{agentId}`
Message mode: {Unicast / Broadcast 说明}

### Group Members

- **Owner** (creator, human user)
- **{agentId}** — {role} {← you}

### Group Announcement

{announcement，如果有}

### Your Role

{职责提示词内容}

### Important Constraints

- You are in **read-only mode**: you cannot write files, execute commands, or modify configurations
- To mention another agent, use `<<@agentId>>` format (e.g. `<<@main>>`)
- Plain `@agentId` will NOT trigger message routing — you MUST use `<<@agentId>>`
- Avoid circular conversations — if the task is done, stop replying
- Keep responses concise and focused
```

### 3.3 核心函数

```typescript
export function buildGroupChatContext(params: { meta: GroupSessionEntry; agentId: string }): string;
```

**需要修改**：将第 5 节 Constraints 中关于 `group_reply` 工具的描述替换为 `<<@agentId>>` 标记格式的说明。

---

## 4. 职责提示词 (`role-prompt.ts`)

### 4.1 默认模板

无变化：

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

无变化。`group_reply` 工具已不需要，deny 列表无需为其留白：

```typescript
const GROUP_CHAT_DENY_TOOLS = [
  "write",
  "edit",
  "apply_patch",
  "exec",
  "bash",
  "process",
  "message",
  "sessions_send",
  "cron",
  "gateway",
  "canvas",
  "nodes",
  "config",
  "session_status",
];

export function buildGroupChatToolPolicy(): ToolPolicyLike {
  return { deny: GROUP_CHAT_DENY_TOOLS };
}
```

### 5.2 Pipeline 集成

无变化：利用现有 `buildDefaultToolPolicyPipelineSteps()` 第 7 步 `groupPolicy`。

---

## 6. 前端 `<<@>>` 检测与自动转发

> 这是 v2 方案的核心新增模块，全部在前端实现。

### 6.1 整体流程

```
Owner 发消息 "帮我分析一下这个 bug"
    │
    ▼
前端 group.send(sender: owner) → 后台写 transcript → 广播 → dispatch → 触发 Agent A
    │
    ▼
Agent A 流式回复: "我看了日志，是数据库问题。<<@backend>> 请查一下连接池。"
    │
    ▼
后台 appendGroupMessage(Agent A 回复) → broadcastGroupMessage → 前端收到
    │
    ▼
前端渲染 Agent A 回复（已在聊天窗口显示）
    │
    ▼
前端检测到回复中包含 <<@backend>>
    │
    ▼
构造转发消息:
  sender: { type: "agent", agentId: "agentA" }
  message: "我看了日志，是数据库问题。@backend 请查一下连接池。"   ← <<@>> 替换为 @
  mentions: ["backend"]
  skipTranscript: true   ← 标记跳过重复写入
    │
    ▼
调用 group.send（不渲染，因为回复已渲染过）
    │
    ▼
后台收到 → 跳过 transcript 写入和广播 → dispatch → 触发 Agent B 推理
    │
    ▼
Agent B 回复 → 正常写入 + 广播 → 前端渲染
    │
    ▼
前端继续检测 Agent B 回复中是否有 <<@>>...
```

### 6.2 特殊标记格式

**格式**: `<<@agentId>>`

**设计理由**:

| 候选方案     | 格式                      | 问题                                                  |
| ------------ | ------------------------- | ----------------------------------------------------- |
| 普通 @       | `@main`                   | 太常见，引用别人话时误触                              |
| HTML 标签    | `<mention>main</mention>` | Markdown 渲染干扰                                     |
| 方括号       | `[@main]`                 | Markdown link 语法冲突                                |
| **双尖括号** | **`<<@main>>`**           | ✅ 极少在自然文本中出现，正则简单，LLM 容易理解和生成 |

**匹配正则**: `/<<@(\S+?)>>/g`

### 6.3 前端检测逻辑（`controllers/group-chat.ts`）

新增函数 `detectAndForwardMentions()`：

```typescript
/** Mention marker pattern: <<@agentId>> */
const MENTION_MARKER_RE = /<<@(\S+?)>>/g;

/**
 * Detect <<@agentId>> markers in an agent's reply and auto-forward
 * the message to trigger the mentioned agents.
 *
 * Called after a group.message event is received and rendered.
 */
export async function detectAndForwardMentions(
  host: GroupHost,
  message: GroupChatMessage,
): Promise<void> {
  // Only process agent messages
  if (message.sender.type !== "agent") return;
  if (!host.client || !host.connected || !host.activeGroupMeta) return;

  const meta = host.activeGroupMeta;
  const matches = [...message.content.matchAll(MENTION_MARKER_RE)];
  if (matches.length === 0) return;

  // Extract valid agentIds (must be current group members, exclude sender)
  const senderAgentId = message.sender.agentId;
  const mentionedIds = [
    ...new Set(
      matches
        .map((m) => m[1])
        .filter((id) => id !== senderAgentId && meta.members.some((m) => m.agentId === id)),
    ),
  ];

  if (mentionedIds.length === 0) return;

  // Replace <<@agentId>> → @agentId for the forwarded message
  const forwardedText = message.content.replace(MENTION_MARKER_RE, "@$1");

  // Forward: reuse group.send with sender set to the replying agent
  // skipTranscript: true → backend skips duplicate write + broadcast
  try {
    await host.client.request("group.send", {
      groupId: message.groupId,
      message: forwardedText,
      sender: { type: "agent", agentId: senderAgentId },
      mentions: mentionedIds,
      skipTranscript: true,
    });
  } catch (err) {
    console.error("[group-chat] forward mention failed:", err);
  }
}
```

### 6.4 触发时机

在 `handleGroupMessageEvent()` 中，当收到 Agent 消息后调用检测。

**关键要求（新增）**：`<<@agentId>>` 解析必须在**该条消息完整渲染完成后**才执行，禁止在流式增量（delta/chunk）阶段解析，避免同一条消息被重复触发转发。

实现约束：

1. 流式阶段只更新 UI，不做 `detectAndForwardMentions()`。
2. 仅在消息进入 final/done 状态且完成最终渲染后执行一次解析。
3. 对同一 `message.id` 做幂等保护（已解析过则直接跳过）。

```typescript
const parsedMentionMessageIds = new Set<string>();

export function handleGroupMessageEvent(
  host: GroupChatState,
  payload: { groupId: string } & GroupChatMessage,
): void {
  if (payload.groupId !== host.activeGroupId) return;

  // 流式增量仅用于更新渲染，不触发 mention 解析
  if (!isFinalizedGroupMessage(payload)) {
    upsertStreamingGroupMessage(host, payload);
    return;
  }

  // Final message：写入最终内容并确保已完成渲染
  upsertFinalGroupMessage(host, payload);

  // 幂等：同一消息只解析一次
  if (parsedMentionMessageIds.has(payload.id)) return;
  parsedMentionMessageIds.add(payload.id);

  if (payload.sender.type === "agent") {
    detectAndForwardMentions(host as GroupHost, payload);
  }
}
```

> 注：`isFinalizedGroupMessage()` / `upsertStreamingGroupMessage()` / `upsertFinalGroupMessage()` 为示意函数，实际可按现有事件模型（例如 done 标记、最终帧事件或 message.completed 回调）落地。

### 6.5 渲染处理

在消息渲染函数 `renderGroupMessage()` 中，将 `<<@agentId>>` 替换为高亮的 `@agentId` 样式：

```typescript
// Before rendering markdown, replace markers for display
const displayContent = msg.content.replace(/<<@(\S+?)>>/g, "@$1");
const contentHtml = toSanitizedMarkdownHtml(displayContent);
```

### 6.6 前端防循环

限制绑定的是"一条对话链"——从 Owner 发消息开始，Agent 之间不断 `<<@>>` 互相触发所产生的连续转发。有两个维度的限制：

- **次数限制**：单条链最多 N 次转发
- **时间限制**：单条链持续时间不能超过 T 秒

任一维度触发即停止转发，并在 UI 显示提示。

```typescript
/** Per-group chain state */
type ChainState = { count: number; startedAt: number };
const groupChainStates = new Map<string, ChainState>();

const MAX_CHAIN_FORWARDS = 10; // 最多 10 次转发
const MAX_CHAIN_DURATION_MS = 5 * 60_000; // 单条链最长 5 分钟

/**
 * Reset chain state — called when:
 * 1. Owner sends a new message (new conversation round)
 * 2. An agent reply has no <<@>> markers (chain naturally ends)
 */
export function resetChainState(groupId: string): void {
  groupChainStates.delete(groupId);
}

// Inside detectAndForwardMentions():
const chain = groupChainStates.get(message.groupId);
const now = Date.now();

// Check count limit
if (chain && chain.count >= MAX_CHAIN_FORWARDS) {
  showChainLimitMessage(
    host,
    message.groupId,
    `⚠️ Auto-forward limit reached (${MAX_CHAIN_FORWARDS} rounds). ` +
      `Agents will no longer be automatically triggered. ` +
      `You can send a new message to start a fresh conversation.`,
  );
  return;
}

// Check duration limit
if (chain && now - chain.startedAt >= MAX_CHAIN_DURATION_MS) {
  showChainLimitMessage(
    host,
    message.groupId,
    `⚠️ Conversation chain timeout (exceeded ${MAX_CHAIN_DURATION_MS / 60_000} minutes). ` +
      `Auto-forwarding has been stopped. ` +
      `You can send a new message to start a fresh conversation.`,
  );
  return;
}

// Update chain state
groupChainStates.set(message.groupId, {
  count: (chain?.count ?? 0) + 1,
  startedAt: chain?.startedAt ?? now, // 首次转发记录开始时间
});
```

辅助函数：

```typescript
function showChainLimitMessage(host: GroupHost, groupId: string, content: string): void {
  const limitMsg: GroupChatMessage = {
    id: `sys-chain-limit-${Date.now()}`,
    groupId,
    role: "system",
    content,
    sender: { type: "system" },
    serverSeq: 0,
    timestamp: Date.now(),
  };
  host.groupMessages = [...host.groupMessages, limitMsg];
}
```

清零时机：

```typescript
// 1. Owner 手动发消息时 → 新一轮对话开始
export async function sendGroupMessage(host, groupId, message, mentions?) {
  resetChainState(groupId); // ← 新增
  // ... 现有逻辑 ...
}

// 2. Agent 回复无 <<@>> 时 → 链条自然结束
// 在 detectAndForwardMentions() 中，matches.length === 0 时自动清零：
if (matches.length === 0) {
  resetChainState(message.groupId);
  return;
}
```

---

## 7. 后台改动

### 7.1 `handleGroupSend` 增加 `skipTranscript` 支持

在 `src/gateway/server-methods/group.ts` 的 `handleGroupSend` 中：

```typescript
// 当前端以 Agent 身份转发已有消息时，跳过重复写入和广播
const skipTranscript = params.skipTranscript === true && resolvedSender.type === "agent";

if (!skipTranscript) {
  // 正常流程：写 transcript + 广播
  const savedMsg = await appendGroupMessage(groupId, msg);
  respond(true, { messageId: savedMsg.id });
  broadcastGroupMessage(context.broadcast, groupId, savedMsg);
} else {
  // 跳过写入和广播，只做 dispatch
  respond(true, { messageId: msg.id });
}

// Dispatch 逻辑照常执行
```

**改动量**: ~8 行

### 7.2 后台防循环限流

后台的防循环同样绑定"对话链"，同时有次数和时间两个维度的限制。当 Owner 发消息（`sender.type === "owner"`）时重置。

```typescript
/** Per-group chain state for agent sends */
type BackendChainState = { count: number; startedAt: number };
const agentChainStates = new Map<string, BackendChainState>();

const AGENT_CHAIN_MAX = 20; // 每条链最多 20 次
const AGENT_CHAIN_MAX_DURATION_MS = 10 * 60_000; // 每条链最长 10 分钟

function resetAgentChainState(groupId: string): void {
  agentChainStates.delete(groupId);
}

function checkAgentChainLimit(groupId: string): { ok: boolean; reason?: string } {
  const now = Date.now();
  const chain = agentChainStates.get(groupId);

  if (chain) {
    if (chain.count >= AGENT_CHAIN_MAX) {
      return { ok: false, reason: "count" };
    }
    if (now - chain.startedAt >= AGENT_CHAIN_MAX_DURATION_MS) {
      return { ok: false, reason: "timeout" };
    }
  }

  agentChainStates.set(groupId, {
    count: (chain?.count ?? 0) + 1,
    startedAt: chain?.startedAt ?? now,
  });
  return { ok: true };
}
```

在 `handleGroupSend` 中的使用：

```typescript
// Owner 发消息 → 重置对话链状态
if (resolvedSender.type === "owner") {
  resetAgentChainState(groupId);
}

// Agent 发消息 → 检查对话链限制（次数 + 时间）
if (resolvedSender.type === "agent") {
  // ... 现有的成员校验 ...

  const chainCheck = checkAgentChainLimit(groupId);
  if (!chainCheck.ok) {
    const detail =
      chainCheck.reason === "timeout"
        ? "chain duration exceeded maximum time limit"
        : "too many agent-to-agent forwards in this conversation";
    respond(false, undefined, {
      message: `Chain limit: ${detail}`,
      code: 429,
    });
    return;
  }
}
```

前端收到 429 错误时，在 `detectAndForwardMentions()` 的 catch 中显示提示：

```typescript
catch (err) {
  // Show rate limit message to user
  const errMsg = err instanceof Error ? err.message : String(err);
  if (errMsg.includes("Chain limit") || errMsg.includes("429")) {
    showChainLimitMessage(host, message.groupId,
      `⚠️ Server-side chain limit reached. Agent auto-forwarding has been stopped. ` +
      `Send a new message to start a fresh conversation round.`);
  } else {
    console.error("[group-chat] forward mention failed:", err);
  }
}
```

**改动量**: ~30 行

---

## 8. 完整推理上下文组装流程（更新后）

```
Agent 被触发推理（由 handleGroupSend dispatch 发起）
      │
      ▼
1. buildGroupChatContext()
   → extraSystemPrompt（群聊信息 + 成员 + 公告 + 职责 + 约束 + <<@>> 格式说明）
      │
      ▼
2. buildGroupChatToolPolicy()
   → groupPolicy（deny 变更类工具，无需保留 group_reply）
      │
      ▼
3. buildConversationHistory()              ← 现有 agent-trigger.ts 中的简化版
   → 最近 30 条消息的 [sender]: content 格式
      │
      ▼
4. buildAgentSystemPrompt({
     extraSystemPrompt,    ← 来自步骤 1
   })
   → 完整 System Prompt
      │
      ▼
5. dispatchInboundMessage({
     ctx,                  ← MsgContext with GroupSystemPrompt
     cfg,
     dispatcher,
     replyOptions,         ← 包含 skillFilter
   })
   → Agent 推理执行
      │
      ▼
6. Agent 回复写入 transcript + 广播给前端
      │
      ▼
7. 前端检测回复中的 <<@agentId>> 标记
      │
      ▼
8. 如有匹配 → 前端调用 group.send(skipTranscript: true) → 触发被 @ 的 Agent
   如无匹配 → 对话结束
```

相比 v1 的 8 步流程，v2 移除了 `resolveGroupChatSkills()`、`prepareGroupChatTools()`、`buildGroupChatHistory()` 三个函数，改为利用现有实现 + 前端检测。

---

## 9. 对现有代码的改动清单

| 文件                                  | 改动类型 | 改动量 | 说明                                                                    |
| ------------------------------------- | -------- | ------ | ----------------------------------------------------------------------- |
| `skills/group-chat-reply/SKILL.md`    | **修改** | ~30 行 | 移除 `group_reply` 工具描述，改为 `<<@agentId>>` 标记格式               |
| `src/group-chat/context-builder.ts`   | **修改** | ~5 行  | Constraints 中 `group_reply` → `<<@agentId>>` 说明                      |
| `src/gateway/server-methods/group.ts` | **修改** | ~38 行 | 增加 `skipTranscript` + 对话链防循环（次数+时间）+ Owner 发消息时清零   |
| `ui/src/ui/controllers/group-chat.ts` | **修改** | ~80 行 | 新增 `detectAndForwardMentions()` + 对话链防循环（次数+时间）+ 限制提示 |
| `ui/src/ui/views/group-chat.ts`       | **修改** | ~3 行  | 渲染时 `<<@agentId>>` → `@agentId` 高亮显示                             |

### 不再需要的文件（v1 计划但 v2 不需要）

| 文件                                           | 说明        |
| ---------------------------------------------- | ----------- |
| ~~`src/group-chat/tools/group-reply-tool.ts`~~ | ❌ 不再需要 |
| ~~`src/group-chat/compaction.ts`~~             | ❌ 不再需要 |
| ~~`resolveGroupChatSkills()`~~                 | ❌ 不再需要 |
| ~~`buildGroupChatHistory()`~~                  | ❌ 不再需要 |
| ~~`prepareGroupChatTools()`~~                  | ❌ 不再需要 |

---

## 10. 风险与缓解措施

### 10.1 前端离线/断连时的转发丢失

**风险**：如果前端在收到 Agent 回复后断连，`<<@>>` 检测不会执行，被 @ 的 Agent 不会被触发。

**缓解**：这与用户手动操作的行为一致 — 如果用户不在线，自然不会手动 @别人。重连后用户可以手动触发。

### 10.2 LLM 不遵循 `<<@>>` 格式

**风险**：某些 LLM 可能输出普通的 `@agentId` 而非 `<<@agentId>>`。

**缓解**：

- Skill 和 System Prompt 中反复强调格式要求
- `<<@>>` 格式简单直观，主流 LLM 都能遵循
- 如果 Agent 用了普通 `@`，消息仍然正常显示，只是不会自动触发路由（降级为用户手动处理）

### 10.3 防循环双重保障

两层限制都绑定"对话链"概念，每条链有**次数**和**时间**两个维度的上限。

| 层   | 机制               | 次数上限 | 时间上限 | 清零条件                            | 触发限制时                 |
| ---- | ------------------ | -------- | -------- | ----------------------------------- | -------------------------- |
| 前端 | `groupChainStates` | 10 次    | 5 分钟   | Owner 发消息 / Agent 回复无 `<<@>>` | 聊天窗口显示系统消息       |
| 后台 | `agentChainStates` | 20 次    | 10 分钟  | Owner 发消息                        | 返回 429，前端显示系统消息 |

两层独立运作，任一层的任一维度触发即停止，并在前端 UI 明确告知用户。

**前端限制更紧（10 次 / 5 分钟）**：作为主要控制手段，快速响应。
**后台限制更宽（20 次 / 10 分钟）**：作为兜底安全阀，防止前端异常/绕过。

用户看到提示后可以：

- 发送新消息，自动开启新的对话链（状态清零）
- 手动 @某个 Agent 继续之前的话题
