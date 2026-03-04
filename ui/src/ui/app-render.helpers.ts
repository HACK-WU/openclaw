import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { parseAgentSessionKey } from "../../../src/routing/session-key.js";
import { refreshChat, switchSession } from "./app-chat.ts";
import { syncUrlWithSessionKey } from "./app-settings.ts";
import type { AppViewState } from "./app-view-state.ts";
import { OpenClawApp } from "./app.ts";
import { ChatState, loadChatHistory } from "./controllers/chat.ts";
import { loadGroupList, enterGroupChat } from "./controllers/group-chat.ts";
import { generateSessionTitle } from "./controllers/sessions.ts";
import { formatRelativeTimestamp } from "./format.ts";
import { getAvailableLocales, type LocaleCode } from "./i18n/index.ts";
import { t } from "./i18n/index.ts";
import { icons } from "./icons.ts";
import { iconForTab, pathForTab, titleForTab, type Tab } from "./navigation.ts";
import type { ThemeTransitionContext } from "./theme-transition.ts";
import type { ThemeMode } from "./theme.ts";
import type { SessionsListResult, GatewaySessionRow } from "./types.ts";
import { resolveAgentConfig, resolveModelLabel, resolveAgentEmoji } from "./views/agents-utils.ts";
import type { DeleteSessionDialogState } from "./views/delete-session-dialog.ts";

type SessionDefaultsSnapshot = {
  mainSessionKey?: string;
  mainKey?: string;
};

function resolveSidebarChatSessionKey(state: AppViewState): string {
  const snapshot = state.hello?.snapshot as
    | { sessionDefaults?: SessionDefaultsSnapshot }
    | undefined;
  const mainSessionKey = snapshot?.sessionDefaults?.mainSessionKey?.trim();
  if (mainSessionKey) {
    return mainSessionKey;
  }
  const mainKey = snapshot?.sessionDefaults?.mainKey?.trim();
  if (mainKey) {
    return mainKey;
  }
  return "main";
}

function resetChatStateForSessionSwitch(state: AppViewState, sessionKey: string) {
  state.sessionKey = sessionKey;
  state.chatMessage = "";
  state.chatStream = null;
  (state as unknown as OpenClawApp).chatStreamStartedAt = null;
  state.chatRunId = null;
  (state as unknown as OpenClawApp).resetToolStream();
  (state as unknown as OpenClawApp).resetChatScroll();
  state.applySettings({
    ...state.settings,
    sessionKey,
    lastActiveSessionKey: sessionKey,
  });
}

export function renderTab(state: AppViewState, tab: Tab) {
  const href = pathForTab(tab, state.basePath);
  return html`
    <a
      href=${href}
      class="nav-item ${state.tab === tab ? "active" : ""}"
      @click=${(event: MouseEvent) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        if (tab === "chat") {
          const mainSessionKey = resolveSidebarChatSessionKey(state);
          if (state.sessionKey !== mainSessionKey) {
            resetChatStateForSessionSwitch(state, mainSessionKey);
            void state.loadAssistantIdentity();
          }
        }
        state.setTab(tab);
      }}
      title=${titleForTab(tab)}
    >
      <span class="nav-item__icon" aria-hidden="true">${icons[iconForTab(tab)]}</span>
      <span class="nav-item__text">${titleForTab(tab)}</span>
    </a>
  `;
}

export function renderChatControls(state: AppViewState) {
  const mainSessionKey = resolveMainSessionKey(state.hello, state.sessionsResult);
  const sessionOptions = resolveSessionOptions(
    state.sessionKey,
    state.sessionsResult,
    mainSessionKey,
  );
  const disableThinkingToggle = state.onboarding;
  const disableFocusToggle = state.onboarding;
  const showThinking = state.onboarding ? false : state.settings.chatShowThinking;
  const focusActive = state.onboarding ? true : state.settings.chatFocusMode;
  // Refresh icon
  const refreshIcon = html`
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
      <path d="M21 3v5h-5"></path>
    </svg>
  `;
  const focusIcon = html`
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M4 7V4h3"></path>
      <path d="M20 7V4h-3"></path>
      <path d="M4 17v3h3"></path>
      <path d="M20 17v3h-3"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `;
  const agents = state.agentsList?.agents ?? [];
  // Derive current agent from session key
  const parsed = parseAgentSessionKey(state.sessionKey);
  const currentAgentId = parsed?.agentId;
  const currentAgent = currentAgentId ? agents.find((a) => a.id === currentAgentId) : undefined;
  // Resolve agent emoji and name
  const agentEmoji = currentAgent ? resolveAgentEmoji(currentAgent, null) : "🤖";
  const agentName = currentAgent?.identity?.name ?? currentAgentId ?? "Default";
  // Resolve model label from config
  const configForm = (state as unknown as { configForm: Record<string, unknown> | null })
    .configForm;
  const configValue =
    configForm ?? (state.configSnapshot?.config as Record<string, unknown> | null);
  const agentConfig = currentAgentId ? resolveAgentConfig(configValue, currentAgentId) : null;
  const modelLabel = agentConfig
    ? resolveModelLabel(agentConfig.entry?.model ?? agentConfig.defaults?.model)
    : null;
  const hasModel = modelLabel && modelLabel !== "-";
  return html`
    <div class="chat-controls">
      ${
        agents.length > 0
          ? html`
              <span class="field chat-controls__agent chat-controls__agent--readonly">
                <span class="chat-controls__agent-emoji">${agentEmoji}</span><span class="chat-controls__agent-name">${agentName}</span>
                ${
                  hasModel
                    ? html`<span class="chat-controls__agent-model">${modelLabel}</span>`
                    : nothing
                }
              </span>
            `
          : nothing
      }
      <label class="field chat-controls__session">
        <select
          .value=${state.sessionKey}
          ?disabled=${!state.connected}
          @change=${(e: Event) => {
            const next = (e.target as HTMLSelectElement).value;
            state.sessionKey = next;
            state.chatMessage = "";
            state.chatStream = null;
            (state as unknown as OpenClawApp).chatStreamSegments = null;
            (state as unknown as OpenClawApp).chatStreamStartedAt = null;
            state.chatRunId = null;
            (state as unknown as OpenClawApp).resetToolStream();
            (state as unknown as OpenClawApp).resetChatScroll();
            state.applySettings({
              ...state.settings,
              lastActiveSessionKey: next,
            });
            void state.loadAssistantIdentity();
            syncUrlWithSessionKey(
              state as unknown as Parameters<typeof syncUrlWithSessionKey>[0],
              next,
              true,
            );
            void loadChatHistory(state as unknown as ChatState);
          }}
        >
          ${repeat(
            sessionOptions,
            (entry) => entry.key,
            (entry) =>
              html`<option value=${entry.key} title=${entry.key}>
                ${entry.displayName ?? entry.key}
              </option>`,
          )}
        </select>
      </label>
      <button
        class="btn btn--sm btn--icon"
        ?disabled=${state.chatLoading || !state.connected}
        @click=${async () => {
          const app = state as unknown as OpenClawApp;
          const isStreaming = Boolean(app.chatRunId);
          app.chatManualRefreshInFlight = true;
          app.chatNewMessagesBelow = false;
          await app.updateComplete;
          // Don't reset tool stream during active streaming — the live tool
          // cards are the canonical source and clearing them causes flicker
          // plus duplication once they re-accumulate from agent events.
          if (!isStreaming) {
            app.resetToolStream();
          }
          try {
            await refreshChat(state as unknown as Parameters<typeof refreshChat>[0], {
              scheduleScroll: false,
              // Skip loading chat history during active streaming to prevent
              // duplication between persisted history and live stream content.
              skipHistory: isStreaming,
            });
            app.scrollToBottom({ smooth: true });
          } finally {
            requestAnimationFrame(() => {
              app.chatManualRefreshInFlight = false;
              app.chatNewMessagesBelow = false;
            });
          }
        }}
        title=${t("chat.refreshTitle")}
      >
        ${refreshIcon}
      </button>
      <span class="chat-controls__separator">|</span>
      <button
        class="btn btn--sm btn--icon ${showThinking ? "active" : ""}"
        ?disabled=${disableThinkingToggle}
        @click=${() => {
          if (disableThinkingToggle) {
            return;
          }
          state.applySettings({
            ...state.settings,
            chatShowThinking: !state.settings.chatShowThinking,
          });
        }}
        aria-pressed=${showThinking}
        title=${disableThinkingToggle ? t("chat.onboardingDisabled") : t("chat.thinkingToggle")}
      >
        ${icons.brain}
      </button>
      <button
        class="btn btn--sm btn--icon ${focusActive ? "active" : ""}"
        ?disabled=${disableFocusToggle}
        @click=${() => {
          if (disableFocusToggle) {
            return;
          }
          state.applySettings({
            ...state.settings,
            chatFocusMode: !state.settings.chatFocusMode,
          });
        }}
        aria-pressed=${focusActive}
        title=${disableFocusToggle ? t("chat.onboardingDisabled") : t("chat.focusToggle")}
      >
        ${focusIcon}
      </button>
    </div>
  `;
}

function resolveMainSessionKey(
  hello: AppViewState["hello"],
  sessions: SessionsListResult | null,
): string | null {
  const snapshot = hello?.snapshot as { sessionDefaults?: SessionDefaultsSnapshot } | undefined;
  const mainSessionKey = snapshot?.sessionDefaults?.mainSessionKey?.trim();
  if (mainSessionKey) {
    return mainSessionKey;
  }
  const mainKey = snapshot?.sessionDefaults?.mainKey?.trim();
  if (mainKey) {
    return mainKey;
  }
  if (sessions?.sessions?.some((row) => row.key === "main")) {
    return "main";
  }
  return null;
}

/* ── Channel display labels ────────────────────────────── */
const CHANNEL_LABELS: Record<string, string> = {
  bluebubbles: "iMessage",
  telegram: "Telegram",
  discord: "Discord",
  signal: "Signal",
  slack: "Slack",
  whatsapp: "WhatsApp",
  matrix: "Matrix",
  email: "Email",
  sms: "SMS",
};

const KNOWN_CHANNEL_KEYS = Object.keys(CHANNEL_LABELS);

/** Parsed type / context extracted from a session key. */
export type SessionKeyInfo = {
  /** Prefix for typed sessions (Subagent:/Cron:). Empty for others. */
  prefix: string;
  /** Human-readable fallback when no label / displayName is available. */
  fallbackName: string;
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Parse a session key to extract type information and a human-readable
 * fallback display name.  Exported for testing.
 */
export function parseSessionKey(key: string): SessionKeyInfo {
  // ── Main session ─────────────────────────────────
  if (key === "main" || key === "agent:main:main") {
    // Show full session key format instead of generic "Main Session"
    return { prefix: "", fallbackName: key === "main" ? "agent:main:main" : key };
  }

  // ── Subagent ─────────────────────────────────────
  if (key.includes(":subagent:")) {
    return { prefix: "Subagent:", fallbackName: "Subagent:" };
  }

  // ── Cron job ─────────────────────────────────────
  if (key.includes(":cron:")) {
    return { prefix: "Cron:", fallbackName: "Cron Job:" };
  }

  // ── Direct chat  (agent:<x>:<channel>:direct:<id>) ──
  const directMatch = key.match(/^agent:[^:]+:([^:]+):direct:(.+)$/);
  if (directMatch) {
    const channel = directMatch[1];
    const identifier = directMatch[2];
    const channelLabel = CHANNEL_LABELS[channel] ?? capitalize(channel);
    return { prefix: "", fallbackName: `${channelLabel} · ${identifier}` };
  }

  // ── Group chat  (agent:<x>:<channel>:group:<id>) ────
  const groupMatch = key.match(/^agent:[^:]+:([^:]+):group:(.+)$/);
  if (groupMatch) {
    const channel = groupMatch[1];
    const channelLabel = CHANNEL_LABELS[channel] ?? capitalize(channel);
    return { prefix: "", fallbackName: `${channelLabel} Group` };
  }

  // ── Channel-prefixed legacy keys (e.g. "bluebubbles:g-…") ──
  for (const ch of KNOWN_CHANNEL_KEYS) {
    if (key === ch || key.startsWith(`${ch}:`)) {
      return { prefix: "", fallbackName: `${CHANNEL_LABELS[ch]} Session` };
    }
  }

  // ── Unknown — return key as-is ───────────────────
  return { prefix: "", fallbackName: key };
}

export function resolveSessionDisplayName(
  key: string,
  row?: SessionsListResult["sessions"][number],
): string {
  const label = row?.label?.trim() || "";
  const displayName = row?.displayName?.trim() || "";
  const { prefix, fallbackName } = parseSessionKey(key);

  const applyTypedPrefix = (name: string): string => {
    if (!prefix) {
      return name;
    }
    const prefixPattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*`, "i");
    return prefixPattern.test(name) ? name : `${prefix} ${name}`;
  };

  if (label && label !== key) {
    return applyTypedPrefix(label);
  }
  if (displayName && displayName !== key) {
    return applyTypedPrefix(displayName);
  }
  return fallbackName;
}

function resolveSessionOptions(
  sessionKey: string,
  sessions: SessionsListResult | null,
  mainSessionKey?: string | null,
) {
  const seen = new Set<string>();
  const options: Array<{ key: string; displayName?: string }> = [];

  const resolvedMain = mainSessionKey && sessions?.sessions?.find((s) => s.key === mainSessionKey);
  const resolvedCurrent = sessions?.sessions?.find((s) => s.key === sessionKey);

  // Add main session key first
  if (mainSessionKey) {
    seen.add(mainSessionKey);
    options.push({
      key: mainSessionKey,
      displayName: resolveSessionDisplayName(mainSessionKey, resolvedMain || undefined),
    });
  }

  // Add current session key next
  if (!seen.has(sessionKey)) {
    seen.add(sessionKey);
    options.push({
      key: sessionKey,
      displayName: resolveSessionDisplayName(sessionKey, resolvedCurrent),
    });
  }

  // Add sessions from the result
  if (sessions?.sessions) {
    for (const s of sessions.sessions) {
      if (!seen.has(s.key)) {
        seen.add(s.key);
        options.push({
          key: s.key,
          displayName: resolveSessionDisplayName(s.key, s),
        });
      }
    }
  }

  return options;
}

const THEME_ORDER: ThemeMode[] = ["system", "light", "dark"];

export function renderThemeToggle(state: AppViewState) {
  const index = Math.max(0, THEME_ORDER.indexOf(state.theme));
  const applyTheme = (next: ThemeMode) => (event: MouseEvent) => {
    const element = event.currentTarget as HTMLElement;
    const context: ThemeTransitionContext = { element };
    if (event.clientX || event.clientY) {
      context.pointerClientX = event.clientX;
      context.pointerClientY = event.clientY;
    }
    state.setTheme(next, context);
  };

  return html`
    <div class="theme-toggle" style="--theme-index: ${index};">
      <div class="theme-toggle__track" role="group" aria-label="Theme">
        <span class="theme-toggle__indicator"></span>
        <button
          class="theme-toggle__button ${state.theme === "system" ? "active" : ""}"
          @click=${applyTheme("system")}
          aria-pressed=${state.theme === "system"}
          aria-label="System theme"
          title="System"
        >
          ${renderMonitorIcon()}
        </button>
        <button
          class="theme-toggle__button ${state.theme === "light" ? "active" : ""}"
          @click=${applyTheme("light")}
          aria-pressed=${state.theme === "light"}
          aria-label="Light theme"
          title="Light"
        >
          ${renderSunIcon()}
        </button>
        <button
          class="theme-toggle__button ${state.theme === "dark" ? "active" : ""}"
          @click=${applyTheme("dark")}
          aria-pressed=${state.theme === "dark"}
          aria-label="Dark theme"
          title="Dark"
        >
          ${renderMoonIcon()}
        </button>
      </div>
    </div>
  `;
}

function renderSunIcon() {
  return html`
    <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4"></circle>
      <path d="M12 2v2"></path>
      <path d="M12 20v2"></path>
      <path d="m4.93 4.93 1.41 1.41"></path>
      <path d="m17.66 17.66 1.41 1.41"></path>
      <path d="M2 12h2"></path>
      <path d="M20 12h2"></path>
      <path d="m6.34 17.66-1.41 1.41"></path>
      <path d="m19.07 4.93-1.41 1.41"></path>
    </svg>
  `;
}

function renderMoonIcon() {
  return html`
    <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"
      ></path>
    </svg>
  `;
}

function renderMonitorIcon() {
  return html`
    <svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect width="20" height="14" x="2" y="3" rx="2"></rect>
      <line x1="8" x2="16" y1="21" y2="21"></line>
      <line x1="12" x2="12" y1="17" y2="21"></line>
    </svg>
  `;
}

export function renderLocaleToggle(state: AppViewState) {
  const locales = getAvailableLocales();

  return html`
    <div class="locale-toggle">
      <select
        class="locale-toggle__select"
        .value=${state.locale}
        @change=${(e: Event) => {
          const next = (e.target as HTMLSelectElement).value as LocaleCode;
          state.setLocale(next);
        }}
        aria-label="Select language"
        title="Language"
      >
        ${locales.map(
          (locale) => html`
            <option value=${locale.code} ?selected=${state.locale === locale.code}>
              ${locale.name}
            </option>
          `,
        )}
      </select>
      ${renderGlobeIcon()}
    </div>
  `;
}

function renderGlobeIcon() {
  return html`
    <svg class="locale-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path>
      <path d="M2 12h20"></path>
    </svg>
  `;
}

// Maximum number of sessions to display in nav sidebar for performance
const NAV_SESSIONS_LIMIT = 50;

// Sidebar sessions list for chat navigation group
/**
 * 渲染导航栏中的会话列表
 *
 * 该函数负责在侧边栏的聊天分组中显示可用的会话列表。
 * 会话列表根据当前连接状态、加载状态和会话数量显示不同的内容。
 *
 * @param state - 应用视图状态，包含会话数据和 UI 状态
 * @returns 会话列表的 HTML 模板
 */
export function renderNavSessionsList(state: AppViewState) {
  // 从状态中提取会话数据
  const sessions = state.sessionsResult?.sessions ?? []; // 所有会话列表
  const currentSessionKey = state.sessionKey; // 当前选中的会话键
  const isLoading = state.sessionsLoading; // 是否正在加载会话
  const isConnected = state.connected; // 是否已连接到 Gateway

  // 为性能考虑，限制显示的会话数量
  const displaySessions = sessions.slice(0, NAV_SESSIONS_LIMIT); // 仅显示前 N 个会话
  const hasMore = sessions.length > NAV_SESSIONS_LIMIT; // 是否还有更多会话未显示

  return html`
    <!-- 导航栏会话列表容器 -->
    <div class="nav-sessions">
      ${
        // 状态 1: 未连接到 Gateway - 显示离线提示
        !isConnected
          ? html`<div class="nav-sessions__empty nav-sessions__empty--offline">${t("chat.sidebar.offline")}</div>`
          : // 状态 2: 正在加载且无会话数据 - 显示加载提示
            isLoading && sessions.length === 0
            ? html`<div class="nav-sessions__empty nav-sessions__empty--loading">${t("chat.sidebar.loading")}</div>`
            : // 状态 3: 加载完成但无会话 - 显示无会话提示
              sessions.length === 0
              ? html`<div class="nav-sessions__empty">${t("chat.sidebar.noSessions")}</div>`
              : // 状态 4: 有会话数据 - 渲染会话列表
                html`
                <!-- 会话列表（使用 repeat 优化渲染性能） -->
                <ul class="nav-sessions__list">
                  ${repeat(
                    displaySessions, // 要渲染的数据数组
                    (session) => session.key, // 唯一标识符（用于 diff 算法）
                    (session) =>
                      // 渲染单个会话项
                      renderNavSessionItem(session, currentSessionKey, state, sessions.length),
                  )}
                </ul>
                <!-- 如果有更多会话未显示，显示提示信息 -->
                ${hasMore ? html`<div class="nav-sessions__more">${t("chat.sidebar.moreCount", { count: sessions.length - NAV_SESSIONS_LIMIT })}</div>` : nothing}
              `
      }
    </div>
  `;
}

/**
 * 渲染导航栏中的单个会话项
 *
 * 该函数负责在侧边栏会话列表中显示单个会话的卡片，包括：
 * - 会话图标（根据是否激活显示不同图标）
 * - 会话名称和最后更新时间
 * - 删除按钮（当会话总数大于1时显示）
 *
 * @param session - 会话数据，包含键、标签、更新时间等信息
 * @param currentSessionKey - 当前激活的会话键，用于判断会话是否处于激活状态
 * @param state - 应用视图状态，包含连接状态、切换状态等全局信息
 * @param totalSessions - 会话总数，用于判断是否显示删除按钮
 * @returns 单个会话项的 HTML 模板
 */
function renderNavSessionItem(
  session: GatewaySessionRow,
  currentSessionKey: string,
  state: AppViewState & { sessionsGeneratingTitle?: Set<string> },
  totalSessions: number,
) {
  // 检查是否正在生成标题
  const isGeneratingTitle = state.sessionsGeneratingTitle?.has(session.key) ?? false;
  // 判断当前会话是否处于激活状态
  const isActive = session.key === currentSessionKey;

  // 获取会话的显示名称：优先使用自定义标签，否则使用会话键
  const displayName = session.label || session.key;

  // 格式化最后更新时间（如："3分钟前"、"1小时前"）
  const updatedAgo = session.updatedAt ? formatRelativeTimestamp(session.updatedAt) : "";

  // 检查是否正在切换会话（用于防止重复点击）
  const isSwitching = (state as unknown as { sessionSwitching?: boolean }).sessionSwitching;

  return html`
    <!-- 会话列表项容器，根据状态添加不同的 CSS 类 -->
    <li
      class="nav-sessions__item ${isActive ? "nav-sessions__item--active" : ""} ${isSwitching ? "nav-sessions__item--switching" : ""}"
      title="${session.key}"
    >
      <!-- 会话项主要内容区域（可点击） -->
      <div
        class="nav-sessions__item-main"
        @click=${() => {
          // 防护措施：如果正在切换或未连接，则忽略点击
          if (isSwitching || !state.connected) {
            return;
          }

          // 如果点击的不是当前会话，则切换到目标会话
          if (session.key !== state.sessionKey) {
            void switchSession(
              state as unknown as Parameters<typeof switchSession>[0],
              session.key,
            );
          }

          // 如果当前不在聊天标签页，则自动切换到聊天标签页
          if (state.tab !== "chat") {
            state.setTab("chat");
          }
        }}
      >
        <!-- 会话图标：激活状态显示实心圆圈，否则显示空心方框 -->
        <div class="nav-sessions__item-icon">
          ${isActive ? icons.messageCircle : icons.messageSquare}
        </div>

        <!-- 会话信息区域 -->
        <div class="nav-sessions__item-info">
          <!-- 会话名称 -->
          <div class="nav-sessions__item-name">${displayName}</div>

          <!-- 最后更新时间（如果存在的话） -->
          ${updatedAgo ? html`<div class="nav-sessions__item-time">${updatedAgo}</div>` : nothing}
        </div>
      </div>

      <!-- 操作按钮区域 -->
      <div class="nav-sessions__item-actions">
        <!-- 生成标题按钮 -->
        <button
          class="nav-sessions__item-generate-title"
          ?disabled=${isGeneratingTitle}
          @click=${(e: Event) => {
            // 阻止事件冒泡，避免触发会话切换点击事件
            e.stopPropagation();

            // 未连接状态下不允许生成标题
            if (!state.connected) {
              return;
            }

            // 如果正在生成中，不重复调用
            if (isGeneratingTitle) {
              return;
            }

            // 调用生成标题函数
            void generateSessionTitle(
              state as unknown as Parameters<typeof generateSessionTitle>[0],
              session.key,
            );
          }}
          .title=${isGeneratingTitle ? "正在生成标题..." : "生成标题"}
          aria-label=${isGeneratingTitle ? "正在生成标题" : "生成标题"}
        >
          ${isGeneratingTitle ? icons.loader : icons.penLine}
        </button>

        ${
          // 当会话总数大于 1 时才显示删除按钮，避免删除最后一个会话
          totalSessions <= 1
            ? nothing
            : html`
              <!-- 删除按钮 -->
              <button
                class="nav-sessions__item-delete"
                @click=${(e: Event) => {
                  // 阻止事件冒泡，避免触发会话切换点击事件
                  e.stopPropagation();

                  // 未连接状态下不允许删除会话
                  if (!state.connected) {
                    return;
                  }

                  // 打开删除确认对话框
                  const app = state as unknown as {
                    deleteSessionDialog: DeleteSessionDialogState | null;
                  };
                  app.deleteSessionDialog = {
                    sessionKey: session.key, // 要删除的会话键
                    sessionName: displayName, // 要删除的会话名称（用于显示）
                    isDeleting: false, // 删除操作状态
                    error: null, // 错误信息
                  };
                }}
                title="${t("chat.sidebar.deleteSession")}"
                aria-label="${t("chat.sidebar.deleteSession")}"
              >
                <!-- 删除图标（垃圾桶图标） -->
                ${icons.trash}
              </button>
            `
        }
      </div>
    </li>
  `;
}

// Note: New session button removed from nav sidebar as it's redundant
// The chat page already has a "New session" button in the compose area

// ─── Group Chats Section in Sidebar ───

export function renderNavGroupChats(state: AppViewState) {
  const groups =
    (
      state as unknown as {
        groupIndex: Array<{
          groupId: string;
          name: string;
          memberCount: number;
          archived: boolean;
        }>;
      }
    ).groupIndex ?? [];
  const activeGroups = groups.filter((g) => !g.archived);
  const activeGroupId = (state as unknown as { activeGroupId: string | null }).activeGroupId;
  const groupLabel = t("chat.group.title");
  const isCollapsed = state.settings.navGroupsCollapsed[groupLabel] ?? false;
  const hasActiveGroup = activeGroupId !== null;

  return html`
    <div class="nav-group nav-group--groupchats ${isCollapsed && !hasActiveGroup ? "nav-group--collapsed" : ""}">
      <div class="nav-label nav-label--groupchats">
        <button
          class="nav-label__btn"
          @click=${() => {
            const next = { ...state.settings.navGroupsCollapsed };
            next[groupLabel] = !isCollapsed;
            state.applySettings({
              ...state.settings,
              navGroupsCollapsed: next,
            });
          }}
          aria-expanded=${!isCollapsed}
        >
          <span class="nav-label__text">${groupLabel}</span>
          <span class="nav-label__chevron">${isCollapsed ? "+" : "−"}</span>
        </button>
        <div class="nav-label__actions">
          <button
            class="nav-label__action"
            @click=${() => {
              const host = state as unknown as {
                activeGroupId: string | null;
                groupCreateDialog: {
                  name: string;
                  selectedAgents: Array<{ agentId: string; role: string }>;
                  messageMode: string;
                  isBusy: boolean;
                  error: string | null;
                } | null;
              };
              if (host.activeGroupId === null) {
                host.activeGroupId = "__list__";
              }
              void loadGroupList(state as unknown as Parameters<typeof loadGroupList>[0]);
              if (state.tab !== "chat") {
                state.setTab("chat");
              }
            }}
            title=${t("chat.group.create")}
          >
            ${icons.plus}
          </button>
        </div>
      </div>
      <div class="nav-group__items">
        ${
          activeGroups.length > 0
            ? html`
              <ul class="nav-group-chats__list">
                ${activeGroups.slice(0, 10).map(
                  (g) => html`
                    <li
                      class="nav-group-chats__item ${activeGroupId === g.groupId ? "nav-group-chats__item--active" : ""}"
                      title=${g.name || g.groupId}
                      @click=${() => {
                        void enterGroupChat(
                          state as unknown as Parameters<typeof enterGroupChat>[0],
                          g.groupId,
                        );
                        if (state.tab !== "chat") {
                          state.setTab("chat");
                        }
                      }}
                    >
                      <span class="nav-group-chats__item-emoji">👥</span>
                      <span class="nav-group-chats__item-name">${g.name || g.groupId.slice(0, 8)}</span>
                    </li>
                  `,
                )}
              </ul>
            `
            : html`<div class="nav-group-chats__empty">${t("chat.group.noGroups")}</div>`
        }
      </div>
    </div>
  `;
}
