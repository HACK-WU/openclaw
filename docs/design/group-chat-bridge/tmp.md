让我先全面了解当前代码的完整结构，然后给出优化方案。
现在我已经完整掌握了所有代码。让我来给出完整的优化方案。

---

## 优化方案：前端驱动的完成检测 + 文本提取

### 一、当前架构问题总览

```
当前（5 层跳转，3 个文件交叉耦合）：

┌──────────────── 后端 bridge-pty.ts ────────────────┐
│ completionTimer 8s → onCompletion() → ❌ 空回调    │
│ startCompletionDetection()                          │
│ waitForFrontendExtractedText(3s 超时)               │
│ recordFrontendExtractedText()                       │
│ clearFrontendExtractedText()                        │
│ frontendExtractedTexts Map                          │
│ frontendExtractedTextWaiters Map                    │
└─────────────────────────────────────────────────────┘
        ↕ onCompletion 空回调断链
┌──────────────── 后端 bridge-trigger.ts ────────────┐
│ waitForCompletion(): 全局超时 + 轮询 isPtyRunning  │
│ resolveCompletedTerminalText(): 广播 "completed"   │
│   → waitForFrontendExtractedText(3s)               │
└─────────────────────────────────────────────────────┘
        ↕ WebSocket 双向通信
┌──────────────── 前端 bridge-terminal.ts ───────────┐
│ _resetCompletionCheck(): 8s 空闲计时器             │
│ _checkCompletion(): 改 status + completeAndFold    │
│ completeAndFold(): whenIdle(10s) + setTimeout(5s)  │
│ fireTextExtracted() → DOM 事件                      │
│   → controller → WebSocket RPC 回传后端             │
└─────────────────────────────────────────────────────┘
```

**核心缺陷：**

1. 后端 `onCompletion` 是空回调 → 8 秒检测结果无人消费
2. 后端 `waitForCompletion` 只靠全局超时 + `isPtyRunning` 轮询 → CLI 不退出就永远等
3. 前端 15 秒等待 > 后端 3 秒等待 → 时序矛盾
4. 前端和后端各自独立做 8 秒空闲检测 → 重复且不互通

---

### 二、简化方案

**原则：前端是唯一的完成检测方 + 文本提取方，后端只被动等待。**

```
优化后（单链路）：

前端 bridge-terminal.ts:
  writeBinaryData() 每次收到数据 → 重置 8s 计时器
  8s 无数据 → 立即从 xterm buffer 提取文本（无需额外等待）
  → fireTextExtracted() → DOM 事件 → controller → WebSocket 推送给后端

后端 bridge-trigger.ts:
  waitForCompletion() 简化为：等前端推来文本 || abort || 全局超时
  （删除 isPtyRunning 轮询、删除后端 completionTimer 链路）

后端 bridge-pty.ts:
  删除 completionTimer 相关的完成检测逻辑（保留 idleTimer 用于资源回收）
  保留 recordFrontendExtractedText / waitForFrontendExtractedText（作为前端→后端的数据桥）
```

---

### 三、具体代码改动

#### 改动 1：前端 `bridge-terminal.ts` — 去掉 15 秒等待，立即提取

**原因：** 前端 8 秒计时器触发时，距离最后一帧数据已 8 秒。xterm.js 的异步写入队列早在几百毫秒内就处理完了，不需要再等。

```966:985:ui/src/ui/components/bridge-terminal.ts
  private async _completeAndFoldAfterFlush(): Promise<void> {
    try {
      await this._initTerminalPromise?.catch(() => {});

      // Add timeout protection to prevent indefinite blocking when CLI has continuous output
      // (e.g., cursor blinking, status bar updates)
      const idlePromise = this._terminal?.whenIdle() ?? Promise.resolve();
      const timeoutPromise = new Promise<void>(
        (resolve) => setTimeout(resolve, 10000), // Max wait 10 seconds
      );
      await Promise.race([idlePromise, timeoutPromise]);

      // Wait 5 seconds to ensure xterm.js has fully rendered all output
      // and terminal content is stable before extracting text
      await new Promise<void>((resolve) => setTimeout(resolve, 5000));
    } finally {
      this.fireTextExtracted();
      this.collapse();
    }
  }
```

**改为：**

```typescript
  private async _completeAndFoldAfterFlush(): Promise<void> {
    try {
      await this._initTerminalPromise?.catch(() => {});

      // Wait for xterm.js write queue to drain (usually instant since
      // we already idled for 8s, but guard with a 2s timeout just in case).
      const idlePromise = this._terminal?.whenIdle() ?? Promise.resolve();
      const timeoutPromise = new Promise<void>(
        (resolve) => setTimeout(resolve, 2000),
      );
      await Promise.race([idlePromise, timeoutPromise]);
    } finally {
      this.fireTextExtracted();
      this.collapse();
    }
  }
```

> 10s + 5s → 最多 2s（保底），正常情况 0ms 就 resolve。

---

#### 改动 2：后端 `bridge-trigger.ts` — `waitForCompletion` 简化

**当前代码（607-681 行）问题：**

- `onCompletion` 空回调 → 永远不会主动触发完成
- `isPtyRunning` 轮询 → CLI 不退出就无用
- 实际只靠全局超时兜底

**改为：只等前端推送 + abort + 全局超时。**

```typescript
/**
 * Wait for frontend to push extracted text, or abort/timeout.
 * The frontend is the sole authority for completion detection
 * (8s idle on xterm.js data → extract → push back).
 */
async function waitForCompletion(params: {
  groupId: string;
  agentId: string;
  signal: AbortSignal;
  timeoutMs: number;
  broadcast: GatewayBroadcastFn;
  runId: string;
}): Promise<string> {
  const { groupId, agentId, signal, timeoutMs, broadcast } = params;

  return new Promise<string>((resolve) => {
    let resolved = false;

    const cleanup = () => {
      clearTimeout(globalTimer);
      signal.removeEventListener("abort", onAbort);
    };

    const finish = (text: string) => {
      if (resolved) {
        return;
      }
      resolved = true;
      cleanup();
      resolve(text);
    };

    // 1. Listen for frontend-pushed extracted text (the main path)
    void waitForFrontendExtractedText(groupId, agentId, timeoutMs).then((text) => {
      if (text !== null) {
        // Frontend completed detection + extraction succeeded
        broadcastTerminalStatus(broadcast, groupId, agentId, "completed", "CLI response completed");
        finish(text.trim());
      }
      // If null (timeout), the global timer or abort will handle it
    });

    // 2. Global timeout fallback
    const globalTimer = setTimeout(() => {
      broadcastTerminalStatus(broadcast, groupId, agentId, "completed", "CLI response timeout");
      finish("");
    }, timeoutMs);
    globalTimer.unref();

    // 3. Abort signal
    const onAbort = () => {
      finish("");
    };
    signal.addEventListener("abort", onAbort, { once: true });

    // 4. PTY exit detection (process crashed/terminated)
    const pollInterval = setInterval(() => {
      if (resolved) {
        clearInterval(pollInterval);
        return;
      }
      if (!isPtyRunning(groupId, agentId)) {
        clearInterval(pollInterval);
        // PTY died — use whatever the frontend has extracted so far
        broadcastTerminalStatus(broadcast, groupId, agentId, "completed", "CLI process exited");
        void waitForFrontendExtractedText(groupId, agentId, 2_000).then((text) => {
          finish((text ?? "").trim());
        });
      }
    }, 2_000);
    pollInterval.unref();
  });
}
```

**同时删除 `resolveCompletedTerminalText` 函数**（不再需要，逻辑已内联到 `waitForCompletion`）。

---

#### 改动 3：后端 `bridge-trigger.ts` — 删除后端完成检测相关调用

在 `triggerBridgeAgent` 中（约 250-254 行）：

```250:254:src/group-chat/bridge-trigger.ts
    // 4. Start completion detection and wait for completion or timeout.
    //    Clear any stale frontend extraction first so we only consume the
    //    xterm-rendered text from this run.
    clearFrontendExtractedText(groupId, agentId);
    startCompletionDetection(groupId, agentId);
```

**改为：**

```typescript
// 4. Wait for frontend completion detection + text extraction.
//    Clear any stale frontend extraction first so we only consume the
//    xterm-rendered text from this run.
clearFrontendExtractedText(groupId, agentId);
// 不再需要 startCompletionDetection — 前端自行检测
```

---

#### 改动 4：后端 `bridge-pty.ts` — 删除 `onCompletion` 回调和后端完成计时器

在 `createBridgePty` 中不再需要 `onCompletion` 参数。`completionTimer` 和 `resetCompletionTimer` 仍然保留（因为 `handlePtyData` 和 `writeToPty` 中用它重置），但 **改变用途**：从"触发完成"变为"仅用于内部状态标记"，或者直接删除。

推荐**完全删除后端的 completionTimer 链路**：

| 删除项                                                    | 位置                          |
| --------------------------------------------------------- | ----------------------------- |
| `completionTimer` 字段                                    | `ManagedPty` 类型定义 (134行) |
| `completionIdleSecs` 字段                                 | `ManagedPty` 类型定义 (136行) |
| `onCompletion` 字段                                       | `ManagedPty` 类型定义 (146行) |
| `resetCompletionTimer()`                                  | 712-718 行                    |
| `clearCompletionTimer()`                                  | 721-725 行                    |
| `handlePtyData` 中的 `resetCompletionTimer(managed)`      | 580 行                        |
| `writeToPty` 中的 `resetCompletionTimer(managed)`         | 299 行                        |
| `handlePtyExit` 中的 `clearCompletionTimer(managed)`      | 608 行                        |
| `destroyPtyInstance` 中的 `clearCompletionTimer(managed)` | 638 行                        |
| `resetIdleTimer` 中的 `clearCompletionTimer(managed)`     | 700 行                        |
| `startCompletionDetection()` 导出函数                     | 517-522 行                    |
| `cancelCompletionDetection()` 导出函数                    | 527-532 行                    |
| `createBridgePty` 的 `completionIdleSecs` 参数            | 189 行                        |
| `createBridgePty` 的 `onCompletion` 参数                  | 191 行                        |

**保留项：**

- `waitForFrontendExtractedText` — 后端等前端推文本的核心机制
- `recordFrontendExtractedText` — 前端推来文本时的接收
- `clearFrontendExtractedText` — 每次新 run 前清理
- `idleTimer` — 用于长时间无活动后回收资源（与完成检测无关）

---

#### 改动 5：后端 `bridge-trigger.ts` — `createBridgePty` 调用简化

```107:130:src/group-chat/bridge-trigger.ts
      await createBridgePty({
        groupId,
        agentId,
        config: bridgeConfig,
        effectiveCwd,
        completionIdleSecs: DEFAULT_COMPLETION_IDLE_SECS,
        onRawData: (data) => {
          outputReceived = true;
          broadcastTerminalData(broadcast, groupId, agentId, data);
        },
        onCompletion: () => {
          // Completion detected — handled by the await below
        },
        onExit: (code, _sig) => { ... },
      });
```

**改为：**

```typescript
      await createBridgePty({
        groupId,
        agentId,
        config: bridgeConfig,
        effectiveCwd,
        onRawData: (data) => {
          outputReceived = true;
          broadcastTerminalData(broadcast, groupId, agentId, data);
        },
        onExit: (code, _sig) => { ... },
      });
```

---

### 四、改动前后对比

```
改动前（断链 + 超时矛盾）：

后端 PTY 8s检测 → onCompletion() 空 → ❌
后端 waitForCompletion: 全局超时(分钟级) + 轮询(无效) → 等太久
后端 resolveCompletedTerminalText → 广播"completed" → waitForFrontendExtractedText(3s)
前端 收到"completed" → whenIdle(10s) + setTimeout(5s) → 来不及在3s内回传 → ❌

改动后（单链路）：

前端 8s无数据 → whenIdle(最多2s) → 立即提取 → WebSocket推送后端
后端 waitForFrontendExtractedText(等同全局超时) → 收到文本 → 广播"completed" → 完成

耗时：8s + ~0ms = 8s（vs 原来可能等到全局超时）
```

### 五、`waitForFrontendExtractedText` 超时调整

当前默认 3 秒超时太短。在新架构中，它不再是"等前端响应"，而是"等前端检测到完成"。超时应该与全局超时一致，直接用 `timeoutMs` 参数传入：

```typescript
// 旧：waitForFrontendExtractedText(groupId, agentId)  // 默认 3s
// 新：waitForFrontendExtractedText(groupId, agentId, timeoutMs)  // 跟全局超时一致
```

---

### 六、总结

| 维度             | 改动前                            | 改动后                      |
| ---------------- | --------------------------------- | --------------------------- |
| **完成检测方**   | 前端 + 后端各一套，互不通信       | 仅前端                      |
| **文本提取延迟** | 8s + 最多 15s = 23s               | 8s + ~0s = 8s               |
| **链路**         | 后端→前端→后端，中间还断了        | 前端→后端，单向推送         |
| **代码删减**     | —                                 | 删除后端 ~80 行完成检测代码 |
| **可靠性**       | `onCompletion` 空回调导致链路断裂 | 无断裂风险                  |

需要我直接动手改代码吗？
