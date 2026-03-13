/**
 * Group Chat — Message Dispatch Engine
 *
 * Resolves which agents should receive a message based on:
 * - Explicit @mentions
 * - Message mode (unicast / broadcast)
 * - Sender identity (agents don't trigger themselves)
 */

import type { DispatchResult, GroupChatMessage, GroupSessionEntry } from "./types.js";
import { isBridgeAssistant } from "./types.js";

/**
 * Core dispatch function.
 *
 * Rules:
 * 1. Has mentions → route only to mentioned agents (mention mode)
 * 2. No mentions + unicast → route to assistant only
 * 3. No mentions + broadcast → route to all members
 *
 * Special:
 * - Sender agent is excluded from targets (no self-trigger)
 * - Mentioned agentIds must be current group members
 * - Bridge-assistant agents are always excluded from dispatch
 *   (they are triggered by the system only, not by user/agent messages)
 */
export function resolveDispatchTargets(
  meta: GroupSessionEntry,
  message: GroupChatMessage,
): DispatchResult {
  const { members, messageMode } = meta;

  // Check for @all mention
  const hasAllMention = message.mentions?.includes("all") ?? false;

  // Filter valid mentions — exclude @all from normal filtering AND exclude bridge-assistants
  const mentions =
    message.mentions?.filter(
      (id) => !isBridgeAssistant(id) && (id === "all" || members.some((m) => m.agentId === id)),
    ) ?? [];

  // Expand @all to all members, excluding bridge-assistants
  const expandedMentions = hasAllMention
    ? members.filter((m) => !isBridgeAssistant(m.agentId)).map((m) => m.agentId)
    : mentions;

  // Exclude sender from targets
  const senderAgentId = message.sender.type === "agent" ? message.sender.agentId : undefined;

  if (expandedMentions.length > 0) {
    const targets = members
      .filter(
        (m) =>
          expandedMentions.includes(m.agentId) &&
          m.agentId !== senderAgentId &&
          !isBridgeAssistant(m.agentId),
      )
      .map((m) => ({ agentId: m.agentId, role: m.role }));
    return { targets, mode: "mention" };
  }

  if (messageMode === "unicast") {
    const assistant = members.find((m) => m.role === "assistant");
    if (!assistant || assistant.agentId === senderAgentId) {
      return { targets: [], mode: "unicast" };
    }
    return {
      targets: [{ agentId: assistant.agentId, role: assistant.role }],
      mode: "unicast",
    };
  }

  // Broadcast: all members except sender AND bridge-assistants
  const targets = members
    .filter((m) => m.agentId !== senderAgentId && !isBridgeAssistant(m.agentId))
    .map((m) => ({ agentId: m.agentId, role: m.role }));
  return { targets, mode: "broadcast" };
}
