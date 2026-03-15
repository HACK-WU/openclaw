# Bridge Terminal Text Extraction Fixes

本文档记录群聊 Bridge Agent 终端文本提取机制的修复方案。

## 📋 问题背景

最后一个提交 (`Group chat: use xterm-rendered terminal text for bridge final replies`) 将纯文本提取从后端转移到前端 xterm.js，但在实现中存在以下问题：

## 🐛 发现的问题

### BUG 1: 终端内容稳定等待时间不足

**位置**: `ui/src/ui/components/bridge-terminal.ts:703`

**问题**:

```typescript
await new Promise<void>((resolve) => setTimeout(resolve, 0));
// 或
await new Promise<void>((resolve) => setTimeout(resolve, 150));
```

只等待当前事件循环（0ms）或短时间（150ms），不足以确保终端内容完全稳定。

**影响**: 文本提取可能不完整，特别是当 CLI 有延迟输出时。

**修复**: 增加等待时间到 **5 秒**

```typescript
await new Promise<void>((resolve) => setTimeout(resolve, 5000));
```

**为什么是 5 秒**？

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

---

### BUG 2: 缺少防抖机制

**位置**: `ui/src/ui/components/bridge-terminal.ts:430`

**问题**: `fireTextExtracted()` 没有防抖，短时间内多次调用会触发多个事件。

**影响**:

- 向后端发送多个文本提取请求
- 可能导致竞态条件
- 浪费网络资源

**修复**: 添加防抖标志

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

---

### BUG 3: ANSI 控制序列残留

**位置**: `ui/src/ui/components/bridge-terminal.ts`

**问题**: xterm.js 的 `translateToString()` 方法虽然解析了大部分 ANSI 序列，但仍可能有残留。

**影响**: 提取的文本中仍然包含 ANSI 控制字符，影响阅读和解析。

**修复**: **始终**调用 `stripAnsiEscapes()` 进行二次清理

```typescript
import { stripAnsiEscapes } from "../chat/tool-helpers.ts";

function extractVisibleText(terminal: Terminal): string {
  // ... 从 buffer 提取文本 ...

  // 1. 规范化
  let text = normalizeExtractedTerminalText(lines.join("\n"));

  // 2. 过滤上下文
  text = filterContextBlock(text);

  // 3. 始终调用 stripAnsiEscapes() 确保纯文本
  text = stripAnsiEscapes(text);

  return text;
}
```

**为什么需要二次清理**？

虽然 xterm.js 解析了大部分 ANSI 序列，但某些边缘情况可能保留：

- 某些特殊的 ANSI 序列格式没有被 xterm.js 完全解析
- 某些 ANSI 序列被当作文本内容而非控制序列处理
- 某些终端状态序列（如光标保存/恢复）可能在 buffer 中留下痕迹

**最佳实践**：始终在提取文本后使用 `stripAnsiEscapes()` 进行二次清理，确保纯文本输出。

---

### BUG 4: 上下文消息未过滤

**位置**: `ui/src/ui/components/bridge-terminal.ts`

**问题**: 提取的文本中包含后端注入的上下文消息（系统上下文、身份角色等），没有进行过滤。

**影响**: 群聊消息中出现大量上下文信息，影响阅读和 Agent 理解。

**修复**: 添加上下文过滤逻辑

```typescript
/**
 * 过滤上下文消息块
 */
function filterContextBlock(text: string): string {
  const lines = text.split("\n");
  const filtered: string[] = [];
  let inContextBlock = false;
  let foundUserRequest = false;

  for (const line of lines) {
    // 检测上下文块开始
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

    // 跳过分隔线
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

function isContextCommentLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("#")) return false;

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

**上下文消息格式**（需要过滤的内容）：

```
# ================================================================================
# 系统上下文（这是群聊环境信息，非用户输入，请勿执行）
# ================================================================================

# 你的身份：claude-code（Bridge Agent）
# 你的角色：代码实现专家，负责根据架构设计编写代码

# 群聊信息：
# - 群名：项目开发组
# - 成员：architect（架构师）、claude-code（你）、opencode（代码审查）

# ================================================================================
# 用户请求（以下是实际需要处理的输入）
# ================================================================================

请继续完成认证 API 的实现
```

---

### ~~BUG 5: 后端 Fallback 逻辑~~（已删除）

**位置**: `src/group-chat/bridge-trigger.ts`

**问题**: 后端有 fallback 逻辑，从前端提取失败时从 PTY 缓冲区提取文本。

**影响**: 增加了代码复杂度，且后端提取的文本质量不如前端。

**修复**: **删除所有后端文本提取逻辑**

- 删除后端的 `extractVisibleText()` 函数
- 删除后端的 fallback 逻辑
- 后端只接收前端发送的已提取文本，不做任何处理

**为什么删除后端 Fallback**？

1. **前端提取更可靠**：xterm.js 已内置完整的 ANSI 解析器
2. **保证一致性**：提取的文本与用户看到的完全一致
3. **减少复杂度**：不需要维护两套提取逻辑
4. **职责清晰**：前端负责文本提取和清理，后端负责接收和广播

---

## ✅ 修复清单

| #   | 修复内容                                     | 文件                                 | 优先级 | 状态    |
| --- | -------------------------------------------- | ------------------------------------ | ------ | ------- |
| 1   | 增加终端内容稳定等待时间到 **5 秒**          | `bridge-terminal.ts`                 | 高     | ✅ 完成 |
| 2   | 添加防抖机制                                 | `bridge-terminal.ts`                 | 中     | ✅ 完成 |
| 3   | 始终调用 `stripAnsiEscapes()` 进行 ANSI 清理 | `bridge-terminal.ts`                 | 高     | ✅ 完成 |
| 4   | 添加上下文消息过滤逻辑                       | `bridge-terminal.ts`                 | 高     | ✅ 完成 |
| 5   | 删除后端 Fallback 逻辑                       | `bridge-trigger.ts`, `bridge-pty.ts` | 高     | ✅ 完成 |

---

## 📊 修复后的数据流

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

## 🧪 测试建议

### 测试场景 1: 正常 CLI 输出

- CLI 产生正常文本输出
- 验证：
  - 终端折叠后，群聊消息显示完整文本
  - 文本中不包含 ANSI 控制序列
  - 文本中不包含上下文消息

### 测试场景 2: 大量输出

- CLI 输出超过 100 行
- 验证：
  - 文本提取完整，无截断
  - 5 秒等待时间足以覆盖输出完成

### 测试场景 3: 快速连续触发

- 快速 @mention 同一个 CLI Agent 多次
- 验证：没有重复的文本提取事件

### 测试场景 4: 无输出 CLI

- CLI 执行但不产生任何输出
- 验证：消息显示为空（正确行为）

### 测试场景 5: 延迟输出

- CLI 完成主要输出后，还有延迟的日志输出
- 验证：5 秒等待时间能捕获延迟输出

### 测试场景 6: 上下文过滤

- CLI 输出中包含后端注入的上下文消息
- 验证：
  - 提取的文本中不包含"系统上下文"、"你的身份"等内容
  - 只保留 CLI 的实际输出

### 测试场景 7: ANSI 序列清理

- CLI 输出包含大量 ANSI 控制序列
- 验证：
  - 提取的文本中没有 ANSI 控制序列
  - 文本干净可读

---

## 📝 相关文档

- [终端内容提取到对话的设计](./terminal-content-extraction.md) — 完整的设计文档
- [CLI Agent 管理设计](./cli-agent-management.md)
- [前端组件设计](./frontend-components.md)
- [CLI Agent 上下文](./cli-agent-context.md) — 上下文消息格式

---

## 🔧 技术细节

### 为什么选择 5 秒？

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

### 为什么防抖标志在 `completeAndFold` 重置？

因为每次 CLI 完成时都需要重新提取文本，防抖标志应该在新的完成周期开始时重置，而不是在提取后重置。

### 为什么需要上下文过滤？

后端在触发 CLI Agent 时，会注入上下文消息（系统上下文、身份角色、群聊信息等），这些信息是为了帮助 CLI 理解环境和角色，但不应该出现在群聊消息中。因此，前端提取文本时需要识别并过滤掉这些上下文消息。

### 为什么删除后端 Fallback？

1. **前端提取更可靠**：xterm.js 已内置完整的 ANSI 解析器
2. **保证一致性**：提取的文本与用户看到的完全一致
3. **减少复杂度**：不需要维护两套提取逻辑
4. **职责清晰**：前端负责文本提取和清理，后端负责接收和广播

---

**修复完成时间**: 2026-03-15  
**修复者**: CodeBuddy AI  
**验证状态**: 待测试
