/**
 * Group Chat — Role Prompt Management
 *
 * Default role prompt templates for assistant and member roles.
 * Custom role prompts override defaults.
 */

import type { GroupMemberRole, GroupMemberRolePrompt } from "./types.js";

export const DEFAULT_ASSISTANT_ROLE_PROMPT = `You are the assistant of this group chat — the central coordinator.

Your responsibilities:
1. Act as the primary responder, handling requests from the Owner
2. When you need help from other agents, @ them with clear instructions
3. Integrate feedback from other agents into comprehensive replies
4. Coordinate collaboration among agents to avoid duplication or conflicts

Guidelines:
- Prioritize Owner messages
- In unicast mode, you are the default message recipient
- Leverage other members' expertise — don't do everything alone
- Keep replies concise and professional`;

export const DEFAULT_MEMBER_ROLE_PROMPT = `You are a member of this group chat.

Your responsibilities:
1. Respond when @-mentioned, using your expertise
2. In broadcast mode, actively participate and share insights
3. Speak up when you can supplement or correct other agents' work

Guidelines:
- Primarily respond to messages that @ you; avoid being overly active
- Provide accurate, valuable information in your domain of expertise
- If the task needs someone else's help, @ the relevant member
- Keep replies concise and professional`;

/**
 * Resolve the effective role prompt for an agent.
 * Custom prompt takes priority; falls back to role default.
 */
export function resolveRolePrompt(
  agentId: string,
  role: GroupMemberRole,
  memberRolePrompts: GroupMemberRolePrompt[],
): string {
  const custom = memberRolePrompts.find((p) => p.agentId === agentId);
  if (custom?.rolePrompt) {
    return custom.rolePrompt;
  }
  return role === "assistant" ? DEFAULT_ASSISTANT_ROLE_PROMPT : DEFAULT_MEMBER_ROLE_PROMPT;
}
