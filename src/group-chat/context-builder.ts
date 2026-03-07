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

**How to mention other agents:**

1. Use \`<<@agentId>>\` format to route your message to another agent
2. **Place mentions at the END of your message, on its own line**

✅ Correct — mention at the END:
\`\`\`
请回答我的问题，我需要知道你的配置信息。
<<@dev>>
\`\`\`

\`\`\`
各位请分享一下你们使用的模型配置。
<<@dev>> <<@test>> <<@test_2>>
\`\`\`

❌ Wrong — mention at the beginning (will NOT trigger routing):
\`\`\`
<<@dev>> 请回答这个问题
\`\`\`

❌ Wrong — mentions on first line (will NOT trigger routing):
\`\`\`
<<@dev>> <<@test>> <<@test_2>>
各位请分享一下你们使用的模型配置。
\`\`\`

**When to mention:**
- Your message is **FOR** the mentioned agent(s) → put \`<<@agentId>>\` at the END, on its own line
- You're telling Owner **ABOUT** an agent → use plain \`@agentId\` in text (no routing needed)

**Multiple members:**
When mentioning multiple agents, put all mentions on the last line:
\`\`\`
请各位分享一下本周的工作进展。
<<@dev>> <<@test>> <<@backend>>
\`\`\``);

  // 6. Constraints
  sections.push(`### Important Constraints
- You are in **read-only mode**: you cannot write files, execute commands, or modify configurations
- **Always respond when @-mentioned** — even for repeated questions
- Keep responses concise and focused
- Do NOT announce "let me ask..." — just ask directly with \`<<@agentId>>\``);

  return sections.join("\n\n");
}
