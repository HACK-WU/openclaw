# 技术实现方案

> 本文档说明 Bridge Agent 的具体实现细节，包括文件清单、模块设计、实施阶段。

## 1. 文件清单

### 1.1 新增文件

| 文件                                      | 行数估算  | 说明                                                                           |
| ----------------------------------------- | --------- | ------------------------------------------------------------------------------ |
| `src/group-chat/bridge-types.ts`          | ~80       | Bridge 配置、PTY 状态、完成检测、进程隔离类型                                  |
| `src/group-chat/bridge-pty.ts`            | ~300      | PTY 进程管理器（创建/通信/尺寸同步/健康检查/重启/缓冲区）                      |
| `src/group-chat/bridge-trigger.ts`        | ~250      | Bridge Agent 触发逻辑（双通道输出、完成检测、辅助 Agent 触发）                 |
| `src/group-chat/bridge-assistant.ts`      | ~150      | 辅助 Agent 逻辑（TUI 分析、自主操作、重试兜底）                                |
| `src/group-chat/terminal-events.ts`       | ~100      | `group.terminal` / `group.terminalResize` / `group.terminalReconnect` 事件定义 |
| `ui/src/ui/components/bridge-terminal.ts` | ~350      | 前端可折叠终端组件（xterm.js 封装、纯文本提取、断线恢复）                      |
| `ui/src/ui/views/cli-agent-config.ts`     | ~200      | CLI Agent 管理配置页面（路径校验、测试启动）                                   |
| **合计**                                  | **~1430** |                                                                                |

**说明**：TUI 方案不再需要 CLI 适配器模块（如 `bridge-adapters/claude-code.ts`），因为 PTY 统一处理所有终端程序，CLI 工具的差异通过配置参数（command/args/env）解决，而非代码适配。

### 1.2 改动文件

| 文件                                  | 改动量      | 说明                                                                                                                                                                                                                                                           |
| ------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/group-chat/types.ts`             | ~55 行      | 新增 `BridgeConfig` 类型（含 `codebuddy`、`avatar`），`GroupMemberRole` 扩展 `"bridge-assistant"`，新增 `BRIDGE_ASSISTANT_PREFIX` 常量和 `isBridgeAssistant()` 辅助函数，`GroupMember` 加 `bridge?` 字段，`GroupConfig` 加 `project?` 和 `contextConfig?` 字段 |
| `src/group-chat/agent-trigger.ts`     | ~10 行      | 触发分叉判断                                                                                                                                                                                                                                                   |
| `src/group-chat/message-dispatch.ts`  | ~20 行      | @all 展开排除辅助 Agent、显式 @mention 过滤辅助 Agent、broadcast 排除辅助 Agent                                                                                                                                                                                |
| `src/group-chat/group-store.ts`       | ~5 行       | `createGroup()` 参数类型扩展支持 `"bridge-assistant"` 角色                                                                                                                                                                                                     |
| `src/group-chat/context-builder.ts`   | ~15 行      | Bridge Agent 标识；上下文消息截断逻辑                                                                                                                                                                                                                          |
| `src/group-chat/bridge-assistant.ts`  | ~50 行      | 辅助 Agent 触发冷却机制；触发次数限制                                                                                                                                                                                                                          |
| `src/group-chat/audit-logger.ts`      | ~60 行      | 辅助 Agent 操作审计日志（新增文件）                                                                                                                                                                                                                            |
| `src/gateway/server-methods/group.ts` | ~40 行      | 创建/添加成员时处理 bridge 配置；群聊项目配置；路径校验；群聊解散时清理 CLI 进程；上下文配置                                                                                                                                                                   |
| `ui/src/ui/controllers/group-chat.ts` | ~70 行      | 处理 `group.terminal` / `group.terminalResize` / `group.terminalReconnect` 事件；断线恢复                                                                                                                                                                      |
| `ui/src/ui/views/group-chat.ts`       | ~40 行      | 消息气泡中嵌入终端组件；纯文本提取回传                                                                                                                                                                                                                         |
| `ui/src/ui/views/agent-list.ts`       | ~30 行      | 智能体列表增加 CLI Agent 分类和入口                                                                                                                                                                                                                            |
| `ui/src/ui/views/group-settings.ts`   | ~25 行      | 群聊设置中添加上下文配置 UI（新增文件）                                                                                                                                                                                                                        |
| **合计**                              | **~420 行** |                                                                                                                                                                                                                                                                |

---

## 2. 核心模块设计

### 2.1 `bridge-pty.ts` — PTY 进程管理器

**职责**：管理 Bridge Agent 的 PTY 进程生命周期，实现与 CLI 的通信。

**关键功能**：

- **进程创建**：使用 `node-pty` 创建伪终端，设置 cols/rows、cwd、env 等参数
- **原始数据流**：监听 PTY 的 `onData` 回调，获取 ANSI 原始输出，转为 Base64 编码
- **消息发送**：将群聊上下文消息写入 PTY 的 stdin，触发 CLI 响应
- **尺寸同步**：接收前端 `group.terminalResize` 事件，调用 PTY 的 `resize(cols, rows)`
- **健康检查**：空闲超时自动关闭（默认 10 分钟），异常退出自动重启（最多 3 次）
- **Abort 支持**：收到 AbortSignal 时发送 SIGTERM 终止 CLI 进程

**生命周期管理**：

1. **延迟初始化**：首次被 @mention 时创建 PTY，而非群聊创建时
2. **持久运行**：PTY 进程持续运行，保持 CLI 的上下文状态
3. **空闲回收**：一段时间无交互后自动关闭，节省资源
4. **异常恢复**：进程崩溃后自动重启，记录错误日志
5. **强制终止**：群聊解散或用户主动关闭时清理进程

**依赖**：需要安装 `node-pty` 包，它是 Node.js 中最成熟的 PTY 实现，被 VS Code、Hyper 等产品使用。

### 2.2 `bridge-trigger.ts` — Bridge 触发逻辑

**职责**：在 `triggerAgentReasoning()` 分叉后，驱动 Bridge Agent 的完整响应流程。

**与内部 Agent 的关键区别**：

- 不调用 `dispatchInboundMessage()` / `getReplyFromConfig()` — 不走 LLM API
- 不构建 `GroupSystemPrompt` — CLI 有自己的上下文管理
- 不应用 `tool-policy.ts` — Bridge Agent 需要写文件/执行命令
- 通过 PTY 进程通信，而非 HTTP API

**复用的现有机制**：

- `runId` 生成 — 用于追踪单次响应
- `appendGroupMessage()` — 回复写入 transcript
- `updateChainState()` — 防循环状态更新
- `AbortSignal` — 支持用户中止

**双通道输出流程**：

1. **收到触发请求** → 构建 CLI 上下文消息 → 写入 PTY stdin
2. **PTY 产生输出** → Base64 编码 → `group.terminal` 事件广播 → 前端 xterm.js 渲染
3. **完成检测触发** → 提取纯文本回复 → `group.stream` final 事件 → 写入 transcript
4. **前端收到 final** → 折叠终端组件 → 显示纯文本气泡

> **上下文消息格式、首次/后续交互模式、截断策略、项目上下文注入等详见 [CLI Agent 上下文](./cli-agent-context.md) 文档。**

### 2.3 `terminal-events.ts` — WebSocket 事件定义

**新增事件**：

| 事件名                 | 方向            | 数据                                 | 说明                        |
| ---------------------- | --------------- | ------------------------------------ | --------------------------- |
| `group.terminal`       | Server → Client | `{ groupId, agentId, data: string }` | PTY 原始输出（Base64 编码） |
| `group.terminalResize` | Client → Server | `{ groupId, agentId, cols, rows }`   | 前端终端尺寸变化            |

### 2.4 `bridge-terminal.ts` — 前端终端组件

**职责**：在群聊消息气泡中嵌入可折叠的 xterm.js 终端组件。

**组件状态**：

- **展开状态（运行中）**：实时渲染 CLI 的 TUI 界面，显示进度条、Spinner 等
- **折叠状态（完成后）**：仅显示"点击展开终端记录"，主体显示纯文本消息

**关键功能**：

- **xterm.js 初始化**：设置 cols/rows 与后端 PTY 一致，启用 WebLinks、Search 等插件
- **数据接收**：监听 `group.terminal` 事件，Base64 解码后 `xterm.write()`
- **尺寸调整**：用户拖拽组件边缘时发送 `group.terminalResize` 事件
- **状态切换**：收到 `group.stream final` 后自动折叠，保留终端缓冲区用于回看
- **资源释放**：组件销毁时调用 `xterm.dispose()`

### 2.5 `agent-trigger.ts` 改动（最小化）

在现有的 `triggerAgentReasoning()` 函数开头增加 Bridge Agent 分叉判断：

1. 检查 `meta.members` 中当前 `agentId` 是否有 `bridge` 字段
2. 如果存在，调用 `triggerBridgeAgent()` 并返回
3. 如果不存在，继续执行现有的 LLM 推理逻辑

改动量：约 8-10 行判断逻辑，现有代码无需修改（仅整体移入 else 分支或提前 return）。

---

## 3. 实施阶段建议

### Phase 1: 后端 PTY 通信（预计 3-4 天）

**目标**：Bridge Agent 可通过 PTY 在群聊中工作，前端通过 `group.terminal` 事件接收数据

| 任务                             | 文件                 | 工作量 |
| -------------------------------- | -------------------- | ------ |
| `BridgeConfig` 类型定义          | `bridge-types.ts`    | 0.5h   |
| `GroupMember.bridge` 扩展        | `types.ts`           | 0.5h   |
| PTY 进程管理器（创建/通信/重启） | `bridge-pty.ts`      | 4h     |
| PTY 环形缓冲区（断线恢复用）     | `bridge-pty.ts`      | 1h     |
| 进程隔离（按 groupId+agentId）   | `bridge-pty.ts`      | 0.5h   |
| `group.terminal` 事件定义        | `terminal-events.ts` | 1h     |
| `triggerBridgeAgent()`           | `bridge-trigger.ts`  | 3h     |
| `triggerAgentReasoning()` 分叉   | `agent-trigger.ts`   | 0.5h   |
| RPC 添加成员支持 bridge          | `group.ts`           | 1h     |

### Phase 2: 完成检测 + 双通道输出（预计 2 天）

| 任务                      | 说明                       |
| ------------------------- | -------------------------- |
| 空闲超时检测              | 默认 5-10 秒无输出判定完成 |
| 纯文本提取                | 前端终端组件提取可见文本   |
| `group.stream` final 事件 | 发送纯文本最终消息         |

### Phase 3: 前端终端组件（预计 3-4 天）

| 任务                      | 文件                                   | 工作量 |
| ------------------------- | -------------------------------------- | ------ |
| xterm.js 封装组件         | `bridge-terminal.ts`                   | 4h     |
| `group.terminal` 事件处理 | `group-chat.ts`                        | 2h     |
| 终端尺寸同步              | `bridge-terminal.ts` + `bridge-pty.ts` | 2h     |
| 可折叠状态切换            | `bridge-terminal.ts`                   | 2h     |
| 消息气泡集成              | `group-chat.ts`                        | 2h     |

### Phase 4: UI 完善（预计 3 天）

| 任务                        | 说明                                           |
| --------------------------- | ---------------------------------------------- |
| 创建群聊时选择 Bridge Agent | 类型选择 + 命令配置 UI                         |
| CLI Agent 管理页面          | 配置表单 + CLI 类型预设 + 自动填充             |
| CLI 路径校验                | 启动命令存在性检查 + 工作目录可达性检查        |
| 测试启动功能                | 试启动 CLI 进程，验证配置正确性                |
| Bridge Agent 标识           | 成员列表/消息气泡中的 🔧 标识                  |
| Bridge 进程状态             | 在线/离线/忙碌 指示器                          |
| Bridge Agent 权限提示       | "此 Agent 拥有文件读写和命令执行权限"          |
| 群聊项目配置 UI             | 项目目录（锁定不可改）+ 项目说明文档（可修改） |

### Phase 5: 增强（可选，预计 2-3 天）

| 任务               | 说明                                 |
| ------------------ | ------------------------------------ |
| WebSocket 断线恢复 | 环形缓冲区 + 重连重放终端数据        |
| 终端缓冲区持久化   | 折叠后仍可回看完整 TUI 记录          |
| 多客户端尺寸同步   | 多人同时查看同一终端时的 resize 协调 |
| 直接终端输入       | 允许用户在终端中直接打字（高级功能） |
| 辅助 Agent 增强    | 操作历史审计、触发条件精细化         |
