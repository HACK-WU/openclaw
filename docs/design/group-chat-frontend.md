# 多 Agent 群聊 — 前端详细设计

> **关联需求**: [multi-agent-group-chat.md](./multi-agent-group-chat.md)
> **关联后端设计**: [group-chat-backend.md](./group-chat-backend.md)
> **版本**: v1.0
> **日期**: 2026-03-04

---

## 1. 技术背景

| 维度     | 当前架构                                                      |
| -------- | ------------------------------------------------------------- |
| 框架     | **Lit 3.x** Web Components（无 Shadow DOM，全局样式）         |
| 状态管理 | 单一 `OpenClawApp` LitElement + `@state()` 响应式属性         |
| 模板     | `html` tagged template literals + `repeat` / `nothing` 指令   |
| 信号     | `@lit-labs/signals` + `signal-polyfill`（部分使用）           |
| Markdown | `marked` + `dompurify`                                        |
| RPC      | `GatewayBrowserClient.request(method, params)` over WebSocket |
| 事件     | `handleGatewayEventUnsafe()` 统一路由                         |
| 流式渲染 | 自定义 `typewriter` Lit 指令（16ms/tick，2 chars）            |

---

## 2. 文件结构

```
ui/src/ui/
├── views/
│   └── group-chat.ts                  # [新增] 群聊视图主入口
├── controllers/
│   ├── group-chat.ts                  # [新增] 群聊 RPC 调用封装
│   └── group-chat-state.ts            # [新增] 群聊状态管理（含多流 Map）
├── chat/
│   ├── group-chat-render.ts           # [新增] 群聊消息渲染（多 Agent 气泡）
│   ├── group-chat-stream.ts           # [新增] 并行流渲染组件
│   ├── group-mention-input.ts         # [新增] @ 提及输入组件
│   └── grouped-render.ts             # [微改] 扩展头像/名称支持多 Agent
├── components/
│   ├── group-create-modal.ts          # [新增] 创建群聊模态框
│   ├── group-info-panel.ts            # [新增] 群聊信息侧面板
│   ├── group-member-list.ts           # [新增] 成员列表组件
│   └── role-prompt-editor.ts          # [新增] 职责提示词编辑器
├── app-render.ts                      # [微改] 增加群聊视图路由
├── app-render.helpers.ts              # [微改] 增加群聊导航区块
├── app-view-state.ts                  # [微改] 增加群聊状态字段
├── app-gateway.ts                     # [微改] 增加 group.* 事件路由
├── navigation.ts                      # [微改] 增加群聊导航分组
└── i18n/
    ├── en.ts                          # [微改] 增加群聊相关文案
    └── zh.ts                          # [微改] 增加群聊相关文案
```

---

## 3. 状态设计

### 3.1 AppViewState 扩展

在 `app-view-state.ts` 中新增群聊相关字段：

```typescript
// ─── 新增到 AppViewState ───
type AppViewState = {
  // ... existing fields ...

  // 群聊列表
  groupChats: GroupChatListItem[];
  groupChatsLoading: boolean;

  // 当前活跃群聊
  activeGroupId: string | null;
  activeGroupMeta: GroupSessionEntry | null;

  // 群聊消息状态
  groupChatState: GroupChatState | null;

  // 群聊信息面板
  groupInfoPanelOpen: boolean;

  // 创建群聊模态框
  groupCreateModalOpen: boolean;

  // 职责提示词编辑
  rolePromptEditTarget: { groupId: string; agentId: string } | null;
};

type GroupChatListItem = {
  groupId: string;
  groupName?: string;
  updatedAt: number;
  archived?: boolean;
  // 预览信息
  lastMessage?: string;
  lastSender?: string;
};
```

### 3.2 GroupChatState（核心新增类型）

```typescript
// ui/src/ui/controllers/group-chat-state.ts

export type GroupChatState = {
  groupId: string;

  // 消息列表
  messages: GroupChatMessage[];
  messagesLoading: boolean;

  // ─── 并行流状态（关键设计）───
  // key = runId（每个 Agent 推理的唯一标识）
  activeStreams: Map<string, ActiveStreamState>;

  // 发送状态
  sending: boolean;
  draftMessage: string;
  draftMentions: MentionItem[];

  // 错误
  lastError: string | null;
};

export type ActiveStreamState = {
  runId: string;
  agentId: string;
  agentName: string;
  agentAvatar?: string; // URL / emoji / null
  text: string; // 累积的流文本
  segments: string[]; // 分段（工具调用分隔符）
  startedAt: number;
  status: "streaming" | "final" | "error" | "aborted";
  toolCalls: ToolCallInfo[];
};

export type ToolCallInfo = {
  id: string;
  toolName: string;
  status: "pending" | "running" | "completed" | "error";
  args?: unknown;
  result?: string;
};

export type MentionItem = {
  agentId: string;
  agentName: string;
  position: number; // 在输入文本中的位置
};
```

### 3.3 状态流转

```
┌─────────────────────────────────────────┐
│            初始状态                       │
│  activeStreams = Map()  (空)             │
│  messages = []                           │
│  sending = false                         │
└────────────┬────────────────────────────┘
             │ loadGroupHistory()
             ▼
┌─────────────────────────────────────────┐
│           已加载历史                      │
│  messages = [msg1, msg2, ...]           │
│  messagesLoading = false                │
└────────────┬────────────────────────────┘
             │ sendMessage()
             ▼
┌─────────────────────────────────────────┐
│           发送中                         │
│  sending = true                         │
│  乐观插入 owner 消息到 messages         │
└────────────┬────────────────────────────┘
             │ group.message event (ACK)
             ▼
┌─────────────────────────────────────────┐
│           等待 Agent 回复                │
│  sending = false                        │
└────────────┬────────────────────────────┘
             │ group.stream event (delta)
             ▼
┌─────────────────────────────────────────┐
│          流式渲染中                      │
│  activeStreams = Map {                  │
│    "run_1" → { agentId, text, ... }    │
│    "run_2" → { agentId, text, ... }    │  ← 广播模式可能多个
│  }                                      │
└────────────┬────────────────────────────┘
             │ group.stream event (final)
             ▼
┌─────────────────────────────────────────┐
│          流完成                          │
│  messages.push(finalMessage)            │
│  activeStreams.delete("run_1")          │
│  (如果还有其他流，继续渲染)              │
└─────────────────────────────────────────┘
```

---

## 4. 组件设计

### 4.1 组件层级图

```
OpenClawApp
├── renderNav (app-render.ts)
│   ├── renderNavSessionsList         ← 现有对话列表
│   ├── renderNavGroupChatsList       ← [新增] 群聊列表
│   │   └── GroupChatNavItem          ← 群聊导航项
│   └── renderNavTabs                 ← 现有控制/Agent 标签
│
├── renderContent (app-render.ts)
│   ├── ChatView (views/chat.ts)      ← 现有单聊视图
│   └── GroupChatView                 ← [新增] 群聊视图
│       ├── GroupChatHeader           ← 顶栏（群名、模式、信息按钮）
│       ├── GroupAnnouncementBar      ← 群公告（可折叠）
│       ├── GroupMessageList          ← 消息列表
│       │   ├── GroupMessageBubble    ← 单条消息气泡
│       │   ├── SystemMessage         ← 系统消息
│       │   └── ParallelStreamArea    ← [关键] 并行流渲染区
│       │       └── StreamingBubble × N
│       ├── GroupMentionInput         ← @ 输入组件
│       └── GroupInputBar             ← 输入栏
│
├── GroupCreateModal                  ← 创建群聊模态框
├── GroupInfoPanel                    ← 群聊信息侧面板
│   ├── GroupMemberList               ← 成员列表
│   ├── GroupSkillsSelector           ← 群 Skill 选择
│   ├── GroupAnnouncementEditor       ← 公告编辑
│   └── GroupAdvancedSettings         ← 高级设置
└── RolePromptEditor                  ← 职责提示词编辑模态框
```

### 4.2 导航区块 — 群聊列表

**修改文件**: `app-render.helpers.ts`

```typescript
/**
 * 在对话列表和控制区块之间插入群聊导航区块。
 * 结构与 renderNavSessionsList 保持一致。
 */
export function renderNavGroupChatsList(state: AppViewState): TemplateResult {
  const { groupChats, activeGroupId, settings } = state;
  const collapsed = settings.navGroupsCollapsed["group-chat"] ?? false;

  return html`
    <div class="nav-group ${collapsed ? "nav-group--collapsed" : ""}">
      <div class="nav-group-header" @click=${() => toggleNavGroupCollapsed(state, "group-chat")}>
        <span class="nav-group-label">${t("nav.group.groupChat")}</span>
        <button
          class="nav-group-action"
          title=${t("group.create")}
          @click=${(e: Event) => {
            e.stopPropagation();
            state.groupCreateModalOpen = true;
          }}
        >
          +
        </button>
      </div>
      ${collapsed
        ? nothing
        : html`
            <div class="nav-group-items">
              ${groupChats.length === 0
                ? html`<div class="nav-empty">${t("group.empty")}</div>`
                : repeat(
                    groupChats.filter((g) => !g.archived),
                    (g) => g.groupId,
                    (g) => renderGroupChatNavItem(state, g),
                  )}
            </div>
          `}
    </div>
  `;
}

function renderGroupChatNavItem(state: AppViewState, item: GroupChatListItem): TemplateResult {
  const isActive = state.activeGroupId === item.groupId;
  return html`
    <div
      class="nav-item ${isActive ? "nav-item--active" : ""}"
      @click=${() => switchToGroupChat(state, item.groupId)}
    >
      <span class="nav-item-icon">👥</span>
      <span class="nav-item-label">${item.groupName ?? t("group.unnamed")}</span>
      <span class="nav-item-time">${formatRelativeTime(item.updatedAt)}</span>
    </div>
  `;
}
```

**修改 `navigation.ts`**:

```typescript
export const TAB_GROUPS = [
  { labelKey: "nav.group.chat", tabs: ["chat"] },
  // ← 群聊区块不在 TAB_GROUPS 中定义，而是作为独立的 custom section
  //   在 renderNav 中手动插入（位于 chat 和 control 之间）
  {
    labelKey: "nav.group.control",
    tabs: ["overview", "channels", "instances", "sessions", "usage", "cron"],
  },
  { labelKey: "nav.group.agent", tabs: ["agents", "skills", "nodes"] },
  { labelKey: "nav.group.settings", tabs: ["config", "debug", "logs"] },
];
```

### 4.3 群聊视图 (`views/group-chat.ts`)

```typescript
import { html, nothing, TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type { AppViewState } from "../app-view-state.js";
import type { GroupChatState, ActiveStreamState } from "../controllers/group-chat-state.js";

/**
 * 群聊视图主入口。
 * 替代 ChatView 渲染在主内容区域。
 */
export function renderGroupChatView(state: AppViewState): TemplateResult {
  const { activeGroupId, activeGroupMeta, groupChatState } = state;

  if (!activeGroupId || !activeGroupMeta || !groupChatState) {
    return html`<div class="group-chat-empty">${t("group.selectOrCreate")}</div>`;
  }

  return html`
    <div class="group-chat-view">
      ${renderGroupChatHeader(state, activeGroupMeta)} ${renderGroupAnnouncement(activeGroupMeta)}
      ${renderGroupMessageArea(state, groupChatState)} ${renderGroupInputBar(state, groupChatState)}
    </div>
    ${state.groupInfoPanelOpen ? renderGroupInfoPanel(state, activeGroupMeta) : nothing}
  `;
}
```

### 4.4 消息渲染 (`chat/group-chat-render.ts`)

**关键差异 vs 单聊**：每条消息携带不同的 sender，需要独立的头像和名称。

```typescript
import { html, TemplateResult } from "lit";
import type { GroupChatMessage, MessageSender } from "../../types.js";

/**
 * 渲染群聊消息列表。
 * 与单聊的 buildChatItems / groupMessages 不同：
 * - 不做连续同 sender 合并（群聊中每条消息都明确标注 sender）
 * - 每条消息独立渲染头像和名称
 */
export function renderGroupMessages(
  messages: GroupChatMessage[],
  agentIdentities: Map<string, AgentIdentity>,
): TemplateResult {
  return html`
    <div class="group-messages">
      ${repeat(
        messages,
        (msg) => msg.id,
        (msg) => renderGroupMessageItem(msg, agentIdentities),
      )}
    </div>
  `;
}

function renderGroupMessageItem(
  msg: GroupChatMessage,
  agentIdentities: Map<string, AgentIdentity>,
): TemplateResult {
  if (msg.role === "system") {
    return renderSystemMessage(msg);
  }

  const isOwner = msg.sender.type === "owner";

  return html`
    <div class="group-msg ${isOwner ? "group-msg--owner" : "group-msg--agent"}">
      ${!isOwner ? renderAgentAvatar(msg.sender, agentIdentities) : nothing}
      <div class="group-msg-content">
        ${!isOwner
          ? html`
              <span class="group-msg-sender" style="color: ${getAgentColor(msg.sender.agentId!)}">
                ${msg.sender.agentName ?? msg.sender.agentId}
              </span>
            `
          : nothing}
        <div class="group-msg-bubble ${isOwner ? "bubble--owner" : "bubble--agent"}">
          <div class="group-msg-text">${renderMarkdown(msg.content)}</div>
          ${msg.mentions?.length ? renderMentionTags(msg.mentions) : nothing}
        </div>
        <span class="group-msg-time">${formatTime(msg.timestamp)}</span>
      </div>
      ${isOwner ? renderOwnerAvatar() : nothing}
    </div>
  `;
}

function renderSystemMessage(msg: GroupChatMessage): TemplateResult {
  return html`
    <div class="group-msg--system">
      <span>${msg.content}</span>
    </div>
  `;
}
```

### 4.5 并行流渲染 (`chat/group-chat-stream.ts`)

**这是前端最核心的新增组件**。

```typescript
import { html, nothing, TemplateResult } from "lit";
import { typewriter } from "./typewriter-directive.js";
import type { ActiveStreamState } from "../controllers/group-chat-state.js";

/**
 * 渲染并行流区域。
 * 广播模式下可能有多个 Agent 同时推理。
 *
 * 布局策略：
 * - 1 个流：全宽显示（与普通消息一致）
 * - 2-3 个流：垂直堆叠，每个带 Agent 标识
 * - 4+ 个流：两列网格布局
 *
 * 每个流独立管理打字机效果。
 */
export function renderParallelStreams(
  streams: Map<string, ActiveStreamState>,
  agentIdentities: Map<string, AgentIdentity>,
): TemplateResult {
  if (streams.size === 0) return html`${nothing}`;

  const streamEntries = Array.from(streams.entries()).sort(
    ([, a], [, b]) => a.startedAt - b.startedAt,
  );

  const layoutClass = streams.size >= 4 ? "parallel-streams--grid" : "parallel-streams--stack";

  return html`
    <div class="parallel-streams ${layoutClass}">
      ${streamEntries.map(([runId, stream]) =>
        renderStreamingBubble(runId, stream, agentIdentities),
      )}
    </div>
  `;
}

/**
 * 单个 Agent 的流式气泡。
 * 复用现有 typewriter 指令实现打字机效果。
 */
function renderStreamingBubble(
  runId: string,
  stream: ActiveStreamState,
  agentIdentities: Map<string, AgentIdentity>,
): TemplateResult {
  const identity = agentIdentities.get(stream.agentId);
  const color = getAgentColor(stream.agentId);

  return html`
    <div
      class="stream-bubble"
      data-run-id=${runId}
      data-agent-id=${stream.agentId}
      style="--agent-color: ${color}"
    >
      <!-- Agent 标识 -->
      <div class="stream-bubble-header">
        ${renderAgentAvatarSmall(stream.agentId, identity)}
        <span class="stream-agent-name" style="color: ${color}"> ${stream.agentName} </span>
        ${stream.status === "streaming" ? html`<span class="stream-indicator">●</span>` : nothing}
      </div>

      <!-- 流式内容 -->
      <div class="stream-bubble-body">
        ${stream.segments.length > 0
          ? html`
              <!-- 已完成段：静态 Markdown -->
              ${stream.segments
                .slice(0, -1)
                .map((seg) => html`<div class="stream-segment">${renderMarkdown(seg)}</div>`)}
              <!-- 最后一段 + 当前流：打字机 -->
              <div
                class="stream-segment stream-segment--active"
                ${typewriter((stream.segments.at(-1) ?? "") + stream.text)}
              ></div>
            `
          : html` <div class="stream-text" ${typewriter(stream.text)}></div> `}

        <!-- 工具调用卡片 -->
        ${stream.toolCalls.length > 0
          ? html`
              <div class="stream-tools">
                ${stream.toolCalls.map((tc) => renderToolCallCard(tc))}
              </div>
            `
          : nothing}
      </div>

      <!-- 错误状态 -->
      ${stream.status === "error"
        ? html`<div class="stream-error">${t("group.stream.error")}</div>`
        : nothing}
    </div>
  `;
}

function renderToolCallCard(tc: ToolCallInfo): TemplateResult {
  return html`
    <div class="tool-card tool-card--${tc.status}">
      <span class="tool-card-icon">${tc.status === "running" ? "⏳" : "⚙️"}</span>
      <span class="tool-card-name">${tc.toolName}</span>
      ${tc.status === "completed" && tc.result
        ? html`<div class="tool-card-result">${truncate(tc.result, 200)}</div>`
        : nothing}
    </div>
  `;
}
```

### 4.6 Agent 颜色标识

```typescript
// 基于 agentId 哈希生成稳定的颜色
const AGENT_COLORS = [
  "#4A90D9",
  "#E5534B",
  "#57AB5A",
  "#CC6B2C",
  "#8B5CF6",
  "#DB61A2",
  "#3B82F6",
  "#F59E0B",
  "#10B981",
  "#EF4444",
  "#8B8B8B",
  "#6366F1",
];

export function getAgentColor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = (hash << 5) - hash + agentId.charCodeAt(i);
    hash |= 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}
```

### 4.7 @ 提及输入 (`chat/group-mention-input.ts`)

```typescript
import { html, TemplateResult } from "lit";
import type { GroupMember } from "../../types.js";

/**
 * @ 提及输入组件。
 * 当用户在输入框中输入 @ 时触发。
 *
 * 行为：
 * 1. 检测输入中的 @ 字符
 * 2. 弹出成员选择下拉框
 * 3. 支持键盘导航（↑↓ Enter Esc）
 * 4. 选中后插入 @agentName 并记录 agentId
 * 5. 发送时将 agentName 映射回 agentId 列表
 */
export function renderMentionDropdown(params: {
  visible: boolean;
  members: GroupMember[];
  agentIdentities: Map<string, AgentIdentity>;
  filter: string;
  selectedIndex: number;
  onSelect: (member: GroupMember) => void;
  onClose: () => void;
}): TemplateResult {
  if (!params.visible) return html`${nothing}`;

  const filtered = params.members.filter(
    (m) =>
      m.agentId.toLowerCase().includes(params.filter.toLowerCase()) ||
      (params.agentIdentities.get(m.agentId)?.name ?? "")
        .toLowerCase()
        .includes(params.filter.toLowerCase()),
  );

  return html`
    <div class="mention-dropdown">
      ${filtered.length === 0
        ? html`<div class="mention-empty">${t("group.mention.noMatch")}</div>`
        : filtered.map((m, i) => {
            const identity = params.agentIdentities.get(m.agentId);
            return html`
              <div
                class="mention-item ${i === params.selectedIndex ? "mention-item--selected" : ""}"
                @click=${() => params.onSelect(m)}
                @mouseenter=${() => {
                  params.selectedIndex = i;
                }}
              >
                ${renderAgentAvatarSmall(m.agentId, identity)}
                <span class="mention-name">${identity?.name ?? m.agentId}</span>
                <span class="mention-role"
                  >${m.role === "assistant" ? t("group.role.assistant") : ""}</span
                >
              </div>
            `;
          })}
    </div>
  `;
}

/**
 * 从输入文本中解析 mentions。
 * 将 @agentName 映射回 agentId。
 *
 * 策略：UI 层按名称输入，发送前解析为唯一 agentId。
 * 如果存在同名，取第一个匹配（UI 应在选择时就确定 agentId）。
 */
export function resolveMentionsFromText(
  text: string,
  members: GroupMember[],
  agentIdentities: Map<string, AgentIdentity>,
  explicitMentions: MentionItem[],
): string[] {
  // 优先使用显式选择的 mentions
  return explicitMentions.map((m) => m.agentId);
}
```

### 4.8 创建群聊模态框 (`components/group-create-modal.ts`)

```typescript
/**
 * 创建群聊模态框。
 *
 * 内容：
 * - 群聊名称输入（可选）
 * - Agent 列表（多选 checkbox）
 * - 助手选择（radio，在已选 Agent 中选一个）
 * - 消息模式（radio: 单播/广播）
 * - 已选计数 + 创建按钮
 */
export function renderGroupCreateModal(state: AppViewState): TemplateResult {
  if (!state.groupCreateModalOpen) return html`${nothing}`;

  return html`
    <div class="modal-overlay" @click=${() => closeGroupCreateModal(state)}>
      <div class="modal-content modal-content--md" @click=${(e: Event) => e.stopPropagation()}>
        <div class="modal-header">
          <h3>${t("group.create.title")}</h3>
          <button class="modal-close" @click=${() => closeGroupCreateModal(state)}>×</button>
        </div>

        <div class="modal-body">
          <!-- 群名称 -->
          <div class="form-group">
            <label>${t("group.create.name")}</label>
            <input
              type="text"
              class="form-input"
              placeholder=${t("group.create.namePlaceholder")}
              .value=${state._gcCreateName ?? ""}
              @input=${(e: InputEvent) => {
                state._gcCreateName = (e.target as HTMLInputElement).value;
              }}
            />
          </div>

          <!-- Agent 列表 -->
          <div class="form-group">
            <label>${t("group.create.selectAgents")}</label>
            <div class="agent-select-list">
              ${repeat(
                state.agentsList ?? [],
                (a) => a.id,
                (a) => renderAgentSelectItem(state, a),
              )}
            </div>
          </div>

          <!-- 消息模式 -->
          <div class="form-group">
            <label>${t("group.create.messageMode")}</label>
            <div class="radio-group">
              <label class="radio-label">
                <input
                  type="radio"
                  name="messageMode"
                  value="unicast"
                  ?checked=${(state._gcCreateMode ?? "unicast") === "unicast"}
                  @change=${() => {
                    state._gcCreateMode = "unicast";
                  }}
                />
                ${t("group.mode.unicast")} — ${t("group.mode.unicastDesc")}
              </label>
              <label class="radio-label">
                <input
                  type="radio"
                  name="messageMode"
                  value="broadcast"
                  ?checked=${state._gcCreateMode === "broadcast"}
                  @change=${() => {
                    state._gcCreateMode = "broadcast";
                  }}
                />
                ${t("group.mode.broadcast")} — ${t("group.mode.broadcastDesc")}
              </label>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <span class="selected-count">
            ${t("group.create.selected", { count: selectedCount })}
          </span>
          <button
            class="btn btn--primary"
            ?disabled=${selectedCount === 0 || !hasAssistant}
            @click=${() => handleCreateGroup(state)}
          >
            ${t("group.create.confirm")}
          </button>
        </div>
      </div>
    </div>
  `;
}
```

### 4.9 群聊信息面板 (`components/group-info-panel.ts`)

```typescript
/**
 * 群聊信息侧面板（右侧滑出）。
 *
 * 结构：
 * ┌─────────────────┐
 * │ 群名称（可编辑）  │
 * ├─────────────────┤
 * │ 消息模式切换      │
 * ├─────────────────┤
 * │ 群公告编辑        │
 * ├─────────────────┤
 * │ 群 Skill 管理     │
 * ├─────────────────┤
 * │ 成员列表          │
 * │ · Owner (创建者)  │
 * │ · Agent A (助手)  │  [更换] [编辑职责]
 * │ · Agent B (成员)  │  [移除] [编辑职责]
 * │ [邀请成员]        │
 * ├─────────────────┤
 * │ 高级设置          │
 * │ · historyLimit    │
 * │ · maxRounds       │
 * │ · maxConsecutive  │
 * │ · compaction      │
 * ├─────────────────┤
 * │ [解散群聊]        │  (危险操作)
 * └─────────────────┘
 */
export function renderGroupInfoPanel(state: AppViewState, meta: GroupSessionEntry): TemplateResult {
  return html`
    <aside class="group-info-panel">
      <div class="panel-header">
        <h3>${t("group.info.title")}</h3>
        <button
          @click=${() => {
            state.groupInfoPanelOpen = false;
          }}
        >
          ×
        </button>
      </div>

      <div class="panel-body">
        ${renderGroupNameEditor(state, meta)} ${renderMessageModeSwitch(state, meta)}
        ${renderAnnouncementEditor(state, meta)} ${renderGroupSkillsManager(state, meta)}
        ${renderMemberList(state, meta)} ${renderAdvancedSettings(state, meta)}
        ${renderDangerZone(state, meta)}
      </div>
    </aside>
  `;
}
```

### 4.10 职责提示词编辑器 (`components/role-prompt-editor.ts`)

```typescript
/**
 * 职责提示词编辑模态框。
 *
 * 功能：
 * - 显示当前 Agent 名称和角色
 * - 多行文本编辑区（最大 2000 字符）
 * - 恢复默认按钮
 * - 保存按钮
 * - 字符计数显示
 */
export function renderRolePromptEditor(state: AppViewState): TemplateResult {
  const target = state.rolePromptEditTarget;
  if (!target) return html`${nothing}`;

  const { groupId, agentId } = target;
  const meta = state.activeGroupMeta;
  if (!meta) return html`${nothing}`;

  const member = meta.members.find((m) => m.agentId === agentId);
  const existing = meta.memberRolePrompts?.find((p) => p.agentId === agentId);
  const defaultPrompt =
    member?.role === "assistant" ? DEFAULT_ASSISTANT_ROLE_PROMPT : DEFAULT_MEMBER_ROLE_PROMPT;

  return html`
    <div class="modal-overlay" @click=${() => closeRolePromptEditor(state)}>
      <div class="modal-content modal-content--lg" @click=${(e: Event) => e.stopPropagation()}>
        <div class="modal-header">
          <h3>${t("group.rolePrompt.title")}</h3>
          <button class="modal-close" @click=${() => closeRolePromptEditor(state)}>×</button>
        </div>

        <div class="modal-body">
          <div class="role-prompt-meta">
            <span class="agent-name">${resolveAgentName(agentId)}</span>
            <span class="agent-role badge"
              >${member?.role === "assistant"
                ? t("group.role.assistant")
                : t("group.role.member")}</span
            >
          </div>

          <textarea
            class="role-prompt-textarea"
            maxlength="2000"
            rows="12"
            .value=${state._rpEditContent ?? existing?.rolePrompt ?? defaultPrompt}
            @input=${(e: InputEvent) => {
              state._rpEditContent = (e.target as HTMLTextAreaElement).value;
            }}
          ></textarea>

          <div class="role-prompt-footer">
            <span class="char-count"> ${(state._rpEditContent ?? "").length} / 2000 </span>
          </div>
        </div>

        <div class="modal-footer">
          <button
            class="btn btn--ghost"
            @click=${() => {
              state._rpEditContent = defaultPrompt;
            }}
          >
            ${t("group.rolePrompt.restoreDefault")}
          </button>
          <button
            class="btn btn--primary"
            @click=${() => handleSaveRolePrompt(state, groupId, agentId)}
          >
            ${t("group.rolePrompt.save")}
          </button>
        </div>
      </div>
    </div>
  `;
}
```

---

## 5. WebSocket 事件处理

### 5.1 事件路由扩展

**修改 `app-gateway.ts`**:

```typescript
export function handleGatewayEventUnsafe(host: OpenClawApp, evt: GatewayEvent) {
  switch (evt.event) {
    // ... existing handlers ...
    case "agent":
      handleAgentEvent(host, evt.payload);
      break;
    case "chat":
      handleChatEvent(host, evt.payload);
      break;

    // ─── 新增群聊事件 ───
    case "group.stream":
      handleGroupStreamEvent(host, evt.payload);
      break;
    case "group.message":
      handleGroupMessageEvent(host, evt.payload);
      break;
    case "group.system":
      handleGroupSystemEvent(host, evt.payload);
      break;
    case "group.members_updated":
      handleGroupMembersUpdated(host, evt.payload);
      break;
  }
}
```

### 5.2 群聊事件处理器

```typescript
// ui/src/ui/controllers/group-chat.ts

/**
 * 处理 group.stream 事件。
 * 核心：维护 activeStreams Map，支持多流并行。
 */
export function handleGroupStreamEvent(host: OpenClawApp, payload: GroupStreamPayload): void {
  const {
    groupId,
    runId,
    agentId,
    agentName,
    state: streamState,
    content,
    message,
    error,
  } = payload;

  // 仅处理当前活跃群聊的事件
  if (host.activeGroupId !== groupId || !host.groupChatState) return;

  const gcs = host.groupChatState;

  switch (streamState) {
    case "delta": {
      let stream = gcs.activeStreams.get(runId);
      if (!stream) {
        // 新流开始
        stream = {
          runId,
          agentId,
          agentName,
          text: "",
          segments: [],
          startedAt: Date.now(),
          status: "streaming",
          toolCalls: [],
        };
      }
      stream.text += content ?? "";
      stream.status = "streaming";
      gcs.activeStreams.set(runId, stream);
      break;
    }

    case "final": {
      // 流完成：添加最终消息到列表，移除活跃流
      if (message) {
        gcs.messages.push(message);
      }
      gcs.activeStreams.delete(runId);
      break;
    }

    case "error": {
      const stream = gcs.activeStreams.get(runId);
      if (stream) {
        stream.status = "error";
      }
      // 3 秒后自动移除错误流
      setTimeout(() => {
        gcs.activeStreams.delete(runId);
        host.requestUpdate();
      }, 3000);
      break;
    }

    case "aborted": {
      gcs.activeStreams.delete(runId);
      break;
    }
  }

  // 触发 Lit 响应式更新
  host.requestUpdate();
}

/**
 * 处理 group.message 事件。
 * 非流式的最终消息（如 Owner 消息、系统消息）。
 */
export function handleGroupMessageEvent(
  host: OpenClawApp,
  payload: { groupId: string; message: GroupChatMessage },
): void {
  if (host.activeGroupId !== payload.groupId || !host.groupChatState) return;

  const gcs = host.groupChatState;

  // 去重（避免乐观插入的消息重复）
  if (!gcs.messages.some((m) => m.id === payload.message.id)) {
    gcs.messages.push(payload.message);
    gcs.messages.sort((a, b) => (a.serverSeq ?? 0) - (b.serverSeq ?? 0));
  }

  host.requestUpdate();
}

/**
 * 处理 group.system 事件。
 * 成员变更、模式切换、公告变更等。
 */
export function handleGroupSystemEvent(
  host: OpenClawApp,
  payload: { groupId: string; event: string; data: unknown },
): void {
  switch (payload.event) {
    case "member_added":
    case "member_removed":
    case "assistant_changed":
      refreshGroupMeta(host, payload.groupId);
      break;
    case "mode_changed":
    case "announcement_changed":
    case "skills_changed":
      refreshGroupMeta(host, payload.groupId);
      break;
  }
}
```

### 5.3 流式更新节流

复用现有 chat stream 的节流策略（50ms 间隔），但按 `runId` 独立节流：

```typescript
const GROUP_STREAM_THROTTLE_MS = 50;
const streamThrottles = new Map<string, number>(); // runId → lastFlushTime

function throttledStreamUpdate(host: OpenClawApp, runId: string, updater: () => void): void {
  const now = Date.now();
  const last = streamThrottles.get(runId) ?? 0;

  if (now - last >= GROUP_STREAM_THROTTLE_MS) {
    updater();
    streamThrottles.set(runId, now);
    host.requestUpdate();
  } else {
    // 缓冲，下一个 tick 刷新
    scheduleFlush(runId, updater, host);
  }
}
```

---

## 6. RPC 调用封装 (`controllers/group-chat.ts`)

```typescript
import type { GatewayBrowserClient } from "../gateway.js";
import type { GroupSessionEntry, GroupChatMessage } from "../../types.js";

export class GroupChatController {
  constructor(private client: GatewayBrowserClient) {}

  // ─── CRUD ───

  async createGroup(params: {
    name?: string;
    members: Array<{ agentId: string; role: "assistant" | "member" }>;
    messageMode?: "unicast" | "broadcast";
  }): Promise<{ groupId: string }> {
    return this.client.request("group.create", params);
  }

  async listGroups(): Promise<GroupSessionEntry[]> {
    return this.client.request("group.list", {});
  }

  async getGroupInfo(groupId: string): Promise<GroupSessionEntry> {
    return this.client.request("group.info", { groupId });
  }

  async deleteGroup(groupId: string): Promise<void> {
    await this.client.request("group.delete", { groupId });
  }

  // ─── 成员管理 ───

  async addMembers(groupId: string, members: Array<{ agentId: string }>): Promise<void> {
    await this.client.request("group.addMembers", { groupId, members });
  }

  async removeMembers(groupId: string, agentIds: string[]): Promise<void> {
    await this.client.request("group.removeMembers", { groupId, agentIds });
  }

  async setAssistant(groupId: string, agentId: string): Promise<void> {
    await this.client.request("group.setAssistant", { groupId, agentId });
  }

  // ─── 配置 ───

  async setMessageMode(groupId: string, mode: "unicast" | "broadcast"): Promise<void> {
    await this.client.request("group.setMessageMode", { groupId, mode });
  }

  async setAnnouncement(groupId: string, content: string): Promise<void> {
    await this.client.request("group.setAnnouncement", { groupId, content });
  }

  async setSkills(groupId: string, skills: string[]): Promise<void> {
    await this.client.request("group.setSkills", { groupId, skills });
  }

  async setMemberRolePrompt(groupId: string, agentId: string, rolePrompt: string): Promise<void> {
    await this.client.request("group.setMemberRolePrompt", { groupId, agentId, rolePrompt });
  }

  // ─── 消息 ───

  async sendMessage(params: {
    groupId: string;
    message: string;
    mentions?: string[];
    clientMessageId?: string;
  }): Promise<{ messageId: string }> {
    return this.client.request("group.send", params);
  }

  async loadHistory(groupId: string, limit?: number, before?: number): Promise<GroupChatMessage[]> {
    return this.client.request("group.history", { groupId, limit, before });
  }

  async abort(groupId: string, runId?: string): Promise<void> {
    await this.client.request("group.abort", { groupId, runId });
  }
}
```

---

## 7. 样式设计

### 7.1 CSS 变量

```css
/* 群聊主题变量 */
:root {
  --group-msg-gap: 12px;
  --group-avatar-size: 32px;
  --group-bubble-max-width: 70%;
  --group-system-color: var(--color-text-muted);
  --group-mention-bg: rgba(59, 130, 246, 0.15);
  --group-mention-color: #3b82f6;
  --stream-indicator-color: #10b981;
  --stream-bubble-border: 1px solid var(--color-border);
  --parallel-streams-gap: 8px;
}
```

### 7.2 关键样式类

```css
/* 群聊消息布局 */
.group-msg {
  display: flex;
  gap: 8px;
  padding: 4px 16px;
  align-items: flex-start;
}
.group-msg--owner {
  flex-direction: row-reverse;
}
.group-msg--agent {
  flex-direction: row;
}
.group-msg--system {
  text-align: center;
  color: var(--group-system-color);
  font-size: 12px;
  padding: 8px 0;
}

/* Agent 颜色标识 */
.group-msg-sender {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 2px;
}

/* 并行流区域 */
.parallel-streams {
  display: flex;
  flex-direction: column;
  gap: var(--parallel-streams-gap);
  padding: 8px 16px;
}
.parallel-streams--grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
}

/* 流式气泡 */
.stream-bubble {
  border: var(--stream-bubble-border);
  border-radius: 12px;
  padding: 12px;
  border-left: 3px solid var(--agent-color);
  animation: fadeIn 0.3s ease-out;
}
.stream-indicator {
  color: var(--stream-indicator-color);
  animation: pulse 1s infinite;
}

/* @ 提及下拉框 */
.mention-dropdown {
  position: absolute;
  bottom: 100%;
  left: 0;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
  max-height: 200px;
  overflow-y: auto;
  z-index: 100;
}
.mention-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
}
.mention-item--selected {
  background: var(--color-bg-hover);
}

/* 群聊信息面板 */
.group-info-panel {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 320px;
  background: var(--color-bg-surface);
  border-left: 1px solid var(--color-border);
  box-shadow: var(--shadow-lg);
  overflow-y: auto;
  z-index: 50;
  animation: slideInRight 0.2s ease-out;
}

/* 动画 */
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes slideInRight {
  from {
    transform: translateX(100%);
  }
  to {
    transform: translateX(0);
  }
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}
```

---

## 8. 路由与视图切换

### 8.1 视图路由逻辑

**修改 `app-render.ts`**:

```typescript
function renderMainContent(state: AppViewState): TemplateResult {
  // 如果有活跃群聊，渲染群聊视图
  if (state.activeGroupId) {
    return renderGroupChatView(state);
  }

  // 否则按原有逻辑渲染
  switch (state.activeTab) {
    case "chat":
      return renderChatView(state);
    case "agents":
      return renderAgentsView(state);
    // ... existing cases
  }
}
```

### 8.2 视图切换

```typescript
/**
 * 切换到群聊视图。
 * 清除单聊选中状态，加载群聊数据。
 */
export async function switchToGroupChat(state: AppViewState, groupId: string): Promise<void> {
  // 清除单聊状态
  state.activeTab = null; // 不选中任何 tab

  // 设置群聊状态
  state.activeGroupId = groupId;

  // 加载群聊元数据
  const controller = new GroupChatController(state.client!);
  state.activeGroupMeta = await controller.getGroupInfo(groupId);

  // 初始化消息状态
  state.groupChatState = {
    groupId,
    messages: [],
    messagesLoading: true,
    activeStreams: new Map(),
    sending: false,
    draftMessage: "",
    draftMentions: [],
    lastError: null,
  };

  // 加载历史消息
  const messages = await controller.loadHistory(groupId);
  state.groupChatState.messages = messages;
  state.groupChatState.messagesLoading = false;
}

/**
 * 从群聊切回单聊。
 */
export function switchBackToChat(state: AppViewState): void {
  state.activeGroupId = null;
  state.activeGroupMeta = null;
  state.groupChatState = null;
  state.groupInfoPanelOpen = false;
  state.activeTab = "chat";
}
```

---

## 9. 性能优化

### 9.1 流式渲染优化

| 优化点        | 策略                                      |
| ------------- | ----------------------------------------- |
| 多流同时更新  | 每个 `runId` 独立 50ms 节流               |
| Markdown 渲染 | 仅渲染最后一个活跃段，已完成段缓存 HTML   |
| DOM 更新      | 使用 `repeat` 指令的 key 避免不必要的重建 |
| 滚动          | 仅当用户在底部时自动滚动                  |
| 大消息列表    | 虚拟滚动（> 200 条消息时启用）            |

### 9.2 内存管理

```typescript
// 完成的流及时清理
function cleanupCompletedStreams(gcs: GroupChatState): void {
  for (const [runId, stream] of gcs.activeStreams) {
    if (stream.status === "final" || stream.status === "aborted") {
      gcs.activeStreams.delete(runId);
    }
  }
}

// 节流 Map 清理
function cleanupThrottles(): void {
  const now = Date.now();
  for (const [runId, time] of streamThrottles) {
    if (now - time > 30_000) {
      // 30s 无更新的条目清理
      streamThrottles.delete(runId);
    }
  }
}
```

---

## 10. 对现有代码的改动清单

| 文件                     | 改动类型 | 改动量    | 说明                       |
| ------------------------ | -------- | --------- | -------------------------- |
| `app-view-state.ts`      | 微改     | ~20 行    | 新增群聊状态字段           |
| `app-render.ts`          | 微改     | ~15 行    | 主内容区增加群聊视图路由   |
| `app-render.helpers.ts`  | 微改     | ~50 行    | 导航栏增加群聊列表区块     |
| `app-gateway.ts`         | 微改     | ~20 行    | 事件路由增加 group.\* 分支 |
| `navigation.ts`          | 微改     | ~5 行     | 增加群聊导航相关常量       |
| `chat/grouped-render.ts` | 微改     | ~10 行    | 扩展头像渲染支持自定义参数 |
| `i18n/en.ts` / `zh.ts`   | 微改     | ~40 行    | 增加群聊相关翻译文案       |
| **新增文件总计**         | 新增     | ~8 个文件 | 约 2000 行新代码           |

**改动原则**：

- 现有文件仅增加条件分支，不修改已有逻辑
- 新功能完全在新文件中实现
- 共享样式通过 CSS 变量扩展，不覆盖已有样式
