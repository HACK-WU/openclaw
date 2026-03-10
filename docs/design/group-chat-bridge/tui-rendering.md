# TUI 正确渲染流程

> 本文档是整个 Bridge Agent 方案的核心。详细说明 PTY → xterm.js 的数据传输流程，以及之前失败实验的根因分析。

## 1. 为什么选择 TUI / PTY 方案

外部 CLI 编码工具（Claude Code、OpenCode、CodeBuddy CLI 等）均采用 TUI（Terminal User Interface）交互方式。

### 1.1 方案对比

| 方案                       | 方式                     | 评估                                                |
| -------------------------- | ------------------------ | --------------------------------------------------- |
| A: 非交互模式（`--print`） | stdin → stdout 管道      | ❌ 无流式输出；每次调用无上下文；部分 CLI 不支持    |
| B: stdin/stdout 管道模式   | 持久进程管道通信         | ❌ TUI 类 CLI 依赖终端环境，管道模式下无法正常运行  |
| C: PTY + 后端解析          | PTY 进程 + 后端解析 ANSI | ❌ 复杂度极高；ANSI 解析器难以覆盖所有 TUI 控制序列 |
| **D: PTY + 前端终端组件**  | PTY 进程 + xterm.js 渲染 | **✅ 推荐方案**                                     |

### 1.2 方案 D 的核心思路

- 后端通过 `node-pty` 创建伪终端，CLI 工具"认为"自己运行在真实终端中，TUI 功能正常工作
- PTY 的所有原始输出（包含 ANSI 控制序列）通过 WebSocket **一字不差**地传输到前端
- 前端使用 `xterm.js` 直接渲染原始终端数据，完美复现 CLI 的 TUI 界面
- 该架构与 VS Code Terminal、Hyper、ttyd、Wetty、code-server 等成熟产品完全一致

### 1.3 各 CLI 工具的 PTY 兼容性

| CLI 工具        | PTY 兼容性  | 说明                                 |
| --------------- | ----------- | ------------------------------------ |
| Claude Code CLI | ✅ 完全兼容 | 交互式 TUI 在 PTY 中正常工作         |
| OpenCode CLI    | ✅ 完全兼容 | 基于 Bubble Tea 的 TUI，依赖终端环境 |
| CodeBuddy CLI   | ✅ 完全兼容 | 交互式 TUI 在 PTY 中正常工作         |
| 自定义 CLI      | ✅ 兼容     | 任何终端程序都可以在 PTY 中运行      |

---

## 2. 五步保证：PTY → WebSocket → xterm.js 全链路无损传输

这是整个 TUI 方案的核心保障。**之前的失败实验证明，只要遵循这五步保证，TUI 就能正确渲染。**

### 第一步：PTY 进程创建

- 使用 `node-pty`（而非 `child_process.spawn`）创建伪终端
- CLI 工具"认为"自己运行在真实终端中，所有 TUI 功能正常输出
- **关键**：创建 PTY 时设置 `cols` 和 `rows` 参数，必须与前端 xterm.js 完全一致

### 第二步：原始数据接收

- 监听 PTY 的 `onData` 回调，获取 CLI 的原始输出
- 这些数据包含完整的 ANSI 控制序列：
  - `\r`（回车，光标移到行首）
  - `\033[2K`（清除整行）
  - `\033[A`（光标上移一行）
  - `\033[38;5;Nm`（256 色前景色）
  - 以及 TUI 框架使用的各种光标定位序列
- **关键保证：`onData` 回调中不做任何文本处理 — 不 split、不 trim、不 replace、不 filter**

### 第三步：二进制编码

- 将 PTY 原始数据转为 Base64 编码
- 目的：防止 JSON 序列化/WebSocket 传输过程中破坏控制字符
- `\r`、`\n`、`\033` 等控制字符在 JSON 中会被 escape，破坏 ANSI 序列的完整性
- Base64 将二进制数据变为安全的 ASCII 字符串，JSON 传输不会干扰内容

### 第四步：WebSocket 传输

- 通过 `group.terminal` 事件将 Base64 编码数据推送到前端
- 传输格式中包含：`groupId`、`agentId`、`data`（Base64 字符串）
- **关键保证：传输层不对 `data` 字段做任何二次处理**

### 第五步：前端渲染

- 前端收到 `group.terminal` 事件后，对 `data` 字段进行 Base64 解码
- 解码后的原始字节直接调用 `xterm.write()` 写入终端实例
- xterm.js 内置完整的 ANSI/VT100 解析器，能正确处理所有控制序列
- **关键保证：解码后不对数据做任何后处理，直接喂给 xterm.js**

---

## 3. 之前失败的根因分析

在之前的单聊 TUI 实验中，"某一行原地更新"在前端变成"大量重复行"，根因如下：

### 3.1 故障模式详解

| 故障模式         | 具体表现                                | 根因                                                            |
| ---------------- | --------------------------------------- | --------------------------------------------------------------- |
| 按行分割         | `data.split("\n")` 拆分后逐行发送       | 控制序列被截断，跨行 ANSI 序列失效                              |
| 文本 trim        | `line.trim()` 去除空白                  | `\r`（回车符）被丢弃，"回到行首覆写"失效，变成新行              |
| JSON escape      | `JSON.stringify` 将 `\033` 变为 `\\033` | xterm.js 收到的不再是 ANSI 控制字符，而是字面文本               |
| toString 编码    | `chunk.toString("utf-8")` 处理二进制    | 部分控制字符在 UTF-8 编码转换中丢失                             |
| cols/rows 不匹配 | 后端 PTY 80x24，前端 120x30             | TUI 光标定位基于 PTY 的 cols 计算，前端列数不同导致换行位置错误 |

### 3.2 核心问题

**按行分割**是最常见的问题：

```
CLI TUI 输出：
  第 1 行: "Progress: [====      ]"
  \r + \033[A  (回到行首 + 上移一行)
  第 1 行更新: "Progress: [======    ]"
  \r + \033[A
  第 1 行更新: "Progress: [========  ]"

如果按 \n 分割后逐行发送：
  前端收到 3 行独立的 "Progress: ..."
  每行都被当成新行追加 → 出现大量重复行
```

### 3.3 正确方案的本质

从 PTY 到 xterm.js 是**一条不可打断的二进制管道**。中间经过的所有环节（后端回调、编码、WebSocket、解码）只做"搬运"，不做"加工"。

```
PTY onData → Buffer.from(data, "binary") → base64 → JSON.stringify → WebSocket
                                                                    ↓
                                                          前端 atob → Buffer → xterm.write()

全程零文本处理！
```

---

## 4. 终端尺寸同步

### 4.1 问题

TUI 的布局计算（换行位置、光标定位、进度条宽度等）完全依赖终端的列数（cols）和行数（rows）。如果后端 PTY 的 cols/rows 与前端 xterm.js 不一致，会导致：

- 光标定位偏移 → TUI 界面错乱
- 自动换行位置不同 → 多出或缺少行
- 进度条长度不匹配 → 显示溢出或过短

### 4.2 方案

- PTY 创建时，使用固定的默认尺寸（建议 120 cols × 30 rows）
- 前端 xterm.js 初始化时使用相同的 cols/rows
- 前端终端组件支持 resize 时，通过 WebSocket 发送 `group.terminalResize` 事件到后端
- 后端收到 resize 事件后，调用 PTY 的 `resize(cols, rows)` 方法同步尺寸
- 如果多个客户端同时查看同一个 Bridge Agent 的终端，以**最后一次 resize** 为准（类似 tmux 的 `aggressive-resize`）

### 4.3 WebSocket 事件

| 事件名                 | 方向            | 数据                                 | 说明                        |
| ---------------------- | --------------- | ------------------------------------ | --------------------------- |
| `group.terminal`       | Server → Client | `{ groupId, agentId, data: string }` | PTY 原始输出（Base64 编码） |
| `group.terminalResize` | Client → Server | `{ groupId, agentId, cols, rows }`   | 前端终端尺寸变化            |

---

## 5. 成熟产品验证

以下产品均使用完全相同的架构（PTY → WebSocket → xterm.js），验证了该方案的可靠性：

- **VS Code 内置终端**：PTY 后端 + xterm.js 前端，微软级别的工程验证
- **Hyper**：跨平台终端应用，PTY → WebSocket → xterm.js
- **ttyd**：开源 Web 终端，将任意终端程序暴露为 Web 页面
- **Wetty**：SSH over Web，同样架构
- **code-server**：VS Code 的 Web 版，终端部分同样方案

这些产品的成功运行证明了：**只要遵循五步保证，PTY + xterm.js 方案是可靠且成熟的。**
