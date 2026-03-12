# 前端组件设计与双通道输出

> 本文档说明 Bridge Agent 的前端展示方案，包括可折叠终端组件、双通道输出架构、完成检测策略、CLI 超时与辅助 Agent、执行状态与终止、Skill 配置、CLI Agent 管理、群聊项目配置。

## 1. 双通道输出架构

### 1.1 问题

CLI 的 TUI 输出包含大量 ANSI 控制序列（光标移动、颜色、清屏等），不适合直接作为群聊文本消息。但同时前端又需要实时展示 CLI 的 TUI 界面。

### 1.2 方案：双通道输出设计

将"终端视图"与"群聊消息"分离。

#### 通道一：`group.terminal` — 原始终端数据通道

- 用途：前端 xterm.js 实时渲染 CLI 的 TUI 界面
- 数据：PTY 原始输出，经 Base64 编码传输
- 特点：保留所有 ANSI 控制序列，前端直接 `xterm.write()` 渲染
- 时机：PTY 每产生一块数据立即推送，延迟极低

#### 通道二：`group.stream` — 纯文本消息通道

- 用途：群聊消息流中显示 CLI 的最终文本回复
- 数据：经过清洗的纯文本（剥离 ANSI 控制序列和 TUI 框架字符）
- 特点：适合群聊气泡展示，可被其他 Agent 的 @mention 解析
- 时机：CLI 回复完成后发送 `state: "final"`

### 1.3 为什么不能只用一个通道

- 如果只用 `group.stream` 传 ANSI 原始数据：群聊消息中出现乱码控制字符
- 如果只用 `group.terminal` 传纯文本：前端 xterm.js 无法还原 TUI 界面
- 两个通道各司其职：terminal 通道服务于"实时 TUI 展示"，stream 通道服务于"群聊消息整洁"

### 1.4 事件时序

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

## 2. 前端终端组件设计

### 2.1 问题

Bridge Agent 的 TUI 输出需要在群聊 UI 中展示，但群聊消息气泡中不适合直接嵌入全屏终端。

### 2.2 方案：可折叠终端组件

消息气泡中嵌入**可折叠的终端组件**，采用双层展示。

### 2.3 运行时展示（展开状态）

- 消息气泡内嵌入一个 xterm.js 终端实例
- 实时渲染 CLI 的 TUI 界面（进度条、Spinner、代码高亮等）
- 气泡顶部显示状态指示器："🔧 Claude Code 正在工作..."
- 终端组件可调整大小（拖拽边缘）
- 默认尺寸建议：宽度 100%（填满气泡），高度约 20 行

### 2.4 完成后展示（折叠状态）

- 终端组件折叠为单行："📦 Claude Code 执行完毕（点击展开终端记录）"
- 气泡主体显示纯文本最终消息（从 `group.stream` 通道获得）
- 点击折叠行可重新展开，回看完整 TUI 执行过程（xterm.js 保留了终端缓冲区）
- 纯文本消息可被其他 Agent 正常解析（@mention、上下文引用等）

### 2.5 交互能力

- Bridge Agent 的 TUI 终端默认为**只读观察模式**（用户和其他 Agent 不能直接在终端中打字）
- 输入指令通过群聊的 @mention 机制传递，后端将消息文本写入 PTY 的 stdin
- 保留未来开放"直接终端输入"的扩展可能性（类似 VS Code 终端的直接交互）

### 2.6 终端组件的生命周期

1. Bridge Agent 被 @mention 触发 → 创建终端组件（展开状态）
2. PTY 进程输出数据 → 实时推送到终端组件
3. 完成检测触发 → 终端组件折叠，显示纯文本消息
4. 用户点击展开 → 回看完整 TUI 记录
5. 页面切换/群聊关闭 → 释放 xterm.js 实例（终端缓冲区持久化到消息记录中可选）

### 2.7 UI 布局建议

- 终端组件默认高度 20 行，用户可拖拽调整
- 宽度填充整个消息气泡
- 顶部状态栏："🔧 Claude Code 正在工作..."
- 完成后顶部折叠条："📦 执行完毕（点击展开终端记录）"

---

## 3. 完成检测策略

### 3.1 问题

PTY 进程持续运行，如何判断 CLI "回复完毕"？与管道模式不同，PTY 不会在回复结束时关闭 stdout。

### 3.2 方案：空闲时间检测

采用统一的空闲时间检测策略，简单可靠，适用于所有 CLI 工具：

- 设置空闲计时器（建议 5-10 秒）
- PTY 每次产生新输出时重置计时器
- 计时器到期且无新输出 → 判定为"回复完毕"
- 作为所有 CLI 工具的通用策略，无需针对不同 CLI 做特殊适配

### 3.3 完成后的处理

1. 停止 `group.terminal` 通道的推送
2. **从前端终端组件中提取纯文本回复**（见 3.4）
3. 通过 `group.stream` 通道发送 `state: "final"` 和纯文本消息
4. 将纯文本消息写入 `transcript`（`appendGroupMessage`）
5. 前端收到 final → 折叠终端组件，显示纯文本气泡

### 3.4 纯文本提取机制

**核心原则**：CLI 的所有输出数据**完整、连续地渲染到前端终端组件中**，纯文本回复从**前端终端组件中提取**，而非在后端解析 ANSI。

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
  │                            │   获取可见文本行           │
  │                            │                            │
  │<── 纯文本结果 ────────────│                            │
  │                            │                            │
  │── group.stream final ───>│                            │
```

**为什么从前端终端组件提取**：

| 后端提取                         | 前端终端组件提取                            |
| -------------------------------- | ------------------------------------------- |
| 需要在后端实现 ANSI 解析器       | xterm.js 已内置完整的 ANSI 解析器           |
| 解析器难以覆盖所有 TUI 控制序列  | xterm.js 的 buffer API 直接提供解析后的文本 |
| 需要处理原地更新、光标移动等逻辑 | xterm.js 已正确处理了所有终端状态           |
| 可能与前端显示不一致             | 保证提取的文本与用户看到的完全一致          |

**前端提取实现**：

```typescript
// 使用 xterm.js 的 buffer API 提取可见文本
function extractVisibleText(terminal: Terminal): string {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];

  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (line) {
      lines.push(line.translateToString(true)); // true = 去除尾部空白
    }
  }

  // 去除空行和 TUI 框架字符
  return lines.filter((line) => line.trim().length > 0).join("\n");
}
```

**提取时机**：

1. 完成检测触发后，前端从 xterm.js buffer 中提取文本
2. 通过 WebSocket 将提取的纯文本发回后端
3. 后端将纯文本作为 `group.stream` final 消息广播并写入 transcript

---

## 4. CLI 输出中的 @mention 触发

### 4.1 问题

CLI 的输出内容可能包含对其他 Agent 的 @mention（如 `@architect 请检查这段代码`）。这些 @mention 应该能像用户消息一样触发相应 Agent。

### 4.2 方案：完成时解析 @mention

**触发时机**：CLI 回复完成后（`group.stream` 发送 `state: "final"` 时）

**流程**：

```
CLI 输出完成
    ↓
提取纯文本（剥离 ANSI 控制序列）
    ↓
解析纯文本中的 @mention
    ↓
触发被 @ 的 Agent（如果有）
    ↓
纯文本消息写入 transcript
```

### 4.3 为什么选择"完成时解析"而非"实时解析"

| 方案              | 优点       | 缺点                                                  |
| ----------------- | ---------- | ----------------------------------------------------- |
| 实时解析 PTY 输出 | 响应更快   | ANSI 控制序列干扰；TUI 原地更新导致重复触发；解析复杂 |
| 完成时解析纯文本  | 准确、简单 | 略有延迟（但在可接受范围内）                          |

**TUI 原地更新的问题示例**：

```
CLI 输出：@architect 请检查...
（光标回到行首）
CLI 输出：@architect 请检查这段代码
（光标回到行首）
CLI 输出：@architect 请检查这段代码的安全性
```

实时解析会把同一个 @mention 误判为 3 次触发。完成时解析只处理最终文本，避免此问题。

### 4.4 实现要点

**解析规则**：

- @mention 格式：`@agentId` 或 `@agentId 消息内容`
- 支持多个 @mention：`@architect 请设计 @reviewer 请审查`
- @mention 解析复用现有的 `parseMentions()` 函数

**触发机制**：

- 检测到 @mention 后，调用现有的 `triggerAgentReasoning()`
- 触发源标记为 `triggeredBy: "agent"`（而非 `"user"`）
- 被触发的 Agent 收到的上下文中会包含 CLI 的消息

**防止循环触发**：

- CLI A @mention CLI B → CLI B @mention CLI A → 循环
- 复用现有的 `anti-loop.ts` 机制（`updateChainState()`）
- 设置最大链式触发深度（建议 3-5 层）

### 4.5 已确认的现有机制

1. **Agent 消息能触发 @mention** ✅
   - 已确认：Agent 消息可以触发 @mention，直接复用现有机制即可

2. **触发源标识** ✅
   - 现有机制已区分 `triggeredBy: "user"` vs `"agent"`
   - UI 展示已有触发提示（显示是谁触发的）
   - 日志中可记录触发来源，用于审计追踪

---

## 5. CLI 超时与辅助 Agent 机制

### 5.1 问题

CLI 工具可能因为多种原因"卡住"：

- 等待用户输入确认（如 `Do you want to continue? [y/N]`）
- 遇到需要权限的操作但无自动确认
- 陷入某种循环或错误状态
- 正在执行耗时操作但没有输出更新

单纯的空闲超时检测无法区分"真的卡住了"还是"正在思考/执行"。且不同 CLI 内置指令各异，无法提前预定义允许指令列表。

### 5.2 方案：固定超时 + 辅助 Agent 后台自主操作

**核心思路**：不在后端做复杂的"是否卡住"判断，而是将判断和操作都交给辅助 Agent（LLM）。辅助 Agent 可以在后台自主操作 CLI，输入指令或执行其他操作来修复卡住问题。

```
CLI 超时（如 60 秒无输出 + 无 @mention）
    ↓
不在后端做"是否卡住"的复杂判断
    ↓
同步触发辅助 Agent（CLI 连接不断开）
    ↓
辅助 Agent 查看 CLI 的 TUI 输出，判断是否卡住
    ↓
辅助 Agent 自主操作 CLI（输入指令到 PTY stdin）
    ↓
同时发送提醒到前端（记录操作时间戳和内容）
```

**优势**：

- 把"智能判断 + 操作"交给 Agent（LLM），而非用代码做模式匹配
- Agent 可以理解 TUI 中的上下文（权限提示、错误信息、循环输出等），比规则引擎灵活得多
- 不同 CLI 有不同的指令集，辅助 Agent 可以根据 CLI 类型和当前上下文动态决定输入什么指令
- 无需预定义指令允许列表

### 5.2.1 辅助 Agent 的触发隔离

**核心原则**：辅助 Agent **仅由系统自动触发**（CLI 空闲超时），**不参与任何常规消息分发**。

**触发排除规则**：

| 场景                         | 辅助 Agent 是否被触发 | 实现方式                                                            |
| ---------------------------- | --------------------- | ------------------------------------------------------------------- |
| @全体成员（`@all`）          | ❌ 不触发             | `@all` 展开为成员列表时，过滤掉 `isBridgeAssistant(agentId)` 的成员 |
| broadcast 模式（无 mention） | ❌ 不触发             | 广播目标列表排除辅助 Agent                                          |
| 显式 @辅助Agent              | ❌ 不触发             | `mentions` 过滤时移除 `isBridgeAssistant(agentId)` 的条目           |
| Agent 回复中 @辅助Agent      | ❌ 不触发             | 同上，Agent 回复的 @mention 也被过滤                                |
| CLI 空闲超时                 | ✅ 触发               | 由 `bridge-trigger.ts` 直接调用，不经过 `resolveDispatchTargets()`  |

**为什么排除辅助 Agent**：

1. **职责分离**：辅助 Agent 的唯一职责是"CLI 监护"，不参与业务讨论
2. **避免干扰**：@all 或 broadcast 会触发所有成员回复，辅助 Agent 没有业务上下文，回复无意义
3. **节省资源**：不必要的 LLM 调用浪费 token 和时间
4. **防止误操作**：辅助 Agent 拥有 CLI 操作权限，被业务消息触发可能导致意外操作

### 5.3 关键设计：CLI 连接不断开

**当 CLI 卡住触发辅助 Agent 时**：

- CLI 的 PTY 连接保持活跃，不断开
- 辅助 Agent 作为**并行运行的第二个 Agent**同步介入
- 辅助 Agent 下达指令后，CLI 继续运行
- **CLI 的新输出仍然走原有终端通道**，显示在原来的终端组件中，而非辅助 Agent 的消息位置

```
┌─────────────────────────────────────────────┐
│ 群聊消息流                                    │
│                                               │
│ [CLI Agent 终端]  ← CLI 的所有输出始终在这里    │
│   正在执行...                                  │
│   [卡住 - 等待输入]                            │
│   [辅助 Agent 输入了 "yes"]  ← 继续在这里输出   │
│   继续执行...                                  │
│                                               │
│ [辅助 Agent 消息]  ← 辅助 Agent 只发提醒消息    │
│   "检测到 CLI 卡住，已自动输入 'yes' 确认操作"   │
│   "触发时间：2026-03-10 15:32:41"              │
└─────────────────────────────────────────────┘
```

**输出通道分离**：

| 内容                            | 输出位置              | 通道             |
| ------------------------------- | --------------------- | ---------------- |
| CLI 的 TUI 输出（包括恢复后的） | 原 CLI Agent 终端组件 | `group.terminal` |
| 辅助 Agent 的操作提醒           | 群聊消息气泡          | `group.stream`   |
| 辅助 Agent 的判断过程           | 群聊消息气泡          | `group.stream`   |

### 5.4 完整流程

```
CLI 工作中 → 5s 无输出 → 检测 @mention?
    ├── 有 @mention → 输出完成 → 触发被 @ 的 Agent
    └── 无 @mention → 再等 5s → 仍无输出
            ↓
        将 TUI 当前内容渲染到页面（确保前端终端组件已完整展示最新状态）
            ↓
        等待渲染完成
            ↓
        同步触发辅助 Agent（CLI 连接保持）
            ├── 辅助 Agent 从前端终端组件中获取 TUI 可见文本
            ├── 正常完成 → 辅助 Agent 总结 → 群聊消息
            └── 判定卡住 → 辅助 Agent 自主操作 CLI
                    ├── 输入指令到 PTY stdin
                    ├── CLI 恢复运行（输出走原通道）
                    └── 发送操作提醒到前端
```

### 5.4.1 辅助 Agent 获取 TUI 内容的机制

**核心设计**：辅助 Agent 触发前，**必须先确保 TUI 内容已渲染到前端终端组件**，然后辅助 Agent 从终端组件中获取可见文本。

**流程**：

```
CLI 卡住 → 空闲超时触发
    ↓
后端将 PTY 缓冲区中最近的输出数据推送到前端（group.terminal 事件）
    ↓
前端终端组件完成渲染（xterm.js write 完成）
    ↓
后端从 PTY 缓冲区提取最近 N 行可见文本（剥离 ANSI 序列）
    ↓
将可见文本作为上下文传递给辅助 Agent
    ↓
辅助 Agent 基于 TUI 内容进行判断和操作
```

**为什么先渲染再触发**：

| 不先渲染                         | 先渲染再触发                       |
| -------------------------------- | ---------------------------------- |
| 辅助 Agent 看到的 TUI 可能不完整 | 辅助 Agent 看到完整的 TUI 最新状态 |
| 用户看不到 CLI 卡在哪里          | 用户可以同步看到 CLI 的当前状态    |
| 辅助 Agent 可能做出错误判断      | 辅助 Agent 的判断基于完整信息      |

**TUI 文本提取方式**：

辅助 Agent 需要的是 TUI 的**可见文本内容**（非 ANSI 原始数据）。提取方式：

- 从 PTY 缓冲区获取最近的输出数据
- 使用 `strip-ansi` 等库剥离 ANSI 控制序列
- 去除 TUI 框架的 box-drawing 字符（`─│┌┐└┘` 等）
- 清理 Spinner 残留（如 `⠋ Loading...` 的中间帧）
- 保留最近 50-100 行有意义的文本内容

```typescript
// 辅助 Agent 上下文示例
const assistantContext = {
  cliType: "claude-code",
  tuiContent: extractVisibleText(ptyBuffer, { lines: 100 }),
  // tuiContent 示例：
  // "Creating file src/auth/routes.ts...\n"
  // "Do you want to continue? [y/N]\n"
  // "█"  ← 光标位置
  idleDuration: 65, // 已空闲 65 秒
  lastOutputTimestamp: "2026-03-10T15:31:36Z",
};
```

### 5.5 前端提醒与审计

辅助 Agent 操作 CLI 后，**必须同时发送提醒到前端**：

**提醒内容**：

- 触发时间戳（何时检测到 CLI 卡住）
- 卡住原因分析（辅助 Agent 的判断结论）
- 执行的操作（输入了什么指令）
- 操作结果（CLI 是否恢复正常）

**前端展示**：

- 提醒以系统消息形式显示在群聊中
- 带有明显的标识（如 🔧 图标），与普通消息区分
- 用户可以查看操作历史，了解辅助 Agent 做了什么

### 5.6 投递策略

直接复用现有的群聊消息投递机制：

- 新消息来了就正常投递给 CLI
- 之前的"等待辅助 Agent"计时器自动被新的交互重置
- 简单、一致、不需要额外的竞态处理逻辑

### 5.7 触发失败兜底机制

辅助 Agent 可能触发失败（网络问题、LLM 服务不可用等），需要有完整的兜底方案：

```
CLI 卡住 → 触发辅助 Agent
    ├── 成功 → 辅助 Agent 操作 CLI
    └── 失败 → 等待一段时间 → 重试触发（第 1 次）
                ├── 成功 → 辅助 Agent 操作 CLI
                └── 失败 → 等待一段时间 → 重试触发（第 2 次）
                            ├── 成功 → 辅助 Agent 操作 CLI
                            └── 失败 → 前端显示提示
                                        ├── "辅助 Agent 触发失败"
                                        ├── [手动触发辅助 Agent] 按钮
                                        └── [关闭 CLI] 按钮
```

**重试策略**：

| 参数         | 值             | 说明                                               |
| ------------ | -------------- | -------------------------------------------------- |
| 最大重试次数 | 2 次           | 首次 + 2 次重试，共 3 次机会                       |
| 重试间隔     | 10-15 秒       | 避免过于频繁                                       |
| 最终兜底     | Owner 手动干预 | 显示操作按钮                                       |
| 自动关闭超时 | 20 秒          | 手动干预提示出现后，若 20 秒内无操作则自动关闭 CLI |

**手动干预选项**：

- **手动触发辅助 Agent**：Owner 点击按钮，再次尝试触发辅助 Agent
- **关闭 CLI**：Owner 直接终止 CLI 进程（发送 SIGTERM → SIGKILL）

**自动关闭兜底**：

- 当手动干预提示出现后，启动 20 秒倒计时
- 倒计时期间前端显示："将在 XX 秒后自动关闭 CLI"
- 如果 Owner 在 20 秒内未进行任何操作（点击按钮或输入），系统自动关闭 CLI
- 自动关闭时发送群聊消息："⏹ CLI 因长时间无响应已自动关闭"
- 如果 Owner 点击了任意操作按钮，则取消自动关闭倒计时

### 5.8 辅助 Agent 判断 CLI 已退出的处理

辅助 Agent 分析 TUI 内容时，需要区分"CLI 卡住"和"CLI 已退出"两种完全不同的状态。

#### 5.8.1 状态判断

| 状态             | TUI 特征                                       | 正确处理               |
| ---------------- | ---------------------------------------------- | ---------------------- |
| **卡住等待输入** | 出现确认提示、权限提示等，光标在等待位置       | 自主输入指令           |
| **正常运行**     | 显示进度、编译、安装等，有活动迹象             | 不干预，发送状态报告   |
| **正常退出**     | 出现 `Process exited with code 0` 或类似提示   | 发送完成报告，不操作   |
| **异常退出**     | 出现 `Process exited with code 1` 或错误信息   | 发送异常报告，建议重启 |
| **崩溃**         | 出现 `panic`、`Segmentation fault`、`FATAL` 等 | 发送崩溃报告，建议重启 |

#### 5.8.2 完整判断流程

```
辅助 Agent 分析 TUI 内容
    ↓
判断 CLI 状态
    ├── 卡住等待输入 → 自主操作 CLI（输入确认/授权）
    ├── 正常运行 → 发送状态报告，不操作
    │
    ├── 正常退出（code 0）→ 发送完成报告
    │     "CLI 已正常完成任务并退出"
    │     不尝试操作已退出的进程
    │
    ├── 异常退出（code != 0）→ 发送异常报告
    │     ├── 分析退出原因（从 TUI 内容推断）
    │     ├── 建议 Owner 检查错误信息
    │     ├── 提供 [重启 CLI] 按钮（可选功能）
    │     └── 不自动重启（避免循环重启）
    │
    └── 崩溃（panic/signal）→ 发送崩溃报告
          ├── 记录崩溃信息
          ├── 建议 Owner 检查 CLI 日志
          └── 提供 [重启 CLI] 按钮（可选功能）
```

#### 5.8.3 退出状态的处理细节

**正常退出**：

```
🔧 辅助 Agent 完成报告

CLI Agent: claude-code
检测时间: 2026-03-12 15:32:41

状态分析:
  CLI 显示 "Process completed successfully"，
  进程已正常退出。

操作: 无需干预。CLI 已完成任务。
```

**异常退出**：

```
🔧 辅助 Agent 异常报告

CLI Agent: claude-code
检测时间: 2026-03-12 15:32:41

状态分析:
  CLI 显示错误信息 "ENOENT: no such file or directory"
  进程已异常退出（exit code: 1）

可能原因:
  - 项目目录配置错误
  - 缺少必要文件

建议操作:
  1. 检查项目目录是否正确
  2. 查看 CLI 完整错误日志
  3. 修复问题后可手动重启 CLI

[🔄 重启 CLI]  [📋 查看错误日志]
```

#### 5.8.4 不自动重启的原因

1. **避免循环重启**：如果问题是配置错误，自动重启只会重复失败
2. **上下文丢失**：CLI 重启后对话历史丢失，需要重新注入上下文
3. **人工判断**：某些错误需要 Owner 判断是否值得重启

**重启 CLI 的上下文恢复**（如果 Owner 选择重启）：

```typescript
async function restartCliAgent(groupId: string, agentId: string): Promise<void> {
  const group = await getGroup(groupId);
  const member = group.members.find((m) => m.agentId === agentId);

  if (!member?.bridge) return;

  // 1. 终止旧进程（如果还存在）
  await killPtyProcess(groupId, agentId);

  // 2. 创建新进程
  const pty = await createPtyProcess(groupId, agentId, member.bridge);

  // 3. 注入完整上下文（首次交互模式）
  const context = await buildFullContext(groupId);
  pty.write(context);

  // 4. 发送通知
  broadcastGroupMessage(groupId, {
    type: "system",
    content: `🔄 ${agentId} 已重启，上下文已恢复`,
  });
}
```

### 5.9 辅助 Agent 操作审计日志

辅助 Agent 可自主操作 CLI，所有操作必须持久化记录，用于审计和故障排查。

#### 5.9.1 审计日志存储

| 配置项   | 值                                    | 说明             |
| -------- | ------------------------------------- | ---------------- |
| 存储位置 | `~/.openclaw/audit/bridge-assistant/` | 审计日志专用目录 |
| 文件格式 | JSON Lines（每行一条记录）            | 便于追加和解析   |
| 文件命名 | `{YYYY-MM}.log`                       | 按月分文件       |
| 保留期限 | 30 天（可配置）                       | 自动清理过期日志 |

#### 5.9.2 审计日志格式

```typescript
type AuditLogEntry = {
  // 时间戳
  timestamp: string; // ISO 8601 格式

  // 触发信息
  groupId: string; // 群聊 ID
  cliAgentId: string; // CLI Agent 的 agentId
  assistantAgentId: string; // 辅助 Agent 的 agentId

  // 状态分析
  idleDuration: number; // 触发时 CLI 已空闲秒数
  tuiContentSnippet: string; // TUI 内容摘要（最近 500 字符）
  analysisResult: string; // 分析结论

  // 操作信息
  actionPerformed: boolean; // 是否执行了操作
  operationType?: "confirm" | "authorize" | "interrupt" | "other";
  operationDetail?: string; // 具体操作内容

  // 结果
  result: "success" | "no_action" | "failed" | "escalated";
  resultDetail?: string;
};
```

#### 5.9.3 审计日志示例

```json
{
  "timestamp": "2026-03-12T15:32:41.123Z",
  "groupId": "group-abc123",
  "cliAgentId": "claude-code",
  "assistantAgentId": "__bridge-assistant__default",
  "idleDuration": 65,
  "tuiContentSnippet": "Creating file src/auth/routes.ts...\nDo you want to continue? [y/N]",
  "analysisResult": "等待确认输入",
  "actionPerformed": true,
  "operationType": "confirm",
  "operationDetail": "输入 'y' 确认继续",
  "result": "success"
}
```

#### 5.9.4 审计日志查看

Owner 可通过以下方式查看审计日志：

- **CLI 命令**：`openclaw audit bridge-assistant --group <groupId> --date <date>`
- **Web UI**：群聊设置 → 审计日志 → 辅助 Agent 操作记录
- **日志导出**：支持导出为 JSON 或 CSV 格式

### 5.10 辅助 Agent 连续触发冷却机制

为防止 CLI 持续卡住导致辅助 Agent 被反复触发，需要设置冷却机制。

#### 5.10.1 冷却规则

| 参数                 | 值                | 说明                           |
| -------------------- | ----------------- | ------------------------------ |
| 冷却时间             | 60 秒             | 两次触发之间的最小间隔         |
| 单次运行最大触发次数 | 3 次              | 同一 CLI 运行期间最多触发 3 次 |
| 触发次数重置条件     | CLI 重启/回复完成 | CLI 完成回复后重置计数器       |

#### 5.10.2 冷却机制实现

```typescript
type TriggerState = {
  lastTriggerTime: number; // 上次触发时间戳
  triggerCount: number; // 当前运行期间触发次数
  lastResult?: string; // 上次触发结果
};

const triggerStates = new Map<string, TriggerState>();

function canTriggerAssistant(groupId: string, agentId: string): boolean {
  const key = `${groupId}:${agentId}`;
  const state = triggerStates.get(key);
  const now = Date.now();

  if (!state) {
    return true; // 首次触发
  }

  // 检查冷却时间
  if (now - state.lastTriggerTime < 60_000) {
    return false;
  }

  // 检查触发次数
  if (state.triggerCount >= 3) {
    return false;
  }

  return true;
}

function recordTrigger(groupId: string, agentId: string, result: string): void {
  const key = `${groupId}:${agentId}`;
  const state = triggerStates.get(key);

  if (state) {
    state.lastTriggerTime = Date.now();
    state.triggerCount++;
    state.lastResult = result;
  } else {
    triggerStates.set(key, {
      lastTriggerTime: Date.now(),
      triggerCount: 1,
      lastResult: result,
    });
  }
}

function resetTriggerCount(groupId: string, agentId: string): void {
  const key = `${groupId}:${agentId}`;
  triggerStates.delete(key);
}
```

#### 5.10.3 达到上限时的处理

```
触发次数已达上限（3 次）
    ↓
不触发辅助 Agent
    ↓
发送群聊消息：
    "⚠️ CLI 持续无响应，辅助 Agent 触发次数已达上限"
    "建议检查 CLI 终端状态或手动终止"
    ↓
前端显示操作按钮：
    [🔄 重启 CLI]  [⏹ 终止 CLI]  [📋 查看终端]
```

---

## 6. 群聊执行状态与终止能力

### 6.1 问题

群聊中可能有多个 Agent 或 CLI 同时在执行，用户需要知道哪些 Agent 正在运行，并能在必要时终止执行。

> **注意**：CLI Agent 也是 Agent 的一种，只是实现方式特殊（通过 PTY 运行外部 CLI 工具）。

### 6.2 群聊列表中的执行状态指示

**视觉设计**：

- 群聊成员列表中，正在执行的 Agent/CLI 旁边显示**绿色圆点**（类似在线状态）
- 圆点可以有呼吸/脉冲动画，表示"正在活跃运行"

```
群聊成员列表
├── 👤 Owner（你）
├── 🤖 Architect          ● 运行中（绿色脉冲）
├── 🔧 Claude Code (CLI)  ● 运行中（绿色脉冲）
├── 🤖 Reviewer           ○ 空闲（灰色）
└── 🔧 OpenCode (CLI)     ○ 空闲（灰色）
```

**状态类型**：

| 状态   | 指示器          | 说明                              |
| ------ | --------------- | --------------------------------- |
| 运行中 | 🟢 绿色脉冲圆点 | Agent/CLI 正在处理任务            |
| 空闲   | ⚪ 灰色圆点     | Agent/CLI 等待触发                |
| 卡住   | 🟡 黄色圆点     | CLI 检测到卡住，辅助 Agent 介入中 |
| 错误   | 🔴 红色圆点     | Agent/CLI 执行出错                |
| 离线   | 无圆点          | CLI 进程未启动或已退出            |

### 6.3 终止执行能力

**交互方式**：点击群聊成员列表中正在执行的 Agent/CLI，弹出操作菜单。

**操作菜单**：

```
┌────────────────────────┐
│ Claude Code (CLI)       │
│ 状态：运行中            │
│ 运行时长：3m 42s        │
│                        │
│ [⏹ 终止执行]           │
│ [🔄 重启 CLI]          │  ← 仅 CLI Agent
│ [📋 查看终端]           │  ← 仅 CLI Agent
└────────────────────────┘
```

**终止流程**：

```
用户点击 [终止执行]
    ↓
确认弹窗："确定要终止 Claude Code 的执行吗？"
    ↓
确认 → 发送 AbortSignal
    ├── 内部 Agent → 取消 LLM 推理
    └── CLI Agent → 发送 SIGTERM → 等 5 秒 → SIGKILL
    ↓
更新状态指示器
    ↓
群聊消息："⏹ Claude Code 已被终止"
```

---

## 7. Skill 配置机制

### 7.1 问题

不同的 Agent 在群聊中承担不同职责，需要明确各自的能力边界和行为规范。辅助 Agent 和 CLI Agent 尤其需要专属的 Skill 定义。

### 7.2 群聊级别的 Skill 配置

**核心设计**：群聊中不同的 Agent 可以配置不同的 Skill，用于明确其功能定位。

```typescript
// 群聊成员配置扩展
export type GroupMember = {
  agentId: string;
  role: GroupMemberRole;
  joinedAt: number;
  bridge?: BridgeConfig; // CLI Agent 配置
  skills?: string[]; // 该成员在此群聊中启用的 Skill 列表
};
```

**配置入口**：

- 群聊设置页面 → 成员管理 → 点击成员 → Skill 配置
- 可以为每个成员选择/取消 Skill

### 7.3 辅助 Agent 专属 Skill

**Skill 名称**：`bridge-assistant`

**Skill 文件**：[`skills/bridge-assistant/SKILL.md`](../../../../skills/bridge-assistant/SKILL.md)

**角色定位**（详见 Skill 文件 §1）：

| 定位     | 说明                                                                |
| -------- | ------------------------------------------------------------------- |
| 是什么   | CLI Agent 的后备保障、Owner 的自动化助手、群聊中的系统级角色        |
| 不是什么 | 不是业务讨论参与者、不是 CLI 的替代品、不是决策者、不是用户交互对象 |

**核心工作原则**：

1. **最小干预**：只在必要时操作 CLI，优先等待 CLI 自行恢复
2. **透明操作**：每次操作都必须向群聊发送详细的操作报告
3. **安全优先**：对不确定的操作，选择上报 Owner 而非自主操作
4. **不越权**：只处理 CLI 的运行状态问题，不干预 CLI 的业务逻辑

**Skill 涵盖内容**：

- §1 角色定位：明确辅助 Agent 的身份边界（是什么 / 不是什么）
- §2 触发时机：描述被触发时收到的上下文数据结构
- §3 TUI 内容分析：6 级优先级判断流程 + 不同 CLI 类型的特征识别
- §4 操作执行：可自主执行的操作清单 + 必须上报 Owner 的场景 + 安全约束
- §5 操作报告格式：三类标准报告模板（已操作 / 正常运行 / 需人工介入）
- §6 协作边界：与 CLI Agent、Owner、其他 Agent 的关系定义
- §7 异常处理：自身执行失败、CLI 已退出、连续触发等场景

### 7.4 CLI Agent 专属 Skill

**Skill 名称**：`bridge-cli`

**Skill 文件**：[`skills/bridge-cli/SKILL.md`](../../../../skills/bridge-cli/SKILL.md)

**角色定位**（详见 Skill 文件 §1）：

| 定位   | 说明                                                       |
| ------ | ---------------------------------------------------------- |
| 是什么 | 群聊中的代码执行者、拥有完整文件读写和命令执行能力的 Agent |
| 能力   | 文件读写、命令执行、长时间运行任务、TUI 进度展示           |
| 局限   | 不参与技术方案决策、遵循群公告规范、接受任务分配           |

**协作规范**（详见 Skill 文件 §3）：

- 收到 @mention 时，理解上下文后执行相应工作
- 完成后在回复中使用 @mention 通知相关成员
- 遵循群公告中的技术栈和代码规范
- 大型任务结束后提供执行摘要

**敏感信息处理**（详见 Skill 文件 §4）：

- **关键规则**：永远不要在输出中打印敏感信息
- 需要脱敏的信息类型：API Key、密码、Token、私钥、数据库密码、环境变量值
- 脱敏方式：使用 `***REDACTED***` 或 `[已配置]` 占位符
- 错误信息处理：包含敏感信息时必须脱敏后再报告

**Skill 涵盖内容**：

- §1 角色定位：明确 CLI Agent 的身份和能力边界
- §2 群聊上下文理解：区分系统上下文和用户请求
- §3 协作规范：接收任务、执行任务、完成任务、@mention 规范
- §4 敏感信息处理：敏感信息类型、脱敏处理方式、文件内容处理、错误信息处理
- §5 输出格式规范：进度报告、错误报告
- §6 注意事项：不要重复系统上下文、保持简洁、遵循规范、保护敏感信息

---

## 8. 智能体列表与 CLI Agent 管理

### 8.1 问题

CLI Agent 与通用 Agent 的配置方式不同，需要在智能体管理界面中区分处理。

### 8.2 智能体列表新增 CLI Agent 入口

**UI 设计**：在智能体列表页面的添加按钮处，提供两个选项。

```
┌──────────────────────────────────────┐
│ 智能体管理                            │
│                                      │
│ [+ 添加通用 Agent]  [+ 添加 CLI Agent] │
│                                      │
│ 通用 Agent                            │
│ ├── Architect  🤖                    │
│ ├── Reviewer   🤖                    │
│ └── Writer     🤖                    │
│                                      │
│ CLI Agent                            │
│ ├── Claude Code  🔧                  │
│ └── OpenCode     🔧                  │
└──────────────────────────────────────┘
```

### 8.3 通用 Agent 配置（现有）

沿用现有的 Agent 配置方式：

- Agent 名称
- 模型选择
- System Prompt
- Skill 选择
- 工具权限

### 8.4 CLI Agent 配置（新增）

CLI Agent 配置项与通用 Agent 不同：

```
┌──────────────────────────────────────┐
│ 添加 CLI Agent                        │
│                                      │
│ Agent 名称：  [claude-code        ]  │  ← 选择 CLI 类型后自动填充
│ 显示名称：    [Claude Code         ] │  ← 自动填充
│ Agent 图标：  [🤖 Claude]           │  ← 自动填充（CLI 类型对应图标）
│                                      │
│ ─── CLI 配置 ───                      │
│                                      │
│ CLI 类型：    [claude-code ▾]        │
│              选项：claude-code /      │
│              opencode / codebuddy /   │
│              custom                   │
│                                      │
│ 启动命令：   [claude              ]  │  ← 自动填充
│              CLI 可执行文件路径或命令  │
│                                      │
│ 启动参数：   [--verbose           ]  │
│              额外的命令行参数（可选）  │
│                                      │
│ 工作空间：   [/home/user/project  ]  │  ← 自动填充（主模型工作空间）
│              [📂 选择目录]            │
│              默认使用主模型的工作空间  │
│                                      │
│ 环境变量：   [+ 添加环境变量]        │
│   ANTHROPIC_API_KEY = sk-***         │
│                                      │
│ ─── 超时配置 ───                      │
│                                      │
│ 单次回复超时： [300    ] 秒          │
│ 空闲回收时间： [600    ] 秒          │
│                                      │
│ ─── Skill 配置 ───                    │
│                                      │
│ [✓] bridge-cli（默认启用）           │
│ [ ] 其他可选 Skill...                │
│                                      │
│ [取消]                   [保存]       │
└──────────────────────────────────────┘
```

### 8.4.1 CLI 路径校验与测试启动

**启动命令校验**：

保存 CLI Agent 配置时，后端对启动命令进行校验：

```
用户填写启动命令
    ↓
后端校验：命令是否存在？（which / where）
    ├── 存在 → 校验通过 ✅
    └── 不存在 → 提示错误："找不到命令 'claude'，请确认 CLI 已安装并在 PATH 中"
```

**测试启动按钮**：

配置页面提供 `[🧪 测试启动]` 按钮，点击后在后端执行一次试启动：

```
┌──────────────────────────────────────┐
│ ─── CLI 配置 ───                      │
│                                      │
│ 启动命令：   [claude              ]  │
│ 工作空间：   [/home/user/project  ]  │
│                                      │
│ [🧪 测试启动]                        │
│                                      │
│ 测试结果：                            │
│   ✅ 命令存在：/usr/local/bin/claude  │
│   ✅ 工作空间可访问                   │
│   ✅ CLI 进程可正常启动               │
│   ✅ 环境变量已注入                   │
└──────────────────────────────────────┘
```

**测试启动流程**：

1. **命令存在性检查**：使用 `which` / `where` 验证命令路径
2. **工作目录可达性检查**：验证 cwd 路径存在且可访问
3. **试启动**：使用配置的命令、参数、环境变量创建 PTY 进程
4. **启动验证**：等待 CLI 进程产生首次输出（或 5 秒超时）
5. **清理**：发送 SIGTERM 关闭试启动的进程

**校验结果展示**：

| 状态        | 展示     | 说明                       |
| ----------- | -------- | -------------------------- |
| ✅ 全部通过 | 绿色提示 | 所有检查项通过，可正常使用 |
| ⚠️ 部分警告 | 黄色提示 | 命令存在但工作目录有问题等 |
| ❌ 校验失败 | 红色提示 | 命令不存在或无法启动       |

> **注意**：测试启动不会影响任何群聊中正在运行的 CLI 进程，它创建的是完全独立的临时进程。

- 选择 CLI 类型后，Agent 名称、显示名称、启动命令、头像图标自动填充为预设值
- 工作空间默认自动填充为**主模型的工作空间**（即当前系统的工作目录）
- 所有自动填充的字段均可手动修改覆盖
- 选择 `custom` 类型时，仅工作空间自动填充，其余需用户手动填写

**配置项说明**：

| 配置项       | 必填 | 默认值           | 说明                                     |
| ------------ | ---- | ---------------- | ---------------------------------------- |
| Agent 名称   | ✅   | CLI 类型名       | 用于 @mention 的标识符，如 `claude-code` |
| 显示名称     | ✅   | CLI 类型显示名   | UI 显示的友好名称                        |
| Agent 图标   | ✅   | CLI 类型图标     | 自动填充，可修改                         |
| CLI 类型     | ✅   | —                | 预设类型或自定义                         |
| 启动命令     | ✅   | CLI 类型默认命令 | CLI 可执行文件路径或命令名               |
| 启动参数     | ❌   | —                | 额外的命令行参数                         |
| 工作空间     | ✅   | 主模型工作空间   | CLI 的工作目录（默认自动填充）           |
| 环境变量     | ❌   | —                | 传递给 CLI 进程的环境变量（如 API Key）  |
| 单次回复超时 | ❌   | 300 秒           | 默认 5 分钟                              |
| 空闲回收时间 | ❌   | 600 秒           | 默认 10 分钟                             |

### 8.5 CLI 类型预设

选择预设类型时，自动填充默认的启动命令、参数和头像：

| CLI 类型      | 默认启动命令 | 默认参数     | 默认头像        | 说明                      |
| ------------- | ------------ | ------------ | --------------- | ------------------------- |
| `claude-code` | `claude`     | —            | Claude 官方图标 | Anthropic Claude Code CLI |
| `opencode`    | `opencode`   | —            | OpenCode 图标   | OpenCode CLI              |
| `codebuddy`   | `codebuddy`  | —            | CodeBuddy 图标  | CodeBuddy CLI             |
| `custom`      | （用户填写） | （用户填写） | 默认工具图标 🔧 | 自定义 CLI 工具           |

### 8.6 与 `BridgeConfig` 的映射

CLI Agent 配置保存后，自动映射为 `BridgeConfig` 类型：

```typescript
// 用户配置 → BridgeConfig 映射
const bridgeConfig: BridgeConfig = {
  type: form.cliType, // "claude-code" | "opencode" | "custom"
  command: form.command, // "/usr/local/bin/claude"
  args: form.args, // ["--verbose"]
  cwd: form.workspace, // "/home/user/project"（Agent 管理页面配置）
  env: form.envVars, // { ANTHROPIC_API_KEY: "sk-..." }
  timeout: form.timeout * 1000, // 300_000 ms
};

// 实际启动时，cwd 取决于群聊项目配置
// const effectiveCwd = groupConfig.project?.directory ?? bridgeConfig.cwd;
```

---

## 9. 群聊项目配置

### 9.1 问题

群聊中多个 Agent 协作时，需要有统一的项目上下文：产出文件放在哪里？Agent 如何了解项目背景？同时不能破坏 Agent 管理页面已配置的工作空间。

### 9.2 新建群聊时的项目配置

新建群聊时，可以**额外设置项目目录和项目说明文档路径**（可选）。

同时，成员列表中每个成员的角色需要**手动指定**（不再由系统自动识别）。

```
┌──────────────────────────────────────┐
│ 新建群聊                              │
│                                      │
│ 群聊名称：   [前端重构讨论        ]  │
│ 群公告：     [技术栈：React + TS  ]  │
│                                      │
│ ─── 项目配置（可选）───               │
│                                      │
│ 项目目录：   [/home/user/my-app   ]  │
│              ⚠️ 手动填写，不提供目录选择│
│              群聊中产生的文件放在此目录 │
│              设置后 CLI Agent 将在此目录│
│              中启动                    │
│                                      │
│ 项目说明：   [/home/user/my-app/  ]  │
│              [  README.md         ]  │
│              ⚠️ 手动填写路径           │
│              Agent 可读取此文档了解项目 │
│                                      │
│ ─── 成员 ───                          │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │ 成员         │ 角色              │ │
│ ├──────────────┼──────────────────┤ │
│ │ 🤖 Architect │ [管理员 ▾]       │ │
│ │ 🤖 Dev       │ [普通成员 ▾]     │ │
│ │ 🔧 Claude    │ [普通成员 ▾]     │ │
│ │ 🛡️ 辅助Agent │ [辅助Agent ▾]    │ │
│ └──────────────┴──────────────────┘ │
│                                      │
│ [+ 添加成员]                          │
│                                      │
│ [取消]                   [创建]       │
└──────────────────────────────────────┘
```

### 9.2.1 成员角色手动指定

**核心变更**：管理员（assistant）和辅助 Agent（bridge-assistant）角色从"系统自动识别"改为**完全手动指定**。

**角色选项**：

| 角色选项   | 内部值               | 说明                                            | 每群限制    |
| ---------- | -------------------- | ----------------------------------------------- | ----------- |
| 管理员     | `"assistant"`        | 群聊协调者，unicast 模式下的默认消息接收者      | 建议 1 个   |
| 普通成员   | `"member"`           | 普通群聊参与者                                  | 无限制      |
| 辅助 Agent | `"bridge-assistant"` | CLI 监护者，不参与业务讨论，仅在 CLI 卡住时介入 | 建议 0-1 个 |

**交互规则**：

1. 每个成员的角色通过**下拉选择器**指定
2. 默认角色为"普通成员"
3. 选择"辅助 Agent"角色时，系统自动为该成员的 `agentId` 添加 `__bridge-assistant__` 前缀
4. 已有的辅助 Agent 角色选择器会显示提示："⚠️ 辅助 Agent 不会被 @全体成员 或 broadcast 触发"
5. 创建后，角色不可在群聊设置中更改（需删除成员后重新添加）

**辅助 Agent 的 agentId 自动处理**：

```
用户选择辅助 Agent 角色
    ↓
前端自动为 agentId 添加 __bridge-assistant__ 前缀
    例：用户选择 "assistant-bot" → agentId 变为 "__bridge-assistant__assistant-bot"
    ↓
后端存储时使用带前缀的 agentId
```

**为什么不沿用系统自动识别**：

| 自动识别                                      | 手动指定                       |
| --------------------------------------------- | ------------------------------ |
| 系统根据成员数量/类型猜测角色，可能不符合预期 | Owner 明确控制每个成员的职责   |
| 辅助 Agent 无法被系统自动区分                 | Owner 明确指定哪些是辅助 Agent |
| 角色调整需要间接操作                          | 创建时直接选择，一目了然       |

### 9.2.2 项目目录路径校验规则

> **安全说明**：项目目录和项目说明文档路径均为**手动填写**，不提供文件/目录选择器。这是因为目录选择器会暴露服务器的文件系统结构信息，存在安全风险。

**路径校验规则**：

后端在创建群聊时对项目目录路径进行严格校验，防止越权访问和路径遍历攻击。

```typescript
// 路径校验配置
const PATH_VALIDATION = {
  // 允许的路径前缀（至少匹配一个）
  allowedPrefixes: [
    process.env.HOME, // 用户主目录
    "/home", // Linux 用户目录
    "/Users", // macOS 用户目录
    "/workspace", // 常见工作区目录
  ].filter(Boolean),

  // 禁止的路径（精确匹配或前缀匹配）
  forbiddenPaths: [
    "/etc", // 系统配置
    "/root", // root 用户目录
    "/.ssh", // SSH 密钥
    "/.gnupg", // GPG 密钥
    "/var/log", // 系统日志
    "/proc", // 进程信息
    "/sys", // 系统信息
  ],

  // 禁止的路径模式
  forbiddenPatterns: [
    /\.\./, // 路径遍历攻击
    /^\/$/, // 根目录
    /\/\./, // 隐藏目录
  ],
};

function validateProjectPath(path: string): { valid: boolean; error?: string } {
  // 1. 解析为绝对路径（处理相对路径和符号链接）
  const resolvedPath = pathResolve(path);
  const realPath = fs.existsSync(resolvedPath) ? fs.realpathSync(resolvedPath) : resolvedPath;

  // 2. 检查禁止路径模式
  for (const pattern of PATH_VALIDATION.forbiddenPatterns) {
    if (pattern.test(realPath)) {
      return { valid: false, error: "路径包含不允许的模式" };
    }
  }

  // 3. 检查禁止路径
  for (const forbidden of PATH_VALIDATION.forbiddenPaths) {
    if (realPath.startsWith(forbidden)) {
      return { valid: false, error: `不允许访问 ${forbidden} 目录` };
    }
  }

  // 4. 检查允许前缀
  const isAllowed = PATH_VALIDATION.allowedPrefixes.some((prefix) => realPath.startsWith(prefix));
  if (!isAllowed) {
    return { valid: false, error: "路径不在允许的目录范围内" };
  }

  // 5. 检查符号链接目标（防止通过符号链接绕过限制）
  if (fs.existsSync(realPath)) {
    const stats = fs.lstatSync(realPath);
    if (stats.isSymbolicLink()) {
      const target = fs.readlinkSync(realPath);
      // 递归校验符号链接目标
      return validateProjectPath(target);
    }
  }

  return { valid: true };
}
```

**校验流程**：

```
用户填写项目目录路径
    ↓
后端校验
    ├── 路径格式合法？
    │     └── 否 → 错误："路径格式不正确"
    ├── 路径遍历攻击？
    │     └── 是 → 错误："路径包含不允许的相对路径"
    ├── 在禁止列表中？
    │     └── 是 → 错误："不允许访问该目录"
    ├── 在允许前缀范围内？
    │     └── 否 → 错误："路径不在允许的目录范围内"
    └── 通过校验 ✅
          ↓
        创建群聊
```

**前端提示**：

| 校验结果     | 提示样式 | 提示文案                       |
| ------------ | -------- | ------------------------------ |
| 通过         | 无       | —                              |
| 路径格式错误 | 红色     | "路径格式不正确"               |
| 路径遍历攻击 | 红色     | "路径不能包含 .. 或隐藏目录"   |
| 禁止目录     | 红色     | "不允许访问系统敏感目录"       |
| 不在允许范围 | 红色     | "路径必须在用户目录或工作区内" |

**项目说明文档路径校验**：

项目说明文档路径同样需要校验，规则与项目目录类似，但额外检查：

- 文件是否存在（不存在时警告，不阻止创建）
- 文件是否可读（无权限时警告，不阻止创建）
- 文件类型是否为文本（非 .md/.txt 等时警告）

### 9.3 项目目录与 Agent 工作空间的关系

**核心原则**：群聊项目目录**不覆盖** Agent 管理页面配置的工作空间配置本身，但**会影响 CLI Agent 的启动目录**。

```
┌─────────────────────────────────────────────────────┐
│ Agent 管理页面                                        │
│   Claude Code (CLI) 工作空间：/home/user/workspace   │
│                                                      │
│ 群聊项目配置                                          │
│   项目目录：/home/user/my-app                         │
│                                                      │
│ 实际效果                                              │
│   CLI 启动的 cwd = 群聊项目目录（优先）               │
│                    若未设置 → 回退到 Agent 工作空间    │
│   群聊产出的文件 → 放在项目目录下                      │
│   Agent 可读取项目说明文档了解上下文                    │
│                                                      │
│ ⚠️ Agent 管理页面的工作空间配置不会被修改              │
│   仅在该群聊中启动时使用项目目录作为 cwd              │
└─────────────────────────────────────────────────────┘
```

**优先级与作用域**：

| 配置           | 来源           | 作用                              | 优先级                         |
| -------------- | -------------- | --------------------------------- | ------------------------------ |
| 群聊项目目录   | 群聊设置       | CLI 启动时的 `cwd` + 产出文件目录 | 高（设置后优先使用）           |
| Agent 工作空间 | Agent 管理页面 | CLI 启动时的 `cwd`（回退值）      | 低（群聊未设置项目目录时使用） |
| 群聊项目说明   | 群聊设置       | Agent 了解项目背景的文档          | 可随时修改                     |

> **注意**：群聊项目目录不会修改 Agent 管理页面中配置的工作空间。同一个 CLI Agent 在不同群聊中可以有不同的项目目录，启动时 `cwd` 取决于当前群聊的项目配置。

### 9.3.1 项目配置的修改规则

群聊创建后，项目配置的可修改性有明确限制：

| 配置项       | 创建后可修改  | 说明                                 |
| ------------ | ------------- | ------------------------------------ |
| 项目目录     | ❌ 不可修改   | 创建群聊时设定后锁定，不支持后续修改 |
| 项目说明文档 | ✅ 可重新配置 | 随时可以添加、删除或修改文档路径列表 |

**项目目录不可修改的原因**：

1. **上下文一致性**：CLI Agent 的对话历史、已创建文件等都与项目目录绑定，中途修改 cwd 会导致上下文断裂
2. **文件引用完整性**：群聊中讨论的文件路径以项目目录为基准，修改后历史引用全部失效
3. **进程安全**：正在运行的 CLI 进程的 cwd 无法热切换，修改后需要重启进程，可能丢失未保存的工作

**项目说明文档可修改的原因**：

- 文档只是为 Agent 提供**参考信息**，修改不影响 CLI 的执行环境
- 项目进展中可能需要更新文档引用（如新增架构文档、变更说明等）
- 修改后**下次 Agent 触发时生效**，不影响当前正在运行的 CLI

**UI 展示**：

```
┌──────────────────────────────────────┐
│ 群聊设置                              │
│                                      │
│ ─── 项目配置 ───                      │
│                                      │
│ 项目目录：   /home/user/my-app       │
│              🔒 创建时已锁定，不可修改 │
│                                      │
│ 项目说明：   [/home/user/my-app/  ]  │
│              [  README.md         ]  │
│              [  ARCHITECTURE.md   ]  │
│              [+ 添加文档路径]         │
│              [保存修改]               │
└──────────────────────────────────────┘
```

### 9.4 项目说明文档

**用途**：让 Agent 更好地了解项目上下文，提高协作质量。

**工作方式**：

- 群聊配置中指定文档路径（如 `README.md`、`ARCHITECTURE.md`、`docs/guide.md`）
- 支持配置**多个文档路径**
- Agent 被触发时，系统自动将项目说明文档内容注入到 Agent 的上下文中
- Agent 可以根据文档中的信息理解项目结构、技术栈、编码规范等

**支持的文档格式**：

- Markdown (`.md`)
- 纯文本 (`.txt`)
- 其他可读文本文件

```typescript
// 群聊配置扩展
export type GroupConfig = {
  id: string;
  name: string;
  announcement?: string;
  members: GroupMember[];
  project?: {
    directory?: string; // 项目目录（产出文件的目标位置）
    docs?: string[]; // 项目说明文档路径列表
  };
};
```

### 9.5 项目目录的使用场景

当群聊设置了项目目录后：

- **CLI 启动目录**：CLI Agent 在项目目录中启动（`cwd` = 群聊项目目录），无需额外切换目录即可操作项目文件
- **文件产出定向**：Agent 在群聊中生成的代码文件、配置文件等，自然放在项目目录下
- **相对路径基准**：群聊中讨论的文件路径，以项目目录为基准解析
- **不修改 Agent 配置**：Agent 管理页面中的工作空间配置保持不变，仅在该群聊中使用项目目录

当群聊**未设置**项目目录时：

- CLI Agent 仍然以 Agent 管理页面配置的工作空间启动
- 行为与之前完全一致

---

## 10. 工具卡片展示

### 10.1 问题

内部 Agent 的工具调用（文件读取、搜索等）会以卡片形式在 UI 展示。Bridge Agent 的 CLI 操作如何展示？

### 10.2 方案

CLI 的输出内容不进行额外的工具卡片展示，直接在终端组件中显示。

在 TUI 方案下，CLI 的工具调用过程本身已经在终端组件中可视化展示了（CLI 的 TUI 会显示文件操作、命令执行的进度、工具调用详情等），工具卡片是多余的。终端组件本身就是最完整、最实时的展示方式。
