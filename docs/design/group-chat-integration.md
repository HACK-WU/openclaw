# 多 Agent 群聊 — 集成与实施指南

> **关联文档**:
>
> - [需求文档](./multi-agent-group-chat.md)
> - [后端设计](./group-chat-backend.md)
> - [前端设计](./group-chat-frontend.md)
> - [Skill 与上下文设计](./group-chat-skill-context.md)
>   **版本**: v1.0 | **日期**: 2026-03-04

---

## 1. 集成点总览

群聊模块与现有系统的集成点控制在**最小范围**内：

| 集成点       | 现有文件                             | 改动方式           | 改动量 | 说明                    |
| ------------ | ------------------------------------ | ------------------ | ------ | ----------------------- |
| RPC 方法注册 | `src/gateway/server-methods.ts`      | 新增 import + 合并 | ~3 行  | 引入 `groupHandlers`    |
| RPC 方法列表 | `src/gateway/server-methods-list.ts` | 新增 14 个方法名   | ~14 行 | `BASE_METHODS` 数组     |
| WS 事件列表  | `src/gateway/server-methods-list.ts` | 新增 4 个事件名    | ~4 行  | `GATEWAY_EVENTS` 数组   |
| Skill 导出   | `src/agents/skills/workspace.ts`     | 导出函数           | ~2 行  | 导出 `loadSkillEntries` |
| UI 状态      | `ui/src/ui/app-view-state.ts`        | 新增字段           | ~15 行 | 群聊相关状态            |
| UI 渲染      | `ui/src/ui/app-render.ts`            | 新增条件分支       | ~10 行 | 群聊视图路由            |
| UI 导航      | `ui/src/ui/app-render.helpers.ts`    | 新增渲染函数调用   | ~5 行  | 插入群聊列表区块        |
| UI 事件      | `ui/src/ui/app-gateway.ts`           | 新增 switch case   | ~15 行 | group.\* 事件路由       |
| UI i18n      | `ui/src/ui/i18n/*.ts`                | 新增翻译 key       | ~40 行 | 群聊相关文案            |

**改动原则**：所有现有文件仅增加引入/条件判断，不修改已有逻辑分支。

---

## 2. 新增文件清单

### 2.1 后端

| 文件                                       | 行数估算  | 说明                   |
| ------------------------------------------ | --------- | ---------------------- |
| `src/group-chat/types.ts`                  | ~120      | 类型定义               |
| `src/group-chat/group-store.ts`            | ~250      | 群聊元数据 CRUD        |
| `src/group-chat/group-session-key.ts`      | ~30       | SessionKey 解析        |
| `src/group-chat/transcript.ts`             | ~180      | Transcript 读写 + 写锁 |
| `src/group-chat/message-dispatch.ts`       | ~100      | 消息分发引擎           |
| `src/group-chat/agent-trigger.ts`          | ~200      | Agent 推理触发         |
| `src/group-chat/parallel-stream.ts`        | ~150      | 并行流管理             |
| `src/group-chat/anti-loop.ts`              | ~80       | 防循环机制             |
| `src/group-chat/context-builder.ts`        | ~150      | 上下文构建             |
| `src/group-chat/compaction.ts`             | ~120      | 上下文压缩             |
| `src/group-chat/tool-policy.ts`            | ~40       | 只读工具策略           |
| `src/group-chat/role-prompt.ts`            | ~80       | 职责提示词             |
| `src/group-chat/announcement.ts`           | ~50       | 群公告管理             |
| `src/group-chat/group-skills.ts`           | ~60       | 群 Skill 管理          |
| `src/group-chat/tools/group-reply-tool.ts` | ~50       | group_reply 工具       |
| `src/group-chat/index.ts`                  | ~20       | 模块导出               |
| `src/gateway/server-methods/group.ts`      | ~400      | RPC handlers           |
| `src/gateway/protocol/schema/group.ts`     | ~100      | 参数 Schema            |
| `skills/group-chat-reply/SKILL.md`         | ~50       | Skill 定义             |
| **后端合计**                               | **~2230** |                        |

### 2.2 前端

| 文件                                         | 行数估算  | 说明           |
| -------------------------------------------- | --------- | -------------- |
| `ui/src/ui/views/group-chat.ts`              | ~200      | 群聊视图主入口 |
| `ui/src/ui/controllers/group-chat.ts`        | ~150      | RPC 调用封装   |
| `ui/src/ui/controllers/group-chat-state.ts`  | ~100      | 状态管理       |
| `ui/src/ui/chat/group-chat-render.ts`        | ~200      | 消息渲染       |
| `ui/src/ui/chat/group-chat-stream.ts`        | ~180      | 并行流渲染     |
| `ui/src/ui/chat/group-mention-input.ts`      | ~120      | @ 输入组件     |
| `ui/src/ui/components/group-create-modal.ts` | ~150      | 创建模态框     |
| `ui/src/ui/components/group-info-panel.ts`   | ~200      | 信息面板       |
| `ui/src/ui/components/group-member-list.ts`  | ~100      | 成员列表       |
| `ui/src/ui/components/role-prompt-editor.ts` | ~100      | 职责编辑器     |
| **前端合计**                                 | **~1500** |                |

### 总计：~3730 行新代码 + ~110 行微改

---

## 3. 存储方案

### 3.1 存储目录结构

```
~/.openclaw/
├── agents/                        ← 现有，不改
│   └── <agentId>/sessions/
└── group-chats/                   ← 新增
    ├── index.json                 ← 群聊索引
    └── <groupId>/
        ├── meta.json              ← 群聊元数据
        ├── transcript.jsonl       ← 消息记录
        └── compaction-summary.json ← 压缩摘要
```

### 3.2 数据文件格式

#### index.json

```json
[
  { "groupId": "550e8400-...", "groupName": "研发协作群", "updatedAt": 1709510400000 },
  { "groupId": "6ba7b810-...", "groupName": "运维值班群", "updatedAt": 1709510300000 }
]
```

#### meta.json

```json
{
  "groupId": "550e8400-...",
  "groupName": "研发协作群",
  "messageMode": "unicast",
  "members": [
    { "agentId": "main", "role": "assistant", "joinedAt": 1709510000000 },
    { "agentId": "code-reviewer", "role": "member", "joinedAt": 1709510000000 }
  ],
  "memberRolePrompts": [{ "agentId": "main", "rolePrompt": "", "updatedAt": 1709510000000 }],
  "announcement": "本群用于协调项目 X 开发",
  "groupSkills": ["weather"],
  "maxRounds": 10,
  "maxConsecutive": 3,
  "historyLimit": 50,
  "compaction": { "enabled": true, "maxHistoryShare": 0.5, "reserveTokensFloor": 20000 },
  "createdAt": 1709510000000,
  "updatedAt": 1709510400000
}
```

#### transcript.jsonl

```jsonl
{"type":"session","version":"1.0","id":"550e8400-...","sessionType":"group"}
{"id":"msg_1","groupId":"550e8400-...","role":"user","content":"帮我分析这个问题","sender":{"type":"owner"},"timestamp":1709510400000,"serverSeq":1}
{"id":"msg_2","groupId":"550e8400-...","role":"assistant","content":"分析如下...","sender":{"type":"agent","agentId":"main","agentName":"Main"},"timestamp":1709510401000,"serverSeq":2}
```

### 3.3 数据迁移

无需数据迁移。群聊是全新功能，独立存储目录，不依赖任何现有数据。

---

## 4. 实施阶段规划

### Phase 0: 基础设施（预计 2-3 天）

| 任务               | 文件                   | 依赖               |
| ------------------ | ---------------------- | ------------------ |
| 类型定义           | `types.ts`             | 无                 |
| SessionKey 解析    | `group-session-key.ts` | 无                 |
| 群聊存储 CRUD      | `group-store.ts`       | types              |
| Transcript 读写    | `transcript.ts`        | types, group-store |
| 职责提示词默认模板 | `role-prompt.ts`       | 无                 |
| 参数 Schema        | `schema/group.ts`      | 无                 |

### Phase 1: 核心链路（预计 3-4 天）

| 任务                   | 文件                                          | 依赖                                           |
| ---------------------- | --------------------------------------------- | ---------------------------------------------- |
| RPC CRUD handlers      | `group.ts` (create/list/info/delete)          | Phase 0                                        |
| 群聊上下文构建         | `context-builder.ts`                          | role-prompt, types                             |
| 只读工具策略           | `tool-policy.ts`                              | 无                                             |
| group-chat-reply Skill | `SKILL.md` + `group-reply-tool.ts`            | 无                                             |
| 消息分发引擎           | `message-dispatch.ts`                         | types                                          |
| 防循环机制             | `anti-loop.ts`                                | types                                          |
| Agent 推理触发         | `agent-trigger.ts`                            | context-builder, tool-policy, message-dispatch |
| group.send handler     | `group.ts` (send)                             | agent-trigger                                  |
| 并行流管理             | `parallel-stream.ts`                          | agent-trigger                                  |
| Gateway 注册           | `server-methods.ts`, `server-methods-list.ts` | group.ts                                       |

### Phase 2: 增强功能（预计 2 天）

| 任务          | 文件                               | 依赖    |
| ------------- | ---------------------------------- | ------- |
| 群公告 API    | `announcement.ts` + handler        | Phase 0 |
| 群 Skill 管理 | `group-skills.ts` + handler        | Phase 0 |
| 成员管理 API  | handlers (add/remove/setAssistant) | Phase 0 |
| 上下文压缩    | `compaction.ts`                    | Phase 1 |

### Phase 3: 前端 UI（预计 4-5 天）

| 任务                   | 文件                         | 依赖        |
| ---------------------- | ---------------------------- | ----------- |
| 群聊状态管理           | `group-chat-state.ts`        | Phase 1 API |
| RPC 调用封装           | `controllers/group-chat.ts`  | Phase 1 API |
| 群聊导航区块           | `app-render.helpers.ts` 修改 | 状态管理    |
| 创建群聊模态框         | `group-create-modal.ts`      | RPC 封装    |
| 群聊消息渲染           | `group-chat-render.ts`       | 状态管理    |
| **并行流渲染（重点）** | `group-chat-stream.ts`       | 状态管理    |
| @ 输入组件             | `group-mention-input.ts`     | 成员数据    |
| 群聊信息面板           | `group-info-panel.ts`        | RPC 封装    |
| 职责编辑器             | `role-prompt-editor.ts`      | RPC 封装    |
| WS 事件处理            | `app-gateway.ts` 修改        | 状态管理    |
| 视图路由               | `app-render.ts` 修改         | 群聊视图    |

### Phase 4: 打磨与测试（预计 2-3 天）

| 任务           | 说明                                     |
| -------------- | ---------------------------------------- |
| 单元测试       | 分发算法、防循环、SessionKey 等          |
| 集成测试       | group.send 端到端、并行推理              |
| 并行流 UI 测试 | 5 成员并行 stream 压力测试               |
| 边界测试       | 50 成员广播、超长消息、防循环极限        |
| 性能测试       | 并行流首 token 延迟、Transcript 写入吞吐 |

---

## 5. 测试策略

### 5.1 单元测试

| 模块                   | 测试文件                    | 关键场景                                            |
| ---------------------- | --------------------------- | --------------------------------------------------- |
| `message-dispatch.ts`  | `message-dispatch.test.ts`  | 单播/广播/mention 路由、sender 自己过滤、不存在的 @ |
| `anti-loop.ts`         | `anti-loop.test.ts`         | 轮次限制、连续触发限制、状态重置                    |
| `group-session-key.ts` | `group-session-key.test.ts` | 解析/构建/判断                                      |
| `role-prompt.ts`       | `role-prompt.test.ts`       | 默认模板、自定义优先、角色切换                      |
| `tool-policy.ts`       | `tool-policy.test.ts`       | deny 列表、group_reply 例外                         |
| `context-builder.ts`   | `context-builder.test.ts`   | 完整上下文内容、公告注入、成员列表                  |

### 5.2 集成测试

| 场景                          | 验证点                       |
| ----------------------------- | ---------------------------- |
| Owner 单播无 @                | 仅助手收到，其他成员不触发   |
| Owner @ 指定 Agent            | 仅被 @ 的 Agent 收到         |
| Owner 广播无 @                | 所有成员并行收到，独立 runId |
| Agent group_reply 带 mentions | 链式触发被 @ Agent           |
| Agent group_reply 无 mentions | 写入 transcript，不触发其他  |
| 防循环极限                    | 10 轮中止，系统消息通知      |
| 同一 Agent 连续 3 次          | 中止，系统消息通知           |
| Agent sender 伪造             | 外部调用被拒绝               |
| 并行写入 transcript           | serverSeq 严格递增           |
| 群聊已归档                    | 发送被拒绝                   |

### 5.3 前端测试

| 场景                      | 验证点                         |
| ------------------------- | ------------------------------ |
| 并行流渲染（广播 5 成员） | 5 个流独立渲染，无串流/覆盖    |
| 流中止/错误               | 错误流正确移除                 |
| @ 输入交互                | 下拉框显示、键盘导航、选择插入 |
| 消息排序                  | 基于 serverSeq 一致排序        |
| 视图切换                  | 群聊 ↔ 单聊切换状态正确清理    |

---

## 6. 风险与缓解

| 风险                       | 等级 | 缓解措施                                           |
| -------------------------- | ---- | -------------------------------------------------- |
| 并行流 UI 复杂度高         | 高   | Phase 3 重点测试；使用 Map 结构隔离各流            |
| Token 消耗 ×N（广播）      | 中   | UI 提示消耗量；支持限制广播成员数                  |
| Agent 推理超时（链式触发） | 中   | 每个 run 独立 AbortSignal；全局轮次限制            |
| Transcript 并发写入冲突    | 低   | withGroupLock 串行化写入                           |
| 群聊影响单聊稳定性         | 低   | 独立目录/存储/代码路径；微改现有文件仅增加条件分支 |

---

## 7. 验收标准

| 维度       | 指标                                                  |
| ---------- | ----------------------------------------------------- |
| 功能正确性 | 单播/广播/@ 路由命中率 100%；角色权限不越界           |
| 并行流体验 | 广播 5 成员并行时，各流独立渲染，无串流/覆盖          |
| 一致性     | 多端同群消息顺序一致（基于 `serverSeq`）              |
| 安全性     | 非内部路径无法伪造 `sender=agent`；只读策略拦截可审计 |
| 稳定性     | 并发写入无消息丢失；重试无重复（幂等键生效）          |
| 性能       | 广播模式首 token < 3s；单条消息写入 < 100ms           |
| 可运营     | Token 成本、触发次数、失败率有可观测指标              |
| 测试覆盖   | 新增代码覆盖率 ≥ 70%                                  |

---

## 8. 设计文档索引

| 文档           | 路径                                      | 内容                                                  |
| -------------- | ----------------------------------------- | ----------------------------------------------------- |
| 需求文档       | `docs/design/multi-agent-group-chat.md`   | 完整功能需求 v3.1                                     |
| 后端设计       | `docs/design/group-chat-backend.md`       | 数据模型、存储、RPC、分发引擎、Agent 触发             |
| 前端设计       | `docs/design/group-chat-frontend.md`      | 组件架构、状态管理、并行流渲染、WS 事件               |
| Skill 与上下文 | `docs/design/group-chat-skill-context.md` | Skill 体系、System Prompt、职责提示词、工具策略、压缩 |
| 集成与实施     | `docs/design/group-chat-integration.md`   | 集成点、文件清单、阶段规划、测试策略                  |
