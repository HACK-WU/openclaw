import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canTriggerAgent, createChainState, updateChainState } from "./anti-loop.js";
import {
  initChainState,
  atomicCheckAndIncrement,
  getChainState,
  clearChainState,
  checkAndIncrementSync,
  _test,
} from "./chain-state-store.js";
import type { ConversationChainState, GroupSessionEntry } from "./types.js";

function makeMeta(overrides?: Partial<GroupSessionEntry>): GroupSessionEntry {
  return {
    groupId: "g1",
    messageMode: "unicast",
    members: [
      { agentId: "a1", role: "assistant", joinedAt: 0 },
      { agentId: "a2", role: "member", joinedAt: 0 },
    ],
    memberRolePrompts: [],
    groupSkills: [],
    maxRounds: 10,
    maxConsecutive: 3, // deprecated but kept for backward compat
    historyLimit: 50,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

// ─── Legacy anti-loop.ts tests ───

describe("anti-loop (legacy API)", () => {
  describe("createChainState", () => {
    it("creates a fresh chain state with zero counters", () => {
      const state = createChainState("msg-1");
      expect(state.originMessageId).toBe("msg-1");
      expect(state.roundCount).toBe(0);
      expect(state.startedAt).toBeDefined();
    });
  });

  describe("canTriggerAgent", () => {
    it("allows when under maxRounds", () => {
      const state = createChainState("msg-1");
      const result = canTriggerAgent(state, "a1", makeMeta());
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("blocks when max rounds exceeded", () => {
      const state: ConversationChainState = {
        originMessageId: "msg-1",
        roundCount: 10,
        startedAt: Date.now(),
        triggeredAgents: [],
        queuedMessages: [],
      };
      const result = canTriggerAgent(state, "a1", makeMeta({ maxRounds: 10 }));
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("max_rounds_exceeded");
    });

    it("no longer checks maxConsecutive (deprecated)", () => {
      const state: ConversationChainState = {
        originMessageId: "msg-1",
        roundCount: 2,
        startedAt: Date.now(),
        triggeredAgents: [],
        queuedMessages: [],
      };
      // maxConsecutive is deprecated, so this should still allow
      const result = canTriggerAgent(state, "a1", makeMeta({ maxConsecutive: 1 }));
      expect(result.allowed).toBe(true);
    });
  });

  describe("updateChainState", () => {
    it("increments round count", () => {
      const initial = createChainState("msg-1");
      const updated = updateChainState(initial);
      expect(updated.roundCount).toBe(1);
    });

    it("does not mutate the original state", () => {
      const initial = createChainState("msg-1");
      const updated = updateChainState(initial);
      expect(initial.roundCount).toBe(0);
      expect(updated).not.toBe(initial);
    });
  });
});

// ─── chain-state-store.ts tests ───

describe("chain-state-store", () => {
  const groupId = "test-group";

  beforeEach(() => {
    // Clear store before each test
    _test.getStore().clear();
    _test.getLocks().clear();
  });

  afterEach(() => {
    clearChainState(groupId);
  });

  describe("initChainState", () => {
    it("initializes chain state with roundCount = 0", () => {
      const state = initChainState(groupId, "msg-1");
      expect(state.originMessageId).toBe("msg-1");
      expect(state.roundCount).toBe(0);
      expect(state.startedAt).toBeDefined();
    });

    it("overwrites existing state", () => {
      initChainState(groupId, "msg-1");
      const state = initChainState(groupId, "msg-2");
      expect(state.originMessageId).toBe("msg-2");
      expect(state.roundCount).toBe(0);
    });
  });

  describe("getChainState", () => {
    it("returns undefined for non-existent group", () => {
      expect(getChainState("non-existent")).toBeUndefined();
    });

    it("returns state after initialization", () => {
      initChainState(groupId, "msg-1");
      const state = getChainState(groupId);
      expect(state).toBeDefined();
      expect(state?.originMessageId).toBe("msg-1");
    });
  });

  describe("checkAndIncrementSync", () => {
    it("returns no_chain_state when not initialized", () => {
      const result = checkAndIncrementSync(groupId, makeMeta(), "a1");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("no_chain_state");
    });

    it("increments roundCount when under limit", () => {
      initChainState(groupId, "msg-1");
      const result = checkAndIncrementSync(groupId, makeMeta(), "a1");
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.newState.roundCount).toBe(1);
        expect(result.newState.triggeredAgents).toContain("a1");
      }
    });

    it("blocks when roundCount >= maxRounds", () => {
      initChainState(groupId, "msg-1");
      const meta = makeMeta({ maxRounds: 2 });

      // First increment
      let result = checkAndIncrementSync(groupId, meta, "a1");
      expect(result.allowed).toBe(true);

      // Second increment
      result = checkAndIncrementSync(groupId, meta, "a2");
      expect(result.allowed).toBe(true);

      // Third should be blocked
      result = checkAndIncrementSync(groupId, meta, "a1");
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe("max_rounds_exceeded");
      }
    });

    it("blocks when chainTimeout exceeded", () => {
      initChainState(groupId, "msg-1");
      const meta = makeMeta({ chainTimeout: 100 }); // 100ms

      // Simulate timeout by modifying startedAt
      const state = getChainState(groupId);
      if (state) {
        state.startedAt = Date.now() - 200; // 200ms ago
      }

      const result = checkAndIncrementSync(groupId, meta, "a1");
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe("chain_timeout_exceeded");
      }
    });

    it("blocks at backend hard limit (CHAIN_MAX_COUNT)", () => {
      initChainState(groupId, "msg-1");
      const meta = makeMeta({ maxRounds: 100 }); // Set high to not trigger first

      // Increment to CHAIN_MAX_COUNT
      for (let i = 0; i < _test.CHAIN_MAX_COUNT; i++) {
        const result = checkAndIncrementSync(groupId, meta, `agent-${i}`);
        expect(result.allowed).toBe(true);
      }

      // Next should be blocked by backend limit
      const result = checkAndIncrementSync(groupId, meta, "agent-final");
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe("backend_chain_max_exceeded");
      }
    });
  });

  describe("atomicCheckAndIncrement", () => {
    it("works the same as sync version for sequential calls", async () => {
      initChainState(groupId, "msg-1");
      const meta = makeMeta();

      const result = await atomicCheckAndIncrement(groupId, meta, "a1");
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.newState.roundCount).toBe(1);
        expect(result.newState.triggeredAgents).toContain("a1");
      }
    });

    it("correctly handles parallel calls", async () => {
      initChainState(groupId, "msg-1");
      const meta = makeMeta({ maxRounds: 2 });

      // Launch 3 parallel increments
      const results = await Promise.all([
        atomicCheckAndIncrement(groupId, meta, "a1"),
        atomicCheckAndIncrement(groupId, meta, "a2"),
        atomicCheckAndIncrement(groupId, meta, "a3"),
      ]);

      // Only 2 should succeed (maxRounds = 2)
      const allowed = results.filter((r) => r.allowed);
      const blocked = results.filter((r) => !r.allowed);

      expect(allowed.length).toBe(2);
      expect(blocked.length).toBe(1);

      // Final state should have roundCount = 2
      const finalState = getChainState(groupId);
      expect(finalState?.roundCount).toBe(2);
    });

    it("preserves exact limit with many parallel calls", async () => {
      initChainState(groupId, "msg-1");
      const meta = makeMeta({ maxRounds: 5 });

      // Launch 10 parallel increments
      const results = await Promise.all(
        Array(10)
          .fill(null)
          .map((_, i) => atomicCheckAndIncrement(groupId, meta, `agent-${i}`)),
      );

      const allowed = results.filter((r) => r.allowed);
      const blocked = results.filter((r) => !r.allowed);

      // Exactly 5 should succeed
      expect(allowed.length).toBe(5);
      expect(blocked.length).toBe(5);

      // All blocked should have the same reason
      for (const r of blocked) {
        if (!r.allowed) {
          expect(r.reason).toBe("max_rounds_exceeded");
        }
      }
    });
  });
});
