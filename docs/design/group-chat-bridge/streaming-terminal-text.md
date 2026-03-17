# 终端输出实时渲染到群聊气泡

> 本文档记录 Bridge Agent 终端输出从"完成后提取"到"实时渲染"的架构演进。

## 1. 架构演进概述

### 1.1 原有设计（提取模式）

```
终端输出 → group.terminal → xterm.js 渲染 TUI
                                    ↓
                              完成后提取文本
                                    ↓
                          group.stream final → 群聊气泡
```

**特点**：

- 终端组件和群聊气泡是**两个独立的展示区域**
- 用户需要等待 CLI 完成后才能在群聊消息中看到纯文本回复
- 终端组件展示 TUI，群聊气泡展示纯文本

### 1.2 新设计（实时渲染模式）

```
终端输出 → group.terminal → xterm.js 渲染 TUI
                                    ↓
                          每 200ms 提取可见文本
                                    ↓
                    BridgeTerminalStreamUpdateEvent
                                    ↓
                      实时渲染到群聊气泡（typewriter line 模式）
                                    ↓
                          完成后冻结气泡 + 持久化
```

**特点**：

- **群聊气泡实时镜像终端输出**，无需等待完成
- 终端原地更新（`\r` 覆盖、进度条）正确反映到气泡中
- 完成后气泡冻结，文本持久化到 transcript

---

## 2. 核心实现

### 2.1 定时文本提取

**位置**: `ui/src/ui/components/bridge-terminal.ts`

每当 PTY 数据写入 xterm.js 时，调度一个延迟提取任务：

```typescript
private readonly STREAM_EXTRACT_INTERVAL = 200; // ms

private _scheduleStreamExtract(): void {
  if (this._streamExtractTimer !== null) {
    return; // Timer already scheduled
  }
  this._streamExtractTimer = window.setTimeout(() => {
    this._streamExtractTimer = null;
    this._emitStreamUpdate();
  }, this.STREAM_EXTRACT_INTERVAL);
}

private _emitStreamUpdate(): void {
  const text = this.extractVisibleText();
  if (text === this._lastStreamText) {
    return; // No change — skip
  }
  this._lastStreamText = text;
  this.dispatchEvent(new BridgeTerminalStreamUpdateEvent(this.groupId, this.agentId, text));
}
```

**为什么是 200ms**：

- 足够短，用户能感受到实时性
- 足够长，避免过于频繁的 DOM 更新和事件分发
- 与 typewriter 动画节奏匹配

### 2.2 流事件传递

**事件定义**:

```typescript
export class BridgeTerminalStreamUpdateEvent extends Event {
  static readonly eventName = "bridge-terminal-stream-update";
  constructor(
    public readonly groupId: string,
    public readonly agentId: string,
    public readonly text: string,
  ) {
    super(BridgeTerminalStreamUpdateEvent.eventName, { bubbles: true, composed: true });
  }
}
```

**数据流**:

```
bridge-terminal.ts (emit)
    ↓ BridgeTerminalStreamUpdateEvent
group-chat.ts view (capture)
    ↓ props.onTerminalStreamUpdate
app-render.ts (handler)
    ↓ handleBridgeTerminalStreamUpdate
group-chat.ts controller
    ↓ streamBuffers.set() + syncGroupStreams()
groupStreams Map 更新
    ↓
Lit reactive render
    ↓
typewriter directive (line mode)
```

### 2.3 Typewriter Line 模式

**位置**: `ui/src/ui/chat/typewriter-directive.ts`

为终端输出设计的 `"line"` 模式，与 LLM 流式输出的 `"char"` 模式区分：

```typescript
// 渲染时使用 line 模式
html`<div ${typewriter(displayText, isBridgeStream ? "line" : "char")}></div>`;
```

**Line 模式的关键行为**：

1. **逐行揭示**：每次 tick 揭示到下一个换行符，而非逐字符
2. **原地更新不回退**：当文本发生 rewrite（如 `\r` 覆盖第一行），直接显示新文本，不回退 `_revealed`

```typescript
// typewriter-directive.ts update() 中的关键逻辑
if (this._mode === "line") {
  // Line mode (terminal/CLI output): in-place line overwrites are normal
  // (e.g. \r carriage return updating a progress bar on line 1). Rewinding
  // the revealed cursor to the common prefix would cause the entire bubble
  // to re-animate from scratch, producing a jarring flicker.
  this._revealed = text.length;
}
```

---

## 3. 持久化流程

### 3.1 问题

实时渲染的气泡只是**临时状态**，刷新页面后会丢失。

### 3.2 解决方案

完成后将文本推送到后端，写入 `transcript.jsonl`：

```
前端 idle 检测（8s 无新数据）
    ↓
提取终端文本
    ↓
BridgeTerminalStreamEndEvent (携带 extractedText)
    ↓
controller 调用 group.terminalTextExtracted RPC
    ↓
后端收到文本
    ↓
写入 transcript.jsonl
    ↓
广播 group.message
    ↓
前端收到正式消息
    ↓
清理 frozen bubble（避免重复）
    ↓
刷新页面后通过 group.history 恢复 ✅
```

### 3.3 关键函数

**前端**:

- `sendTerminalTextExtracted()` — 调用 `group.terminalTextExtracted` RPC

**后端** (`src/group-chat/bridge-trigger.ts`):

- `recordFrontendExtractedText()` — 接收前端推送的文本
- `waitForCompletion()` — 等待前端推送或超时

---

## 4. 边界情况处理

### 4.1 原地更新闪烁

**问题**: 终端使用 `\r` 覆盖同一行（如进度条），导致气泡一闪一闪。

**原因**: `commonPrefixLength()` 计算出公共前缀为 0，`_revealed` 被重置到 0，整个内容重新动画。

**解决**: Line 模式下，rewrite 时直接设置 `_revealed = text.length`，瞬间显示新文本。

### 4.2 完成检测竞争

**场景**: 前端 idle 检测 vs 后端 PTY 退出检测，谁先触发？

**解决**: 两条路径都会提取文本并推送到后端，后端的 `waitForCompletion` 只处理第一次收到的文本。

### 4.3 Frozen Bubble 与正式消息重复

**问题**: 实时渲染的 frozen bubble 和后端推送的 `group.message` 同时显示。

**解决**: 在 `handleGroupMessageEvent` 中检测并清理对应的 frozen bubble：

```typescript
// When a formal message arrives from an agent, remove any frozen stream
// bubble for that agent — the persistent message supersedes the temporary
// stream bubble.
if (payload.sender.type === "agent" && "agentId" in payload.sender) {
  const frozenStream = host.groupStreams.get(payload.sender.agentId);
  if (frozenStream?.frozen) {
    const next = new Map(host.groupStreams);
    next.delete(payload.sender.agentId);
    host.groupStreams = next;
  }
}
```

---

## 5. 文件修改清单

| 文件                         | 修改内容                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `bridge-terminal.ts`         | 添加定时提取、`BridgeTerminalStreamUpdateEvent`/`EndEvent`、`extractVisibleText()`      |
| `group-chat.ts` (controller) | `handleBridgeTerminalStreamUpdate()`、`sendTerminalTextExtracted()`、清理 frozen bubble |
| `group-chat.ts` (view)       | `onTerminalStreamUpdate`/`End` 回调、`renderGroupStreamBubble()`                        |
| `app-render.ts`              | 回调绑定、RPC 调用                                                                      |
| `typewriter-directive.ts`    | Line 模式的 rewrite 处理                                                                |

---

## 6. 相关文档

- [终端内容提取到对话的设计](./terminal-content-extraction.md) — 提取机制详解
- [前端组件设计](./frontend-components.md) — 双通道架构
- [TUI 正确渲染流程](./tui-rendering.md) — PTY → xterm.js 数据流

---

**创建时间**: 2026-03-17  
**修改提交**: `d7bb17314` (持久化), `f5ccca1ad` (闪烁修复)
