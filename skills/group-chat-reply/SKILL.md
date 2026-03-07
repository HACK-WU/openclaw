---
name: group-chat-reply
description: Guides agents participating in multi-agent group chats. Teaches proper mention syntax (@agentId) for routing messages to other agents. Use when agents need to communicate in group chat scenarios, mention other members, or understand group chat communication patterns.
always: false
emoji: "💬"
---

# Group Chat Reply

You are currently participating in a **group chat** with multiple agents and a human Owner.

## ⚠️ IMPORTANT: @ Symbol Has Special Meaning

In group chat, the `@` symbol is **reserved for mentioning agents**. Do NOT use `@` casually in your messages.

| What you want         | How to write it            | Example                |
| --------------------- | -------------------------- | ---------------------- |
| Route to an agent     | `@agentId` on its own line | `@dev`                 |
| Display `@` literally | Escape with `\@`           | `\@dev` or `\@mention` |
| Email address         | Escape the `@`             | `user\@example.com`    |

## Communication Rules

1. **Reply directly** — your response text is your message in this group chat
2. **Do NOT reply if not addressed** — in unicast mode, only respond when you are the designated recipient or @-mentioned
3. **Avoid circular conversations** — if the task is complete, do not continue mentioning others

## Mention Format

### When to Mention

Use `@agentId` on its **own line** when you want to **route your message to another agent** and trigger their response.

### Placement Rules — CRITICAL

| Scenario                         | Placement           | Behavior                              |
| -------------------------------- | ------------------- | ------------------------------------- |
| Routing (trigger agent response) | **Own line**, alone | Removes from display, routes to agent |
| Informal mention (no routing)    | Within text         | Displays with highlight, no routing   |
| Literal `@` display              | Escaped: `\@`       | Displays literally, never routes      |

### ✅ Correct Usage

**Routing to agent(s) — mention on its OWN LINE:**

```
请回答我的问题，我需要知道你的配置信息。
@dev
```

```
@dev @test @test_2
各位请分享一下你们使用的模型配置。
```

```
各位请分享一下本周的工作进展。
@dev @test @backend
```

**Informal mention (no routing) — mention within text:**

```
我刚才检查了 @dev 的配置，发现它使用的是 GPT-4。
```

This will display with `@dev` highlighted but will NOT trigger routing.

**Literal @ display — use escape character:**

```
联系我: user\@example.com
```

```
这不是一个 \@mention，只是普通文本。
```

### ❌ Wrong Usage

```
这个问题请 @dev 帮忙看看。
```

**Problem**: `@dev` on the same line as other text will NOT trigger routing. Put mentions on their **own line**.

```
我的邮箱是 user@example.com
```

**Problem**: Unescaped `@` will be treated as a mention attempt. Use `user\@example.com` instead.

```
这个问题我无法回答，让其他人来处理吧。

@dev
```

**Problem**: Too vague. Always include a clear question or request when mentioning others.

## Multiple Members

When mentioning multiple agents, put all mentions on the **same line** (at the beginning or end of your message):

```
请各位分享一下本周的工作进展。
@dev @test @backend
```

```
@dev @test
两位请协作完成这个任务。
```

## Read-Only Mode

You are operating in **read-only mode** within this group chat:

- ✅ You CAN: read files, search, query status, use memory
- ❌ You CANNOT: write files, execute commands, modify configurations, send messages to other sessions

## Best Practices

- Keep replies concise and focused on the topic
- Put `@agentId` on its **own line** to trigger routing
- Include a clear question or request when mentioning others
- **Escape `@` with `\@`** when you need to display it literally (emails, casual references)
- Do NOT announce "let me ask..." — just ask directly
- If you're the assistant (coordinator), help integrate responses from other members
- If you're a regular member, contribute your expertise when asked
