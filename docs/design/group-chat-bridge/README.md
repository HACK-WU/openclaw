# 群聊集成外部 CLI 编码工具 — Bridge Agent 方案

> **版本**: v3.0 | **日期**: 2026-03-12

将外部 CLI 编码工具（Claude Code CLI、OpenCode CLI、CodeBuddy CLI 等）作为群聊中的"特殊成员"加入，使其与内部 Agent 协作完成大型项目。这些外部 CLI 拥有**完整的文件读写、命令执行能力**，不受群聊 read-only 策略限制。

## 文档导航

| 文档                                                   | 内容                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| [架构分析](./architecture.md)                          | 当前架构分析、可行性评估、Agent 类型扩展、进程隔离策略         |
| [TUI 渲染流程](./tui-rendering.md)                     | PTY → xterm.js 五步保证、失败根因分析、终端尺寸同步、断线恢复  |
| [前端组件设计](./frontend-components.md)               | 可折叠终端组件、双通道输出、完成检测、群聊项目配置、辅助 Agent |
| [CLI Agent 管理](./cli-agent-management.md)            | CLI Agent 独立存储、独立目录、独立 UI 面板、测试功能、群聊触发 |
| [CLI Agent 上下文](./cli-agent-context.md)             | 上下文消息格式、首次/后续交互、截断策略、项目上下文注入        |
| [终端内容提取到对话](./terminal-content-extraction.md) | 双通道架构、纯文本提取机制、完成检测、数据流、技术细节         |
| [技术实现](./implementation.md)                        | 文件清单、模块设计、实施阶段                                   |
| [风险与兼容性](./risks.md)                             | 技术风险、安全风险、向后兼容性                                 |

## 典型使用场景

```
Owner: 我们需要为项目添加 JWT 认证功能

Architect (内部 Agent): 我来设计方案：
  - 后端: Express + JWT + Prisma
  - 前端: React Login 页面
  @claude-code 请负责后端 API
  @opencode 请负责前端页面

Claude Code (Bridge): 收到，开始实现后端认证 API...
  [创建 src/auth/routes.ts ...]
  [创建 src/auth/middleware.ts ...]
  后端 API 已完成。@opencode 接口文档: POST /api/auth/login

OpenCode (Bridge): 好的，开始创建前端登录页面...
  [创建 src/pages/Login.tsx ...]
  前端已完成。@architect 请 review。
```

## 核心架构

### Agent 触发链路

```
group.send(message, mentions)
     │
     ▼
handleGroupSend()              ← src/gateway/server-methods/group.ts
     │
     ├─ appendGroupMessage()   ← 写入 transcript
     ├─ broadcastGroupMessage() ← WS 广播到 UI
     │
     ▼
resolveDispatchTargets()       ← src/group-chat/message-dispatch.ts
     │
     ▼
triggerAgentReasoning()        ← src/group-chat/agent-trigger.ts  ⬅ 关键决策点
     │
     ├─ member.bridge 存在? ───┬─ Yes → triggerBridgeAgent()
     │                        │
     │                        └─ No → 现有 LLM 推理逻辑
```

### TUI 方案架构

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   CLI 工具   │ ←→ │    PTY      │ ←→ │   后端      │
│ (TUI 输出)   │     │ (node-pty)  │     │ (WebSocket) │
└─────────────┘     └─────────────┘     └─────────────┘
                                               │
                           ┌───────────────────┴───────────────────┐
                           │                                       │
                           ▼                                       ▼
                    group.terminal                          group.stream
                   (Base64 ANSI)                         (纯文本消息)
                           │                                       │
                           ▼                                       ▼
                    ┌─────────────┐                         ┌─────────────┐
                    │  xterm.js   │                         │  消息气泡    │
                    │  终端组件    │                         │  (纯文本)    │
                    └─────────────┘                         └─────────────┘
```

## 核心优势

1. **最小侵入**：只在 `triggerAgentReasoning()` 加一个 if 判断，所有新逻辑都在独立文件中
2. **完全复用**：消息分发、transcript、广播、防循环、前端 @mention 转发、发起者汇总 — 全部零改动复用
3. **统一方案**：PTY 统一处理所有 CLI 工具，无需为每个 CLI 编写适配器
4. **成熟架构**：PTY → WebSocket → xterm.js 是经过 VS Code、Hyper、ttyd 等产品验证的架构
5. **双通道设计**：终端视图满足实时观察需求，纯文本消息满足群聊整洁需求

## 可行性结论

| 维度       | 评价       | 理由                                            |
| ---------- | ---------- | ----------------------------------------------- |
| 架构兼容性 | ⭐⭐⭐⭐⭐ | 现有架构的分层设计使得替换推理层极其简单        |
| 改动范围   | ⭐⭐⭐⭐⭐ | 核心改动仅 ~10 行分叉判断，新增 ~880 行独立模块 |
| 向后兼容   | ⭐⭐⭐⭐⭐ | 全部通过可选字段扩展，不影响现有功能            |
| 工程复杂度 | ⭐⭐⭐⭐   | PTY + xterm.js 是成熟架构，有大量参考实现       |
| 用户体验   | ⭐⭐⭐⭐   | TUI 实时可见比纯文本流式更直观                  |

## 最大挑战

**TUI 正确渲染**需要严格遵循五步保证（PTY → onData → Base64 → WebSocket → xterm.js），任何中间环节的文本处理都可能破坏 ANSI 控制序列。详见 [TUI 渲染流程](./tui-rendering.md)。

## 关联文档

- [后端设计](../group-chat-backend.md)
- [前端设计](../group-chat-frontend.md)
- [Skill 与上下文设计](../group-chat-skill-context.md)
- [发起者汇总机制](../group-chat-initiator-summary.md)
