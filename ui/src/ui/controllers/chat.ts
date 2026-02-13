import type { GatewayBrowserClient } from "../gateway.ts";
import type { ChatAttachment } from "../ui-types.ts";
import { extractText } from "../chat/message-extract.ts";
import { generateUUID } from "../uuid.ts";

/**
 * Throttle interval for chat stream updates (ms).
 * Balances smooth visual updates (~20fps) with performance.
 */
export const CHAT_STREAM_THROTTLE_MS = 50;

/**
 * Timeout for detecting stale streaming state (ms).
 * If chatRunId exists but no updates for this duration, auto-refresh.
 */
export const CHAT_STREAM_TIMEOUT_MS = 60_000;

export type ChatState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionKey: string;
  chatLoading: boolean;
  chatMessages: unknown[];
  chatThinkingLevel: string | null;
  chatSending: boolean;
  chatMessage: string;
  chatAttachments: ChatAttachment[];
  chatRunId: string | null;
  chatStream: string | null;
  chatStreamSegments: string[] | null;
  chatStreamStartedAt: number | null;
  lastError: string | null;
};

/**
 * Internal buffer for throttling chat stream updates.
 * Not part of reactive state to avoid triggering re-renders.
 */
type ChatStreamThrottleState = {
  buffer: string | null;
  segmentsBuffer: string[] | null;
  pendingSync: number | null; // requestAnimationFrame ID or setTimeout ID
  lastSyncTime: number;
};

// Module-level throttle state (keyed by sessionKey for multi-session support)
const throttleStates = new Map<string, ChatStreamThrottleState>();

function getThrottleState(sessionKey: string): ChatStreamThrottleState {
  let ts = throttleStates.get(sessionKey);
  if (!ts) {
    ts = { buffer: null, segmentsBuffer: null, pendingSync: null, lastSyncTime: 0 };
    throttleStates.set(sessionKey, ts);
  }
  return ts;
}

/**
 * Schedule a throttled sync of the chat stream buffer to state.
 * Uses requestAnimationFrame for smooth visual updates.
 */
function scheduleChatStreamSync(state: ChatState, ts: ChatStreamThrottleState) {
  if (ts.pendingSync !== null) {
    return; // Already scheduled
  }

  const now = performance.now();
  const elapsed = now - ts.lastSyncTime;

  if (elapsed >= CHAT_STREAM_THROTTLE_MS) {
    // Enough time has passed, sync immediately
    syncChatStreamBuffer(state, ts);
  } else {
    // Schedule sync after remaining throttle time
    const delay = CHAT_STREAM_THROTTLE_MS - elapsed;
    ts.pendingSync = window.setTimeout(() => {
      ts.pendingSync = null;
      syncChatStreamBuffer(state, ts);
    }, delay);
  }
}

/**
 * Sync the buffered stream content to state, triggering a re-render.
 */
function syncChatStreamBuffer(state: ChatState, ts: ChatStreamThrottleState) {
  ts.lastSyncTime = performance.now();
  if (ts.buffer !== null && ts.buffer !== state.chatStream) {
    state.chatStream = ts.buffer;
    state.chatStreamSegments = ts.segmentsBuffer;
  }
}

/**
 * Force flush any pending stream buffer to state.
 * Called on final/abort/error to ensure final content is rendered.
 */
export function flushChatStream(state: ChatState) {
  const ts = getThrottleState(state.sessionKey);
  if (ts.pendingSync !== null) {
    window.clearTimeout(ts.pendingSync);
    ts.pendingSync = null;
  }
  if (ts.buffer !== null) {
    state.chatStream = ts.buffer;
    state.chatStreamSegments = ts.segmentsBuffer;
    ts.buffer = null;
    ts.segmentsBuffer = null;
  }
}

/**
 * Update chatStream from an agent `stream=assistant` event.
 * The server throttles `chat` delta events (150ms leading-edge only, no trailing),
 * so intermediate text is often lost. Agent events carry the cumulative text
 * for the current segment and arrive without throttling. Use them to fill the gap.
 *
 * Only updates when the new text is longer than the current buffer to avoid
 * regressing after tool-call boundaries where baselines are involved.
 */
export function updateChatStreamFromAssistantText(state: ChatState, text: string) {
  const current = state.chatStream ?? "";
  if (!current || text.length >= current.length) {
    const ts = getThrottleState(state.sessionKey);
    ts.buffer = text;
    // Agent events don't carry segment info; keep existing segments unchanged.
    scheduleChatStreamSync(state, ts);
  }
}

/**
 * Clear throttle state for a session (e.g., on disconnect or session switch).
 */
export function clearChatStreamThrottle(sessionKey: string) {
  const ts = throttleStates.get(sessionKey);
  if (ts) {
    if (ts.pendingSync !== null) {
      window.clearTimeout(ts.pendingSync);
    }
    throttleStates.delete(sessionKey);
  }
}

/**
 * Check if the current chat stream has timed out.
 * Returns true if we should auto-refresh the chat history.
 */
export function checkChatStreamTimeout(state: ChatState): boolean {
  if (!state.chatRunId || !state.chatStreamStartedAt) {
    return false;
  }
  const elapsed = Date.now() - state.chatStreamStartedAt;
  return elapsed > CHAT_STREAM_TIMEOUT_MS;
}

export type ChatEventPayload = {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "aborted" | "error";
  message?: unknown;
  errorMessage?: string;
};

export async function loadChatHistory(state: ChatState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.chatLoading = true;
  state.lastError = null;
  try {
    const res = await state.client.request<{ messages?: Array<unknown>; thinkingLevel?: string }>(
      "chat.history",
      {
        sessionKey: state.sessionKey,
        limit: 200,
      },
    );
    state.chatMessages = Array.isArray(res.messages) ? res.messages : [];
    state.chatThinkingLevel = res.thinkingLevel ?? null;
  } catch (err) {
    state.lastError = String(err);
  } finally {
    state.chatLoading = false;
  }
}

function dataUrlToBase64(dataUrl: string): { content: string; mimeType: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    return null;
  }
  return { mimeType: match[1], content: match[2] };
}

export async function sendChatMessage(
  state: ChatState,
  message: string,
  attachments?: ChatAttachment[],
): Promise<string | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  const msg = message.trim();
  const hasAttachments = attachments && attachments.length > 0;
  if (!msg && !hasAttachments) {
    return null;
  }

  const now = Date.now();

  // Build user message content blocks
  const contentBlocks: Array<{ type: string; text?: string; source?: unknown }> = [];
  if (msg) {
    contentBlocks.push({ type: "text", text: msg });
  }
  // Add image previews to the message for display
  if (hasAttachments) {
    for (const att of attachments) {
      contentBlocks.push({
        type: "image",
        source: { type: "base64", media_type: att.mimeType, data: att.dataUrl },
      });
    }
  }

  state.chatMessages = [
    ...state.chatMessages,
    {
      role: "user",
      content: contentBlocks,
      timestamp: now,
    },
  ];

  state.chatSending = true;
  state.lastError = null;
  const runId = generateUUID();
  state.chatRunId = runId;
  state.chatStream = "";
  state.chatStreamSegments = null;
  state.chatStreamStartedAt = now;

  // Convert attachments to API format
  const apiAttachments = hasAttachments
    ? attachments
        .map((att) => {
          const parsed = dataUrlToBase64(att.dataUrl);
          if (!parsed) {
            return null;
          }
          return {
            type: "image",
            mimeType: parsed.mimeType,
            content: parsed.content,
          };
        })
        .filter((a): a is NonNullable<typeof a> => a !== null)
    : undefined;

  try {
    await state.client.request("chat.send", {
      sessionKey: state.sessionKey,
      message: msg,
      deliver: false,
      idempotencyKey: runId,
      attachments: apiAttachments,
    });
    return runId;
  } catch (err) {
    const error = String(err);
    state.chatRunId = null;
    state.chatStream = null;
    state.chatStreamSegments = null;
    state.chatStreamStartedAt = null;
    state.lastError = error;
    state.chatMessages = [
      ...state.chatMessages,
      {
        role: "assistant",
        content: [{ type: "text", text: "Error: " + error }],
        timestamp: Date.now(),
      },
    ];
    return null;
  } finally {
    state.chatSending = false;
  }
}

export async function abortChatRun(state: ChatState): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  const runId = state.chatRunId;
  try {
    await state.client.request(
      "chat.abort",
      runId ? { sessionKey: state.sessionKey, runId } : { sessionKey: state.sessionKey },
    );
    return true;
  } catch (err) {
    state.lastError = String(err);
    return false;
  }
}

export function handleChatEvent(state: ChatState, payload?: ChatEventPayload) {
  if (!payload) {
    return null;
  }
  if (payload.sessionKey !== state.sessionKey) {
    return null;
  }

  // Final from another run (e.g. sub-agent announce): refresh history to show new message.
  // Return "final-other" so the caller can refresh history without clearing the active
  // run's stream state (chatRunId/chatStream). Clearing those would hide the Stop button
  // while the user's own run is still streaming.
  // See https://github.com/openclaw/openclaw/issues/1909
  if (payload.runId && state.chatRunId && payload.runId !== state.chatRunId) {
    if (payload.state === "final") {
      return "final-other";
    }
    return null;
  }

  if (payload.state === "delta") {
    const next = extractText(payload.message);
    if (typeof next === "string") {
      const current = state.chatStream ?? "";
      if (!current || next.length >= current.length) {
        // Use throttled buffer instead of direct state update
        const ts = getThrottleState(state.sessionKey);
        ts.buffer = next;
        // Capture segments from the payload (backend provides completed segment boundaries)
        const rawSegments = (payload as Record<string, unknown>).segments;
        ts.segmentsBuffer = Array.isArray(rawSegments) ? (rawSegments as string[]) : null;
        scheduleChatStreamSync(state, ts);
      }
    }
  } else if (payload.state === "final") {
    // Flush any pending buffer to ensure final content is rendered
    flushChatStream(state);
    // Note: Don't clear chatStream/chatRunId immediately - keep showing the final content
    // and accepting tool events until loadChatHistory completes.
    // Return "final" to signal that history should be loaded.
    return "final";
  } else if (payload.state === "aborted") {
    flushChatStream(state);
    state.chatStream = null;
    state.chatStreamSegments = null;
    state.chatRunId = null;
    state.chatStreamStartedAt = null;
  } else if (payload.state === "error") {
    flushChatStream(state);
    state.chatStream = null;
    state.chatStreamSegments = null;
    state.chatRunId = null;
    state.chatStreamStartedAt = null;
    state.lastError = payload.errorMessage ?? "chat error";
  }
  return payload.state;
}
