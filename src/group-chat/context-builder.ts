/**
 * Group Chat — Context Builder
 *
 * Builds the extraSystemPrompt section injected into each agent's
 * system prompt when reasoning in a group chat context.
 *
 * Includes: group info, member list, announcement, role prompt, constraints.
 */

import { resolveProjectMemoryPaths, sanitizeGroupDirName } from "./bridge-memory.js";
import { buildPlanModeAssistantPrompt, buildPlanModeExecutorPrompt } from "./plan-mode-context.js";
import { resolveRolePrompt } from "./role-prompt.js";
import type { GroupSessionEntry } from "./types.js";
import { isBridgeAssistant } from "./types.js";

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
  const roleName =
    member.role === "assistant"
      ? "Assistant (coordinator)"
      : member.role === "bridge-assistant"
        ? "Bridge Assistant (CLI monitor)"
        : member.bridge
          ? "Bridge Agent (CLI)"
          : "Member";
  const modeDesc =
    meta.messageMode === "unicast"
      ? "Unicast — messages without @mentions go to the assistant only"
      : "Broadcast — messages without @mentions go to all members in parallel";

  sections.push(`## Group Chat Context

You are currently in group chat "${meta.groupName ?? meta.groupId}" (ID: ${meta.groupId}).
Your role: **${roleName}**
Your agentId: \`${agentId}\`
Message mode: ${modeDesc}`);

  // 2. Member list (exclude bridge-assistants for cleaner display)
  const memberLines = meta.members
    .filter((m) => !isBridgeAssistant(m.agentId))
    .map((m) => {
      const roleLabel =
        m.role === "assistant" ? "Assistant" : m.bridge ? "Bridge Agent (CLI)" : "Member";
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
  const isBridgeAgent = !!member.bridge;
  if (isBridgeAgent) {
    sections.push(`### Important Constraints
- You are a **Bridge Agent (CLI)**: you have full file read/write and command execution capabilities
- **Always respond when @-mentioned** — even for repeated questions
- Keep responses concise and focused
- Do NOT announce "let me ask..." — just ask directly with \`@agentId\`
- **Escape \`@\` with \`\\@\`** when you need to display it literally (emails, casual references)
- **Never output sensitive information** (API keys, passwords, tokens) in your responses`);
  } else {
    sections.push(`### Important Constraints
- You are in **read-only mode**: you cannot write files, execute commands, or modify configurations
- **Always respond when @-mentioned** — even for repeated questions
- Keep responses concise and focused
- Do NOT announce "let me ask..." — just ask directly with \`@agentId\`
- **Escape \`@\` with \`\\@\`** when you need to display it literally (emails, casual references)`);
  }

  // 7. Project memory context (file paths for awareness)
  const hasBridgeMembers = meta.members.some((m) => m.bridge);
  if (hasBridgeMembers) {
    const groupDirName = sanitizeGroupDirName(meta.groupName ?? meta.groupId, meta.groupId);
    const projectDir = meta.project?.directory;
    if (projectDir) {
      const memPaths = resolveProjectMemoryPaths(projectDir, groupDirName, agentId);
      sections.push(`### Project Memory

This group has a project-level memory system. Memory files are stored at:
- **Shared permanent memory**: \`${memPaths.sharedMemoryFile}\` — long-term project knowledge (architecture decisions, coding conventions, lessons learned)
- **Shared session memory**: \`${memPaths.sharedSessionFile}\` — current session progress and notes
- **Agent memory files**: \`${memPaths.dir}/{agentId}.md\` — each CLI agent's private memory

${
  member.role === "assistant"
    ? `As the **assistant (coordinator)**, you are the **memory manager**:
- You have **read/write** access to MEMORY.md and SESSION.md
- Other agents only have read access to shared files
- When performing memory merge/compact operations, read all agent memory files and consolidate key information into shared files
- Keep shared memory concise and well-organized`
    : `You have **read-only** access to shared memory files (MEMORY.md, SESSION.md).
Only the assistant agent can write to shared files.`
}`);
    } else {
      sections.push(`### Memory System (Temp Mode)

This group uses temporary memory mode (no project directory). Each CLI agent has a private memory file in the state directory. No shared memory files are available.`);
    }
  }

  // 8. Plan Mode context injection
  if (meta.planMode) {
    if (member.role === "assistant") {
      sections.push(buildPlanModeAssistantPrompt(meta));
    } else {
      sections.push(buildPlanModeExecutorPrompt(meta));
    }
  }

  return sections.join("\n\n");
}
