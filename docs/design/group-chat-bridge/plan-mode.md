# 群聊计划模式 (Plan Mode)

> **版本**: v1.1 | **日期**: 2026-04-05

计划模式为群聊引入 **Plan → Execute → Summarize** 的自动化协作循环。启用后，助手 Agent 自动承担**协调者/编排者**角色，通过四个持久化文件驱动多 Agent 协同完成复杂任务。

## 核心设计原则

1. **状态即文件**：不维护额外状态机，完全通过文件存在性和内容推断当前阶段
2. **上下文驱动**：Agent 行为由 system prompt 指导，无需新增触发逻辑
3. **复用现有机制**：消息分发、汇总触发、防循环全部复用现有实现

## 文档导航

| 文档                                       | 内容                                     |
| ------------------------------------------ | ---------------------------------------- |
| [架构分析](./architecture.md)              | 当前架构分析、Agent 类型扩展             |
| [CLI Agent 上下文](./cli-agent-context.md) | 上下文消息格式、截断策略、项目上下文注入 |
| [技术实现](./implementation.md)            | 文件清单、模块设计、实施阶段             |

---

## 1. 核心概念

### 1.1 什么是计划模式

计划模式是群聊的一个可选开关。启用后，助手 Agent（role = `"assistant"`）在收到用户任务消息时，不再直接回复，而是进入一个结构化的协作流程：

1. **澄清**（可选）— 助手 Agent 对不确定的细节向用户提问
2. **分工** — 分析任务，为每个 Agent 分配职责
3. **计划** — 拆解任务为有序步骤，明确执行顺序和依赖
4. **执行** — 按计划 @mention 相应 Agent，串行或并行推进
5. **总结** — 所有步骤完成后，汇总结果

### 1.2 四个协作文件

| 文件          | 英文标识 | 写入者       | 读取者      | 生命周期                   |
| ------------- | -------- | ------------ | ----------- | -------------------------- |
| `jobs.md`     | 分工     | 助手 Agent   | 所有 Agent  | 每次新任务时由助手清理重写 |
| `PLAN.md`     | 计划     | 助手 Agent   | 所有 Agent  | 每次新任务时由助手清理重写 |
| `PROGRESS.md` | 进度     | 执行者 Agent | 助手 Agent  | 各步骤完成时追加更新       |
| `RESULTS.md`  | 结果     | 助手 Agent   | 用户 / 所有 | 任务完成时由助手写入       |

**存储位置**：

```
<projectDir>/
├── .openclaw-group/
│   ├── jobs.md          # 分工
│   ├── PLAN.md          # 计划
│   ├── PROGRESS.md      # 进度
│   └── RESULTS.md       # 结果
└── ...                  # 项目源码
```

> 当群聊未配置 `project.directory` 时，回退到 `{stateDir}/groups/{groupId}/.openclaw-group/`。

### 1.3 与现有架构的关系

**核心设计原则：不需要新增任何触发代码。**

计划模式完全复用现有的消息分发和汇总（initiator summary）机制，仅在**上下文注入**层面做扩展：

- **助手 Agent 的 system prompt**：注入计划模式行为指令（这是最核心的实现）
- **执行者 Agent 的 system prompt**：注入执行者指令（提醒更新 PROGRESS.md）
- **GroupSessionEntry 类型**：新增 `planMode` 布尔值（群聊元数据的一个开关）

**为什么不需要额外触发代码？**

现有的**前端汇总机制**（`ui/src/ui/controllers/group-chat.ts`）已经实现了完整的执行循环：

```
助手 Agent 回复并 @mention 执行者
    ↓
执行者 Agent 被触发、回复
    ↓
前端检测到所有 pending agent 回复完毕
    ↓
前端自动以 skipTranscript 方式向 initiator（即助手 Agent）发送汇总消息
    ↓
服务端收到汇总消息 → resolveDispatchTargets → 触发助手 Agent
    ↓
助手 Agent 在 planMode 上下文的指导下检查 PROGRESS.md → 继续 @mention 或总结
```

所以计划模式的**完整实现就是上下文注入**——让助手 Agent 知道自己处于计划模式，然后按照 planMode 的 system prompt 行事即可。触发、分发、防循环、链状态管理全部复用现有逻辑。

---

## 2. 完整流程

### 2.1 流程总览

```
用户发送任务消息（如："为项目添加 JWT 认证功能"）
     │
     ▼
群聊检查 planMode 开关
     │
     ├─ planMode = false → 走现有逻辑（正常对话）
     │
     └─ planMode = true ↓
     ▼
┌─────────────────────────────────────────────────┐
│ Phase 0: 澄清（可选）                            │
│                                                  │
│ 助手 Agent 分析任务，如果存在不确定的细节：        │
│ → 直接向用户提问（不 @mention 其他 Agent）         │
│ → 等待用户回复后，再进入 Phase 1                   │
│                                                  │
│ 如果任务足够清晰：                                │
│ → 跳过此阶段，直接进入 Phase 1                    │
└──────────────────────┬──────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────┐
│ Phase 1: 分工 (jobs.md)                          │
│                                                  │
│ 助手 Agent 根据任务需求和各 Agent 的能力：        │
│ 1. 清空旧的 jobs.md / PLAN.md / PROGRESS.md      │
│ 2. 为每个参与的 Agent 分配明确职责                 │
│ 3. 写入 jobs.md                                  │
│ 4. 在群聊中发送分工摘要                           │
└──────────────────────┬──────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────┐
│ Phase 2: 计划 (PLAN.md)                          │
│                                                  │
│ 助手 Agent 将任务拆解为步骤：                      │
│ 1. 定义每个步骤的内容、负责 Agent、依赖关系        │
│ 2. 确定执行顺序（串行 / 并行 / 混合）             │
│ 3. 写入 PLAN.md                                  │
│ 4. 在群聊中发送计划摘要                           │
└──────────────────────┬──────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────┐
│ Phase 2.5: Owner 确认                            │
│                                                  │
│ UI 自动呈现分工(jobs.md)和计划(PLAN.md)内容：     │
│ → 状态栏显示"待确认"阶段                          │
│ → 弹出确认面板，展示分工和计划的完整内容           │
│ → 提供"同意执行"和"修改意见"两个按钮               │
│                                                  │
│ Owner 用户审核并决策：                            │
│ ├─ 点击"同意执行" → 进入 Phase 3 执行循环         │
│ │  （助手 Agent 收到确认消息后开始 @mention）      │
│ │                                                │
│ └─ 输入"修改意见" → 返回 Phase 1/2 调整           │
│    （助手 Agent 根据反馈重新分工或调整计划）        │
│                                                  │
│ 等待确认期间：                                    │
│ → phase = "pending_approval"                     │
│ → 助手 Agent 不主动触发任何执行                    │
│ → 其他 Agent 不参与（无 @mention）                 │
└──────────────────────┬──────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────┐
│ Phase 3: 执行循环                                 │
│                                                  │
│ 助手 Agent 按 PLAN.md 中的顺序触发执行：           │
│                                                  │
│ ┌─ 串行步骤：@mention 单个 Agent                  │
│ │  例：@backend 请实现 JWT 认证 API               │
│ │                                                │
│ └─ 并行步骤：同时 @mention 多个 Agent              │
│    例：@backend @frontend 请分别实现后端API和前端页面│
│                                                  │
│ 被@的 Agent 执行任务                               │
│     ↓                                            │
│ 执行完成 → Agent 更新 PROGRESS.md（自己负责的部分） │
│     ↓                                            │
│ 一轮所有被@的 Agent 回复完毕                        │
│     ↓                                            │
│ 助手 Agent 自动检查 PROGRESS.md：                  │
│   ├─ 还有未完成步骤 → @mention 下一批执行者        │
│   ├─ 发现问题需调整 → 更新 PLAN.md → 继续          │
│   └─ 全部完成 → 进入 Phase 4                      │
└──────────────────────┬──────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────┐
│ Phase 4: 总结 (RESULTS.md)                       │
│                                                  │
│ 助手 Agent 汇总所有完成情况：                      │
│ 1. 写入 RESULTS.md（最终产出、变更清单）           │
│ 2. 在群聊中发送总结报告                           │
│ 3. 通知用户任务已完成                              │
└─────────────────────────────────────────────────┘
```

### 2.2 助手 Agent 的决策能力

助手 Agent 在执行循环中拥有以下决策权：

| 决策点       | 说明                                                                                   |
| ------------ | -------------------------------------------------------------------------------------- |
| 是否需要澄清 | 如果任务描述含糊，助手可以先向用户提问                                                 |
| 串行还是并行 | 步骤之间有依赖 → 串行（一次 @mention 一个 Agent）；无依赖 → 并行（一次 @mention 多个） |
| 是否调整计划 | 某步骤失败或发现新需求时，助手可更新 PLAN.md 并继续                                    |
| 是否完成     | 助手根据 PROGRESS.md 判断所有步骤是否达标                                              |
| 是否需要回退 | 某步骤的输出不符合预期，助手可要求重做                                                 |

### 2.3 Owner 的决策权（Phase 2.5）

在分工和计划完成后，Owner（群聊创建者）拥有以下决策权：

| 决策点           | 说明                                                             |
| ---------------- | ---------------------------------------------------------------- |
| 是否同意执行     | Owner 审核 jobs.md 和 PLAN.md 后，点击"同意执行"按钮启动执行循环 |
| 是否提出修改意见 | Owner 可输入修改意见，助手 Agent 根据反馈重新分工或调整计划      |
| 是否取消任务     | Owner 可在确认阶段取消任务，清空所有文件并返回 idle 状态         |

**确认阶段的交互流程**：

```
PLAN.md 写入完成
     │
     ▼
UI 检测到 phase = "pending_approval"
     │
     ▼
弹出确认面板，展示：
  - jobs.md 内容（分工详情）
  - PLAN.md 内容（执行步骤）
  - 预计执行时间 / 参与 Agent
     │
     ├─ Owner 点击"同意执行"
     │     │
     │     ▼
     │  调用 group.approvePlan RPC
     │     │
     │     ▼
     │  meta.planApproved = true
     │     │
     │     ▼
     │  广播 plan_approved 事件
     │     │
     │     ▼
     │  phase → "planning"
     │     │
     │     ▼
     │  助手 Agent 收到确认消息 → 开始 @mention 执行者
     │
     └─ Owner 输入修改意见
           │
           ▼
        发送修改消息到群聊
           │
           ▼
        助手 Agent 根据反馈调整 jobs.md / PLAN.md
           │
           ▼
        phase 保持 "pending_approval"，等待再次确认
```

---

## 3. 文件内容格式与示例

### 3.1 jobs.md — 分工文件

**写入时机**：Phase 1 开始时，助手 Agent 清空并重写。

**格式规范**：

```markdown
# 分工

> 任务：为项目添加 JWT 认证功能
> 创建时间：2026-04-03 10:00
> 协调者：architect

## 参与成员

### architect（助手 / 协调者）

- **职责**：方案设计、任务编排、代码 Review、最终验收
- **关注点**：整体架构一致性、接口规范

### backend（Bridge Agent）

- **职责**：后端 API 开发
- **关注点**：Express 路由、JWT 签发/验证、Prisma 数据模型
- **工作目录**：`/project/src/server/`

### frontend（Bridge Agent）

- **职责**：前端页面开发
- **关注点**：React 登录页面、Token 存储、路由守卫
- **工作目录**：`/project/src/client/`

### tester（Member）

- **职责**：测试用例编写与执行
- **关注点**：API 接口测试、登录流程 E2E 测试

## 协作约定

- 后端完成 API 后需在 PROGRESS.md 中注明接口文档
- 前端根据后端提供的接口文档进行对接
- 所有代码变更需遵循项目 AGENTS.md 中的编码规范
```

### 3.2 PLAN.md — 计划文件

**写入时机**：Phase 2 开始时，助手 Agent 清空并重写。执行过程中如需调整，助手 Agent 可更新。

**格式规范**：

```markdown
# 执行计划

> 任务：为项目添加 JWT 认证功能
> 创建时间：2026-04-03 10:05
> 最后更新：2026-04-03 10:05

## 步骤总览

| #   | 步骤          | 负责人    | 依赖  | 执行方式   | 状态    |
| --- | ------------- | --------- | ----- | ---------- | ------- |
| 1   | 数据模型设计  | backend   | 无    | 串行       | pending |
| 2   | 认证 API 开发 | backend   | #1    | 串行       | pending |
| 3   | 登录页面开发  | frontend  | #2    | 串行       | pending |
| 4   | API 测试      | tester    | #2    | 并行(与#3) | pending |
| 5   | E2E 测试      | tester    | #3,#4 | 串行       | pending |
| 6   | 代码 Review   | architect | #5    | 串行       | pending |

## 步骤详情

### Step 1: 数据模型设计

- **负责人**：@backend
- **描述**：创建 User 模型（Prisma），包含 id、email、passwordHash、createdAt
- **产出**：`prisma/schema.prisma` 更新 + migration
- **完成标准**：migration 成功执行，User 表已创建

### Step 2: 认证 API 开发

- **负责人**：@backend
- **依赖**：Step 1 完成
- **描述**：
  - POST `/api/auth/register` — 用户注册
  - POST `/api/auth/login` — 用户登录，返回 JWT
  - GET `/api/auth/me` — 获取当前用户信息（需 Bearer Token）
  - 中间件 `authMiddleware` — 验证 JWT
- **产出**：`src/server/auth/` 目录下的路由和中间件
- **完成标准**：三个端点可用 curl 测试通过

### Step 3: 登录页面开发

- **负责人**：@frontend
- **依赖**：Step 2 完成（需要 API 接口文档）
- **描述**：
  - 创建 `/login` 路由和 `LoginPage` 组件
  - 表单：email + password
  - 登录成功后存储 JWT 到 localStorage 并跳转首页
  - 添加 `AuthGuard` 路由守卫
- **产出**：`src/client/pages/Login.tsx`、`src/client/guards/AuthGuard.tsx`
- **完成标准**：登录/跳转流程在浏览器中可正常工作

### Step 4: API 测试

- **负责人**：@tester
- **依赖**：Step 2 完成
- **执行方式**：与 Step 3 并行
- **描述**：为三个认证端点编写 Vitest 测试用例
- **产出**：`src/server/auth/__tests__/auth.test.ts`
- **完成标准**：所有测试用例通过

### Step 5: E2E 测试

- **负责人**：@tester
- **依赖**：Step 3 + Step 4 完成
- **描述**：Playwright E2E 测试，覆盖注册→登录→访问受保护页面的完整流程
- **产出**：`e2e/auth.spec.ts`
- **完成标准**：E2E 测试通过

### Step 6: 代码 Review

- **负责人**：@architect
- **依赖**：Step 5 完成
- **描述**：审查所有新增代码，检查安全性、一致性和规范性
- **产出**：Review 意见（如有修改建议，触发额外修改步骤）
- **完成标准**：所有代码符合项目规范
```

### 3.3 PROGRESS.md — 进度文件

**写入时机**：每个 Agent 完成自己负责的步骤后，追加更新自己的部分。助手 Agent 在新任务开始时清空。

**格式规范**：

```markdown
# 执行进度

> 任务：为项目添加 JWT 认证功能
> 最后更新：2026-04-03 11:30

## Step 1: 数据模型设计 ✅

- **负责人**：backend
- **完成时间**：2026-04-03 10:20
- **产出**：
  - 更新 `prisma/schema.prisma`，新增 User 模型
  - 执行 `npx prisma migrate dev --name add-user-model`
  - Migration 成功，User 表已创建
- **备注**：新增字段 `role` (enum: USER/ADMIN)，供后续权限控制使用

## Step 2: 认证 API 开发 ✅

- **负责人**：backend
- **完成时间**：2026-04-03 10:45
- **产出**：
  - `src/server/auth/routes.ts` — 注册、登录、获取用户信息三个端点
  - `src/server/auth/middleware.ts` — JWT 验证中间件
  - `src/server/auth/utils.ts` — 密码哈希、Token 生成工具函数
- **接口文档**：
  - `POST /api/auth/register` — body: `{ email, password }` → `{ user, token }`
  - `POST /api/auth/login` — body: `{ email, password }` → `{ user, token }`
  - `GET /api/auth/me` — header: `Authorization: Bearer <token>` → `{ user }`
- **备注**：JWT 有效期设为 7 天，secret 从环境变量 `JWT_SECRET` 读取

## Step 3: 登录页面开发 🔄 进行中

- **负责人**：frontend
- **开始时间**：2026-04-03 10:50
- **当前状态**：LoginPage 组件已完成，正在实现 AuthGuard

## Step 4: API 测试 ✅

- **负责人**：tester
- **完成时间**：2026-04-03 11:15
- **产出**：
  - `src/server/auth/__tests__/auth.test.ts` — 12 个测试用例，全部通过
- **覆盖范围**：注册（成功/重复邮箱/无效输入）、登录（成功/错误密码/不存在用户）、me 端点（有效Token/无Token/过期Token）

## Step 5: E2E 测试 ⏳ 等待中

- **依赖**：等待 Step 3 + Step 4

## Step 6: 代码 Review ⏳ 等待中

- **依赖**：等待 Step 5
```

**状态标记约定**：

| 标记 | 含义                   |
| ---- | ---------------------- |
| ⏳   | 等待中（依赖未满足）   |
| 🔄   | 进行中                 |
| ✅   | 已完成                 |
| ❌   | 失败（需助手决策）     |
| 🔁   | 需重做（助手要求修改） |

### 3.4 RESULTS.md — 结果文件

**写入时机**：Phase 4，所有步骤完成后由助手 Agent 写入。

**格式规范**：

```markdown
# 任务结果

> 任务：为项目添加 JWT 认证功能
> 完成时间：2026-04-03 12:00
> 执行轮次：8 轮
> 总耗时：约 2 小时

## 概要

成功为项目添加了完整的 JWT 认证功能，包括后端 API、前端登录页面和测试覆盖。

## 变更清单

### 新增文件

- `prisma/migrations/20260403_add_user_model/` — User 数据模型 migration
- `src/server/auth/routes.ts` — 认证 API 路由（注册/登录/me）
- `src/server/auth/middleware.ts` — JWT 验证中间件
- `src/server/auth/utils.ts` — 密码哈希和 Token 工具
- `src/client/pages/Login.tsx` — 登录页面组件
- `src/client/guards/AuthGuard.tsx` — 路由守卫
- `src/server/auth/__tests__/auth.test.ts` — API 测试（12 用例）
- `e2e/auth.spec.ts` — E2E 测试（3 场景）

### 修改文件

- `prisma/schema.prisma` — 新增 User 模型
- `src/server/index.ts` — 注册 auth 路由
- `src/client/App.tsx` — 添加 /login 路由和 AuthGuard

## API 接口

| 方法 | 路径                 | 说明         | 认证         |
| ---- | -------------------- | ------------ | ------------ |
| POST | `/api/auth/register` | 用户注册     | 无           |
| POST | `/api/auth/login`    | 用户登录     | 无           |
| GET  | `/api/auth/me`       | 获取当前用户 | Bearer Token |

## 测试结果

- **API 测试**：12/12 通过
- **E2E 测试**：3/3 通过
- **覆盖率**：auth 模块 95%+

## 注意事项

- JWT secret 需通过环境变量 `JWT_SECRET` 配置（生产环境务必设置强密钥）
- 当前 Token 有效期为 7 天，可在 `src/server/auth/utils.ts` 中调整
- User 模型新增了 `role` 字段（默认 USER），为后续权限控制预留
```

---

## 4. 类型定义扩展

> 计划模式只需扩展 `GroupSessionEntry`，**不需要新增服务端状态追踪类型**。
> 计划的当前阶段（Phase）完全由 Agent 通过四个文件的内容推断，不需要后端维护。

### 4.1 GroupSessionEntry 扩展

```typescript
// src/group-chat/types.ts

export type GroupSessionEntry = {
  // ... 现有字段 ...

  // ─── Plan Mode ───
  /** Whether plan mode is enabled for this group. Default: false. */
  planMode?: boolean;
  /** Plan mode configuration. */
  planConfig?: PlanModeConfig;
};

export type PlanModeConfig = {
  /** Whether assistant can skip clarification phase. Default: true. */
  allowSkipClarification?: boolean;
  /** Whether owner has approved the plan. Set to true after Phase 2.5 confirmation. */
  planApproved?: boolean;
};
```

> 注意：移除了 `maxPlanRounds` 和 `maxPlanDuration` — 直接复用现有的 `maxRounds` 和 `chainTimeout`。

---

## 5. System Prompt 上下文注入（核心实现）

> **这是计划模式唯一的、最重要的实现工作。**
>
> 不需要新增触发逻辑、不需要修改消息分发、不需要新增回调。
> 只需要在 `context-builder.ts` 中根据 `planMode` 标志，在助手 Agent 和执行者 Agent 的 system prompt 中注入不同的指令。
> Agent 读取到这些指令后，会自主按照计划模式的要求行事。

### 5.1 注入位置

现有的 `buildGroupChatContext()` 函数（`src/group-chat/context-builder.ts`）负责构建 Agent 的 system prompt。计划模式的扩展点在这里：

```typescript
// src/group-chat/context-builder.ts

export function buildGroupChatContext(params: {
  meta: GroupSessionEntry;
  agentId: string;
}): string {
  const { meta, agentId } = params;
  const parts: string[] = [];

  // ... 现有逻辑 ...

  // ─── Plan Mode 注入（新增） ───
  if (meta.planMode) {
    const member = meta.members.find((m) => m.agentId === agentId);
    if (member?.role === "assistant") {
      parts.push(buildPlanModeAssistantPrompt(meta));
    } else {
      parts.push(buildPlanModeExecutorPrompt(meta));
    }
  }

  return parts.join("\n\n");
}
```

### 5.2 计划模式助手 System Prompt

```markdown
### Plan Mode — 你是协调者

你当前处于**计划模式**。你的职责是协调群内 Agent 协作完成用户的任务。

#### 工作流程

1. **澄清（可选）**：如果用户任务描述不清晰，你可以直接向用户提问以澄清细节。如果任务足够明确，跳过此步骤。

2. **分工**：分析任务和群内各 Agent 的能力，为每个 Agent 分配职责。写入 `.openclaw-group/jobs.md`。

3. **计划**：将任务拆解为具体步骤，明确每步的负责人、依赖关系和执行顺序。写入 `.openclaw-group/PLAN.md`。

4. **等待 Owner 确认**：完成分工和计划后，**停止并等待群 Owner 确认**。
   - 不要 @mention 任何执行者 Agent
   - 在群聊中发送简短提示："分工和计划已完成，请 Owner 确认后开始执行"
   - 等待 Owner 点击"同意执行"或提供修改意见
   - 如果 Owner 提出修改意见，根据反馈调整 jobs.md 或 PLAN.md，然后再次等待确认

5. **执行**：收到 Owner 确认后，按计划触发 Agent 执行：
   - 步骤之间有依赖 → **一次 @mention 一个 Agent**（串行）
   - 步骤之间无依赖 → **一次 @mention 多个 Agent**（并行）
   - 每轮执行结束后，检查 `.openclaw-group/PROGRESS.md`，决定下一步

6. **总结**：所有步骤完成后，汇总结果写入 `.openclaw-group/RESULTS.md`，通知用户。

#### 文件规则

- **你（助手）**可以写入：jobs.md、PLAN.md、RESULTS.md
- **你（助手）**在新任务开始时必须清空 jobs.md、PLAN.md、PROGRESS.md
- **执行者 Agent** 完成步骤后应更新 PROGRESS.md（仅自己负责的部分）
- 每次触发执行者时，提醒他们完成后更新 PROGRESS.md

#### 决策准则

- **等待确认阶段**：完成 PLAN.md 后，检查 `meta.planApproved`：
  - `planApproved === false` → 发送确认提示，等待 Owner 操作
  - `planApproved === true` → 开始执行，@mention 第一批执行者
- **执行阶段**：每轮结束后读取 PROGRESS.md，判断：
  - 所有步骤 ✅ → 写入 RESULTS.md，任务完成
  - 仍有 ⏳/🔄 步骤 → 继续触发下一批
  - 有 ❌ 步骤 → 分析原因，决定重试或调整计划
- 最多执行约 {maxRounds/2} 轮计划循环，超出后直接写入 RESULTS.md 并总结当前状态（maxRounds 包含汇总触发，每次循环消耗约 2 个 roundCount）
```

### 5.2 执行者 Agent 的 System Prompt 注入

当群聊处于计划模式执行阶段时，为被触发的执行者 Agent 额外注入：

```markdown
### Plan Mode — 你是执行者

当前群聊处于**计划模式**。你有具体的执行任务。

#### 你的工作流程

1. 阅读 `.openclaw-group/PLAN.md` 了解当前计划和你负责的步骤
2. 阅读 `.openclaw-group/jobs.md` 了解你的职责范围
3. 执行分配给你的步骤
4. 完成后更新 `.openclaw-group/PROGRESS.md`，在你负责的步骤下记录：
   - 完成时间
   - 产出文件列表
   - 关键备注信息
   - 状态标记（✅ 完成 / ❌ 失败 + 原因）

#### 注意

- 只更新 PROGRESS.md 中**你自己负责的步骤**
- 如果遇到阻塞问题，在 PROGRESS.md 中标记 ❌ 并说明原因
- 完成后回复助手 Agent，简要说明完成情况
```

---

## 6. 为什么不需要额外触发代码

### 6.1 现有汇总机制已完全覆盖

计划模式的核心洞察是：**助手 Agent 就是 initiator（发起者），而现有汇总机制会在每轮对话结束后自动触发 initiator。**

前端的 initiator summary 机制（`ui/src/ui/controllers/group-chat.ts`）工作流程：

```
1. 助手 Agent 回复并 @mention 执行者
   → 前端记录：助手是 initiator，执行者是 pending agent

2. 执行者 Agent 被触发、执行、回复完毕
   → 前端检测：所有 pending agents 已回复（pendingAgents.size === 0）

3. 等待 SUMMARY_DELAY_MS 后进入 executeSummaryFlow()
   → 首先检查是否有待投递的 pending mentions（Phase 1）
   → 没有待投递消息后，进入 sendSummaryMessage()（Phase 2）

4. sendSummaryMessage() 以 skipTranscript 方式发送：
   group.send({
     groupId,
     message: "请确认是否有新的想法或补充...",
     mentions: [助手AgentId],
     sender: { type: "owner" },
     skipTranscript: true,    ← 关键：不重置链状态
   })

5. 服务端收到此消息 → resolveDispatchTargets → 触发助手 Agent
   → 助手 Agent 再次被触发，看到执行者的回复 + planMode 上下文
   → 按计划模式指令：检查 PROGRESS.md → 继续 @mention 或写 RESULTS.md
```

### 6.2 服务端对 skipTranscript 消息的处理

服务端（`src/gateway/server-methods/group.ts`）对 `skipTranscript: true` 的 Owner 消息有特殊处理：

```typescript
// 1. 不重置链状态（关键！）
if (resolvedSender.type === "owner" && !skipTranscript) {
  initChainState(groupId, savedMsg.id); // ← 正常 Owner 消息才重置
} else if (resolvedSender.type === "owner" && skipTranscript) {
  // skipTranscript → 只做 atomicAgentForwardCheck，不重置
}

// 2. 跳过去重检查
const bypassAtomicCheck = skipTranscript && resolvedSender.type === "owner";
// → 允许助手 Agent 被重复触发（每轮汇总都触发一次）
```

这意味着：

- 汇总消息不会重置链的 `startedAt`（超时计算从用户原始消息开始）
- 汇总消息不会触发去重拦截（助手 Agent 可以被多次触发）
- 链的 `maxRounds` / `chainTimeout` 限制仍然生效（安全兜底）

### 6.3 执行循环的完整数据流

```
用户: "为项目添加 JWT 认证"
  │
  ▼
[initChainState] ← Owner 真实消息，重置链
  │
  ▼
[resolveDispatchTargets] → unicast → 触发助手 Agent（roundCount=1）
  │
  ▼
助手 Agent（planMode 上下文）:
  → 写入 jobs.md + PLAN.md
  → 回复 "@backend 请实现认证 API"（@mention）
  │
  ▼
前端: 检测到 @mention → 记录 backend 为 mentionedAgent
       → deliverPendingMentions → 触发 backend
  │
  ▼
[resolveDispatchTargets] → mention → 触发 backend（roundCount=2）
  │
  ▼
Backend Agent:
  → 执行任务 → 更新 PROGRESS.md → 回复完成
  │
  ▼
前端: pendingAgents 清空 → scheduleSummaryCheck → 等待静默
  │
  ▼
前端: executeSummaryFlow → sendSummaryMessage
  → group.send({ skipTranscript: true, mentions: [助手AgentId] })
  │
  ▼
[resolveDispatchTargets] → mention → 触发助手 Agent（roundCount=3, bypassAtomicCheck）
  │
  ▼
助手 Agent（planMode 上下文）:
  → 读取 PROGRESS.md → 判断未完成步骤 → 回复 "@frontend 请实现登录页面"
  │
  ▼
  ... 循环继续直到所有步骤完成 ...
  │
  ▼
助手 Agent:
  → 读取 PROGRESS.md → 全部 ✅ → 写入 RESULTS.md
  → 回复 "✅ 任务完成！"
  │
  ▼
前端: 汇总 → 触发助手 → 助手无新 @mention → 链自然结束
```

### 6.4 防循环与安全限制

现有的安全机制无需修改即可覆盖计划模式：

| 限制项                  | 默认值  | 说明                                        |
| ----------------------- | ------- | ------------------------------------------- |
| `maxRounds`             | 20      | 群聊配置的最大 Agent 触发次数（含汇总触发） |
| `chainTimeout`          | 15 分钟 | 链超时（从 Owner 真实消息开始计算）         |
| `CHAIN_MAX_COUNT`       | 100     | 后端硬限制                                  |
| `CHAIN_MAX_DURATION_MS` | 30 分钟 | 后端硬限制                                  |
| `MAX_SUMMARY_ROUNDS`    | 3       | 前端最大汇总轮次                            |

当 `maxRounds` 或 `chainTimeout` 触发时，链自动终止。助手 Agent 的 planMode 上下文中也包含 `maxPlanRounds` 提示，让 LLM 自觉控制循环次数。

---

## 7. 典型场景示例

### 7.1 场景：简单的串行任务

```
Owner: 为项目添加一个 /health 健康检查端点

Architect (助手):
  任务很清晰，开始分配。

  [写入 jobs.md]
  [写入 PLAN.md — 2 步：① backend 实现端点 ② tester 写测试]

  计划已制定，共 2 个步骤。
  @backend 请实现 GET /health 端点，返回 { status: "ok", uptime: ... }

Backend (Bridge):
  收到。
  [创建 src/server/health.ts]
  [注册路由到 src/server/index.ts]
  [更新 PROGRESS.md — Step 1 ✅]
  健康检查端点已完成。

Architect (助手):  ← 系统自动触发进度检查
  [读取 PROGRESS.md — Step 1 ✅, Step 2 ⏳]
  Step 1 已完成。继续 Step 2。
  @tester 请为 GET /health 端点编写测试用例。

Tester:
  [创建测试文件]
  [更新 PROGRESS.md — Step 2 ✅]
  测试完成，2 个用例全部通过。

Architect (助手):  ← 系统自动触发进度检查
  [读取 PROGRESS.md — 全部 ✅]
  [写入 RESULTS.md]
  ✅ 任务完成！健康检查端点 GET /health 已实现并通过测试。
```

### 7.2 场景：包含澄清和并行的复杂任务

```
Owner: 加个用户系统

Architect (助手):
  关于用户系统，有几个细节需要确认：
  1. 需要支持哪些注册方式？（邮箱/手机号/第三方登录）
  2. 是否需要角色权限管理？（如管理员/普通用户）
  3. 是否需要邮箱验证流程？

Owner: 邮箱注册就行，需要管理员和普通用户两个角色，不需要邮箱验证

Architect (助手):
  明白了。

  [写入 jobs.md — backend: API 开发, frontend: 页面开发, tester: 测试]
  [写入 PLAN.md — 6 步计划]

  计划已制定。Step 1（数据模型）先行，然后 Step 2（API）和 Step 3（页面）可并行。

  @backend 请先完成 Step 1：创建 User 模型...

Backend (Bridge):
  [完成数据模型]
  [更新 PROGRESS.md — Step 1 ✅]
  User 模型已完成。

Architect (助手):  ← 自动触发
  [读取 PROGRESS.md — Step 1 ✅]
  Step 1 完成。Step 2 和 Step 3 无依赖冲突，同时开始。
  @backend 请实现认证 API（Step 2）
  @frontend 请实现登录注册页面（Step 3）

Backend (Bridge):                       Frontend (Bridge):
  [实现 API]                               [实现页面]
  [更新 PROGRESS.md — Step 2 ✅]           [更新 PROGRESS.md — Step 3 ✅]
  API 完成。                               页面完成。

Architect (助手):  ← 自动触发
  [读取 PROGRESS.md — Step 2 ✅, Step 3 ✅]
  ...继续后续步骤...
```

### 7.3 场景：执行失败与计划调整

```
Architect (助手):
  @tester 请执行 E2E 测试（Step 5）

Tester:
  E2E 测试执行失败。
  [更新 PROGRESS.md — Step 5 ❌ 原因：登录后跳转未生效，AuthGuard 组件未正确读取 Token]

Architect (助手):  ← 自动触发
  [读取 PROGRESS.md — Step 5 ❌]
  Step 5 失败，原因是 AuthGuard Token 读取问题。需要 frontend 修复。
  [更新 PLAN.md — 插入 Step 5a: frontend 修复 AuthGuard]

  @frontend 请修复 AuthGuard 组件的 Token 读取逻辑，
  当前问题：登录后 localStorage 中有 Token 但 AuthGuard 未正确读取。

Frontend (Bridge):
  [修复 AuthGuard]
  [更新 PROGRESS.md — Step 5a ✅]
  已修复，Token 读取逻辑改为 useEffect 初始化时读取。

Architect (助手):  ← 自动触发
  [读取 PROGRESS.md — Step 5a ✅, Step 5 ❌]
  修复完成，重新执行 E2E 测试。
  @tester 请重新执行 Step 5 的 E2E 测试。

Tester:
  [重新执行测试]
  [更新 PROGRESS.md — Step 5 ✅ (覆盖之前的 ❌)]
  E2E 测试全部通过！
```

---

## 8. 用户中途介入

用户在计划执行过程中可以随时发送消息：

| 用户行为            | 系统处理                                               |
| ------------------- | ------------------------------------------------------ |
| 发送新消息（无@）   | 助手 Agent 接收并响应（可能暂停当前计划）              |
| 修改需求            | 助手 Agent 更新 jobs.md / PLAN.md，从当前进度继续      |
| 要求停止            | 助手 Agent 写入 RESULTS.md（记录已完成部分），结束计划 |
| 发送新任务          | 助手 Agent 清理旧文件，开启新的计划流程                |
| @mention 特定 Agent | 现有 @mention 逻辑正常执行，不受计划模式影响           |

---

## 9. RPC 接口扩展

### 9.1 设置计划模式

```typescript
// group.setPlanMode
{
  method: "group.setPlanMode",
  params: {
    groupId: string;
    enabled: boolean;
    config?: PlanModeConfig;
  }
}
```

### 9.2 获取计划状态

> 计划状态通过读取四个协作文件来判断，不需要服务端维护额外的 PlanState。

```typescript
// group.getPlanState
{
  method: "group.getPlanState",
  params: {
    groupId: string;
  }
}
// Response:
{
  planMode: boolean;
  files: {
    jobs: boolean;         // jobs.md 是否存在
    plan: boolean;         // PLAN.md 是否存在
    progress: boolean;     // PROGRESS.md 是否存在
    results: boolean;      // RESULTS.md 是否存在
  }
  // UI 可以根据文件存在情况推断当前阶段：
  // 无文件 → idle
  // 有 jobs.md 但无 PLAN.md → clarifying/assigning
  // 有 PLAN.md 但无 PROGRESS.md 且无 owner 确认 → pending_approval
  // 有 PLAN.md 且 owner 已确认但无 PROGRESS.md → planning
  // 有 PROGRESS.md 但无 RESULTS.md → executing
  // 有 RESULTS.md → completed
}
```

### 9.3 Owner 确认计划

> Phase 2.5 的核心 RPC，用于 Owner 同意执行计划。

```typescript
// group.approvePlan
{
  method: "group.approvePlan",
  params: {
    groupId: string;
  }
}
// Response:
{
  success: boolean;
  phase: "planning";  // 确认后进入 planning 阶段
}

// Backend logic:
async function handleGroupApprovePlan(params: { groupId: string }) {
  const group = await getGroup(params.groupId);

  // 验证调用者是 Owner
  if (group.ownerId !== getCurrentUserId()) {
    throw new Error("Only group owner can approve the plan");
  }

  // 验证 PLAN.md 存在（已完成 Phase 2）
  const planFile = await readPlanFile(params.groupId, "PLAN.md");
  if (!planFile) {
    throw new Error("Plan file not found. Please wait for assistant to complete planning.");
  }

  // 更新 meta.planApproved = true
  group.meta.planConfig = {
    ...group.meta.planConfig,
    planApproved: true,
  };
  await saveGroup(group);

  // 广播 plan_approved 事件
  await broadcastGroupSystem(params.groupId, "plan_approved", {
    approvedBy: getCurrentUserId(),
  });

  return { success: true, phase: "planning" };
}
```

---

## 10. UI 扩展

### 10.1 群聊设置

```
┌──────────────────────────────────────┐
│ 群聊设置                              │
│                                      │
│ ─── 计划模式 ───                      │
│                                      │
│ 启用计划模式：  [✓]                  │
│                                      │
│ 助手 Agent 将自动协调成员             │
│ 完成用户任务（分工→计划→执行→总结）   │
│                                      │
│ 最大执行轮次：  [20   ]              │
│ 最大执行时长：  [60   ] 分钟         │
│                                      │
│ [保存修改]                           │
└──────────────────────────────────────┘
```

### 10.2 群聊界面状态指示

启用计划模式后，群聊界面顶部显示当前阶段：

```
┌──────────────────────────────────────┐
│ 📋 计划模式 — 执行中 (3/6 步骤完成)   │
│ [查看分工] [查看计划] [查看进度]      │
└──────────────────────────────────────┘
```

点击可展开侧边栏查看对应文件内容。

---

## 11. 实施阶段

> 因为计划模式复用现有汇总机制，**不需要新增触发代码**，实际工作量比初看要小得多。

### Phase 1: 核心类型与开关 (0.5 天)

| 任务                         | 文件       | 工作量 |
| ---------------------------- | ---------- | ------ |
| `PlanModeConfig` 类型定义    | `types.ts` | 0.5h   |
| `GroupSessionEntry.planMode` | `types.ts` | 0.5h   |
| `group.setPlanMode` RPC      | `group.ts` | 1h     |
| `group.getPlanState` RPC     | `group.ts` | 1h     |

### Phase 2: System Prompt 上下文注入（核心，1-2 天）

| 任务                            | 文件                           | 工作量 |
| ------------------------------- | ------------------------------ | ------ |
| 计划模式助手 prompt 构建        | `plan-mode-context.ts`（新增） | 2h     |
| 计划模式执行者 prompt 构建      | `plan-mode-context.ts`         | 1h     |
| 与 `context-builder.ts` 集成    | `context-builder.ts`           | 1h     |
| Bridge Agent 的 planMode 上下文 | `bridge-context.ts`            | 1h     |

> 这一步是计划模式的**全部后端核心实现**。
> 不需要新建 `plan-mode-trigger.ts`，不需要修改 `chain-state-store.ts`，不需要修改 `message-dispatch.ts`。

### Phase 2.5: Owner 确认机制 (0.5 天)

| 任务                          | 文件                   | 工作量 |
| ----------------------------- | ---------------------- | ------ |
| `PlanModeConfig.planApproved` | `types.ts`             | 0.5h   |
| `group.approvePlan` RPC       | `group.ts`             | 1h     |
| 确认面板 UI 组件              | `group-chat.ts`        | 2h     |
| pending_approval 阶段处理     | `plan-mode-context.ts` | 1h     |

> Owner 确认机制确保用户对分工和计划有最终控制权，防止助手 Agent 自动进入执行阶段。

### Phase 3: UI 扩展 (1-2 天)

| 任务                        | 说明                            | 工作量 |
| --------------------------- | ------------------------------- | ------ |
| 群聊设置添加 Plan Mode 开关 | 复选框 + 配置项                 | 2h     |
| 群聊界面状态指示栏          | 阶段显示 + 文件查看链接         | 2h     |
| 协作文件侧边栏查看器        | 渲染 jobs/PLAN/PROGRESS/RESULTS | 3h     |

### Phase 4: 测试 (0.5 天)

| 任务                        | 说明                                     |
| --------------------------- | ---------------------------------------- |
| Plan Mode 开关/配置单元测试 | 类型验证、RPC 测试                       |
| System Prompt 注入测试      | 验证 planMode=true 时上下文正确注入      |
| 集成测试                    | 端到端验证执行循环（可借助现有测试框架） |

---

## 12. 风险与缓解

| 风险                | 影响 | 缓解措施                                                  |
| ------------------- | ---- | --------------------------------------------------------- |
| 助手 Agent 陷入循环 | 高   | 现有 `maxRounds`（20）+ `chainTimeout`（15 分钟）自动兜底 |
| 文件写入冲突        | 中   | 约定：助手写 jobs/PLAN/RESULTS，执行者只写 PROGRESS       |
| Agent 不更新进度    | 中   | 助手在 system prompt 中强调；超时后助手主动询问           |
| 用户中途改需求      | 低   | 助手能理解新消息并调整计划                                |
| LLM 不遵循格式      | 中   | system prompt 中给出明确的格式示例和约束                  |

---

## 13. 关联文档

- [架构分析](./architecture.md) — 现有架构与 Bridge Agent 兼容性
- [CLI Agent 上下文](./cli-agent-context.md) — 上下文注入机制
- [技术实现](./implementation.md) — Bridge Agent 实施阶段
- [风险与兼容性](./risks.md) — 技术风险评估

---

## 14. 状态推断机制

> **核心原则**：后端不维护 PlanState，前端通过读取四个文件判断当前阶段。

### 14.1 阶段推断逻辑

```typescript
function inferPlanPhase(files: {
  jobs: boolean;
  plan: boolean;
  progress: boolean;
  results: boolean;
}): PlanPhase {
  // 无任何文件 → 空闲状态
  if (!files.jobs && !files.plan && !files.progress && !files.results) {
    return "idle";
  }

  // 有分工但无计划 → 澄清/分配中
  if (files.jobs && !files.plan) {
    return "assigning";
  }

  // 有计划但无进度 → 待 owner 确认
  // 需要结合 meta.planApproved 字段判断
  if (files.plan && !files.progress) {
    // 如果 owner 已确认，返回 "planning"（准备进入执行）
    // 否则返回 "pending_approval"（等待确认）
    return meta.planApproved ? "planning" : "pending_approval";
  }

  // 有进度但无结果 → 执行中
  if (files.progress && !files.results) {
    return "executing";
  }

  // 有结果 → 已完成
  if (files.results) {
    return "completed";
  }

  return "idle";
}
```

### 14.2 进度计算逻辑

执行阶段的进度（如 "3/6 步骤完成"）来自解析 `PROGRESS.md`：

```typescript
function calculateProgress(
  progressContent: string,
  planContent: string,
): {
  completed: number;
  total: number;
} {
  // 从 PLAN.md 统计总步骤数
  const totalSteps = (planContent.match(/^## Step \d+:/gm) || []).length;

  // 从 PROGRESS.md 统计已完成步骤数（✅ 标记）
  const completedSteps = (progressContent.match(/## Step \d+:.+✅/g) || []).length;

  return { completed: completedSteps, total: totalSteps };
}
```

### 14.3 状态更新触发时机

| 事件                   | 文件变化               | 阶段转换                     |
| ---------------------- | ---------------------- | ---------------------------- |
| 用户发送新任务         | 无（助手尚未写入）     | idle → assigning             |
| 助手写入 jobs.md       | jobs.md 创建           | assigning                    |
| 助手写入 PLAN.md       | PLAN.md 创建           | assigning → pending_approval |
| Owner 点击"同意执行"   | meta.planApproved=true | pending_approval → planning  |
| 助手 @mention 执行者   | 无变化                 | planning → executing         |
| 执行者更新 PROGRESS.md | PROGRESS.md 创建/更新  | executing                    |
| 助手写入 RESULTS.md    | RESULTS.md 创建        | executing → completed        |
| 用户发送新任务         | 所有文件被清空         | completed → idle → assigning |

---

## 15. System Prompt 详细规范

> **这是计划模式的核心实现**。通过上下文注入，让 Agent 自主按照计划模式的要求行事。

### 15.1 助手 Agent 上下文注入

当 `planMode === true` 且 Agent 角色为 `assistant` 时，注入以下内容：

````markdown
## 计划模式 — 你是协调者

你当前处于**计划模式**。你的职责是协调群内 Agent 协作完成用户的任务。

### 工作流程

1. **澄清（可选）**：如果用户任务描述不清晰，你可以直接向用户提问以澄清细节。如果任务足够明确，跳过此步骤。

2. **分工**：分析任务和群内各 Agent 的能力，为每个 Agent 分配职责。写入 `.openclaw-group/jobs.md`。

3. **计划**：将任务拆解为具体步骤，明确每步的负责人、依赖关系和执行顺序。写入 `.openclaw-group/PLAN.md`。

4. **等待 Owner 确认**：完成分工和计划后，**停止并等待群 Owner 确认**。
   - 不要 @mention 任何执行者 Agent
   - 在群聊中发送简短提示："分工和计划已完成，请 Owner 确认后开始执行"
   - 等待 Owner 点击"同意执行"或提供修改意见
   - 如果 Owner 提出修改意见，根据反馈调整 jobs.md 或 PLAN.md，然后再次等待确认

5. **执行**：收到 Owner 确认后，按计划触发 Agent 执行：
   - 步骤之间有依赖 → **一次 @mention 一个 Agent**（串行）
   - 步骤之间无依赖 → **一次 @mention 多个 Agent**（并行）
   - 每轮执行结束后，检查 `.openclaw-group/PROGRESS.md`，决定下一步

6. **总结**：所有步骤完成后，汇总结果写入 `.openclaw-group/RESULTS.md`，通知用户。

### 协作文件

| 文件        | 你的操作                           |
| ----------- | ---------------------------------- |
| jobs.md     | 写入：为每个 Agent 分配职责        |
| PLAN.md     | 写入：拆解任务为步骤，定义依赖关系 |
| PROGRESS.md | 读取：检查各步骤完成状态           |
| RESULTS.md  | 写入：汇总最终结果                 |

**文件路径**：`.openclaw-group/` 目录下。

### 分工格式 (jobs.md)

```markdown
# 分工

> 任务：{任务描述}
> 创建时间：{时间}
> 协调者：{你的 agentId}

## 参与成员

### {agentId}（{角色}）

- **职责**：{具体职责}
- **关注点**：{需要关注的方面}
- **工作目录**：{项目路径}（如适用）

## 协作约定

- {协作规则1}
- {协作规则2}
```
````

### 计划格式 (PLAN.md)

```markdown
# 执行计划

> 任务：{任务描述}
> 创建时间：{时间}
> 最后更新：{时间}

## 步骤总览

| #   | 步骤   | 负责人 | 依赖 | 执行方式 | 状态    |
| --- | ------ | ------ | ---- | -------- | ------- |
| 1   | {描述} | @{id}  | 无   | 串行     | pending |
| 2   | {描述} | @{id}  | #1   | 串行     | pending |

## 步骤详情

### Step 1: {步骤名称}

- **负责人**：@{agentId}
- **描述**：{详细描述}
- **产出**：{预期产出文件}
- **完成标准**：{验收标准}
```

### 进度格式 (PROGRESS.md) — 执行者更新

```markdown
## Step {N}: {步骤名称} {状态标记}

- **负责人**：{agentId}
- **完成时间**：{时间}
- **产出**：
  - {文件1}
  - {文件2}
- **备注**：{关键信息}
```

**状态标记**：⏳ 等待中 | 🔄 进行中 | ✅ 已完成 | ❌ 失败 | 🔁 需重做

### 决策准则

每轮汇总触发后，读取 PROGRESS.md 判断：

1. **所有步骤 ✅** → 写入 RESULTS.md，任务完成
2. **仍有 ⏳/🔄 步骤** → 继续触发下一批执行者
3. **有 ❌ 步骤** → 分析原因，决定重试或调整计划

### 安全限制

- 最多执行约 {maxRounds/2} 轮计划循环
- 超出限制后直接写入 RESULTS.md 并总结当前状态
- 链超时（{chainTimeout} 分钟）会自动终止执行

### 示例：触发执行者

```
计划已制定，共 3 个步骤。

Step 1 先行，Step 2 和 Step 3 可并行。

@backend 请完成 Step 1：创建 User 数据模型。
完成后请更新 .openclaw-group/PROGRESS.md。
```

### 示例：检查进度后继续

```
[读取 PROGRESS.md — Step 1 ✅, Step 2 ⏳, Step 3 ⏳]

Step 1 已完成。Step 2 和 Step 3 无依赖，同时开始。

@backend 请实现认证 API（Step 2）
@frontend 请实现登录页面（Step 3）

完成后请更新 .openclaw-group/PROGRESS.md。
```

### 示例：任务完成

```
[读取 PROGRESS.md — 全部 ✅]

[写入 RESULTS.md]

✅ 任务完成！已为项目添加 JWT 认证功能。

**变更摘要**：
- 新增 8 个文件
- 修改 3 个文件
- 测试覆盖率 95%+

详细结果请查看 .openclaw-group/RESULTS.md。
```

````

### 15.2 执行者 Agent 上下文注入

当 `planMode === true` 且 Agent 角色为 `member` 或 `bridge-assistant` 时，注入以下内容：

```markdown
## 计划模式 — 你是执行者

当前群聊处于**计划模式**。你有具体的执行任务。

### 你的工作流程

1. **阅读计划**：查看 `.openclaw-group/PLAN.md` 了解当前计划和你负责的步骤
2. **了解职责**：查看 `.openclaw-group/jobs.md` 了解你的职责范围
3. **执行任务**：完成分配给你的步骤
4. **更新进度**：完成后更新 `.openclaw-group/PROGRESS.md`

### 进度更新格式

在你负责的步骤下追加以下内容：

```markdown
## Step {N}: {步骤名称} ✅

- **负责人**：{你的 agentId}
- **完成时间**：{当前时间}
- **产出**：
  - {创建的文件1}
  - {创建的文件2}
- **备注**：{关键信息、接口文档、注意事项等}
````

**状态标记**：

- ✅ 已完成
- ❌ 失败（需说明原因）
- 🔁 需重做（助手要求修改时）

### 注意事项

- **只更新你自己负责的步骤**
- 如果遇到阻塞问题，标记 ❌ 并说明原因
- 完成后回复助手 Agent，简要说明完成情况
- 如果助手要求重做，更新状态为 🔁 并说明修改内容

### 示例：成功完成

```markdown
## Step 2: 认证 API 开发 ✅

- **负责人**：backend
- **完成时间**：2026-04-03 10:45
- **产出**：
  - `src/server/auth/routes.ts` — 注册、登录、获取用户信息三个端点
  - `src/server/auth/middleware.ts` — JWT 验证中间件
- **接口文档**：
  - `POST /api/auth/register` — body: `{ email, password }` → `{ user, token }`
  - `POST /api/auth/login` — body: `{ email, password }` → `{ user, token }`
- **备注**：JWT 有效期 7 天，secret 从环境变量读取
```

### 示例：遇到问题

```markdown
## Step 5: E2E 测试 ❌

- **负责人**：tester
- **失败时间**：2026-04-03 11:30
- **失败原因**：登录后跳转未生效，AuthGuard 组件未正确读取 Token
- **错误日志**：
```

AssertionError: Expected URL to be "/dashboard"
Actual: "/login"

```
- **建议**：需要 frontend 检查 AuthGuard 的 Token 读取逻辑
```

````

### 15.3 Bridge Agent 特殊上下文

对于 Bridge Agent（CLI Agent），额外注入以下内容：

```markdown
### Bridge Agent 特殊说明

作为 Bridge Agent，你通过 CLI 工具执行任务。请注意：

1. **工作目录**：在 jobs.md 中指定的目录下执行命令
2. **工具使用**：使用可用的 CLI 工具（如 `read_file`、`write_to_file`、`execute_command`）
3. **进度更新**：CLI 命令执行完成后，务必更新 PROGRESS.md
4. **错误处理**：如果命令失败，在 PROGRESS.md 中标记 ❌ 并附上错误输出

### 可用工具

- `read_file` — 读取文件
- `write_to_file` — 写入文件
- `execute_command` — 执行 shell 命令
- `search_content` — 搜索文件内容
- `search_file` — 搜索文件名

### 示例：CLI 任务执行

````

[读取 PLAN.md — Step 1: 创建 User 模型]

[执行命令]
$ npx prisma migrate dev --name add-user-model

[检查结果]
Migration successful.

[更新 PROGRESS.md]

## Step 1: 数据模型设计 ✅

- **负责人**：backend
- **完成时间**：2026-04-03 10:20
- **产出**：
  - `prisma/schema.prisma` — 新增 User 模型
  - `prisma/migrations/20260403_add_user_model/`

```

```

### 15.4 上下文注入时机

| 触发点               | 注入内容                       | 条件                             |
| -------------------- | ------------------------------ | -------------------------------- |
| 用户发送消息         | 助手上下文                     | `planMode === true` 且角色为助手 |
| 助手 @mention 执行者 | 执行者上下文                   | `planMode === true` 且角色非助手 |
| 汇总消息触发助手     | 助手上下文 + 当前阶段提示      | `planMode === true`              |
| Bridge Agent 被触发  | 执行者上下文 + Bridge 特殊说明 | `planMode === true` 且是 Bridge  |

### 15.5 动态上下文变量

上下文中可以包含以下动态变量：

| 变量             | 来源                     | 示例值               |
| ---------------- | ------------------------ | -------------------- |
| `{maxRounds}`    | `meta.maxRounds`         | 20                   |
| `{chainTimeout}` | `meta.chainTimeout`      | 15 分钟              |
| `{projectDir}`   | `meta.project.directory` | `/home/user/project` |
| `{agentId}`      | 当前 Agent ID            | `backend`            |
| `{groupId}`      | 群聊 ID                  | `grp_abc123`         |

---

## 16. UI 状态指示实现

### 16.1 状态栏组件

```typescript
type PlanModeStatusBarProps = {
  phase: "idle" | "assigning" | "planning" | "pending_approval" | "executing" | "completed";
  completedSteps: number;
  totalSteps: number;
  onViewJobs: () => void;
  onViewPlan: () => void;
  onViewProgress: () => void;
  onApprovePlan?: () => void; // Owner 确认执行
};

function renderPlanModeStatusBar(props: PlanModeStatusBarProps) {
  const phaseLabels = {
    idle: "空闲",
    assigning: "分工中",
    planning: "计划中",
    pending_approval: "待确认",
    executing: "执行中",
    completed: "已完成",
  };

  return html`
    <div class="plan-mode-status-bar">
      <div class="plan-mode-status-bar__left">
        <span class="plan-mode-status-bar__icon">📋</span>
        <span class="plan-mode-status-bar__phase">
          计划模式 — ${phaseLabels[props.phase]}
          ${props.phase === "executing"
            ? `(${props.completedSteps}/${props.totalSteps} 步骤完成)`
            : nothing}
        </span>
      </div>
      <div class="plan-mode-status-bar__actions">
        <button class="btn btn--sm btn--link" @click=${props.onViewJobs}>查看分工</button>
        <button class="btn btn--sm btn--link" @click=${props.onViewPlan}>查看计划</button>
        <button class="btn btn--sm btn--link" @click=${props.onViewProgress}>查看进度</button>
      </div>
    </div>
  `;
}
```

### 16.2 状态更新流程

```
前端轮询（每 5 秒）或文件变更事件
    │
    ▼
调用 group.getPlanState RPC
    │
    ▼
获取文件存在性 { jobs, plan, progress, results }
    │
    ▼
推断阶段：inferPlanPhase(files)
    │
    ▼
如果 phase === 'executing'：
    │
    ├─ 读取 PLAN.md → 统计总步骤数
    │
    └─ 读取 PROGRESS.md → 统计已完成步骤数
    │
    ▼
更新 UI 状态栏
```
