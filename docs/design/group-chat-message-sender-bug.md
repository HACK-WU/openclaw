# 群聊 — 消息发送者身份错位 Bug

## Bug 描述

在群聊对话中，消息的发送者身份显示错误。实际发送者与显示的发送者不一致，导致对话流程混乱。

## 现象

### 对话记录示例

| 时间  | 显示发送者      | 实际发送者 | 消息内容                            |
| ----- | --------------- | ---------- | ----------------------------------- |
| 15:54 | test            | test       | "明天去玩，大家有什么想去的地方..." |
| 15:54 | **C3-PO (dev)** | **test**   | "看起来消息发送成功了..."           |
| 15:54 | **test_2**      | **dev**    | "好的！讨论已经发起啦..."           |
| 15:54 | **test_3**      | **test_2** | "我看到test_2已经回复了..."         |

### 关键线索

test_3 的回复暴露了 Bug：

> "我看到test_2已经回复了，但我自己就是test_2..."

这说明 test_3 实际上是 test_2，但系统错误地显示了 test_3 作为发送者。

## 问题分析

### 模式识别

消息发送者身份呈现**错位/轮换**模式：

1. test 连续发送了两条消息
2. 第一条正确显示为 test
3. 第二条错误显示为 dev (C3-PO)
4. 后续消息的发送者身份依次错位

### 可能原因

#### 1. 消息队列处理错误

在批量处理消息时，发送者信息被前一个消息覆盖或索引错位。

#### 2. 并发问题

多个消息同时处理时，发送者变量被共享/污染。

#### 3. 流处理状态错误

WebSocket/流式消息处理时，消息元数据与内容不匹配。

#### 4. 前端状态管理错误

前端消息列表更新时，发送者信息与消息内容错位。

## 相关代码

### 前端消息转发逻辑

`ui/src/ui/controllers/group-chat.ts` (第 604-610 行):

```typescript
await host.client.request("group.send", {
  groupId: message.groupId,
  message: forwardedText,
  sender: { type: "agent", agentId: senderAgentId },
  mentions: mentionedIds,
  skipTranscript: true,
});
```

发送者信息从 `message.sender.agentId` 获取 (第 520 行):

```typescript
const senderAgentId = message.sender.type === "agent" ? message.sender.agentId : undefined;
```

**注意**：如果 `message` 对象本身的发送者信息就是错的，转发时会延续错误。

## 排查方向

### 需要检查的位置

1. **后端消息广播**
   - `group.send` RPC 处理
   - 消息广播时的发送者信息设置
   - 消息队列/流处理逻辑

2. **前端消息接收**
   - WebSocket 消息解析
   - 消息事件处理 (`group.message`)
   - 消息列表渲染

3. **消息转发逻辑**
   - `detectAndForwardMentions` 函数
   - 转发时 `sender` 参数设置
   - `skipTranscript` 相关处理

## 影响范围

- **用户体验**：对话流程混乱，用户无法区分真实发送者
- **功能逻辑**：@mention 触发、发起者追踪等功能基于错误的发送者信息
- **数据一致性**：消息记录与实际发送者不匹配

## 修复优先级

**高** — 此 Bug 严重影响群聊功能的可用性。

## 下一步行动

1. 检查后端 `group.send` 和消息广播逻辑
2. 检查前端消息接收和渲染逻辑
3. 添加日志追踪消息发送者信息的变化
4. 编写复现测试用例
