/**
 * Background session state management.
 *
 * When the user switches away from a session that has an active AI run,
 * we preserve its streaming state here so:
 * - The backend response keeps being tracked (events are routed here).
 * - Switching back restores the live stream seamlessly.
 * - The sidebar can show an "active" indicator for background runs.
 */

import type { ChatAttachment, ChatQueueItem } from "./ui-types.ts";

/** Maximum number of background sessions tracked simultaneously. */
const MAX_BACKGROUND_SESSIONS = 5;

/**
 * Snapshot of a session's chat state while it runs in the background.
 * Only sessions with an active `chatRunId` are saved here.
 */
export type BackgroundSessionState = {
  sessionKey: string;
  chatRunId: string;
  chatStream: string | null;
  chatStreamSegments: string[] | null;
  chatStreamStartedAt: number | null;
  chatMessages: unknown[];
  chatToolMessages: unknown[];
  chatQueue: ChatQueueItem[];
  chatSending: boolean;
  chatMessage: string;
  chatAttachments: ChatAttachment[];
  lastError: string | null;
  /** Timestamp when the session was moved to background. */
  backgroundAt: number;
};

/** Module-level store for background sessions keyed by sessionKey. */
const backgroundSessions = new Map<string, BackgroundSessionState>();

// ── Query helpers ──────────────────────────────────────────────────────

/** Return the background state for a given sessionKey, if any. */
export function getBackgroundSession(sessionKey: string): BackgroundSessionState | undefined {
  return backgroundSessions.get(sessionKey);
}

/** Check whether a session has an active run in the background. */
export function hasActiveBackgroundRun(sessionKey: string): boolean {
  return backgroundSessions.has(sessionKey);
}

/** Return all session keys that currently have active background runs. */
export function getActiveBackgroundSessionKeys(): string[] {
  return Array.from(backgroundSessions.keys());
}

// ── Lifecycle ──────────────────────────────────────────────────────────

/**
 * Save the current session state to the background store.
 * Only call this when the session has an active chatRunId.
 */
export function saveSessionToBackground(state: {
  sessionKey: string;
  chatRunId: string | null;
  chatStream: string | null;
  chatStreamSegments: string[] | null;
  chatStreamStartedAt: number | null;
  chatMessages: unknown[];
  chatToolMessages: unknown[];
  chatQueue: ChatQueueItem[];
  chatSending: boolean;
  chatMessage: string;
  chatAttachments: ChatAttachment[];
  lastError: string | null;
}): boolean {
  if (!state.chatRunId) {
    return false;
  }

  // Evict the oldest background session if at capacity.
  if (
    backgroundSessions.size >= MAX_BACKGROUND_SESSIONS &&
    !backgroundSessions.has(state.sessionKey)
  ) {
    let oldestKey: string | null = null;
    let oldestTs = Infinity;
    for (const [key, bg] of backgroundSessions) {
      if (bg.backgroundAt < oldestTs) {
        oldestTs = bg.backgroundAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      backgroundSessions.delete(oldestKey);
    }
  }

  backgroundSessions.set(state.sessionKey, {
    sessionKey: state.sessionKey,
    chatRunId: state.chatRunId,
    chatStream: state.chatStream,
    chatStreamSegments: state.chatStreamSegments,
    chatStreamStartedAt: state.chatStreamStartedAt,
    chatMessages: [...state.chatMessages],
    chatToolMessages: [...state.chatToolMessages],
    chatQueue: [...state.chatQueue],
    chatSending: state.chatSending,
    chatMessage: state.chatMessage,
    chatAttachments: [...state.chatAttachments],
    lastError: state.lastError,
    backgroundAt: Date.now(),
  });
  return true;
}

/**
 * Remove a session from the background store and return its state.
 * Used when the user switches back to a background session.
 */
export function restoreSessionFromBackground(
  sessionKey: string,
): BackgroundSessionState | undefined {
  const state = backgroundSessions.get(sessionKey);
  if (state) {
    backgroundSessions.delete(sessionKey);
  }
  return state;
}

/**
 * Remove a session from the background store without returning state.
 * Used when a background run completes/errors/aborts.
 */
export function removeBackgroundSession(sessionKey: string): boolean {
  return backgroundSessions.delete(sessionKey);
}

/** Clear all background sessions (e.g. on disconnect). */
export function clearAllBackgroundSessions(): void {
  backgroundSessions.clear();
}

// ── Event routing ──────────────────────────────────────────────────────

/**
 * Handle a chat event for a background session.
 * Updates the stored state so it's fresh when the user switches back.
 *
 * Returns the event state string if handled, or null if the session is unknown.
 */
export function handleBackgroundChatEvent(
  sessionKey: string,
  payload: {
    runId: string;
    state: "delta" | "final" | "aborted" | "error";
    message?: unknown;
    errorMessage?: string;
    segments?: string[];
  },
): string | null {
  const bg = backgroundSessions.get(sessionKey);
  if (!bg) {
    return null;
  }

  // Only process events for the active run.
  if (payload.runId !== bg.chatRunId) {
    // Handle final from another run (sub-agent) - just append message.
    if (payload.state === "final" && payload.message) {
      const msg = payload.message as Record<string, unknown>;
      if (msg.role === "assistant" || (msg.content && Array.isArray(msg.content))) {
        bg.chatMessages = [...bg.chatMessages, msg];
      }
    }
    return null;
  }

  if (payload.state === "delta") {
    // Update stream text.
    const text = extractTextFromPayload(payload.message);
    if (typeof text === "string") {
      const current = bg.chatStream ?? "";
      if (!current || text.length >= current.length) {
        bg.chatStream = text;
        bg.chatStreamSegments = normalizeBackgroundSegments(
          payload.segments,
          bg.chatStreamSegments,
          bg.chatStreamStartedAt,
        );
      }
    }
  } else if (payload.state === "final") {
    // Run completed: append final message and clean up.
    if (payload.message) {
      const msg = payload.message as Record<string, unknown>;
      if (msg.content || msg.text) {
        bg.chatMessages = [...bg.chatMessages, msg];
      }
    }
    bg.chatStream = null;
    bg.chatStreamSegments = null;
    bg.chatRunId = "";
    bg.chatStreamStartedAt = null;
    // Mark as completed but keep in store so switching back shows the final state.
    // Remove from background since there's no active run anymore.
    removeBackgroundSession(sessionKey);
  } else if (payload.state === "aborted") {
    // Preserve any streamed text as a message.
    const streamedText = bg.chatStream?.trim();
    if (payload.message) {
      const msg = payload.message as Record<string, unknown>;
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        bg.chatMessages = [...bg.chatMessages, msg];
      }
    } else if (streamedText) {
      bg.chatMessages = [
        ...bg.chatMessages,
        {
          role: "assistant",
          content: [{ type: "text", text: streamedText }],
          timestamp: Date.now(),
        },
      ];
    }
    bg.chatStream = null;
    bg.chatStreamSegments = null;
    bg.chatRunId = "";
    bg.chatStreamStartedAt = null;
    removeBackgroundSession(sessionKey);
  } else if (payload.state === "error") {
    bg.chatStream = null;
    bg.chatStreamSegments = null;
    bg.chatRunId = "";
    bg.chatStreamStartedAt = null;
    bg.lastError = payload.errorMessage ?? "chat error";
    removeBackgroundSession(sessionKey);
  }

  return payload.state;
}

/**
 * Update chat stream text for a background session from an agent assistant event.
 */
export function updateBackgroundStreamFromAssistantText(sessionKey: string, text: string): void {
  const bg = backgroundSessions.get(sessionKey);
  if (!bg || !bg.chatRunId) {
    return;
  }
  const current = bg.chatStream ?? "";
  if (!current || text.length >= current.length) {
    bg.chatStream = text;
  }
}

// ── Internal helpers ───────────────────────────────────────────────────

/** Extract text from a chat event message payload. */
function extractTextFromPayload(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const msg = message as Record<string, unknown>;

  // Direct text field
  if (typeof msg.text === "string") {
    return msg.text;
  }

  // Content array with text blocks
  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (
        block &&
        typeof block === "object" &&
        (block as Record<string, unknown>).type === "text"
      ) {
        const text = (block as Record<string, unknown>).text;
        if (typeof text === "string") {
          return text;
        }
      }
    }
  }

  return null;
}
