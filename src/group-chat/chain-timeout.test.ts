import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initChainState,
  atomicCheckAndIncrement,
  getChainState,
  clearChainState,
  checkAndIncrementSync,
  getDefaultChainTimeout,
  startChainMonitor,
  setChainMonitor,
  stopChainMonitor,
  hasActiveMonitor,
  enqueueOwnerMessage,
  drainQueuedMessages,
  _test,
} from "./chain-state-store.js";
import type { GroupSessionEntry } from "./types.js";

function makeMeta(overrides?: Partial<GroupSessionEntry>): GroupSessionEntry {
  return {
    groupId: "g1",
    messageMode: "unicast",
    members: [
      { agentId: "a1", role: "assistant", joinedAt: 0 },
      { agentId: "a2", role: "member", joinedAt: 0 },
      { agentId: "a3", role: "member", joinedAt: 0 },
    ],
    memberRolePrompts: [],
    groupSkills: [],
    maxRounds: 10,
    maxConsecutive: 3,
    historyLimit: 50,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("chain-timeout monitor", () => {
  const groupId = "test-group";

  beforeEach(() => {
    _test.getStore().clear();
    _test.getLocks().clear();
    _test.getMonitors().clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    clearChainState(groupId);
    _test.getMonitors().clear();
    vi.useRealTimers();
  });

  describe("startChainMonitor", () => {
    it("aborts after timeout fires", () => {
      const abortController = new AbortController();
      const onTimeout = vi.fn();

      startChainMonitor({
        groupId,
        chainTimeout: 5000,
        startedAt: Date.now(),
        abortController,
        onTimeout,
      });

      expect(abortController.signal.aborted).toBe(false);

      // Advance past timeout
      vi.advanceTimersByTime(5001);

      expect(abortController.signal.aborted).toBe(true);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it("stop() cancels timer and leaves signal un-aborted", () => {
      const abortController = new AbortController();
      const onTimeout = vi.fn();

      const stop = startChainMonitor({
        groupId,
        chainTimeout: 5000,
        startedAt: Date.now(),
        abortController,
        onTimeout,
      });

      stop();

      expect(abortController.signal.aborted).toBe(false);

      // Advance past timeout — should NOT fire
      vi.advanceTimersByTime(10000);

      expect(abortController.signal.aborted).toBe(false);
      expect(onTimeout).not.toHaveBeenCalled();
    });

    it("auto-cleans timer when externally aborted", () => {
      const abortController = new AbortController();
      const onTimeout = vi.fn();

      startChainMonitor({
        groupId,
        chainTimeout: 5000,
        startedAt: Date.now(),
        abortController,
        onTimeout,
      });

      // External abort (e.g., normal completion)
      abortController.abort();

      // Advance past timeout — onTimeout should NOT fire
      vi.advanceTimersByTime(10000);

      expect(onTimeout).not.toHaveBeenCalled();
    });

    it("fires immediately when already timed out", () => {
      const abortController = new AbortController();
      const onTimeout = vi.fn();

      startChainMonitor({
        groupId,
        chainTimeout: 5000,
        startedAt: Date.now() - 6000, // Already past timeout
        abortController,
        onTimeout,
      });

      expect(onTimeout).toHaveBeenCalledTimes(1);
    });
  });

  describe("monitor management", () => {
    it("setChainMonitor stops old monitor before setting new", () => {
      const ac1 = new AbortController();
      const ac2 = new AbortController();
      const onTimeout1 = vi.fn();
      const onTimeout2 = vi.fn();

      const stop1 = startChainMonitor({
        groupId,
        chainTimeout: 5000,
        startedAt: Date.now(),
        abortController: ac1,
        onTimeout: onTimeout1,
      });

      const stop2 = startChainMonitor({
        groupId,
        chainTimeout: 10000,
        startedAt: Date.now(),
        abortController: ac2,
        onTimeout: onTimeout2,
      });

      // Register old monitor, then set new (which stops old)
      setChainMonitor(groupId, stop1);
      setChainMonitor(groupId, stop2);

      // Old monitor's timer should have been cleaned up
      // (stop() calls clearTimeout, not abort — signal remains un-aborted)
      expect(ac1.signal.aborted).toBe(false);

      // Old timer should not fire after timeout
      vi.advanceTimersByTime(5001);
      expect(onTimeout1).not.toHaveBeenCalled();

      // New monitor should still be active
      expect(hasActiveMonitor(groupId)).toBe(true);
      expect(ac2.signal.aborted).toBe(false);
    });

    it("hasActiveMonitor returns correct state", () => {
      expect(hasActiveMonitor(groupId)).toBe(false);

      setChainMonitor(groupId, () => {});
      expect(hasActiveMonitor(groupId)).toBe(true);

      stopChainMonitor(groupId);
      expect(hasActiveMonitor(groupId)).toBe(false);
    });

    it("initChainState clears existing monitor", () => {
      setChainMonitor(groupId, () => {});

      initChainState(groupId, "msg-1");

      expect(hasActiveMonitor(groupId)).toBe(false);
    });
  });

  describe("getDefaultChainTimeout", () => {
    it("returns configured chainTimeout when set", () => {
      const meta = makeMeta({ chainTimeout: 42_000 });
      expect(getDefaultChainTimeout(meta)).toBe(42_000);
    });

    it("returns 15 minutes for unicast by default", () => {
      const meta = makeMeta({ messageMode: "unicast" });
      expect(getDefaultChainTimeout(meta)).toBe(15 * 60_000);
    });

    it("returns 8 minutes for broadcast by default", () => {
      const meta = makeMeta({ messageMode: "broadcast" });
      expect(getDefaultChainTimeout(meta)).toBe(8 * 60_000);
    });
  });
});

describe("queue management", () => {
  const groupId = "test-group";

  beforeEach(() => {
    _test.getStore().clear();
    _test.getLocks().clear();
  });

  afterEach(() => {
    clearChainState(groupId);
  });

  describe("enqueueOwnerMessage", () => {
    it("does nothing if no chain state exists", () => {
      enqueueOwnerMessage(groupId, "msg-1", ["a1"], true);
      // No error should be thrown
    });

    it("adds message to queue", () => {
      initChainState(groupId, "msg-0");
      enqueueOwnerMessage(groupId, "msg-1", ["a1", "a2"], true);

      const state = getChainState(groupId);
      expect(state?.queuedMessages).toHaveLength(1);
      expect(state?.queuedMessages[0].messageId).toBe("msg-1");
      expect(state?.queuedMessages[0].mentionedAgents).toEqual(["a1", "a2"]);
      expect(state?.queuedMessages[0].hasMention).toBe(true);
    });
  });

  describe("drainQueuedMessages", () => {
    it("returns null for empty queue", () => {
      initChainState(groupId, "msg-0");
      const result = drainQueuedMessages(groupId, []);
      expect(result).toBeNull();
    });

    it("returns null when no chain state", () => {
      const result = drainQueuedMessages(groupId, []);
      expect(result).toBeNull();
    });

    it("returns null when all messages have no mentions", () => {
      initChainState(groupId, "msg-0");
      enqueueOwnerMessage(groupId, "msg-1", [], false);
      enqueueOwnerMessage(groupId, "msg-2", [], false);

      const result = drainQueuedMessages(groupId, []);
      expect(result).toBeNull();
    });

    it("merges @ targets from multiple messages", () => {
      initChainState(groupId, "msg-0");
      enqueueOwnerMessage(groupId, "msg-1", ["a1"], true);
      enqueueOwnerMessage(groupId, "msg-2", ["a2", "a3"], true);

      const result = drainQueuedMessages(groupId, []);

      expect(result).not.toBeNull();
      expect(result!.triggerMessageId).toBe("msg-2"); // Last message with mentions
      expect(result!.targetAgentIds).toContain("a1");
      expect(result!.targetAgentIds).toContain("a2");
      expect(result!.targetAgentIds).toContain("a3");
    });

    it("deduplicates against already triggered agents", () => {
      initChainState(groupId, "msg-0");
      enqueueOwnerMessage(groupId, "msg-1", ["a1", "a2"], true);
      enqueueOwnerMessage(groupId, "msg-2", ["a2", "a3"], true);

      // a1 and a2 already triggered
      const result = drainQueuedMessages(groupId, ["a1", "a2"]);

      expect(result).not.toBeNull();
      expect(result!.triggerMessageId).toBe("msg-2");
      expect(result!.targetAgentIds).toEqual(["a3"]); // a1, a2 removed
    });

    it("returns null when all targets already triggered", () => {
      initChainState(groupId, "msg-0");
      enqueueOwnerMessage(groupId, "msg-1", ["a1"], true);

      const result = drainQueuedMessages(groupId, ["a1"]);
      expect(result).toBeNull();
    });

    it("clears queue after draining", () => {
      initChainState(groupId, "msg-0");
      enqueueOwnerMessage(groupId, "msg-1", ["a1"], true);
      enqueueOwnerMessage(groupId, "msg-2", ["a2"], true);

      drainQueuedMessages(groupId, []);

      const state = getChainState(groupId);
      expect(state?.queuedMessages).toHaveLength(0);
    });

    it("filters out messages without mentions but keeps those with", () => {
      initChainState(groupId, "msg-0");
      enqueueOwnerMessage(groupId, "msg-plain", [], false); // No mention
      enqueueOwnerMessage(groupId, "msg-with-mention", ["a1"], true);

      const result = drainQueuedMessages(groupId, []);

      expect(result).not.toBeNull();
      expect(result!.triggerMessageId).toBe("msg-with-mention");
    });
  });
});

describe("atomicCheckAndIncrement with agentId", () => {
  const groupId = "test-group";

  beforeEach(() => {
    _test.getStore().clear();
    _test.getLocks().clear();
    _test.getMonitors().clear();
  });

  afterEach(() => {
    clearChainState(groupId);
  });

  it("records agentId in triggeredAgents", async () => {
    initChainState(groupId, "msg-1");
    await atomicCheckAndIncrement(groupId, makeMeta(), "a1");
    await atomicCheckAndIncrement(groupId, makeMeta(), "a2");

    const state = getChainState(groupId);
    expect(state?.triggeredAgents).toContain("a1");
    expect(state?.triggeredAgents).toContain("a2");
  });

  it("returns independent copy of triggeredAgents", async () => {
    initChainState(groupId, "msg-1");
    const result = await atomicCheckAndIncrement(groupId, makeMeta(), "a1");
    if (result.allowed) {
      expect(result.newState.triggeredAgents).toEqual(["a1"]);
      // Modify the returned copy — should not affect store
      result.newState.triggeredAgents.push("a3");
      const state = getChainState(groupId);
      expect(state?.triggeredAgents).toEqual(["a1"]);
    }
  });

  it("stops monitor when maxRounds exhausted", async () => {
    initChainState(groupId, "msg-1");
    const meta = makeMeta({ maxRounds: 1 });
    setChainMonitor(groupId, () => {});

    // First succeeds
    const result1 = await atomicCheckAndIncrement(groupId, meta, "a1");
    expect(result1.allowed).toBe(true);

    // Second should fail and stop monitor
    const result2 = await atomicCheckAndIncrement(groupId, meta, "a2");
    expect(result2.allowed).toBe(false);
    if (!result2.allowed) {
      expect(result2.maxRoundsExhausted).toBe(true);
    }

    expect(hasActiveMonitor(groupId)).toBe(false);
  });

  it("checkAndIncrementSync records agentId", () => {
    initChainState(groupId, "msg-1");
    checkAndIncrementSync(groupId, makeMeta(), "a1");

    const state = getChainState(groupId);
    expect(state?.triggeredAgents).toContain("a1");
  });
});
