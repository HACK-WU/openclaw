/**
 * Group Chat — Anti-Loop Mechanism
 *
 * Prevents infinite Agent-to-Agent conversation loops.
 *
 * New design (simplified):
 * - roundCount increments when an agent is triggered (not after reply)
 * - roundCount resets to 0 when Owner sends a new message
 * - No per-agent tracking (maxConsecutive is deprecated)
 *
 * For the actual state management, use chain-state-store.ts which provides:
 * - In-memory state storage shared across all agents
 * - Atomic check-and-increment for broadcast mode
 */

import type { ConversationChainState, GroupSessionEntry } from "./types.js";

/**
 * Create a fresh chain state when the Owner sends a new message.
 *
 * @deprecated Use initChainState from chain-state-store.ts instead.
 * This function is kept for backward compatibility and testing.
 */
export function createChainState(originMessageId: string): ConversationChainState {
  return {
    originMessageId,
    roundCount: 0,
    startedAt: Date.now(),
    triggeredAgents: [],
    queuedMessages: [],
  };
}

/**
 * Update chain state after an agent is triggered.
 *
 * @deprecated Use atomicCheckAndIncrement from chain-state-store.ts instead.
 * This function is kept for backward compatibility and testing.
 */
export function updateChainState(state: ConversationChainState): ConversationChainState {
  return {
    ...state,
    roundCount: state.roundCount + 1,
  };
}

/**
 * Check whether an agent can be triggered in the current chain.
 *
 * @deprecated Use atomicCheckAndIncrement from chain-state-store.ts for production.
 * This function is kept for backward compatibility and testing.
 * Note: This is a synchronous check and does not include timeout checks.
 */
export function canTriggerAgent(
  chainState: ConversationChainState,
  _agentId: string, // kept for API compatibility, no longer used
  meta: GroupSessionEntry,
): { allowed: boolean; reason?: string } {
  // Only check maxRounds (Layer 1)
  // Layer 2 and timeout checks are handled in chain-state-store.ts
  if (chainState.roundCount >= meta.maxRounds) {
    return { allowed: false, reason: "max_rounds_exceeded" };
  }

  return { allowed: true };
}
