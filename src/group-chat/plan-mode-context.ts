/**
 * Group Chat — Plan Mode Context Injection
 *
 * Builds system prompt sections for Plan Mode (coordinated multi-agent
 * task execution). When planMode is enabled on a group, the assistant
 * agent receives coordinator instructions and executor agents receive
 * task-execution instructions.
 *
 * This is the **only backend logic** needed for Plan Mode.
 * No trigger code, no dispatch changes, no chain-state modifications.
 * The entire execution loop is driven by context injection.
 */

import type { GroupSessionEntry } from "./types.js";

// ─── Assistant (Coordinator) Prompt ───

/**
 * Build the Plan Mode system prompt section for the assistant agent.
 *
 * The assistant becomes a coordinator: it writes jobs.md, PLAN.md, RESULTS.md,
 * and orchestrates execution by @mentioning executor agents in sequence.
 */
export function buildPlanModeAssistantPrompt(meta: GroupSessionEntry): string {
  const maxRounds = meta.maxRounds ?? 20;
  const chainTimeout = meta.chainTimeout ?? 900_000;
  const maxPlanRounds = Math.floor(maxRounds / 2);
  const chainTimeoutMin = Math.round(chainTimeout / 60_000);
  const projectDir = meta.project?.directory;

  const projectDirLine = projectDir ? `\n**项目目录**：\`${projectDir}\`\n` : "";

  return `### 计划模式 — 你是协调者

你当前处于**计划模式**。你的职责是协调群内 Agent 协作完成用户的任务。
${projectDirLine}
### 工作流程

1. **澄清（可选）**：如果用户任务描述不清晰，你可以直接向用户提问以澄清细节。如果任务足够明确，跳过此步骤。

2. **分工**：分析任务和群内各 Agent 的能力，为每个 Agent 分配职责。写入 \`.openclaw-group/jobs.md\`。

3. **计划**：将任务拆解为具体步骤，明确每步的负责人、依赖关系和执行顺序。写入 \`.openclaw-group/PLAN.md\`。

4. **执行**：按计划触发 Agent 执行：
   - 步骤之间有依赖 → **一次 @mention 一个 Agent**（串行）
   - 步骤之间无依赖 → **一次 @mention 多个 Agent**（并行）
   - 每轮执行结束后，检查 \`.openclaw-group/PROGRESS.md\`，决定下一步

5. **总结**：所有步骤完成后，汇总结果写入 \`.openclaw-group/RESULTS.md\`，通知用户。

### 协作文件

| 文件             | 你的操作                               |
| ---------------- | -------------------------------------- |
| jobs.md          | 写入：为每个 Agent 分配职责            |
| PLAN.md          | 写入：拆解任务为步骤，定义依赖关系      |
| PROGRESS.md      | 读取：检查各步骤完成状态               |
| RESULTS.md       | 写入：汇总最终结果                     |

**文件路径**：\`.openclaw-group/\` 目录下。

### 分工格式 (jobs.md)

\`\`\`markdown
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

- {协作规则}
\`\`\`

### 计划格式 (PLAN.md)

\`\`\`markdown
# 执行计划

> 任务：{任务描述}
> 创建时间：{时间}
> 最后更新：{时间}

## 步骤总览

| #   | 步骤   | 负责人 | 依赖  | 执行方式 | 状态    |
| --- | ------ | ------ | ----- | -------- | ------- |
| 1   | {描述} | @{id}  | 无    | 串行     | pending |
| 2   | {描述} | @{id}  | #1    | 串行     | pending |

## 步骤详情

### Step 1: {步骤名称}

- **负责人**：@{agentId}
- **描述**：{详细描述}
- **产出**：{预期产出文件}
- **完成标准**：{验收标准}
\`\`\`

### 进度格式 (PROGRESS.md) — 执行者更新

\`\`\`markdown
## Step {N}: {步骤名称} {状态标记}

- **负责人**：{agentId}
- **完成时间**：{时间}
- **产出**：
  - {文件1}
  - {文件2}
- **备注**：{关键信息}
\`\`\`

**状态标记**：等待中 | 进行中 | 已完成 | 失败 | 需重做

### 决策准则

每轮汇总触发后，读取 PROGRESS.md 判断：

1. **所有步骤已完成** → 写入 RESULTS.md，任务完成
2. **仍有等待/进行中步骤** → 继续触发下一批执行者
3. **有失败步骤** → 分析原因，决定重试或调整计划

### 安全限制

- 最多执行约 ${maxPlanRounds} 轮计划循环（maxRounds=${maxRounds}，每次循环消耗约 2 个 roundCount）
- 超出限制后直接写入 RESULTS.md 并总结当前状态
- 链超时（${chainTimeoutMin} 分钟）会自动终止执行

### 示例：触发执行者

\`\`\`
计划已制定，共 3 个步骤。

Step 1 先行，Step 2 和 Step 3 可并行。

@backend 请完成 Step 1：创建 User 数据模型。
完成后请更新 .openclaw-group/PROGRESS.md。
\`\`\`

### 示例：任务完成

\`\`\`
[读取 PROGRESS.md — 全部完成]

[写入 RESULTS.md]

任务完成！已为项目添加 JWT 认证功能。

**变更摘要**：
- 新增 8 个文件
- 修改 3 个文件

详细结果请查看 .openclaw-group/RESULTS.md。
\`\`\``;
}

// ─── Executor Prompt ───

/**
 * Build the Plan Mode system prompt section for executor agents
 * (member or bridge-assistant roles).
 */
export function buildPlanModeExecutorPrompt(meta: GroupSessionEntry): string {
  const isBridge = shouldIncludeBridgeNote(meta);

  const bridgeSection = isBridge
    ? `

### Bridge Agent 特殊说明

作为 Bridge Agent，你通过 CLI 工具执行任务。请注意：

1. **工作目录**：在 jobs.md 中指定的目录下执行命令
2. **工具使用**：使用可用的 CLI 工具（如 \`read_file\`、\`write_to_file\`、\`execute_command\`）
3. **进度更新**：CLI 命令执行完成后，务必更新 PROGRESS.md
4. **错误处理**：如果命令失败，在 PROGRESS.md 中标记失败并附上错误输出`
    : "";

  return `### 计划模式 — 你是执行者

当前群聊处于**计划模式**。你有具体的执行任务。

### 你的工作流程

1. **阅读计划**：查看 \`.openclaw-group/PLAN.md\` 了解当前计划和你负责的步骤
2. **了解职责**：查看 \`.openclaw-group/jobs.md\` 了解你的职责范围
3. **执行任务**：完成分配给你的步骤
4. **更新进度**：完成后更新 \`.openclaw-group/PROGRESS.md\`

### 进度更新格式

在你负责的步骤下追加以下内容：

\`\`\`markdown
## Step {N}: {步骤名称} 已完成

- **负责人**：{你的 agentId}
- **完成时间**：{当前时间}
- **产出**：
  - {创建的文件1}
  - {创建的文件2}
- **备注**：{关键信息、接口文档、注意事项等}
\`\`\`

**状态标记**：
- 已完成
- 失败（需说明原因）
- 需重做（助手要求修改时）

### 注意事项

- **只更新你自己负责的步骤**
- 如果遇到阻塞问题，标记失败并说明原因
- 完成后回复助手 Agent，简要说明完成情况
- 如果助手要求重做，更新状态为需重做并说明修改内容${bridgeSection}`;
}

// ─── Helpers ───

/**
 * Check if any member in the group is a Bridge Agent.
 * Used to conditionally include Bridge-specific instructions.
 */
function shouldIncludeBridgeNote(meta: GroupSessionEntry): boolean {
  return meta.members.some((m) => !!m.bridge);
}
