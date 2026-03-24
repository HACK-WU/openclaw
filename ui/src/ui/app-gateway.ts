import {
  GATEWAY_EVENT_UPDATE_AVAILABLE,
  type GatewayUpdateAvailableEventPayload,
} from "../../../src/gateway/events.js";
import { ConnectErrorDetailCodes } from "../../../src/gateway/protocol/connect-error-details.js";
import { CHAT_SESSIONS_ACTIVE_MINUTES, flushChatQueueForEvent } from "./app-chat.ts";
import type { EventLogEntry } from "./app-events.ts";
import {
  applySettings,
  loadCron,
  refreshActiveTab,
  setLastActiveSessionKey,
} from "./app-settings.ts";
import { handleAgentEvent, resetToolStream, type AgentEventPayload } from "./app-tool-stream.ts";
import type { OpenClawApp } from "./app.ts";
import { shouldReloadHistoryForFinalEvent } from "./chat-event-reload.ts";
import { loadAgents, loadCliAgents, loadToolsCatalog } from "./controllers/agents.ts";
import { loadAssistantIdentity } from "./controllers/assistant-identity.ts";
import {
  clearChatStreamThrottle,
  flushChatStream,
  handleChatEvent,
  loadChatHistory,
  updateChatStreamFromAssistantText,
  type ChatEventPayload,
} from "./controllers/chat.ts";
import { loadDevices } from "./controllers/devices.ts";
import type { ExecApprovalRequest } from "./controllers/exec-approval.ts";
import {
  addExecApproval,
  parseExecApprovalRequested,
  parseExecApprovalResolved,
  removeExecApproval,
} from "./controllers/exec-approval.ts";
import {
  enterGroupChat,
  handleGroupMessageEvent,
  handleGroupStreamEvent,
  handleGroupSystemEvent,
  handleGroupTerminalEvent,
  handleGroupTerminalStatusEvent,
  loadGroupList,
  openGroupList,
  type GroupChatMessage,
  type GroupChatState,
  type GroupStreamPayload,
  type GroupSystemPayload,
  type GroupTerminalPayload,
  type GroupTerminalStatusPayload,
} from "./controllers/group-chat.ts";
import { loadNodes } from "./controllers/nodes.ts";
import { loadSessions } from "./controllers/sessions.ts";
import {
  GatewayBrowserClient,
  resolveGatewayErrorDetailCode,
  type GatewayEventFrame,
  type GatewayHelloOk,
} from "./gateway.ts";
import type { Tab } from "./navigation.ts";
import type { UiSettings } from "./storage.ts";
import type {
  AgentsListResult,
  HealthSnapshot,
  PresenceEntry,
  StatusSummary,
  UpdateAvailable,
} from "./types.ts";

function isGenericBrowserFetchFailure(message: string): boolean {
  return /^(?:typeerror:\s*)?(?:fetch failed|failed to fetch)$/i.test(message.trim());
}

function formatAuthCloseErrorMessage(code: string | null, fallback: string): string {
  const resolvedCode = code ?? "";
  if (resolvedCode === ConnectErrorDetailCodes.AUTH_TOKEN_MISMATCH) {
    return "unauthorized: gateway token mismatch (open dashboard URL with current token)";
  }
  if (resolvedCode === ConnectErrorDetailCodes.AUTH_RATE_LIMITED) {
    return "unauthorized: too many failed authentication attempts (retry later)";
  }
  if (resolvedCode === ConnectErrorDetailCodes.AUTH_UNAUTHORIZED) {
    return "unauthorized: authentication failed";
  }
  return fallback;
}

type GatewayHost = {
  settings: UiSettings;
  password: string;
  clientInstanceId: string;
  client: GatewayBrowserClient | null;
  connected: boolean;
  hello: GatewayHelloOk | null;
  lastError: string | null;
  lastErrorCode: string | null;
  onboarding?: boolean;
  eventLogBuffer: EventLogEntry[];
  eventLog: EventLogEntry[];
  tab: Tab;
  presenceEntries: PresenceEntry[];
  presenceError: string | null;
  presenceStatus: StatusSummary | null;
  agentsLoading: boolean;
  agentsList: AgentsListResult | null;
  agentsError: string | null;
  toolsCatalogLoading: boolean;
  toolsCatalogError: string | null;
  toolsCatalogResult: import("./types.ts").ToolsCatalogResult | null;
  debugHealth: HealthSnapshot | null;
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
  serverVersion: string | null;
  sessionKey: string;
  chatRunId: string | null;
  refreshSessionsAfterChat: Set<string>;
  execApprovalQueue: ExecApprovalRequest[];
  execApprovalError: string | null;
  updateAvailable: UpdateAvailable | null;
  // Group chat navigation from URL ?group= parameter
  pendingGroupId?: string | null;
  // Group chat state
  groupListOpen: boolean;
  activeGroupId: string | null;
};

type SessionDefaultsSnapshot = {
  defaultAgentId?: string;
  mainKey?: string;
  mainSessionKey?: string;
  scope?: string;
};

export function resolveControlUiClientVersion(params: {
  gatewayUrl: string;
  serverVersion: string | null;
  pageUrl?: string;
}): string | undefined {
  const serverVersion = params.serverVersion?.trim();
  if (!serverVersion) {
    return undefined;
  }
  const pageUrl =
    params.pageUrl ?? (typeof window === "undefined" ? undefined : window.location.href);
  if (!pageUrl) {
    return undefined;
  }
  try {
    const page = new URL(pageUrl);
    const gateway = new URL(params.gatewayUrl, page);
    const allowedProtocols = new Set(["ws:", "wss:", "http:", "https:"]);
    if (!allowedProtocols.has(gateway.protocol) || gateway.host !== page.host) {
      return undefined;
    }
    return serverVersion;
  } catch {
    return undefined;
  }
}

function normalizeSessionKeyForDefaults(
  value: string | undefined,
  defaults: SessionDefaultsSnapshot,
): string {
  const raw = (value ?? "").trim();
  const mainSessionKey = defaults.mainSessionKey?.trim();
  if (!mainSessionKey) {
    return raw;
  }
  if (!raw) {
    return mainSessionKey;
  }
  const mainKey = defaults.mainKey?.trim() || "main";
  const defaultAgentId = defaults.defaultAgentId?.trim();
  const isAlias =
    raw === "main" ||
    raw === mainKey ||
    (defaultAgentId &&
      (raw === `agent:${defaultAgentId}:main` || raw === `agent:${defaultAgentId}:${mainKey}`));
  return isAlias ? mainSessionKey : raw;
}

function applySessionDefaults(host: GatewayHost, defaults?: SessionDefaultsSnapshot) {
  if (!defaults?.mainSessionKey) {
    return;
  }
  const resolvedSessionKey = normalizeSessionKeyForDefaults(host.sessionKey, defaults);
  const resolvedLastActiveSessionKey = normalizeSessionKeyForDefaults(
    host.settings.lastActiveSessionKey,
    defaults,
  );
  const nextSessionKey = resolvedSessionKey || host.sessionKey;
  const nextLastActiveSessionKey = resolvedLastActiveSessionKey || nextSessionKey;

  if (nextSessionKey !== host.sessionKey) {
    host.sessionKey = nextSessionKey;
  }
  if (nextLastActiveSessionKey !== host.settings.lastActiveSessionKey) {
    applySettings(host as unknown as Parameters<typeof applySettings>[0], {
      ...host.settings,
      lastActiveSessionKey: nextLastActiveSessionKey,
    });
  }
}

export function connectGateway(host: GatewayHost) {
  host.lastError = null;
  host.lastErrorCode = null;
  host.hello = null;
  host.connected = false;
  host.execApprovalQueue = [];
  host.execApprovalError = null;

  const previousClient = host.client;
  const clientVersion = resolveControlUiClientVersion({
    gatewayUrl: host.settings.gatewayUrl,
    serverVersion: host.serverVersion,
  });
  const client = new GatewayBrowserClient({
    url: host.settings.gatewayUrl,
    token: host.settings.token.trim() ? host.settings.token : undefined,
    password: host.password.trim() ? host.password : undefined,
    clientName: "openclaw-control-ui",
    clientVersion,
    mode: "webchat",
    instanceId: host.clientInstanceId,
    onHello: (hello) => {
      if (host.client !== client) {
        return;
      }
      host.connected = true;
      host.lastError = null;
      host.lastErrorCode = null;
      host.hello = hello;
      applySnapshot(host, hello);
      // Reset orphaned chat run state from before disconnect.
      // Any in-flight run's final event was lost during the disconnect window.
      // Flush any pending stream buffer before clearing state
      flushChatStream(host as unknown as OpenClawApp);
      // Clear throttle state for the current session
      clearChatStreamThrottle(host.sessionKey);
      host.chatRunId = null;
      (host as unknown as { chatStream: string | null }).chatStream = null;
      (
        host as unknown as { chatStreamSegments: Array<{ text: string; ts: number }> | null }
      ).chatStreamSegments = null;
      (host as unknown as { chatStreamStartedAt: number | null }).chatStreamStartedAt = null;
      resetToolStream(host as unknown as Parameters<typeof resetToolStream>[0]);
      void loadAssistantIdentity(host as unknown as OpenClawApp);
      void loadAgents(host as unknown as OpenClawApp);
      void loadToolsCatalog(host as unknown as OpenClawApp);
      void loadCliAgents(host as unknown as OpenClawApp);
      void loadNodes(host as unknown as OpenClawApp, { quiet: true });
      void loadDevices(host as unknown as OpenClawApp, { quiet: true });
      void loadGroupList(host as unknown as Parameters<typeof loadGroupList>[0]);
      // 无条件加载 sessions，确保导航栏对话列表在所有 tab 下都能显示。
      // refreshActiveTab 仅在 overview/sessions/chat tab 下加载 sessions，
      // 其余 tab（如 agents、skills、nodes 等）不会加载，导致对话列表为空。
      void loadSessions(host as unknown as OpenClawApp);
      void refreshActiveTab(host as unknown as Parameters<typeof refreshActiveTab>[0]);
      // Handle pending group ID from URL ?group= parameter
      if (host.pendingGroupId) {
        const groupId = host.pendingGroupId;
        host.pendingGroupId = null;
        // Open group list and enter the specific group
        openGroupList(host as unknown as Parameters<typeof openGroupList>[0]);
        void enterGroupChat(host as unknown as Parameters<typeof enterGroupChat>[0], groupId);
      }
    },
    onClose: ({ code, reason, error }) => {
      if (host.client !== client) {
        return;
      }
      host.connected = false;
      // Code 1012 = Service Restart (expected during config saves, don't show as error)
      host.lastErrorCode =
        resolveGatewayErrorDetailCode(error) ??
        (typeof error?.code === "string" ? error.code : null);
      if (code !== 1012) {
        if (error?.message) {
          host.lastError =
            host.lastErrorCode && isGenericBrowserFetchFailure(error.message)
              ? formatAuthCloseErrorMessage(host.lastErrorCode, error.message)
              : error.message;
          return;
        }
        host.lastError = `disconnected (${code}): ${reason || "no reason"}`;
      } else {
        host.lastError = null;
        host.lastErrorCode = null;
      }
    },
    onEvent: (evt) => {
      if (host.client !== client) {
        return;
      }
      handleGatewayEvent(host, evt);
    },
    onGap: ({ expected, received }) => {
      if (host.client !== client) {
        return;
      }
      host.lastError = `event gap detected (expected seq ${expected}, got ${received}); refresh recommended`;
      host.lastErrorCode = null;
    },
  });
  host.client = client;
  previousClient?.stop();
  client.start();
}

export function handleGatewayEvent(host: GatewayHost, evt: GatewayEventFrame) {
  try {
    handleGatewayEventUnsafe(host, evt);
  } catch (err) {
    console.error("[gateway] handleGatewayEvent error:", evt.event, err);
  }
}

function handleTerminalChatEvent(
  host: GatewayHost,
  payload: ChatEventPayload | undefined,
  state: ReturnType<typeof handleChatEvent>,
): boolean {
  if (state !== "final" && state !== "error" && state !== "aborted") {
    return false;
  }
  // Check if tool events were seen before resetting (resetToolStream clears toolStreamOrder).
  const toolHost = host as unknown as Parameters<typeof resetToolStream>[0];
  const hadToolEvents = toolHost.toolStreamOrder.length > 0;
  resetToolStream(toolHost);
  void flushChatQueueForEvent(host as unknown as Parameters<typeof flushChatQueueForEvent>[0]);
  const runId = payload?.runId;
  if (runId && host.refreshSessionsAfterChat.has(runId)) {
    host.refreshSessionsAfterChat.delete(runId);
    if (state === "final") {
      void loadSessions(host as unknown as OpenClawApp, {
        activeMinutes: CHAT_SESSIONS_ACTIVE_MINUTES,
      });
    }
  }
  // Reload history when tools were used so the persisted tool results
  // replace the now-cleared streaming state.
  if (hadToolEvents && state === "final") {
    void loadChatHistory(host as unknown as OpenClawApp);
    return true;
  }
  return false;
}

function handleChatGatewayEvent(host: GatewayHost, payload: ChatEventPayload | undefined) {
  if (payload?.sessionKey) {
    setLastActiveSessionKey(
      host as unknown as Parameters<typeof setLastActiveSessionKey>[0],
      payload.sessionKey,
    );
  }
  const state = handleChatEvent(host as unknown as OpenClawApp, payload);
  const historyReloaded = handleTerminalChatEvent(host, payload, state);
  if (state === "final" && !historyReloaded && shouldReloadHistoryForFinalEvent(payload)) {
    void loadChatHistory(host as unknown as OpenClawApp);
  }
}

function handleGatewayEventUnsafe(host: GatewayHost, evt: GatewayEventFrame) {
  host.eventLogBuffer = [
    { ts: Date.now(), event: evt.event, payload: evt.payload },
    ...host.eventLogBuffer,
  ].slice(0, 250);
  if (host.tab === "debug") {
    host.eventLog = host.eventLogBuffer;
  }

  if (evt.event === "agent") {
    if (host.onboarding) {
      return;
    }
    const agentPayload = evt.payload as AgentEventPayload | undefined;
    handleAgentEvent(host as unknown as Parameters<typeof handleAgentEvent>[0], agentPayload);
    // Use assistant stream text to keep chatStream up-to-date.
    // The server throttles chat delta events (150ms leading-edge, no trailing),
    // so most intermediate text is lost. Agent events carry the cumulative text
    // for the current segment without throttling — use them to fill the gap.
    if (agentPayload?.stream === "assistant" && typeof agentPayload.data?.text === "string") {
      const app = host as unknown as OpenClawApp;
      if (app.chatRunId) {
        const sessionKey =
          typeof agentPayload.sessionKey === "string" ? agentPayload.sessionKey : undefined;
        if (!sessionKey || sessionKey === app.sessionKey) {
          updateChatStreamFromAssistantText(app, agentPayload.data.text);
        }
      }
    }
    // Reload history after each tool result so the persisted text + tool
    // output replaces any truncated streaming fragments.
    const toolData = agentPayload?.data;
    if (
      agentPayload?.stream === "tool" &&
      typeof toolData?.phase === "string" &&
      toolData.phase === "result"
    ) {
      void loadChatHistory(host as unknown as OpenClawApp);
    }
    return;
  }

  if (evt.event === "chat") {
    handleChatGatewayEvent(host, evt.payload as ChatEventPayload | undefined);
    return;
  }

  if (evt.event === "presence") {
    const payload = evt.payload as { presence?: PresenceEntry[] } | undefined;
    if (payload?.presence && Array.isArray(payload.presence)) {
      host.presenceEntries = payload.presence;
      host.presenceError = null;
      host.presenceStatus = null;
    }
    return;
  }

  if (evt.event === "cron" && host.tab === "cron") {
    void loadCron(host as unknown as Parameters<typeof loadCron>[0]);
  }

  if (evt.event === "device.pair.requested" || evt.event === "device.pair.resolved") {
    void loadDevices(host as unknown as OpenClawApp, { quiet: true });
  }

  if (evt.event === "exec.approval.requested") {
    const entry = parseExecApprovalRequested(evt.payload);
    if (entry) {
      host.execApprovalQueue = addExecApproval(host.execApprovalQueue, entry);
      host.execApprovalError = null;
      const delay = Math.max(0, entry.expiresAtMs - Date.now() + 500);
      window.setTimeout(() => {
        host.execApprovalQueue = removeExecApproval(host.execApprovalQueue, entry.id);
      }, delay);
    }
    return;
  }

  if (evt.event === "exec.approval.resolved") {
    const resolved = parseExecApprovalResolved(evt.payload);
    if (resolved) {
      host.execApprovalQueue = removeExecApproval(host.execApprovalQueue, resolved.id);
    }
    return;
  }

  if (evt.event === GATEWAY_EVENT_UPDATE_AVAILABLE) {
    const payload = evt.payload as GatewayUpdateAvailableEventPayload | undefined;
    host.updateAvailable = payload?.updateAvailable ?? null;
  }

  // Group chat events
  if (evt.event === "group.message") {
    const payload = evt.payload as { groupId: string; message?: GroupChatMessage } | undefined;
    if (payload?.message) {
      handleGroupMessageEvent(host as unknown as GroupChatState, {
        groupId: payload.groupId,
        ...payload.message,
      });
    }
    return;
  }
  if (evt.event === "group.stream") {
    const payload = evt.payload as GroupStreamPayload | undefined;
    if (payload) {
      handleGroupStreamEvent(host as unknown as GroupChatState, payload);
    }
    return;
  }
  if (evt.event === "group.system") {
    const payload = evt.payload as GroupSystemPayload | undefined;
    if (payload) {
      handleGroupSystemEvent(host as unknown as GroupChatState, payload);
    }
    return;
  }
  if (evt.event === "group.members_updated") {
    const payload = evt.payload as
      | { groupId?: string; members?: unknown; data?: unknown }
      | undefined;
    if (payload?.groupId) {
      handleGroupSystemEvent(host as unknown as GroupChatState, {
        groupId: payload.groupId,
        event: "members_updated",
        data: payload.data ?? { members: payload.members },
      });
    }
    return;
  }

  // CLI Agent test terminal output events
  if (evt.event === "cliAgents.testOutput") {
    const payload = evt.payload as { agentId?: string; data?: string } | undefined;
    if (payload?.data) {
      // Store base64 data directly; cli-test-terminal component will decode it
      const app = host as unknown as OpenClawApp;
      app.cliTestTerminalData = [...app.cliTestTerminalData, payload.data];
    }
    return;
  }

  // Bridge Agent terminal events
  if (evt.event === "group.terminal") {
    const payload = evt.payload as GroupTerminalPayload | undefined;
    if (payload) {
      handleGroupTerminalEvent(host as unknown as GroupChatState, payload);
    }
    return;
  }
  if (evt.event === "group.terminalStatus") {
    const payload = evt.payload as GroupTerminalStatusPayload | undefined;
    if (payload) {
      handleGroupTerminalStatusEvent(host as unknown as GroupChatState, payload);
    }
    return;
  }
}

export function applySnapshot(host: GatewayHost, hello: GatewayHelloOk) {
  const snapshot = hello.snapshot as
    | {
        presence?: PresenceEntry[];
        health?: HealthSnapshot;
        sessionDefaults?: SessionDefaultsSnapshot;
        updateAvailable?: UpdateAvailable;
      }
    | undefined;
  if (snapshot?.presence && Array.isArray(snapshot.presence)) {
    host.presenceEntries = snapshot.presence;
  }
  if (snapshot?.health) {
    host.debugHealth = snapshot.health;
  }
  if (snapshot?.sessionDefaults) {
    applySessionDefaults(host, snapshot.sessionDefaults);
  }
  host.updateAvailable = snapshot?.updateAvailable ?? null;
}
