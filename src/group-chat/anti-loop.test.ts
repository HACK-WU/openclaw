import { describe, expect, it } from "vitest";
import { canTriggerAgent, createChainState, updateChainState } from "./anti-loop.js";
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
    maxConsecutive: 3,
    historyLimit: 50,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("anti-loop", () => {
  describe("createChainState", () => {
    it("creates a fresh chain state with zero counters", () => {
      const state = createChainState("msg-1");
      expect(state.originMessageId).toBe("msg-1");
      expect(state.roundCount).toBe(0);
      expect(state.agentTriggerCounts.size).toBe(0);
      expect(state.lastTriggeredAgentId).toBeUndefined();
    });
  });

  describe("canTriggerAgent", () => {
    it("allows when under all limits", () => {
      const state = createChainState("msg-1");
      const result = canTriggerAgent(state, "a1", makeMeta());
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("blocks when max rounds exceeded", () => {
      const state: ConversationChainState = {
        originMessageId: "msg-1",
        roundCount: 10,
        agentTriggerCounts: new Map(),
      };
      const result = canTriggerAgent(state, "a1", makeMeta({ maxRounds: 10 }));
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("max_rounds_exceeded");
    });

    it("blocks when max consecutive exceeded for agent", () => {
      const state: ConversationChainState = {
        originMessageId: "msg-1",
        roundCount: 2,
        agentTriggerCounts: new Map([["a1", 3]]),
      };
      const result = canTriggerAgent(state, "a1", makeMeta({ maxConsecutive: 3 }));
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("max_consecutive_exceeded");
    });

    it("allows when different agent has high count", () => {
      const state: ConversationChainState = {
        originMessageId: "msg-1",
        roundCount: 2,
        agentTriggerCounts: new Map([["a2", 3]]),
      };
      const result = canTriggerAgent(state, "a1", makeMeta({ maxConsecutive: 3 }));
      expect(result.allowed).toBe(true);
    });
  });

  describe("updateChainState", () => {
    it("increments round count", () => {
      const initial = createChainState("msg-1");
      const updated = updateChainState(initial, "a1");
      expect(updated.roundCount).toBe(1);
    });

    it("sets agent trigger count to 1 on first trigger", () => {
      const initial = createChainState("msg-1");
      const updated = updateChainState(initial, "a1");
      expect(updated.agentTriggerCounts.get("a1")).toBe(1);
      expect(updated.lastTriggeredAgentId).toBe("a1");
    });

    it("increments consecutive count for same agent", () => {
      let state = createChainState("msg-1");
      state = updateChainState(state, "a1");
      state = updateChainState(state, "a1");
      expect(state.agentTriggerCounts.get("a1")).toBe(2);
      expect(state.roundCount).toBe(2);
    });

    it("resets count when switching agents", () => {
      let state = createChainState("msg-1");
      state = updateChainState(state, "a1");
      state = updateChainState(state, "a1");
      state = updateChainState(state, "a2");
      expect(state.agentTriggerCounts.get("a2")).toBe(1);
      expect(state.lastTriggeredAgentId).toBe("a2");
      expect(state.roundCount).toBe(3);
    });

    it("does not mutate the original state", () => {
      const initial = createChainState("msg-1");
      const updated = updateChainState(initial, "a1");
      expect(initial.roundCount).toBe(0);
      expect(initial.agentTriggerCounts.size).toBe(0);
      expect(updated).not.toBe(initial);
    });
  });
});
