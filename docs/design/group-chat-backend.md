# 多 Agent 群聊 — 后端详细设计

> **关联需求**: [multi-agent-group-chat.md](./multi-agent-group-chat.md)
> **版本**: v1.0
> **日期**: 2026-03-04

---

## 1. 模块总览

```
src/group-chat/
├── types.ts                 # 类型定义（本文档 §2）
├── group-store.ts           # 群聊元数据 CRUD（§3）
├── group-session-key.ts     # SessionKey 解析 group:<id>（§4）
├── transcript.ts            # Transcript 读写 + 写锁（§5）
├── message-dispatch.ts      # 消息分发引擎（§6）
├── agent-trigger.ts         # Agent 推理触发（§7）
├── parallel-stream.ts       # 并行流管理（§8）
├── anti-loop.ts             # 防循环机制（§9）
├── context-builder.ts       # 上下文构建（见 skill-context.md）
├── compaction.ts            # 上下文压缩（见 skill-context.md）
├── tool-policy.ts           # 只读工具策略（见 skill-context.md）
├── role-prompt.ts           # 职责提示词管理（见 skill-context.md）
├── announcement.ts          # 群公告管理
├── group-skills.ts          # 群 Skill 管理
└── index.ts                 # 模块导出

src/gateway/server-methods/
└── group.ts                 # group.* RPC handler（§10）

src/gateway/protocol/schema/
└── group.ts                 # TypeBox 参数 Schema（§11）
```

---

## 2. 类型定义 (`types.ts`)

### 2.1 群聊元数据

```typescript
import type { MessageSender, GroupChatMessage } from "./message-types.js";

// ─── 群成员 ───
export type GroupMemberRole = "assistant" | "member";

export type GroupMember = {
  agentId: string;
  role: GroupMemberRole;
  joinedAt: number; // epoch ms
};

// ─── 职责提示词 ───
export type GroupMemberRolePrompt = {
  agentId: string;
  rolePrompt: string; // 自定义，空字符串则使用默认
  updatedAt?: number;
};

// ─── 上下文压缩配置 ───
export type GroupCompactionConfig = {
  enabled: boolean; // default true
  maxHistoryShare: number; // default 0.5
  reserveTokensFloor: number; // default 20_000
};

// ─── 群聊 Session 条目 ───
export type GroupSessionEntry = {
  groupId: string; // UUID
  groupName?: string; // 不设置则自动生成
  messageMode: "unicast" | "broadcast";
  members: GroupMember[];
  memberRolePrompts: GroupMemberRolePrompt[];
  announcement?: string; // 最大 2000 chars
  groupSkills: string[]; // Skill name 列表
  maxRounds: number; // default 10
  maxConsecutive: number; // default 3
  historyLimit: number; // default 50
  compaction?: GroupCompactionConfig;
  createdAt: number;
  updatedAt: number;
  label?: string; // 会话标签
  archived?: boolean; // 已解散
};

// ─── 群聊索引条目（index.json 中的精简形式）───
export type GroupIndexEntry = {
  groupId: string;
  groupName?: string;
  updatedAt: number;
  archived?: boolean;
};
```

### 2.2 消息类型

```typescript
// ─── 消息发送者 ───
export type MessageSender = {
  type: "owner" | "agent";
  agentId?: string; // type === "agent" 时必填
  agentName?: string; // UI 显示用
};

// ─── 群聊消息 ───
export type GroupChatMessage = {
  id: string; // UUID
  groupId: string;
  role: "user" | "assistant" | "system";
  content: string;
  sender: MessageSender;
  mentions?: string[]; // agentId[]
  replyTo?: string; // 引用的消息 ID
  timestamp: number; // epoch ms
  serverSeq?: number; // 服务端单调递增序号，用于多端排序一致性
};
```

> **设计决策**: `sender` 不再重复携带 `groupId`（消息根字段已有），仅保留身份字段。

### 2.3 分发相关类型

```typescript
// ─── 消息分发结果 ───
export type DispatchTarget = {
  agentId: string;
  agentName?: string;
  role: GroupMemberRole;
};

export type DispatchResult = {
  targets: DispatchTarget[];
  mode: "unicast" | "broadcast" | "mention";
};

// ─── 对话链状态 ───
export type ConversationChainState = {
  originMessageId: string; // Owner 发送的原始消息 ID
  roundCount: number; // 当前轮次
  agentTriggerCounts: Map<string, number>; // agentId → 连续触发次数
  lastTriggeredAgentId?: string;
};

// ─── 并行推理 Run ───
export type GroupAgentRun = {
  runId: string;
  groupId: string;
  agentId: string;
  agentName: string;
  status: "running" | "completed" | "error" | "aborted";
  startedAt: number;
  completedAt?: number;
};
```

---

## 3. 群聊存储层 (`group-store.ts`)

### 3.1 存储结构

```
~/.openclaw/group-chats/
├── index.json                    # GroupIndexEntry[]
├── <groupId>/
│   ├── meta.json                 # GroupSessionEntry
│   ├── transcript.jsonl          # 消息记录
│   └── compaction-summary.json   # 压缩摘要（可选）
```

### 3.2 核心接口

```typescript
import { GroupSessionEntry, GroupIndexEntry, GroupMember } from "./types.js";

// ─── 路径解析 ───

/** 群聊存储根目录 */
export function resolveGroupChatsDir(): string;
// → path.join(resolveOpenClawDir(), "group-chats")

/** 单个群聊目录 */
export function resolveGroupDir(groupId: string): string;
// → path.join(resolveGroupChatsDir(), groupId)

/** 群聊 index.json 路径 */
export function resolveGroupIndexPath(): string;

/** 群聊 meta.json 路径 */
export function resolveGroupMetaPath(groupId: string): string;

/** 群聊 transcript.jsonl 路径 */
export function resolveGroupTranscriptPath(groupId: string): string;

// ─── 索引操作（带文件锁）───

/**
 * 加载群聊索引列表。
 * 复用 session store 的缓存策略：45s TTL + mtime 变化检测。
 */
export function loadGroupIndex(): GroupIndexEntry[];

/**
 * 更新群聊索引。
 * 使用原子写入（temp file + rename）+ 内存写锁。
 */
export async function updateGroupIndex(
  mutator: (index: GroupIndexEntry[]) => GroupIndexEntry[],
): Promise<void>;

// ─── 群聊 CRUD ───

/**
 * 创建群聊。
 * 1. 生成 groupId (UUID)
 * 2. 创建目录结构
 * 3. 写入 meta.json
 * 4. 初始化空 transcript.jsonl（写入 session header）
 * 5. 更新 index.json
 */
export async function createGroup(params: {
  name?: string;
  members: Array<{ agentId: string; role: "assistant" | "member" }>;
  messageMode?: "unicast" | "broadcast";
}): Promise<GroupSessionEntry>;

/**
 * 读取群聊元数据。
 * 带 30s TTL 内存缓存。
 */
export function loadGroupMeta(groupId: string): GroupSessionEntry | null;

/**
 * 原子更新群聊元数据。
 * 加锁 → 重读 → mutate → 写入 → 更新 index.json updatedAt。
 */
export async function updateGroupMeta(
  groupId: string,
  mutator: (meta: GroupSessionEntry) => GroupSessionEntry,
): Promise<GroupSessionEntry>;

/**
 * 解散群聊（标记 archived，不物理删除）。
 */
export async function archiveGroup(groupId: string): Promise<void>;

/**
 * 物理删除群聊（用于永久清理）。
 */
export async function deleteGroup(groupId: string): Promise<void>;
```

### 3.3 写锁机制

复用现有 `withSessionStoreLock` 的设计模式：

```typescript
// 内存队列锁，per-groupId 粒度
const groupLocks = new Map<string, Promise<void>>();

export async function withGroupLock<T>(groupId: string, fn: () => Promise<T>): Promise<T> {
  // 排队等待前序操作完成
  const prev = groupLocks.get(groupId) ?? Promise.resolve();
  let resolve: () => void;
  const next = new Promise<void>((r) => {
    resolve = r;
  });
  groupLocks.set(groupId, next);

  await prev;
  try {
    return await fn();
  } finally {
    resolve!();
    if (groupLocks.get(groupId) === next) {
      groupLocks.delete(groupId);
    }
  }
}
```

### 3.4 缓存策略

| 数据               | 缓存方式               | TTL | 失效条件                  |
| ------------------ | ---------------------- | --- | ------------------------- |
| `index.json`       | 内存 Map               | 45s | mtime 变化 / 写操作后清除 |
| `meta.json`        | 内存 Map (per groupId) | 30s | mtime 变化 / 写操作后清除 |
| `transcript.jsonl` | 不缓存                 | -   | 每次读取从磁盘            |

---

## 4. SessionKey (`group-session-key.ts`)

### 4.1 格式

```
group:<groupId>
```

与现有 `agent:<agentId>:<rest>` 平行。

### 4.2 接口

```typescript
export const GROUP_SESSION_KEY_PREFIX = "group:";

export function isGroupSessionKey(key: string): boolean {
  return key.startsWith(GROUP_SESSION_KEY_PREFIX);
}

export function buildGroupSessionKey(groupId: string): string {
  return `${GROUP_SESSION_KEY_PREFIX}${groupId}`;
}

export function parseGroupSessionKey(key: string): { groupId: string } | null {
  if (!isGroupSessionKey(key)) return null;
  const groupId = key.slice(GROUP_SESSION_KEY_PREFIX.length);
  return groupId ? { groupId } : null;
}
```

### 4.3 与现有 SessionKey 体系的关系

```
SessionKey
├── agent:<agentId>:<rest>     ← 现有单聊
│   ├── agent:main:main
│   ├── agent:main:direct:<peerId>
│   ├── agent:main:telegram:group:<id>
│   └── ...
└── group:<groupId>            ← 新增群聊
    └── group:550e8400-...
```

- `parseAgentSessionKey()` 不需要修改，`group:*` 会被归类为 `"missing"` shape（不是 agent session）
- 路由层需要新增 `isGroupSessionKey()` 判断分支

---

## 5. Transcript (`transcript.ts`)

### 5.1 文件格式

复用现有 JSONL 格式，新增群聊专有字段：

```jsonl
{"type":"session","version":"1.0","id":"<groupId>","timestamp":"2026-03-04T00:00:00.000Z","sessionType":"group"}
{"id":"msg_1","groupId":"...","role":"user","content":"...","sender":{"type":"owner"},"timestamp":1709510400000,"serverSeq":1}
{"id":"msg_2","groupId":"...","role":"assistant","content":"...","sender":{"type":"agent","agentId":"agent-a","agentName":"Agent A"},"timestamp":1709510401000,"serverSeq":2}
{"id":"msg_3","groupId":"...","role":"system","content":"Agent C 已加入群聊","timestamp":1709510402000,"serverSeq":3}
```

### 5.2 核心接口

```typescript
import { GroupChatMessage } from "./types.js";

// ─── serverSeq 管理 ───
// 每个群聊维护单调递增的 serverSeq
const seqCounters = new Map<string, number>();

export function nextServerSeq(groupId: string): number;

// ─── 读取 ───

/**
 * 读取群聊历史消息。
 * @param limit  最大条数，默认 50
 * @param before 时间戳上限（分页用）
 */
export function readGroupMessages(
  groupId: string,
  limit?: number,
  before?: number,
): GroupChatMessage[];

/**
 * 获取 Transcript 快照（用于并行推理的上下文冻结）。
 * 返回当前时刻的消息列表副本。
 */
export function getTranscriptSnapshot(groupId: string): GroupChatMessage[];

// ─── 写入（带写锁）───

/**
 * 追加单条消息到 transcript.jsonl。
 * 自动分配 serverSeq。
 * 使用 withGroupLock 保证并发安全。
 */
export async function appendGroupMessage(
  groupId: string,
  message: Omit<GroupChatMessage, "serverSeq">,
): Promise<GroupChatMessage>;

/**
 * 追加系统消息。
 */
export async function appendSystemMessage(
  groupId: string,
  content: string,
): Promise<GroupChatMessage>;

// ─── Token 估算 ───

/**
 * 估算消息列表的 Token 数（复用 compaction.ts 的 estimateMessagesTokens）。
 */
export function estimateGroupTranscriptTokens(messages: GroupChatMessage[]): number;
```

### 5.3 写锁与并发

并行推理时多个 Agent 同时完成回复，需要并发写入 transcript：

```
Agent A 完成  ──┐
Agent B 完成  ──┼── withGroupLock(groupId) → 排队写入
Agent C 完成  ──┘
```

- `withGroupLock` 保证同一 groupId 的写操作串行化
- 每条消息分配单调递增的 `serverSeq`
- 写入顺序 = 完成顺序（先完成先写入）

### 5.4 Transcript 维护

参考现有 session transcript 的维护策略：

| 策略         | 阈值             | 行为                          |
| ------------ | ---------------- | ----------------------------- |
| 文件大小轮转 | 10MB             | 归档旧文件，创建新 transcript |
| 消息数提醒   | historyLimit × 2 | 建议触发 compaction           |

---

## 6. 消息分发引擎 (`message-dispatch.ts`)

### 6.1 核心职责

接收 `group.send` 请求，决定消息应该路由给哪些 Agent。

### 6.2 分发算法

```typescript
import { GroupSessionEntry, GroupChatMessage, DispatchResult } from "./types.js";

/**
 * 核心分发函数。
 *
 * 分发规则：
 * 1. 有 mentions → 仅路由到被 @ 的 Agent（mention 模式）
 * 2. 无 mentions + unicast → 路由到助手（unicast 模式）
 * 3. 无 mentions + broadcast → 路由到所有成员（broadcast 模式）
 *
 * 特殊规则：
 * - @ Owner 不触发推理（Owner 是人类）
 * - Agent 的 group_reply 消息也走此分发逻辑
 * - 被 @ 的 agentId 必须是当前群成员，否则忽略
 */
export function resolveDispatchTargets(
  meta: GroupSessionEntry,
  message: GroupChatMessage,
): DispatchResult {
  const { members, messageMode } = meta;
  const mentions = message.mentions?.filter((id) => members.some((m) => m.agentId === id)) ?? [];

  // 过滤掉 sender 自己（Agent 不应触发自己）
  const senderAgentId = message.sender.type === "agent" ? message.sender.agentId : undefined;

  if (mentions.length > 0) {
    // Mention 模式：仅 @ 到的 Agent
    const targets = members
      .filter((m) => mentions.includes(m.agentId) && m.agentId !== senderAgentId)
      .map((m) => ({ agentId: m.agentId, role: m.role }));
    return { targets, mode: "mention" };
  }

  if (messageMode === "unicast") {
    // 单播：仅助手
    const assistant = members.find((m) => m.role === "assistant");
    if (!assistant || assistant.agentId === senderAgentId) {
      return { targets: [], mode: "unicast" };
    }
    return {
      targets: [{ agentId: assistant.agentId, role: assistant.role }],
      mode: "unicast",
    };
  }

  // 广播：所有成员（排除 sender）
  const targets = members
    .filter((m) => m.agentId !== senderAgentId)
    .map((m) => ({ agentId: m.agentId, role: m.role }));
  return { targets, mode: "broadcast" };
}
```

### 6.3 分发流程

```
group.send 请求
      │
      ▼
┌─────────────────────────────┐
│ 1. 验证参数 + 权限           │
│ 2. 解析 sender               │
│    - owner: 来自 UI/API      │
│    - agent: 来自 group_reply │
│      → 校验 agent 属于群成员 │
│      → 校验来自内部调用路径  │
│ 3. 解析 mentions             │
│    - UI 传入 agentId 列表    │
│    - 校验成员存在性          │
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│ 4. 写入 Transcript           │
│    - appendGroupMessage()    │
│    - 分配 serverSeq          │
│ 5. 广播 group.message 事件   │
│    - WebSocket → UI          │
└─────────────────────────────┘
      │
      ▼
┌─────────────────────────────┐
│ 6. 执行分发                  │
│    resolveDispatchTargets()  │
│    → targets[]               │
└─────────────────────────────┘
      │
      ▼
┌──────────────────────────────────────────┐
│ 7. 触发 Agent 推理                        │
│    - mention/unicast → 串行触发           │
│    - broadcast → 并行触发所有 targets     │
│    → 每个 Agent 分配独立 runId            │
│    → 使用 Transcript 快照作为上下文       │
└──────────────────────────────────────────┘
```

### 6.4 Agent sender 安全校验

```typescript
/**
 * 校验 agent sender 的合法性。
 * 仅允许来自内部调用路径（group_reply tool execution context）。
 */
export function validateAgentSender(
  groupId: string,
  sender: MessageSender,
  callContext: { isInternalToolCall: boolean; runId?: string },
): void {
  if (sender.type !== "agent") return;

  // 必须来自内部 tool 调用
  if (!callContext.isInternalToolCall) {
    throw new Error("Agent sender requires internal tool call context");
  }

  // 必须是群成员
  const meta = loadGroupMeta(groupId);
  if (!meta) throw new Error(`Group ${groupId} not found`);

  const isMember = meta.members.some((m) => m.agentId === sender.agentId);
  if (!isMember) {
    throw new Error(`Agent ${sender.agentId} is not a member of group ${groupId}`);
  }
}
```

---

## 7. Agent 推理触发 (`agent-trigger.ts`)

### 7.1 核心职责

- 为被分发的 Agent 准备推理上下文
- 调用现有 `getReplyFromConfig()` 执行推理
- 管理 streaming 事件广播

### 7.2 触发接口

```typescript
import type { GatewayRequestContext } from "../gateway/server-methods/types.js";
import type { GroupChatMessage, GroupSessionEntry, GroupAgentRun } from "./types.js";

export type TriggerAgentParams = {
  groupId: string;
  agentId: string;
  meta: GroupSessionEntry;
  transcriptSnapshot: GroupChatMessage[];
  triggerMessage: GroupChatMessage; // 触发推理的消息
  chainState: ConversationChainState; // 对话链状态
  context: GatewayRequestContext; // 用于广播 WS 事件
  signal: AbortSignal; // 中止信号
};

export type TriggerAgentResult = {
  run: GroupAgentRun;
  replyMessage?: GroupChatMessage; // Agent 的直接回复
  groupReplyCalls: GroupReplyCall[]; // group_reply 工具调用
};

type GroupReplyCall = {
  message: string;
  mentions?: string[];
};

/**
 * 触发单个 Agent 的推理。
 *
 * 完整流程：
 * 1. 构建群聊上下文（context-builder.ts）
 * 2. 应用只读工具策略（tool-policy.ts）
 * 3. 注入群聊 Skill（group-chat-reply）
 * 4. 调用 getReplyFromConfig()
 * 5. 广播 group.stream 事件（delta/final/error）
 * 6. 拦截 group_reply 工具调用，转化为 group.send
 */
export async function triggerAgentReasoning(
  params: TriggerAgentParams,
): Promise<TriggerAgentResult>;
```

### 7.3 与现有 `getReplyFromConfig()` 的集成

不修改 `getReplyFromConfig()`，通过以下方式适配：

```typescript
async function triggerAgentReasoning(params: TriggerAgentParams) {
  const { groupId, agentId, meta, transcriptSnapshot, context, signal } = params;
  const runId = generateRunId();

  // 1. 构建群聊上下文（注入到 extraSystemPrompt）
  const extraSystemPrompt = buildGroupChatContext({
    meta,
    agentId,
    transcriptSnapshot,
  });

  // 2. 构建群聊 Tool Policy（只读策略）
  const groupToolPolicy = buildGroupChatToolPolicy();

  // 3. 构建 MsgContext（模拟消息上下文）
  const msgContext = buildGroupMsgContext({
    groupId,
    agentId,
    meta,
    transcriptSnapshot,
    extraSystemPrompt,
    groupToolPolicy,
  });

  // 4. 配置流式回调
  const replyOptions: GetReplyOptions = {
    signal,
    onAgentRunStart: (info) => {
      broadcastGroupStream(context, {
        groupId, runId, agentId,
        agentName: resolveAgentName(agentId, meta),
        state: "delta",
        content: "",
      });
    },
    onPartialReply: (delta) => {
      broadcastGroupStream(context, {
        groupId, runId, agentId,
        agentName: resolveAgentName(agentId, meta),
        state: "delta",
        content: delta.text,
      });
    },
    // ... onToolStart, onToolResult 等
  };

  // 5. 执行推理
  const result = await getReplyFromConfig({
    ctx: msgContext,
    cfg: loadConfig(),
    replyOptions,
  });

  // 6. 广播完成事件
  const replyMessage = await appendGroupMessage(groupId, {
    id: generateMessageId(),
    groupId,
    role: "assistant",
    content: result.text ?? "",
    sender: { type: "agent", agentId, agentName: resolveAgentName(agentId, meta) },
    timestamp: Date.now(),
  });

  broadcastGroupStream(context, {
    groupId, runId, agentId,
    agentName: resolveAgentName(agentId, meta),
    state: "final",
    message: replyMessage,
  });

  return { run: { runId, groupId, agentId, status: "completed", ... }, replyMessage };
}
```

### 7.4 group_reply 工具拦截

Agent 推理过程中调用 `group_reply` 工具时，需要拦截并转化为 `group.send`：

```typescript
/**
 * group_reply 工具执行器。
 * 在 Agent 推理的 tool execution context 中注册。
 *
 * 行为：
 * 1. 将 Agent 的回复作为新消息写入 transcript
 * 2. 通过 WS 推送 group.message 事件到 UI
 * 3. 如果有 mentions，递归触发被 @ Agent 的推理
 * 4. 如果无 mentions，仅写入，不触发后续推理
 */
export async function executeGroupReply(params: {
  groupId: string;
  senderAgentId: string;
  message: string;
  mentions?: string[];
  chainState: ConversationChainState;
  context: GatewayRequestContext;
  signal: AbortSignal;
}): Promise<{ messageId: string }>;
```

---

## 8. 并行流管理 (`parallel-stream.ts`)

### 8.1 核心职责

管理广播模式下多个 Agent 的并行推理。

### 8.2 接口

```typescript
import type { GatewayRequestContext } from "../gateway/server-methods/types.js";
import type { GroupChatMessage, GroupSessionEntry, ConversationChainState } from "./types.js";

/**
 * 广播模式下并行触发多个 Agent 推理。
 *
 * 关键设计：
 * - 所有 Agent 使用**同一份 Transcript 快照**作为上下文
 * - 各 Agent 独立推理，独立 runId
 * - 回复按完成顺序写入 Transcript
 * - 如果某个 Agent 的回复中 @ 了其他人，
 *   在该 Agent 完成后再触发（此时能看到已完成的回复）
 */
export async function broadcastToMembers(params: {
  groupId: string;
  meta: GroupSessionEntry;
  triggerMessage: GroupChatMessage;
  chainState: ConversationChainState;
  context: GatewayRequestContext;
  signal: AbortSignal;
}): Promise<{
  runs: GroupAgentRun[];
  pendingMentionTriggers: Array<{
    triggerMessage: GroupChatMessage;
    targets: string[];
  }>;
}> {
  const { groupId, meta, triggerMessage, chainState, context, signal } = params;

  // 获取分发快照
  const transcriptSnapshot = getTranscriptSnapshot(groupId);
  const targets = resolveDispatchTargets(meta, triggerMessage);

  // 并行触发所有 targets
  const runPromises = targets.targets.map(async (target) => {
    // 防循环检查
    if (!canTriggerAgent(chainState, target.agentId)) {
      return null;
    }

    return triggerAgentReasoning({
      groupId,
      agentId: target.agentId,
      meta,
      transcriptSnapshot,
      triggerMessage,
      chainState: { ...chainState, roundCount: chainState.roundCount + 1 },
      context,
      signal,
    });
  });

  const results = await Promise.allSettled(runPromises);

  // 收集完成的 runs 和待处理的 mention triggers
  const runs: GroupAgentRun[] = [];
  const pendingMentionTriggers: Array<{ triggerMessage: GroupChatMessage; targets: string[] }> = [];

  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      runs.push(result.value.run);
      // 收集 group_reply 中的 mentions
      for (const reply of result.value.groupReplyCalls) {
        if (reply.mentions?.length) {
          pendingMentionTriggers.push({
            triggerMessage: result.value.replyMessage!,
            targets: reply.mentions,
          });
        }
      }
    }
  }

  return { runs, pendingMentionTriggers };
}
```

### 8.3 WebSocket 事件广播

```typescript
import type { GatewayRequestContext } from "../gateway/server-methods/types.js";

export type GroupStreamPayload = {
  groupId: string;
  runId: string;
  agentId: string;
  agentName: string;
  agentAvatar?: string;
  state: "delta" | "final" | "error" | "aborted";
  content?: string; // delta 时的增量文本
  message?: GroupChatMessage; // final 时的完整消息
  error?: string; // error 时的错误信息
};

/**
 * 广播 group.stream 事件。
 * 使用现有的 context.broadcast() 机制。
 */
export function broadcastGroupStream(
  context: GatewayRequestContext,
  payload: GroupStreamPayload,
): void {
  context.broadcast("group.stream", payload);
}

/**
 * 广播 group.message 事件（非流式，最终消息）。
 */
export function broadcastGroupMessage(
  context: GatewayRequestContext,
  groupId: string,
  message: GroupChatMessage,
): void {
  context.broadcast("group.message", { groupId, message });
}

/**
 * 广播 group.system 事件（成员变更、模式切换等）。
 */
export function broadcastGroupSystem(
  context: GatewayRequestContext,
  groupId: string,
  event: string,
  data: unknown,
): void {
  context.broadcast("group.system", { groupId, event, data });
}
```

---

## 9. 防循环机制 (`anti-loop.ts`)

### 9.1 规则

| 规则                    | 默认值 | 配置字段              |
| ----------------------- | ------ | --------------------- |
| 最大轮次                | 10     | `meta.maxRounds`      |
| 同一 Agent 连续触发上限 | 3      | `meta.maxConsecutive` |

### 9.2 接口

```typescript
import type { ConversationChainState, GroupSessionEntry } from "./types.js";

/**
 * 检查是否可以触发指定 Agent。
 *
 * 检查顺序：
 * 1. 轮次限制：chainState.roundCount < meta.maxRounds
 * 2. 连续触发限制：该 Agent 的连续触发次数 < meta.maxConsecutive
 */
export function canTriggerAgent(
  chainState: ConversationChainState,
  agentId: string,
  meta: GroupSessionEntry,
): { allowed: boolean; reason?: string } {
  // 轮次检查
  if (chainState.roundCount >= meta.maxRounds) {
    return { allowed: false, reason: "max_rounds_exceeded" };
  }

  // 连续触发检查
  const count = chainState.agentTriggerCounts.get(agentId) ?? 0;
  if (count >= meta.maxConsecutive) {
    return { allowed: false, reason: "max_consecutive_exceeded" };
  }

  return { allowed: true };
}

/**
 * 更新对话链状态。
 * 在 Agent 完成回复后调用。
 */
export function updateChainState(
  state: ConversationChainState,
  agentId: string,
): ConversationChainState {
  const newCounts = new Map(state.agentTriggerCounts);

  // 如果是同一个 Agent 连续触发，计数 +1
  if (state.lastTriggeredAgentId === agentId) {
    newCounts.set(agentId, (newCounts.get(agentId) ?? 0) + 1);
  } else {
    // 不同 Agent，重置该 Agent 的计数
    newCounts.set(agentId, 1);
  }

  return {
    ...state,
    roundCount: state.roundCount + 1,
    agentTriggerCounts: newCounts,
    lastTriggeredAgentId: agentId,
  };
}

/**
 * 创建新的对话链状态（Owner 发送新消息时）。
 */
export function createChainState(originMessageId: string): ConversationChainState {
  return {
    originMessageId,
    roundCount: 0,
    agentTriggerCounts: new Map(),
  };
}
```

---

## 10. RPC Handler (`src/gateway/server-methods/group.ts`)

### 10.1 方法清单

```typescript
import type { GatewayRequestHandlers } from "./types.js";

export const groupHandlers: GatewayRequestHandlers = {
  "group.create": handleGroupCreate,
  "group.list": handleGroupList,
  "group.info": handleGroupInfo,
  "group.delete": handleGroupDelete,
  "group.addMembers": handleGroupAddMembers,
  "group.removeMembers": handleGroupRemoveMembers,
  "group.setAssistant": handleGroupSetAssistant,
  "group.setMessageMode": handleGroupSetMessageMode,
  "group.setAnnouncement": handleGroupSetAnnouncement,
  "group.setSkills": handleGroupSetSkills,
  "group.setMemberRolePrompt": handleGroupSetMemberRolePrompt,
  "group.send": handleGroupSend,
  "group.history": handleGroupHistory,
  "group.abort": handleGroupAbort,
};
```

### 10.2 核心 Handler 伪代码

#### `group.create`

```typescript
async function handleGroupCreate({ params, respond, context }) {
  const { name, members, messageMode } = validateParams(params, GroupCreateSchema);

  // 校验至少一个 assistant
  const assistants = members.filter((m) => m.role === "assistant");
  if (assistants.length !== 1) {
    return respond({ ok: false, error: { message: "Exactly one assistant required" } });
  }

  // 校验 agentId 存在
  const agentList = await listAgents(loadConfig());
  for (const m of members) {
    if (!agentList.some((a) => a.id === m.agentId)) {
      return respond({ ok: false, error: { message: `Agent ${m.agentId} not found` } });
    }
  }

  const entry = await createGroup({ name, members, messageMode });
  respond({
    ok: true,
    payload: { groupId: entry.groupId, sessionKey: buildGroupSessionKey(entry.groupId) },
  });

  // 广播群聊创建事件
  broadcastGroupSystem(context, entry.groupId, "created", { entry });
}
```

#### `group.send`（核心）

```typescript
async function handleGroupSend({ params, respond, context }) {
  const { groupId, message, mentions, sender, clientMessageId } = validateParams(
    params,
    GroupSendSchema,
  );

  const meta = loadGroupMeta(groupId);
  if (!meta || meta.archived) {
    return respond({ ok: false, error: { message: "Group not found or archived" } });
  }

  // 幂等性检查
  if (clientMessageId) {
    const existing = findMessageByIdempotencyKey(groupId, clientMessageId);
    if (existing) {
      return respond({ ok: true, payload: { messageId: existing.id } });
    }
  }

  // 构建 sender（默认 owner）
  const resolvedSender: MessageSender = sender ?? { type: "owner" };

  // Agent sender 安全校验
  if (resolvedSender.type === "agent") {
    validateAgentSender(groupId, resolvedSender, {
      isInternalToolCall: params.__internal === true,
      runId: params.__runId,
    });
  }

  // @ 解析：仅接受 agentId，不接受 agentName
  const resolvedMentions = (mentions ?? []).filter((id) =>
    meta.members.some((m) => m.agentId === id),
  );

  // 构建消息
  const msg: Omit<GroupChatMessage, "serverSeq"> = {
    id: generateMessageId(),
    groupId,
    role: resolvedSender.type === "owner" ? "user" : "assistant",
    content: message,
    sender: resolvedSender,
    mentions: resolvedMentions.length > 0 ? resolvedMentions : undefined,
    timestamp: Date.now(),
  };

  // 写入 Transcript
  const savedMsg = await appendGroupMessage(groupId, msg);

  // 先响应 caller（ACK）
  respond({ ok: true, payload: { messageId: savedMsg.id } });

  // 广播消息到 UI
  broadcastGroupMessage(context, groupId, savedMsg);

  // 异步执行分发与推理
  const dispatch = resolveDispatchTargets(meta, savedMsg);

  if (dispatch.targets.length === 0) return;

  const chainState =
    resolvedSender.type === "owner" ? createChainState(savedMsg.id) : params.__chainState; // Agent 的 group_reply 传递 chainState

  const abortController = new AbortController();
  registerGroupAbort(groupId, savedMsg.id, abortController);

  try {
    if (dispatch.mode === "broadcast") {
      await broadcastToMembers({
        groupId,
        meta,
        triggerMessage: savedMsg,
        chainState,
        context,
        signal: abortController.signal,
      });
    } else {
      // unicast / mention: 逐个触发（串行）
      for (const target of dispatch.targets) {
        const check = canTriggerAgent(chainState, target.agentId, meta);
        if (!check.allowed) {
          await appendSystemMessage(groupId, `对话轮次已达上限 (${check.reason})`);
          break;
        }

        await triggerAgentReasoning({
          groupId,
          agentId: target.agentId,
          meta,
          transcriptSnapshot: getTranscriptSnapshot(groupId),
          triggerMessage: savedMsg,
          chainState,
          context,
          signal: abortController.signal,
        });
      }
    }
  } finally {
    unregisterGroupAbort(groupId, savedMsg.id);
  }
}
```

#### `group.abort`

```typescript
async function handleGroupAbort({ params, respond }) {
  const { groupId, runId } = validateParams(params, GroupAbortSchema);
  abortGroupRun(groupId, runId);
  respond({ ok: true });
}
```

### 10.3 注册到 Gateway

在 `src/gateway/server-methods.ts` 中新增引入：

```typescript
import { groupHandlers } from "./server-methods/group.js";

// 在 handlers 合并中加入
const handlers = {
  ...sessionsHandlers,
  ...chatHandlers,
  ...agentsHandlers,
  ...groupHandlers, // ← 新增
  // ...
};
```

在 `src/gateway/server-methods-list.ts` 的 `BASE_METHODS` 中新增：

```typescript
"group.create",
"group.list",
"group.info",
"group.delete",
"group.addMembers",
"group.removeMembers",
"group.setAssistant",
"group.setMessageMode",
"group.setAnnouncement",
"group.setSkills",
"group.setMemberRolePrompt",
"group.send",
"group.history",
"group.abort",
```

在 `GATEWAY_EVENTS` 中新增：

```typescript
"group.message",
"group.stream",
"group.system",
"group.members_updated",
```

---

## 11. 参数 Schema (`src/gateway/protocol/schema/group.ts`)

使用 TypeBox 定义参数验证（与现有 `schema/sessions.ts` 风格一致）：

```typescript
import { Type, type Static } from "@sinclair/typebox";

export const GroupCreateSchema = Type.Object({
  name: Type.Optional(Type.String({ maxLength: 100 })),
  members: Type.Array(
    Type.Object({
      agentId: Type.String(),
      role: Type.Union([Type.Literal("assistant"), Type.Literal("member")]),
    }),
    { minItems: 1, maxItems: 50 },
  ),
  messageMode: Type.Optional(Type.Union([Type.Literal("unicast"), Type.Literal("broadcast")])),
});

export const GroupSendSchema = Type.Object({
  groupId: Type.String({ format: "uuid" }),
  message: Type.String({ minLength: 1, maxLength: 100_000 }),
  mentions: Type.Optional(Type.Array(Type.String())),
  sender: Type.Optional(
    Type.Object({
      type: Type.Union([Type.Literal("owner"), Type.Literal("agent")]),
      agentId: Type.Optional(Type.String()),
      agentName: Type.Optional(Type.String()),
    }),
  ),
  clientMessageId: Type.Optional(Type.String()),
});

export const GroupIdSchema = Type.Object({
  groupId: Type.String({ format: "uuid" }),
});

export const GroupAddMembersSchema = Type.Object({
  groupId: Type.String({ format: "uuid" }),
  members: Type.Array(
    Type.Object({
      agentId: Type.String(),
      role: Type.Optional(Type.Literal("member")),
    }),
    { minItems: 1, maxItems: 50 },
  ),
});

export const GroupRemoveMembersSchema = Type.Object({
  groupId: Type.String({ format: "uuid" }),
  agentIds: Type.Array(Type.String(), { minItems: 1 }),
});

export const GroupSetAssistantSchema = Type.Object({
  groupId: Type.String({ format: "uuid" }),
  agentId: Type.String(),
});

export const GroupSetMessageModeSchema = Type.Object({
  groupId: Type.String({ format: "uuid" }),
  mode: Type.Union([Type.Literal("unicast"), Type.Literal("broadcast")]),
});

export const GroupSetAnnouncementSchema = Type.Object({
  groupId: Type.String({ format: "uuid" }),
  content: Type.String({ maxLength: 2000 }),
});

export const GroupSetSkillsSchema = Type.Object({
  groupId: Type.String({ format: "uuid" }),
  skills: Type.Array(Type.String()),
});

export const GroupSetMemberRolePromptSchema = Type.Object({
  groupId: Type.String({ format: "uuid" }),
  agentId: Type.String(),
  rolePrompt: Type.String({ maxLength: 2000 }),
});

export const GroupHistorySchema = Type.Object({
  groupId: Type.String({ format: "uuid" }),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 500, default: 50 })),
  before: Type.Optional(Type.Number()),
});

export const GroupAbortSchema = Type.Object({
  groupId: Type.String({ format: "uuid" }),
  runId: Type.Optional(Type.String()),
});
```

---

## 12. 中止管理

```typescript
// 群聊 abort controller 注册表
const groupAbortControllers = new Map<string, Map<string, AbortController>>();
// 外层 key = groupId, 内层 key = messageId

export function registerGroupAbort(
  groupId: string,
  messageId: string,
  controller: AbortController,
): void;

export function unregisterGroupAbort(groupId: string, messageId: string): void;

export function abortGroupRun(groupId: string, runId?: string): void {
  const controllers = groupAbortControllers.get(groupId);
  if (!controllers) return;

  if (runId) {
    // 中止特定 run
    controllers.get(runId)?.abort();
  } else {
    // 中止该群所有活跃 run
    for (const ctrl of controllers.values()) {
      ctrl.abort();
    }
    controllers.clear();
  }
}
```

---

## 13. 错误处理策略

| 场景                | 处理方式                                            |
| ------------------- | --------------------------------------------------- |
| Agent 推理超时      | AbortSignal 触发，广播 `group.stream` state=aborted |
| Agent 推理失败      | 广播 `group.stream` state=error，写入系统消息       |
| Transcript 写入失败 | 重试 1 次，仍失败则返回错误响应                     |
| 并行推理部分失败    | `Promise.allSettled` 收集结果，失败的广播 error     |
| 群聊不存在          | 返回 404 风格错误                                   |
| 非成员操作          | 返回 403 风格错误                                   |
| 防循环触发          | 写入系统消息通知，中止对话链                        |

---

## 14. 测试策略

| 测试类型 | 覆盖范围                                     | 文件             |
| -------- | -------------------------------------------- | ---------------- |
| 单元测试 | 分发算法、防循环、SessionKey 解析            | `*.test.ts`      |
| 集成测试 | group.send 端到端、并行推理、Transcript 读写 | `*.e2e.test.ts`  |
| 边界测试 | 50 成员广播、防循环极限、超长消息            | 在单元测试中覆盖 |

关键测试场景：

1. 单播模式无 @ → 仅助手收到
2. 广播模式无 @ → 所有成员并行收到
3. @ 指定 Agent → 仅被 @ 的收到
4. @ 不存在的 Agent → 忽略
5. Agent group_reply 带 mentions → 链式触发
6. 防循环：连续触发 3 次同一 Agent → 中止
7. 防循环：总轮次达到 10 → 中止
8. 并行写入 transcript → serverSeq 严格递增
9. Agent sender 伪造 → 拒绝
10. 群聊已归档 → 拒绝发送
