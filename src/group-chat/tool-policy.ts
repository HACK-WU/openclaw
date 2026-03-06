/**
 * Group Chat — Tool Policy (Read-Only)
 *
 * Enforces read-only mode for agents in group chat.
 * Denies all mutating tools. Agents communicate via <<@agentId>> markers
 * in their reply text; no dedicated group_reply tool is needed.
 */

import type { ToolPolicyLike } from "../agents/tool-policy.js";

/**
 * Denied tool names for group chat agents.
 * Aligns with MUTATING_TOOL_NAMES from tool-mutation.ts.
 */
const GROUP_CHAT_DENY_TOOLS = [
  "write",
  "edit",
  "apply_patch",
  "exec",
  "bash",
  "process",
  "message",
  "sessions_send",
  "cron",
  "gateway",
  "canvas",
  "nodes",
  "config",
  "session_status",
];

/**
 * Build the read-only tool policy for group chat agents.
 * All mutating tools are denied; agents use <<@agentId>> markers
 * in their reply text to trigger routing to other agents.
 */
export function buildGroupChatToolPolicy(): ToolPolicyLike {
  return {
    deny: GROUP_CHAT_DENY_TOOLS,
  };
}
