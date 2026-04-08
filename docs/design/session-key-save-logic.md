# Session Key 保存逻辑 — 完整技术文档

## 目录

1. [概述](#1-概述)
2. [Session Key 格式体系](#2-session-key-格式体系)
3. [普通对话 (DM) Session Key 生成与保存](#3-普通对话-dm-session-key-生成与保存)
4. [群聊 (Group Chat) Session Key 生成与保存](#4-群聊-group-chat-session-key-生成与保存)
5. [Session Store 持久化机制](#5-session-store-持久化机制)
6. [Session Entry 数据结构](#6-session-entry-数据结构)
7. [并发控制与锁机制](#7-并发控制与锁机制)
8. [Session 维护与生命周期管理](#8-session-维护与生命周期管理)
9. [两种场景对比分析](#9-两种场景对比分析)
10. [关键函数调用图](#10-关键函数调用图)

---

## 1. 概述

OpenClaw 使用分层的 session key 架构来唯一标识每个会话。系统通过 session key 将消息路由到正确的会话上下文，并将会话状态持久化到磁盘。

核心设计原则：

- **所有 session key 在存储前都会经过 `trim().toLowerCase()` 规范化**
- **所有写操作都通过 `withSessionStoreLock` 保护并发安全**
- **会话数据以 JSON 文件持久化到 `~/.openclaw/agents/<agentId>/sessions/sessions.json`**
- **普通对话和群聊使用完全不同的 session key 生成路径**

### 核心源文件索引

| 文件                                  | 职责                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/config/sessions/session-key.ts`  | Session key 派生入口（`resolveSessionKey`、`deriveSessionKey`）                      |
| `src/routing/session-key.ts`          | Session key 构建函数（`buildAgentMainSessionKey`、`buildAgentPeerSessionKey`）       |
| `src/config/sessions/store.ts`        | Session store 持久化核心（读/写/锁）                                                 |
| `src/config/sessions/types.ts`        | `SessionEntry` 类型定义和合并逻辑                                                    |
| `src/config/sessions/group.ts`        | 群聊 session key 解析（`resolveGroupSessionKey`）                                    |
| `src/config/sessions/metadata.ts`     | Session 元数据派生                                                                   |
| `src/config/sessions/paths.ts`        | Session 文件路径解析                                                                 |
| `src/group-chat/group-session-key.ts` | 群聊独立 session key 体系（`group:` 前缀）                                           |
| `src/gateway/session-utils.ts`        | Session key 规范化转换（`resolveSessionStoreKey`、`canonicalizeSessionKeyForAgent`） |
| `src/sessions/session-key-utils.ts`   | 底层 session key 解析工具                                                            |
| `src/channels/session.ts`             | Channel 层 session 记录入口                                                          |
| `src/agents/session-write-lock.ts`    | 文件锁实现                                                                           |

---

## 2. Session Key 格式体系

系统支持三种主要的 session key 格式前缀：

### 2.1 `agent:` 前缀 — 标准会话 key

格式：`agent:<agentId>:<rest>`

这是最常用的格式，适用于普通对话和通过 channel 路由的群聊。

```
agent:main:main                                          # 默认 DM 会话
agent:main:direct:<peerId>                               # per-peer DM
agent:main:discord:direct:<peerId>                       # per-channel-peer DM
agent:main:discord:acct123:direct:<peerId>               # per-account-channel-peer DM
agent:main:discord:group:<groupId>                       # Channel 路由群聊
agent:main:slack:channel:<channelId>                     # 频道聊天
agent:main:whatsapp:group:<groupId>:thread:<threadId>    # 群聊 + 线程
agent:main:group:<groupId>:main                          # Group Chat 模块群聊 (per-agent)
agent:main:group:<groupId>                               # Group Chat 模块群聊 (共享)
```

> **关于 Group Chat 模块 key 中出现的两个 agentId**（如 `agent:main:group:<groupId>:main`），
> 详见 [4.2.5 节](#425-group-chat-session-key-中两个-agentid-的含义)。

解析逻辑位于 `src/sessions/session-key-utils.ts`:

```typescript
// parseAgentSessionKey("agent:main:discord:group:12345")
// => { agentId: "main", rest: "discord:group:12345" }
```

### 2.2 `group:` 前缀 — 群聊初始 key（中间格式）

格式：`group:<groupId>` 或 `group:<groupId>:<agentId>`

这是群聊功能（group-chat 模块）生成的**初始格式** session key，用于 `group.create` RPC 返回值和 agent trigger 上下文。

```
group:abc123                   # 共享群聊 session（group.create 返回）
group:abc123:main              # 群聊中特定 agent 的 session（agent trigger 使用）
```

定义位于 `src/group-chat/group-session-key.ts`:

```typescript
export function buildGroupSessionKey(groupId: string, agentId?: string): string {
  if (agentId) {
    return `group:${groupId}:${agentId}`;
  }
  return `group:${groupId}`;
}
```

> **⚠️ 重要**：`group:` 前缀的 key 在**磁盘上的 sessions.json 中保持原始格式**，但当通过 `sessions.list` API 返回给前端时，会在 `loadCombinedSessionStoreForGateway` 中经过 `canonicalizeSessionKeyForAgent` **读取时规范化**为 `agent:` 前缀格式。规范化时使用的 agentId 是该 sessions.json 文件归属的 agent（即对话产生时的默认 agent）。例如（假设默认 agent 为 main）：
>
> - 磁盘存储：`group:abc123:main` → API 返回：`agent:main:group:abc123:main`
> - 磁盘存储：`group:abc123` → API 返回：`agent:main:group:abc123`
>
> 详见 [4.2.2 节](#422-session-key-的存储与展示两阶段转换关键环节)。

### 2.3 `global` — 全局会话

当 `session.scope` 配置为 `"global"` 时，所有消息共享一个 session key `"global"`。

### 2.4 规范化规则

所有 session key 在存储前都会执行规范化：

```typescript
// src/config/sessions/store.ts
export function normalizeStoreSessionKey(sessionKey: string): string {
  return sessionKey.trim().toLowerCase();
}
```

特殊规范化：Discord 的 `:dm:` 会被转换为 `:direct:`（见 `src/discord/session-key-normalization.ts`）。

显式 session key（`ctx.SessionKey`）也会经过 `normalizeExplicitSessionKey` 处理（`src/config/sessions/explicit-session-key-normalization.ts`）。

---

## 3. 普通对话 (DM) Session Key 生成与保存

### 3.1 生成链路

普通对话的 session key 生成遵循以下调用链：

```
消息到达
  ↓
resolveSessionKey(scope, ctx, mainKey?)     ← src/config/sessions/session-key.ts
  ↓
  ├─ [1] ctx.SessionKey 有值? → normalizeExplicitSessionKey(explicit, ctx)
  ├─ [2] deriveSessionKey(scope, ctx)
  │       ├─ scope === "global"? → "global"
  │       ├─ resolveGroupSessionKey(ctx) → 非空? → 返回群组 key (走群聊路径)
  │       └─ normalizeE164(ctx.From) || "unknown"
  ↓
  [非群聊] buildAgentMainSessionKey({ agentId: "main", mainKey })
  ↓
  结果: "agent:main:main"  (所有 DM 折叠到同一个 session)
```

**关键代码** (`src/config/sessions/session-key.ts`):

```typescript
export function resolveSessionKey(scope: SessionScope, ctx: MsgContext, mainKey?: string) {
  // 步骤 1: 检查显式 session key
  const explicit = ctx.SessionKey?.trim();
  if (explicit) {
    return normalizeExplicitSessionKey(explicit, ctx);
  }

  // 步骤 2: 派生 session key
  const raw = deriveSessionKey(scope, ctx);
  if (scope === "global") {
    return raw;
  }

  // 步骤 3: 构建规范化的 main session key
  const canonicalMainKey = normalizeMainKey(mainKey);
  const canonical = buildAgentMainSessionKey({
    agentId: DEFAULT_AGENT_ID, // "main"
    mainKey: canonicalMainKey, // "main"（默认）
  });

  // 步骤 4: 群聊检测
  const isGroup = raw.includes(":group:") || raw.includes(":channel:");
  if (!isGroup) {
    return canonical; // 所有非群聊 DM 折叠到 canonical key
  }
  return `agent:${DEFAULT_AGENT_ID}:${raw}`;
}
```

### 3.2 DM Scope 策略

`buildAgentPeerSessionKey` 支持四种 DM 会话隔离策略（`src/routing/session-key.ts`）：

| dmScope                    | 生成格式                                                | 说明                     |
| -------------------------- | ------------------------------------------------------- | ------------------------ |
| `main`（默认）             | `agent:<agentId>:<mainKey>`                             | 所有 DM 共享一个 session |
| `per-peer`                 | `agent:<agentId>:direct:<peerId>`                       | 每个发送者独立 session   |
| `per-channel-peer`         | `agent:<agentId>:<channel>:direct:<peerId>`             | 每个 channel+发送者 独立 |
| `per-account-channel-peer` | `agent:<agentId>:<channel>:<accountId>:direct:<peerId>` | 最细粒度隔离             |

```typescript
export function buildAgentPeerSessionKey(params: {
  agentId: string;
  mainKey?: string;
  channel: string;
  accountId?: string | null;
  peerKind?: ChatType | null;
  peerId?: string | null;
  identityLinks?: Record<string, string[]>;
  dmScope?: "main" | "per-peer" | "per-channel-peer" | "per-account-channel-peer";
}): string {
  const peerKind = params.peerKind ?? "direct";

  if (peerKind === "direct") {
    const dmScope = params.dmScope ?? "main";

    // Identity Links: 跨 channel 的 peer 身份合并
    let peerId = (params.peerId ?? "").trim();
    const linkedPeerId = dmScope === "main" ? null : resolveLinkedPeerId({...});
    if (linkedPeerId) peerId = linkedPeerId;
    peerId = peerId.toLowerCase();

    if (dmScope === "per-account-channel-peer" && peerId) {
      return `agent:${normalizeAgentId(params.agentId)}:${channel}:${accountId}:direct:${peerId}`;
    }
    if (dmScope === "per-channel-peer" && peerId) {
      return `agent:${normalizeAgentId(params.agentId)}:${channel}:direct:${peerId}`;
    }
    if (dmScope === "per-peer" && peerId) {
      return `agent:${normalizeAgentId(params.agentId)}:direct:${peerId}`;
    }
    // 默认 "main": 所有 DM 折叠
    return buildAgentMainSessionKey({ agentId: params.agentId, mainKey: params.mainKey });
  }

  // 非 direct (group/channel): agent:<agentId>:<channel>:<peerKind>:<peerId>
  return `agent:${normalizeAgentId(params.agentId)}:${channel}:${peerKind}:${peerId}`;
}
```

### 3.3 DM Session Key 保存流程

当一条 DM 消息到达时，保存流程如下：

```
[Channel 适配器收到消息]
  ↓
recordInboundSession(...)                    ← src/channels/session.ts
  ├─ normalizeSessionStoreKey(sessionKey)    # trim().toLowerCase()
  ├─ recordSessionMetaFromInbound(...)       # 记录 session 元数据
  │     ├─ updateSessionStore(storePath, mutator, opts)  ← src/config/sessions/store.ts
  │     │     ├─ withSessionStoreLock(storePath, ...)     # 获取锁
  │     │     ├─ loadSessionStore(storePath, {skipCache: true})  # 重新读取 JSON
  │     │     ├─ resolveSessionStoreEntry(...)            # 查找或创建 entry
  │     │     ├─ deriveSessionMetaPatch(ctx, ...)         # 派生元数据 patch
  │     │     ├─ mergeSessionEntryPreserveActivity(...)   # 合并但不刷新活动时间戳
  │     │     ├─ store[normalizedKey] = next              # 写入 store 对象
  │     │     └─ saveSessionStoreUnlocked(...)            # 持久化到磁盘
  │     └─ [异步 fire-and-forget: .catch(onRecordError)]
  │
  └─ updateLastRoute(...)                    # 更新最后路由信息
        ├─ withSessionStoreLock(storePath, ...)
        ├─ loadSessionStore(storePath)
        ├─ resolveSessionStoreEntry(...)
        ├─ 合并 deliveryContext (channel/to/accountId/threadId)
        ├─ deriveSessionMetaPatch(...) (如有 ctx)
        ├─ mergeSessionEntry(existing, patch)
        └─ persistResolvedSessionEntry(...)
              ├─ store[normalizedKey] = next
              ├─ delete store[legacyKey]  (清理旧格式 key)
              └─ saveSessionStoreUnlocked(...)
```

### 3.4 主会话 Key 解析

`resolveMainSessionKey` 根据配置决定主 session key（`src/config/sessions/main-session.ts`）：

```typescript
export function resolveMainSessionKey(cfg?) {
  if (cfg?.session?.scope === "global") return "global";

  const agents = cfg?.agents?.list ?? [];
  const defaultAgentId = agents.find((a) => a?.default)?.id ?? agents[0]?.id ?? "main";
  const agentId = normalizeAgentId(defaultAgentId);
  const mainKey = normalizeMainKey(cfg?.session?.mainKey); // 默认 "main"

  return buildAgentMainSessionKey({ agentId, mainKey });
  // 结果: "agent:main:main"
}
```

---

## 4. 群聊 (Group Chat) Session Key 生成与保存

群聊有**两条不同的 session key 路径**，分别用于不同场景。

### 4.1 路径一：Channel 路由的群聊（`agent:` 前缀）

当群聊消息通过 channel 适配器（Telegram、Discord、Slack 等）到达时，使用 `agent:` 前缀格式。

#### 4.1.1 群聊检测与 Key 解析

`resolveGroupSessionKey(ctx)` 从消息上下文中检测群组消息（`src/config/sessions/group.ts`）：

```typescript
export function resolveGroupSessionKey(ctx: MsgContext): GroupKeyResolution | null {
  const from = typeof ctx.From === "string" ? ctx.From.trim() : "";
  const chatType = ctx.ChatType?.trim().toLowerCase();
  const normalizedChatType =
    chatType === "channel" ? "channel" : chatType === "group" ? "group" : undefined;

  // 群聊检测条件
  const isWhatsAppGroupId = from.toLowerCase().endsWith("@g.us");
  const looksLikeGroup =
    normalizedChatType === "group" ||
    normalizedChatType === "channel" ||
    from.includes(":group:") ||
    from.includes(":channel:") ||
    isWhatsAppGroupId;

  if (!looksLikeGroup) return null;

  // 解析 provider (channel 名称)
  const providerHint = ctx.Provider?.trim().toLowerCase();
  const parts = from.split(":").filter(Boolean);
  const head = parts[0]?.trim().toLowerCase() ?? "";
  const headIsSurface = head ? getGroupSurfaces().has(head) : false;

  const provider = headIsSurface
    ? head
    : (providerHint ?? (isWhatsAppGroupId ? "whatsapp" : undefined));
  if (!provider) return null;

  // 解析 kind (group/channel) 和 id
  const second = parts[1]?.trim().toLowerCase();
  const secondIsKind = second === "group" || second === "channel";
  const kind = secondIsKind ? second : ...;
  const id = ...;

  return {
    key: `${provider}:${kind}:${finalId}`,   // 例: "discord:group:12345"
    channel: provider,                        // 例: "discord"
    id: finalId,                              // 例: "12345"
    chatType: kind === "channel" ? "channel" : "group",
  };
}
```

#### 4.1.2 群聊 Session Key 最终生成

在 `resolveSessionKey` 中，检测到群聊后生成 `agent:` 前缀的 key：

```typescript
// src/config/sessions/session-key.ts
const raw = deriveSessionKey(scope, ctx);
// raw = "discord:group:12345" (来自 resolveGroupSessionKey)

const isGroup = raw.includes(":group:") || raw.includes(":channel:");
if (isGroup) {
  return `agent:${DEFAULT_AGENT_ID}:${raw}`;
  // 结果: "agent:main:discord:group:12345"
}
```

#### 4.1.3 群聊 Session 元数据保存

群聊 session 保存时，额外通过 `deriveGroupSessionPatch` 生成群组特有的元数据（`src/config/sessions/metadata.ts`）：

```typescript
export function deriveGroupSessionPatch(params) {
  const resolution = params.groupResolution ?? resolveGroupSessionKey(params.ctx);
  if (!resolution?.channel) return null;

  const patch: Partial<SessionEntry> = {
    chatType: resolution.chatType ?? "group", // "group" 或 "channel"
    channel: resolution.channel, // "discord"、"slack" 等
    groupId: resolution.id, // 群组 ID
  };

  // 可选字段
  if (subject) patch.subject = subject; // 群组主题
  if (groupChannel) patch.groupChannel = groupChannel; // 频道名称
  if (space) patch.space = space; // 工作空间名称

  // 生成人类可读的显示名称
  patch.displayName = buildGroupDisplayName({
    provider: channel,
    subject,
    groupChannel,
    space,
    id: resolution.id,
    key: params.sessionKey,
  });
  // displayName 示例: "discord:g-general", "slack:#random"

  return patch;
}
```

### 4.2 路径二：群聊功能模块（`group:` → `agent:` 前缀转换）

当通过 UI 前端创建群聊时，使用 `group:` 前缀作为**初始 session key**，但最终**存储到 session store 中的 key 为 `agent:` 前缀格式**。

#### 4.2.1 前端创建群聊

群聊的创建通过前端控制器 `ui/src/ui/controllers/group-chat.ts` 发起：

```
用户点击"创建群聊"
  ↓
createGroup(...)                                ← ui/src/ui/controllers/group-chat.ts
  ↓
调用 RPC: group.create({ agents, name, ... })   # 发送到后端
  ↓
后端生成 groupId (crypto.randomUUID())
  ↓
buildGroupSessionKey(groupId)                   ← src/group-chat/group-session-key.ts
  ↓
返回 { groupId, sessionKey: "group:<groupId>" }  # 初始格式
  ↓
前端保存 sessionKey 到群聊状态
```

后端 `group.create` RPC 处理过程中：

1. 生成唯一 `groupId`（UUID 格式）
2. 调用 `buildGroupSessionKey(groupId)` 生成 `group:<groupId>`（初始格式）
3. 返回 `{ groupId, sessionKey }` 给前端

#### 4.2.2 Session Key 的存储与展示：两阶段转换（关键环节）

Group Chat 模块的 session key 存在**磁盘存储格式**与**API 展示格式**的差异：

**阶段一：Agent 触发时写入磁盘（保持 `group:` 前缀）**

```
用户发送群聊消息 → group.send RPC → triggerAgentReasoning(...)
  ↓
[agent-trigger.ts]
  sessionKey = buildGroupSessionKey(groupId, agentId)
  // "group:5c518b01-...:main" (初始格式)
  ↓
ctx.SessionKey = sessionKey
  ↓
dispatchInboundMessage({ctx, cfg, ...})              ← src/auto-reply/dispatch.ts
  ↓
dispatchReplyFromConfig → getReplyFromConfig → initSessionState
  ↓
[initSessionState]                                   ← src/auto-reply/reply/session.ts
  agentId = resolveSessionAgentId({ sessionKey, config: cfg })
  //   → resolveSessionAgentIds({ sessionKey, config })
  //       → defaultAgentId = resolveDefaultAgentId(cfg)
  //           → 读取 agents.list 中 default=true 的 agent，
  //             或列表第一个，最后才 fallback 到 "main"
  //       → parsed = parseAgentSessionKey("group:5c518b01-...:main")
  //           → parts[0] = "group" ≠ "agent" → null
  //       → sessionAgentId = parsed?.agentId ?? defaultAgentId
  //   → 最终 agentId = 配置中的默认 agent ID（对话产生时）
  ↓
storePath = resolveStorePath(sessionCfg?.store, { agentId })
  // → ~/.openclaw/agents/<默认agentId>/sessions/sessions.json
  ↓
[agent run → updateSessionStore]
  store[sessionKey] = mergedEntry
  // 磁盘 sessions.json 中的 key = "group:5c518b01-...:main"
  // 写入文件 = ~/.openclaw/agents/<默认agentId>/sessions/sessions.json
```

> **⚠️ storeAgentId 的确定逻辑**
> `group:` 前缀的 key 不以 `"agent:"` 开头，`parseAgentSessionKey` 无法从中提取 agentId（返回 `null`），
> 因此 fallback 到 `resolveDefaultAgentId(cfg)` 的结果——即**对话产生时配置中的默认 agent ID**。
>
> `resolveDefaultAgentId` 的优先级（`src/agents/agent-scope.ts`）：
>
> 1. `agents.list` 中标记了 `default: true` 的 agent
> 2. `agents.list` 中的第一个 agent
> 3. 硬编码常量 `DEFAULT_AGENT_ID = "main"`（仅当完全没有配置任何 agent 时）
>
> **这意味着 Group Chat 模块的 session 条目写入「对话产生时的默认 agent」的 sessions.json 文件。**
> 例如：如果 `test_3` 被设为默认 agent，则条目写入 `~/.openclaw/agents/test_3/sessions/sessions.json`。

**阶段二：`sessions.list` 返回时规范化（转为 `agent:` 前缀）**

```
前端请求 sessions.list
  ↓
[sessions.list handler] → loadCombinedSessionStoreForGateway(cfg)
  ↓
遍历每个 agent 的 sessions.json 文件:
  for (const agentId of listConfiguredAgentIds(cfg)) {
    // agentId = 当前遍历到的 agent 目录 ID (例: "main")
    const storePath = resolveStorePath(storeConfig, { agentId });
    const store = loadSessionStore(storePath);
    for (const [key, entry] of Object.entries(store)) {
      // key = "group:5c518b01-...:main" (磁盘格式)
      const canonicalKey = canonicalizeSessionKeyForAgent(agentId, key);
      // agentId 来自外层循环 → 即这个 sessions.json 文件归属的 agent
      // 写入时由 resolveDefaultAgentId(cfg) 确定，读取时自然对应
      // canonicalKey = "agent:<agentId>:group:5c518b01-...:main" (规范化后)
      combined[canonicalKey] = entry;
    }
  }
  ↓
返回给前端: { key: "agent:<默认agentId>:group:5c518b01-...:main", ... }
  ↓
✅ 用户在会话管理页面看到: "agent:<默认agentId>:group:5c518b01-...:main"
```

> **读取时 agentId 的来源**：`canonicalizeSessionKeyForAgent(agentId, key)` 中的 `agentId`
> 是当前正在遍历的 agent store 文件的归属 ID。因为阶段一写入时 `storeAgentId` 是配置中的默认 agent
> （由 `resolveDefaultAgentId(cfg)` 决定），所以读取时自然遍历到该 agent 的 store 文件，
> `agentId` 与写入时一致。**写入时和读取时使用的 agentId 是对应的，都来自同一个默认 agent 解析逻辑。**

**转换函数** (`canonicalizeSessionKeyForAgent`，位于 `src/gateway/session-utils.ts`):

```typescript
function canonicalizeSessionKeyForAgent(agentId: string, key: string): string {
  const lowered = key.toLowerCase();
  if (lowered === "global" || lowered === "unknown") return lowered;
  if (lowered.startsWith("agent:")) return lowered; // 已有 agent: 前缀，保持不变
  return `agent:${normalizeAgentId(agentId)}:${lowered}`; // 自动添加 agent: 前缀
}
```

> **⚠️ 总结**：
>
> - **磁盘 `sessions.json` 中的实际存储 key** = `group:<groupId>:<agentId>`（原始格式）
> - **API `sessions.list` 返回的 key** = `agent:<默认agentId>:group:<groupId>:<agentId>`（规范化格式，`<默认agentId>` 为对话产生时的默认 agent）
> - **会话管理页面显示的 key** = 同 API 返回值
> - 转换发生在 `loadCombinedSessionStoreForGateway` 中的读取时规范化（read-time canonicalization）

#### 4.2.3 Session Key 格式对照

| 阶段                      | 格式                                               | 示例                                                         |
| ------------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| `group.create` 返回给前端 | `group:<groupId>`                                  | `group:5c518b01-5764-455b-adc1-4184dc0f179c`                 |
| Agent trigger 内部使用    | `group:<groupId>:<agentId>`                        | `group:5c518b01-5764-455b-adc1-4184dc0f179c:main`            |
| 磁盘 sessions.json 存储   | `group:<groupId>:<agentId>`                        | `group:5c518b01-5764-455b-adc1-4184dc0f179c:main`            |
| `sessions.list` API 返回  | `agent:<defaultAgentId>:group:<groupId>:<agentId>` | `agent:main:group:5c518b01-5764-455b-adc1-4184dc0f179c:main` |
| 会话管理页面显示          | 同 API 返回                                        | `agent:main:group:5c518b01-5764-455b-adc1-4184dc0f179c:main` |

#### 4.2.4 群聊 Session Key 的使用

```typescript
// 进入群聊
enterGroupChat(groupId, sessionKey)
  → 使用 sessionKey 加载历史消息
  → 使用 sessionKey 标识后续消息的 session 归属

// 发送群聊消息
sendGroupMessage(groupId, message)
  → 后端触发 agent → buildGroupSessionKey(groupId, agentId)
  → ctx.SessionKey = "group:<groupId>:<agentId>"
  → 经过 initSessionState → resolveSessionAgentId 确定 store 文件归属
  → 以 "group:" 前缀原始格式写入对应默认 agent 的 session store

// 清理群聊消息
clearGroupMessages(groupId)
  → 后端遍历所有 agent: buildGroupSessionKey(groupId, agentId)
  → 用 "group:<groupId>:<agentId>" 直接查找 session store
  → ⚠️ 注意: 这里直接用 group: 前缀查找，不经过 resolveSessionStoreKey
```

#### 4.2.5 Group Chat Session Key 中两个 agentId 的含义

Group Chat 模块的 session key 在 API 层面（会话管理页面）展示为 `agent:<X>:group:<groupId>:<Y>` 格式，其中出现了**两个 agentId**。以实际例子说明：

```
同一个群聊中的两个 session key:
  agent:main:group:0a9b9fc5-485d-4568-a690-5007e02443a8:main
  agent:main:group:0a9b9fc5-485d-4568-a690-5007e02443a8:test_2
        ↑                                                ↑
        第一个 agentId (X)                               第二个 agentId (Y)
```

##### 第一个 agentId (X)：Session Store 文件归属（对话产生时的默认 Agent）

**含义**：标识这条 session 条目存储在哪个 agent 的 `sessions.json` 文件中。**它等于对话产生时配置中的默认 agent ID**，决定了 session 条目被写入哪个 agent 的 store 文件。

**精确确定逻辑**：

Group Chat 的 `dispatchInboundMessage` 调用链为：
`dispatchInboundMessage` → `dispatchReplyFromConfig` → `getReplyFromConfig` → `initSessionState`

1. **`initSessionState` 中确定 agentId**（`src/auto-reply/reply/session.ts`）：

   ```typescript
   const agentId = resolveSessionAgentId({
     sessionKey: sessionCtxForState.SessionKey,
     config: cfg,
   });
   const storePath = resolveStorePath(sessionCfg?.store, { agentId });
   ```

2. **`resolveSessionAgentId` → `resolveSessionAgentIds`**（`src/agents/agent-scope.ts`）：

   ```typescript
   export function resolveSessionAgentIds(params) {
     const defaultAgentId = resolveDefaultAgentId(params.config ?? {});
     const parsed = parseAgentSessionKey(normalizedSessionKey);
     const sessionAgentId = parsed?.agentId ? normalizeAgentId(parsed.agentId) : defaultAgentId;
     return { defaultAgentId, sessionAgentId };
   }
   ```

3. **`parseAgentSessionKey` 解析 `group:` 前缀 key 时失败**（`src/sessions/session-key-utils.ts`）：

   ```typescript
   // parseAgentSessionKey("group:0a9b9fc5-...:main")
   // → parts = ["group", "0a9b9fc5-...", "main"]
   // → parts[0] = "group" ≠ "agent"
   // → return null
   ```

4. **fallback 到 `resolveDefaultAgentId(cfg)` — 配置中的默认 agent**：

   ```typescript
   // resolveDefaultAgentId(cfg) 的优先级（src/agents/agent-scope.ts）：
   //   1. agents.list 中标记 default: true 的 agent
   //   2. agents.list 中的第一个 agent
   //   3. 硬编码常量 DEFAULT_AGENT_ID = "main"（仅当没有配置任何 agent 时）
   //
   // parsed = null → sessionAgentId = defaultAgentId（即配置中的默认 agent ID）
   // 条目写入 ~/.openclaw/agents/<defaultAgentId>/sessions/sessions.json
   ```

5. **读取时保持一致**：`loadCombinedSessionStoreForGateway` 遍历各 agent 的 store 文件时，
   `canonicalizeSessionKeyForAgent(agentId, key)` 中的 `agentId` 是当前遍历到的 store 文件归属的 agent ID。
   因为写入时已经落到了对应默认 agent 的 store 文件，读取时 `agentId` 与写入时一致。

**结论**：第一个 agentId 是**对话产生时配置中的默认 agent ID**。它由 `resolveDefaultAgentId(cfg)` 确定，优先使用 `agents.list` 中 `default: true` 的 agent，其次列表第一个，最后才 fallback 到硬编码的 `"main"`。它表示 session store 文件归属，而不是群聊中的参与者。

> **⚠️ 注意**：第一个 agentId 在**对话产生时**即确定，并随 session 条目持久化。如果之后修改了默认 agent 配置，
> 已有的 session 条目不会迁移，仍保留在原 agent 的 store 文件中。新对话则会写入新的默认 agent 的 store 文件。

##### 第二个 agentId (Y)：群聊内的参与 Agent

**含义**：标识这是群聊中**哪个 agent 的独立对话 session**，用于实现 per-agent session 隔离。

**精确确定逻辑**：

由 `buildGroupSessionKey(groupId, agentId)` 的第二个参数决定（`src/group-chat/group-session-key.ts` 第 15-18 行）：

```typescript
export function buildGroupSessionKey(groupId: string, agentId?: string): string {
  if (agentId) {
    return `group:${groupId}:${agentId}`; // ← agentId 就是第二个 agentId
  }
  return `group:${groupId}`;
}
```

调用点在 `src/group-chat/agent-trigger.ts` 第 242 行：

```typescript
const sessionKey = buildGroupSessionKey(groupId, agentId);
// agentId 来自 triggerAgentReasoning 的参数 — 即群聊中被触发响应的那个 agent 的 ID
```

**结论**：第二个 agentId 是**群聊中实际参与对话的 agent ID**，来自群聊触发逻辑。同一个群聊中的每个 agent 各自维护独立的 session（独立的对话历史），通过这个 agentId 实现隔离。

##### 两个 agentId 对照总结

|              | 第一个 agentId (`agent:X:...`)                                                           | 第二个 agentId (`...:Y`)                              |
| ------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **位置**     | `agent:` 前缀后紧跟                                                                      | session key 末尾                                      |
| **含义**     | Session store 文件归属（对话产生时的默认 agent）                                         | 群聊内参与对话的 agent                                |
| **来源代码** | `resolveSessionAgentId` → `resolveDefaultAgentId(cfg)`                                   | `buildGroupSessionKey(groupId, agentId)` 的第二个参数 |
| **确定逻辑** | `parseAgentSessionKey` 解析 `group:` 前缀失败 → fallback 到 `resolveDefaultAgentId(cfg)` | `agent-trigger.ts` 中被触发 agent 的 ID               |
| **可能的值** | 对话产生时配置中的默认 agent ID（通常为 `"main"`，但可通过配置更改）                     | 任意 agent ID（`main`、`test_2`、自定义名称等）       |
| **实际作用** | 决定条目写入哪个 agent 的 `sessions.json` 文件                                           | 实现群聊内 per-agent session 隔离                     |

##### 实际示例

```
场景一：默认 agent = main 时

agent:main:group:0a9b9fc5-485d-4568-a690-5007e02443a8:main
│     │                                                │
│     └─ store 归属: "main" (对话产生时默认 agent)       │
│        → 写入 ~/.openclaw/agents/main/sessions/       │
│                                                      │
└─ 群聊内 agent: "main" 的独立 session ────────────────┘

agent:main:group:0a9b9fc5-485d-4568-a690-5007e02443a8:test_2
│     │                                                │
│     └─ store 归属: "main" (同上，对话产生时默认 agent) │
│        → 写入 ~/.openclaw/agents/main/sessions/       │
│                                                      │
└─ 群聊内 agent: "test_2" 的独立 session ──────────────┘

两条记录都在同一个 sessions.json 文件中（main agent 的 store），
但通过末尾的 agentId 区分为不同 agent 的独立对话历史。

场景二：将 test_3 设为默认 agent 后进行新的群聊对话

agent:test_3:group:0a9b9fc5-485d-4568-a690-5007e02443a8:test_2
│     │                                                  │
│     └─ store 归属: "test_3" (对话产生时默认 agent)       │
│        → 写入 ~/.openclaw/agents/test_3/sessions/       │
│                                                        │
└─ 群聊内 agent: "test_2" 的独立 session ────────────────┘

注意：第一个 agentId 在对话产生时确定。如果之后修改了默认 agent 配置，
已有的 session 条目不会迁移，新的对话则写入新默认 agent 的 store 文件。
```

### 4.3 线程 (Thread) 支持

群聊和 DM 都支持线程扩展，通过 `resolveThreadSessionKeys` 实现（`src/routing/session-key.ts`）：

```typescript
export function resolveThreadSessionKeys(params) {
  const threadId = (params.threadId ?? "").trim();
  if (!threadId) {
    return { sessionKey: params.baseSessionKey, parentSessionKey: undefined };
  }
  const normalizedThreadId = params.normalizeThreadId?.(threadId) ?? threadId.toLowerCase();

  // 默认 useSuffix=true: 在基础 key 后追加 :thread:<threadId>
  const sessionKey = useSuffix
    ? `${params.baseSessionKey}:thread:${normalizedThreadId}`
    : params.baseSessionKey;

  return { sessionKey, parentSessionKey: params.parentSessionKey };
}
```

示例：

- 基础 key: `agent:main:discord:group:12345`
- 线程 key: `agent:main:discord:group:12345:thread:67890`

---

## 5. Session Store 持久化机制

### 5.1 存储路径

Session store 是一个 JSON 文件，路径由 `resolveStorePath` 解析（`src/config/sessions/paths.ts`）：

```
默认路径: ~/.openclaw/agents/<agentId>/sessions/sessions.json

路径层级:
  ~/.openclaw/                    # OpenClaw 状态根目录
    agents/
      main/                       # agentId = "main"
        sessions/
          sessions.json           # Session store 文件
          <sessionId>.jsonl       # 对话转录文件
          <sessionId>.jsonl.lock  # 文件锁
```

```typescript
export function resolveDefaultSessionStorePath(agentId?: string): string {
  return path.join(resolveAgentSessionsDir(agentId), "sessions.json");
}
```

### 5.2 读取流程 (loadSessionStore)

```typescript
export function loadSessionStore(storePath, opts = {}) {
  // 1. 检查缓存（TTL 默认 45 秒）
  if (!opts.skipCache && isSessionStoreCacheEnabled()) {
    const cached = readSessionStoreCache({
      storePath,
      ttlMs: getSessionStoreTtl(),    // 默认 45000ms
      mtimeMs: currentFileStat?.mtimeMs,
      sizeBytes: currentFileStat?.sizeBytes,
    });
    if (cached) return cached;
  }

  // 2. 从磁盘读取（Windows 重试 3 次，Linux/Mac 1 次）
  let store = {};
  const maxReadAttempts = process.platform === "win32" ? 3 : 1;
  for (let attempt = 0; attempt < maxReadAttempts; attempt++) {
    try {
      const raw = fs.readFileSync(storePath, "utf-8");
      if (raw.length === 0 && attempt < maxReadAttempts - 1) {
        // 文件为空 — 可能在写入中途被读取；短暂等待后重试
        Atomics.wait(retryBuf!, 0, 0, 50);
        continue;
      }
      const parsed = JSON.parse(raw);
      if (isSessionStoreRecord(parsed)) store = parsed;
      break;
    } catch {
      if (attempt < maxReadAttempts - 1) {
        Atomics.wait(retryBuf!, 0, 0, 50);
        continue;
      }
    }
  }

  // 3. 应用迁移
  applySessionStoreMigrations(store);

  // 4. 写入缓存
  if (!opts.skipCache && isSessionStoreCacheEnabled()) {
    writeSessionStoreCache({...});
  }

  // 5. 返回深拷贝（避免外部修改影响缓存）
  return structuredClone(store);
}
```

### 5.3 写入流程 (saveSessionStoreUnlocked)

```typescript
async function saveSessionStoreUnlocked(storePath, store, opts?) {
  // 1. 规范化所有 entry
  normalizeSessionStore(store);

  // 2. 执行维护操作（除非 skipMaintenance）
  if (!opts?.skipMaintenance) {
    const maintenance = resolveMaintenanceConfig();

    if (maintenance.mode === "warn") {
      // 仅警告模式：不实际删除，只记录警告
      // ... 警告逻辑 ...
    } else {
      // 执行模式：
      pruneStaleEntries(store, maintenance.pruneAfterMs);   // 清理过期 entry
      capEntryCount(store, maintenance.maxEntries);          // 限制总数
      archiveRemovedSessionTranscripts({...});               // 归档转录文件
      await rotateSessionFile(storePath, maintenance.rotateBytes); // 文件轮转
      await enforceSessionDiskBudget({...});                 // 磁盘预算控制
    }
  }

  // 3. 确保目录存在
  await fs.promises.mkdir(path.dirname(storePath), { recursive: true });

  // 4. 序列化并检查是否有变化
  const json = JSON.stringify(store, null, 2);
  if (getSerializedSessionStore(storePath) === json) {
    // 内容未变，跳过磁盘写入（仅更新缓存）
    updateSessionStoreWriteCaches({...});
    return;
  }

  // 5. 原子写入磁盘
  await writeSessionStoreAtomic({ storePath, store, serialized: json });
}
```

### 5.4 原子写入

```typescript
async function writeSessionStoreAtomic(params) {
  // 写入临时文件，然后原子 rename
  await writeTextAtomic(params.storePath, params.serialized, { mode: 0o600 });
  // 更新写缓存
  updateSessionStoreWriteCaches({
    storePath: params.storePath,
    store: params.store,
    serialized: params.serialized,
  });
}
```

`writeTextAtomic`（`src/infra/json-files.ts`）使用临时文件 + `rename` 实现原子性：

1. 写入 `<storePath>.tmp.<random>` 临时文件
2. 使用 `fs.rename()` 原子替换目标文件
3. Windows 下重试最多 5 次（因 rename 可能被锁定）

### 5.5 Session Store 缓存

缓存机制位于 `src/config/sessions/store-cache.ts`：

- **TTL 缓存**：默认 45 秒过期
- **文件 stat 校验**：如果磁盘文件 mtime/size 变化，缓存立即失效
- **序列化缓存**：保存上次写入的 JSON 字符串，跳过无变化的写入
- **环境变量配置**：`OPENCLAW_SESSION_CACHE_TTL_MS` 可调整 TTL

---

## 6. Session Entry 数据结构

`SessionEntry` 是 session store 中每个会话的核心数据结构（`src/config/sessions/types.ts`）：

```typescript
export type SessionEntry = {
  // === 核心标识 ===
  sessionId: string;               // 会话唯一 ID (crypto.randomUUID())
  updatedAt: number;               // 最后更新时间戳 (Date.now())
  sessionFile?: string;            // 对话转录文件路径 (相对路径)

  // === 会话关系 ===
  spawnedBy?: string;              // 父 session key
  forkedFromParent?: boolean;      // 是否已从父会话 fork
  spawnDepth?: number;             // 子 agent 嵌套深度 (0=main)

  // === 聊天类型 ===
  chatType?: SessionChatType;      // "direct" | "group" | "channel"

  // === 群组信息 (群聊独有) ===
  channel?: string;                // channel 名称 ("discord", "slack" 等)
  groupId?: string;                // 群组 ID
  subject?: string;                // 群组主题
  groupChannel?: string;           // 频道名称
  space?: string;                  // 工作空间名称
  displayName?: string;            // 人类可读的显示名称

  // === 路由信息 ===
  deliveryContext?: DeliveryContext;  // 投递上下文 {channel, to, accountId, threadId}
  lastChannel?: SessionChannelId;    // 最后使用的 channel
  lastTo?: string;                   // 最后发送到的地址
  lastAccountId?: string;            // 最后使用的账户
  lastThreadId?: string | number;    // 最后使用的线程 ID
  origin?: SessionOrigin;            // 会话来源信息

  // === 模型信息 ===
  modelProvider?: string;          // 模型提供商
  model?: string;                  // 模型名称
  providerOverride?: string;       // 用户覆盖的提供商
  modelOverride?: string;          // 用户覆盖的模型

  // === Token 统计 ===
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  totalTokensFresh?: boolean;      // totalTokens 是否为最新快照
  cacheRead?: number;
  cacheWrite?: number;
  contextTokens?: number;
  compactionCount?: number;        // 上下文压缩次数

  // === 会话配置覆盖 ===
  thinkingLevel?: string;
  verboseLevel?: string;
  reasoningLevel?: string;
  elevatedLevel?: string;
  ttsAuto?: TtsAutoMode;
  execHost?: string;
  execSecurity?: string;
  groupActivation?: "mention" | "always";
  sendPolicy?: "allow" | "deny";
  queueMode?: "steer" | "followup" | "collect" | ...;

  // === 运行状态 ===
  activeRunId?: string;            // 当前运行 ID
  activeRunStartedAt?: number;     // 运行开始时间
  systemSent?: boolean;            // 系统消息是否已发送
  abortedLastRun?: boolean;        // 上次运行是否被中止

  // === ACP (Agent Communication Protocol) ===
  acp?: SessionAcpMeta;           // ACP session 元数据

  // === 其他 ===
  label?: string;                  // 用户自定义标签
  skillsSnapshot?: SessionSkillSnapshot;
  systemPromptReport?: SessionSystemPromptReport;
  lastHeartbeatText?: string;
  lastHeartbeatSentAt?: number;
};
```

### 6.1 Session Entry 合并策略

合并逻辑定义在 `mergeSessionEntryWithPolicy`（`src/config/sessions/types.ts`）：

```typescript
export function mergeSessionEntryWithPolicy(
  existing: SessionEntry | undefined,
  patch: Partial<SessionEntry>,
  options?: MergeSessionEntryOptions,
): SessionEntry {
  const sessionId = patch.sessionId ?? existing?.sessionId ?? crypto.randomUUID();
  const updatedAt = resolveMergedUpdatedAt(existing, patch, options);

  if (!existing) {
    // 新建：直接使用 patch
    return normalizeSessionRuntimeModelFields({ ...patch, sessionId, updatedAt });
  }

  // 合并：existing + patch
  const next = { ...existing, ...patch, sessionId, updatedAt };

  // 防止过时的 provider 信息残留
  if (Object.hasOwn(patch, "model") && !Object.hasOwn(patch, "modelProvider")) {
    if (patchedModel !== existingModel) {
      delete next.modelProvider;
    }
  }

  return normalizeSessionRuntimeModelFields(next);
}
```

两种合并模式：

- **`mergeSessionEntry`**: 刷新 `updatedAt` 为当前时间（默认，用于用户活动）
- **`mergeSessionEntryPreserveActivity`**: 保留原有 `updatedAt`（用于入站元数据更新，不影响 idle reset 判断）

---

## 7. 并发控制与锁机制

### 7.1 双层锁架构

Session store 使用**内存队列 + 文件锁**的双层锁架构：

```
    ┌─────────────────────────────────────────┐
    │            内存队列 (LOCK_QUEUES)          │
    │  Map<storePath, SessionStoreLockQueue>    │
    │                                          │
    │  queue.pending: SessionStoreLockTask[]    │
    │  queue.running: boolean                  │
    │                                          │
    │  逐个执行 pending 中的 task               │
    └────────────────┬────────────────────────┘
                     │
                     │ 每个 task 执行时
                     ▼
    ┌─────────────────────────────────────────┐
    │          文件锁 (session-write-lock)       │
    │                                          │
    │  锁文件: <sessionFile>.lock              │
    │  内容: { pid, createdAt, starttime }     │
    │                                          │
    │  使用 fs.open(lockPath, "wx") 排他创建    │
    │  支持重入 (allowReentrant)                │
    │  过期检测 (staleMs 默认 30 分钟)          │
    │  最大持有时间 (maxHoldMs 默认 5 分钟)      │
    └─────────────────────────────────────────┘
```

### 7.2 withSessionStoreLock

所有 session store 写操作都通过 `withSessionStoreLock` 保护（`src/config/sessions/store.ts`）：

```typescript
async function withSessionStoreLock<T>(
  storePath: string,
  fn: () => Promise<T>,
  opts: SessionStoreLockOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 10_000; // 默认 10 秒超时
  const staleMs = opts.staleMs ?? 30_000; // 默认 30 秒过期

  const queue = getOrCreateLockQueue(storePath);

  const promise = new Promise<T>((resolve, reject) => {
    const task: SessionStoreLockTask = {
      fn: async () => await fn(),
      resolve,
      reject,
      timeoutMs: hasTimeout ? timeoutMs : undefined,
      staleMs,
    };
    queue.pending.push(task);
    void drainSessionStoreLockQueue(storePath);
  });

  return await promise;
}
```

### 7.3 文件锁实现 (acquireSessionWriteLock)

`src/agents/session-write-lock.ts` 实现了基于文件的分布式锁：

```typescript
export async function acquireSessionWriteLock(params) {
  // 1. 注册进程退出清理钩子
  registerCleanupHandlers();

  // 2. 检查重入
  const held = HELD_LOCKS.get(normalizedSessionFile);
  if (allowReentrant && held) {
    held.count += 1;  // 递增重入计数
    return { release: async () => { await releaseHeldLock(...); } };
  }

  // 3. 自旋获取锁
  while (Date.now() - startedAt < timeoutMs) {
    try {
      // 排他创建锁文件
      handle = await fs.open(lockPath, "wx");

      // 写入锁元数据
      const lockPayload = {
        pid: process.pid,
        createdAt: new Date().toISOString(),
        starttime: getProcessStartTime(process.pid),  // 进程启动时间
      };
      await handle.writeFile(JSON.stringify(lockPayload));

      // 记录持有状态
      HELD_LOCKS.set(normalizedSessionFile, {
        count: 1, handle, lockPath,
        acquiredAt: Date.now(),
        maxHoldMs,
      });

      return { release: async () => { ... } };
    } catch (err) {
      if (err.code !== "EEXIST") throw err;

      // 锁文件已存在 — 检查是否过期
      const payload = await readLockPayload(lockPath);
      const inspected = inspectLockPayload(payload, staleMs, nowMs);

      // 过期检测：PID 不存在 / PID 被回收 / 太旧
      if (await shouldReclaimContendedLockFile(...)) {
        await fs.rm(lockPath, { force: true });  // 清理过期锁
        continue;  // 重试
      }

      // 等待后重试
      await new Promise(r => setTimeout(r, Math.min(1000, 50 * attempt)));
    }
  }

  throw new Error(`session file locked (timeout ${timeoutMs}ms)`);
}
```

### 7.4 锁的生命周期保障

- **进程退出清理**: `process.on("exit", releaseAllLocksSync)` + `SIGINT/SIGTERM/SIGQUIT/SIGABRT`
- **看门狗定时器**: 每 60 秒检查一次，释放超过 `maxHoldMs`（默认 5 分钟）的锁
- **PID 回收检测**: 比较锁文件中的 `starttime` 与当前进程的 `/proc/pid/stat` field 22

---

## 8. Session 维护与生命周期管理

### 8.1 Session Slug 生成

新会话创建时使用 `createSessionSlug` 生成人类可读的标识符（`src/agents/session-slug.ts`）：

```typescript
export function createSessionSlug(isTaken?: (id: string) => boolean): string {
  // 优先生成 2 词 slug: "calm-harbor", "swift-reef"
  const twoWord = createAvailableSlug(2, isIdTaken);
  if (twoWord) return twoWord;

  // 冲突时尝试 3 词: "calm-harbor-reef"
  const threeWord = createAvailableSlug(3, isIdTaken);
  if (threeWord) return threeWord;

  // 极端冲突: 追加随机后缀 + 时间戳
  return `${createSlugBase(3)}-${Math.random().toString(36).slice(2, 5)}`;
}
```

### 8.2 Session 重置策略

支持两种重置模式（`src/config/sessions/reset.ts`）：

- **`daily`**: 每天自动重置 session（清除历史）
- **`idle`**: 空闲超时后重置（默认 60 分钟，可配置）

### 8.3 维护操作（每次保存时执行）

```
saveSessionStoreUnlocked
  ↓
  ├─ pruneStaleEntries(store, pruneAfterMs)
  │   → 删除 updatedAt 早于 pruneAfterMs 的 entry
  │
  ├─ capEntryCount(store, maxEntries)
  │   → 按 updatedAt 排序，删除最旧的超额 entry
  │
  ├─ archiveRemovedSessionTranscripts(...)
  │   → 将被删除 entry 的 .jsonl 转录文件移动到归档目录
  │
  ├─ cleanupArchivedSessionTranscripts(...)
  │   → 清理过期的归档文件
  │
  ├─ rotateSessionFile(storePath, rotateBytes)
  │   → 当 sessions.json 超过阈值时执行文件轮转
  │
  └─ enforceSessionDiskBudget(...)
      → 确保 sessions 目录总磁盘占用不超过预算
```

### 8.4 Session Store Entry 解析与兼容

`resolveSessionStoreEntry` 处理新旧格式的 key 兼容（`src/config/sessions/store.ts`）：

```typescript
export function resolveSessionStoreEntry(params) {
  const normalizedKey = normalizeStoreSessionKey(params.sessionKey);

  // 1. 查找规范化 key
  let existing = params.store[normalizedKey];

  // 2. 查找 legacy key（大小写不一致的旧 key）
  for (const [candidateKey, candidateEntry] of Object.entries(params.store)) {
    if (candidateKey.toLowerCase() === normalizedKey && candidateKey !== normalizedKey) {
      legacyKeySet.add(candidateKey);
      // 取最新更新的 entry
      if (!existing || candidateUpdatedAt > existingUpdatedAt) {
        existing = candidateEntry;
      }
    }
  }

  return {
    normalizedKey,       // 规范化后的 key
    existing,            // 已存在的 entry（如有）
    legacyKeys: [...],   // 需要清理的旧格式 key
  };
}
```

保存时自动清理 legacy key：

```typescript
store[resolved.normalizedKey] = next;
for (const legacyKey of resolved.legacyKeys) {
  delete store[legacyKey]; // 删除旧格式 key
}
```

---

## 9. 两种场景对比分析

| 维度             | 普通对话 (DM)                       | 群聊 (Channel 路由)                                   | 群聊 (Group Chat 模块)                                                                                      |
| ---------------- | ----------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **初始 Key**     | `agent:main:main`                   | `agent:main:<channel>:<kind>:<id>`                    | `group:<groupId>[:<agentId>]`                                                                               |
| **磁盘存储 Key** | `agent:main:main`                   | `agent:main:<channel>:<kind>:<id>`                    | `group:<groupId>[:<agentId>]`（保持原始格式）                                                               |
| **API 返回 Key** | `agent:main:main`                   | `agent:main:<channel>:<kind>:<id>`                    | `agent:<默认agentId>:group:<groupId>[:<agentId>]`（读取时规范化，`<默认agentId>` 为对话产生时的默认 agent） |
| **Key 转换**     | 无                                  | 无                                                    | 有（磁盘存储 `group:` → API 返回 `agent:` 经 `canonicalizeSessionKeyForAgent` 读取时规范化）                |
| **生成入口**     | `resolveSessionKey`                 | `resolveSessionKey`                                   | `buildGroupSessionKey` → `resolveSessionStoreKey`                                                           |
| **关键函数**     | `buildAgentMainSessionKey`          | `resolveGroupSessionKey` + `deriveSessionKey`         | `buildGroupSessionKey` + `canonicalizeSessionKeyForAgent`                                                   |
| **隔离策略**     | 4 种 dmScope                        | 按群组 ID 自动隔离                                    | 按 groupId + agentId 隔离                                                                                   |
| **默认行为**     | 所有 DM 折叠到一个 session          | 每个群组独立 session                                  | 每个群组独立 session                                                                                        |
| **元数据**       | origin 信息                         | origin + chatType/channel/groupId/subject/displayName | 由后端 RPC 管理                                                                                             |
| **存储方式**     | sessions.json 文件                  | sessions.json 文件                                    | sessions.json 文件                                                                                          |
| **保存时机**     | 消息入站时 (`recordInboundSession`) | 消息入站时 (`recordInboundSession`)                   | agent 触发时 (`dispatchInboundMessage`)                                                                     |
| **线程支持**     | 有 (`:thread:<threadId>`)           | 有 (`:thread:<threadId>`)                             | N/A                                                                                                         |

### 关键区别

1. **DM 默认折叠**: 所有非群聊的 DM 消息默认使用同一个 session key `agent:main:main`，除非配置了 `per-peer` 等隔离策略。

2. **群聊自动隔离**: 群聊消息通过 `resolveGroupSessionKey` 自动解析出独立的群组 key，保证每个群组有独立的会话上下文。

3. **两种群聊 key 生成路径，API 展示格式统一**: Channel 路由的群聊直接生成并存储 `agent:main:<channel>:group:<id>` 格式；Group Chat 模块在磁盘上以 `group:<groupId>[:<agentId>]` 原始格式存储，通过 `loadCombinedSessionStoreForGateway` 中的 `canonicalizeSessionKeyForAgent` 读取时规范化为 `agent:<默认agentId>:group:<groupId>[:<agentId>]` 格式（`<默认agentId>` 为对话产生时配置中的默认 agent ID）。两者在 API 层面都以 `agent:` 前缀展示。

4. **保存时机不同**: DM 和 channel 群聊的 session key 在**消息到达时**生成并保存；Group Chat 模块的 session key 在 **agent 首次被触发响应时**通过 `dispatchInboundMessage` 写入 session store（而非群聊创建时）。

---

## 10. 关键函数调用图

### 10.1 普通对话 (DM) 完整链路

```
消息到达 Channel 适配器
  │
  ▼
[Channel Handler] (例: src/telegram/, src/discord/)
  │
  ├─ resolveSessionKey(scope, ctx, mainKey)
  │     │
  │     ├─ ctx.SessionKey? → normalizeExplicitSessionKey()
  │     │     └─ normalizeExplicitDiscordSessionKey() (Discord 特殊处理)
  │     │
  │     ├─ deriveSessionKey(scope, ctx)
  │     │     ├─ scope === "global"? → "global"
  │     │     ├─ resolveGroupSessionKey(ctx) → null (非群聊)
  │     │     └─ normalizeE164(ctx.From) → "+1234567890"
  │     │
  │     └─ [非群聊] buildAgentMainSessionKey({agentId: "main", mainKey: "main"})
  │           └─ "agent:main:main"
  │
  ▼
recordInboundSession(storePath, sessionKey, ctx)     ← src/channels/session.ts
  │
  ├─ normalizeSessionStoreKey(sessionKey)             # "agent:main:main"
  │
  ├─ recordSessionMetaFromInbound(...)  [async, fire-and-forget]
  │     │
  │     └─ updateSessionStore(storePath, mutator, opts)
  │           │
  │           ├─ withSessionStoreLock(storePath, ...)
  │           │     ├─ LOCK_QUEUES → drainSessionStoreLockQueue()
  │           │     └─ acquireSessionWriteLock({sessionFile, timeoutMs, staleMs})
  │           │           └─ fs.open(lockPath, "wx") → 创建 .lock 文件
  │           │
  │           ├─ loadSessionStore(storePath, {skipCache: true})
  │           │     └─ fs.readFileSync(storePath) → JSON.parse → store
  │           │
  │           ├─ resolveSessionStoreEntry({store, sessionKey})
  │           │     ├─ normalizeStoreSessionKey() → trim().toLowerCase()
  │           │     └─ 查找 existing entry + legacy keys
  │           │
  │           ├─ deriveSessionMetaPatch({ctx, sessionKey, existing})
  │           │     ├─ deriveGroupSessionPatch() → null (非群聊)
  │           │     └─ deriveSessionOrigin(ctx) → {label, provider, surface, ...}
  │           │
  │           ├─ [existing] mergeSessionEntryPreserveActivity(existing, patch)
  │           │   [new]     mergeSessionEntry(undefined, patch)
  │           │                 └─ sessionId = crypto.randomUUID()
  │           │
  │           ├─ store[normalizedKey] = next
  │           ├─ delete store[legacyKey]  (如有)
  │           │
  │           └─ saveSessionStoreUnlocked(storePath, store, opts)
  │                 ├─ normalizeSessionStore(store)
  │                 ├─ [维护] pruneStaleEntries / capEntryCount / rotateSessionFile
  │                 ├─ JSON.stringify(store, null, 2)
  │                 ├─ [无变化] → 跳过写入
  │                 └─ writeSessionStoreAtomic()
  │                       └─ writeTextAtomic(storePath, json, {mode: 0o600})
  │                             ├─ 写入临时文件
  │                             └─ fs.rename() 原子替换
  │
  └─ updateLastRoute(...)
        │
        ├─ withSessionStoreLock(storePath, ...)
        ├─ loadSessionStore(storePath)
        ├─ resolveSessionStoreEntry({store, sessionKey})
        ├─ 合并 deliveryContext
        │     ├─ normalizeDeliveryContext(params.deliveryContext)
        │     ├─ normalizeDeliveryContext({channel, to, accountId, threadId})
        │     └─ mergeDeliveryContext(explicit, fallback)
        ├─ deriveSessionMetaPatch({ctx, ...}) (如有 ctx)
        ├─ mergeSessionEntry(existing, {updatedAt, deliveryContext, lastChannel, ...})
        └─ persistResolvedSessionEntry(...)
              ├─ store[normalizedKey] = next
              ├─ delete store[legacyKey]
              └─ saveSessionStoreUnlocked(...)
```

### 10.2 群聊 (Channel 路由) 完整链路

```
群聊消息到达 Channel 适配器
  │
  ▼
[Channel Handler]
  │
  ├─ resolveSessionKey(scope, ctx, mainKey)
  │     │
  │     ├─ deriveSessionKey(scope, ctx)
  │     │     └─ resolveGroupSessionKey(ctx)
  │     │           ├─ 检测: ctx.ChatType === "group" / ctx.From.includes(":group:")
  │     │           ├─ 解析 provider: "discord" / "slack" / "telegram"
  │     │           ├─ 解析 kind: "group" / "channel"
  │     │           └─ 返回 { key: "discord:group:12345", channel, id, chatType }
  │     │
  │     ├─ raw = "discord:group:12345"
  │     ├─ isGroup = raw.includes(":group:") → true
  │     └─ return `agent:main:discord:group:12345`
  │
  ▼
recordInboundSession(storePath, "agent:main:discord:group:12345", ctx)
  │
  ├─ recordSessionMetaFromInbound(...)
  │     └─ deriveSessionMetaPatch(...)
  │           ├─ deriveGroupSessionPatch({ctx, sessionKey, existing, groupResolution})
  │           │     └─ patch = {
  │           │         chatType: "group",
  │           │         channel: "discord",
  │           │         groupId: "12345",
  │           │         subject: "...",
  │           │         displayName: "discord:g-general"
  │           │       }
  │           └─ deriveSessionOrigin(ctx) → origin
  │
  └─ updateLastRoute(...)
        └─ (同 DM 流程)
```

### 10.3 群聊 (Group Chat 模块) 完整链路

```
用户在 UI 点击"创建群聊"
  │
  ▼
createGroup({agents, name, ...})                    ← ui/src/ui/controllers/group-chat.ts
  │
  ├─ 调用 RPC: group.create({agents, name, ...})
  │
  ▼ (后端)
group.create handler                                ← src/gateway/server-methods/group.ts
  │
  ├─ groupId = crypto.randomUUID()                  # 生成唯一群组 ID
  │
  ├─ buildGroupSessionKey(groupId)                  ← src/group-chat/group-session-key.ts
  │     └─ "group:<groupId>"                        # 初始格式 (返回给前端)
  │
  └─ 返回 { groupId, sessionKey: "group:<groupId>" }
  │
  ▼ (前端)
保存群聊状态，用户开始发消息
  │
  ▼
group.send RPC → 后端 triggerAgentReasoning(...)     ← src/group-chat/agent-trigger.ts
  │
  ├─ sessionKey = buildGroupSessionKey(groupId, agentId)
  │     └─ "group:<groupId>:main"                   # 初始格式 (per-agent)
  │
  ├─ ctx.SessionKey = sessionKey
  │
  ▼
dispatchInboundMessage({ctx, cfg, ...})              ← src/auto-reply/dispatch.ts
  │
  ├─ dispatchReplyFromConfig → getReplyFromConfig → initSessionState
  │     │
  │     ├─ [确定 store 文件归属 agentId]
  │     │     agentId = resolveSessionAgentId({ sessionKey, config: cfg })
  │     │       → resolveSessionAgentIds({ sessionKey, config })
  │     │           → defaultAgentId = resolveDefaultAgentId(cfg)
  │     │               → agents.list 中 default=true 的 agent / 列表第一个 / "main"
  │     │           → parsed = parseAgentSessionKey("group:<groupId>:main")
  │     │               → parts[0] = "group" ≠ "agent" → null
  │     │           → sessionAgentId = parsed?.agentId ?? defaultAgentId
  │     │       → agentId = 配置中的默认 agent ID（对话产生时）
  │     │
  │     ├─ storePath = resolveStorePath({ agentId })
  │     │     → ~/.openclaw/agents/<默认agentId>/sessions/sessions.json
  │     │
  │     └─ sessionKey = "group:<groupId>:main" (ctx.SessionKey 原始值)
  │
  ├─ [Agent Run → updateSessionStore]
  │     ├─ store["group:<groupId>:main"] = mergedEntry
  │     └─ 磁盘写入: ~/.openclaw/agents/<默认agentId>/sessions/sessions.json
  │           key = "group:<groupId>:main" ← 原始格式
  │
  ▼
前端请求 sessions.list → loadCombinedSessionStoreForGateway
  │
  ├─ 遍历各 agent 的 sessions.json:
  │     agentId = <默认agentId> (遍历到对应 agent 的 store 文件)
  │     key = "group:<groupId>:main"
  │     canonicalKey = canonicalizeSessionKeyForAgent(agentId, key)
  │           └─ "agent:<默认agentId>:group:<groupId>:main"  ← 读取时规范化
  │
  └─ 返回: { key: "agent:<默认agentId>:group:<groupId>:main", ... }
  │
  ▼
会话管理页面显示: "agent:<默认agentId>:group:5c518b01-...:main"
                         ↑                                   ↑
              store 归属 (对话产生时的默认 agent)        群聊内 agent ID
```

---

## 附录 A: Session Store JSON 文件示例

磁盘上的 `sessions.json` 文件内容（注意 Group Chat 模块的 key 保持 `group:` 前缀原始格式）：

```json
{
  "agent:main:main": {
    "sessionId": "calm-harbor",
    "updatedAt": 1711267200000,
    "sessionFile": "calm-harbor.jsonl",
    "origin": {
      "label": "telegram-dm",
      "provider": "telegram",
      "surface": "telegram",
      "chatType": "direct",
      "from": "+1234567890"
    },
    "deliveryContext": {
      "channel": "telegram",
      "to": "+1234567890",
      "accountId": "bot-123"
    },
    "lastChannel": "telegram",
    "lastTo": "+1234567890",
    "lastAccountId": "bot-123",
    "model": "claude-sonnet-4-20250514",
    "modelProvider": "anthropic",
    "inputTokens": 12500,
    "outputTokens": 3200,
    "totalTokens": 15700,
    "totalTokensFresh": true,
    "compactionCount": 2
  },
  "agent:main:discord:group:987654321": {
    "sessionId": "brisk-canyon",
    "updatedAt": 1711270800000,
    "sessionFile": "brisk-canyon.jsonl",
    "chatType": "group",
    "channel": "discord",
    "groupId": "987654321",
    "subject": "Project Discussion",
    "displayName": "discord:g-project-discussion",
    "origin": {
      "provider": "discord",
      "surface": "discord",
      "chatType": "group"
    },
    "deliveryContext": {
      "channel": "discord",
      "to": "987654321",
      "accountId": "bot-456"
    },
    "lastChannel": "discord",
    "lastTo": "987654321",
    "lastAccountId": "bot-456",
    "groupActivation": "mention"
  },
  "group:5c518b01-5764-455b-adc1-4184dc0f179c:main": {
    "sessionId": "swift-meadow",
    "updatedAt": 1711274400000,
    "sessionFile": "swift-meadow.jsonl",
    "chatType": "group"
  }
}
```

> 注意：通过 `sessions.list` API 返回时，`group:5c518b01-...:main` 会被 `loadCombinedSessionStoreForGateway` 规范化为 `agent:<默认agentId>:group:5c518b01-...:main`（`<默认agentId>` 为该 store 文件归属的 agent，即对话产生时的默认 agent）。

```

## 附录 B: 环境变量参考

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `OPENCLAW_SESSION_CACHE_TTL_MS` | Session store 缓存 TTL（毫秒） | `45000` |

## 附录 C: 关键常量

| 常量 | 值 | 来源 |
|------|---|------|
| `DEFAULT_AGENT_ID` | `"main"` | `src/routing/session-key.ts` |
| `DEFAULT_MAIN_KEY` | `"main"` | `src/routing/session-key.ts` |
| `GROUP_SESSION_KEY_PREFIX` | `"group:"` | `src/group-chat/group-session-key.ts` |
| `DEFAULT_SESSION_STORE_TTL_MS` | `45000` | `src/config/sessions/store.ts` |
| `DEFAULT_STALE_MS` (锁) | `1800000` (30 分钟) | `src/agents/session-write-lock.ts` |
| `DEFAULT_MAX_HOLD_MS` (锁) | `300000` (5 分钟) | `src/agents/session-write-lock.ts` |
| `DEFAULT_IDLE_MINUTES` | `60` | `src/config/sessions/types.ts` |
| `DEFAULT_RESET_TRIGGER` | `"/new"` | `src/config/sessions/types.ts` |
```
