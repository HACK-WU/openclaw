# 群聊 — 发起者汇总机制

## 问题

在群聊中，当一个 agent @提及其他 agent 后，这些 agent 回复时可能不会 @提及原始发起者。这导致发起者被"遗忘"在对话流程中。

**示例：**

```
test_1: @test_2 @test_3 大家好
test_2: 你好                    ← 没有 @test_1
test_3: 你好                    ← 没有 @test_1
[对话结束，test_1 被"遗忘"]
```

## 解决方案

实现"发起者汇总"机制：当当前对话链结束后，自动触发所有发起者进行新一轮回复。

## 核心逻辑

### 1. 追踪发起者

复用现有的 `groupChainStates` 追踪逻辑，新增发起者记录：

```typescript
type ChainState = {
  count: number; // 当前链计数
  startedAt: number; // 链开始时间
  initiators: string[]; // 有序的发起者列表（去重、保序）
};
```

**何时记录发起者：**

- 当 agent 发送的消息 @提及了其他 agent 时
- 记录发送者的 agentId
- 去重并保持顺序

### 2. 检测对话链结束

需要追踪哪些 agent 被触发但尚未回复。

#### 2.1 扩展 ChainState

```typescript
type ChainState = {
  count: number; // 当前链计数
  startedAt: number; // 链开始时间
  initiators: string[]; // 有序的发起者列表（去重、保序）
  pendingAgents: Set<string>; // 被触发但尚未回复的 agent
  lastMessageAt: number; // 最后一条消息时间
};
```

#### 2.2 追踪发起者（去重、保序）

```typescript
/**
 * 添加发起者到列表（去重、保序）
 * 如果已存在则不重复添加，新发起者追加到末尾
 */
function addInitiator(chain: ChainState, agentId: string): void {
  if (!chain.initiators.includes(agentId)) {
    chain.initiators.push(agentId);
  }
}
```

**示例：**

```
test_1 @test_2   → initiators = [test_1]
test_2 @test_3   → initiators = [test_1, test_2]
test_1 @test_3   → initiators = [test_1, test_2]  // test_1 已存在，不重复
test_3 @test_2   → initiators = [test_1, test_2, test_3]
```

#### 2.2 追踪待回复 agent

```typescript
// 当触发 agent 回复时
function triggerAgent(groupId, agentId) {
  const chain = groupChainStates.get(groupId);
  chain.pendingAgents.add(agentId);
  chain.lastMessageAt = Date.now();
}

// 当收到 agent 消息时
function onAgentMessage(groupId, agentId) {
  const chain = groupChainStates.get(groupId);
  chain.pendingAgents.delete(agentId);
  chain.lastMessageAt = Date.now();
  scheduleSummaryCheck(groupId);
}
```

#### 2.3 智能等待策略

| 条件                   | 行为                               |
| ---------------------- | ---------------------------------- |
| `pendingAgents 为空`   | 等待 10 秒后触发汇总               |
| `pendingAgents 不为空` | 继续等待，最多再等 30 秒           |
| `等待超过 30 秒`       | 强制触发汇总（忽略未回复的 agent） |

```typescript
const SUMMARY_DELAY_MS = 10_000; // 正常等待时间
const MAX_PENDING_WAIT_MS = 30_000; // 最大等待时间

function scheduleSummaryCheck(groupId) {
  const chain = groupChainStates.get(groupId);
  if (!chain) return;

  const now = Date.now();
  const elapsed = now - chain.lastMessageAt;
  const totalWait = now - chain.startedAt;

  // 检查是否所有 agent 都已回复
  if (chain.pendingAgents.size === 0) {
    // 所有 agent 都回复了，等 10 秒触发汇总
    if (elapsed >= SUMMARY_DELAY_MS) {
      sendSummaryMessage(groupId);
    } else {
      setTimeout(() => scheduleSummaryCheck(groupId), SUMMARY_DELAY_MS - elapsed);
    }
  } else {
    // 还有 agent 未回复
    if (totalWait >= MAX_PENDING_WAIT_MS) {
      // 等待太久，强制触发汇总
      sendSummaryMessage(groupId);
    } else {
      // 继续等待
      const waitTime = Math.min(SUMMARY_DELAY_MS, MAX_PENDING_WAIT_MS - totalWait);
      setTimeout(() => scheduleSummaryCheck(groupId), waitTime);
    }
  }
}
```

#### 2.4 对话链"结束"的完整条件

**触发汇总：**

- 所有 agent 已回复 + 10 秒无新消息
- 部分 agent 未回复 + 总等待超过 30 秒

**不触发汇总：**

- 达到链限制（MAX_CHAIN_FORWARDS = 10）
- 超过链时长限制（MAX_CHAIN_DURATION_MS = 5 分钟）

### 3. 发送汇总消息

当对话链结束且有发起者记录时：

```typescript
// 等待 N 秒
await sleep(10_000);

// 如果没有新消息到达，发送汇总
if (chainEnded && initiators.length > 0) {
  await client.request("group.send", {
    groupId,
    message: "", // 空消息或提示语
    mentions: initiators,
    sender: { type: "owner" }, // 发送者为 Owner
    skipTranscript: true, // 不记录到历史，不渲染
  });
}
```

### 4. 循环机制

汇总消息触发新一轮回复后：

- 继续追踪新的发起者
- 等待对话链结束
- 再次发送汇总
- 直到没有新发起者或达到限制

## 示例流程

```
Owner: 大家好
test_1: @test_2 @test_3 你们好   → initiators = [test_1]
test_2: 你好                     → 等链结束
test_3: 你好
[10秒无新消息]
→ 发送汇总: @test_1
→ initiators = []（清空，重新追踪）

test_1: 收到，我再补充一下        → initiators = [test_1]（新发起者）
test_2: 好的
[10秒无新消息]
→ 发送汇总: @test_1
→ initiators = []（清空，重新追踪）

test_1: 没有新内容               → initiators = [test_1]
[10秒无新消息]
→ 发送汇总: @test_1
→ initiators = []

[无新消息，无发起者]
→ 循环结束
```

## 实现要点

### 前端修改

1. **扩展 ChainState 类型**
   - 新增 `initiators: string[]` 字段

2. **记录发起者**
   - 在 `detectAndForwardMentions` 中，当 agent @其他人时记录

3. **链结束检测**
   - 使用 setTimeout 实现延迟检测
   - 如果在等待期间收到新消息，重置计时器

4. **发送汇总消息**
   - 调用 `group.send`，sender 设为 owner
   - `skipTranscript: true` 避免渲染

### 5. Owner 打断对话

当 Owner 发送新消息时：

- 重置 chain state 的计数和时间（但**保留发起者列表**）
- 取消待执行的汇总计时器
- 新对话链从 Owner 消息开始重新追踪
- 之前的发起者仍然会在汇总时被提醒

```typescript
function sendGroupMessage(host, groupId, message, mentions) {
  // Owner 发送新消息 → 重置计数和时间，保留发起者列表
  const existingChain = groupChainStates.get(groupId);
  const existingInitiators = existingChain?.initiators ?? [];

  groupChainStates.set(groupId, {
    count: 0,
    startedAt: Date.now(),
    initiators: existingInitiators, // 保留之前的发起者
  });

  cancelSummaryTimer(groupId);
  // ...继续正常发送逻辑
}
```

**保留发起者列表的好处：**

- Owner 打断可能是补充或修改话题，之前参与的人仍然相关
- 之前 @提及过别人的 agent 仍然有机会在汇总时参与
- 配合汇总提示，agent 可以自己判断是否需要回复

### 6. 汇总消息发送后重置

当自动发送汇总消息后：

- 重置 chain state（计数归零、发起者列表清空、时间重置）
- 等待新一轮回复
- 新一轮对话链重新追踪发起者

```typescript
async function sendSummaryMessage(host, groupId, initiators) {
  // 汇总提示消息
  const summaryMessage = `请确认是否有新的想法或补充。如果当前讨论已结束或没有新内容，可以不回复。`;

  // 发送汇总
  await host.client.request("group.send", {
    groupId,
    message: summaryMessage,
    mentions: initiators,
    sender: { type: "owner" },
    skipTranscript: true, // 不记录到历史，不渲染
  });

  // 重置 chain state，准备新一轮追踪
  groupChainStates.set(groupId, {
    count: 0,
    startedAt: Date.now(),
    initiators: [], // 新一轮，清空发起者列表
  });
}
```

**提示消息的作用：**

- 告知 agent 这是汇总提醒
- 明确说明可以选择不回复
- 避免无意义的"收到"回复

## 边界情况

### 1. 发起者已离开群聊

汇总前检查发起者是否仍在群成员列表中：

```typescript
async function sendSummaryMessage(host, groupId, initiators) {
  const meta = host.activeGroupMeta;
  if (!meta) return;

  // 过滤掉已离开的发起者
  const validInitiators = initiators.filter((id) => meta.members.some((m) => m.agentId === id));

  if (validInitiators.length === 0) return;

  // ...发送汇总
}
```

### 2. 页面刷新/切换

| 场景           | 行为                                   |
| -------------- | -------------------------------------- |
| 页面刷新       | chain state 丢失，对话结束，不触发汇总 |
| 切换到其他群聊 | chain state 保留，继续追踪当前群聊     |
| 离开群聊页面   | chain state 保留，汇总计时器继续运行   |

**注意**：chain state 存储在前端内存中，页面刷新会丢失。这是可接受的行为，刷新后视为新会话开始。

### 3. 群聊归档

群聊归档时取消汇总计时器：

```typescript
function leaveGroupChat(host) {
  // 取消汇总计时器
  cancelSummaryTimer(host.activeGroupId);
  // ...其他清理逻辑
}
```

### 4. 空发起者列表

检查 initiators.length > 0：

```typescript
function scheduleSummaryCheck(groupId) {
  const chain = groupChainStates.get(groupId);
  if (!chain || chain.initiators.length === 0) return;
  // ...继续检查
}

async function sendSummaryMessage(host, groupId, initiators) {
  if (initiators.length === 0) return;
  // ...发送汇总
}
```

### 5. 汇总轮数限制

防止无限循环：

```typescript
const MAX_SUMMARY_ROUNDS = 3;
const summaryRounds = new Map<string, number>();

async function sendSummaryMessage(host, groupId, initiators) {
  const rounds = summaryRounds.get(groupId) ?? 0;
  if (rounds >= MAX_SUMMARY_ROUNDS) {
    // 达到最大轮数，不发送汇总
    return;
  }
  summaryRounds.set(groupId, rounds + 1);
  // ...发送汇总
}

// Owner 发送新消息时重置轮数
function sendGroupMessage(host, groupId, message, mentions) {
  summaryRounds.delete(groupId);
  // ...继续发送
}
```

## 与现有机制的关系

- **Chain Limit**：汇总消息也计入 chain limit
- **Chain Duration**：汇总也在 duration 限制内
- **Auto-forward**：汇总消息也会触发 detectAndForwardMentions

## 后续优化

### 1. 汇总消息优化

提示模型可以简单回复或跳过：

```typescript
const summaryMessage = `请确认是否有新的想法或补充。

如果当前讨论已结束或没有新内容，可以：
- 不回复（跳过）
- 回复简单语句，如"收到"、"明白"、"了解"`;
```

### 2. 用户控制

Owner 可以手动触发或取消汇总：

**UI 入口：**

- 群聊信息面板添加"手动汇总"按钮
- 群聊信息面板添加"取消汇总"按钮（有待执行的汇总时显示）

```typescript
// 手动触发汇总
async function triggerSummary(host, groupId) {
  const chain = groupChainStates.get(groupId);
  if (!chain || chain.initiators.length === 0) return;

  cancelSummaryTimer(groupId); // 取消自动计时
  await sendSummaryMessage(host, groupId, chain.initiators);
}

// 取消汇总
function cancelSummary(host, groupId) {
  cancelSummaryTimer(groupId);
  // 显示提示
  appendSystemMessageToUI(host, groupId, "已取消自动汇总。");
}
```

### 3. 汇总触发提示

触发汇总时显示系统提示（类似触发限制的提示）：

```typescript
async function sendSummaryMessage(host, groupId, initiators) {
  // 显示汇总触发提示
  appendSystemMessageToUI(
    host,
    groupId,
    `📢 已触发汇总，等待 ${initiators.map((id) => `@${id}`).join(" ")} 回复...`,
  );

  // 发送汇总消息
  await host.client.request("group.send", {
    groupId,
    message: summaryMessage,
    mentions: initiators,
    sender: { type: "owner" },
    skipTranscript: true,
  });

  // 重置 chain state
  // ...
}
```
