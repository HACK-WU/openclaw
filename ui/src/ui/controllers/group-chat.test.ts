import { describe, expect, it } from "vitest";
import {
  DEFAULT_GROUP_CHAT_STATE,
  extractDedicatedMentions,
  handleGroupMessageEvent,
  handleGroupStreamEvent,
  handleGroupSystemEvent,
  leaveGroupChat,
  processMentionDisplay,
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

  describe("extractDedicatedMentions", () => {
    const memberIds = ["dev", "test", "backend"];

    it("extracts mentions from dedicated line (line with only @mentions)", () => {
      const content = `Please answer.
@dev`;
      const mentions = extractDedicatedMentions(content, memberIds);
      expect(mentions).toEqual(["dev"]);
    });

    it("extracts mentions from dedicated line at the beginning", () => {
      const content = `@dev @test
各位请分享一下你们使用的模型配置。`;
      const mentions = extractDedicatedMentions(content, memberIds);
      expect(mentions).toEqual(["dev", "test"]);
    });

    it("extracts multiple mentions from dedicated line", () => {
      const content = `请各位分享一下本周的工作进展。
@dev @test @backend`;
      const mentions = extractDedicatedMentions(content, memberIds);
      expect(mentions).toEqual(["dev", "test", "backend"]);
    });

    it("does NOT extract mentions from lines with other content", () => {
      const content = "这个问题请 @dev 帮忙看看。";
      const mentions = extractDedicatedMentions(content, memberIds);
      expect(mentions).toEqual([]);
    });

    it("extracts only from dedicated lines, ignoring inline mentions", () => {
      const content = `我刚才检查了 @dev 的配置，发现它使用的是 GPT-4。
@test 请你也分享一下你的配置。`;
      const mentions = extractDedicatedMentions(content, memberIds);
      // Second line has other content, so it's NOT a dedicated mention line
      expect(mentions).toEqual([]);
    });

    it("deduplicates mentions", () => {
      const content = `@dev @dev @test`;
      const mentions = extractDedicatedMentions(content, memberIds);
      expect(mentions).toEqual(["dev", "test"]);
    });

    it("returns empty array for empty content", () => {
      const mentions = extractDedicatedMentions("", memberIds);
      expect(mentions).toEqual([]);
    });

    it("handles content with no mentions", () => {
      const content = "Just a regular message with no mentions";
      const mentions = extractDedicatedMentions(content, memberIds);
      expect(mentions).toEqual([]);
    });

    it("does NOT extract @mentions that are not members", () => {
      const content = "@unknown @random";
      const mentions = extractDedicatedMentions(content, memberIds);
      // Neither unknown nor random are members
      expect(mentions).toEqual([]);
    });

    it("handles multiple dedicated lines", () => {
      const content = `@dev
Some text here
@test`;
      const mentions = extractDedicatedMentions(content, memberIds);
      expect(mentions).toEqual(["dev", "test"]);
    });

    it("handles content with only whitespace and mentions", () => {
      const content = `  @dev  `;
      const mentions = extractDedicatedMentions(content, memberIds);
      expect(mentions).toEqual(["dev"]);
    });

    it("returns empty array when memberIds is empty", () => {
      const content = "@dev @test";
      const mentions = extractDedicatedMentions(content, []);
      expect(mentions).toEqual([]);
    });
  });

  describe("processMentionDisplay", () => {
    const memberIds = ["dev", "test", "backend"];

    it("highlights @memberId that is a valid member", () => {
      const content = "请 @dev 回答";
      const result = processMentionDisplay(content, memberIds);
      expect(result).toBe('请 <mark class="mention">@dev</mark> 回答');
    });

    it("converts \\@ to plain @", () => {
      const content = "邮箱 user\\@example.com";
      const result = processMentionDisplay(content, memberIds);
      expect(result).toBe("邮箱 user@example.com");
    });

    it("does NOT highlight @xxx that is not a member", () => {
      const content = "联系 user@example.com";
      const result = processMentionDisplay(content, memberIds);
      expect(result).toBe("联系 user@example.com");
    });

    it("handles escape preventing highlight", () => {
      const content = "这是 \\@dev 不是提及";
      const result = processMentionDisplay(content, memberIds);
      expect(result).toBe("这是 @dev 不是提及");
    });

    it("handles mixed content", () => {
      const content = "邮箱 a\\@b.com 和 @dev";
      const result = processMentionDisplay(content, memberIds);
      expect(result).toBe('邮箱 a@b.com 和 <mark class="mention">@dev</mark>');
    });
  });
});
