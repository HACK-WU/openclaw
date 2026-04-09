/**
 * Group Chat — LLM Agent State
 *
 * In-memory state storage for LLM Agent interaction tracking.
 * Provides the interaction counter needed for interval-based injection
 * (role reminders, memory content, memory management prompts).
 *
 * Key design:
 * - All LLM agents share the same Map, keyed by `${groupId}:${agentId}`
 * - State is created on first `incrementLlmInteraction()` call
 * - `getLlmAgentState()` returning `undefined` means the agent has never been triggered
 * - Cleared on group delete via `clearLlmAgentStates(groupId)`
 */

// ─── Types ───

export type LlmAgentState = {
  /** Number of completed interactions (incremented after each successful triggerAgentReasoning). */
  interactionCount: number;
  /** Whether this agent has NOT yet completed any interaction in this session. */
  isFirstInteraction: boolean;
  /** interactionCount value at the time of the last role reminder injection. */
  lastRoleReminderAt: number;
};

// ─── State Storage ───

const store = new Map<string, LlmAgentState>();

function stateKey(groupId: string, agentId: string): string {
  return `${groupId}:${agentId}`;
}

// ─── Public API ───

/**
 * Get the current LLM agent state.
 * Returns `undefined` if the agent has never been triggered (first interaction).
 */
export function getLlmAgentState(groupId: string, agentId: string): LlmAgentState | undefined {
  return store.get(stateKey(groupId, agentId));
}

/**
 * Increment the interaction counter after a successful triggerAgentReasoning().
 * Creates the state entry on first call.
 */
export function incrementLlmInteraction(groupId: string, agentId: string): LlmAgentState {
  const key = stateKey(groupId, agentId);
  const existing = store.get(key);

  if (existing) {
    existing.interactionCount++;
    return existing;
  }

  // First increment — agent just completed its first interaction
  const state: LlmAgentState = {
    interactionCount: 1,
    isFirstInteraction: false,
    lastRoleReminderAt: 0,
  };
  store.set(key, state);
  return state;
}

/**
 * Update `lastRoleReminderAt` to the current `interactionCount`.
 * No-op if the agent state doesn't exist.
 */
export function updateLastRoleReminder(groupId: string, agentId: string): void {
  const state = store.get(stateKey(groupId, agentId));
  if (state) {
    state.lastRoleReminderAt = state.interactionCount;
  }
}

/**
 * Reset (delete) a single agent's state.
 */
export function resetLlmAgentState(groupId: string, agentId: string): void {
  store.delete(stateKey(groupId, agentId));
}

/**
 * Clear all LLM agent states for a given group.
 * Called during group deletion cleanup.
 */
export function clearLlmAgentStates(groupId: string): void {
  const prefix = `${groupId}:`;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}

/**
 * Clear all LLM agent states (all groups). Used for testing.
 */
export function clearAllLlmAgentStates(): void {
  store.clear();
}

// ─── Exports for testing ───

export const _test = {
  getStore: () => store,
};
