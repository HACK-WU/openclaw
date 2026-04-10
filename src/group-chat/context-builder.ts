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
  ensureProjectMemoryFiles,
  ensureTempMemoryFiles,
  resolveProjectMemoryPaths,
  resolveTempMemoryPaths,
  sanitizeGroupDirName,
  shouldInjectAnnouncement,
  shouldInjectMemoryContent,
  shouldInjectMemoryPrompt,
  DEFAULT_MEMORY_CONTENT_INTERVAL,
  DEFAULT_MEMORY_PROMPT_INTERVAL,
} from "./bridge-memory.js";
import {
  type ContextConfig,
  DEFAULT_ANNOUNCEMENT_INTERVAL,
  DEFAULT_ROLE_REMINDER_INTERVAL,
} from "./bridge-types.js";
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

  // 3. Announcement — first interaction: always; subsequent: interval-based
  if (meta.announcement) {
    const announcementInterval =
      contextConfig?.announcementInterval ?? DEFAULT_ANNOUNCEMENT_INTERVAL;
    if (shouldInjectAnnouncement(isFirstInteraction, interactionCount, announcementInterval)) {
      sections.push(`### Group Announcement
${meta.announcement}`);
    }
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
- You are an **LLM Agent**: you can read/write files and use tools, but **OpenClaw core configuration is read-only** (you cannot modify agent settings, routing rules, or system configs)
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

    // Ensure memory files exist (creates agent's {agentId}.md, MEMORY.md, SESSION.md if missing)
    await ensureProjectMemoryFiles(projectDir, groupDirName, agentId);

    // Memory file paths — every interaction
    sections.push(`### Project Memory

This group has a project-level memory system. Memory files are stored at:
- **Shared permanent memory**: \`${memPaths.sharedMemoryFile}\` — long-term project knowledge (architecture decisions, coding conventions, lessons learned)
- **Shared session memory**: \`${memPaths.sharedSessionFile}\` — current session progress and notes
- **Your agent memory**: \`${memPaths.agentMemoryFile}\` — your private memory file (read/write)

You can **read and write** your own agent memory file (\`${agentId}.md\`). Shared memory files (\`MEMORY.md\`, \`SESSION.md\`) are read-only — they are maintained by the assistant agent.`);

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
        contentParts.push(`**Your Agent Memory (${agentId}.md) — Latest Snapshot:**

\`\`\`
${agentContent}
\`\`\``);
      }

      if (contentParts.length > 0) {
        sections.push(`### Memory Content

${contentParts.join("\n\n")}`);
      }
    }

    // Memory management prompt — injected at promptInterval
    if (injectPrompt) {
      sections.push(`### Memory System Guidelines

You have a private agent memory file (\`${agentId}.md\`) that you can **read and write**. Use it to record important information you discover during your work.

**What to record in your memory (Permanent section):**
- Architecture decisions, coding conventions, lessons learned
- Bugs or unexpected behaviors discovered
- Key code paths and module responsibilities
- Undocumented API behaviors or environment quirks

**What to record (Session section):**
- Current task progress and blockers
- Collaboration notes with other agents

**What NOT to record:**
- Routine commands (npm install, git pull)
- File contents you just read
- Obvious project info already in README

**Rules:**
1. You can only write to your own memory file \`${agentId}.md\` — do NOT modify \`MEMORY.md\` or \`SESSION.md\` (read-only, maintained by the assistant)
2. Read the file before writing to avoid duplicates
3. Keep entries brief — one or two sentences per item
4. Use clean Markdown format

Memory file paths:
- Your memory: \`${memPaths.agentMemoryFile}\`
- Shared permanent: \`${memPaths.sharedMemoryFile}\` (read-only)
- Shared session: \`${memPaths.sharedSessionFile}\` (read-only)`);
    }
  } else {
    // Temp memory mode — no project directory
    const { resolveStateDir } = await import("../config/paths.js");
    const stateDir = resolveStateDir();
    const tempPaths = resolveTempMemoryPaths(stateDir, params.groupId, agentId);

    // Ensure temp memory files exist
    await ensureTempMemoryFiles(stateDir, params.groupId, agentId);

    sections.push(`### Memory System (Temp Mode)

This group uses temporary memory mode (no project directory). You have a private memory file:
- **Your agent memory**: \`${tempPaths.agentMemoryFile}\` — your private memory (read/write)

No shared memory files are available in temp mode. Record important information in your agent memory file.`);
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
