import { describe, expect, it } from "vitest";
import {
  DEFAULT_GROUP_CHAT_STATE,
  handleGroupMessageEvent,
  handleGroupStreamEvent,
  handleGroupSystemEvent,
  leaveGroupChat,
} from "./group-chat.ts";
import type { GroupChatMessage, GroupChatState, GroupStreamPayload } from "./group-chat.ts";

function makeState(overrides?: Partial<GroupChatState>): GroupChatState {
  return { ...DEFAULT_GROUP_CHAT_STATE, ...overrides };
}

function makeMessage(overrides?: Partial<GroupChatMessage>): GroupChatMessage {
  return {
    id: "msg-1",
    groupId: "g1",
    role: "assistant",
    content: "Hello",
    sender: { type: "agent", agentId: "a1" },
    serverSeq: 1,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("group-chat controller", () => {
  describe("handleGroupMessageEvent", () => {
    it("appends message when groupId matches activeGroupId", () => {
      const state = makeState({ activeGroupId: "g1", groupMessages: [] });
      const msg = makeMessage({ groupId: "g1" });
      handleGroupMessageEvent(state, msg);
      expect(state.groupMessages).toHaveLength(1);
      expect(state.groupMessages[0].id).toBe("msg-1");
    });

    it("ignores message when groupId does not match", () => {
      const state = makeState({ activeGroupId: "g1", groupMessages: [] });
      const msg = makeMessage({ groupId: "g2" });
      handleGroupMessageEvent(state, msg);
      expect(state.groupMessages).toHaveLength(0);
    });

    it("deduplicates messages by id", () => {
      const existing = makeMessage({ id: "msg-1", groupId: "g1" });
      const state = makeState({ activeGroupId: "g1", groupMessages: [existing] });
      handleGroupMessageEvent(state, makeMessage({ id: "msg-1", groupId: "g1" }));
      expect(state.groupMessages).toHaveLength(1);
    });

    it("adds new message without removing existing ones", () => {
      const existing = makeMessage({ id: "msg-1", groupId: "g1" });
      const state = makeState({ activeGroupId: "g1", groupMessages: [existing] });
      handleGroupMessageEvent(state, makeMessage({ id: "msg-2", groupId: "g1" }));
      expect(state.groupMessages).toHaveLength(2);
    });
  });

  describe("handleGroupStreamEvent", () => {
    it("ignores events for non-active groups", () => {
      const state = makeState({ activeGroupId: "g1" });
      const payload: GroupStreamPayload = {
        groupId: "g2",
        agentId: "a1",
        runId: "r1",
        state: "final",
      };
      handleGroupStreamEvent(state, payload);
      expect(state.groupStreams.size).toBe(0);
    });

    it("removes stream on final event", () => {
      const streams = new Map([["a1", { runId: "r1", text: "hello", startedAt: 1000 }]]);
      const state = makeState({ activeGroupId: "g1", groupStreams: streams });
      const payload: GroupStreamPayload = {
        groupId: "g1",
        agentId: "a1",
        runId: "r1",
        state: "final",
      };
      handleGroupStreamEvent(state, payload);
      expect(state.groupStreams.has("a1")).toBe(false);
    });

    it("removes stream on error event", () => {
      const streams = new Map([["a1", { runId: "r1", text: "partial", startedAt: 1000 }]]);
      const state = makeState({ activeGroupId: "g1", groupStreams: streams });
      const payload: GroupStreamPayload = {
        groupId: "g1",
        agentId: "a1",
        runId: "r1",
        state: "error",
        errorMessage: "oops",
      };
      handleGroupStreamEvent(state, payload);
      expect(state.groupStreams.has("a1")).toBe(false);
    });
  });

  describe("handleGroupSystemEvent", () => {
    it("appends system message for round_limit action", () => {
      const state = makeState({ activeGroupId: "g1", groupMessages: [] });
      handleGroupSystemEvent(state, { groupId: "g1", action: "round_limit" });
      expect(state.groupMessages).toHaveLength(1);
      expect(state.groupMessages[0].role).toBe("system");
      expect(state.groupMessages[0].content).toContain("round limit");
    });

    it("ignores system events for non-active groups", () => {
      const state = makeState({ activeGroupId: "g1", groupMessages: [] });
      handleGroupSystemEvent(state, { groupId: "g2", action: "round_limit" });
      expect(state.groupMessages).toHaveLength(0);
    });

    it("ignores unknown system actions", () => {
      const state = makeState({ activeGroupId: "g1", groupMessages: [] });
      handleGroupSystemEvent(state, { groupId: "g1", action: "unknown_action" });
      expect(state.groupMessages).toHaveLength(0);
    });
  });

  describe("leaveGroupChat", () => {
    it("resets all group chat state", () => {
      const state = makeState({
        activeGroupId: "g1",
        activeGroupMeta: { groupId: "g1" } as unknown as GroupChatState["activeGroupMeta"],
        groupMessages: [makeMessage()],
        groupStreams: new Map([["a1", { runId: "r1", text: "x", startedAt: 0 }]]),
        groupError: "some error",
        groupDraft: "draft text",
      });
      leaveGroupChat(state);
      expect(state.activeGroupId).toBeNull();
      expect(state.activeGroupMeta).toBeNull();
      expect(state.groupMessages).toHaveLength(0);
      expect(state.groupStreams.size).toBe(0);
      expect(state.groupError).toBeNull();
      expect(state.groupDraft).toBe("");
    });
  });

  describe("DEFAULT_GROUP_CHAT_STATE", () => {
    it("has correct initial values", () => {
      expect(DEFAULT_GROUP_CHAT_STATE.activeGroupId).toBeNull();
      expect(DEFAULT_GROUP_CHAT_STATE.groupMessages).toEqual([]);
      expect(DEFAULT_GROUP_CHAT_STATE.groupStreams).toBeInstanceOf(Map);
      expect(DEFAULT_GROUP_CHAT_STATE.groupListLoading).toBe(false);
      expect(DEFAULT_GROUP_CHAT_STATE.groupSending).toBe(false);
    });
  });
});
