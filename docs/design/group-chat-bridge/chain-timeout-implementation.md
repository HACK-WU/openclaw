# chainTimeout 运行时监控实现方案

> 基于设计文档 [anti-loop-mechanism.md](./anti-loop-mechanism.md)，本文档描述 chainTimeout 运行时监控的详细代码实现方案。

## 一、现状分析

### 1.1 已有的基础设施

| 组件                      | 文件                                  | 现状                                                                 |
| ------------------------- | ------------------------------------- | -------------------------------------------------------------------- |
| `ConversationChainState`  | `src/group-chat/types.ts`             | 已有 `originMessageId`、`roundCount`、`startedAt`                    |
| `GroupSessionEntry`       | `src/group-chat/types.ts`             | 已有 `chainTimeout?`（默认 300s）、`maxRounds`、`cliTimeout?`        |
| `chain-state-store.ts`    | `src/group-chat/chain-state-store.ts` | 已有 `initChainState`、`atomicCheckAndIncrement`、`getChainState`    |
| `atomicCheckAndIncrement` | `src/group-chat/chain-state-store.ts` | 已检查 `chainTimeout`，但仅作为触发前门控（不终止运行中 Agent）      |
| `AbortController`         | `src/group-chat/parallel-stream.ts`   | 已有 `registerGroupAbort` / `unregisterGroupAbort` / `abortGroupRun` |
| `handleGroupSend`         | `src/gateway/server-methods/group.ts` | 已在 Owner 发消息时 `initChainState` + 创建 `AbortController`        |

### 1.2 缺失的部分

- **运行时监控**：当前 `chainTimeout` 仅在触发前检查（`atomicCheckAndIncrement`），不会终止已触发的 Agent
- **Monitor 生命周期管理**：没有 setTimeout 机制在超时后主动 abort
- **触发 Agent 记录**：`ConversationChainState` 没有记录哪些 Agent 被触发过（去重需要）
- **排队消息管理**：没有 Owner 中间消息的队列和合并逻辑
- **默认值不匹配**：代码默认 300s（5 分钟），设计文档要求单播 15min / 广播 8min（⚠️ Breaking Change）
- **maxRounds 耗尽时清零 monitor**：当前没有这个逻辑

---

## 二、改动概览

### 2.1 改动文件清单

| 文件                                   | 改动 | 说明                                                                   |
| -------------------------------------- | ---- | ---------------------------------------------------------------------- |
| `src/group-chat/types.ts`              | 修改 | `ConversationChainState` 新增 `triggeredAgents`、`queuedMessages` 字段 |
| `src/group-chat/chain-state-store.ts`  | 修改 | 新增 monitor 管理、队列管理、maxRounds 耗尽清零逻辑                    |
| `src/gateway/server-methods/group.ts`  | 修改 | `handleGroupSend` 集成 monitor 启停、排队消息处理                      |
| `src/group-chat/chain-timeout.test.ts` | 新增 | chainTimeout 运行时监控的单元测试                                      |

### 2.2 不改动的文件

| 文件                                | 原因                                                     |
| ----------------------------------- | -------------------------------------------------------- |
| `src/group-chat/agent-trigger.ts`   | 已支持 `AbortSignal`，无需改动                           |
| `src/group-chat/bridge-trigger.ts`  | 已支持 `signal.addEventListener("abort", ...)`，无需改动 |
| `src/group-chat/parallel-stream.ts` | `registerGroupAbort` / `unregisterGroupAbort` 已满足需求 |

---

## 三、类型定义改动

### 3.1 `ConversationChainState` 扩展

**文件**：`src/group-chat/types.ts`

```typescript
/** Owner 排队的中间消息 */
export type QueuedOwnerMessage = {
  /** 消息 ID */
  messageId: string;
  /** @ 提及的 Agent ID 列表 */
  mentionedAgents: string[];
  /** 是否 @ 了任何 Agent */
  hasMention: boolean;
  /** 消息到达时间 */
  queuedAt: number;
};

/** 对话链状态 */
export type ConversationChainState = {
  /** Owner 原始消息 ID（当前对话链的起始消息） */
  originMessageId: string;
  /** 已触发的 Agent 总次数 */
  roundCount: number;
  /** 对话链开始时间 (epoch ms) */
  startedAt: number;
  /** 当前对话链中已触发的 Agent ID 列表（用于去重判断，使用数组以便展开拷贝） */
  triggeredAgents: string[];
  /** Owner 在对话链执行期间的排队消息 */
  queuedMessages: QueuedOwnerMessage[];
};
```

**设计决策**：

- `triggeredAgents` 使用 `string[]` 而非 `Set<string>`，因为 `{ ...state }` 展开不会克隆 Set（只拷贝引用），而数组展开会正确浅拷贝。去重检查时临时构建 `new Set(arr)` 即可。
- `triggeredAgents` 和 `queuedMessages` 直接放在 `ConversationChainState` 中，因为它们的生命周期与对话链完全一致。

---

## 四、chain-state-store.ts 改动

### 4.1 Monitor 管理

新增 monitor 的注册、停止和查询机制：

> **`removeChainMonitor` vs `stopChainMonitor` 使用场景**：
>
> - `removeChainMonitor(gid)`：仅从 Map 中删除条目，**不**调用 `stop()`。用于 `onTimeout` 回调中 — 此时 timer 已 fired 并调用了 `abortController.abort()`，无需 `clearTimeout`，只需移除条目防止后续误操作。
> - `stopChainMonitor(gid)`：先调用 `stop()`（`clearTimeout` + 移除 abort listener），再从 Map 删除。用于正常完成、maxRounds 耗尽、群组解散等需要主动停止 timer 的场景。

```typescript
// ─── Monitor Storage ───

/** 群组级别的 chainTimeout monitor 停止函数 */
const monitors = new Map<string, () => void>();

/**
 * 注册 chainTimeout monitor
 * 每个 groupId 同时只有一个活跃的 monitor
 */
export function setChainMonitor(groupId: string, stop: () => void): void {
  // 先停止旧的 monitor
  const stopOld = monitors.get(groupId);
  if (stopOld) {
    try {
      stopOld();
    } catch {
      /* ignore */
    }
  }
  monitors.set(groupId, stop);
}

/**
 * 移除 chainTimeout monitor
 */
export function removeChainMonitor(groupId: string): void {
  monitors.delete(groupId);
}

/**
 * 停止并移除 chainTimeout monitor
 */
export function stopChainMonitor(groupId: string): void {
  const stop = monitors.get(groupId);
  if (stop) {
    try {
      stop();
    } catch {
      /* ignore */
    }
    monitors.delete(groupId);
  }
}

/**
 * 检查群组是否有活跃的 chainTimeout monitor
 */
export function hasActiveMonitor(groupId: string): boolean {
  return monitors.has(groupId);
}
```

### 4.2 `initChainState` 改动

初始化时清理旧 monitor 和排队消息：

```typescript
export function initChainState(groupId: string, originMessageId: string): ConversationChainState {
  // 停止旧的 monitor（如果存在）
  stopChainMonitor(groupId);

  const state: ConversationChainState = {
    originMessageId,
    roundCount: 0,
    startedAt: Date.now(),
    triggeredAgents: [],
    queuedMessages: [],
  };
  store.set(groupId, state);
  return state;
}
```

### 4.3 `checkAndIncrementSync` 改动

同步版本也需要同步新增 `agentId` 参数和 `triggeredAgents` 记录逻辑：

```typescript
export function checkAndIncrementSync(
  groupId: string,
  meta: GroupSessionEntry,
  agentId: string, // ← 新增参数
): { allowed: true; newState: ConversationChainState } | { allowed: false; reason: string } {
  const state = store.get(groupId);
  if (!state) {
    return { allowed: false, reason: "no_chain_state" };
  }

  const now = Date.now();

  // Layer 1: maxRounds
  if (state.roundCount >= meta.maxRounds) {
    return { allowed: false, reason: "max_rounds_exceeded" };
  }

  // Layer 1: chainTimeout
  if (
    state.startedAt &&
    now - state.startedAt >= (meta.chainTimeout ?? getDefaultChainTimeout(meta))
  ) {
    return { allowed: false, reason: "chain_timeout_exceeded" };
  }

  // Layer 2: 硬限制
  if (state.roundCount >= CHAIN_MAX_COUNT) {
    return { allowed: false, reason: "backend_chain_max_exceeded" };
  }
  if (state.startedAt && now - state.startedAt >= CHAIN_MAX_DURATION_MS) {
    return { allowed: false, reason: "backend_chain_timeout_exceeded" };
  }

  // 原子 +1
  state.roundCount += 1;
  state.triggeredAgents.push(agentId);
  store.set(groupId, state);

  return { allowed: true, newState: { ...state, triggeredAgents: [...state.triggeredAgents] } };
}
```

### 4.4 `atomicCheckAndIncrement` 改动

触发 Agent 时记录到 `triggeredAgents`，并在 maxRounds 耗尽时清零 monitor：

```typescript
export async function atomicCheckAndIncrement(
  groupId: string,
  meta: GroupSessionEntry,
  agentId: string, // ← 新增参数
): Promise<
  | { allowed: true; newState: ConversationChainState }
  | { allowed: false; reason: string; maxRoundsExhausted?: boolean }
> {
  const release = await acquireLock(groupId);
  try {
    const state = store.get(groupId);
    if (!state) {
      return { allowed: false, reason: "no_chain_state" };
    }

    const now = Date.now();

    // Layer 1: maxRounds
    if (state.roundCount >= meta.maxRounds) {
      // maxRounds 耗尽 → 清零 monitor
      stopChainMonitor(groupId);
      return { allowed: false, reason: "max_rounds_exceeded", maxRoundsExhausted: true };
    }

    // Layer 1: chainTimeout（触发前检查，双重保护）
    if (
      state.startedAt &&
      now - state.startedAt >= (meta.chainTimeout ?? getDefaultChainTimeout(meta))
    ) {
      return { allowed: false, reason: "chain_timeout_exceeded" };
    }

    // Layer 2: 硬限制
    if (state.roundCount >= CHAIN_MAX_COUNT) {
      stopChainMonitor(groupId);
      return { allowed: false, reason: "backend_chain_max_exceeded", maxRoundsExhausted: true };
    }
    if (state.startedAt && now - state.startedAt >= CHAIN_MAX_DURATION_MS) {
      return { allowed: false, reason: "backend_chain_timeout_exceeded" };
    }

    // 原子 +1
    state.roundCount += 1;
    state.triggeredAgents.push(agentId);
    store.set(groupId, state);

    return { allowed: true, newState: { ...state, triggeredAgents: [...state.triggeredAgents] } };
  } finally {
    release();
  }
}
```

**注意**：`newState` 返回时 `triggeredAgents` 使用 `[...state.triggeredAgents]` 拷贝数组，确保调用方拿到独立副本。

### 4.5 排队消息管理

```typescript
/**
 * Owner 中间消息入队
 */
export function enqueueOwnerMessage(
  groupId: string,
  messageId: string,
  mentionedAgents: string[],
  hasMention: boolean,
): void {
  const state = store.get(groupId);
  if (!state) return;

  state.queuedMessages.push({
    messageId,
    mentionedAgents,
    hasMention,
    queuedAt: Date.now(),
  });
  store.set(groupId, state);
}

/**
 * 消费排队消息（对话链结束时调用）
 *
 * 处理逻辑：
 * 1. 过滤掉无 @ 的普通消息（不触发对话链）
 * 2. 合并所有有 @ 的消息：取最后一条为触发消息，@ 目标取并集
 * 3. 对合并后的目标集合做去重检查：移除已在当前对话链中触发的 Agent
 * 4. 如果去重后目标非空，返回合并结果；否则返回 null（跳过）
 */
export function drainQueuedMessages(
  groupId: string,
  currentTriggeredAgents: string[],
): {
  /** 触发消息 ID（最后一条） */
  triggerMessageId: string;
  /** 去重后的目标 Agent ID 列表 */
  targetAgentIds: string[];
} | null {
  const state = store.get(groupId);
  if (!state) return null;

  const { queuedMessages } = state;

  // 清空排队队列（无论是否触发新一轮）
  state.queuedMessages = [];
  store.set(groupId, state);

  // 过滤：只保留有 @ 的消息
  const messagesWithMentions = queuedMessages.filter(
    (m) => m.hasMention && m.mentionedAgents.length > 0,
  );

  if (messagesWithMentions.length === 0) {
    return null;
  }

  // 取最后一条为触发消息
  const lastMessage = messagesWithMentions[messagesWithMentions.length - 1];

  // 合并 @ 目标：取并集
  const allMentioned = new Set<string>();
  for (const msg of messagesWithMentions) {
    for (const agentId of msg.mentionedAgents) {
      allMentioned.add(agentId);
    }
  }

  // 去重：移除已在当前对话链中触发的 Agent
  const triggeredSet = new Set(currentTriggeredAgents);
  for (const agentId of allMentioned) {
    if (triggeredSet.has(agentId)) {
      allMentioned.delete(agentId);
    }
  }

  if (allMentioned.size === 0) {
    return null; // 所有目标都已被触发，跳过
  }

  return {
    triggerMessageId: lastMessage.messageId,
    targetAgentIds: [...allMentioned],
  };
}
```

### 4.6 默认 chainTimeout 值

> **Breaking Change 注意**：当前代码默认值为 300s（5 分钟）。改为按消息模式区分默认值（单播 15min / 广播 8min）后，所有未显式设置 `chainTimeout` 的现有群组行为会发生变化。需要评估是否保留 5 分钟兜底或提供迁移机制。

```typescript
/**
 * 根据消息模式返回 chainTimeout 默认值
 * - 单播模式：15 分钟（Agent 串行执行，每个耗时影响后续）
 * - 广播模式：8 分钟（Agent 并行执行，超时是主要终止手段）
 */
export function getDefaultChainTimeout(meta: GroupSessionEntry): number {
  if (meta.chainTimeout !== undefined) {
    return meta.chainTimeout;
  }
  return meta.messageMode === "unicast" ? 15 * 60_000 : 8 * 60_000;
}
```

---

## 五、Monitor 实现

### 5.1 chain-timeout.ts（新文件或在 chain-state-store.ts 中）

Monitor 是一个简单的 `setTimeout` 包装，在 chainTimeout 到期时 abort 所有 Agent：

```typescript
/**
 * 启动 chainTimeout 运行时监控
 *
 * 职责：
 * 1. 在 chainTimeout 后触发 abort，终止所有正在执行的 Agent
 * 2. 调用方在所有 Agent 完成后手动调用 stop() 清理
 * 3. 如果外部 abort（Agent 正常完成），自动清理 timer
 */
export function startChainMonitor(params: {
  groupId: string;
  chainTimeout: number;
  startedAt: number;
  abortController: AbortController;
  onTimeout: (groupId: string) => void;
}): () => void {
  const { groupId, chainTimeout, startedAt, abortController, onTimeout } = params;

  // 计算剩余时间
  const elapsed = Date.now() - startedAt;
  const remaining = chainTimeout - elapsed;

  // 如果已经超时，立即触发
  if (remaining <= 0) {
    onTimeout(groupId);
    return () => {};
  }

  const timer = setTimeout(() => {
    log.info(`[CHAIN_TIMEOUT] Group ${groupId} exceeded ${chainTimeout}ms, aborting all agents`);

    // 1. 通过 AbortSignal 终止所有 Agent（LLM Agent + CLI Agent）
    abortController.abort();

    // 2. 回调通知（广播系统消息、清理状态等）
    onTimeout(groupId);
  }, remaining);

  // 如果外部已经 abort（Agent 正常完成或手动终止），清理 timer
  const onAbort = () => {
    clearTimeout(timer);
  };
  abortController.signal.addEventListener("abort", onAbort, { once: true });

  // 返回 stop 函数
  const stop = () => {
    clearTimeout(timer);
    abortController.signal.removeEventListener("abort", onAbort);
  };

  return stop;
}
```

**关键设计**：

- `timer` 到期时调用 `abortController.abort()`，这个 signal 已经被所有 `triggerAgentReasoning` 监听，所以会自动终止所有正在执行的 Agent
- `onAbort` 监听确保在 Agent 正常完成（调用方主动 abort）时清理 timer
- 返回 `stop()` 函数供调用方在正常完成时主动清理
- 不需要额外调用 `killBridgePty()`，因为 `bridge-trigger.ts` 中的 `waitForCompletion()` 已经监听了 `signal` 的 abort 事件

---

## 六、handleGroupSend 集成改动

### 6.1 核心改动点

**文件**：`src/gateway/server-methods/group.ts`

当前流程（简化）：

```
Owner 发消息 → initChainState → new AbortController → 触发 Agent → finally { unregisterAbort }
```

改动后流程：

```
Owner 发消息 → initChainState → new AbortController → startChainMonitor → 触发 Agent
  → allSettled 完成 → stopChainMonitor → drainQueuedMessages → 如果有排队消息，递归处理
  → finally { unregisterAbort }
```

### 6.2 Owner 发消息处理

```typescript
// handleGroupSend 中，约第 540-546 行

// ── 当前代码 ──
if (resolvedSender.type === "owner") {
  initChainState(groupId, savedMsg.id);
}

const abortController = new AbortController();
registerGroupAbort(groupId, savedMsg.id, abortController);

// ── 改动后 ──
if (resolvedSender.type === "owner") {
  initChainState(groupId, savedMsg.id);

  // 启动 chainTimeout 运行时监控
  const chainTimeout = getDefaultChainTimeout(meta);
  const stopMonitor = startChainMonitor({
    groupId,
    chainTimeout,
    startedAt: Date.now(),
    abortController,
    onTimeout: (gid) => {
      log.info(`[CHAIN_TIMEOUT] Chain timed out for group ${gid}`);
      appendSystemMessage(
        gid,
        `对话链超时（${Math.round(chainTimeout / 60000)} 分钟），正在终止所有 Agent...`,
      );
      broadcastGroupSystem(context.broadcast, gid, "chain_timeout", {
        duration: chainTimeout,
      });
      removeChainMonitor(gid);
    },
  });
  setChainMonitor(groupId, stopMonitor);
}
```

### 6.3 Agent 发消息处理

Agent 在对话链执行过程中发消息（触发其他 Agent）时，不做 initChainState：

```typescript
// ── 当前代码 ──
if (resolvedSender.type === "owner") {
  initChainState(groupId, savedMsg.id);
}

// ── 改动后：增加 Agent 中间消息入队逻辑 ──
if (resolvedSender.type === "owner") {
  // Owner 在对话链执行期间发消息：入队，不重置
  const chainState = getChainState(groupId);
  if (chainState && hasActiveMonitor(groupId)) {
    // 当前有活跃对话链 → 入队
    // 注意：respond 已在上方的 appendGroupMessage 之后调用过（group.ts:524），
    // 这里只需入队并返回，不能再次调用 respond
    const mentionedAgents = dispatch.targets.map((t) => t.agentId);
    enqueueOwnerMessage(groupId, savedMsg.id, mentionedAgents, mentionedAgents.length > 0);
    log.info(
      `[CHAIN_QUEUE] Owner message ${savedMsg.id} queued for group ${groupId}, mentioned: [${mentionedAgents.join(", ")}]`,
    );
    return;
  }

  // 没有活跃对话链 → 正常启动新对话链
  initChainState(groupId, savedMsg.id);
}
```

### 6.4 广播模式触发后处理

```typescript
// ── 当前代码（约第 549-587 行） ──
if (dispatch.mode === "broadcast") {
  // ... 触发逻辑 ...
  const results = await Promise.allSettled(promises);
  // ... 日志 ...
}

// ── 改动后 ──
if (dispatch.mode === "broadcast") {
  const transcriptSnapshot = getTranscriptSnapshot(groupId);
  const promises = dispatch.targets.map(async (target) => {
    const check = await atomicCheckAndIncrement(groupId, meta, target.agentId);
    if (!check.allowed) {
      log.info(`[BROADCAST_BLOCKED] Agent ${target.agentId} blocked: ${check.reason}`);
      return { agentId: target.agentId, blocked: true, reason: check.reason };
    }

    return triggerAgentReasoning({
      groupId,
      agentId: target.agentId,
      meta,
      transcriptSnapshot,
      triggerMessage: savedMsg,
      chainState: check.newState,
      broadcast: context.broadcast,
      signal: abortController.signal,
    });
  });

  const results = await Promise.allSettled(promises);

  // 处理被阻止的 Agent（日志）
  for (const result of results) {
    if (
      result.status === "fulfilled" &&
      result.value &&
      "blocked" in result.value &&
      result.value.blocked
    ) {
      log.info(
        `[BROADCAST_BLOCKED] Agent ${result.value.agentId} was blocked: ${result.value.reason}`,
      );
    }
  }

  // ── 新增：对话链结束处理 ──
  await handleChainEnd(groupId, meta, context, abortController);
}
```

### 6.5 单播/mention 模式触发后处理

```typescript
// ── 改动后 ──
} else {
  for (const target of dispatch.targets) {
    const check = await atomicCheckAndIncrement(groupId, meta, target.agentId);
    if (!check.allowed) {
      await appendSystemMessage(groupId, `Conversation round limit reached (${check.reason})`);
      broadcastGroupSystem(context.broadcast, groupId, "round_limit", { reason: check.reason });
      break;
    }

    await triggerAgentReasoning({
      groupId,
      agentId: target.agentId,
      meta,
      transcriptSnapshot: getTranscriptSnapshot(groupId),
      triggerMessage: savedMsg,
      chainState: check.newState,
      broadcast: context.broadcast,
      signal: abortController.signal,
    });
  }

  // ── 新增：对话链结束处理 ──
  await handleChainEnd(groupId, meta, context, abortController);
}
```

### 6.6 `handleChainEnd` — 对话链结束处理

```typescript
/**
 * 对话链结束处理：
 * 1. 停止 chainTimeout monitor
 * 2. 获取当前对话链的 triggeredAgents
 * 3. 消费排队消息
 * 4. 如果有需要触发的排队消息，递归处理
 */
async function handleChainEnd(
  groupId: string,
  meta: GroupSessionEntry,
  context: GatewayContext,
  currentAbortController: AbortController,
  depth = 0,
): Promise<void> {
  if (depth > 10) {
    log.warn(`[CHAIN_DRAIN] Recursive drain limit reached for group ${groupId}`);
    return;
  }

  try {
    // 1. 停止 monitor
    stopChainMonitor(groupId);

    // 2. 获取当前对话链的 triggeredAgents（用于去重）
    const chainState = getChainState(groupId);
    const currentTriggered = chainState?.triggeredAgents ?? [];

    // 3. 消费排队消息
    const drained = drainQueuedMessages(groupId, currentTriggered);

    if (!drained) {
      return; // 没有需要处理的排队消息
    }

    log.info(
      `[CHAIN_DRAIN] Group ${groupId}: processing queued message ${drained.triggerMessageId}, ` +
        `targets: [${drained.targetAgentIds.join(", ")}]`,
    );

    // 4. 启动新一轮对话链
    initChainState(groupId, drained.triggerMessageId);

    const newAbortController = new AbortController();
    registerGroupAbort(groupId, drained.triggerMessageId, newAbortController);

    // 5. 启动新的 monitor
    const chainTimeout = getDefaultChainTimeout(meta);
    const stopMonitor = startChainMonitor({
      groupId,
      chainTimeout,
      startedAt: Date.now(),
      abortController: newAbortController,
      onTimeout: (gid) => {
        log.info(`[CHAIN_TIMEOUT] Chain timed out for group ${gid} (drained message)`);
        appendSystemMessage(
          gid,
          `对话链超时（${Math.round(chainTimeout / 60000)} 分钟），正在终止所有 Agent...`,
        );
        broadcastGroupSystem(context.broadcast, gid, "chain_timeout", { duration: chainTimeout });
        removeChainMonitor(gid);
      },
    });
    setChainMonitor(groupId, stopMonitor);

    try {
      // 6. 触发合并后的目标 Agent（并行）
      const transcriptSnapshot = getTranscriptSnapshot(groupId);
      const promises = drained.targetAgentIds.map(async (agentId) => {
        const check = await atomicCheckAndIncrement(groupId, meta, agentId);
        if (!check.allowed) {
          log.info(`[CHAIN_DRAIN_BLOCKED] Agent ${agentId} blocked: ${check.reason}`);
          return { agentId, blocked: true, reason: check.reason };
        }

        // 注意：triggerMessage 使用排队的消息 ID
        // 需要从 transcript 中获取该消息的内容
        const triggerMessage = getTranscriptSnapshot(groupId).find(
          (m) => m.id === drained!.triggerMessageId,
        );
        if (!triggerMessage) {
          log.warn(
            `[CHAIN_DRAIN] Trigger message ${drained!.triggerMessageId} not found in transcript`,
          );
          return { agentId, blocked: true, reason: "message_not_found" };
        }

        return triggerAgentReasoning({
          groupId,
          agentId,
          meta,
          transcriptSnapshot,
          triggerMessage,
          chainState: check.newState,
          broadcast: context.broadcast,
          signal: newAbortController.signal,
        });
      });

      const results = await Promise.allSettled(promises);

      // 7. 递归处理（如果新一轮执行期间又有排队消息）
      await handleChainEnd(groupId, meta, context, newAbortController, depth + 1);
    } finally {
      unregisterGroupAbort(groupId, drained.triggerMessageId);
    }
  } catch (error) {
    // handleChainEnd 自身异常不应影响主流程（外层 finally 中的 unregisterGroupAbort 仍会执行）
    log.error(`[CHAIN_DRAIN] Error in handleChainEnd for group ${groupId}:`, error);
  }
}
```

---

## 七、数据流图

### 7.1 正常流程（无排队消息）

```
Owner 发消息 M1
  │
  ├─ initChainState(M1)     → roundCount=0, triggeredAgents=∅, queuedMessages=[]
  ├─ startChainMonitor()     → setTimeout(chainTimeout)
  │
  ├─ Agent A 触发           → atomicCheckAndIncrement → roundCount=1, triggeredAgents={A}
  ├─ Agent B 触发           → atomicCheckAndIncrement → roundCount=2, triggeredAgents={A,B}
  │
  ├─ A 完成 → @ C           → atomicCheckAndIncrement(C) → roundCount=3, triggeredAgents={A,B,C}
  ├─ B 完成
  ├─ C 完成
  │
  ├─ handleChainEnd()
  │   ├─ stopChainMonitor()  → clearTimeout
  │   ├─ drainQueuedMessages() → 无排队消息 → return null
  │   └─ 结束
  │
  └─ unregisterAbort()
```

### 7.2 Owner 中间消息排队

```
Owner 发消息 M1
  │
  ├─ initChainState(M1)
  ├─ startChainMonitor()
  │
  ├─ Agent A 触发 → roundCount=1, triggeredAgents={A}
  │
  ├─ Owner 发消息 M2 @ B    → enqueueOwnerMessage(B) → queuedMessages=[{M2, [B]}]
  │
  ├─ A 完成
  │
  ├─ handleChainEnd()
  │   ├─ stopChainMonitor()
  │   ├─ drainQueuedMessages()
  │   │   ├─ 合并消息 → triggerMessageId=M2, allMentioned={B}
  │   │   ├─ 去重 → B ∉ {A} → 保留
  │   │   └─ return { triggerMessageId: M2, targetAgentIds: [B] }
  │   │
  │   ├─ initChainState(M2)  → 新一轮
  │   ├─ startChainMonitor()  → 新的 setTimeout
  │   ├─ Agent B 触发
  │   ├─ B 完成
  │   ├─ handleChainEnd()     → 无排队消息 → 结束
  │   └─ 结束
  │
  └─ unregisterAbort()
```

### 7.3 Owner 中间消息被去重跳过

```
Owner 发消息 M1 @ A
  │
  ├─ initChainState(M1)
  ├─ startChainMonitor()
  │
  ├─ Agent A 触发 → roundCount=1, triggeredAgents={A}
  │
  ├─ Owner 发消息 M2 @ A    → enqueueOwnerMessage(A) → queuedMessages=[{M2, [A]}]
  │
  ├─ A 完成
  │
  ├─ handleChainEnd()
  │   ├─ stopChainMonitor()
  │   ├─ drainQueuedMessages()
  │   │   ├─ 合并消息 → triggerMessageId=M2, allMentioned={A}
  │   │   ├─ 去重 → A ∈ {A} → 移除
  │   │   ├─ allMentioned.size === 0 → return null
  │   │   └─ 跳过 M2
  │   └─ 结束
  │
  └─ unregisterAbort()
```

### 7.4 chainTimeout 超时

```
Owner 发消息 M1
  │
  ├─ initChainState(M1)
  ├─ startChainMonitor(chainTimeout=8min)
  │
  ├─ Agent A 触发 → 执行中（耗时 15 分钟）
  │
  ├─ Owner 发消息 M2 @ B    → enqueueOwnerMessage(B)
  │
  ├─ ⏰ 8 分钟到期
  │   ├─ abortController.abort()  → Agent A 被终止
  │   ├─ onTimeout()               → 系统消息 + removeChainMonitor
  │
  ├─ Promise.allSettled 完成（A 被 abort）
  ├─ handleChainEnd()
  │   ├─ stopChainMonitor()        → 已经被 onTimeout 清理，no-op
  │   ├─ drainQueuedMessages()
  │   │   ├─ 合并 → {B}, B ∉ {A} → 启动 M2
  │   │   └─ return { triggerMessageId: M2, targetAgentIds: [B] }
  │   │
  │   ├─ initChainState(M2)
  │   ├─ startChainMonitor()
  │   ├─ Agent B 触发
  │   ├─ B 完成
  │   └─ 结束
  │
  └─ unregisterAbort()
```

---

## 八、边界情况处理

### 8.1 Monitor 重复启动保护

`setChainMonitor` 内部会先停止旧 monitor，所以不会出现多个 timer 同时运行。

### 8.2 `handleChainEnd` 递归深度

理论上递归深度 = 排队消息的合并次数。每次 `drainQueuedMessages` 都会清空队列，所以最多递归一次（当前排队消息处理期间产生的新的排队消息会在下一轮处理）。

但实际上，`drainQueuedMessages` 触发的新一轮对话链如果产生了新的排队消息，会再次调用 `handleChainEnd`。递归会在没有更多排队消息时自然终止。

**安全限制**：`handleChainEnd` 已内联 `depth` 参数（见 6.6 节），超过 10 层时强制停止并记录警告。同时外层有 `try/catch` 包裹，确保递归逻辑异常不会影响主流程。

### 8.3 Owner 消息在 timeout 回调和 handleChainEnd 之间到达

可能存在竞态：timeout 回调已经触发 abort，但在 `handleChainEnd` 执行之前，Owner 又发了一条消息。

处理方式：`enqueueOwnerMessage` 只是在 Map 中 push 数组元素，是原子操作。即使与 `drainQueuedMessages` 并发执行，`drainQueuedMessages` 也会先清空再处理，后续的消息会在下一次 `handleChainEnd` 中被处理。

### 8.4 AbortController 与 Promise.allSettled

当 `abortController.abort()` 被调用时，`triggerAgentReasoning` 内部会检测到 `signal.aborted` 并提前返回。`Promise.allSettled` 会正常 resolve（不会 reject），所以 `handleChainEnd` 总是会被执行。

### 8.5 群组解散清理

群组解散时需要清理所有状态：

```typescript
// 在现有的群组清理逻辑中追加
export function cleanupGroup(groupId: string): void {
  stopChainMonitor(groupId);
  clearChainState(groupId);
  // ... 其他清理 ...
}
```

---

## 九、测试方案

### 9.1 单元测试文件

`src/group-chat/chain-timeout.test.ts`

### 9.2 测试用例清单

| #   | 用例                                                    | 验证点                                                  |
| --- | ------------------------------------------------------- | ------------------------------------------------------- |
| 1   | `startChainMonitor` 在 timeout 后 abort                 | `abortController.signal.aborted` 为 true                |
| 2   | `startChainMonitor` 在 timeout 前被 stop() 取消         | `abortController.signal.aborted` 为 false，timer 已清理 |
| 3   | `startChainMonitor` 监听外部 abort 自动清理             | 外部 abort 后 timer 不触发                              |
| 4   | `enqueueOwnerMessage` + `drainQueuedMessages` 基本流程  | 合并消息，目标取并集                                    |
| 5   | `drainQueuedMessages` 去重：目标已在 triggeredAgents 中 | 返回 null                                               |
| 6   | `drainQueuedMessages` 部分去重                          | 返回去重后的目标                                        |
| 7   | `drainQueuedMessages` 全部无 @ 的消息                   | 返回 null                                               |
| 8   | `drainQueuedMessages` 空队列                            | 返回 null                                               |
| 9   | `atomicCheckAndIncrement` maxRounds 耗尽时清零 monitor  | `stopChainMonitor` 被调用                               |
| 10  | `initChainState` 清理旧 monitor                         | 旧 monitor 的 stop 函数被调用                           |
| 11  | `getDefaultChainTimeout` 返回正确默认值                 | 单播 15min，广播 8min                                   |
| 12  | `handleChainEnd` 递归深度限制                           | 超过 10 层时停止并记录警告                              |
| 13  | `handleChainEnd` 异常不影响主流程                       | 外层 catch 记录错误，不向上抛出                         |
| 14  | `checkAndIncrementSync` 记录 `agentId`                  | `triggeredAgents` 包含新触发的 agentId                  |

---

## 十、实施步骤

1. **types.ts** — 扩展 `ConversationChainState`（新增 `triggeredAgents`、`queuedMessages`）和 `QueuedOwnerMessage` 类型
2. **chain-state-store.ts** — 添加 monitor 管理、队列管理、`getDefaultChainTimeout`，修改 `atomicCheckAndIncrement` 签名
3. **handleChainEnd** — 在 `group.ts` 中实现对话链结束处理函数
4. **handleGroupSend** — 集成 monitor 启停、Owner 中间消息入队
5. **测试** — 编写单元测试
6. **验证** — 覆盖 anti-loop-mechanism.md 中的所有场景
