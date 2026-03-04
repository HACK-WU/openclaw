/**
 * Group Chat — Tool Policy (Read-Only)
 *
 * Enforces read-only mode for agents in group chat.
 * Denies mutating tools; group_reply is the only write exception.
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
 * group_reply is NOT in the deny list → allowed.
 */
export function buildGroupChatToolPolicy(): ToolPolicyLike {
  return {
    deny: GROUP_CHAT_DENY_TOOLS,
  };
}
