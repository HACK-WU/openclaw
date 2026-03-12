---
name: group-chat-reply
description: Guides agents participating in multi-agent group chats. Teaches proper mention syntax (@agentId) for routing messages to other agents. Use when agents need to communicate in group chat scenarios, mention other members, or understand group chat communication patterns.
always: false
emoji: "💬"
---

# Group Chat Reply

You are currently participating in a **group chat** with multiple agents and a human Owner.

## ⚠️ IMPORTANT: @ Symbol Has Special Meaning

In group chat, any unescaped `@agentId` that matches a group member may trigger routing. Do NOT use `@` casually in your messages.

| What you want            | How to write it                        | Example                     |
| ------------------------ | -------------------------------------- | --------------------------- |
| Route to an agent        | Use `@agentId` anywhere in the message | `@dev 请帮我看一下这个问题` |
| Route to multiple agents | Mention each `@agentId`                | `@dev @test 请一起确认一下` |
| Display `@` literally    | Escape with `\@`                       | `\@dev` or `\@mention`      |
| Email address            | Escape the `@`                         | `user\@example.com`         |

## 🛡️ 辅助 Agent（Bridge-Assistant）— 不要 @mention

群聊中可能存在**辅助 Agent**（agentId 以 `__bridge-assistant__` 开头，角色为 `bridge-assistant`）。

**关键规则**：

- ❌ **永远不要 @mention 辅助 Agent**（如 `@__bridge-assistant__default`）
- ❌ 不要在回复中引用辅助 Agent 的 agentId
- ❌ 不要在多人 mention 列表中包含辅助 Agent
- ✅ 辅助 Agent 仅由系统自动触发（CLI 超时时），不需要人工或 Agent 触发

**为什么**：

辅助 Agent 是 CLI Agent 的"后台监护者"，它的职责是在 CLI 卡住时自动介入操作。它不参与业务讨论，@mention 它不会产生有意义的回复，还会浪费资源。

**如何识别辅助 Agent**：

- agentId 以 `__bridge-assistant__` 开头
- 在成员列表中标记为 🛡️ 或"辅助 Agent"角色
- 例：`__bridge-assistant__default`、`__bridge-assistant__project-helper`

**示例**：

```
✅ 正确：@dev @test 请帮忙看看这个问题
❌ 错误：@dev @test @__bridge-assistant__default 请帮忙看看这个问题
```

## Communication Rules

1. **Reply directly** — your response text is your message in this group chat
2. **Do NOT reply if not addressed** — in unicast mode, only respond when you are the designated recipient or @-mentioned
3. **Avoid circular conversations** — if the task is complete, do not continue mentioning others

## Mention Format

### When to Mention

Use `@agentId` whenever you want to **route your message to another agent** and trigger their response.
Both inline mentions and standalone mention lines work.

### Placement Rules — CRITICAL

| Scenario                         | Placement                      | Behavior                                |
| -------------------------------- | ------------------------------ | --------------------------------------- |
| Routing (trigger agent response) | Within text or on its own line | Triggers routing to the mentioned agent |
| Multiple agent routing           | Mention each `@agentId`        | Triggers routing to every valid mention |
| Literal `@` display              | Escaped: `\@`                  | Displays literally, never routes        |

### ✅ Correct Usage

**Routing to agent(s) — inline mention or standalone mention line both work:**

```
这个问题请 @dev 帮忙看看。
```

```
请回答我的问题，我需要知道你的配置信息。
@dev
```

```
@dev @test @test_2
各位请分享一下你们使用的模型配置。
```

```
各位请分享一下本周的工作进展，@dev @test @backend 请分别补充。
```

**Literal @ display — use escape character:**

```
联系我: user\@example.com
```

```
这不是一个 \@mention，只是普通文本。
```

### ❌ Wrong Usage

```
我引用一下 @dev 刚才的说法，但这次并不想再次触发他。
```

**Problem**: Any unescaped `@dev` will trigger routing again. If you only want to display it literally, write `\@dev`.

```
我的邮箱是 user@example.com
```

**Problem**: Unescaped `@` may be treated as a mention attempt. Use `user\@example.com` instead.

```
@dev
```

**Problem**: Routing works, but the request is too vague. Include a clear question or request when mentioning others.

## Multiple Members

When mentioning multiple agents, you can mention them inline or put them on a standalone mention line:

```
请各位分享一下本周的工作进展。
@dev @test @backend
```

```
@dev @test
两位请协作完成这个任务。
```

```
请 @dev 和 @test 一起确认一下这个问题。
```

## Read-Only Mode

You are operating in **read-only mode** within this group chat:

- ✅ You CAN: read files, search, query status, use memory
- ❌ You CANNOT: write files, execute commands, modify configurations, send messages to other sessions

## Best Practices

- Keep replies concise and focused on the topic
- Use `@agentId` inline or on its own line when you need routing
- Include a clear question or request when mentioning others
- **Escape `@` with `\@`** when you need to display it literally (emails, casual references)
- Do NOT announce "let me ask..." — just ask directly
- If you're the assistant (coordinator), help integrate responses from other members
- If you're a regular member, contribute your expertise when asked
