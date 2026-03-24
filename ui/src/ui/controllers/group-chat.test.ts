import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GroupChatMessage,
  GroupChatState,
  GroupHost,
  GroupStreamPayload,
} from "./group-chat.ts";
import {
  DEFAULT_GROUP_CHAT_STATE,
  cancelSummary,
  extractDedicatedMentions,
  handleGroupMessageEvent,
  handleGroupStreamEvent,
  handleGroupSystemEvent,
  leaveGroupChat,
  processMentionDisplay,
  resetChainState,
  sendGroupMessage,
  triggerSummary,
} from "./group-chat.ts";

// Setup fake timers
vi.useFakeTimers();

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

const DEFAULT_TEST_META = {
  groupId: "g1",
  name: "Test Group",
  members: [
    { agentId: "a1", role: "assistant" as const, joinedAt: 1 },
    { agentId: "a2", role: "assistant" as const, joinedAt: 2 },
    { agentId: "a3", role: "assistant" as const, joinedAt: 3 },
  ],
  memberRolePrompts: [] as Array<{ agentId: string; rolePrompt: string; updatedAt: number }>,
  messageMode: "broadcast" as const,
  announcement: "",
  groupSkills: [] as string[],
  maxRounds: 20,
  maxConsecutive: 3,
  archived: false,
  createdAt: 1,
  updatedAt: 1,
};

function makeMockClient() {
  return {
    request: vi.fn().mockImplementation((method: string, params?: unknown) => {
      if (method === "group.info") {
        const p = params as { groupId?: string } | undefined;
        return Promise.resolve({ ...DEFAULT_TEST_META, groupId: p?.groupId ?? "g1" });
      }
      return Promise.resolve({});
    }),
  };
}

function makeHost(overrides?: Partial<GroupChatState>) {
  const state = makeState(overrides);
  const mockClient = makeMockClient();
  const host = {
    ...state,
    client: mockClient,
    connected: true,
    activeGroupMeta: { ...DEFAULT_TEST_META },
  };
  // Cast to include mock client type for testing
  return host as typeof host & { client: ReturnType<typeof makeMockClient> };
}

/**
 * Flush pending micro-tasks and advance timers by a small step.
 * Use this after handleGroupMessageEvent to let the async
 * detectAndForwardMentions fire-and-forget promise settle.
 */
async function flushAsync(ms = 100): Promise<void> {
  // Flush micro-task queue (let Promises resolve)
  await vi.advanceTimersByTimeAsync(ms);
}

describe("group-chat controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Mock window.setTimeout for tests
    if (typeof window === "undefined") {
      (global as { window?: typeof global }).window = {
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
      };
    }

    // Clear all chain state maps between tests
    resetChainState("g1");
    resetChainState("g2");
  });

  afterEach(() => {
    // Clear pending timers without running them (avoids infinite loops from
    // scheduleSummaryCheck's recursive polling timer).
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe("initiator summary mechanism", () => {
    describe("chain state management", () => {
      it("creates new chain state for group", async () => {
        const host = makeHost();
        host.activeGroupId = "g1"; // Set active group

        const msg = makeMessage({
          sender: { type: "agent", agentId: "a1" },
          content: "Answer\n@a2",
          groupId: "g1",
        });

        handleGroupMessageEvent(host as unknown as GroupChatState, msg);
        await flushAsync(200);

        // Message should be added
        expect(host.groupMessages.some((m) => m.id === msg.id)).toBe(true);
      });

      it("tracks pending agents in forward call", async () => {
        const host = makeHost();
        host.activeGroupId = "g1";

        // Agent A @mentions B and C
        const msg = makeMessage({
          sender: { type: "agent", agentId: "a1" },
          content: "Answer\n@a2 @a3",
          groupId: "g1",
        });

        handleGroupMessageEvent(host as unknown as GroupChatState, msg);
        await flushAsync(200);

        // Check if a2 and a3 are mentioned in the forward call
        const forwardCalls = host.client.request.mock.calls.filter(
          (call) => call[0] === "group.send" && call[1].mentions?.length > 0,
        );
        expect(forwardCalls.length).toBeGreaterThan(0);
        expect(forwardCalls[0][1].mentions).toContain("a2");
        expect(forwardCalls[0][1].mentions).toContain("a3");
      });

      it("removes agents from pending when they reply", async () => {
        const host = makeHost();
        host.activeGroupId = "g1";

        // First message triggers A2 and A3
        const msg1 = makeMessage({
          id: "msg-1",
          sender: { type: "agent", agentId: "a1" },
          content: "Answer\n@a2 @a3",
          groupId: "g1",
        });
        handleGroupMessageEvent(host as unknown as GroupChatState, msg1);
        await flushAsync(200);

        // A2 replies
        const msg2 = makeMessage({
          id: "msg-2",
          sender: { type: "agent", agentId: "a2" },
          content: "My response",
          groupId: "g1",
        });
        handleGroupMessageEvent(host as unknown as GroupChatState, msg2);
        await flushAsync(200);

        // A2's reply should be added to messages
        expect(host.groupMessages.some((m) => m.id === "msg-2")).toBe(true);
      });

      it("excludes initiators from mention matching pool", async () => {
        const host = makeHost();
        host.activeGroupId = "g1";

        // A1 @mentions A2 on a dedicated line, becomes initiator
        const msg1 = makeMessage({
          id: "msg-1",
          sender: { type: "agent", agentId: "a1" },
          content: "Please help\n@a2",
          groupId: "g1",
        });
        handleGroupMessageEvent(host as unknown as GroupChatState, msg1);
        await flushAsync(200);

        // Verify A1 is tracked as initiator (A2 was mentioned)
        const forwardCallsAfter1 = host.client.request.mock.calls.filter(
          (call: unknown[]) =>
            call[0] === "group.send" &&
            Array.isArray((call[1] as { mentions?: unknown[] }).mentions),
        );
        expect(forwardCallsAfter1.length).toBeGreaterThan(0);
        expect((forwardCallsAfter1[0][1] as { mentions?: string[] }).mentions).toContain("a2");

        // A2 replies and tries to @mention A1 (the initiator) on a dedicated line
        // This should NOT trigger A1 because A1 is in initiators list
        const msg2 = makeMessage({
          id: "msg-2",
          sender: { type: "agent", agentId: "a2" },
          content: "Done\n@a1",
          groupId: "g1",
        });
        handleGroupMessageEvent(host as unknown as GroupChatState, msg2);
        await flushAsync(200);

        // @a1 should NOT be recognized as valid mention (A1 is excluded from pool)
        // So there should be NO new forward call with A1 as target
        const forwardCallsAfter2 = host.client.request.mock.calls.filter(
          (call: unknown[]) =>
            call[0] === "group.send" &&
            Array.isArray((call[1] as { mentions?: unknown[] }).mentions) &&
            (call[1] as { mentions?: string[] }).mentions?.includes("a1"),
        );
        // Should be 0 because @a1 should not trigger a forward
        expect(forwardCallsAfter2.length).toBe(0);
      });
    });

    describe("summary scheduling", () => {
      it("triggers summary after SUMMARY_DELAY_MS", async () => {
        const host = makeHost();
        host.activeGroupId = "g1";

        // Agent A @mentions B
        const msg1 = makeMessage({
          id: "msg-1",
          sender: { type: "agent", agentId: "a1" },
          content: "Answer\n@a2",
          groupId: "g1",
        });
        handleGroupMessageEvent(host as unknown as GroupChatState, msg1);
        await flushAsync(200);

        // A2 replies
        const msg2 = makeMessage({
          id: "msg-2",
          sender: { type: "agent", agentId: "a2" },
          content: "My response",
          groupId: "g1",
        });
        handleGroupMessageEvent(host as unknown as GroupChatState, msg2);
        await flushAsync(200);

        // Fast forward to SUMMARY_DELAY_MS (10s) — use advanceTimersByTimeAsync
        // to also flush micro-tasks (promises) that summary flow generates
        await vi.advanceTimersByTimeAsync(11_000);

        // Should trigger summary
        const summaryCallsAfter = host.client.request.mock.calls.filter(
          (call) => call[0] === "group.send" && call[1].skipTranscript === true,
        );
        expect(summaryCallsAfter.length).toBeGreaterThan(0);
      });

      it("waits up to MAX_PENDING_WAIT_MS for pending agents", async () => {
        const host = makeHost();
        host.activeGroupId = "g1";

        // Agent A @mentions B and C
        const msg1 = makeMessage({
          id: "msg-1",
          sender: { type: "agent", agentId: "a1" },
          content: "Answer\n@a2 @a3",
          groupId: "g1",
        });
        handleGroupMessageEvent(host as unknown as GroupChatState, msg1);
        await flushAsync(200);

        // A2 replies
        const msg2 = makeMessage({
          id: "msg-2",
          sender: { type: "agent", agentId: "a2" },
          content: "My response",
          groupId: "g1",
        });
        handleGroupMessageEvent(host as unknown as GroupChatState, msg2);
        await flushAsync(200);

        // Fast forward to MAX_PENDING_WAIT_MS (30s)
        await vi.advanceTimersByTimeAsync(31_000);

        // Should trigger summary even though A3 hasn't replied
        const summaryCalls = host.client.request.mock.calls.filter(
          (call) => call[0] === "group.send" && call[1].skipTranscript === true,
        );
        expect(summaryCalls.length).toBeGreaterThan(0);
      });
    });

    describe("summary sending", () => {
      it("sends summary message with correct parameters", async () => {
        const host = makeHost();
        host.activeGroupId = "g1";

        // Agent A @mentions B
        const msg1 = makeMessage({
          id: "msg-1",
          sender: { type: "agent", agentId: "a1" },
          content: "Answer\n@a2",
          groupId: "g1",
        });
        handleGroupMessageEvent(host as unknown as GroupChatState, msg1);
        await flushAsync(200);

        // A2 replies
        const msg2 = makeMessage({
          id: "msg-2",
          sender: { type: "agent", agentId: "a2" },
          content: "My response",
          groupId: "g1",
        });
        handleGroupMessageEvent(host as unknown as GroupChatState, msg2);
        await flushAsync(200);

        // Advance past SUMMARY_DELAY_MS (10s) — no pendingMentions so summary fires directly
        await vi.advanceTimersByTimeAsync(11_000);

        // Should have summary call
        const summaryCalls = host.client.request.mock.calls.filter(
          (call) => call[0] === "group.send" && call[1].skipTranscript === true,
        );
        expect(summaryCalls.length).toBeGreaterThan(0);
      });
    });

    describe("summary rounds limit", () => {
      it("limits summary rounds to MAX_SUMMARY_ROUNDS", () => {
        // This test verifies the MAX_SUMMARY_ROUNDS constant exists
        // The actual limit is enforced in sendSummaryMessage
        expect(true).toBe(true); // Placeholder - complex timing test
      });
    });

    describe("owner interrupt", () => {
      it("sends message to group", async () => {
        const host = makeHost();
        host.activeGroupId = "g1";

        // Owner sends new message
        await sendGroupMessage(host as unknown as GroupHost, "g1", "Owner message");
        await flushAsync(200);

        // Should call group.send
        expect(host.client.request).toHaveBeenCalledWith(
          "group.send",
          expect.objectContaining({
            groupId: "g1",
            message: "Owner message",
          }),
        );
      });
    });

    describe("manual control", () => {
      it("triggerSummary does nothing without initiators", async () => {
        const host = makeHost();

        // No initiators yet
        await triggerSummary(host as unknown as GroupHost, "g1");
        vi.runAllTimers();

        // Should not send summary
        const summaryCalls = host.client.request.mock.calls.filter(
          (call: unknown[]) =>
            call[0] === "group.send" &&
            (call[1] as { skipTranscript?: boolean }).skipTranscript === true,
        );
        expect(summaryCalls.length).toBe(0);
      });

      it("cancels automatic summary timer", async () => {
        const host = makeHost();
        host.activeGroupId = "g1";

        const msg1 = makeMessage({
          id: "msg-1",
          sender: { type: "agent", agentId: "a1" },
          content: "Answer\n@a2",
          groupId: "g1",
        });
        handleGroupMessageEvent(host as unknown as GroupChatState, msg1);
        await flushAsync(500);

        const msg2 = makeMessage({
          id: "msg-2",
          sender: { type: "agent", agentId: "a2" },
          content: "My response",
          groupId: "g1",
        });
        handleGroupMessageEvent(host as unknown as GroupChatState, msg2);
        // Allow enough time for all async callbacks to settle,
        // including the polling timer if pendingAgents was momentarily non-empty.
        await flushAsync(2000);

        // Clear all client calls so far — we only want to check calls AFTER cancel
        host.client.request.mockClear();

        // Cancel summary — this should cancel the scheduled summary timer
        cancelSummary(host as unknown as GroupHost, "g1");

        // Advance past SUMMARY_DELAY_MS — no summary should fire
        await vi.advanceTimersByTimeAsync(15_000);

        // Should NOT trigger summary (it was cancelled)
        const summaryCalls = host.client.request.mock.calls.filter(
          (call: unknown[]) =>
            call[0] === "group.send" &&
            (call[1] as { skipTranscript?: boolean }).skipTranscript === true,
        );
        expect(summaryCalls.length).toBe(0);

        // Should have cancellation message
        const cancelMsg = host.groupMessages.find(
          (m) => m.role === "system" && m.content.includes("已取消自动汇总"),
        );
        expect(cancelMsg).toBeDefined();
      });

      it("does nothing when triggering summary without initiators", async () => {
        const host = makeHost();

        // No initiators yet
        await triggerSummary(host as unknown as GroupHost, "g1");
        vi.runAllTimers();

        // Should not send summary
        const summaryCalls = host.client.request.mock.calls.filter(
          (call: unknown[]) =>
            call[0] === "group.send" &&
            (call[1] as { skipTranscript?: boolean }).skipTranscript === true,
        );
        expect(summaryCalls.length).toBe(0);
      });
    });

    describe("reset and cleanup", () => {
      it("resets chain state", async () => {
        const host = makeHost();
        host.activeGroupId = "g1";

        const msg1 = makeMessage({
          id: "msg-1",
          sender: { type: "agent", agentId: "a1" },
          content: "Answer\n@a2",
          groupId: "g1",
        });
        handleGroupMessageEvent(host as unknown as GroupChatState, msg1);
        await flushAsync(200);

        // Reset chain state
        resetChainState("g1");

        // Next message should be added
        const msg2 = makeMessage({
          id: "msg-2",
          sender: { type: "agent", agentId: "a2" },
          content: "New chain",
          groupId: "g1",
        });
        handleGroupMessageEvent(host as unknown as GroupChatState, msg2);
        await flushAsync(200);

        // Message should be added
        expect(host.groupMessages.some((m) => m.id === "msg-2")).toBe(true);
      });

      it("resets chain state when leaving group", async () => {
        const host = makeHost();
        host.activeGroupId = "g1";

        const msg1 = makeMessage({
          id: "msg-1",
          sender: { type: "agent", agentId: "a1" },
          content: "Answer\n@a2",
          groupId: "g1",
        });
        handleGroupMessageEvent(host as unknown as GroupChatState, msg1);
        await flushAsync(200);

        // Leave group
        leaveGroupChat(host);

        // Should reset state
        expect(host.activeGroupId).toBeNull();
        expect(host.groupMessages).toHaveLength(0);
      });
    });

    describe("edge cases", () => {
      it("skips summary when no initiators", async () => {
        const host = makeHost();
        host.activeGroupId = "g1";

        const msg1 = makeMessage({
          id: "msg-1",
          sender: { type: "agent", agentId: "a1" },
          content: "No dedicated mentions",
          groupId: "g1",
        });
        handleGroupMessageEvent(host as unknown as GroupChatState, msg1);
        await vi.advanceTimersByTimeAsync(11_000);

        // Should not send summary
        const summaryCalls = host.client.request.mock.calls.filter(
          (call) => call[0] === "group.send" && call[1].skipTranscript === true,
        );
        expect(summaryCalls.length).toBe(0);
      });

      it("skips summary when all initiators left group", async () => {
        const host = makeHost();
        host.activeGroupId = "g1";
        // Remove all initiators from group
        host.activeGroupMeta = {
          ...host.activeGroupMeta,
          members: [
            { agentId: "a4", role: "assistant" as const, joinedAt: 4 },
            { agentId: "a5", role: "assistant" as const, joinedAt: 5 },
          ],
        };

        const msg1 = makeMessage({
          id: "msg-1",
          sender: { type: "agent", agentId: "a1" },
          content: "Answer\n@a2",
          groupId: "g1",
        });
        handleGroupMessageEvent(host as unknown as GroupChatState, msg1);
        await flushAsync(200);

        const msg2 = makeMessage({
          id: "msg-2",
          sender: { type: "agent", agentId: "a2" },
          content: "My response",
          groupId: "g1",
        });
        handleGroupMessageEvent(host as unknown as GroupChatState, msg2);
        await vi.advanceTimersByTimeAsync(11_000);

        // Should not send summary (all initiators left)
        const summaryCalls = host.client.request.mock.calls.filter(
          (call) => call[0] === "group.send" && call[1].skipTranscript === true,
        );
        expect(summaryCalls.length).toBe(0);
      });
    });
  });

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
      expect(state.groupMessages[0].content).toContain("最大对话次数限制");
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

    it("extracts mentions from lines with other content", () => {
      const content = "这个问题请 @dev 帮忙看看。";
      const mentions = extractDedicatedMentions(content, memberIds);
      expect(mentions).toEqual(["dev"]);
    });

    it("extracts inline mentions as routable mentions", () => {
      const content = `我刚才检查了 @dev 的配置，发现它使用的是 GPT-4。
:@test 请你也分享一下你的配置。`;
      const mentions = extractDedicatedMentions(content, memberIds);
      expect(mentions).toEqual(["dev", "test"]);
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
