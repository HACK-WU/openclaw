import { describe, it, expect, beforeEach } from "vitest";
import {
  saveSessionToBackground,
  restoreSessionFromBackground,
  getBackgroundSession,
  hasActiveBackgroundRun,
  getActiveBackgroundSessionKeys,
  clearAllBackgroundSessions,
  handleBackgroundChatEvent,
  updateBackgroundStreamFromAssistantText,
} from "./background-sessions.ts";

function makeSessionState(overrides: Partial<Parameters<typeof saveSessionToBackground>[0]> = {}) {
  return {
    sessionKey: "session-1",
    chatRunId: "run-1",
    chatStream: "Hello",
    chatStreamSegments: null,
    chatStreamStartedAt: 1000,
    chatMessages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
    chatToolMessages: [],
    chatQueue: [],
    chatSending: false,
    chatMessage: "",
    chatAttachments: [],
    lastError: null,
    ...overrides,
  };
}

describe("background-sessions", () => {
  beforeEach(() => {
    clearAllBackgroundSessions();
  });

  describe("saveSessionToBackground", () => {
    it("saves a session with an active run", () => {
      const saved = saveSessionToBackground(makeSessionState());
      expect(saved).toBe(true);
      expect(hasActiveBackgroundRun("session-1")).toBe(true);
    });

    it("refuses to save a session without chatRunId", () => {
      const saved = saveSessionToBackground(makeSessionState({ chatRunId: null }));
      expect(saved).toBe(false);
      expect(hasActiveBackgroundRun("session-1")).toBe(false);
    });

    it("evicts oldest session when at max capacity", () => {
      for (let i = 0; i < 5; i++) {
        saveSessionToBackground(makeSessionState({ sessionKey: `s-${i}`, chatRunId: `run-${i}` }));
      }
      expect(getActiveBackgroundSessionKeys()).toHaveLength(5);

      // Save a 6th — should evict the oldest.
      saveSessionToBackground(makeSessionState({ sessionKey: "s-new", chatRunId: "run-new" }));
      expect(getActiveBackgroundSessionKeys()).toHaveLength(5);
      expect(hasActiveBackgroundRun("s-0")).toBe(false);
      expect(hasActiveBackgroundRun("s-new")).toBe(true);
    });
  });

  describe("restoreSessionFromBackground", () => {
    it("restores and removes the background state", () => {
      saveSessionToBackground(makeSessionState());
      const restored = restoreSessionFromBackground("session-1");
      expect(restored).toBeDefined();
      expect(restored!.chatRunId).toBe("run-1");
      expect(restored!.chatStream).toBe("Hello");
      expect(hasActiveBackgroundRun("session-1")).toBe(false);
    });

    it("returns undefined for unknown session", () => {
      expect(restoreSessionFromBackground("unknown")).toBeUndefined();
    });
  });

  describe("getBackgroundSession", () => {
    it("returns the state without removing it", () => {
      saveSessionToBackground(makeSessionState());
      const state = getBackgroundSession("session-1");
      expect(state).toBeDefined();
      expect(hasActiveBackgroundRun("session-1")).toBe(true);
    });
  });

  describe("handleBackgroundChatEvent", () => {
    it("updates stream on delta events", () => {
      saveSessionToBackground(makeSessionState({ chatStream: "" }));

      handleBackgroundChatEvent("session-1", {
        runId: "run-1",
        state: "delta",
        message: { content: [{ type: "text", text: "Hello world" }] },
      });

      const bg = getBackgroundSession("session-1");
      expect(bg!.chatStream).toBe("Hello world");
    });

    it("ignores delta events for wrong runId", () => {
      saveSessionToBackground(makeSessionState({ chatStream: "original" }));

      handleBackgroundChatEvent("session-1", {
        runId: "other-run",
        state: "delta",
        message: { content: [{ type: "text", text: "wrong" }] },
      });

      const bg = getBackgroundSession("session-1");
      expect(bg!.chatStream).toBe("original");
    });

    it("removes session on final event and appends message", () => {
      saveSessionToBackground(makeSessionState());

      handleBackgroundChatEvent("session-1", {
        runId: "run-1",
        state: "final",
        message: { role: "assistant", content: [{ type: "text", text: "Done!" }] },
      });

      expect(hasActiveBackgroundRun("session-1")).toBe(false);
    });

    it("removes session on error event", () => {
      saveSessionToBackground(makeSessionState());

      handleBackgroundChatEvent("session-1", {
        runId: "run-1",
        state: "error",
        errorMessage: "something went wrong",
      });

      expect(hasActiveBackgroundRun("session-1")).toBe(false);
    });

    it("removes session on aborted event", () => {
      saveSessionToBackground(makeSessionState());

      handleBackgroundChatEvent("session-1", {
        runId: "run-1",
        state: "aborted",
        message: { role: "assistant", content: [{ type: "text", text: "Aborted text" }] },
      });

      expect(hasActiveBackgroundRun("session-1")).toBe(false);
    });

    it("returns null for unknown session", () => {
      const result = handleBackgroundChatEvent("unknown", {
        runId: "run-1",
        state: "delta",
        message: { text: "test" },
      });
      expect(result).toBeNull();
    });
  });

  describe("updateBackgroundStreamFromAssistantText", () => {
    it("updates stream text when longer", () => {
      saveSessionToBackground(makeSessionState({ chatStream: "Hi" }));

      updateBackgroundStreamFromAssistantText("session-1", "Hi there!");

      const bg = getBackgroundSession("session-1");
      expect(bg!.chatStream).toBe("Hi there!");
    });

    it("does not regress shorter text", () => {
      saveSessionToBackground(makeSessionState({ chatStream: "Hello world" }));

      updateBackgroundStreamFromAssistantText("session-1", "Hi");

      const bg = getBackgroundSession("session-1");
      expect(bg!.chatStream).toBe("Hello world");
    });

    it("ignores unknown session", () => {
      // Should not throw.
      updateBackgroundStreamFromAssistantText("unknown", "text");
    });
  });

  describe("clearAllBackgroundSessions", () => {
    it("removes everything", () => {
      saveSessionToBackground(makeSessionState({ sessionKey: "a", chatRunId: "r1" }));
      saveSessionToBackground(makeSessionState({ sessionKey: "b", chatRunId: "r2" }));

      clearAllBackgroundSessions();

      expect(getActiveBackgroundSessionKeys()).toHaveLength(0);
    });
  });
});
