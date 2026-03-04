# 多 Agent 群聊功能 — 需求文档

> **版本**: v3.0
> **日期**: 2026-03-04
> **状态**: 草案

---

## 1. 概述

在现有的 1:1 对话基础上，新增「群聊」会话类型。群聊的成员包括一个 Owner（用户本人）、一个助手（Assistant Agent）和多个普通成员（Agent）。群内支持 @ 提及机制，实现 Owner 与 Agent 之间、Agent 与 Agent 之间的多方对话。

### 1.1 核心理念

- 群聊是多个 Agent 协作对话的场所
- Agent 之间的消息传递**必须先在 UI 对话窗中体现，再按照对话窗的逻辑发送到后台**，不允许在后台直接调用代码绕过 UI 回复
- Agent 回复谁、是否 @ 别人，完全由 Agent 自身决定，系统通过 Skill 为 Agent 提供群聊感知和回复工具
- 后端实现**独立目录** (`src/group-chat/`)，与现有单聊代码隔离，避免影响单聊功能
- 群内 Agent **禁止修改后台配置，仅允许读取**
- 每个 Agent 在群内可以有自己的**职责提示词**，明确其在该群中的角色定位

### 1.2 与单聊的隔离原则

| 维度       | 单聊                                | 群聊                                  |
| ---------- | ----------------------------------- | ------------------------------------- |
| 代码目录   | `src/auto-reply/`, `src/agents/` 等 | `src/group-chat/` (新建独立目录)      |
| 数据存储   | `~/.openclaw/sessions/`             | `~/.openclaw/group-chats/` (独立目录) |
| SessionKey | `agent:<agentId>:<rest>`            | `group:<groupId>`                     |
| 消息分发   | 单 Agent dispatch                   | 群聊独立 dispatch 引擎                |

---

## 2. 术语定义

| 术语                         | 定义                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| **群聊 (Group Chat)**        | 包含一个 Owner、一个助手和零或多个普通成员的多方会话                                  |
| **Owner**                    | 群聊创建者（用户本人），拥有群管理权限                                                |
| **助手 (Assistant)**         | 群内唯一的特殊角色 Agent，单播模式下无 @ 消息默认发送给助手。每个群聊有且仅有一个助手 |
| **普通成员 (Member)**        | 群内的普通 Agent，可以有多个                                                          |
| **职责提示词 (Role Prompt)** | 每个 Agent 在群内的专属职责说明，告知其在该群中的角色定位和任务范围                   |
| **@ 提及 (Mention)**         | 以 `@<agentId>` 或 `@<agentName>` 的形式指定消息接收者                                |
| **发送者 (Sender)**          | 每条消息的来源标识，包含 groupId + 发送者身份（Owner 或某个 Agent）                   |
| **消息模式 (Message Mode)**  | 群聊的消息分发策略，分为单播和广播                                                    |
| **单播 (Unicast)**           | 未 @ 任何人时，消息默认发送给助手                                                     |
| **广播 (Broadcast)**         | 未 @ 任何人时，消息默认发送给所有成员                                                 |
| **群公告 (Announcement)**    | 群聊的置顶公告信息，所有成员可见                                                      |
| **群 Skill (Group Skill)**   | 专属于某个群聊的自定义 Skill，群内所有 Agent 共享                                     |
| **并行流 (Parallel Stream)** | 广播模式下多个 Agent 同时推理回复，UI 同时展示多个流式响应                            |

---

## 3. 功能需求

### 3.1 群聊导航入口

群聊入口位于左侧导航栏中，**「对话」和「控制」区块之间**，作为独立的导航区块：

```
┌──────────────┐
│ 对话         + │  ← 新建对话按钮
│  · 对话1       │
│  · 对话2       │
│  · ...         │
├──────────────┤
│ 群聊         + │  ← 新建群聊按钮
│  · 群聊1       │
│  · 群聊2       │
│  · ...         │
├──────────────┤
│ 控制         - │
│  ‣ 概览        │
│  ‣ 频道        │
│  ‣ 实例        │
│  ‣ 会话        │
│  ‣ 用量        │
│  ‣ 定时任务     │
├──────────────┤
│ 智能体         │
│  · ...         │
└──────────────┘
```

- 群聊列表区块标题为「群聊」，旁边有「+」按钮用于新建群聊
- 群聊列表项显示：群组图标 + 群名称 + 最后更新时间
- 点击群聊列表项切换到该群聊的对话窗
- 群聊列表按最后更新时间倒序排列

### 3.2 群聊生命周期管理

#### 3.2.1 新建群聊

- **入口**：群聊区块标题旁的「+」按钮
- **流程**：
  1. 用户点击「+」新建群聊
  2. 弹出群聊创建面板，显示可选 Agent 列表（来源于 `agents.list` RPC）
  3. 用户**多选**要加入的 Agent（至少选择 1 个）
  4. 用户指定其中一个 Agent 为**助手**（必选，默认为第一个选中的 Agent）
  5. 可选：设置群聊名称（不设置则自动生成）
  6. 可选：选择消息模式（单播/广播，默认单播）
  7. 确认创建，生成新的群聊会话
  8. **后台自动操作**：系统自动将群成员信息持久化存储，并为每个成员应用默认职责提示词

#### 3.2.2 邀请成员

- **入口**：群聊会话内，顶栏或侧边栏提供「邀请成员」按钮
- **流程**：
  1. 点击「邀请成员」，弹出 Agent 选择面板
  2. 仅显示未在群内的 Agent
  3. 支持多选，确认后将选中 Agent 加入群聊（角色为普通成员）
  4. **后台自动操作**：系统自动更新群成员存储，应用默认职责提示词，并在群内发送系统消息通知

#### 3.2.3 移除成员

- **入口**：群聊成员列表中，每个 Agent 旁有「移除」操作
- **权限**：仅 Owner 可操作
- **约束**：助手不能被移除，只能通过「更换助手」操作替换
- **效果**：被移除的 Agent 不再接收群内消息
- **后台自动操作**：系统自动更新群成员存储，并在群内发送系统消息通知

#### 3.2.4 更换助手

- **入口**：群聊信息面板中，助手条目旁有「更换」按钮
- **流程**：
  1. 点击后弹出当前群内普通成员列表
  2. 选择一个普通成员提升为助手
  3. 原助手降级为普通成员
- **约束**：群聊始终保持一个且仅一个助手
- **职责提示词**：角色变更后，自动切换为对应角色的默认职责提示词

#### 3.2.5 消息模式切换

- **入口**：群聊信息面板中，提供「消息模式」开关
- **选项**：
  - **单播 (Unicast)**：未 @ 任何人时，消息默认发送给助手
  - **广播 (Broadcast)**：未 @ 任何人时，消息默认发送给所有成员（助手 + 普通成员）
- **默认值**：单播
- **即时生效**：切换后立即影响后续消息的分发行为

#### 3.2.6 解散群聊

- **入口**：群聊信息面板底部，提供「解散群聊」按钮
- **权限**：仅 Owner 可操作
- **效果**：群聊会话标记为已归档，历史消息保留可查看

---

### 3.3 成员角色体系

| 角色                  | 数量限制 | 权限                                                                                               | 说明                               |
| --------------------- | -------- | -------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **Owner**             | 1        | 全部管理权限（创建、邀请、移除、更换助手、切换模式、设置公告、管理群 Skill、设置职责提示词、解散） | 用户本人，不可变更                 |
| **助手 (Assistant)**  | 1        | 接收单播模式下的默认消息；与其他 Agent 相同的回复能力；**只读访问后台配置**                        | 特殊角色 Agent，可被替换但不可空缺 |
| **普通成员 (Member)** | 0~N      | 被 @ 时接收消息；广播模式下接收所有消息；可回复和 @ 其他成员；**只读访问后台配置**                 | 普通 Agent                         |

**Agent 权限限制（重要）**：

- 群聊中的所有 Agent（包括助手和普通成员）**禁止修改后台配置**
- 允许的操作：读取配置、读取文件、搜索、查询状态等只读操作
- 禁止的操作：写入配置、修改系统设置、执行变更类 gateway/cron 操作
- 通过群聊专用的 Tool Policy 实现，在 Agent 推理前强制注入只读约束

---

### 3.4 职责提示词功能（新增）

#### 3.4.1 概述

每个 Agent 在群内可以有自己的**职责提示词 (Role Prompt)**，用于告知其在该群中的角色定位、职责范围和工作方式。这让 Agent 能够更专注地完成特定任务，避免职责混乱。

#### 3.4.2 默认职责提示词模板

系统提供两类默认职责提示词模板：

**助手默认职责提示词**：

```
你是这个群聊的助手，是群内的核心协调者。

你的职责包括：
1. 作为群内的主要响应者，处理来自 Owner 的各类请求
2. 在需要其他 Agent 协助时，主动 @ 相关成员并清晰传达需求
3. 整合其他 Agent 的反馈，形成完整的回复
4. 协调群内 Agent 之间的协作，避免重复工作或冲突

在工作时请注意：
- 优先响应 Owner 的消息
- 在单播模式下，你是默认的消息接收者
- 充分利用其他成员的专长，不要独自完成所有工作
- 保持回复的简洁和专业
```

**普通成员默认职责提示词**：

```
你是这个群聊的普通成员。

你的职责包括：
1. 在被 @ 时响应相关请求，发挥你的专业能力
2. 在广播模式下积极参与讨论，提供你的见解
3. 在发现其他 Agent 的工作需要补充或纠正时，主动发言

在工作时请注意：
- 主要响应 @ 你的消息，不要过度活跃
- 在你的专业领域内提供准确、有价值的信息
- 如果认为任务需要其他人协助，可以 @ 相关成员
- 保持回复的简洁和专业
```

#### 3.4.3 自定义职责提示词

- **入口**：群聊信息面板的成员列表中，每个 Agent 条目旁有「编辑职责」按钮
- **权限**：仅 Owner 可编辑
- **内容**：纯文本，最大长度 2000 字符
- **存储**：存储在群聊元数据中，与 agentId 绑定
- **即时生效**：编辑后立即影响该 Agent 后续推理的 System Prompt

#### 3.4.4 职责提示词注入机制

职责提示词作为 System Prompt 的一部分注入到 Agent 推理上下文中：

**注入位置**：在群聊上下文信息之后，Skills 之前

**注入格式**：

```
## 你的职责

{职责提示词内容}
```

**优先级**：

- 如果 Agent 有自定义职责提示词，使用自定义内容
- 如果没有，使用对应角色（助手/普通成员）的默认职责提示词

#### 3.4.5 职责提示词数据模型

```typescript
type GroupMemberRolePrompt = {
  agentId: string;
  rolePrompt: string; // 自定义职责提示词，为空则使用默认
  updatedAt?: number; // 最后更新时间
};

// 在 GroupSessionEntry 中增加
type GroupSessionEntry = {
  // ...existing fields
  memberRolePrompts: GroupMemberRolePrompt[]; // 成员职责提示词列表
};
```

---

### 3.5 群公告功能

#### 3.5.1 公告设置

- **入口**：群聊信息面板中，提供「群公告」编辑区域
- **权限**：仅 Owner 可设置/修改公告
- **内容**：纯文本，支持多行，最大长度 2000 字符

#### 3.5.2 公告展示

- 群聊对话窗顶部显示当前公告（可折叠）
- 公告变更时，在群聊中插入系统消息通知

#### 3.5.3 公告注入上下文

- 群公告内容会作为**上下文的一部分**注入到每个 Agent 的 System Prompt 中
- Agent 可以感知群公告内容，作为行为参考

---

### 3.6 群 Skill 功能

#### 3.6.1 概述

群 Skill 是专属于某个群聊的自定义 Skill，群内所有 Agent 在该群聊会话中共享这些 Skill。

#### 3.6.2 群 Skill 管理

- **入口**：群聊信息面板中，提供「群 Skill」管理区域
- **权限**：仅 Owner 可管理
- **操作**：
  - 从已有的全局 Skill 列表中选择 Skill 添加到群
  - 移除群内已有的 Skill
  - 查看群内当前的 Skill 列表

#### 3.6.3 群 Skill 注入规则

- 群 Skill **仅在该群聊会话中生效**，不影响 Agent 在其他会话中的行为
- 群 Skill 与 Agent 自身的 Skill 合并后一起注入
- 优先级：Agent 自身 Skill + 群 Skill + 群聊系统 Skill（`group-chat-reply`）

#### 3.6.4 群 Skill 存储

- 群 Skill 配置存储在群聊元数据中（`meta.json` 的 `groupSkills` 字段）
- 存储的是 Skill 的名称引用列表，Skill 实际内容从全局 Skill 库加载

---

### 3.7 消息系统

#### 3.7.1 消息模型

每条群聊消息包含以下字段：

| 字段        | 类型                                | 必填 | 说明                              |
| ----------- | ----------------------------------- | ---- | --------------------------------- |
| `id`        | `string`                            | 是   | 消息唯一标识（UUID）              |
| `groupId`   | `string`                            | 是   | 所属群聊 ID，明确标识消息归属的群 |
| `role`      | `"user" \| "assistant" \| "system"` | 是   | 消息角色                          |
| `content`   | `string`                            | 是   | 消息内容                          |
| `sender`    | `MessageSender`                     | 是   | 发送者信息（含 groupId）          |
| `mentions`  | `string[]`                          | 否   | 被 @ 的 agentId 列表              |
| `replyTo`   | `string?`                           | 否   | 回复的消息 ID（引用回复）         |
| `timestamp` | `number`                            | 是   | 消息时间戳                        |

```typescript
type MessageSender = {
  groupId: string; // 所属群聊 ID
  type: "owner" | "agent";
  agentId?: string; // type 为 "agent" 时必填
  agentName?: string; // 用于 UI 显示
};
```

#### 3.7.2 Owner 发送消息

- Owner 在群聊输入框编辑消息
- 支持 `@` 语法：输入 `@` 后弹出成员选择下拉框，可选择一个或多个 Agent
- **消息分发规则**：

| 场景      | 消息模式 | 行为                                                                |
| --------- | -------- | ------------------------------------------------------------------- |
| 有 @ 提及 | 任何模式 | 仅被 @ 的 Agent 收到消息并触发推理                                  |
| 无 @ 提及 | 单播     | 消息默认发送给**助手**，仅助手触发推理                              |
| 无 @ 提及 | 广播     | 消息发送给**所有成员**（助手 + 普通成员），所有成员**并行**触发推理 |

- Owner 发送的消息在 UI 中显示在右侧（与现有样式一致）

#### 3.7.3 Agent 回复消息 — UI 优先原则

**关键设计原则**：Agent 的回复必须**先在 UI 对话窗中体现，然后按照对话窗的逻辑发送到后台**。禁止 Agent A 回复 Agent B 时直接在后台调用代码绕过 UI。

**完整流程**：

1. Agent A 收到消息后，通过群聊 Skill 提供的 `group_reply` 工具发起回复
2. `group_reply` 工具的执行逻辑：
   a. 将 A 的回复内容**先通过 WebSocket 事件推送到 UI 对话窗**进行展示
   b. UI 收到事件后在对话窗中渲染 A 的消息气泡（带 A 的头像和名称）
   c. **然后 UI 按照对话窗的标准逻辑**，将这条消息（sender=A，mentions=[B]）发送到后台
   d. 后台收到消息后，写入 Transcript，并触发 B 的推理
3. 这样确保了：
   - 所有消息都经过 UI 层，对话窗是唯一的消息通道
   - Agent 间的对话在 UI 上实时可见
   - 消息处理逻辑与 Owner 发送消息完全一致，只是 sender 不同

**简化方案（推荐）**：

- `group_reply` 工具在后台执行时，模拟一次 `group.send` RPC 调用（sender=当前 Agent）
- 这个 RPC 调用走的是与 UI 发送消息**完全相同的代码路径**
- 后台同时通过 WebSocket 推送 `group.message` 事件到 UI 进行展示
- 效果等同于 Agent "在对话窗中输入并发送了一条消息"

#### 3.7.4 广播模式下的多 Agent 并行推理

- 广播消息触发多个 Agent 时，Agent 的推理**并行执行**
- 每个 Agent 独立推理，使用发送广播消息时的 Transcript 快照作为上下文
- 各 Agent 的回复按完成时间顺序写入 Transcript（使用写锁保证原子性）
- UI 同时显示多个 Agent 的流式回复（多个 loading 气泡并行）
- **注意**：并行推理时，后续完成的 Agent 不能看到先完成的 Agent 的回复（因为上下文是快照）
- 如果某个 Agent 回复中 @ 了其他 Agent，在该 Agent 回复完成后再触发被 @ Agent 的推理（此时可看到所有已完成的回复）

#### 3.7.5 @ 提及解析

- 解析规则：`@agentId` 或 `@agentName`（不区分大小写）
- @ 触发条件：被 @ 的 Agent 必须是当前群的成员
- 一条消息可以 @ 多个 Agent，每个被 @ 的 Agent 都会触发推理
- @ Owner 不触发新的推理（Owner 是人类用户），仅在 UI 高亮提示

#### 3.7.6 消息展示

- 每条消息清晰标注发送者（Owner 或具体 Agent 名称 + 头像）
- 不同 Agent 的消息使用不同的**头像 + 名称**进行视觉区分
- @ 提及在消息中高亮显示（蓝色标签样式）
- 支持查看完整群聊历史
- Owner 消息靠右，所有 Agent 消息靠左

**系统消息（`role: "system"`）场景**：

- 成员加入/退出通知
- 对话轮次超限通知
- 助手变更通知
- 消息模式切换通知
- 公告变更通知

---

### 3.8 并行流渲染（前端关键技术）

#### 3.8.1 问题背景

当前 UI 的 `ChatState` 设计只支持**单一活跃流**：

```typescript
// 当前 ChatState（单聊设计）
type ChatState = {
  chatRunId: string | null; // 单一 run
  chatStream: string | null; // 单一流缓冲
  chatStreamStartedAt: number | null;
  // ...
};
```

这在单聊场景下没问题，但在群聊广播模式下，多个 Agent 同时推理，需要**同时渲染多个流式响应**。

#### 3.8.2 解决方案：多流 Map 结构

重构 `ChatState` 为支持多并行流：

```typescript
// 新的 GroupChatState（支持多流）
type GroupChatState = {
  groupId: string;
  messages: GroupChatMessage[];

  // 并行流状态 - runId 是每个 Agent 推理的唯一标识
  activeStreams: Map<
    string,
    {
      // runId -> 流状态
      agentId: string;
      agentName: string;
      agentAvatar?: string;
      text: string; // 累积的流文本
      segments: string[]; // 分段边界
      startedAt: number;
      status: "streaming" | "final" | "error" | "aborted";
      toolCalls?: ToolCallInfo[]; // 工具调用信息
    }
  >;

  // 其他状态
  sending: boolean;
  lastError: string | null;
};

type ToolCallInfo = {
  toolName: string;
  status: "pending" | "running" | "completed" | "error";
  result?: string;
};
```

#### 3.8.3 WebSocket 事件扩展

并行流需要扩展 WebSocket 事件，携带 `runId` 和 `agentId` 以区分不同 Agent 的流：

**`group.stream` 事件**：

```typescript
type GroupStreamEvent = {
  event: "group.stream";
  payload: {
    groupId: string;
    runId: string; // 每个推理的唯一标识
    agentId: string; // 标识是哪个 Agent
    agentName: string; // UI 显示用
    agentAvatar?: string;
    state: "delta" | "final" | "error" | "aborted";
    content?: string; // delta 状态时的增量文本
    message?: GroupChatMessage; // final 状态时的完整消息
    error?: string; // error 状态时的错误信息
  };
};
```

**事件处理逻辑**：

```typescript
function handleGroupStreamEvent(event: GroupStreamEvent) {
  const { groupId, runId, agentId, state, content, message } = event.payload;

  switch (state) {
    case "delta":
      // 更新或创建流状态
      const stream = groupChatState.activeStreams.get(runId) || {
        agentId,
        agentName,
        startedAt: Date.now(),
        text: "",
        status: "streaming",
      };
      stream.text += content;
      groupChatState.activeStreams.set(runId, stream);
      break;

    case "final":
      // 完成流，添加到消息列表
      groupChatState.messages.push(message);
      groupChatState.activeStreams.delete(runId);
      break;

    case "error":
    case "aborted":
      groupChatState.activeStreams.delete(runId);
      break;
  }
}
```

#### 3.8.4 UI 渲染方案

**并行流渲染组件结构**：

```tsx
function GroupChatView({ state }: { state: GroupChatState }) {
  return (
    <div class="group-chat-container">
      {/* 已完成的消息列表 */}
      {state.messages.map((msg) => (
        <MessageBubble message={msg} />
      ))}

      {/* 并行流渲染区域 */}
      {state.activeStreams.size > 0 && (
        <div class="parallel-streams">
          {Array.from(state.activeStreams.entries()).map(([runId, stream]) => (
            <StreamingBubble
              key={runId}
              agentId={stream.agentId}
              agentName={stream.agentName}
              text={stream.text}
              startedAt={stream.startedAt}
              status={stream.status}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StreamingBubble({ agentName, text, status }) {
  return (
    <div class="message-bubble agent-bubble streaming">
      <AgentAvatar name={agentName} />
      <div class="message-content">
        <span class="agent-name">{agentName}</span>
        <div class="stream-text" use:typewriter={text} />
        {status === "streaming" && <Spinner />}
      </div>
    </div>
  );
}
```

**样式要点**：

- 多个流式气泡**并排或堆叠**显示，使用淡入动画
- 每个 Agent 的气泡使用不同的**颜色标识**（基于 agentId 哈希）
- 流式文本使用打字机效果
- Agent 头像和名称清晰标注

#### 3.8.5 后端流事件广播

后端在并行触发多个 Agent 时，需要为每个 Agent 分配唯一的 `runId`：

```typescript
async function broadcastToMembers(groupId: string, message: GroupChatMessage) {
  const members = await getGroupMembers(groupId);
  const transcriptSnapshot = await getTranscriptSnapshot(groupId);

  // 并行触发所有成员
  const runs = await Promise.all(
    members.map(async (member) => {
      const runId = generateRunId(); // 唯一 runId

      // 异步执行推理，内部会广播 group.stream 事件
      triggerAgentReasoning({
        groupId,
        runId,
        agentId: member.agentId,
        transcript: transcriptSnapshot,
        onDelta: (delta) => broadcastStreamDelta(runId, member, delta),
        onFinal: (msg) => broadcastStreamFinal(runId, member, msg),
        onError: (err) => broadcastStreamError(runId, member, err),
      });

      return { agentId: member.agentId, runId };
    }),
  );

  return runs;
}
```

---

### 3.9 上下文管理

#### 3.9.1 群成员信息自动注入

群成员信息由**系统自动管理**，不需要 Agent 主动查询：

- **创建群聊时**：后台自动存储初始成员列表
- **成员变更时**（邀请/移除/更换助手）：后台自动更新存储
- **触发 Agent 推理时**：系统将当前群成员信息作为**上下文的一部分**自动注入到 Agent 的 System Prompt 中

**注入内容格式**（作为 System Prompt 的一部分）：

```
## 群聊信息

你当前在群聊「{groupName}」(ID: {groupId}) 中。
你的角色是：{assistant|member}
消息模式：{unicast|broadcast}

### 群成员
- Owner: {ownerName} (创建者)
- {agentName_1} ({agentId_1}) — 助手
- {agentName_2} ({agentId_2}) — 成员
- {agentName_3} ({agentId_3}) — 成员

### 群公告
{announcement 内容，如果有的话}

## 你的职责
{职责提示词内容}
```

这样 Agent 在每次被触发时，天然知道群里有谁、自己是什么角色、职责是什么，无需调用额外工具查询。

#### 3.9.2 群聊历史上下文

参考单聊的 `historyLimit` 机制，群聊也需要控制传入 Agent 的历史消息数量：

| 配置项               | 类型     | 默认值 | 说明                          |
| -------------------- | -------- | ------ | ----------------------------- |
| `historyLimit`       | `number` | 50     | 传入 Agent 的最大历史消息条数 |
| `historyTokenBudget` | `number` | 可配置 | 历史消息的最大 Token 预算     |

- 历史消息按时间倒序截取最近的 N 条
- 截取时保持消息的完整性（不截断单条消息）
- 每条历史消息保留 `sender` 信息，让 Agent 知道每条消息是谁发的

#### 3.9.3 上下文压缩（Compaction）

**可行性分析**：

群聊的上下文压缩可以**复用现有单聊的压缩架构**，因为核心算法（分块摘要、渐进降级、安全超时）是通用的。主要差异在于：

| 维度     | 单聊压缩              | 群聊压缩                      |
| -------- | --------------------- | ----------------------------- |
| 消息来源 | user + assistant 二元 | owner + 多个 agent 多元       |
| 摘要要求 | 保留对话要点          | 保留多方对话要点 + 发言者标识 |
| 触发条件 | 接近 context window   | 同单聊                        |
| 压缩粒度 | 整个会话              | 整个群聊 Transcript           |

**群聊压缩设计**：

1. **触发条件**：与单聊一致，当 Transcript 的 Token 数接近 context window 限制时自动触发
2. **压缩流程**：
   a. **Memory Flush**：在压缩前，提示当前被触发的 Agent 将重要信息持久化
   b. **分块摘要**：复用 `summarizeInStages()` 算法，将 Transcript 分块后生成摘要
   c. **发言者保留**：摘要 Prompt 中特别要求保留每段对话的发言者标识（谁说了什么）
   d. **渐进降级**：与单聊一致，完整摘要 → 部分摘要 → 文本描述
3. **压缩结果**：压缩后的摘要替换旧历史，保留最近 N 条未压缩的消息
4. **压缩配置**：

| 配置项                          | 类型      | 默认值  | 说明                               |
| ------------------------------- | --------- | ------- | ---------------------------------- |
| `compaction.enabled`            | `boolean` | `true`  | 是否启用压缩                       |
| `compaction.maxHistoryShare`    | `number`  | `0.5`   | 历史在 context window 中的最大占比 |
| `compaction.reserveTokensFloor` | `number`  | `20000` | 压缩预留 Token 下限                |

5. **实现方式**：
   - 在 `src/group-chat/compaction.ts` 中实现群聊专用的压缩逻辑
   - 复用 `src/agents/compaction.ts` 中的核心算法（`summarizeInStages`, `summarizeWithFallback`, `pruneHistoryForContextShare`）
   - 定制群聊摘要 Prompt，强调保留多方发言者信息

**结论**：上下文压缩功能**可行**，核心算法可复用，主要工作在于定制群聊摘要 Prompt 和适配多发言者的 Transcript 格式。

#### 3.9.4 Context Pruning（上下文修剪）

参考单聊的 `context-pruning` 机制，群聊也可以应用**微压缩**：

- **Soft Trim**：保留 tool result 的头尾各 1500 字符，截断中间
- **Hard Clear**：将旧的 tool result 替换为占位符
- 保护规则：最近 3 个 assistant 消息不修剪

这层修剪**仅影响内存中传给 LLM 的上下文**，不改写磁盘上的 Transcript。

---

### 3.10 群聊 Skill 体系

#### 3.10.1 `group-chat-reply` Skill

**用途**：让 Agent 知道自己在群聊中，并提供回复和 @ 其他成员的工具。

**Skill 内容**：

- **上下文注入**：
  - 告知 Agent 当前处于群聊模式
  - 说明消息来源可能是 Owner 或其他 Agent
  - 说明 Agent 应根据消息内容和上下文自主判断是否需要回复以及回复谁
  - 告知 Agent 自身的角色（助手 / 普通成员）
  - **强调**：Agent 在群聊中只能进行只读操作，不可修改后台配置

- **工具定义 — `group_reply`**：
  - 参数：
    - `message: string` — 回复内容
    - `mentions?: string[]` — 要 @ 的成员 agentId 列表（可选）
  - 行为：
    - 模拟一次 `group.send` RPC 调用（sender=当前 Agent），走与 UI 发送消息完全相同的代码路径
    - 后台同时通过 WebSocket 推送 `group.message` 事件到 UI 进行展示
    - 如果有 mentions，消息写入后触发被 @ Agent 的推理
    - 如果无 mentions，仅写入 Transcript 并在 UI 展示，不触发其他 Agent

- **行为指导**：
  - 鼓励 Agent 在需要其他 Agent 协助时使用 @ 提及
  - 告知 Agent 避免无意义的循环对话
  - 告知 Agent 如果任务已完成，不需要继续 @ 其他人

#### 3.10.2 群成员信息 — 自动上下文注入

**不再作为独立 Skill**，改为系统自动管理：

- **创建群聊时**：后台自动存储群成员列表
- **成员变更时**：后台自动更新存储
- **Agent 被触发时**：系统自动将群成员信息、群公告、群配置、职责提示词作为上下文注入到 Agent 的 System Prompt 中（参见 3.9.1 节）
- 这样免去了每次 Agent 自己调用工具获取成员信息的开销

#### 3.10.3 Skill 注入规则

群聊中 Agent 的 Skill 组成：

```
最终 Skill 列表 = Agent 自身 Skill + 群 Skill + group-chat-reply Skill
```

- `group-chat-reply` Skill **仅在群聊会话中生效**
- 群 Skill 仅在对应群聊中生效
- Agent 自身 Skill 保持不变
- 利用现有的 `resolveSkillsPromptForRun()` 机制，在构建 Agent prompt 时动态注入

---

### 3.11 Agent 只读限制

#### 3.11.1 限制范围

群聊中的所有 Agent 在推理时，工具权限被限制为**只读模式**：

**允许的操作**（只读类）：

- `read` — 读取文件
- `search` — 搜索
- `list` — 列表查询
- `status` — 状态查看
- `get` — 获取信息
- `memory_search` / `memory_get` — 记忆查询
- `sessions_list` / `sessions_history` — 会话查询
- `group_reply` — 群聊回复（这是群聊专用的写操作例外）

**禁止的操作**（变更类）：

- `write` / `edit` / `apply_patch` — 文件写入/编辑
- `exec` / `bash` / `process` — 命令执行
- `gateway` — 网关配置变更
- `cron` — 定时任务变更
- `agents_list` 中的变更操作 — Agent 配置变更
- `sessions_send` — 发送消息到其他会话
- `config` 相关的写操作 — 配置变更

#### 3.11.2 实现机制

- 在 `src/group-chat/tool-policy.ts` 中实现群聊专用的 Tool Policy
- 在 Agent 推理前，通过 Tool Policy Pipeline 注入群聊只读策略
- 参考现有的 `tool-policy-pipeline.ts` 和 `tool-mutation.ts` 中的 `READ_ONLY_ACTIONS` / `MUTATING_TOOL_NAMES` 分类
- `group_reply` 工具作为白名单例外，允许在只读模式下使用

---

### 3.12 防循环机制

为避免 Agent 之间无限循环对话：

| 机制                        | 说明                                                               | 默认值 |
| --------------------------- | ------------------------------------------------------------------ | ------ |
| **最大轮次限制**            | 每次 Owner 发送消息后触发的 Agent 对话链，最多执行 N 轮            | 10 轮  |
| **同一 Agent 连续触发限制** | 同一个 Agent 不得在同一对话链中被连续触发超过 M 次                 | 3 次   |
| **超限处理**                | 达到限制时中止当前对话链，在群聊中插入系统消息「对话轮次已达上限」 | -      |
| **可配置**                  | Owner 可在群聊设置中调整上述参数                                   | -      |

**轮次计算规则**：

- 从 Owner 发送消息开始计数
- 每个 Agent 的一次完整回复（含 `group_reply` 工具调用）算一轮
- 广播模式下并行推理的多个 Agent 回复，每个算一轮
- Owner 下一次手动发送消息时，轮次计数重置

---

### 3.13 扩展功能（可选）

以下功能可根据优先级在后续版本中实现：

#### 3.13.1 消息引用回复

- **功能**：支持引用群内某条消息进行回复
- **数据模型**：消息的 `replyTo` 字段指向被引用消息的 ID
- **UI 展示**：引用消息以缩略卡片形式显示在回复消息上方
- **场景**：Agent 间针对特定消息进行讨论

#### 3.13.2 消息撤回

- **功能**：Owner 可撤回自己发送的消息（Agent 不可撤回）
- **时效**：发送后 2 分钟内可撤回
- **效果**：消息标记为已撤回，内容替换为「消息已撤回」

#### 3.13.3 成员在线状态

- **功能**：显示群成员的在线/离线状态
- **实现**：基于 Agent 所在会话的活动状态判断
- **展示**：成员头像旁显示在线指示器（绿点）

#### 3.13.4 群聊搜索

- **功能**：在群聊历史消息中搜索关键词
- **入口**：群聊顶栏的搜索按钮
- **结果**：高亮显示匹配的消息，支持跳转到上下文

#### 3.13.5 消息已读状态

- **功能**：显示消息被哪些 Agent 「已读」
- **实现**：Agent 完成推理后自动标记已读
- **展示**：消息旁显示已读回执（类似微信）

#### 3.13.6 群聊导出

- **功能**：导出群聊历史为 Markdown 或 JSON 格式
- **入口**：群聊信息面板的「导出」按钮
- **用途**：备份、分享、分析

#### 3.13.7 群聊模板

- **功能**：保存群聊配置为模板，快速创建相似配置的群聊
- **包含**：成员列表、消息模式、群公告、群 Skill、职责提示词配置
- **入口**：群聊创建面板的「从模板创建」

#### 3.13.8 沉默模式

- **功能**：临时关闭 Agent 自动回复，仅保留人工交流
- **入口**：群聊顶栏的「沉默模式」开关
- **场景**：Owner 想要自行处理问题，不需要 Agent 干扰

#### 3.13.9 消息反应（Reaction）

- **功能**：对消息添加表情反应（👍、❤️ 等）
- **权限**：Owner 和 Agent 都可添加
- **展示**：消息下方显示反应统计

#### 3.13.10 群聊置顶

- **功能**：将重要群聊置顶显示在列表顶部
- **入口**：群聊列表项的右键菜单或长按菜单
- **限制**：最多置顶 5 个群聊

---

## 4. 数据模型设计

### 4.1 群聊 Session

**SessionKey 格式**：

```
group:<groupId>
```

与现有的 `agent:<agentId>:<rest>` 格式平级，通过前缀区分。

**GroupSessionEntry 字段**：

| 字段                | 类型                       | 必填 | 说明                                |
| ------------------- | -------------------------- | ---- | ----------------------------------- |
| `groupId`           | `string`                   | 是   | 群聊唯一标识（UUID）                |
| `groupName`         | `string?`                  | 否   | 群聊名称，不设置则自动生成          |
| `messageMode`       | `"unicast" \| "broadcast"` | 是   | 消息分发模式，默认 `"unicast"`      |
| `members`           | `GroupMember[]`            | 是   | 成员列表（不含 Owner，Owner 隐含）  |
| `memberRolePrompts` | `GroupMemberRolePrompt[]`  | 否   | 成员职责提示词配置                  |
| `announcement`      | `string?`                  | 否   | 群公告内容，最大 2000 字符          |
| `groupSkills`       | `string[]`                 | 否   | 群 Skill 名称列表                   |
| `maxRounds`         | `number`                   | 是   | 最大对话轮次，默认 10               |
| `maxConsecutive`    | `number`                   | 是   | 同一 Agent 最大连续触发次数，默认 3 |
| `historyLimit`      | `number`                   | 是   | 历史消息条数限制，默认 50           |
| `compaction`        | `GroupCompactionConfig?`   | 否   | 上下文压缩配置                      |
| `createdAt`         | `number`                   | 是   | 创建时间                            |
| `updatedAt`         | `number`                   | 是   | 最后更新时间                        |
| `label`             | `string?`                  | 否   | 会话标签                            |

```typescript
type GroupMember = {
  agentId: string;
  role: "assistant" | "member";
  joinedAt: number;
};

type GroupMemberRolePrompt = {
  agentId: string;
  rolePrompt: string; // 自定义职责提示词，为空则使用默认
  updatedAt?: number;
};

type GroupCompactionConfig = {
  enabled: boolean; // 默认 true
  maxHistoryShare: number; // 默认 0.5
  reserveTokensFloor: number; // 默认 20000
};
```

**约束**：

- `members` 中 `role: "assistant"` 的条目有且仅有一个
- `role: "member"` 的条目可以有零或多个

### 4.2 群聊消息格式

在现有 Transcript JSONL 基础上扩展：

```typescript
type GroupChatMessage = {
  id: string; // 消息唯一标识
  groupId: string; // 所属群聊 ID
  role: "user" | "assistant" | "system";
  content: string;
  sender: MessageSender; // 发送者信息（含 groupId）
  mentions?: string[]; // 被 @ 的 agentId 列表
  replyTo?: string; // 回复的消息 ID（引用回复）
  timestamp: number; // 消息时间戳
};

type MessageSender = {
  groupId: string; // 所属群聊 ID
  type: "owner" | "agent";
  agentId?: string; // type 为 "agent" 时必填
  agentName?: string; // 用于 UI 显示
};
```

---

## 5. API 设计

### 5.1 新增 RPC 方法

| 方法                        | 参数                                                                                                                            | 返回                                      | 说明                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------- |
| `group.create`              | `{ name?: string, members: Array<{ agentId: string, role: "assistant" \| "member" }>, messageMode?: "unicast" \| "broadcast" }` | `{ groupId: string, sessionKey: string }` | 创建群聊，后台自动存储成员信息并应用默认职责提示词 |
| `group.addMembers`          | `{ groupId: string, members: Array<{ agentId: string, role?: "member" }> }`                                                     | `{ ok: boolean }`                         | 邀请成员，后台自动更新成员存储                     |
| `group.removeMembers`       | `{ groupId: string, agentIds: string[] }`                                                                                       | `{ ok: boolean }`                         | 移除成员，后台自动更新成员存储                     |
| `group.setAssistant`        | `{ groupId: string, agentId: string }`                                                                                          | `{ ok: boolean }`                         | 更换助手                                           |
| `group.setMessageMode`      | `{ groupId: string, mode: "unicast" \| "broadcast" }`                                                                           | `{ ok: boolean }`                         | 切换消息模式                                       |
| `group.setAnnouncement`     | `{ groupId: string, content: string }`                                                                                          | `{ ok: boolean }`                         | 设置群公告                                         |
| `group.setSkills`           | `{ groupId: string, skills: string[] }`                                                                                         | `{ ok: boolean }`                         | 设置群 Skill 列表                                  |
| `group.setMemberRolePrompt` | `{ groupId: string, agentId: string, rolePrompt: string }`                                                                      | `{ ok: boolean }`                         | 设置成员职责提示词                                 |
| `group.info`                | `{ groupId: string }`                                                                                                           | `GroupSessionEntry`                       | 获取群聊完整信息                                   |
| `group.list`                | `{}`                                                                                                                            | `GroupSessionEntry[]`                     | 列出所有群聊                                       |
| `group.delete`              | `{ groupId: string }`                                                                                                           | `{ ok: boolean }`                         | 解散群聊                                           |
| `group.send`                | `{ groupId: string, message: string, mentions?: string[], sender?: MessageSender }`                                             | `{ ok: boolean, messageId: string }`      | 发送群聊消息（Owner 和 Agent 走相同代码路径）      |
| `group.history`             | `{ groupId: string, limit?: number, before?: number }`                                                                          | `GroupChatMessage[]`                      | 获取群聊历史消息                                   |

### 5.2 新增 WebSocket 事件

| 事件                    | Payload                                                                                                                                                                   | 说明                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `group.message`         | `{ groupId: string, message: GroupChatMessage }`                                                                                                                          | 新消息推送到 UI                                    |
| `group.stream`          | `{ groupId: string, runId: string, agentId: string, agentName: string, state: "delta" \| "final" \| "error" \| "aborted", content?: string, message?: GroupChatMessage }` | Agent 回复的流式内容（支持多个 Agent 并行 stream） |
| `group.system`          | `{ groupId: string, event: string, data: unknown }`                                                                                                                       | 系统事件（成员变更、模式切换、公告变更等）         |
| `group.members_updated` | `{ groupId: string, members: GroupMember[] }`                                                                                                                             | 成员列表变更通知                                   |

---

## 6. 后端代码组织

### 6.1 独立目录结构

所有群聊后端代码放在独立目录下，**不修改现有单聊代码**：

```
src/
  group-chat/                          # 群聊功能根目录（全新目录）
    types.ts                           # 群聊相关类型定义
    group-store.ts                     # 群聊元数据存储（CRUD）
    group-session-key.ts               # group:<id> SessionKey 解析
    message-dispatch.ts                # 群聊消息分发引擎（@路由、单播/广播）
    agent-trigger.ts                   # 触发 Agent 推理（模拟 group.send 机制）
    anti-loop.ts                       # 防循环机制
    transcript.ts                      # 群聊 Transcript 读写（含写锁）
    context-builder.ts                 # 群聊上下文构建（成员信息 + 公告 + 职责提示词 + 历史注入）
    compaction.ts                      # 群聊上下文压缩（复用核心算法）
    tool-policy.ts                     # 群聊 Agent 只读工具策略
    announcement.ts                    # 群公告管理
    group-skills.ts                    # 群 Skill 管理
    role-prompt.ts                     # 职责提示词管理（新增）
    parallel-stream.ts                 # 并行流管理（新增）
    index.ts                           # 模块导出

  gateway/server-methods/
    group.ts                           # group.* RPC 方法实现（新文件）

skills/
  group-chat-reply/
    SKILL.md                           # group-chat-reply Skill 定义
```

### 6.2 与现有系统的集成点

群聊模块仅在以下**最小的**接入点与现有系统集成：

| 集成点         | 文件                               | 变更方式 | 说明                                                   |
| -------------- | ---------------------------------- | -------- | ------------------------------------------------------ |
| RPC 方法注册   | `src/gateway/server-methods/` 入口 | 新增引入 | 引入 `group.ts` 方法注册                               |
| WebSocket 事件 | `src/gateway/`                     | 复用机制 | 新增 `group.*` 事件类型                                |
| Skill 注入     | `src/agents/skills/workspace.ts`   | 条件注入 | SessionKey 为 `group:*` 时注入群聊 Skill               |
| 压缩核心算法   | `src/agents/compaction.ts`         | 仅引用   | `group-chat/compaction.ts` 引用核心函数，不修改        |
| Agent 推理     | `src/auto-reply/reply/`            | 仅调用   | `agent-trigger.ts` 调用 `getReplyFromConfig()`，不修改 |

### 6.3 独立存储

群聊数据使用独立的存储目录，不侵入现有 `sessions.json`：

```
~/.openclaw/
  group-chats/
    index.json                         # 群聊列表索引
    <groupId>/
      meta.json                        # 群聊元数据（成员、配置、公告、群 Skill、职责提示词）
      transcript.jsonl                 # 群聊消息记录
      compaction-summary.json          # 压缩摘要（压缩后生成）
```

---

## 7. UI 设计

### 7.1 群聊导航区块

位于「对话」和「控制」之间：

- 区块标题「群聊」+ 折叠/展开按钮 + 「+」新建按钮
- 列表项：群组图标 + 群名称 + 最后更新时间 + 编辑/删除按钮
- 选中状态高亮
- 空状态显示引导文案

### 7.2 群聊创建面板

- 「+」按钮打开模态框
- 模态框内容：
  - 群聊名称输入框（可选）
  - Agent 列表（复用 `agents.ts` 视图中的 Agent 列表组件样式）
  - 每个 Agent 旁有 Checkbox（多选）和「设为助手」Radio（单选）
  - 消息模式选择：单播 / 广播（Radio，默认单播）
  - 底部显示已选数量 + 「创建」按钮

### 7.3 聊天区域

- **消息气泡**：
  - Owner 消息靠右，与现有 1:1 样式一致
  - Agent 消息靠左，每条消息带有 Agent 头像和名称
  - 不同 Agent 使用不同颜色/头像以便视觉区分
- **@ 提及**：
  - 输入框中输入 `@` 触发成员选择弹窗（下拉列表）
  - 选中后以蓝色标签形式插入输入框
  - 消息正文中的 @ 提及以蓝色高亮显示
- **系统消息**：居中显示，灰色小字
- **群公告**：对话窗顶部固定显示当前公告（可折叠）
- **Agent 流式回复**：
  - 支持多个 Agent **并行**的流式回复（广播模式下）
  - 每个正在推理的 Agent 显示独立的 loading 气泡
  - 流式内容实时更新（复用现有 stream 渲染机制，扩展为多路）
  - **关键**：每个 Agent 的流使用独立的 runId 标识，确保并行流不互相干扰

### 7.4 群聊信息面板

- 群聊顶栏右侧的信息按钮（ℹ️）打开侧面板
- 面板内容：
  - **基本信息**：群聊名称（可编辑）
  - **消息模式**：单播/广播切换开关
  - **群公告**：公告编辑区域（多行文本框）
  - **群 Skill**：Skill 选择列表（从全局 Skill 库中选择）
  - **成员列表**：
    - Owner 标注「创建者」（不可操作）
    - 助手标注「助手」+ 「更换」按钮 + 「编辑职责」按钮
    - 普通成员标注「成员」+ 「移除」按钮 + 「编辑职责」按钮
  - **邀请成员**：「邀请成员」按钮
  - **高级设置**：
    - 历史消息条数限制（historyLimit）
    - 防循环参数（最大轮次、最大连续触发次数）
    - 上下文压缩开关及参数
  - **解散群聊**：危险操作按钮，需二次确认

### 7.5 职责提示词编辑面板

- 点击「编辑职责」按钮弹出模态框
- 模态框内容：
  - Agent 名称和角色显示
  - 职责提示词编辑区域（多行文本框，支持 Markdown 预览）
  - 「恢复默认」按钮（重置为默认职责提示词）
  - 「保存」按钮

---

## 8. 核心交互流程

### 8.1 单播模式 — 无 @ 消息

```
Owner 在 UI 输入 "帮我分析一下这个问题"
         │
         ▼
  UI 调用 group.send RPC (sender=owner, groupId=xxx, mentions=[])
         │
         ▼
  后台写入 Transcript + 推送 group.message 事件到 UI
         │
         ▼
  后台判断：单播模式 + 无 @ → 发送给助手
         │
         ▼
  触发助手推理（注入群成员上下文 + 职责提示词 + 群公告 + 只读工具策略）
         │
         ▼
  后台广播 group.stream 事件 (runId=run_1, agentId=助手, state=delta/final)
         │
         ▼
  UI 接收流事件，渲染助手的流式回复气泡
         │
         ▼
  助手通过 group_reply 回复:
  "分析结果如下..." (mentions=[])
         │
         ▼
  group_reply 内部调用 group.send (sender=助手, groupId=xxx)
         │
         ▼
  后台写入 Transcript + 推送 group.message 事件到 UI
         │
         ▼
  UI 展示助手的回复气泡
  无 mentions → 对话链结束
```

### 8.2 有 @ 提及 — Agent 间对话

```
Owner 在 UI 输入 "@AgentA 帮我分析一下这个问题"
         │
         ▼
  UI 调用 group.send RPC (sender=owner, groupId=xxx, mentions=[AgentA])
         │
         ▼
  后台写入 Transcript + 推送 group.message 到 UI
         │
         ▼
  触发 AgentA 推理（注入群成员上下文 + 职责提示词 + 只读策略）
         │
         ▼
  后台广播 group.stream 事件 (runId=run_1, agentId=AgentA, state=delta/final)
         │
         ▼
  UI 渲染 AgentA 的流式回复
         │
         ▼
  AgentA 通过 group_reply 回复:
  "分析完毕... @AgentB 请补充数据" (mentions=[AgentB])
         │
         ▼
  group_reply → group.send (sender=AgentA, groupId=xxx, mentions=[AgentB])
         │
         ▼
  后台写入 Transcript + 推送 group.message 到 UI
  UI 展示 AgentA 的回复气泡
         │
         ▼
  触发 AgentB 推理
         │
         ▼
  后台广播 group.stream 事件 (runId=run_2, agentId=AgentB, state=delta/final)
         │
         ▼
  UI 渲染 AgentB 的流式回复
         │
         ▼
  AgentB 通过 group_reply 回复:
  "数据如下..." (mentions=[])
         │
         ▼
  group_reply → group.send (sender=AgentB, groupId=xxx)
  后台写入 + UI 展示
  无 mentions → 对话链结束
```

### 8.3 广播模式 — 并行推理

```
Owner 在 UI 输入 "大家觉得这个方案怎么样？"
         │
         ▼
  UI 调用 group.send (sender=owner, groupId=xxx, mentions=[], mode=broadcast)
         │
         ▼
  后台写入 Transcript + 推送到 UI
         │
         ▼
  获取当前 Transcript 快照
         │
         ▼
  并行触发所有成员推理（基于相同的 Transcript 快照）
         │
    ┌────┼────────┐
    ▼    ▼        ▼
  run_1 run_2   run_3    ← 三个独立的 runId
  助手  AgentB  AgentC    ← 并行推理
    │    │        │
    ▼    ▼        ▼
  后台并行广播 group.stream 事件:
  - (runId=run_1, agentId=助手, state=delta/final)
  - (runId=run_2, agentId=AgentB, state=delta/final)
  - (runId=run_3, agentId=AgentC, state=delta/final)
    │    │        │
    ▼    ▼        ▼
  UI 通过 runId 区分三个流，并行渲染三个 Agent 的回复气泡
         │
         ▼
  各 Agent 回复完成后，按完成顺序写入 Transcript
         │
         ▼
  所有 Agent 回复完成
  （如有 Agent @ 了其他人，继续触发对话链）
         │
         ▼
  对话链结束或达到最大轮次
```

---

## 9. 需要改造的关键模块

| 模块          | 文件/目录                                          | 改造方式 | 说明                           |
| ------------- | -------------------------------------------------- | -------- | ------------------------------ |
| 群聊核心逻辑  | `src/group-chat/` (新建)                           | **新增** | 独立目录，14 个核心文件        |
| 群聊 RPC      | `src/gateway/server-methods/group.ts` (新建)       | **新增** | group.\* 方法实现              |
| RPC 注册      | `src/gateway/server-methods/` 入口                 | **微改** | 引入 group 方法注册            |
| Skill 注入    | `src/agents/skills/workspace.ts`                   | **微改** | 增加群聊 Skill 条件注入        |
| 群聊 Skill    | `skills/group-chat-reply/` (新建)                  | **新增** | Skill 定义文件                 |
| UI 群聊导航   | `ui/src/ui/app-render.helpers.ts`                  | **微改** | 在对话和控制之间增加群聊区块   |
| UI 群聊视图   | `ui/src/ui/views/group-chat.ts` (新建)             | **新增** | 群聊专属 UI 组件               |
| UI 群聊控制器 | `ui/src/ui/controllers/group-chat.ts` (新建)       | **新增** | 群聊 RPC 调用封装              |
| UI 状态       | `ui/src/ui/app-view-state.ts`                      | **微改** | 新增群聊相关状态字段           |
| UI 渲染入口   | `ui/src/ui/app-render.ts`                          | **微改** | 主区域增加群聊视图路由         |
| UI 消息渲染   | `ui/src/ui/chat/`                                  | **微改** | 支持多发送者气泡 + 并行 stream |
| UI 并行流状态 | `ui/src/ui/controllers/group-chat-state.ts` (新建) | **新增** | 多流 Map 状态管理              |

**改造原则**：

- 「新增」= 全新文件/目录，零侵入
- 「微改」= 仅增加引入/注册/条件判断，不修改现有逻辑分支

---

## 10. 实现优先级

| 阶段              | 内容                                               | 说明                                                 |
| ----------------- | -------------------------------------------------- | ---------------------------------------------------- |
| **P0 - 基础层**   | 群聊数据模型 + 存储 + SessionKey                   | `types.ts`, `group-store.ts`, `group-session-key.ts` |
| **P0 - 基础层**   | 群聊 CRUD API                                      | `group.create/list/info/delete`                      |
| **P0 - 基础层**   | 群聊 Skill 编写                                    | `skills/group-chat-reply/`                           |
| **P0 - 基础层**   | Agent 只读工具策略                                 | `tool-policy.ts`                                     |
| **P0 - 基础层**   | 职责提示词管理                                     | `role-prompt.ts` + 默认模板                          |
| **P1 - 核心链路** | 群成员上下文 + 职责提示词自动注入                  | `context-builder.ts`                                 |
| **P1 - 核心链路** | Owner → Agent 消息分发（单播 + @）                 | `message-dispatch.ts`, `agent-trigger.ts`            |
| **P1 - 核心链路** | Agent → Agent 消息传递（group_reply → group.send） | `agent-trigger.ts`                                   |
| **P1 - 核心链路** | 防循环机制                                         | `anti-loop.ts`                                       |
| **P1 - 核心链路** | 广播模式并行推理                                   | `message-dispatch.ts`, `parallel-stream.ts`          |
| **P1 - 核心链路** | 并行流 WebSocket 事件                              | `group.stream` 事件广播                              |
| **P2 - 增强功能** | 群公告                                             | `announcement.ts` + API                              |
| **P2 - 增强功能** | 群 Skill 管理                                      | `group-skills.ts` + API                              |
| **P2 - 增强功能** | 上下文压缩                                         | `compaction.ts`                                      |
| **P2 - 增强功能** | 成员管理 API                                       | `group.addMembers/removeMembers/setAssistant`        |
| **P3 - 前端 UI**  | 群聊导航区块 + 创建面板                            | 导航栏 + 模态框                                      |
| **P3 - 前端 UI**  | 群聊消息渲染                                       | 多发送者气泡 + @ 高亮                                |
| **P3 - 前端 UI**  | **并行流渲染（重点）**                             | 多流 Map 状态 + 并行气泡渲染                         |
| **P3 - 前端 UI**  | @ 提及输入交互                                     | 输入框 @ 弹窗                                        |
| **P3 - 前端 UI**  | 群聊信息面板                                       | 成员管理 + 公告 + 群 Skill + 设置                    |
| **P3 - 前端 UI**  | 职责提示词编辑面板                                 | 职责编辑模态框                                       |
| **P4 - 扩展功能** | 消息引用回复                                       | 可选功能                                             |
| **P4 - 扩展功能** | 消息撤回                                           | 可选功能                                             |
| **P4 - 扩展功能** | 群聊搜索                                           | 可选功能                                             |

---

## 11. 风险与限制

| 风险                   | 影响                                       | 缓解措施                                             |
| ---------------------- | ------------------------------------------ | ---------------------------------------------------- |
| **Token 消耗**         | 群聊 Transcript 含多方对话，上下文快速增长 | historyLimit + 上下文压缩 + Context Pruning 三层防护 |
| **广播模式并行 Token** | N 个 Agent 并行推理，Token 消耗 ×N         | 提示用户广播模式消耗更多；支持限制广播成员数         |
| **响应延迟**           | Agent 间链式触发需等待 LLM 推理            | UI 实时流式展示；广播模式用并行减少等待              |
| **并发写入**           | 并行推理时 Transcript 并发写入             | 文件写锁保证原子性（复用现有 Session Store 锁机制）  |
| **Agent 行为不可控**   | Agent 可能产生无意义 @ 循环                | 防循环机制（轮次限制 + 连续触发限制）                |
| **只读限制绕过**       | Agent 可能尝试通过间接方式修改配置         | Tool Policy 在最底层强制过滤，无法绕过               |
| **单聊功能影响**       | 代码改动可能影响现有单聊                   | 独立目录 + 独立存储 + 最小集成点 + 充分测试          |
| **压缩质量**           | 多方对话的摘要可能丢失发言者信息           | 定制群聊摘要 Prompt，强调保留发言者标识              |
| **并行流 UI 复杂度**   | 多流并发渲染增加 UI 实现复杂度             | 使用 Map 结构管理流状态；每个流独立 runId 标识       |
| **职责提示词过长**     | 职责提示词过长占用过多上下文               | 限制最大长度 2000 字符；提示用户精简内容             |

---

## 12. 文档修订记录

| 版本 | 日期       | 变更内容                                                                                                            |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| v1.0 | 2026-03-04 | 初始版本                                                                                                            |
| v2.0 | 2026-03-04 | 增加导航入口位置、sender groupId、上下文压缩、UI 优先原则、广播并行、成员自动管理、群公告、群 Skill、Agent 只读限制 |
| v3.0 | 2026-03-04 | 增加职责提示词功能、并行流渲染详细技术方案、扩展功能列表、WebSocket 事件扩展、UI 并行流状态管理                     |
