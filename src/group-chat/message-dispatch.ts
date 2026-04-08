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
    // Build a lookup map for quick member resolution
    const memberMap = new Map(members.map((m) => [m.agentId, m]));

    // Preserve @mention order so that unicast mode triggers agents sequentially
    // in the order the user listed them. Filter out sender and bridge-assistants.
    const targets = expandedMentions
      .filter((id) => id !== senderAgentId && !isBridgeAssistant(id))
      .map((id) => memberMap.get(id))
      .filter((m): m is NonNullable<typeof m> => m !== undefined)
      .map((m) => ({ agentId: m.agentId, role: m.role }));

    // In unicast mode, keep mode as "unicast" so the gateway triggers agents
    // serially (one-by-one) rather than in parallel.
    const mode = messageMode === "unicast" ? "unicast" : "mention";
    return { targets, mode };
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
