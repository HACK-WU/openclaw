# 架构分析与可行性评估

> 本文档分析 Bridge Agent 与现有群聊架构的兼容性，评估各部分的改动范围。

## 1. 当前架构分析

### 1.1 Agent 触发链路（现有）

```
group.send(message, mentions)
     │
     ▼
handleGroupSend()              ← src/gateway/server-methods/group.ts
     │
     ├─ appendGroupMessage()   ← 写入 transcript
     ├─ broadcastGroupMessage() ← WS 广播到 UI
     │
     ▼
resolveDispatchTargets()       ← src/group-chat/message-dispatch.ts
     │
     ▼
triggerAgentReasoning()        ← src/group-chat/agent-trigger.ts  ⬅ 关键决策点
     │
     ├─ buildGroupChatContext()    ← system prompt
     ├─ buildConversationHistory() ← 最近 30 条消息
     ├─ dispatchInboundMessage()   ← 调用 LLM 推理
     │     └─ getReplyFromConfig() ← 最终调用 LLM API
     │
     ├─ appendGroupMessage()       ← 回复写入 transcript
     └─ broadcastGroupStream()     ← 流式广播到 UI
```

### 1.2 关键架构特征

| 特征           | 现状                                        | 对 Bridge 的影响             |
| -------------- | ------------------------------------------- | ---------------------------- |
| Agent 成员类型 | `GroupMember = { agentId, role, joinedAt }` | ❓ 需扩展标识 Bridge Agent   |
| 触发入口       | `triggerAgentReasoning()` 统一入口          | ✅ 可在此分叉                |
| 消息格式       | `GroupChatMessage` 统一格式                 | ✅ Bridge 回复用同一格式     |
| 流式广播       | `group.stream` (delta/final)                | ❓ CLI 输出需适配流式        |
| 工具卡片       | `GroupToolCall[]`                           | ❓ CLI 的工具调用如何映射    |
| 防循环         | `anti-loop.ts` 基于 roundCount              | ✅ Bridge Agent 同样受限     |
| read-only 策略 | `tool-policy.ts` deny 列表                  | ⚠️ Bridge Agent 需豁免       |
| 上下文注入     | `context-builder.ts` + `role-prompt.ts`     | ❓ Bridge 不走 system prompt |
| Skill 过滤     | `meta.groupSkills` 过滤                     | ❓ Bridge 不使用 Skill       |
| Session Key    | `group:<groupId>:<agentId>`                 | ✅ Bridge 可复用             |
| Abort 机制     | `AbortController` per run                   | ✅ 可用于 kill CLI 进程      |

### 1.3 `triggerAgentReasoning()` 分析

这是**唯一需要改动的核心函数**。当前实现（437 行）做了以下事情：

1. **生成 runId** → Bridge 可复用
2. **构建 groupChatSystemPrompt** → Bridge 不需要（外部 CLI 有自己的 system prompt）
3. **构建 conversationHistory** → Bridge 需要，作为上下文传给 CLI
4. **broadcastGroupStream(delta)** → Bridge 需要，用于 UI 显示进度
5. **调用 dispatchInboundMessage()** → Bridge 替换为 CLI 通信 ⬅ 核心替换点
6. **收集 replyText + toolCollector** → Bridge 需要适配
7. **appendGroupMessage()** → Bridge 可复用
8. **broadcastGroupStream(final)** → Bridge 可复用

**结论**：只需要替换步骤 5，其他步骤全部复用。

---

## 2. 可行性评估

### 2.1 ✅ 高可行性的部分

#### 2.1.1 消息分发（零改动）

`resolveDispatchTargets()` 不关心 Agent 类型，只关心 `agentId` 是否在 `members` 列表中。Bridge Agent 和内部 Agent 在分发层面完全一致。

#### 2.1.2 Transcript 和广播（零改动）

`appendGroupMessage()` 和 `broadcastGroupMessage()` 只关心 `GroupChatMessage` 格式，与 Agent 实现无关。

#### 2.1.3 防循环机制（零改动）

`anti-loop.ts` 只跟踪 `agentId` 和 `roundCount`，不关心触发方式。

#### 2.1.4 前端 `@mention` 转发（零改动）

前端的 `detectAndForwardMentions()` 只检测回复文本中的 `@agentId`，不关心回复来源。Bridge Agent 的回复格式与内部 Agent 完全一致。

#### 2.1.5 Session Key（零改动）

`buildGroupSessionKey(groupId, agentId)` 纯字符串拼接，Bridge Agent 可直接使用。

### 2.2 ⚠️ 需要适配但可行的部分

#### 2.2.1 Agent 类型扩展

**当前**：

```typescript
// types.ts
export type GroupMember = {
  agentId: string;
  role: GroupMemberRole; // "assistant" | "member"
  joinedAt: number;
};
```

**需要扩展**：

```typescript
export type GroupMember = {
  agentId: string;
  role: GroupMemberRole;
  joinedAt: number;
  // ─── Bridge Agent 新增字段 ───
  bridge?: BridgeConfig; // 存在则为 Bridge Agent
};

export type BridgeConfig = {
  type: "claude-code" | "opencode" | "custom";
  command: string; // CLI 可执行文件路径或命令名
  args?: string[]; // 额外启动参数
  cwd?: string; // 工作目录（默认当前项目）
  env?: Record<string, string>; // 环境变量
  timeout?: number; // 单次回复超时 (ms)，默认 300_000 (5 分钟)
};
```

**影响评估**：

- `meta.json` 格式向后兼容（`bridge` 是可选字段，旧数据无此字段）
- `group-store.ts` 的 CRUD 不需要改动（透传 JSON）
- UI 需要在创建群聊/添加成员时提供 Bridge 配置入口

#### 2.2.2 触发分叉（核心改动）

在 `agent-trigger.ts` 中增加判断：

```typescript
// agent-trigger.ts
export async function triggerAgentReasoning(
  params: TriggerAgentParams,
): Promise<TriggerAgentResult> {
  const { agentId, meta } = params;

  // 查找该 agent 是否是 Bridge Agent
  const member = meta.members.find((m) => m.agentId === agentId);
  if (member?.bridge) {
    // 走 Bridge 通道
    return triggerBridgeAgent(params, member.bridge);
  }

  // 走现有 LLM 推理通道（现有代码不变）
  return triggerInternalAgent(params);
}
```

**改动量**：~8 行判断逻辑，现有代码整体移入 `triggerInternalAgent()`。

---

## 3. 与现有系统的兼容性

### 3.1 向后兼容性 ✅

| 维度           | 影响                                                  |
| -------------- | ----------------------------------------------------- |
| 现有群聊       | 无影响（`bridge` 字段可选，不存在时走现有逻辑）       |
| meta.json 格式 | 向后兼容（新增可选字段）                              |
| 前端 UI        | 向后兼容（Bridge 标识为增量展示）                     |
| RPC 接口       | 向后兼容（`group.addMembers` 增加可选 `bridge` 参数） |

### 3.2 与发起者汇总机制的兼容性 ✅

汇总机制完全适用于 Bridge Agent：

- Bridge Agent 的回复也走 `appendGroupMessage()` → 前端收到 `group.message` 事件
- 前端的 `detectAndForwardMentions()` 对 Bridge Agent 的回复同样有效
- `scheduleSummaryCheck()` 的"UI 空闲检测"对 Bridge Agent 同样有效
- `executeSummaryFlow()` 的两阶段设计对 Bridge Agent 透明

### 3.3 与 AgentConfig 的关系

现有 `AgentConfig`（`src/config/types.agents.ts`）中的 `runtime` 字段已经有了 `"acp"` 模式的概念：

```typescript
export type AgentRuntimeConfig =
  | { type: "embedded" }
  | { type: "acp"; acp?: AgentRuntimeAcpConfig };
```

Bridge Agent 可以视为第三种 runtime 类型，但**不建议**复用 `AgentConfig.runtime`，原因：

1. `AgentConfig` 是全局 agent 配置，而 Bridge 配置是**群聊级别**的
2. 同一个 agentId 可能在不同群聊中以不同方式参与（在群 A 是内部 Agent，在群 B 是 Bridge）
3. Bridge 配置应该存储在 `GroupMember.bridge` 中，随群聊元数据持久化
