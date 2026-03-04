/**
 * Group Chat — Anti-Loop Mechanism
 *
 * Prevents infinite Agent-to-Agent conversation loops.
 * Two limits enforced:
 *  1. Max total rounds per Owner message
 *  2. Max consecutive triggers of the same Agent
 */

import type { ConversationChainState, GroupSessionEntry } from "./types.js";

/**
 * Check whether an agent can be triggered in the current chain.
 */
export function canTriggerAgent(
  chainState: ConversationChainState,
  agentId: string,
  meta: GroupSessionEntry,
): { allowed: boolean; reason?: string } {
  if (chainState.roundCount >= meta.maxRounds) {
    return { allowed: false, reason: "max_rounds_exceeded" };
  }

  const count = chainState.agentTriggerCounts.get(agentId) ?? 0;
  if (count >= meta.maxConsecutive) {
    return { allowed: false, reason: "max_consecutive_exceeded" };
  }

  return { allowed: true };
}

/**
 * Update chain state after an agent completes its reply.
 */
export function updateChainState(
  state: ConversationChainState,
  agentId: string,
): ConversationChainState {
  const newCounts = new Map(state.agentTriggerCounts);

  if (state.lastTriggeredAgentId === agentId) {
    newCounts.set(agentId, (newCounts.get(agentId) ?? 0) + 1);
  } else {
    newCounts.set(agentId, 1);
  }

  return {
    ...state,
    roundCount: state.roundCount + 1,
    agentTriggerCounts: newCounts,
    lastTriggeredAgentId: agentId,
  };
}

/**
 * Create a fresh chain state when the Owner sends a new message.
 */
export function createChainState(originMessageId: string): ConversationChainState {
  return {
    originMessageId,
    roundCount: 0,
    agentTriggerCounts: new Map(),
  };
}
