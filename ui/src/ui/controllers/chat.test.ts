import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleChatEvent,
  flushChatStream,
  clearChatStreamThrottle,
  checkChatStreamTimeout,
  CHAT_STREAM_THROTTLE_MS,
  CHAT_STREAM_TIMEOUT_MS,
  type ChatEventPayload,
  type ChatState,
} from "./chat.ts";

function createState(overrides: Partial<ChatState> = {}): ChatState {
  return {
    chatAttachments: [],
    chatLoading: false,
    chatMessage: "",
    chatMessages: [],
    chatRunId: null,
    chatSending: false,
    chatStream: null,
    chatStreamSegments: null,
    chatStreamStartedAt: null,
    chatThinkingLevel: null,
    client: null,
    connected: true,
    lastError: null,
    sessionKey: "main",
    ...overrides,
  };
}

describe("handleChatEvent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearChatStreamThrottle("main");
    clearChatStreamThrottle("other");
  });

  it("returns null when payload is missing", () => {
    const state = createState();
    expect(handleChatEvent(state, undefined)).toBe(null);
  });

  it("returns null when sessionKey does not match", () => {
    const state = createState({ sessionKey: "main" });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "other",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe(null);
  });

  it("returns null for delta from another run", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Hello",
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "delta",
      message: { role: "assistant", content: [{ type: "text", text: "Done" }] },
    };
    expect(handleChatEvent(state, payload)).toBe(null);
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Hello");
  });

  it("returns 'final' for final from another run (e.g. sub-agent announce) without clearing state", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-user",
      chatStream: "Working...",
      chatStreamStartedAt: 123,
    });
    const payload: ChatEventPayload = {
      runId: "run-announce",
      sessionKey: "main",
      state: "final",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Sub-agent findings" }],
      },
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe("run-user");
    expect(state.chatStream).toBe("Working...");
    expect(state.chatStreamStartedAt).toBe(123);
  });

  it("processes final from own run and clears state", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "Reply",
      chatStreamStartedAt: 100,
    });
    const payload: ChatEventPayload = {
      runId: "run-1",
      sessionKey: "main",
      state: "final",
    };
    expect(handleChatEvent(state, payload)).toBe("final");
    expect(state.chatRunId).toBe(null);
    expect(state.chatStream).toBe(null);
    expect(state.chatStreamStartedAt).toBe(null);
  });
});

describe("chat stream throttling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearChatStreamThrottle("main");
  });

  it("throttles rapid delta events", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "",
    });

    // Send multiple rapid delta events
    for (let i = 1; i <= 5; i++) {
      const payload: ChatEventPayload = {
        runId: "run-1",
        sessionKey: "main",
        state: "delta",
        message: { role: "assistant", content: [{ type: "text", text: "a".repeat(i) }] },
      };
      handleChatEvent(state, payload);
    }

    // First update syncs immediately (lastSyncTime is 0, so elapsed is always >= THROTTLE_MS)
    // Note: The exact behavior depends on performance.now() in the browser
    // After first sync, subsequent updates within throttle window are buffered

    // Advance timer past throttle interval to flush any pending syncs
    vi.advanceTimersByTime(CHAT_STREAM_THROTTLE_MS + 10);

    // After throttle window, the buffered content should be synced
    expect(state.chatStream).toBe("aaaaa");
  });

  it("flushChatStream forces immediate sync", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "",
    });

    // Send a delta event
    handleChatEvent(state, {
      runId: "run-1",
      sessionKey: "main",
      state: "delta",
      message: { role: "assistant", content: [{ type: "text", text: "Hello" }] },
    });

    // First update may or may not sync immediately depending on timer state
    // Advance timer to ensure sync
    vi.advanceTimersByTime(CHAT_STREAM_THROTTLE_MS + 10);
    expect(state.chatStream).toBe("Hello");

    // Send another delta event (should be throttled)
    handleChatEvent(state, {
      runId: "run-1",
      sessionKey: "main",
      state: "delta",
      message: { role: "assistant", content: [{ type: "text", text: "Hello World" }] },
    });

    // Before throttle timer completes, stream may still be the old value
    // Force flush to get immediate update
    flushChatStream(state);

    // Now it should be updated
    expect(state.chatStream).toBe("Hello World");
  });

  it("clearChatStreamThrottle cleans up throttle state", () => {
    const state = createState({
      sessionKey: "main",
      chatRunId: "run-1",
      chatStream: "",
    });

    // Send delta events
    handleChatEvent(state, {
      runId: "run-1",
      sessionKey: "main",
      state: "delta",
      message: { role: "assistant", content: [{ type: "text", text: "Test" }] },
    });

    // Clear throttle state
    clearChatStreamThrottle("main");

    // Advance timer - should not throw or cause issues
    vi.advanceTimersByTime(CHAT_STREAM_THROTTLE_MS + 10);
  });
});

describe("chat stream timeout detection", () => {
  it("returns false when no chatRunId", () => {
    const state = createState({
      chatRunId: null,
      chatStreamStartedAt: Date.now(),
    });
    expect(checkChatStreamTimeout(state)).toBe(false);
  });

  it("returns false when no chatStreamStartedAt", () => {
    const state = createState({
      chatRunId: "run-1",
      chatStreamStartedAt: null,
    });
    expect(checkChatStreamTimeout(state)).toBe(false);
  });

  it("returns false when within timeout", () => {
    const state = createState({
      chatRunId: "run-1",
      chatStreamStartedAt: Date.now() - 1000, // 1 second ago
    });
    expect(checkChatStreamTimeout(state)).toBe(false);
  });

  it("returns true when timeout exceeded", () => {
    const state = createState({
      chatRunId: "run-1",
      chatStreamStartedAt: Date.now() - CHAT_STREAM_TIMEOUT_MS - 1000, // past timeout
    });
    expect(checkChatStreamTimeout(state)).toBe(true);
  });
});
