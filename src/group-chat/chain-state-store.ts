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

import { getLogger } from "../logging.js";
import type { ConversationChainState, GroupSessionEntry } from "./types.js";

const log = getLogger("group-chat:chain-store");

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

// ─── Monitor Storage ───

/** Group-level chainTimeout monitor stop functions */
const monitors = new Map<string, () => void>();

/**
 * Register chainTimeout monitor.
 * Only one active monitor per groupId; old one is stopped first.
 */
export function setChainMonitor(groupId: string, stop: () => void): void {
  const stopOld = monitors.get(groupId);
  if (stopOld) {
    try {
      stopOld();
    } catch {
      /* ignore */
    }
  }
  monitors.set(groupId, stop);
}

/**
 * Remove chainTimeout monitor without calling stop().
 * Used in onTimeout callback where timer has already fired.
 */
export function removeChainMonitor(groupId: string): void {
  monitors.delete(groupId);
}

/**
 * Stop and remove chainTimeout monitor.
 * Used for normal completion, maxRounds exhaustion, group cleanup.
 */
export function stopChainMonitor(groupId: string): void {
  const stop = monitors.get(groupId);
  if (stop) {
    try {
      stop();
    } catch {
      /* ignore */
    }
    monitors.delete(groupId);
  }
}

/**
 * Check if a group has an active chainTimeout monitor.
 */
export function hasActiveMonitor(groupId: string): boolean {
  return monitors.has(groupId);
}

// ─── Public API ───

/**
 * Get the chain state for a group.
 */
export function getChainState(groupId: string): ConversationChainState | undefined {
  return store.get(groupId);
}

/**
 * Initialize a new chain state when Owner sends a message.
 * This resets roundCount to 0 and stops any existing monitor.
 */
export function initChainState(groupId: string, originMessageId: string): ConversationChainState {
  // Stop old monitor if exists
  stopChainMonitor(groupId);

  const state: ConversationChainState = {
    originMessageId,
    roundCount: 0,
    startedAt: Date.now(),
    triggeredAgents: [],
    queuedMessages: [],
  };
  store.set(groupId, state);
  return state;
}

/**
 * Clear chain state for a group (optional cleanup).
 */
export function clearChainState(groupId: string): void {
  stopChainMonitor(groupId);
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
 * Get the default chainTimeout based on message mode.
 * - Unicast: 15 minutes (agents run serially, each affects the next)
 * - Broadcast: 8 minutes (agents run in parallel, timeout is the main termination)
 */
export function getDefaultChainTimeout(meta: GroupSessionEntry): number {
  if (meta.chainTimeout !== undefined) {
    return meta.chainTimeout;
  }
  return meta.messageMode === "unicast" ? 15 * 60_000 : 8 * 60_000;
}

/**
 * Atomic operation: check limits and increment roundCount.
 *
 * Records the triggered agent ID in triggeredAgents for dedup.
 * Stops chain monitor when maxRounds are exhausted.
 *
 * Returns:
 * - allowed: true + newState → agent can be triggered
 * - allowed: false + reason → agent should be blocked
 */
export async function atomicCheckAndIncrement(
  groupId: string,
  meta: GroupSessionEntry,
  agentId: string,
): Promise<
  | { allowed: true; newState: ConversationChainState }
  | { allowed: false; reason: string; maxRoundsExhausted?: boolean }
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
      stopChainMonitor(groupId);
      return { allowed: false, reason: "max_rounds_exceeded", maxRoundsExhausted: true };
    }
    if (
      state.startedAt &&
      now - state.startedAt >= (meta.chainTimeout ?? getDefaultChainTimeout(meta))
    ) {
      return { allowed: false, reason: "chain_timeout_exceeded" };
    }

    // Layer 2: Backend hard limits (safety net)
    if (state.roundCount >= CHAIN_MAX_COUNT) {
      stopChainMonitor(groupId);
      return { allowed: false, reason: "backend_chain_max_exceeded", maxRoundsExhausted: true };
    }
    if (state.startedAt && now - state.startedAt >= CHAIN_MAX_DURATION_MS) {
      return { allowed: false, reason: "backend_chain_timeout_exceeded" };
    }

    // Atomic increment + record triggered agent
    state.roundCount += 1;
    state.triggeredAgents.push(agentId);
    store.set(groupId, state);

    return { allowed: true, newState: { ...state, triggeredAgents: [...state.triggeredAgents] } };
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
  agentId: string,
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
  if (
    state.startedAt &&
    now - state.startedAt >= (meta.chainTimeout ?? getDefaultChainTimeout(meta))
  ) {
    return { allowed: false, reason: "chain_timeout_exceeded" };
  }

  // Layer 2
  if (state.roundCount >= CHAIN_MAX_COUNT) {
    return { allowed: false, reason: "backend_chain_max_exceeded" };
  }
  if (state.startedAt && now - state.startedAt >= CHAIN_MAX_DURATION_MS) {
    return { allowed: false, reason: "backend_chain_timeout_exceeded" };
  }

  // Increment + record
  state.roundCount += 1;
  state.triggeredAgents.push(agentId);
  store.set(groupId, state);

  return { allowed: true, newState: { ...state, triggeredAgents: [...state.triggeredAgents] } };
}

// ─── Queue Management ───

/**
 * Enqueue an Owner message sent during an active chain.
 */
export function enqueueOwnerMessage(
  groupId: string,
  messageId: string,
  mentionedAgents: string[],
  hasMention: boolean,
): void {
  const state = store.get(groupId);
  if (!state) {
    return;
  }

  state.queuedMessages.push({
    messageId,
    mentionedAgents,
    hasMention,
    queuedAt: Date.now(),
  });
  store.set(groupId, state);
}

/**
 * Drain queued Owner messages at chain end.
 *
 * Logic:
 * 1. Filter out messages without @ mentions (don't trigger chains)
 * 2. Merge all @-mention messages: last one is trigger, targets are union
 * 3. Dedup: remove agents already triggered in current chain
 * 4. If targets remain after dedup, return merged result; otherwise null
 */
export function drainQueuedMessages(
  groupId: string,
  currentTriggeredAgents: string[],
): {
  triggerMessageId: string;
  targetAgentIds: string[];
} | null {
  const state = store.get(groupId);
  if (!state) {
    return null;
  }

  const { queuedMessages } = state;

  // Clear queue regardless of whether a new chain starts
  state.queuedMessages = [];
  store.set(groupId, state);

  // Filter: only keep messages with @ mentions
  const messagesWithMentions = queuedMessages.filter(
    (m) => m.hasMention && m.mentionedAgents.length > 0,
  );

  if (messagesWithMentions.length === 0) {
    return null;
  }

  // Last message with mention is the trigger message
  const lastMessage = messagesWithMentions[messagesWithMentions.length - 1];

  // Merge targets: union of all mentioned agents
  const allMentioned = new Set<string>();
  for (const msg of messagesWithMentions) {
    for (const agentId of msg.mentionedAgents) {
      allMentioned.add(agentId);
    }
  }

  // Dedup: remove agents already triggered in current chain
  const triggeredSet = new Set(currentTriggeredAgents);
  for (const agentId of allMentioned) {
    if (triggeredSet.has(agentId)) {
      allMentioned.delete(agentId);
    }
  }

  if (allMentioned.size === 0) {
    return null;
  }

  return {
    triggerMessageId: lastMessage.messageId,
    targetAgentIds: [...allMentioned],
  };
}

// ─── Chain Timeout Monitor ───

/**
 * Start chainTimeout runtime monitoring.
 *
 * Responsibilities:
 * 1. Abort all agents via AbortSignal when chainTimeout fires
 * 2. Caller stops via returned stop() on normal completion
 * 3. Auto-cleanup timer if externally aborted (normal completion)
 */
export function startChainMonitor(params: {
  groupId: string;
  chainTimeout: number;
  startedAt: number;
  abortController: AbortController;
  onTimeout: (groupId: string) => void;
}): () => void {
  const { groupId, chainTimeout, startedAt, abortController, onTimeout } = params;

  // Calculate remaining time
  const elapsed = Date.now() - startedAt;
  const remaining = chainTimeout - elapsed;

  // Already timed out
  if (remaining <= 0) {
    onTimeout(groupId);
    return () => {};
  }

  const timer = setTimeout(() => {
    log.info(`[CHAIN_TIMEOUT] Group ${groupId} exceeded ${chainTimeout}ms, aborting all agents`);
    abortController.abort();
    onTimeout(groupId);
  }, remaining);

  // Auto-cleanup timer if externally aborted
  const onAbort = () => {
    clearTimeout(timer);
  };
  abortController.signal.addEventListener("abort", onAbort, { once: true });

  // Return stop function
  const stop = () => {
    clearTimeout(timer);
    abortController.signal.removeEventListener("abort", onAbort);
  };

  return stop;
}

// ─── Exports for testing ───

export const _test = {
  getStore: () => store,
  getLocks: () => locks,
  getMonitors: () => monitors,
  CHAIN_MAX_COUNT,
  CHAIN_MAX_DURATION_MS,
};
