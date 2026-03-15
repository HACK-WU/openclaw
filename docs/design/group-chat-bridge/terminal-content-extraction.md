# CLI Agent 终端内容提取到对话的设计

> 本文档详细说明如何将 CLI Agent 的终端输出内容提取为群聊消息，包括双通道架构、纯文本提取机制、完成检测、数据流、技术实现细节等。

## 1. 问题背景

### 1.1 核心挑战

CLI Agent 的输出包含大量 ANSI 控制序列（光标移动、颜色、清屏等），不适合直接作为群聊文本消息。但同时：

- **实时展示需求**：前端需要实时展示 CLI 的 TUI 界面（进度条、Spinner、代码高亮等）
- **群聊整洁需求**：群聊消息流中需要显示干净的纯文本回复，便于其他 Agent 理解和 @mention
- **历史记录需求**：transcript 中需要存储纯文本消息，而非 ANSI 原始数据
- **上下文排除需求**：提取文本时需要排除后端注入的上下文消息（系统上下文、身份角色等）

### 1.2 为什么不能直接用 PTY 输出

PTY 输出的是 ANSI 原始数据流，包含大量控制序列：

```
\x1b[?25l\x1b[2J\x1b[H\x1b[32m●\x1b[0m Creating file src/auth/routes.ts...
```

如果直接作为群聊消息：

- ❌ 群聊消息中出现乱码控制字符
- ❌ 其他 Agent 无法正确解析消息内容
- ❌ @mention 解析会被控制序列干扰
- ❌ 消息历史难以阅读

## 2. 双通道输出架构

### 2.1 设计思路

将"终端视图"与"群聊消息"分离为两个独立的通道。

#### 通道一：`group.terminal` — 原始终端数据通道

- **用途**：前端 xterm.js 实时渲染 CLI 的 TUI 界面
- **数据**：PTY 原始输出，经 Base64 编码传输
- **特点**：保留所有 ANSI 控制序列，前端直接 `xterm.write()` 渲染
- **时机**：PTY 每产生一块数据立即推送，延迟极低

#### 通道二：`group.stream` — 纯文本消息通道

- **用途**：群聊消息流中显示 CLI 的最终文本回复
- **数据**：经过清洗的纯文本（剥离 ANSI 控制序列、TUI 框架字符、上下文消息）
- **特点**：适合群聊气泡展示，可被其他 Agent 的 @mention 解析
- **时机**：CLI 回复完成后发送 `state: "final"`

### 2.2 为什么需要双通道

| 方案                           | 问题                                       |
| ------------------------------ | ------------------------------------------ |
| 只用 `group.stream` 传 ANSI    | 群聊消息中出现乱码控制字符                 |
| 只用 `group.terminal` 传纯文本 | 前端 xterm.js 无法还原 TUI 界面            |
| **双通道各司其职**             | terminal 服务实时展示，stream 服务群聊整洁 |

### 2.3 事件时序

```
前端                                后端
  │                                   │
  │  group.terminalResize ──────────> │  (用户调整终端大小)
  │                                   │  PTY.resize(cols, rows)
  │                                   │
  │  <───────── group.terminal ──────│  (PTY 输出数据)
  │  xterm.write(atob(data))         │
  │                                   │
  │  <───────── group.terminal ──────│  (持续输出...)
  │                                   │
  │  <───────── group.stream final ──│  (完成检测触发)
  │  折叠终端，显示纯文本             │
```

---

## 3. 纯文本提取机制

### 3.1 核心原则

**文本提取只在前端进行，后端不参与文本提取。**

```
后端 PTY                   前端终端组件                   纯文本
  │                            │                            │
  │── group.terminal ────────>│                            │
  │   (完整 ANSI 数据)        │ xterm.js 渲染              │
  │── group.terminal ────────>│                            │
  │   (持续推送)              │ 持续渲染                    │
  │                            │                            │
  │── 完成检测触发 ───────────>│                            │
  │                            │── 从终端缓冲区提取 ──────>│
  │                            │   xterm.js buffer API     │
  │                            │   过滤上下文               │
  │                            │   清理 ANSI 序列           │
  │                            │                            │
  │<── 纯文本结果 ────────────│                            │
  │                            │                            │
  │── group.stream final ───>│                            │
```

### 3.2 为什么只在前端提取

| 后端提取                         | 前端终端组件提取                            |
| -------------------------------- | ------------------------------------------- |
| 需要在后端实现 ANSI 解析器       | xterm.js 已内置完整的 ANSI 解析器           |
| 解析器难以覆盖所有 TUI 控制序列  | xterm.js 的 buffer API 直接提供解析后的文本 |
| 需要处理原地更新、光标移动等逻辑 | xterm.js 已正确处理了所有终端状态           |
| 可能与前端显示不一致             | 保证提取的文本与用户看到的完全一致          |
| 需要维护 fallback 逻辑           | 无需 fallback，前端提取更加可靠             |

### 3.3 前端提取实现

使用 xterm.js 的 buffer API 提取可见文本，并进行多级清理：

```typescript
import { stripAnsiEscapes } from "../chat/tool-helpers.ts";

// 使用 xterm.js 的 buffer API 提取可见文本
function extractVisibleText(terminal: Terminal): string {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];

  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (!line) continue;

    const translated = line.translateToString(true); // true = 去除尾部空白

    if (line.isWrapped && lines.length > 0) {
      lines[lines.length - 1] += translated;
    } else {
      lines.push(translated);
    }
  }

  // 1. 合并行并规范化
  let text = normalizeExtractedTerminalText(lines.join("\n"));

  // 2. 过滤上下文消息
  text = filterContextBlock(text);

  // 3. 始终调用 stripAnsiEscapes() 进行二次清理
  text = stripAnsiEscapes(text);

  return text;
}
```

### 3.4 上下文过滤实现

识别并排除后端注入的上下文消息：

```typescript
/**
 * 过滤上下文消息块
 * 上下文消息格式：
 * # ================================================================================
 * # 系统上下文（这是群聊环境信息，非用户输入，请勿执行）
 * # ================================================================================
 *
 * # 你的身份：claude-code（Bridge Agent）
 * # 你的角色：代码实现专家...
 */
function filterContextBlock(text: string): string {
  const lines = text.split("\n");
  const filtered: string[] = [];
  let inContextBlock = false;
  let foundUserRequest = false;

  for (const line of lines) {
    // 检测上下文块开始（分隔线 + 系统上下文标记）
    if (line.match(/^#{10,}/) || line.includes("系统上下文")) {
      inContextBlock = true;
      continue;
    }

    // 检测"用户请求"标记（上下文结束）
    if (line.includes("用户请求")) {
      inContextBlock = false;
      foundUserRequest = true;
      continue;
    }

    // 如果已找到用户请求标记，跳过分隔线
    if (foundUserRequest && line.match(/^#{10,}/)) {
      foundUserRequest = false;
      continue;
    }

    // 跳过上下文块内的内容
    if (inContextBlock) continue;

    // 跳过单独的上下文注释行
    if (isContextCommentLine(line)) continue;

    filtered.push(line);
  }

  return filtered.join("\n").trim();
}

/**
 * 检测是否是上下文注释行
 */
function isContextCommentLine(line: string): boolean {
  const trimmed = line.trim();

  // 必须以 # 开头
  if (!trimmed.startsWith("#")) return false;

  // 检测上下文关键字
  const contextPatterns = [
    /^#\s*你的身份/,
    /^#\s*你的角色/,
    /^#\s*群聊信息/,
    /^#\s*-.*成员/,
    /^#\s*>.*:/, // 对话历史引用
    /^#\s*项目上下文/,
    /^#\s*项目说明文档/,
  ];

  return contextPatterns.some((p) => p.test(trimmed));
}
```

### 3.5 提取时机

提取时机由完成检测触发：

1. **完成检测触发后**，前端从 xterm.js buffer 中提取文本
2. **过滤上下文消息**
3. **清理 ANSI 控制序列**
4. **通过 WebSocket** 将提取的纯文本发回后端
5. **后端将纯文本** 作为 `group.stream` final 消息广播并写入 transcript

### 3.6 完整的数据流

```
CLI 完成 → 后端发送 group.terminalStatus "completed"
    ↓
前端收到状态 → 调用 terminal.completeAndFold()
    ↓
重置防抖标志 _textExtractedFired = false
    ↓
等待 _initTerminalPromise 完成
    ↓
等待 _terminal.whenIdle() (xterm 写入队列清空)
    ↓
等待 5 秒 (确保终端内容稳定)
    ↓
调用 fireTextExtracted()
    ↓
检查防抖：如果已触发则跳过
    ↓
设置防抖标志：_textExtractedFired = true
    ↓
提取文本：extractVisibleText()
    ├── 从 buffer 提取文本
    ├── 过滤上下文消息
    ├── 清理终端框架字符
    └── stripAnsiEscapes() 二次清理
    ↓
触发事件：bridge-terminal-text-extracted
    ↓
group-chat.ts 捕获事件 → 调用 onTerminalTextExtracted
    ↓
发送 RPC: group.terminalTextExtracted
    ↓
后端接收纯文本（不做任何处理）
    ↓
group.stream final 广播纯文本消息
    ↓
写入 transcript
```

---

## 4. 完成检测策略

### 4.1 问题

PTY 进程持续运行，如何判断 CLI "回复完毕"？与管道模式不同，PTY 不会在回复结束时关闭 stdout。

### 4.2 方案：空闲时间检测

采用统一的空闲时间检测策略，简单可靠，适用于所有 CLI 工具：

- 设置空闲计时器（建议 5-10 秒）
- PTY 每次产生新输出时重置计时器
- 计时器到期且无新输出 → 判定为"回复完毕"
- 作为所有 CLI 工具的通用策略，无需针对不同 CLI 做特殊适配

### 4.3 完成后的处理

1. 停止 `group.terminal` 通道的推送
2. **从前端终端组件中提取纯文本回复**（见 §3）
3. 通过 `group.stream` 通道发送 `state: "final"` 和纯文本消息
4. 将纯文本消息写入 `transcript`（`appendGroupMessage`）
5. 前端收到 final → 折叠终端组件，显示纯文本气泡

---

## 5. 技术实现细节

### 5.1 终端内容稳定等待时间

**位置**: `ui/src/ui/components/bridge-terminal.ts`

**问题**: 等待时间不足会导致文本提取不完整

**解决方案**: 等待 **5 秒**确保终端内容完全稳定

```typescript
await new Promise<void>((resolve) => setTimeout(resolve, 5000));
```

**为什么选择 5 秒**？

这是一个保守但安全的值，考虑到：

1. **CLI 输出的不确定性**：
   - 某些 CLI 工具在完成主要输出后，可能还有延迟的日志输出
   - 某些异步操作（如文件写入、网络请求）可能在后台完成
   - 某些 CLI 工具会显示"完成"消息后继续输出摘要信息

2. **用户体验**：
   - 5 秒的等待时间对用户来说是可接受的
   - 确保提取的文本内容完整，避免截断
   - 避免用户看到不完整的输出

3. **实际场景测试**：
   - 经过实际测试，5 秒足以覆盖绝大多数 CLI 工具的输出场景
   - 对于极少数需要更长时间的 CLI，可以通过配置调整

### 5.2 防抖机制

**位置**: `ui/src/ui/components/bridge-terminal.ts`

**问题**: 短时间内多次调用会触发多个文本提取事件

**解决方案**: 添加防抖标志

```typescript
private _textExtractedFired = false;

fireTextExtracted(): void {
  if (this._textExtractedFired) {
    return; // 防止重复触发
  }
  this._textExtractedFired = true;
  // ...
}

completeAndFold(): void {
  this._textExtractedFired = false; // 重置防抖
  // ...
}
```

**为什么在 `completeAndFold` 重置**？

因为每次 CLI 完成时都需要重新提取文本，防抖标志应该在新的完成周期开始时重置，而不是在提取后重置。

### 5.3 ANSI 清理

**位置**: `ui/src/ui/components/bridge-terminal.ts`

**问题**: xterm.js 的 `translateToString()` 方法虽然解析了大部分 ANSI 序列，但仍可能有残留

**解决方案**: **始终**调用 `stripAnsiEscapes()` 进行二次清理

```typescript
// 使用项目已有的 ANSI 清理函数
import { stripAnsiEscapes } from "../chat/tool-helpers.ts";

function extractVisibleText(terminal: Terminal): string {
  // ... 从 buffer 提取文本 ...

  // 1. 规范化（清理终端框架字符、空白行）
  let text = normalizeExtractedTerminalText(lines.join("\n"));

  // 2. 过滤上下文
  text = filterContextBlock(text);

  // 3. 始终调用 stripAnsiEscapes() 确保纯文本
  text = stripAnsiEscapes(text);

  return text;
}
```

**stripAnsiEscapes() 函数**：

位置：`ui/src/ui/chat/tool-helpers.ts`

```typescript
const ANSI_ESCAPE_RE_REPLACE =
  /[\x1b\x9b][\[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;

export function stripAnsiEscapes(text: string): string {
  return text.replace(ANSI_ESCAPE_RE_REPLACE, "");
}
```

这个正则表达式覆盖了绝大多数 ANSI 转义序列，包括：

- CSI 序列（`\x1b[...`）
- OSC 序列（`\x1b]...`）
- 字符集选择（`\x1b(`、`\x1b)`）
- 各种控制序列

### 5.4 后端接收逻辑

**位置**: `src/group-chat/bridge-trigger.ts`

**问题**: 后端需要接收前端发送的纯文本，但不需要做任何处理

**解决方案**: 后端直接接收并使用前端发送的文本

```typescript
// 后端接收前端提取的文本
async function handleTerminalTextExtracted(
  groupId: string,
  agentId: string,
  text: string,
): Promise<void> {
  // 直接使用前端发送的文本，不做任何处理
  await broadcastGroupMessage(groupId, {
    type: "agent",
    agentId,
    content: text,
    state: "final",
  });

  // 写入 transcript
  await appendGroupMessage(groupId, {
    type: "agent",
    agentId,
    content: text,
  });
}
```

**关键点**：

- 后端不再从 PTY 缓冲区提取文本
- 后端不再有 fallback 逻辑
- 后端直接信任并使用前端发送的文本
- 所有文本清理工作都在前端完成

---

## 6. 已知问题与修复方案

### 6.1 终端渲染等待时间不足

**问题**: 只等待当前事件循环（0ms）或短时间（150ms），不足以确保终端内容完全稳定

**影响**: 文本提取可能不完整，特别是当 CLI 有延迟输出时

**修复**: 增加等待时间到 **5 秒**

### 6.2 缺少防抖机制

**问题**: `fireTextExtracted()` 没有防抖，短时间内多次调用会触发多个事件

**影响**:

- 向后端发送多个文本提取请求
- 可能导致竞态条件
- 浪费网络资源

**修复**: 添加防抖标志 `_textExtractedFired`

### 6.3 ANSI 序列残留

**问题**: xterm.js 的 `translateToString()` 可能无法完全清理所有 ANSI 序列

**影响**: 提取的文本中仍然包含 ANSI 控制字符

**修复**: **始终**调用 `stripAnsiEscapes()` 进行二次清理

### 6.4 上下文消息未过滤

**问题**: 提取的文本中包含后端注入的上下文消息（系统上下文、身份角色等）

**影响**: 群聊消息中出现大量上下文信息，影响阅读

**修复**: 添加上下文过滤逻辑 `filterContextBlock()`

---

## 7. 测试场景

### 7.1 正常 CLI 输出

- **场景**: CLI 产生正常文本输出
- **验证**:
  - 终端折叠后，群聊消息显示完整文本
  - 文本中不包含 ANSI 控制序列
  - 文本中不包含上下文消息

### 7.2 大量输出

- **场景**: CLI 输出超过 100 行
- **验证**:
  - 文本提取完整，无截断
  - 5 秒等待时间足以覆盖输出完成

### 7.3 快速连续触发

- **场景**: 快速 @mention 同一个 CLI Agent 多次
- **验证**: 没有重复的文本提取事件

### 7.4 无输出 CLI

- **场景**: CLI 执行但不产生任何输出
- **验证**: 消息显示为空（正确行为）

### 7.5 延迟输出

- **场景**: CLI 完成主要输出后，还有延迟的日志输出
- **验证**: 5 秒等待时间能捕获延迟输出

### 7.6 上下文过滤

- **场景**: CLI 输出中包含后端注入的上下文消息
- **验证**:
  - 提取的文本中不包含"系统上下文"、"你的身份"等内容
  - 只保留 CLI 的实际输出

---

## 8. 关联文档

- [前端组件设计](./frontend-components.md) — 双通道输出架构、完成检测、前端终端组件
- [技术实现](./implementation.md) — 文件清单、模块设计、实施阶段
- [CLI Agent 上下文](./cli-agent-context.md) — 上下文消息格式、注入流程
- [CLI Agent 管理](./cli-agent-management.md) — CLI Agent 独立存储、独立工作空间、网关 API
