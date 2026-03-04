import { refreshChat } from "./app-chat.ts";
import {
  startLogsPolling,
  stopLogsPolling,
  startDebugPolling,
  stopDebugPolling,
} from "./app-polling.ts";
import { scheduleChatScroll, scheduleLogsScroll } from "./app-scroll.ts";
import type { OpenClawApp } from "./app.ts";
import { loadAgentIdentities, loadAgentIdentity } from "./controllers/agent-identity.ts";
import { loadAgentSkills } from "./controllers/agent-skills.ts";
import { loadAgents, loadToolsCatalog } from "./controllers/agents.ts";
import { loadChannels } from "./controllers/channels.ts";
import { loadConfig, loadConfigSchema } from "./controllers/config.ts";
import {
  loadCronJobs,
  loadCronModelSuggestions,
  loadCronRuns,
  loadCronStatus,
} from "./controllers/cron.ts";
import { loadDebug } from "./controllers/debug.ts";
import { loadDevices } from "./controllers/devices.ts";
import { loadExecApprovals } from "./controllers/exec-approvals.ts";
import { loadLogs } from "./controllers/logs.ts";
import { loadNodes } from "./controllers/nodes.ts";
import { loadPresence } from "./controllers/presence.ts";
import { loadSessions } from "./controllers/sessions.ts";
import { loadSkills } from "./controllers/skills.ts";
import {
  inferBasePathFromPathname,
  normalizeBasePath,
  normalizePath,
  pathForTab,
  tabFromPath,
  type Tab,
} from "./navigation.ts";
import { saveSettings, type UiSettings } from "./storage.ts";
import { startThemeTransition, type ThemeTransitionContext } from "./theme-transition.ts";
import { resolveTheme, type ResolvedTheme, type ThemeMode } from "./theme.ts";
import type { AgentsListResult } from "./types.ts";

type SettingsHost = {
  settings: UiSettings;
  password?: string;
  theme: ThemeMode;
  themeResolved: ResolvedTheme;
  applySessionKey: string;
  sessionKey: string;
  tab: Tab;
  connected: boolean;
  chatHasAutoScrolled: boolean;
  logsAtBottom: boolean;
  eventLog: unknown[];
  eventLogBuffer: unknown[];
  basePath: string;
  agentsList?: AgentsListResult | null;
  agentsSelectedId?: string | null;
  agentsPanel?: "overview" | "files" | "tools" | "skills" | "channels" | "cron";
  themeMedia: MediaQueryList | null;
  themeMediaHandler: ((event: MediaQueryListEvent) => void) | null;
  pendingGatewayUrl?: string | null;
  // Session-related fields for ensureDefaultSession
  sessionsResult?: import("./types.ts").SessionsListResult | null;
  chatStream?: string | null;
  chatStreamSegments?: string[] | null;
  chatStreamStartedAt?: number | null;
  chatRunId?: string | null;
  chatQueue?: unknown[];
  chatSending?: boolean;
  chatMessage?: string;
  chatAttachments?: unknown[];
  lastError?: string | null;
  chatMessages?: unknown[];
  chatToolMessages?: unknown[];
};

export function applySettings(host: SettingsHost, next: UiSettings) {
  const normalized = {
    ...next,
    lastActiveSessionKey: next.lastActiveSessionKey?.trim() || "main",
  };
  host.settings = normalized;
  saveSettings(normalized);
  if (next.theme !== host.theme) {
    host.theme = next.theme;
    applyResolvedTheme(host, resolveTheme(next.theme));
  }
  host.applySessionKey = host.settings.lastActiveSessionKey;
}

export function setLastActiveSessionKey(host: SettingsHost, next: string) {
  const trimmed = next.trim();
  if (!trimmed) {
    return;
  }
  if (host.settings.lastActiveSessionKey === trimmed) {
    return;
  }
  applySettings(host, { ...host.settings, lastActiveSessionKey: trimmed });
}

export function applySettingsFromUrl(host: SettingsHost) {
  if (!window.location.search && !window.location.hash) {
    return;
  }
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.search);
  const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);

  const tokenRaw = params.get("token") ?? hashParams.get("token");
  const passwordRaw = params.get("password") ?? hashParams.get("password");
  const sessionRaw = params.get("session") ?? hashParams.get("session");
  const gatewayUrlRaw = params.get("gatewayUrl") ?? hashParams.get("gatewayUrl");
  let shouldCleanUrl = false;

  if (tokenRaw != null) {
    const token = tokenRaw.trim();
    if (token && token !== host.settings.token) {
      applySettings(host, { ...host.settings, token });
    }
    params.delete("token");
    hashParams.delete("token");
    shouldCleanUrl = true;
  }

  if (passwordRaw != null) {
    // Never hydrate password from URL params; strip only.
    params.delete("password");
    hashParams.delete("password");
    shouldCleanUrl = true;
  }

  if (sessionRaw != null) {
    const session = sessionRaw.trim();
    if (session) {
      host.sessionKey = session;
      // Only update lastActiveSessionKey in settings, don't save sessionKey to localStorage
      // sessionKey is now maintained only in memory per tab
      if (host.settings.lastActiveSessionKey !== session) {
        applySettings(host, {
          ...host.settings,
          lastActiveSessionKey: session,
        });
      }
    }
  }

  if (gatewayUrlRaw != null) {
    const gatewayUrl = gatewayUrlRaw.trim();
    if (gatewayUrl && gatewayUrl !== host.settings.gatewayUrl) {
      host.pendingGatewayUrl = gatewayUrl;
    }
    params.delete("gatewayUrl");
    hashParams.delete("gatewayUrl");
    shouldCleanUrl = true;
  }

  if (!shouldCleanUrl) {
    return;
  }
  url.search = params.toString();
  const nextHash = hashParams.toString();
  url.hash = nextHash ? `#${nextHash}` : "";
  window.history.replaceState({}, "", url.toString());
}

export function setTab(host: SettingsHost, next: Tab) {
  if (host.tab !== next) {
    host.tab = next;
  }
  if (next === "chat") {
    host.chatHasAutoScrolled = false;
  }
  if (next === "logs") {
    startLogsPolling(host as unknown as Parameters<typeof startLogsPolling>[0]);
  } else {
    stopLogsPolling(host as unknown as Parameters<typeof stopLogsPolling>[0]);
  }
  if (next === "debug") {
    startDebugPolling(host as unknown as Parameters<typeof startDebugPolling>[0]);
  } else {
    stopDebugPolling(host as unknown as Parameters<typeof stopDebugPolling>[0]);
  }
  void refreshActiveTab(host);
  syncUrlWithTab(host, next, false);
}

export function setTheme(host: SettingsHost, next: ThemeMode, context?: ThemeTransitionContext) {
  const applyTheme = () => {
    host.theme = next;
    applySettings(host, { ...host.settings, theme: next });
    applyResolvedTheme(host, resolveTheme(next));
  };
  startThemeTransition({
    nextTheme: next,
    applyTheme,
    context,
    currentTheme: host.theme,
  });
}

export async function refreshActiveTab(host: SettingsHost) {
  if (host.tab === "overview") {
    await loadOverview(host);
  }
  if (host.tab === "channels") {
    await loadChannelsTab(host);
  }
  if (host.tab === "instances") {
    await loadPresence(host as unknown as OpenClawApp);
  }
  if (host.tab === "sessions") {
    await loadSessions(host as unknown as OpenClawApp);
  }
  if (host.tab === "cron") {
    await loadCron(host);
  }
  if (host.tab === "skills") {
    await loadSkills(host as unknown as OpenClawApp);
  }
  if (host.tab === "agents") {
    await loadAgents(host as unknown as OpenClawApp);
    await loadToolsCatalog(host as unknown as OpenClawApp);
    await loadConfig(host as unknown as OpenClawApp);
    const agentIds = host.agentsList?.agents?.map((entry) => entry.id) ?? [];
    if (agentIds.length > 0) {
      void loadAgentIdentities(host as unknown as OpenClawApp, agentIds);
    }
    const agentId =
      host.agentsSelectedId ?? host.agentsList?.defaultId ?? host.agentsList?.agents?.[0]?.id;
    if (agentId) {
      void loadAgentIdentity(host as unknown as OpenClawApp, agentId);
      if (host.agentsPanel === "skills") {
        void loadAgentSkills(host as unknown as OpenClawApp, agentId);
      }
      if (host.agentsPanel === "channels") {
        void loadChannels(host as unknown as OpenClawApp, false);
      }
      if (host.agentsPanel === "cron") {
        void loadCron(host);
      }
    }
  }
  if (host.tab === "nodes") {
    await loadNodes(host as unknown as OpenClawApp);
    await loadDevices(host as unknown as OpenClawApp);
    await loadConfig(host as unknown as OpenClawApp);
    await loadExecApprovals(host as unknown as OpenClawApp);
  }
  if (host.tab === "chat") {
    await refreshChat(host as unknown as Parameters<typeof refreshChat>[0]);
    scheduleChatScroll(
      host as unknown as Parameters<typeof scheduleChatScroll>[0],
      !host.chatHasAutoScrolled,
    );
    // Load config for agent model display in chat header
    if (!(host as unknown as OpenClawApp).configSnapshot) {
      await loadConfig(host as unknown as OpenClawApp);
    }
  }
  if (host.tab === "config") {
    await loadConfigSchema(host as unknown as OpenClawApp);
    await loadConfig(host as unknown as OpenClawApp);
  }
  if (host.tab === "debug") {
    await loadDebug(host as unknown as OpenClawApp);
    host.eventLog = host.eventLogBuffer;
  }
  if (host.tab === "logs") {
    host.logsAtBottom = true;
    await loadLogs(host as unknown as OpenClawApp, { reset: true });
    scheduleLogsScroll(host as unknown as Parameters<typeof scheduleLogsScroll>[0], true);
  }
}

export function inferBasePath() {
  if (typeof window === "undefined") {
    return "";
  }
  const configured = window.__OPENCLAW_CONTROL_UI_BASE_PATH__;
  if (typeof configured === "string" && configured.trim()) {
    return normalizeBasePath(configured);
  }
  return inferBasePathFromPathname(window.location.pathname);
}

export function syncThemeWithSettings(host: SettingsHost) {
  host.theme = host.settings.theme ?? "system";
  applyResolvedTheme(host, resolveTheme(host.theme));
}

export function applyResolvedTheme(host: SettingsHost, resolved: ResolvedTheme) {
  host.themeResolved = resolved;
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
}

export function attachThemeListener(host: SettingsHost) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return;
  }
  host.themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
  host.themeMediaHandler = (event) => {
    if (host.theme !== "system") {
      return;
    }
    applyResolvedTheme(host, event.matches ? "dark" : "light");
  };
  if (typeof host.themeMedia.addEventListener === "function") {
    host.themeMedia.addEventListener("change", host.themeMediaHandler);
    return;
  }
  const legacy = host.themeMedia as MediaQueryList & {
    addListener: (cb: (event: MediaQueryListEvent) => void) => void;
  };
  legacy.addListener(host.themeMediaHandler);
}

export function detachThemeListener(host: SettingsHost) {
  if (!host.themeMedia || !host.themeMediaHandler) {
    return;
  }
  if (typeof host.themeMedia.removeEventListener === "function") {
    host.themeMedia.removeEventListener("change", host.themeMediaHandler);
    return;
  }
  const legacy = host.themeMedia as MediaQueryList & {
    removeListener: (cb: (event: MediaQueryListEvent) => void) => void;
  };
  legacy.removeListener(host.themeMediaHandler);
  host.themeMedia = null;
  host.themeMediaHandler = null;
}

export function syncTabWithLocation(host: SettingsHost, replace: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  const resolved = tabFromPath(window.location.pathname, host.basePath) ?? "chat";
  setTabFromRoute(host, resolved);
  syncUrlWithTab(host, resolved, replace);
}

export function onPopState(host: SettingsHost) {
  if (typeof window === "undefined") {
    return;
  }
  const resolved = tabFromPath(window.location.pathname, host.basePath);
  if (!resolved) {
    return;
  }

  const url = new URL(window.location.href);
  const session = url.searchParams.get("session")?.trim();
  if (session) {
    host.sessionKey = session;
    // Only update lastActiveSessionKey in settings, don't save sessionKey to localStorage
    if (host.settings.lastActiveSessionKey !== session) {
      applySettings(host, {
        ...host.settings,
        lastActiveSessionKey: session,
      });
    }
  }

  setTabFromRoute(host, resolved);
}

export function setTabFromRoute(host: SettingsHost, next: Tab) {
  if (host.tab !== next) {
    host.tab = next;
  }
  if (next === "chat") {
    host.chatHasAutoScrolled = false;
  }
  if (next === "logs") {
    startLogsPolling(host as unknown as Parameters<typeof startLogsPolling>[0]);
  } else {
    stopLogsPolling(host as unknown as Parameters<typeof stopLogsPolling>[0]);
  }
  if (next === "debug") {
    startDebugPolling(host as unknown as Parameters<typeof startDebugPolling>[0]);
  } else {
    stopDebugPolling(host as unknown as Parameters<typeof stopDebugPolling>[0]);
  }
  if (host.connected) {
    void refreshActiveTab(host);
  }
}

export function syncUrlWithTab(host: SettingsHost, tab: Tab, replace: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  const targetPath = normalizePath(pathForTab(tab, host.basePath));
  const currentPath = normalizePath(window.location.pathname);
  const url = new URL(window.location.href);

  if (tab === "chat" && host.sessionKey) {
    url.searchParams.set("session", host.sessionKey);
  } else {
    url.searchParams.delete("session");
  }

  if (currentPath !== targetPath) {
    url.pathname = targetPath;
  }

  if (replace) {
    window.history.replaceState({}, "", url.toString());
  } else {
    window.history.pushState({}, "", url.toString());
  }
}

export function syncUrlWithSessionKey(host: SettingsHost, sessionKey: string, replace: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.set("session", sessionKey);
  if (replace) {
    window.history.replaceState({}, "", url.toString());
  } else {
    window.history.pushState({}, "", url.toString());
  }
}

/**
 * Ensure a default session exists when the sessions list is empty.
 * Creates a new session with a unique key and updates the application state.
 */
function ensureDefaultSession(host: SettingsHost): void {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  const newSessionKey = `agent:main:${timestamp}-${randomSuffix}`;

  const newSession = {
    key: newSessionKey,
    kind: "direct" as const,
    label: "",
    updatedAt: timestamp,
  };

  // Create or update sessionsResult
  if (host.sessionsResult) {
    host.sessionsResult = {
      ...host.sessionsResult,
      sessions: [newSession],
    };
  } else {
    host.sessionsResult = {
      ts: timestamp,
      path: "",
      count: 1,
      defaults: { model: null, contextTokens: null },
      sessions: [newSession],
    };
  }

  // Update session key and related state
  host.sessionKey = newSessionKey;
  host.chatStream = null;
  host.chatStreamSegments = null;
  host.chatStreamStartedAt = null;
  host.chatRunId = null;
  host.chatQueue = [];
  host.chatSending = false;
  host.chatMessage = "";
  host.chatAttachments = [];
  host.lastError = null;
  host.chatMessages = [];
  host.chatToolMessages = [];

  // Update last active session key in settings
  applySettings(host, {
    ...host.settings,
    lastActiveSessionKey: newSessionKey,
  });

  // Update URL to reflect the new session
  const url = new URL(window.location.href);
  url.searchParams.set("session", newSessionKey);
  window.history.replaceState({}, "", url.toString());
}

export async function loadOverview(host: SettingsHost) {
  // Load sessions first and check if the list is empty
  const { isEmpty } = await loadSessions(host as unknown as OpenClawApp);

  // If no sessions exist, create a default one
  if (isEmpty) {
    ensureDefaultSession(host);
  }

  // Load other overview data in parallel
  await Promise.all([
    loadChannels(host as unknown as OpenClawApp, false),
    loadPresence(host as unknown as OpenClawApp),
    loadCronStatus(host as unknown as OpenClawApp),
    loadDebug(host as unknown as OpenClawApp),
  ]);
}

export async function loadChannelsTab(host: SettingsHost) {
  await Promise.all([
    loadChannels(host as unknown as OpenClawApp, true),
    loadConfigSchema(host as unknown as OpenClawApp),
    loadConfig(host as unknown as OpenClawApp),
  ]);
}

export async function loadCron(host: SettingsHost) {
  const cronHost = host as unknown as OpenClawApp;
  await Promise.all([
    loadChannels(host as unknown as OpenClawApp, false),
    loadCronStatus(cronHost),
    loadCronJobs(cronHost),
    loadCronModelSuggestions(cronHost),
  ]);
  if (cronHost.cronRunsScope === "all") {
    await loadCronRuns(cronHost, null);
    return;
  }
  if (cronHost.cronRunsJobId) {
    await loadCronRuns(cronHost, cronHost.cronRunsJobId);
  }
}
