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

  // 5. Constraints
  sections.push(`### Important Constraints
- You are in **read-only mode**: you cannot write files, execute commands, or modify configurations
- Use the \`group_reply\` tool to send messages in this group chat
- Include \`mentions\` in group_reply to @-mention specific agents when you need their help
- Avoid circular conversations — if the task is done, stop replying
- Keep responses concise and focused`);

  return sections.join("\n\n");
}
