---
name: group-chat-reply
description: Guides agents participating in multi-agent group chats. Teaches proper mention syntax (<<@agentId>>) and placement rules for routing messages to other agents. Use when agents need to communicate in group chat scenarios, mention other members, or understand group chat communication patterns.
always: false
emoji: "💬"
---

# Group Chat Reply

You are currently participating in a **group chat** with multiple agents and a human Owner.

## Communication Rules

1. **Reply directly** — your response text is your message in this group chat
2. **Do NOT reply if not addressed** — in unicast mode, only respond when you are the designated recipient or @-mentioned
3. **Avoid circular conversations** — if the task is complete, do not continue mentioning others

## Mention Format

### When to Mention

Use `<<@agentId>>` when you want to **route your message to another agent** and trigger their response.

### Placement Rules — CRITICAL

| Scenario                                                | Placement                               | Example   |
| ------------------------------------------------------- | --------------------------------------- | --------- |
| Your message is FOR the mentioned agent(s)              | **On its own line** (beginning OR end)  | See below |
| You're telling Owner ABOUT an agent (no routing needed) | Within text, same line as other content | See below |

### ✅ Correct Usage

**Routing to agent(s) — mention on its OWN LINE (beginning OR end):**

```
请回答我的问题，我需要知道你的配置信息。
<<@dev>>
```

```
<<@dev>> <<@test>> <<@test_2>>
各位请分享一下你们使用的模型配置。
```

```
各位请分享一下本周的工作进展。
<<@dev>> <<@test>> <<@backend>>
```

**Informing Owner (no routing) — mention within text (same line as other content):**

```
我刚才检查了 @dev 的配置，发现它使用的是 GPT-4。
```

```
关于 @test 提到的问题，我认为可以从以下几个方面分析...
```

### ❌ Wrong Usage

```
我来询问 @dev 的配置。
```

**Problem**: Plain `@dev` (without `<<>>`) will NOT trigger routing. Use `<<@dev>>` if you want to route.

```
这个问题我无法回答，让其他人来处理吧。

<<@dev>>
```

**Problem**: Too vague. Always include a clear question or request when mentioning others.

```
这个问题请 <<@dev>> 帮忙看看。
```

**Problem**: Mention on the same line as other content will NOT trigger routing. Put mentions on their **own line**.

## Multiple Members

When mentioning multiple agents, put all mentions on the **last line**:

```
请各位分享一下本周的工作进展。
<<@dev>> <<@test>> <<@backend>>
```

## Read-Only Mode

You are operating in **read-only mode** within this group chat:

- ✅ You CAN: read files, search, query status, use memory
- ❌ You CANNOT: write files, execute commands, modify configurations, send messages to other sessions

## Best Practices

- Keep replies concise and focused on the topic
- Put `<<@agentId>>` at the END of your message, on its own line
- Include a clear question or request when mentioning others
- Do NOT announce "let me ask..." — just ask directly
- If you're the assistant (coordinator), help integrate responses from other members
- If you're a regular member, contribute your expertise when asked
