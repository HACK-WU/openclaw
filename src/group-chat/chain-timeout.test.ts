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
  incrementPendingAgents,
  decrementPendingAgents,
  getPendingAgentCount,
  atomicAgentForwardCheck,
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
    _test.getPendingCounts().clear();
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

describe("atomicCheckAndIncrement with agentId", () => {
  const groupId = "test-group";

  beforeEach(() => {
    _test.getStore().clear();
    _test.getLocks().clear();
    _test.getMonitors().clear();
    _test.getPendingCounts().clear();
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

describe("pendingAgentCount", () => {
  const groupId = "test-group";

  beforeEach(() => {
    _test.getStore().clear();
    _test.getLocks().clear();
    _test.getMonitors().clear();
    _test.getPendingCounts().clear();
  });

  it("starts at 0", () => {
    expect(getPendingAgentCount(groupId)).toBe(0);
  });

  it("increment and decrement work correctly", () => {
    incrementPendingAgents(groupId);
    expect(getPendingAgentCount(groupId)).toBe(1);

    incrementPendingAgents(groupId);
    expect(getPendingAgentCount(groupId)).toBe(2);

    const remaining = decrementPendingAgents(groupId);
    expect(remaining).toBe(1);
    expect(getPendingAgentCount(groupId)).toBe(1);

    const remaining2 = decrementPendingAgents(groupId);
    expect(remaining2).toBe(0);
    expect(getPendingAgentCount(groupId)).toBe(0);
  });

  it("decrement does not go below 0", () => {
    const remaining = decrementPendingAgents(groupId);
    expect(remaining).toBe(0);
    expect(getPendingAgentCount(groupId)).toBe(0);
  });

  it("initChainState resets pendingCounts", () => {
    incrementPendingAgents(groupId);
    incrementPendingAgents(groupId);
    expect(getPendingAgentCount(groupId)).toBe(2);

    initChainState(groupId, "msg-1");
    expect(getPendingAgentCount(groupId)).toBe(0);
  });

  it("clearChainState resets pendingCounts", () => {
    incrementPendingAgents(groupId);
    expect(getPendingAgentCount(groupId)).toBe(1);

    clearChainState(groupId);
    expect(getPendingAgentCount(groupId)).toBe(0);
  });
});

describe("atomicAgentForwardCheck", () => {
  const groupId = "test-group";

  beforeEach(() => {
    _test.getStore().clear();
    _test.getLocks().clear();
    _test.getMonitors().clear();
    _test.getPendingCounts().clear();
  });

  afterEach(() => {
    clearChainState(groupId);
  });

  it("returns ok:false when no chain state", () => {
    const result = atomicAgentForwardCheck(groupId, makeMeta());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no_chain_state");
    }
  });

  it("returns ok:true when chain is active and within limits", () => {
    initChainState(groupId, "msg-1");
    const result = atomicAgentForwardCheck(groupId, makeMeta());
    expect(result.ok).toBe(true);
  });

  it("returns ok:false when chain timeout exceeded", () => {
    initChainState(groupId, "msg-1");
    // Set startedAt to 2 minutes ago, timeout = 60 seconds
    const state = getChainState(groupId)!;
    state.startedAt = Date.now() - 120_000;

    const result = atomicAgentForwardCheck(groupId, makeMeta({ chainTimeout: 60_000 }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("timeout");
    }
  });

  it("returns ok:false when count exceeds backend hard limit", () => {
    initChainState(groupId, "msg-1");
    const state = getChainState(groupId)!;
    state.roundCount = _test.CHAIN_MAX_COUNT; // At limit

    const result = atomicAgentForwardCheck(groupId, makeMeta());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("count");
    }
  });

  it("returns ok:false when backend duration limit exceeded", () => {
    initChainState(groupId, "msg-1");
    const state = getChainState(groupId)!;
    state.startedAt = Date.now() - _test.CHAIN_MAX_DURATION_MS - 1000;

    // Use a very large chainTimeout to bypass Layer 1 and hit Layer 2
    const result = atomicAgentForwardCheck(
      groupId,
      makeMeta({ chainTimeout: _test.CHAIN_MAX_DURATION_MS + 60_000 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("timeout");
    }
  });
});
