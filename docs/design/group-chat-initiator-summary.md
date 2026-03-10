# 群聊 — 发起者汇总机制

## 问题

### 问题一：发起者被"遗忘"

在群聊中，当一个 agent @提及其他 agent 后，这些 agent 回复时可能不会 @提及原始发起者。这导致发起者被"遗忘"在对话流程中。

**示例：**

```
test_1: @test_2 @test_3 大家好
test_2: 你好                    ← 没有 @test_1
test_3: 你好                    ← 没有 @test_1
[对话结束，test_1 被"遗忘"]
```

### 问题二：同一 agent 被重复触发

在一次对话链中，多个 agent 可能会 @同一个 agent，导致该 agent 被反复触发回复。这不仅浪费资源，还可能产生无意义的重复内容。

**示例场景：**

```
test_1: @test_2 @test_3 @test_4 大家好，请分析这个问题
                                   → mentionedAgents = [test_2, test_3, test_4]
                                   → 三个 agent 都被触发

test_2: 我认为需要 @test_4 来处理数据库部分
        → test_4 已经在 mentionedAgents 中！
        → 如果再次触发 test_4，它会重复回复
        → 但这条消息不应该丢失，test_4 应该知道有人@了它

test_3: 同意 @test_4，你可以帮忙吗？
        → test_4 再次被@，同样不应重复触发

test_4: 好的，我来处理
        → test_4 只回复一次，但它错过了 test_2 和 test_3 对它的提及

[对话结束]
→ 汇总时，test_4 应该收到 test_2 和 test_3 对它的提及信息
```

**问题的复杂性：**

```
test_1: @test_2 @test_3 大家好     → initiators = [test_1], mentionedAgents = [test_2, test_3]

test_2: 你好 @test_1               ← test_1 是 initiator，不会触发
        → 这条消息如何处理？
        → test_1 在 initiators 中，应该在汇总时收到

test_3: @test_2 你说得对 @test_4   ← test_2 已回复过，test_4 是新的
        → test_2 在 mentionedAgents 中，不应重复触发
        → 但这条消息要保存，test_2 应该知道
        → test_4 是新的，正常触发

test_4: @test_3 @test_5 好的       ← test_3 已回复，test_5 是新的
        → test_3 不重复触发，保存消息
        → test_5 正常触发

test_5: @test_2 @test_4 收到       ← test_2 和 test_4 都已回复
        → 都不重复触发，保存消息

[对话链结束]
→ 需要处理的待投递消息：
   - test_2: 收到 test_3 和 test_5 的提及
   - test_3: 收到 test_4 的提及
   - test_4: 收到 test_5 的提及
→ 其中 test_1 在 initiators 中，汇总时处理
→ test_2, test_3, test_4 不在 initiators 中，汇总前 5 秒投递
```

**核心挑战：**

1. **避免重复触发**：同一 agent 在一次对话链中只被自动触发一次
2. **消息不丢失**：重复 @的消息需要保存，并在适当时机投递给目标 agent
3. **区分投递时机**：
   - initiator 的消息在汇总时一起处理
   - 非 initiator 的消息在汇总前投递，让 agent 有机会在汇总时回复

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

#### 2.3 发起者 @mention 匹配池排除机制

**问题场景：** 其他 agent 在回复时可能会 @initiator，导致 initiator 被意外触发回复。

```
test_1: @test_2 @test_3 大家好  → initiators = [test_1]
test_2: 你好 @test_1            ← test_2 @了 test_1，把 test_1 "拉回"对话
test_3: 你好
[对话结束，test_1 被"遗忘"]      ← test_1 其实参与了，但没被追踪
```

**解决方案：** 当 agent 被加入 `initiators` 时，从 @mention 匹配池中移除该 agentId。

```typescript
// 前端解析 @mention 时使用的成员 ID 列表
// 正常情况下等于群成员列表
let mentionPool = meta.members.map((m) => m.agentId);

// 当 agent 被加入 initiators 时，从匹配池中移除
function addInitiator(chain: ChainState, agentId: string): void {
  if (!chain.initiators.includes(agentId)) {
    chain.initiators.push(agentId);
    // 从 @mention 匹配池中移除该 initiator
    mentionPool = mentionPool.filter((id) => id !== agentId);
  }
}

// 汇总发送后清空 initiators 时，恢复匹配池
function clearInitiators(chain: ChainState): void {
  // 恢复所有 initiator 到匹配池
  for (const id of chain.initiators) {
    if (!mentionPool.includes(id)) {
      mentionPool.push(id);
    }
  }
  chain.initiators = [];
}
```

**效果：**

```
test_1: @test_2 @test_3 大家好  → initiators = [test_1]
                               → 匹配池移除 test_1
test_2: 你好 @test_1            ← @test_1 不再是有效 mention，不会触发 test_1 回复
test_3: 你好
[对话结束]
→ 汇总: @test_1                 ← test_1 正确收到提醒
```

**核心目的：** 确保 initiator 只发一次言，直到汇总时再次被触发。防止 initiator 在对话链中途被其他 agent 意外"拉回"。

#### 2.4 追踪待回复 agent

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

#### 2.5 智能等待策略

| 条件                   | 行为                               |
| ---------------------- | ---------------------------------- |
| `pendingAgents 为空`   | 等待 15 秒后触发汇总               |
| `pendingAgents 不为空` | 继续等待，最多再等 30 秒           |
| `等待超过 30 秒`       | 强制触发汇总（忽略未回复的 agent） |

```typescript
const SUMMARY_DELAY_MS = 15_000; // 正常等待时间
const MAX_PENDING_WAIT_MS = 30_000; // 最大等待时间

function scheduleSummaryCheck(groupId) {
  const chain = groupChainStates.get(groupId);
  if (!chain) return;

  const now = Date.now();
  const elapsed = now - chain.lastMessageAt;
  const totalWait = now - chain.startedAt;

  // 检查是否所有 agent 都已回复
  if (chain.pendingAgents.size === 0) {
    // 所有 agent 都回复了，等 15 秒触发汇总
    if (elapsed >= SUMMARY_DELAY_MS) {
      executeSummaryFlow(groupId);
    } else {
      setTimeout(() => scheduleSummaryCheck(groupId), SUMMARY_DELAY_MS - elapsed);
    }
  } else {
    // 还有 agent 未回复
    if (totalWait >= MAX_PENDING_WAIT_MS) {
      // 等待太久，强制触发汇总
      executeSummaryFlow(groupId);
    } else {
      // 继续等待
      const waitTime = Math.min(SUMMARY_DELAY_MS, MAX_PENDING_WAIT_MS - totalWait);
      setTimeout(() => scheduleSummaryCheck(groupId), waitTime);
    }
  }
}
```

#### 2.6 对话链"结束"的完整条件

**触发汇总：**

- 所有 agent 已回复 + 15 秒无新消息
- 部分 agent 未回复 + 总等待超过 30 秒

**不触发汇总：**

- 达到链限制（MAX_CHAIN_FORWARDS = 10）
- 超过链时长限制（MAX_CHAIN_DURATION_MS = 5 分钟）

### 3. 发送汇总消息

当对话链结束且有发起者记录时：

```typescript
// 等待 N 秒
await sleep(15_000);

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
[15秒无新消息]
→ 发送汇总: @test_1
→ initiators = []（清空，重新追踪）

test_1: 收到，我再补充一下        → initiators = [test_1]（新发起者）
test_2: 好的
[15秒无新消息]
→ 发送汇总: @test_1
→ initiators = []（清空，重新追踪）

test_1: 没有新内容               → initiators = [test_1]
[15秒无新消息]
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

---

## 新增策略：避免重复触发 + 延迟消息投递

### 核心思路

在一次对话链中，记录所有已被 @触发过的 agent。当新的 @mention 匹配到已触发的 agent 时：

1. **不重复触发**该 agent 的自动回复
2. **保存这条消息**，等待适当时机投递
3. **区分投递时机**：
   - 如果目标 agent 在 `initiators` 中 → 汇总时一起处理
   - 如果目标 agent 不在 `initiators` 中 → 汇总前 5 秒按顺序投递

### 1. 扩展 ChainState 类型

```typescript
type ChainState = {
  count: number; // 当前链计数
  startedAt: number; // 链开始时间
  initiators: string[]; // 有序的发起者列表（去重、保序）
  pendingAgents: Set<string>; // 被触发但尚未回复的 agent
  lastMessageAt: number; // 最后一条消息时间
  mentionedAgents: string[]; // 本次对话链中已被@触发的 agent（去重、保序）
  pendingMentions: PendingMention[]; // 重复@的待投递消息
};

type PendingMention = {
  agentId: string; // 目标 agent
  message: GroupChatMessage; // 包含@的消息
  fromAgentId: string; // 发送者 agentId
};
```

### 2. 追踪已被触发的 agent

当 agent 被 @触发时，记录到 `mentionedAgents`：

```typescript
/**
 * 记录已被触发的 agent（去重、保序）
 */
function addMentionedAgent(chain: ChainState, agentId: string): void {
  if (!chain.mentionedAgents.includes(agentId)) {
    chain.mentionedAgents.push(agentId);
  }
}

/**
 * 检查 agent 是否已被触发过
 */
function hasBeenMentioned(chain: ChainState, agentId: string): boolean {
  return chain.mentionedAgents.includes(agentId);
}
```

### 3. @mention 匹配时的处理逻辑

修改 `detectAndForwardMentions` 函数：

```typescript
async function detectAndForwardMentions(host: GroupHost, message: GroupChatMessage): Promise<void> {
  // 只处理 agent 消息
  if (message.sender.type !== "agent") return;

  const chain = getOrCreateChainState(message.groupId);
  const senderAgentId = message.sender.agentId;

  // 获取当前有效的匹配池（排除 initiators）
  const mentionPool = getMentionPool(message.groupId);

  // 提取 @mentions
  const mentionedIds = extractDedicatedMentions(message.content, mentionPool);

  if (mentionedIds.length === 0) {
    // 没有有效的 @mentions
    resetChainState(message.groupId);
    return;
  }

  // 记录发送者为 initiator
  addInitiator(chain, senderAgentId);

  // 分类处理：首次触发 vs 重复@提及
  const firstTimeMentions: string[] = [];

  for (const agentId of mentionedIds) {
    if (hasBeenMentioned(chain, agentId)) {
      // 已被触发过，保存待投递消息
      chain.pendingMentions.push({
        agentId,
        message,
        fromAgentId: senderAgentId,
      });
      console.log(`[group-chat] pending mention: ${agentId} already triggered, message saved`);
    } else {
      // 首次被触发
      firstTimeMentions.push(agentId);
      addMentionedAgent(chain, agentId);
    }
  }

  // 只触发首次被@的 agent
  if (firstTimeMentions.length > 0) {
    await triggerAgents(host, message.groupId, firstTimeMentions, message);
  }

  // 如果有重复@的消息，确保汇总检测在运行
  if (chain.pendingMentions.length > 0) {
    scheduleSummaryCheck(host, message.groupId);
  }
}
```

### 4. 汇总前的消息投递

触发逻辑改变：不再依赖 `group.stream (final)` 信号，改为检测 UI 是否有加载效果。

#### 4.1 关键设计：观察式等待（而非盲等）

**问题：** 投递待处理消息后，被投递的 agent 可能会产生新的回复（甚至包含不同看法）。如果投递后立刻盲等固定时间再汇总，可能导致：

1. agent 的新回复还没生成完，initiator 就收到汇总，**错过新观点**
2. agent 回复很快时，白白等待多余时间
3. agent 的新回复触发了新的 @mention 链，和汇总产生竞争

**解决方案：** `executeSummaryFlow` 采用两阶段设计：

- **阶段一（投递）**：投递待处理消息给非 initiator 的 agent，然后**重新进入 `scheduleSummaryCheck` 等待循环**
- **阶段二（汇总）**：等所有被投递的 agent 回复完毕（或超时），UI 再次空闲后，才发送汇总给 initiator

这样 initiator 收到汇总时，能看到所有 agent 的最新观点（包括投递后产生的新回复）。

#### 4.2 scheduleSummaryCheck

```typescript
const SUMMARY_DELAY_MS = 10_000; // 汇总等待时间（UI 空闲后 10 秒）
const MAX_PENDING_WAIT_MS = 30_000; // 最大等待时间

async function scheduleSummaryCheck(host: GroupHost, groupId: string): Promise<void> {
  const chain = groupChainStates.get(groupId);
  if (!chain) return;

  // 检测 UI 是否有加载效果（pending agents 或 active streams）
  const hasPendingAgents = host.groupPendingAgents.size > 0;
  const hasActiveStreams = host.groupStreams.size > 0;
  const isUILoading = hasPendingAgents || hasActiveStreams;

  // 如果 UI 还在加载，等待 1 秒后重试
  if (isUILoading) {
    setTimeout(() => scheduleSummaryCheck(host, groupId), 1000);
    return;
  }

  // UI 空闲，开始计时
  // 取消之前的计时器
  cancelSummaryTimer(groupId);

  const now = Date.now();
  const elapsed = now - chain.lastMessageAt;
  const totalWait = now - chain.startedAt;

  // 检查是否所有 agent 都已回复
  if (chain.pendingAgents.size === 0) {
    // 所有 agent 都回复了
    if (elapsed >= SUMMARY_DELAY_MS) {
      // 时间到，触发汇总流程
      await executeSummaryFlow(host, groupId);
    } else {
      // 设置计时器
      const waitTime = SUMMARY_DELAY_MS - elapsed;
      summaryTimers.set(
        groupId,
        setTimeout(() => {
          executeSummaryFlow(host, groupId);
        }, waitTime),
      );
    }
  } else {
    // 还有 agent 未回复
    if (totalWait >= MAX_PENDING_WAIT_MS) {
      // 等待太久，强制触发汇总
      await executeSummaryFlow(host, groupId);
    } else {
      // 继续等待
      const waitTime = Math.min(SUMMARY_DELAY_MS, MAX_PENDING_WAIT_MS - totalWait);
      summaryTimers.set(
        groupId,
        setTimeout(() => {
          scheduleSummaryCheck(host, groupId);
        }, waitTime),
      );
    }
  }
}
```

#### 4.3 executeSummaryFlow（两阶段设计）

```typescript
/**
 * 执行汇总流程（两阶段）：
 * 阶段一：投递待处理消息，然后重新等待 agent 回复
 * 阶段二：所有 agent 回复完毕后，发送汇总给 initiator
 */
async function executeSummaryFlow(host: GroupHost, groupId: string): Promise<void> {
  const chain = groupChainStates.get(groupId);
  if (!chain) return;

  // 阶段一：检查是否有待投递的消息
  const hasDelivered = await deliverPendingMentions(host, groupId);

  if (hasDelivered) {
    // 有消息被投递了 → 不立刻汇总
    // 重新进入 scheduleSummaryCheck 循环，等待投递触发的 agent 回复完毕
    // 当 UI 再次空闲 + SUMMARY_DELAY_MS 后，会再次调用 executeSummaryFlow
    // 此时 pendingMentions 已清空（在 deliverPendingMentions 中），不会重复投递
    scheduleSummaryCheck(host, groupId);
    return;
  }

  // 阶段二：没有待投递消息（或已在上一轮投递完），直接发送汇总
  if (chain.initiators.length > 0) {
    await sendSummaryMessage(host, groupId, chain.initiators);
  }

  // 清空状态
  chain.mentionedAgents = [];
  chain.pendingMentions = [];
}
```

**防止无限循环的保障：**

1. `deliverPendingMentions` 会清空已投递的 `pendingMentions`，所以下次进入 `executeSummaryFlow` 时 `hasDelivered` 为 false，直接进入阶段二
2. 投递后的 agent 回复如果又产生新的 `pendingMentions`，会被正常追踪，但受 `MAX_SUMMARY_ROUNDS` 和 `MAX_CHAIN_FORWARDS` 限制
3. `MAX_PENDING_WAIT_MS`（30 秒）兜底：即使 agent 一直不回复，超时后也会强制进入汇总

#### 4.4 对比：盲等 vs 观察式等待

| 场景                     | 盲等固定时间              | 观察式等待                     |
| ------------------------ | ------------------------- | ------------------------------ |
| 投递后 agent 有新观点    | ❌ 可能被忽略（5 秒不够） | ✅ 等 agent 回复完再汇总       |
| agent 回复很快（< 5 秒） | 白等剩余时间              | ✅ 回复完就进入汇总倒计时      |
| agent 回复很慢（> 5 秒） | ❌ 汇总已发出，新观点丢失 | ✅ 耐心等待，有超时保护        |
| 投递触发新的 @mention 链 | ❌ 和汇总竞争             | ✅ 新链完成后再汇总            |
| agent 不回复             | 等满 5 秒后汇总           | ✅ 超时后强制汇总（30 秒兜底） |

### 5. 投递待处理消息

区分 initiator 和非 initiator 的处理方式。

**关键：** 函数返回 `boolean`，表示是否实际投递了消息。调用方据此决定是重新等待还是直接汇总。

```typescript
/**
 * 投递待处理的 @mention 消息
 * 非 initiator 的 agent 在汇总前收到消息
 * initiator 的消息会在汇总中一起处理
 *
 * @returns true 如果实际投递了消息（调用方应重新进入等待循环）
 */
async function deliverPendingMentions(host: GroupHost, groupId: string): Promise<boolean> {
  const chain = groupChainStates.get(groupId);
  if (!chain || chain.pendingMentions.length === 0) return false;

  // 按顺序去重处理
  const deliverMap = new Map<string, PendingMention[]>();

  for (const pending of chain.pendingMentions) {
    // 跳过 initiator（他们会在汇总时收到）
    if (chain.initiators.includes(pending.agentId)) {
      continue;
    }

    // 按 agentId 分组
    const list = deliverMap.get(pending.agentId) ?? [];
    list.push(pending);
    deliverMap.set(pending.agentId, list);
  }

  let delivered = false;

  // 按顺序投递（保持 mentionAgents 的顺序）
  for (const agentId of chain.mentionedAgents) {
    const pendings = deliverMap.get(agentId);
    if (!pendings || pendings.length === 0) continue;

    // 合并消息内容
    const messages = pendings
      .sort((a, b) => a.message.timestamp - b.message.timestamp)
      .map((p) => `[${p.fromAgentId}]: ${p.message.content}`);

    // 一次性发送给该 agent
    await host.client.request("group.send", {
      groupId,
      message: messages.join("\n\n"),
      mentions: [agentId],
      sender: { type: "owner" },
      skipTranscript: true,
    });

    delivered = true;
    console.log(
      `[group-chat] delivered pending mentions to ${agentId}: ${pendings.length} messages`,
    );
  }

  // 清空已投递的非 initiator 消息，保留 initiator 的待处理消息
  // 这样下次进入 executeSummaryFlow 时不会重复投递
  chain.pendingMentions = chain.pendingMentions.filter((p) => chain.initiators.includes(p.agentId));

  return delivered;
}
```

### 6. 汇总消息包含 initiator 的待处理消息

修改 `sendSummaryMessage`，将 initiator 的待处理消息合并：

```typescript
async function sendSummaryMessage(
  host: GroupHost,
  groupId: string,
  initiators: string[],
): Promise<void> {
  const chain = groupChainStates.get(groupId);
  if (!chain) return;

  // 构建汇总消息
  let summaryContent = "请确认是否有新的想法或补充。如果当前讨论已结束或没有新内容，可以不回复。";

  // 收集 initiator 的待处理消息
  for (const initiatorId of initiators) {
    const initiatorPendings = chain.pendingMentions.filter((p) => p.agentId === initiatorId);

    if (initiatorPendings.length > 0) {
      summaryContent += `\n\n---\n**以下是对你的提及：**\n`;

      for (const pending of initiatorPendings.sort(
        (a, b) => a.message.timestamp - b.message.timestamp,
      )) {
        summaryContent += `\n[${pending.fromAgentId}]: ${pending.message.content}`;
      }
    }
  }

  // 发送汇总
  await host.client.request("group.send", {
    groupId,
    message: summaryContent,
    mentions: initiators,
    sender: { type: "owner" },
    skipTranscript: true,
  });

  console.log(`[group-chat] summary sent to: ${initiators.join(", ")}`);
}
```

### 7. 触发时机修改

**重要变更：** 不再依赖 `group.stream (final)` 信号，改为检测 UI 加载状态。

**新触发逻辑：**

1. 在 `handleGroupMessageEvent` 中触发 `detectAndForwardMentions` 和 `scheduleSummaryCheck`
2. `scheduleSummaryCheck` 检测 UI 是否有加载效果（`groupPendingAgents` 或 `groupStreams`）
3. 如果 UI 还在加载，等待 1 秒后重试
4. 如果 UI 空闲，开始计时

```typescript
// 在 handleGroupMessageEvent 中
if (payload.sender.type === "agent") {
  // 触发 @mention 检测和转发
  void detectAndForwardMentions(host as GroupHost, payload);

  // 触发汇总检测
  scheduleSummaryCheck(host as GroupHost, payload.groupId);
}

// 在 scheduleSummaryCheck 中
const hasPendingAgents = host.groupPendingAgents.size > 0;
const hasActiveStreams = host.groupStreams.size > 0;
const isUILoading = hasPendingAgents || hasActiveStreams;

if (isUILoading) {
  // UI 还在加载，等待 1 秒后重试
  setTimeout(() => scheduleSummaryCheck(host, groupId), 1000);
  return;
}

// UI 空闲，开始计时
```

**延迟时间调整：**

- 汇总时间：**10 秒**（`SUMMARY_DELAY_MS`，UI 空闲后等待）
- 最大等待时间：**30 秒**（`MAX_PENDING_WAIT_MS`，超时强制汇总）
- ~~投递时间：已移除 `PRE_SUMMARY_DELIVER_MS`~~（改为观察式等待，不再盲等固定时间）

```typescript
const SUMMARY_DELAY_MS = 10_000; // 汇总等待时间
const MAX_PENDING_WAIT_MS = 30_000; // 最大等待时间
```

### 8. 自动触发时显示加载效果

自动触发 @mention 时，与手动触发一样，显示加载效果（预测哪些 agent 会被触发）：

```typescript
// 在 detectAndForwardMentions 中
if (firstTimeMentions.length > 0) {
  // 显示自动触发通知
  appendSystemMessageToUI(host, groupId, `🔄 触发 @${firstTimeMentions.join(" @")}`);

  // 预测并显示加载效果（与手动 @ 相同的行为）
  const currentPending = host.groupPendingAgents;
  const newPending = new Set(currentPending);
  for (const id of firstTimeMentions) {
    newPending.add(id);
  }
  host.groupPendingAgents = newPending;

  // 触发转发
  await host.client.request("group.send", { ... });
}
```

这样用户可以立即看到哪些 agent 正在被触发，体验与手动 @ 一致。

### 9. 完整流程示例

```
Owner: 大家好

test_1: @test_2 @test_3 @test_4 请分析这个问题
        → initiators = [test_1]
        → mentionedAgents = [test_2, test_3, test_4]
        → 触发 test_2, test_3, test_4

test_2: 我认为需要 @test_4 来处理数据库部分
        → test_1 是 initiator，从匹配池排除
        → @test_4 在 mentionedAgents 中！
        → 不触发 test_4，保存到 pendingMentions:
          { agentId: "test_4", fromAgentId: "test_2", message: ... }

test_3: 同意，@test_4 你能帮忙吗？
        → @test_4 再次被提及
        → 不触发，保存到 pendingMentions:
          { agentId: "test_4", fromAgentId: "test_3", message: ... }

test_4: 好的，我来处理 @test_2
        → test_2 在 mentionedAgents 中
        → 不触发，保存到 pendingMentions:
          { agentId: "test_2", fromAgentId: "test_4", message: ... }

[所有 agent 已回复，UI 加载效果消失]

[UI 空闲后 10 秒]

→ executeSummaryFlow() 阶段一开始

→ deliverPendingMentions():
   - test_2 不在 initiators 中，发送：
     "[test_4]: 好的，我来处理 @test_2"
   - test_4 不在 initiators 中，发送：
     "[test_2]: 我认为需要 @test_4 来处理数据库部分
      [test_3]: 同意，@test_4 你能帮忙吗？"
   - 返回 true（有消息被投递）
   - 清空已投递的 pendingMentions（保留 initiator 的）

→ hasDelivered = true → 不立刻汇总，重新进入 scheduleSummaryCheck

[test_2 和 test_4 收到投递消息，开始生成回复]

test_4: 收到，我有不同看法。经过进一步分析，Y 方案更好...
        → 新的回复包含了不同观点
        → 这些内容会被 test_1 在汇总时看到

test_2: 了解，同意 test_4 的新方案

[所有 agent 再次回复完毕，UI 空闲]

[UI 空闲后 10 秒]

→ executeSummaryFlow() 阶段二开始

→ deliverPendingMentions():
   - 无非 initiator 的待投递消息
   - 返回 false

→ hasDelivered = false → 进入汇总阶段

→ sendSummaryMessage():
   - test_1 在 initiators 中
   - 发送汇总 @test_1（包含 initiator 的待处理消息）
   - test_1 此时能看到 test_4 的新观点（Y 方案）

→ 清空状态：
   - mentionedAgents = []
   - pendingMentions = []
```

**对比旧方案（盲等 5 秒）下的问题：**

```
[旧方案：投递后盲等 5 秒]

→ deliverPendingMentions() 投递给 test_2 和 test_4
→ 盲等 5 秒...
→ test_4 还在生成包含新观点的回复...
→ sendSummaryMessage() @test_1
→ test_1 被触发回复，但此时 test_4 的新观点还没出来
→ test_1 的回复基于不完整的信息 ← 问题！
```

### 9. 状态清空时机

```typescript
function resetChainState(groupId: string): void {
  const chain = groupChainStates.get(groupId);
  if (!chain) return;

  chain.count = 0;
  chain.startedAt = Date.now();
  chain.initiators = [];
  chain.pendingAgents = new Set();
  chain.lastMessageAt = Date.now();
  chain.mentionedAgents = []; // 清空已触发的 agent
  chain.pendingMentions = []; // 清空待投递消息
}

// 汇总发送后
function clearAfterSummary(groupId: string): void {
  const chain = groupChainStates.get(groupId);
  if (!chain) return;

  chain.initiators = [];
  chain.mentionedAgents = [];
  chain.pendingMentions = [];
}
```

### 10. 边界情况处理

#### 10.1 待投递消息的目标 agent 已离开群聊

```typescript
async function deliverPendingMentions(host: GroupHost, groupId: string): Promise<void> {
  const meta = host.activeGroupMeta;
  if (!meta) return;

  const memberIds = new Set(meta.members.map((m) => m.agentId));

  // 过滤掉已离开的 agent
  for (const [agentId, pendings] of deliverMap) {
    if (!memberIds.has(agentId)) {
      console.log(`[group-chat] skip pending mentions for left agent: ${agentId}`);
      deliverMap.delete(agentId);
    }
  }
  // ...继续投递
}
```

#### 10.2 同一 agent 被多次@但都在 initiator 中

```
test_1: @test_2 @test_3 大家好     → initiators = [test_1]
test_2: @test_1 你好               → test_1 在 initiators 中
test_3: @test_1 你好               → test_1 在 initiators 中
```

处理：这些消息会在汇总时合并发送给 test_1。

#### 10.3 达到汇总轮数限制

```typescript
async function executeSummaryFlow(host: GroupHost, groupId: string): Promise<void> {
  const rounds = summaryRounds.get(groupId) ?? 0;
  if (rounds >= MAX_SUMMARY_ROUNDS) {
    // 达到限制，清空状态但不发送汇总
    clearAfterSummary(groupId);
    console.log(`[group-chat] max summary rounds reached for ${groupId}`);
    return;
  }
  // ...继续正常流程
}
```

### 11. 与现有机制的关系更新

| 机制               | 关系                                                   |
| ------------------ | ------------------------------------------------------ |
| **Chain Limit**    | 汇总消息和待投递消息都计入 chain limit                 |
| **Chain Duration** | 整个流程在 duration 限制内                             |
| **Auto-forward**   | 只触发首次@的 agent，重复@转为待投递                   |
| **Initiator 排除** | initiator 不在 @mention 匹配池中，不会被中途触发       |
| **触发时机**       | 基于 `group.stream (final)` 事件，而非 `group.message` |
