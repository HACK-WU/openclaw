# 群聊上下文管理

本文档说明群聊中 agent 被触发后，后台如何为每个 agent 构建上下文、如何管理对话历史、以及如何避免上下文混乱。

## 概览

群聊中每个 agent 被触发时，后台为其构建的上下文由三个独立层组成：

| 层               | 内容                                   | 隔离方式                                 |
| ---------------- | -------------------------------------- | ---------------------------------------- |
| System Prompt 层 | 群组信息、角色身份、成员列表、角色提示 | 按 agentId 独立构建                      |
| 对话历史层       | 群聊 transcript 中最近 30 条消息       | 共享 transcript，按 agentId 标注 `(you)` |
| LLM Session 层   | 模型的会话记忆、session transcript     | 按 `group:<groupId>:<agentId>` 隔离      |

## 触发流程

以一个典型场景为例：

> 群组成员：main（assistant）、coder（member）、reviewer（member）
>
> Owner 发送："帮我写一个排序算法并 review"

### 第一步：消息路由

Owner 的消息通过 `group.send` RPC 到达后端。后端根据消息模式和 @mention 决定路由目标：

- **unicast 模式**（无 @mention）→ 仅路由给 assistant（main）
- **broadcast 模式**（无 @mention）→ 路由给所有成员
- **有 @mention** → 仅路由给被 mention 的 agent

本例中 unicast 模式，消息路由给 main。

### 第二步：为 main 构建上下文

后台调用 `triggerAgentReasoning`，为 main 构建完整上下文：

**① System Prompt（群聊上下文注入）**

通过 `buildGroupChatContext` 为 main 生成独立的 system prompt 片段：

```
## Group Chat Context
You are currently in group chat "dev-team" (ID: xxx).
Your role: **Assistant (coordinator)**
Your agentId: `main`
Message mode: Unicast

### Group Members
- **Owner** (creator, human user)
- **main** — Assistant ← you
- **coder** — Member
- **reviewer** — Member

### Your Role
You are the assistant of this group chat — the central coordinator...

### Communication Guide
（@mention 语法规则）

### Important Constraints
（只读模式、响应规则等）
```

每个 agent 看到的 system prompt 中，**"← you" 标记不同、角色提示不同**。

**② 对话历史**

从群聊 transcript 中读取最近 30 条消息，格式化为：

```
[Owner]: 帮我写一个排序算法并 review
```

如果是后续触发，历史会包含之前的对话：

```
[Owner]: 帮我写一个排序算法并 review
[main]: 好的，让我来协调。@coder 请写一个快速排序。
[coder (you)]: 收到，以下是实现...
```

每个 agent 看到自己的消息标注为 `(you)`，其他 agent 的消息标注为对应的 agentId。

**③ 最终 Body 拼接**

```
{对话历史}

[Latest message]: {触发消息内容}
```

### 第三步：main 回复并 @mention 其他 agent

main 回复：

```
好的，让我来协调分工。
@coder
@reviewer
```

这条回复被写入 transcript，广播给前端。

### 第四步：前端检测 @mention 并转发

前端的 `detectAndForwardMentions` 检测到 main 的回复中 @coder 和 @reviewer，调用：

```
group.send(mentions: [coder, reviewer], skipTranscript: true)
```

`skipTranscript: true` 避免重复写入 transcript（main 的回复已经持久化了）。

### 第五步：后端串行触发 coder 和 reviewer

后端收到转发请求后，因为 dispatch mode 为 `mention`，走**串行触发**路径：

```
for (target of [coder, reviewer]) {
  snapshot = getTranscriptSnapshot(groupId)  // 每次重新读取
  await triggerAgentReasoning(target, snapshot, ...)
}
```

**关键：串行 `await`**——coder 完成后才触发 reviewer。这意味着：

- coder 拿到的 snapshot 不包含 reviewer 的回复
- reviewer 拿到的 snapshot 包含 coder 的回复

这保证了**后续 agent 能看到前面 agent 的讨论内容**。

## 上下文隔离机制

### 1. System Prompt 隔离

每个 agent 的 `GroupSystemPrompt` 由 `buildGroupChatContext` 按 agentId 独立生成。不同 agent 看到不同的：

- 角色标识（`Your role: Assistant` vs `Your role: Member`）
- 自我标记（成员列表中 `← you` 指向不同成员）
- 角色提示（assistant 有协调指令，member 有专业响应指令）
- 自定义 rolePrompt（可为每个 agent 配置独立的角色提示）

### 2. SessionKey 隔离

每个 agent 使用独立的 SessionKey：

```
main    → group:<groupId>:main
coder   → group:<groupId>:coder
reviewer → group:<groupId>:reviewer
```

SessionKey 决定了 LLM 的 session transcript 文件和 session entry 的存储位置。隔离后：

- 每个 agent 有独立的 session 文件（对话记忆不互相干扰）
- session 文件写锁不互相阻塞（避免串行触发时的锁竞争）
- 模型配置（thinking level、model override 等）互不影响

**如果不隔离**（所有 agent 共用 `group:<groupId>`），会导致：

- agent A 的 session transcript 中混入了 agent B 的对话，LLM 混淆身份
- 串行触发时 agent B 等待 agent A 的 session 文件锁释放，造成卡死
- 多个 agent 可能生成相同的回复（因为看到了相同的 session 上下文）

### 3. 对话历史中的思考内容清洗

agent 回复可能包含 `<think>` 标签的思考内容。在构建对话历史时：

```
msg.role === "assistant"
  → stripReasoningTagsFromText(msg.content, { mode: "strict" })
```

这确保其他 agent 在对话历史中**看不到**思考内容，只看到最终回复。避免思考内容干扰后续 agent 的推理。

### 4. 前端 @mention 防误触

agent 的回复中（包括思考内容）可能包含 `@agentId` 模式。前端在检测 @mention 前：

- `stripThinkingTags(message.content)` 清洗思考标签，避免思考中的 `@agentId` 触发转发
- 转发内容也使用清洗后的文本，不会把思考内容传递给下一个 agent

## 防循环保护

群聊中 agent 之间可以互相 @mention，存在无限循环的风险。系统在两个层面进行保护：

### 后端保护（anti-loop）

每个对话链维护 `ConversationChainState`：

- **maxRounds**（默认 10）：总触发轮次上限
- **maxConsecutive**（默认 3）：同一 agent 连续触发上限

每次触发前检查：超限则中止并广播系统消息。

### 前端保护（chain state）

前端维护独立的链状态：

- **MAX_CHAIN_FORWARDS = 10**：自动转发上限
- **MAX_CHAIN_DURATION_MS = 5 min**：链持续时间上限
- **firstTimeMention vs repeatedMention**：同一个 agent 在一条链中只会被首次 mention 触发，后续 @mention 存入 pending 队列

## Broadcast vs Mention 模式的上下文差异

|                             | Broadcast 模式             | Mention 模式（串行）      |
| --------------------------- | -------------------------- | ------------------------- |
| 触发方式                    | 并行 `Promise.allSettled`  | 串行 `for...await`        |
| Transcript snapshot         | **共享**同一个 snapshot    | **每次重新读取**          |
| 后续 agent 能否看到前序回复 | 不能（并行执行）           | 能（串行等待完成）        |
| 典型场景                    | 广播讨论（所有人同时回答） | @mention 协作（依次回答） |

## 流程图

```
Owner 发消息
  │
  ▼
group.send → handleGroupSend
  │
  ├─ 写入 transcript + 广播
  │
  ▼
resolveDispatchTargets
  │
  ├─ unicast → [assistant]
  ├─ broadcast → [所有成员]
  └─ mention → [被@的成员]
  │
  ▼
triggerAgentReasoning (per agent)
  │
  ├─① buildGroupChatContext(meta, agentId)
  │     → 独立的 system prompt（角色、成员、提示）
  │
  ├─② buildConversationHistory(snapshot, agentId)
  │     → 最近 30 条消息，自己标注 (you)
  │     → 思考内容已清洗
  │
  ├─③ buildGroupSessionKey(groupId, agentId)
  │     → 独立的 SessionKey，隔离 session 文件
  │
  ├─④ dispatchInboundMessage(ctx)
  │     → LLM 推理
  │
  ├─⑤ 流式广播 (group.stream delta/final)
  │
  └─⑥ appendGroupMessage → 写入 transcript
        → broadcastGroupMessage → 前端显示
```

## 涉及的核心模块

| 模块             | 文件                                  | 职责                                  |
| ---------------- | ------------------------------------- | ------------------------------------- |
| Context Builder  | `src/group-chat/context-builder.ts`   | 构建 per-agent system prompt          |
| Agent Trigger    | `src/group-chat/agent-trigger.ts`     | 构建完整上下文 + 触发 LLM             |
| Message Dispatch | `src/group-chat/message-dispatch.ts`  | 路由决策（unicast/broadcast/mention） |
| Transcript       | `src/group-chat/transcript.ts`        | JSONL 读写、snapshot                  |
| Session Key      | `src/group-chat/group-session-key.ts` | per-agent SessionKey 生成             |
| Role Prompt      | `src/group-chat/role-prompt.ts`       | 角色提示模板                          |
| Anti-Loop        | `src/group-chat/anti-loop.ts`         | 循环保护                              |
| Frontend Chain   | `ui/src/ui/controllers/group-chat.ts` | @mention 检测、链管理                 |
