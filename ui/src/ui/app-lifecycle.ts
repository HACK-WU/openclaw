import type { Tab } from "./navigation.ts";
import { connectGateway } from "./app-gateway.ts";
import {
  startLogsPolling,
  startNodesPolling,
  stopLogsPolling,
  stopNodesPolling,
  startDebugPolling,
  stopDebugPolling,
} from "./app-polling.ts";
import { observeTopbar, scheduleChatScroll, scheduleLogsScroll } from "./app-scroll.ts";
import {
  applySettingsFromUrl,
  attachThemeListener,
  detachThemeListener,
  inferBasePath,
  syncTabWithLocation,
  syncThemeWithSettings,
} from "./app-settings.ts";
import { checkChatStreamTimeout, loadChatHistory } from "./controllers/chat.ts";
import { loadSessions } from "./controllers/sessions.ts";

const CHAT_SESSIONS_ACTIVE_MINUTES = 120;
const SETTINGS_KEY = "openclaw.control.settings.v1";

/**
 * Heartbeat interval for detecting stale streaming state (ms).
 * Uses a longer interval to avoid excessive checking.
 */
const CHAT_HEARTBEAT_INTERVAL_MS = 10_000;

type LifecycleHost = {
  basePath: string;
  tab: Tab;
  connected: boolean;
  chatHasAutoScrolled: boolean;
  chatManualRefreshInFlight: boolean;
  chatLoading: boolean;
  chatMessages: unknown[];
  chatToolMessages: unknown[];
  chatStream: string;
  chatRunId: string | null;
  chatStreamSegments: string[] | null;
  chatStreamStartedAt: number | null;
  sessionKey: string;
  logsAutoFollow: boolean;
  logsAtBottom: boolean;
  logsEntries: unknown[];
  popStateHandler: () => void;
  storageHandler: ((e: StorageEvent) => void) | null;
  topbarObserver: ResizeObserver | null;
  chatHeartbeatInterval: ReturnType<typeof setInterval> | null;
  client: unknown;
};

export function handleConnected(host: LifecycleHost) {
  host.basePath = inferBasePath();
  applySettingsFromUrl(host as unknown as Parameters<typeof applySettingsFromUrl>[0]);
  syncTabWithLocation(host as unknown as Parameters<typeof syncTabWithLocation>[0], true);
  syncThemeWithSettings(host as unknown as Parameters<typeof syncThemeWithSettings>[0]);
  attachThemeListener(host as unknown as Parameters<typeof attachThemeListener>[0]);
  window.addEventListener("popstate", host.popStateHandler);

  // Set up storage event listener to sync sessions list across tabs
  host.storageHandler = (e: StorageEvent) => {
    if (e.key === SETTINGS_KEY && host.connected && host.tab === "chat") {
      // Reload sessions list when settings change in another tab
      void loadSessions(host as unknown as Parameters<typeof loadSessions>[0], {
        activeMinutes: CHAT_SESSIONS_ACTIVE_MINUTES,
      });
    }
  };
  window.addEventListener("storage", host.storageHandler);

  // Set up heartbeat for detecting stale streaming state
  host.chatHeartbeatInterval = setInterval(() => {
    handleChatHeartbeat(host);
  }, CHAT_HEARTBEAT_INTERVAL_MS);

  connectGateway(host as unknown as Parameters<typeof connectGateway>[0]);
  startNodesPolling(host as unknown as Parameters<typeof startNodesPolling>[0]);
  if (host.tab === "logs") {
    startLogsPolling(host as unknown as Parameters<typeof startLogsPolling>[0]);
  }
  if (host.tab === "debug") {
    startDebugPolling(host as unknown as Parameters<typeof startDebugPolling>[0]);
  }
}

/**
 * Heartbeat handler to detect and recover from stale streaming state.
 * If a chat stream has been active for too long without updates, refresh the history.
 */
function handleChatHeartbeat(host: LifecycleHost) {
  if (!host.connected || host.tab !== "chat") {
    return;
  }

  // Check for stream timeout
  if (checkChatStreamTimeout(host as unknown as Parameters<typeof checkChatStreamTimeout>[0])) {
    console.warn(
      "[chat-heartbeat] Stream timeout detected, clearing stale state and refreshing history",
    );
    // Clear stale streaming state
    host.chatRunId = null;
    (host as unknown as { chatStream: string | null }).chatStream = null;
    (host as unknown as { chatStreamSegments: string[] | null }).chatStreamSegments = null;
    (host as unknown as { chatStreamStartedAt: number | null }).chatStreamStartedAt = null;
    // Refresh chat history to get the actual state
    void loadChatHistory(host as unknown as Parameters<typeof loadChatHistory>[0]);
  }
}

export function handleFirstUpdated(host: LifecycleHost) {
  observeTopbar(host as unknown as Parameters<typeof observeTopbar>[0]);
}

export function handleDisconnected(host: LifecycleHost) {
  window.removeEventListener("popstate", host.popStateHandler);
  if (host.storageHandler) {
    window.removeEventListener("storage", host.storageHandler);
    host.storageHandler = null;
  }
  // Clear heartbeat interval
  if (host.chatHeartbeatInterval) {
    clearInterval(host.chatHeartbeatInterval);
    host.chatHeartbeatInterval = null;
  }
  stopNodesPolling(host as unknown as Parameters<typeof stopNodesPolling>[0]);
  stopLogsPolling(host as unknown as Parameters<typeof stopLogsPolling>[0]);
  stopDebugPolling(host as unknown as Parameters<typeof stopDebugPolling>[0]);
  detachThemeListener(host as unknown as Parameters<typeof detachThemeListener>[0]);
  host.topbarObserver?.disconnect();
  host.topbarObserver = null;
}

export function handleUpdated(host: LifecycleHost, changed: Map<PropertyKey, unknown>) {
  if (host.tab === "chat" && host.chatManualRefreshInFlight) {
    return;
  }
  if (
    host.tab === "chat" &&
    (changed.has("chatMessages") ||
      changed.has("chatToolMessages") ||
      changed.has("chatStream") ||
      changed.has("chatLoading") ||
      changed.has("tab"))
  ) {
    const forcedByTab = changed.has("tab");
    const forcedByLoad =
      changed.has("chatLoading") && changed.get("chatLoading") === true && !host.chatLoading;
    scheduleChatScroll(
      host as unknown as Parameters<typeof scheduleChatScroll>[0],
      forcedByTab || forcedByLoad || !host.chatHasAutoScrolled,
    );
  }
  if (
    host.tab === "logs" &&
    (changed.has("logsEntries") || changed.has("logsAutoFollow") || changed.has("tab"))
  ) {
    if (host.logsAutoFollow && host.logsAtBottom) {
      scheduleLogsScroll(
        host as unknown as Parameters<typeof scheduleLogsScroll>[0],
        changed.has("tab") || changed.has("logsAutoFollow"),
      );
    }
  }
}
