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

#### 2.1.2 辅助 Agent 的 agentId 标识设计

**标识方案**：辅助 Agent 的 `agentId` 必须以 `__bridge-assistant__` 前缀开头。

```typescript
// 常量定义
export const BRIDGE_ASSISTANT_PREFIX = "__bridge-assistant__";

// 辅助函数
export function isBridgeAssistant(agentId: string): boolean {
  return agentId.startsWith(BRIDGE_ASSISTANT_PREFIX);
}
```

**命名示例**：

| 辅助 Agent 用途     | agentId                                   |
| ------------------- | ----------------------------------------- |
| 默认辅助 Agent      | `__bridge-assistant__default`             |
| 项目 A 的辅助 Agent | `__bridge-assistant__project-a`           |
| 自定义命名          | `__bridge-assistant__<user-defined-name>` |

**设计意图**：

1. **代码层面一目了然**：任何地方看到 `__bridge-assistant__` 前缀就知道是辅助 Agent
2. **快速匹配/排除**：只需 `agentId.startsWith("__bridge-assistant__")` 即可判断，无需查询 `members` 数组
3. **系统保留含义**：双下划线前缀是常见的系统保留命名约定，不会与用户自定义 agentId 冲突
4. **前端展示**：前端可根据此前缀自动添加特殊标识（如 🛡️ 图标、"系统辅助" 角色标签）

**在消息分发中的排除规则**：

| 场景                     | 是否触发辅助 Agent | 说明                                                             |
| ------------------------ | ------------------ | ---------------------------------------------------------------- |
| @all（@全体成员）        | ❌ 不触发          | `@all` 展开时过滤掉 `isBridgeAssistant(agentId)` 的成员          |
| broadcast 模式无 mention | ❌ 不触发          | 广播目标排除辅助 Agent                                           |
| 显式 @辅助Agent          | ❌ 不触发          | `mentions` 过滤时移除辅助 Agent 的 agentId                       |
| 系统空闲超时触发         | ✅ 触发            | 由 `bridge-trigger.ts` 直接触发，不走 `resolveDispatchTargets()` |
| Agent 回复中 @辅助Agent  | ❌ 不触发          | Agent 的回复中的 @mention 同样被过滤                             |

**对 `resolveDispatchTargets()` 的影响**：

```typescript
// @all 展开时排除辅助 Agent
const expandedMentions = hasAllMention
  ? members.filter((m) => !isBridgeAssistant(m.agentId)).map((m) => m.agentId)
  : mentions;

// 显式 @mention 时过滤辅助 Agent
const mentions =
  message.mentions?.filter(
    (id) => !isBridgeAssistant(id) && (id === "all" || members.some((m) => m.agentId === id)),
  ) ?? [];

// broadcast 模式排除辅助 Agent
const targets = members
  .filter((m) => m.agentId !== senderAgentId && !isBridgeAssistant(m.agentId))
  .map((m) => ({ agentId: m.agentId, role: m.role }));
```

#### 2.1.3 Transcript 和广播（零改动）

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
export type GroupMemberRole = "assistant" | "member" | "bridge-assistant";

/**
 * Bridge-assistant agent ID prefix.
 * Any agentId starting with this prefix is treated as a bridge-assistant
 * and excluded from normal dispatch (@all, broadcast, etc.).
 */
export const BRIDGE_ASSISTANT_PREFIX = "__bridge-assistant__";

/** Check whether an agentId belongs to a bridge-assistant. */
export function isBridgeAssistant(agentId: string): boolean {
  return agentId.startsWith(BRIDGE_ASSISTANT_PREFIX);
}

export type GroupMember = {
  agentId: string;
  role: GroupMemberRole; // 新增 "bridge-assistant" 角色
  joinedAt: number;
  // ─── Bridge Agent 新增字段 ───
  bridge?: BridgeConfig; // 存在则为 Bridge Agent
};

export type BridgeConfig = {
  type: "claude-code" | "opencode" | "codebuddy" | "custom";
  command: string; // CLI 可执行文件路径或命令名
  args?: string[]; // 额外启动参数
  cwd?: string; // 工作目录（默认当前项目）
  env?: Record<string, string>; // 环境变量
  timeout?: number; // 单次回复超时 (ms)，默认 300_000 (5 分钟)
  avatar?: string; // Agent 头像标识（自动填充，可覆盖）
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

### 3.3 进程隔离与多群聊策略

**核心原则**：不同群聊中的 CLI Agent 进程**完全独立**，不共享任何状态。

```
┌────────────────────────────────────────────────────────┐
│ 同一个 CLI Agent（如 claude-code）加入了两个群聊         │
│                                                         │
│ 群聊 A（项目目录：/home/user/project-a）                │
│   └── PTY 进程 #1（cwd: /home/user/project-a）         │
│       独立的进程、独立的上下文、独立的对话历史            │
│                                                         │
│ 群聊 B（项目目录：/home/user/project-b）                │
│   └── PTY 进程 #2（cwd: /home/user/project-b）         │
│       独立的进程、独立的上下文、独立的对话历史            │
│                                                         │
│ 两个进程互不影响，崩溃/重启/终止完全独立                 │
└────────────────────────────────────────────────────────┘
```

**进程标识**：每个 PTY 进程由 `(groupId, agentId)` 元组唯一标识。

| 维度            | 说明                                           |
| --------------- | ---------------------------------------------- |
| 进程生命周期    | 每个 `(groupId, agentId)` 独立创建、运行、回收 |
| 上下文/对话历史 | 不跨群聊共享，各群聊独立维护                   |
| 工作目录 (cwd)  | 取决于各群聊的项目目录配置，可各不相同         |
| 环境变量        | 继承 Agent 管理页面的配置，所有群聊一致        |
| 崩溃恢复        | 单个群聊的 CLI 崩溃不影响其他群聊              |
| 空闲回收        | 按 `(groupId, agentId)` 独立计时回收           |

**为什么不共享进程**：

1. **上下文隔离**：不同群聊讨论不同的任务，CLI 的对话历史不应混淆
2. **cwd 隔离**：不同群聊可能操作不同项目目录，共享进程无法同时处于多个 cwd
3. **稳定性**：一个群聊中的 CLI 崩溃不会影响其他群聊
4. **简单性**：无需设计复杂的进程复用和上下文切换逻辑

### 3.4 进程生命周期清理

CLI Agent 进程需要在多种场景下被正确清理，避免资源泄露。

#### 3.4.1 群聊解散/删除时的清理

```
群聊解散/删除触发
    ↓
遍历群聊成员，识别所有 Bridge Agent（member.bridge 存在）
    ↓
对每个 Bridge Agent 执行清理：
    ├── 发送 SIGTERM（优雅终止）
    ├── 等待 5 秒
    ├── 进程仍在运行？→ 发送 SIGKILL（强制终止）
    ├── 释放 PTY 缓冲区
    └── 记录清理日志
    ↓
发送群聊系统消息："群聊已解散，CLI Agent 已终止"
    ↓
删除群聊元数据
```

**实现要点**：

```typescript
async function cleanupGroupBridgeAgents(groupId: string): Promise<void> {
  const group = await getGroup(groupId);
  const bridgeAgents = group.members.filter((m) => m.bridge);

  for (const member of bridgeAgents) {
    const pty = getPtyInstance(groupId, member.agentId);
    if (pty) {
      // 优雅终止
      pty.kill("SIGTERM");

      // 等待 5 秒后检查
      await sleep(5000);
      if (pty.isRunning()) {
        // 强制终止
        pty.kill("SIGKILL");
      }

      // 释放缓冲区
      pty.destroy();
    }
  }
}
```

#### 3.4.2 CLI Agent 被移除时的清理

当 Owner 将 CLI Agent 从群聊成员中移除时，同样需要清理进程：

```
成员被移除（CLI Agent）
    ↓
终止对应 PTY 进程（SIGTERM → SIGKILL）
    ↓
释放缓冲区
    ↓
发送群聊消息："🔧 {agentId} 已从群聊中移除"
    ↓
更新群聊成员列表
```

#### 3.4.3 清理时机汇总

| 触发场景              | 清理对象             | 操作                             |
| --------------------- | -------------------- | -------------------------------- |
| 群聊解散              | 所有 Bridge Agent    | 终止进程 + 释放缓冲区            |
| 群聊删除              | 所有 Bridge Agent    | 终止进程 + 释放缓冲区            |
| 成员移除（CLI Agent） | 被移除的 Agent       | 终止进程 + 释放缓冲区            |
| Agent 配置删除        | 相关群聊中的该 Agent | 终止进程 + 释放缓冲区 + 通知群聊 |
| 系统关闭              | 所有活跃 PTY         | 批量终止                         |

### 3.5 与 AgentConfig 的关系

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
