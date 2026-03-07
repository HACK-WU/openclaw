/**
 * Group Chat — Context Builder
 *
 * Builds the extraSystemPrompt section injected into each agent's
 * system prompt when reasoning in a group chat context.
 *
 * Includes: group info, member list, announcement, role prompt, constraints.
 */

import { resolveRolePrompt } from "./role-prompt.js";
import type { GroupSessionEntry } from "./types.js";

/**
 * Build the group chat context string for injection into an agent's system prompt.
 */
export function buildGroupChatContext(params: {
  meta: GroupSessionEntry;
  agentId: string;
}): string {
  const { meta, agentId } = params;
  const member = meta.members.find((m) => m.agentId === agentId);
  if (!member) {
    return "";
  }

  const sections: string[] = [];

  // 1. Group info
  const roleName = member.role === "assistant" ? "Assistant (coordinator)" : "Member";
  const modeDesc =
    meta.messageMode === "unicast"
      ? "Unicast — messages without @mentions go to the assistant only"
      : "Broadcast — messages without @mentions go to all members in parallel";

  sections.push(`## Group Chat Context

You are currently in group chat "${meta.groupName ?? meta.groupId}" (ID: ${meta.groupId}).
Your role: **${roleName}**
Your agentId: \`${agentId}\`
Message mode: ${modeDesc}`);

  // 2. Member list
  const memberLines = meta.members.map((m) => {
    const roleLabel = m.role === "assistant" ? "Assistant" : "Member";
    const selfMark = m.agentId === agentId ? " ← you" : "";
    return `- **${m.agentId}** — ${roleLabel}${selfMark}`;
  });
  sections.push(`### Group Members
- **Owner** (creator, human user)
${memberLines.join("\n")}`);

  // 3. Announcement
  if (meta.announcement) {
    sections.push(`### Group Announcement
${meta.announcement}`);
  }

  // 4. Role prompt
  const rolePrompt = resolveRolePrompt(agentId, member.role, meta.memberRolePrompts);
  sections.push(`### Your Role
${rolePrompt}`);

  // 5. Communication Guide
  sections.push(`### Communication Guide

**⚠️ IMPORTANT: @ Symbol Has Special Meaning**

In group chat, the \`@\` symbol is **reserved for mentioning agents**. Do NOT use \`@\` casually in your messages.

| What you want | How to write it | Example |
|---------------|-----------------|---------|
| Route to an agent | \`@agentId\` on its own line | \`@dev\` |
| Display \`@\` literally | Escape with \`\\@\` | \`\\@dev\` or \`\\@mention\` |
| Email address | Escape the \`@\` | \`user\\@example.com\` |

**How to mention other agents:**

Use \`@agentId\` on its **own line** to route your message to another agent.

✅ Correct — mention on its own line at the END:
\`\`\`
请回答我的问题，我需要知道你的配置信息。
@dev
\`\`\`

✅ Correct — mention on its own line at the BEGINNING:
\`\`\`
@dev @test @test_2
各位请分享一下你们使用的模型配置。
\`\`\`

✅ Correct — multiple mentions on the last line:
\`\`\`
请各位分享一下本周的工作进展。
@dev @test @backend
\`\`\`

✅ Correct — escape @ when you want to display it literally:
\`\`\`
联系我: user\\@example.com
\`\`\`

❌ Wrong — mention on the same line as other content (will NOT trigger routing):
\`\`\`
这个问题请 @dev 帮忙看看。
\`\`\`

**When to mention:**
- Your message is **FOR** the mentioned agent(s) → put \`@agentId\` on its OWN LINE
- You're telling Owner **ABOUT** an agent → use \`@agentId\` in text (shows with highlight, no routing)

**Key rule:** Mentions on a line with ONLY other mentions (no other text) will trigger routing. Mentions on a line with OTHER CONTENT will NOT trigger routing.`);

  // 6. Constraints
  sections.push(`### Important Constraints
- You are in **read-only mode**: you cannot write files, execute commands, or modify configurations
- **Always respond when @-mentioned** — even for repeated questions
- Keep responses concise and focused
- Do NOT announce "let me ask..." — just ask directly with \`@agentId\`
- **Escape \`@\` with \`\\@\`** when you need to display it literally (emails, casual references)`);

  return sections.join("\n\n");
}
