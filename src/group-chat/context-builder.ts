/**
 * Group Chat — Context Builder
 *
 * Builds the extraSystemPrompt section injected into each agent's
 * system prompt when reasoning in a group chat context.
 *
 * Includes: group info, member list, announcement, role prompt (interval-based),
 * communication guide, constraints, project memory (full injection),
 * core files, and plan mode context.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { resolveCliAgentIdentityDir } from "../agents/cli-agent-scope.js";
import {
  isEmptyTemplate,
  resolveProjectMemoryPaths,
  sanitizeGroupDirName,
  shouldInjectMemoryContent,
  shouldInjectMemoryPrompt,
  DEFAULT_MEMORY_CONTENT_INTERVAL,
  DEFAULT_MEMORY_PROMPT_INTERVAL,
} from "./bridge-memory.js";
import { type ContextConfig, DEFAULT_ROLE_REMINDER_INTERVAL } from "./bridge-types.js";
import { buildPlanModeAssistantPrompt, buildPlanModeExecutorPrompt } from "./plan-mode-context.js";
import { resolveRolePrompt } from "./role-prompt.js";
import type { GroupSessionEntry } from "./types.js";
import { isBridgeAssistant } from "./types.js";

// ─── Core File Definitions ───

/** Core files that have their content injected on first interaction. */
const CORE_CONTENT_FILES = ["PERSONALITY.md", "SOUL.md", "AGENTS.md"] as const;

/** All core files and their descriptive titles. */
const CORE_FILE_TITLES: Record<string, string> = {
  "IDENTITY.md": "Identity — who you are",
  "PERSONALITY.md": "Personality — your character traits",
  "SOUL.md": "Soul — your core principles",
  "AGENTS.md": "Project guidelines",
  "TOOLS.md": "Tools & environment notes",
};

// ─── File Helpers ───

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

// ─── Types ───

export type BuildGroupChatContextParams = {
  meta: GroupSessionEntry;
  agentId: string;
  groupId: string;
  isFirstInteraction: boolean;
  interactionCount: number;
  lastRoleReminderAt: number;
  contextConfig?: ContextConfig;
};

export type BuildGroupChatContextResult = {
  content: string;
  roleReminderSent: boolean;
};

/**
 * Build the group chat context string for injection into an agent's system prompt.
 *
 * This is an async function because memory content and core file injection
 * require reading files from disk.
 */
export async function buildGroupChatContext(
  params: BuildGroupChatContextParams,
): Promise<BuildGroupChatContextResult> {
  const {
    meta,
    agentId,
    groupId,
    isFirstInteraction,
    interactionCount,
    lastRoleReminderAt,
    contextConfig,
  } = params;
  const member = meta.members.find((m) => m.agentId === agentId);
  if (!member) {
    return { content: "", roleReminderSent: false };
  }

  const sections: string[] = [];
  let roleReminderSent = false;

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

  // 4. Role prompt — first interaction: full; subsequent: interval-based reminder
  const rolePrompt = resolveRolePrompt(agentId, member.role, meta.memberRolePrompts);
  const roleReminderInterval =
    contextConfig?.roleReminderInterval ?? DEFAULT_ROLE_REMINDER_INTERVAL;

  if (isFirstInteraction) {
    sections.push(`### Your Role
${rolePrompt}`);
  } else {
    const shouldSendRoleReminder = interactionCount - lastRoleReminderAt >= roleReminderInterval;
    if (shouldSendRoleReminder) {
      sections.push(`### Role Reminder
You are **${roleName}** (agentId: \`${agentId}\`) in group "${meta.groupName ?? meta.groupId}".

${rolePrompt}`);
      roleReminderSent = true;
    }
  }

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

  // 7. Project memory context — full injection with interval-based content/prompt
  await injectMemoryContext(sections, {
    meta,
    agentId,
    groupId,
    member,
    isFirstInteraction,
    interactionCount,
    contextConfig,
  });

  // 8. Core files — first interaction: content + paths; subsequent: paths only
  await injectCoreFiles(sections, { agentId, isFirstInteraction });

  // 9. Plan Mode context injection
  if (meta.planMode) {
    if (member.role === "assistant") {
      sections.push(buildPlanModeAssistantPrompt(meta));
    } else {
      sections.push(buildPlanModeExecutorPrompt(meta));
    }
  }

  return {
    content: sections.join("\n\n"),
    roleReminderSent,
  };
}

// ─── Memory Injection (Markdown format for LLM Agent) ───

async function injectMemoryContext(
  sections: string[],
  params: {
    meta: GroupSessionEntry;
    agentId: string;
    groupId: string;
    member: { role: string; bridge?: unknown };
    isFirstInteraction: boolean;
    interactionCount: number;
    contextConfig?: ContextConfig;
  },
): Promise<void> {
  const { meta, agentId, isFirstInteraction, interactionCount, contextConfig } = params;
  const memoryConfig = contextConfig?.memory;
  const contentInterval = memoryConfig?.contentInterval ?? DEFAULT_MEMORY_CONTENT_INTERVAL;
  const promptInterval = memoryConfig?.promptInterval ?? DEFAULT_MEMORY_PROMPT_INTERVAL;

  const groupDirName = sanitizeGroupDirName(meta.groupName ?? meta.groupId, meta.groupId);
  const projectDir = meta.project?.directory;

  const injectContent = shouldInjectMemoryContent(
    isFirstInteraction,
    interactionCount,
    contentInterval,
  );
  const injectPrompt = shouldInjectMemoryPrompt(
    isFirstInteraction,
    interactionCount,
    promptInterval,
  );

  if (projectDir) {
    const memPaths = resolveProjectMemoryPaths(projectDir, groupDirName, agentId);

    // Memory file paths — every interaction
    sections.push(`### Project Memory

This group has a project-level memory system. Memory files are stored at:
- **Shared permanent memory**: \`${memPaths.sharedMemoryFile}\` — long-term project knowledge (architecture decisions, coding conventions, lessons learned)
- **Shared session memory**: \`${memPaths.sharedSessionFile}\` — current session progress and notes
- **Agent memory files**: \`${memPaths.dir}/{agentId}.md\` — each CLI agent's private memory

You have **read-only** access to all memory files. Memory files are maintained by CLI (Bridge) agents.`);

    // Memory content — injected at contentInterval
    if (injectContent) {
      const contentParts: string[] = [];

      const memoryContent = await readFileOrNull(memPaths.sharedMemoryFile);
      if (memoryContent) {
        contentParts.push(`**Shared Permanent Memory (MEMORY.md) — Latest Snapshot:**

\`\`\`
${memoryContent}
\`\`\``);
      }

      const sessionContent = await readFileOrNull(memPaths.sharedSessionFile);
      if (sessionContent && !isEmptyTemplate(sessionContent)) {
        contentParts.push(`**Shared Session Memory (SESSION.md) — Latest Snapshot:**

\`\`\`
${sessionContent}
\`\`\``);
      }

      const agentContent = await readFileOrNull(memPaths.agentMemoryFile);
      if (agentContent && !isEmptyTemplate(agentContent)) {
        contentParts.push(`**Agent Memory (${agentId}.md) — Latest Snapshot:**

\`\`\`
${agentContent}
\`\`\``);
      }

      if (contentParts.length > 0) {
        sections.push(`### Memory Content

${contentParts.join("\n\n")}`);
      }
    }

    // Memory management prompt — injected at promptInterval (read-only version for LLM Agent)
    if (injectPrompt) {
      sections.push(`### Memory System Guidelines

You have **read-only** access to the project memory system. You **cannot** write to memory files — only CLI (Bridge) agents can write to them.

When you notice important information that should be remembered (architecture decisions, bugs, conventions), you can:
1. Ask a CLI agent to record it by @-mentioning them
2. Reference memory files in your responses to provide context

Memory files:
- \`MEMORY.md\` — shared permanent memory (architecture, conventions, lessons learned)
- \`SESSION.md\` — shared session memory (current progress, blockers)
- \`{agentId}.md\` — each CLI agent's private memory`);
    }
  } else {
    // Temp memory mode — no project directory
    sections.push(`### Memory System (Temp Mode)

This group uses temporary memory mode (no project directory). Each CLI agent has a private memory file in the state directory. No shared memory files are available.

You have **read-only** access. Only CLI (Bridge) agents can write to memory files.`);
  }
}

// ─── Core Files Injection (Markdown format for LLM Agent) ───

async function injectCoreFiles(
  sections: string[],
  params: {
    agentId: string;
    isFirstInteraction: boolean;
  },
): Promise<void> {
  const { agentId, isFirstInteraction } = params;

  // Resolve CLI Agent identity directory — LLM agents may not have one
  const identityDir = resolveCliAgentIdentityDir(agentId);
  const dirExists = await directoryExists(identityDir);
  if (!dirExists) {
    return; // No identity directory for this agent — skip core files
  }

  if (isFirstInteraction) {
    // First interaction: inject file content + paths
    const contentParts: string[] = [];

    const readResults = await Promise.all(
      CORE_CONTENT_FILES.map(async (fileName) => ({
        fileName,
        content: await readFileOrNull(path.join(identityDir, fileName)),
      })),
    );

    for (const { fileName, content } of readResults) {
      const title = CORE_FILE_TITLES[fileName] ?? fileName;
      if (content && content.trim()) {
        contentParts.push(`**${fileName}** — ${title}:

\`\`\`
${content.trim()}
\`\`\``);
      }
    }

    if (contentParts.length > 0) {
      sections.push(`### Core Files

These files define your personality, principles, and project guidelines.

${contentParts.join("\n\n")}`);
    }

    // Always inject path section on first interaction
    sections.push(buildCoreFilesPathMarkdown(identityDir));
  } else {
    // Subsequent interactions: paths only
    sections.push(buildCoreFilesPathMarkdown(identityDir));
  }
}

function buildCoreFilesPathMarkdown(identityDir: string): string {
  const lines = [
    `### Core File Paths

These files are available for reference:`,
  ];

  for (const [fileName, title] of Object.entries(CORE_FILE_TITLES)) {
    lines.push(`- **${fileName}** — ${title}: \`${path.join(identityDir, fileName)}\``);
  }

  return lines.join("\n");
}
