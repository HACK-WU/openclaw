/**
 * Group Chat — Chain State Store
 *
 * In-memory state storage for conversation chain management.
 * Provides atomic operations for roundCount in both unicast and broadcast modes.
 *
 * Key design:
 * - All agents share the same state store (Map<groupId, ChainState>)
 * - Lock mechanism ensures atomic check-and-increment for parallel agents
 * - roundCount semantics: number of agents that have been triggered
 */

import type { ConversationChainState, GroupSessionEntry } from "./types.js";

// ─── Constants ───

/** Backend hard limit: max agent trigger count (Layer 2) */
const CHAIN_MAX_COUNT = 20;

/** Backend hard limit: max chain duration in ms (Layer 2) */
const CHAIN_MAX_DURATION_MS = 5 * 60_000; // 5 minutes

// ─── State Storage ───

/** Group-level state store (in-memory) */
const store = new Map<string, ConversationChainState>();

/** Group-level locks for atomic operations */
const locks = new Map<string, Promise<void>>();

// ─── Public API ───

/**
 * Get the chain state for a group.
 */
export function getChainState(groupId: string): ConversationChainState | undefined {
  return store.get(groupId);
}

/**
 * Initialize a new chain state when Owner sends a message.
 * This resets roundCount to 0.
 */
export function initChainState(groupId: string, originMessageId: string): ConversationChainState {
  const state: ConversationChainState = {
    originMessageId,
    roundCount: 0,
    startedAt: Date.now(),
  };
  store.set(groupId, state);
  return state;
}

/**
 * Clear chain state for a group (optional cleanup).
 */
export function clearChainState(groupId: string): void {
  store.delete(groupId);
  locks.delete(groupId);
}

/**
 * Acquire a lock for the group.
 * Simple Promise-based mutex that waits for the current lock holder to release.
 */
async function acquireLock(groupId: string): Promise<() => void> {
  // Wait for current lock to be released
  while (locks.has(groupId)) {
    await locks.get(groupId);
  }

  // Create new lock
  let release: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(groupId, lockPromise);

  // Return release function
  return () => {
    locks.delete(groupId);
    release!();
  };
}

/**
 * Atomic operation: check limits and increment roundCount.
 *
 * This is the core function for both unicast and broadcast modes:
 * - Acquires lock to ensure atomicity
 * - Checks Layer 1 (user config) and Layer 2 (backend hard limits)
 * - Increments roundCount if allowed
 *
 * Returns:
 * - allowed: true + newState → agent can be triggered
 * - allowed: false + reason → agent should be blocked
 */
export async function atomicCheckAndIncrement(
  groupId: string,
  meta: GroupSessionEntry,
): Promise<
  { allowed: true; newState: ConversationChainState } | { allowed: false; reason: string }
> {
  const release = await acquireLock(groupId);
  try {
    const state = store.get(groupId);
    if (!state) {
      return { allowed: false, reason: "no_chain_state" };
    }

    const now = Date.now();

    // Layer 1: User configurable limits
    if (state.roundCount >= meta.maxRounds) {
      return { allowed: false, reason: "max_rounds_exceeded" };
    }
    if (state.startedAt && now - state.startedAt >= (meta.chainTimeout ?? 300_000)) {
      return { allowed: false, reason: "chain_timeout_exceeded" };
    }

    // Layer 2: Backend hard limits (safety net)
    if (state.roundCount >= CHAIN_MAX_COUNT) {
      return { allowed: false, reason: "backend_chain_max_exceeded" };
    }
    if (state.startedAt && now - state.startedAt >= CHAIN_MAX_DURATION_MS) {
      return { allowed: false, reason: "backend_chain_timeout_exceeded" };
    }

    // Atomic increment
    state.roundCount += 1;
    store.set(groupId, state);

    return { allowed: true, newState: { ...state } };
  } finally {
    release();
  }
}

/**
 * Synchronous version for cases where async is not needed (e.g., tests).
 * Uses the same logic but without lock (caller must ensure single-threaded access).
 */
export function checkAndIncrementSync(
  groupId: string,
  meta: GroupSessionEntry,
): { allowed: true; newState: ConversationChainState } | { allowed: false; reason: string } {
  const state = store.get(groupId);
  if (!state) {
    return { allowed: false, reason: "no_chain_state" };
  }

  const now = Date.now();

  // Layer 1
  if (state.roundCount >= meta.maxRounds) {
    return { allowed: false, reason: "max_rounds_exceeded" };
  }
  if (state.startedAt && now - state.startedAt >= (meta.chainTimeout ?? 300_000)) {
    return { allowed: false, reason: "chain_timeout_exceeded" };
  }

  // Layer 2
  if (state.roundCount >= CHAIN_MAX_COUNT) {
    return { allowed: false, reason: "backend_chain_max_exceeded" };
  }
  if (state.startedAt && now - state.startedAt >= CHAIN_MAX_DURATION_MS) {
    return { allowed: false, reason: "backend_chain_timeout_exceeded" };
  }

  // Increment
  state.roundCount += 1;
  store.set(groupId, state);

  return { allowed: true, newState: { ...state } };
}

// ─── Exports for testing ───

export const _test = {
  getStore: () => store,
  getLocks: () => locks,
  CHAIN_MAX_COUNT,
  CHAIN_MAX_DURATION_MS,
};
