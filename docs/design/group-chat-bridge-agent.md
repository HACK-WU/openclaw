# 群聊集成外部 CLI 编码工具 — Bridge Agent 方案

> **版本**: v2.0 | **日期**: 2026-03-10
>
> ⚠️ 本文档已拆分为多个文件，请访问 [group-chat-bridge 目录](./group-chat-bridge/) 查看完整内容。

## 文档索引

| 文档                                                       | 内容                                                |
| ---------------------------------------------------------- | --------------------------------------------------- |
| [概览](./group-chat-bridge/README.md)                      | 方案概览、典型场景、核心架构                        |
| [架构分析](./group-chat-bridge/architecture.md)            | 当前架构分析、可行性评估、Agent 类型扩展            |
| [TUI 渲染流程](./group-chat-bridge/tui-rendering.md)       | PTY → xterm.js 五步保证、失败根因分析、终端尺寸同步 |
| [前端组件设计](./group-chat-bridge/frontend-components.md) | 可折叠终端组件、双通道输出、完成检测策略            |
| [技术实现](./group-chat-bridge/implementation.md)          | 文件清单、模块设计、实施阶段                        |
| [风险与兼容性](./group-chat-bridge/risks.md)               | 技术风险、安全风险、向后兼容性                      |

## 关联文档

- [后端设计](./group-chat-backend.md)
- [前端设计](./group-chat-frontend.md)
- [Skill 与上下文设计](./group-chat-skill-context.md)
- [发起者汇总机制](./group-chat-initiator-summary.md)
