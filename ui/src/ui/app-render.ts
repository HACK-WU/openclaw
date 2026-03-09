import { html, nothing } from "lit";
import { parseAgentSessionKey } from "../../../src/routing/session-key.js";
import { refreshChatAvatar, switchSession } from "./app-chat.ts";
import { renderUsageTab } from "./app-render-usage-tab.ts";
import {
  renderChatControls,
  renderLocaleToggle,
  renderTab,
  renderThemeToggle,
  renderNavSessionsList,
  renderNavGroupChats,
} from "./app-render.helpers.ts";
import { syncUrlWithSessionKey } from "./app-settings.ts";
import type { AppViewState } from "./app-view-state.ts";
import { loadAgentFileContent, loadAgentFiles, saveAgentFile } from "./controllers/agent-files.ts";
import { loadAgentIdentities, loadAgentIdentity } from "./controllers/agent-identity.ts";
import { loadAgentSkills } from "./controllers/agent-skills.ts";
import {
  loadAgents,
  loadToolsCatalog,
  createAgent,
  deleteAgent,
  setDefaultAgent,
} from "./controllers/agents.ts";
import { loadChannels } from "./controllers/channels.ts";
import { loadChatHistory } from "./controllers/chat.ts";
import {
  applyConfig,
  loadConfig,
  runUpdate,
  saveConfig,
  updateConfigFormValue,
  removeConfigFormValue,
} from "./controllers/config.ts";
import {
  loadCronRuns,
  loadMoreCronJobs,
  loadMoreCronRuns,
  reloadCronJobs,
  toggleCronJob,
  runCronJob,
  removeCronJob,
  addCronJob,
  startCronEdit,
  startCronClone,
  cancelCronEdit,
  validateCronForm,
  hasCronFormErrors,
  normalizeCronFormState,
  updateCronJobsFilter,
  updateCronRunsFilter,
} from "./controllers/cron.ts";
import { loadDebug, callDebugMethod } from "./controllers/debug.ts";
import {
  approveDevicePairing,
  loadDevices,
  rejectDevicePairing,
  revokeDeviceToken,
  rotateDeviceToken,
} from "./controllers/devices.ts";
import {
  loadExecApprovals,
  removeExecApprovalsFormValue,
  saveExecApprovals,
  updateExecApprovalsFormValue,
} from "./controllers/exec-approvals.ts";
import {
  loadGroupList,
  enterGroupChat,
  leaveGroupChat,
  sendGroupMessage,
  abortGroupChat,
  createGroup,
  deleteGroup,
  updateGroupMembers,
  openDisbandGroupDialog,
  closeDisbandGroupDialog,
  confirmDisbandGroup,
} from "./controllers/group-chat.ts";
import { loadLogs } from "./controllers/logs.ts";
import { loadNodes } from "./controllers/nodes.ts";
import { loadPresence } from "./controllers/presence.ts";
import { deleteSessionAndRefresh, loadSessions, patchSession } from "./controllers/sessions.ts";
import {
  closeSkillFileEditor,
  installSkill,
  loadSkillFile,
  loadSkills,
  saveSkillApiKey,
  saveSkillFile,
  updateSkillEdit,
  updateSkillEnabled,
  updateSkillFileContent,
} from "./controllers/skills.ts";
import { buildExternalLinkRel, EXTERNAL_LINK_TARGET } from "./external-link.ts";
import { t } from "./i18n/index.ts";
import { icons } from "./icons.ts";
import { normalizeBasePath, getTabGroups, subtitleForTab, titleForTab } from "./navigation.ts";
import { renderAgents } from "./views/agents.ts";
import { renderChannels } from "./views/channels.ts";
import { renderChat } from "./views/chat.ts";
import { renderConfig } from "./views/config.ts";
import { renderCron } from "./views/cron.ts";
import { renderDebug } from "./views/debug.ts";
import { renderDeleteSessionDialog } from "./views/delete-session-dialog.ts";
import { renderExecApprovalPrompt } from "./views/exec-approval.ts";
import { renderGatewayUrlConfirmation } from "./views/gateway-url-confirmation.ts";
import { renderGroupChat } from "./views/group-chat.ts";
import { renderInstances } from "./views/instances.ts";
import { renderLogs } from "./views/logs.ts";
import { renderNodes } from "./views/nodes.ts";
import { renderOverview } from "./views/overview.ts";
import { renderSessions } from "./views/sessions.ts";
import { renderSkills } from "./views/skills.ts";

const AVATAR_DATA_RE = /^data:/i;
const AVATAR_HTTP_RE = /^https?:\/\//i;
const CRON_THINKING_SUGGESTIONS = ["off", "minimal", "low", "medium", "high"];
const CRON_TIMEZONE_SUGGESTIONS = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
];

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function normalizeSuggestionValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniquePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function resolveAssistantAvatarUrl(state: AppViewState): string | undefined {
  const list = state.agentsList?.agents ?? [];
  const parsed = parseAgentSessionKey(state.sessionKey);
  const agentId = parsed?.agentId ?? state.agentsList?.defaultId ?? "main";

  // First try to get identity from agentIdentityById (loaded from workspace)
  const agentIdentity = state.agentIdentityById[agentId];
  if (agentIdentity?.avatar) {
    const avatar = agentIdentity.avatar.trim();
    if (AVATAR_DATA_RE.test(avatar) || AVATAR_HTTP_RE.test(avatar)) {
      return avatar;
    }
  }

  // Fall back to agentsList identity (from config)
  const agent = list.find((entry) => entry.id === agentId);
  const identity = agent?.identity;
  const candidate = identity?.avatarUrl ?? identity?.avatar;
  if (!candidate) {
    return undefined;
  }
  if (AVATAR_DATA_RE.test(candidate) || AVATAR_HTTP_RE.test(candidate)) {
    return candidate;
  }
  return identity?.avatarUrl;
}

export function renderApp(state: AppViewState) {
  const openClawVersion =
    (typeof state.hello?.server?.version === "string" && state.hello.server.version.trim()) ||
    state.updateAvailable?.currentVersion ||
    t("common.na");
  const availableUpdate =
    state.updateAvailable &&
    state.updateAvailable.latestVersion !== state.updateAvailable.currentVersion
      ? state.updateAvailable
      : null;
  const versionStatusClass = availableUpdate ? "warn" : "ok";
  const presenceCount = state.presenceEntries.length;
  const sessionsCount = state.sessionsResult?.count ?? null;
  const cronNext = state.cronStatus?.nextWakeAtMs ?? null;
  const chatDisabledReason = state.connected ? null : t("chat.disconnected");
  const isChat = state.tab === "chat";
  const chatFocus = isChat && (state.settings.chatFocusMode || state.onboarding);
  const showThinking = state.onboarding ? false : state.settings.chatShowThinking;
  const assistantAvatarUrl = resolveAssistantAvatarUrl(state);
  const chatAvatarUrl = state.chatAvatarUrl ?? assistantAvatarUrl ?? null;
  const configValue =
    state.configForm ?? (state.configSnapshot?.config as Record<string, unknown> | null);
  const basePath = normalizeBasePath(state.basePath ?? "");
  const resolvedAgentId =
    state.agentsSelectedId ??
    state.agentsList?.defaultId ??
    state.agentsList?.agents?.[0]?.id ??
    null;
  const cronAgentSuggestions = Array.from(
    new Set(
      [
        ...(state.agentsList?.agents?.map((entry) => entry.id.trim()) ?? []),
        ...state.cronJobs
          .map((job) => (typeof job.agentId === "string" ? job.agentId.trim() : ""))
          .filter(Boolean),
      ].filter(Boolean),
    ),
  ).toSorted((a, b) => a.localeCompare(b));
  const cronModelSuggestions = Array.from(
    new Set(
      [
        ...state.cronModelSuggestions,
        ...state.cronJobs
          .map((job) => {
            if (job.payload.kind !== "agentTurn" || typeof job.payload.model !== "string") {
              return "";
            }
            return job.payload.model.trim();
          })
          .filter(Boolean),
      ].filter(Boolean),
    ),
  ).toSorted((a, b) => a.localeCompare(b));
  const selectedDeliveryChannel =
    state.cronForm.deliveryChannel && state.cronForm.deliveryChannel.trim()
      ? state.cronForm.deliveryChannel.trim()
      : "last";
  const jobToSuggestions = state.cronJobs
    .map((job) => normalizeSuggestionValue(job.delivery?.to))
    .filter(Boolean);
  const accountToSuggestions = (
    selectedDeliveryChannel === "last"
      ? Object.values(state.channelsSnapshot?.channelAccounts ?? {}).flat()
      : (state.channelsSnapshot?.channelAccounts?.[selectedDeliveryChannel] ?? [])
  )
    .flatMap((account) => [
      normalizeSuggestionValue(account.accountId),
      normalizeSuggestionValue(account.name),
    ])
    .filter(Boolean);
  const rawDeliveryToSuggestions = uniquePreserveOrder([
    ...jobToSuggestions,
    ...accountToSuggestions,
  ]);
  const deliveryToSuggestions =
    state.cronForm.deliveryMode === "webhook"
      ? rawDeliveryToSuggestions.filter((value) => isHttpUrl(value))
      : rawDeliveryToSuggestions;

  // ========================================
  // 主应用布局容器
  // ========================================
  return html`
    <div class="shell ${isChat ? "shell--chat" : ""} ${chatFocus ? "shell--chat-focus" : ""} ${state.settings.navCollapsed ? "shell--nav-collapsed" : ""} ${state.onboarding ? "shell--onboarding" : ""}">
      <!-- 顶部导航栏：包含折叠按钮、Logo 和状态指示器 -->
      <header class="topbar">
        <div class="topbar-left">
          <!-- 侧边栏折叠/展开按钮 -->
          <button
            class="nav-collapse-toggle"
            @click=${() =>
              state.applySettings({
                ...state.settings,
                navCollapsed: !state.settings.navCollapsed,
              })}
            title="${state.settings.navCollapsed ? t("nav.expand") : t("nav.collapse")}"
            aria-label="${state.settings.navCollapsed ? t("nav.expand") : t("nav.collapse")}"
          >
            <span class="nav-collapse-toggle__icon">${icons.menu}</span>
          </button>
          <!-- 品牌标识区域：Logo 和应用名称 -->
          <div class="brand">
            <div class="brand-logo">
              <img src=${basePath ? `${basePath}/favicon.svg` : "/favicon.svg"} alt="OpenClaw" />
            </div>
            <div class="brand-text">
              <div class="brand-title">${t("app.title").toUpperCase()}</div>
              <div class="brand-sub">${t("app.subtitle")}</div>
            </div>
          </div>
        </div>
        <!-- 右侧状态区域：连接状态、语言切换、主题切换 -->
        <div class="topbar-status">
          <!-- 连接状态指示器 -->
          <div class="pill">
            <span class="statusDot ${versionStatusClass}"></span>
            <span>${t("common.version")}</span>
            <span class="mono">${openClawVersion}</span>
          </div>
          <div class="pill">
            <span class="statusDot ${state.connected ? "ok" : ""}"></span>
            <span>${t("common.health")}</span>
            <span class="mono">${state.connected ? t("common.ok") : t("common.offline")}</span>
          </div>
          <!-- 语言切换按钮 -->
          ${renderLocaleToggle(state)}
          <!-- 主题切换按钮 -->
          ${renderThemeToggle(state)}
        </div>
      </header>
      <!-- 侧边栏导航：包含标签分组和外部链接 -->
      <aside class="nav ${state.settings.navCollapsed ? "nav--collapsed" : ""}">
        ${getTabGroups().map((group) => {
          // 检查当前分组是否折叠
          const isGroupCollapsed = state.settings.navGroupsCollapsed[group.label] ?? false;
          // 检查该分组中是否有激活的标签页
          const hasActiveTab = group.tabs.some((tab) => tab === state.tab);
          // 特殊处理：判断是否是聊天分组（只包含 chat 标签）
          const isChatGroup = group.tabs.includes("chat") && group.tabs.length === 1;

          // 特殊处理：聊天分组显示会话列表
          if (isChatGroup) {
            return html`
              <div class="nav-group nav-group--chat ${isGroupCollapsed ? "nav-group--collapsed" : ""}">
                <div class="nav-label nav-label--chat">
                  <!-- 分组标题按钮，点击可折叠/展开 -->
                  <button
                    class="nav-label__btn"
                    @click=${() => {
                      const next = { ...state.settings.navGroupsCollapsed };
                      next[group.label] = !isGroupCollapsed;
                      state.applySettings({
                        ...state.settings,
                        navGroupsCollapsed: next,
                      });
                    }}
                    aria-expanded=${!isGroupCollapsed}
                  >
                    <span class="nav-label__text">${group.label}</span>
                    <!-- 折叠/展开图标 -->
                    <span class="nav-label__chevron">${isGroupCollapsed ? "+" : "−"}</span>
                  </button>
                </div>
                <!-- 渲染会话列表（仅在聊天分组中显示） -->
                <div class="nav-group__items">
                  ${renderNavSessionsList(state)}
                </div>
              </div>
              <!-- 群聊分组（独立分组，位于对话下方） -->
              ${renderNavGroupChats(state)}
            `;
          }

          // 普通分组渲染
          return html`
            <div class="nav-group ${isGroupCollapsed && !hasActiveTab ? "nav-group--collapsed" : ""}">
              <!-- 分组标题按钮 -->
              <button
                class="nav-label"
                @click=${() => {
                  const next = { ...state.settings.navGroupsCollapsed };
                  next[group.label] = !isGroupCollapsed;
                  state.applySettings({
                    ...state.settings,
                    navGroupsCollapsed: next,
                  });
                }}
                aria-expanded=${!isGroupCollapsed}
              >
                <span class="nav-label__text">${group.label}</span>
                <span class="nav-label__chevron">${isGroupCollapsed ? "+" : "−"}</span>
              </button>
              <!-- 分组内的标签页列表 -->
              <div class="nav-group__items">
                ${group.tabs.map((tab) => renderTab(state, tab))}
              </div>
            </div>
          `;
        })}
        <!-- 外部资源链接分组 -->
        <div class="nav-group nav-group--links">
          <div class="nav-label nav-label--static">
            <span class="nav-label__text">${t("nav.group.resources")}</span>
          </div>
          <div class="nav-group__items">
            <!-- 文档链接（在新标签页打开） -->
            <a
              class="nav-item nav-item--external"
              href="https://docs.openclaw.ai"
              target=${EXTERNAL_LINK_TARGET}
              rel=${buildExternalLinkRel()}
              title="${t("nav.docs")} (opens in new tab)"
            >
              <span class="nav-item__icon" aria-hidden="true">${icons.book}</span>
              <span class="nav-item__text">${t("nav.docs")}</span>
            </a>
          </div>
        </div>
      </aside>
      <!-- 主内容区域：根据当前标签页渲染不同内容 -->
      <main class="content ${isChat ? "content--chat" : ""}">
        ${
          availableUpdate
            ? html`<div class="update-banner callout danger" role="alert">
              <strong>Update available:</strong> v${availableUpdate.latestVersion}
              (running v${availableUpdate.currentVersion}).
              <button
                class="btn btn--sm update-banner__btn"
                ?disabled=${state.updateRunning || !state.connected}
                @click=${() => runUpdate(state)}
              >${state.updateRunning ? "Updating…" : "Update now"}</button>
            </div>`
            : nothing
        }
        <!-- 内容区域标题栏 -->
        <section class="content-header">
          <div>
            <!-- 页面标题（chat 和 usage 标签页不显示标题） -->
            ${state.tab === "usage" || state.tab === "chat" ? nothing : html`<div class="page-title">${titleForTab(state.tab)}</div>`}
            <!-- 页面副标题（chat 和 usage 标签页不显示） -->
            ${state.tab === "usage" || state.tab === "chat" ? nothing : html`<div class="page-sub">${subtitleForTab(state.tab)}</div>`}
          </div>
          <!-- 页面元数据：错误信息和聊天控制按钮 -->
          <div class="page-meta">
            <!-- 显示错误提示（如果有） -->
            ${state.lastError ? html`<div class="pill danger">${state.lastError}</div>` : nothing}
            <!-- 仅在聊天标签页显示聊天控制按钮 -->
            ${isChat && state.activeGroupId === null ? renderChatControls(state) : nothing}
          </div>
        </section>

        <!-- ========================================
           OVERVIEW 标签页：概览面板
           ======================================== -->
        ${
          state.tab === "overview"
            ? renderOverview({
                // 连接状态
                connected: state.connected,
                // Gateway Hello 响应数据
                hello: state.hello,
                // 用户设置
                settings: state.settings,
                // 密码
                password: state.password,
                // 最后的错误消息
                lastError: state.lastError,
                lastErrorCode: state.lastErrorCode,
                presenceCount,
                // 会话数量
                sessionsCount,
                // Cron 任务是否启用
                cronEnabled: state.cronStatus?.enabled ?? null,
                // 下一次 Cron 执行时间
                cronNext,
                // 上次渠道刷新时间
                lastChannelsRefresh: state.channelsLastSuccess,
                // 设置变更回调
                onSettingsChange: (next) => state.applySettings(next),
                // 密码变更回调
                onPasswordChange: (next) => (state.password = next),
                // 会话键变更回调：切换会话时清理状态
                onSessionKeyChange: (next) => {
                  state.sessionKey = next;
                  state.chatMessage = "";
                  state.chatAttachments = [];
                  state.chatStream = null;
                  state.chatStreamSegments = null;
                  state.chatStreamStartedAt = null;
                  state.chatRunId = null;
                  state.chatQueue = [];
                  state.resetToolStream();
                  state.resetChatScroll();
                  state.applySettings({
                    ...state.settings,
                    lastActiveSessionKey: next,
                  });
                  void state.loadAssistantIdentity();
                  void loadChatHistory(state);
                  void refreshChatAvatar(state);
                },
                // 连接 Gateway 回调
                onConnect: () => state.connect(),
                // 刷新概览数据回调
                onRefresh: () => state.loadOverview(),
              })
            : nothing
        }

        <!-- ========================================
           CHANNELS 标签页：渠道配置面板
           ======================================== -->
        ${
          state.tab === "channels"
            ? renderChannels({
                connected: state.connected,
                loading: state.channelsLoading,
                snapshot: state.channelsSnapshot,
                lastError: state.channelsError,
                lastSuccessAt: state.channelsLastSuccess,
                whatsappMessage: state.whatsappLoginMessage,
                whatsappQrDataUrl: state.whatsappLoginQrDataUrl,
                whatsappConnected: state.whatsappLoginConnected,
                whatsappBusy: state.whatsappBusy,
                configSchema: state.configSchema,
                configSchemaLoading: state.configSchemaLoading,
                configForm: state.configForm,
                configUiHints: state.configUiHints,
                configSaving: state.configSaving,
                configFormDirty: state.configFormDirty,
                nostrProfileFormState: state.nostrProfileFormState,
                nostrProfileAccountId: state.nostrProfileAccountId,
                // 刷新渠道状态（可选择是否进行探测）
                onRefresh: (probe) => loadChannels(state, probe),
                // 开始 WhatsApp 登录
                onWhatsAppStart: (force) => state.handleWhatsAppStart(force),
                // 等待 WhatsApp 登录完成
                onWhatsAppWait: () => state.handleWhatsAppWait(),
                // 退出 WhatsApp 登录
                onWhatsAppLogout: () => state.handleWhatsAppLogout(),
                // 更新配置表单值
                onConfigPatch: (path, value) => updateConfigFormValue(state, path, value),
                // 保存渠道配置
                onConfigSave: () => state.handleChannelConfigSave(),
                // 重新加载渠道配置
                onConfigReload: () => state.handleChannelConfigReload(),
                // 编辑 Nostr Profile
                onNostrProfileEdit: (accountId, profile) =>
                  state.handleNostrProfileEdit(accountId, profile),
                // 取消 Nostr Profile 编辑
                onNostrProfileCancel: () => state.handleNostrProfileCancel(),
                // Nostr Profile 字段变更
                onNostrProfileFieldChange: (field, value) =>
                  state.handleNostrProfileFieldChange(field, value),
                // 保存 Nostr Profile
                onNostrProfileSave: () => state.handleNostrProfileSave(),
                // 导入 Nostr Profile
                onNostrProfileImport: () => state.handleNostrProfileImport(),
                // 切换高级模式
                onNostrProfileToggleAdvanced: () => state.handleNostrProfileToggleAdvanced(),
              })
            : nothing
        }

        <!-- ========================================
           INSTANCES 标签页：实例列表面板
           ======================================== -->
        ${
          state.tab === "instances"
            ? renderInstances({
                loading: state.presenceLoading,
                entries: state.presenceEntries,
                lastError: state.presenceError,
                statusMessage: state.presenceStatus,
                // 刷新实例列表
                onRefresh: () => loadPresence(state),
              })
            : nothing
        }

        <!-- ========================================
           SESSIONS 标签页：会话管理面板
           ======================================== -->
        ${
          state.tab === "sessions"
            ? renderSessions({
                loading: state.sessionsLoading,
                result: state.sessionsResult,
                error: state.sessionsError,
                activeMinutes: state.sessionsFilterActive,
                limit: state.sessionsFilterLimit,
                includeGlobal: state.sessionsIncludeGlobal,
                includeUnknown: state.sessionsIncludeUnknown,
                basePath: state.basePath,
                // 过滤器变更
                onFiltersChange: (next) => {
                  state.sessionsFilterActive = next.activeMinutes;
                  state.sessionsFilterLimit = next.limit;
                  state.sessionsIncludeGlobal = next.includeGlobal;
                  state.sessionsIncludeUnknown = next.includeUnknown;
                },
                // 刷新会话列表
                onRefresh: () => loadSessions(state),
                // 修改会话属性（label, thinkingLevel 等）
                onPatch: (key, patch) => patchSession(state, key, patch),
                onDelete: (key) => deleteSessionAndRefresh(state, key),
              })
            : nothing
        }

        ${renderUsageTab(state)}

        <!-- ========================================
           CRON 标签页：定时任务面板
           ======================================== -->
        ${
          state.tab === "cron"
            ? renderCron({
                basePath: state.basePath,
                loading: state.cronLoading,
                jobsLoadingMore: state.cronJobsLoadingMore,
                status: state.cronStatus,
                jobs: state.cronJobs,
                jobsTotal: state.cronJobsTotal,
                jobsHasMore: state.cronJobsHasMore,
                jobsQuery: state.cronJobsQuery,
                jobsEnabledFilter: state.cronJobsEnabledFilter,
                jobsSortBy: state.cronJobsSortBy,
                jobsSortDir: state.cronJobsSortDir,
                error: state.cronError,
                busy: state.cronBusy,
                form: state.cronForm,
                fieldErrors: state.cronFieldErrors,
                canSubmit: !hasCronFormErrors(state.cronFieldErrors),
                editingJobId: state.cronEditingJobId,
                channels: state.channelsSnapshot?.channelMeta?.length
                  ? state.channelsSnapshot.channelMeta.map((entry) => entry.id)
                  : (state.channelsSnapshot?.channelOrder ?? []),
                channelLabels: state.channelsSnapshot?.channelLabels ?? {},
                channelMeta: state.channelsSnapshot?.channelMeta ?? [],
                runsJobId: state.cronRunsJobId,
                runs: state.cronRuns,
                runsTotal: state.cronRunsTotal,
                runsHasMore: state.cronRunsHasMore,
                runsLoadingMore: state.cronRunsLoadingMore,
                runsScope: state.cronRunsScope,
                runsStatuses: state.cronRunsStatuses,
                runsDeliveryStatuses: state.cronRunsDeliveryStatuses,
                runsStatusFilter: state.cronRunsStatusFilter,
                runsQuery: state.cronRunsQuery,
                runsSortDir: state.cronRunsSortDir,
                agentSuggestions: cronAgentSuggestions,
                modelSuggestions: cronModelSuggestions,
                thinkingSuggestions: CRON_THINKING_SUGGESTIONS,
                timezoneSuggestions: CRON_TIMEZONE_SUGGESTIONS,
                deliveryToSuggestions,
                onFormChange: (patch) => {
                  state.cronForm = normalizeCronFormState({ ...state.cronForm, ...patch });
                  state.cronFieldErrors = validateCronForm(state.cronForm);
                },
                onRefresh: () => state.loadCron(),
                onAdd: () => addCronJob(state),
                onEdit: (job) => startCronEdit(state, job),
                onClone: (job) => startCronClone(state, job),
                onCancelEdit: () => cancelCronEdit(state),
                onToggle: (job, enabled) => toggleCronJob(state, job, enabled),
                onRun: (job) => runCronJob(state, job),
                onRemove: (job) => removeCronJob(state, job),
                onLoadRuns: async (jobId) => {
                  updateCronRunsFilter(state, { cronRunsScope: "job" });
                  await loadCronRuns(state, jobId);
                },
                onLoadMoreJobs: () => loadMoreCronJobs(state),
                onJobsFiltersChange: async (patch) => {
                  updateCronJobsFilter(state, patch);
                  await reloadCronJobs(state);
                },
                onLoadMoreRuns: () => loadMoreCronRuns(state),
                onRunsFiltersChange: async (patch) => {
                  updateCronRunsFilter(state, patch);
                  if (state.cronRunsScope === "all") {
                    await loadCronRuns(state, null);
                    return;
                  }
                  await loadCronRuns(state, state.cronRunsJobId);
                },
              })
            : nothing
        }

        <!-- ========================================
           AGENTS 标签页：智能体管理面板
           ======================================== -->
        ${
          state.tab === "agents"
            ? renderAgents({
                loading: state.agentsLoading,
                error: state.agentsError,
                agentsList: state.agentsList,
                selectedAgentId: resolvedAgentId,
                activePanel: state.agentsPanel,
                configForm: configValue,
                configLoading: state.configLoading,
                configSaving: state.configSaving,
                configDirty: state.configFormDirty,
                channelsLoading: state.channelsLoading,
                channelsError: state.channelsError,
                channelsSnapshot: state.channelsSnapshot,
                channelsLastSuccess: state.channelsLastSuccess,
                cronLoading: state.cronLoading,
                cronStatus: state.cronStatus,
                cronJobs: state.cronJobs,
                cronError: state.cronError,
                agentFilesLoading: state.agentFilesLoading,
                agentFilesError: state.agentFilesError,
                agentFilesList: state.agentFilesList,
                agentFileActive: state.agentFileActive,
                agentFileContents: state.agentFileContents,
                agentFileDrafts: state.agentFileDrafts,
                agentFileSaving: state.agentFileSaving,
                agentIdentityLoading: state.agentIdentityLoading,
                agentIdentityError: state.agentIdentityError,
                agentIdentityById: state.agentIdentityById,
                agentSkillsLoading: state.agentSkillsLoading,
                agentSkillsReport: state.agentSkillsReport,
                agentSkillsError: state.agentSkillsError,
                agentSkillsAgentId: state.agentSkillsAgentId,
                toolsCatalogLoading: state.toolsCatalogLoading,
                toolsCatalogError: state.toolsCatalogError,
                toolsCatalogResult: state.toolsCatalogResult,
                skillsFilter: state.skillsFilter,
                // Save feedback
                configSaveSuccess: state.agentConfigSaveSuccess,
                // Create/Delete state
                showCreateDialog: state.agentShowCreateDialog,
                createForm: state.agentCreateForm,
                createBusy: state.agentCreateBusy,
                createError: state.agentCreateError,
                deleteBusy: state.agentDeleteBusy,
                deleteError: state.agentDeleteError,
                showDeleteConfirm: state.agentShowDeleteConfirm,
                onRefresh: async () => {
                  await loadAgents(state);
                  const nextSelected =
                    state.agentsSelectedId ??
                    state.agentsList?.defaultId ??
                    state.agentsList?.agents?.[0]?.id ??
                    null;
                  await loadToolsCatalog(state, nextSelected);
                  const agentIds = state.agentsList?.agents?.map((entry) => entry.id) ?? [];
                  if (agentIds.length > 0) {
                    void loadAgentIdentities(state, agentIds);
                  }
                },
                onSelectAgent: (agentId) => {
                  if (state.agentsSelectedId === agentId) {
                    return;
                  }
                  state.agentsSelectedId = agentId;
                  state.agentFilesList = null;
                  state.agentFilesError = null;
                  state.agentFilesLoading = false;
                  state.agentFileActive = null;
                  state.agentFileContents = {};
                  state.agentFileDrafts = {};
                  state.agentSkillsReport = null;
                  state.agentSkillsError = null;
                  state.agentSkillsAgentId = null;
                  void loadAgentIdentity(state, agentId);
                  if (state.agentsPanel === "tools") {
                    void loadToolsCatalog(state, agentId);
                  }
                  if (state.agentsPanel === "files") {
                    void loadAgentFiles(state, agentId);
                  }
                  if (state.agentsPanel === "skills") {
                    void loadAgentSkills(state, agentId);
                  }
                },
                onSelectPanel: (panel) => {
                  state.agentsPanel = panel;
                  if (panel === "files" && resolvedAgentId) {
                    if (state.agentFilesList?.agentId !== resolvedAgentId) {
                      state.agentFilesList = null;
                      state.agentFilesError = null;
                      state.agentFileActive = null;
                      state.agentFileContents = {};
                      state.agentFileDrafts = {};
                      void loadAgentFiles(state, resolvedAgentId);
                    }
                  }
                  if (panel === "tools") {
                    void loadToolsCatalog(state, resolvedAgentId);
                  }
                  if (panel === "skills") {
                    if (resolvedAgentId) {
                      void loadAgentSkills(state, resolvedAgentId);
                    }
                  }
                  if (panel === "channels") {
                    void loadChannels(state, false);
                  }
                  if (panel === "cron") {
                    void state.loadCron();
                  }
                },
                onLoadFiles: (agentId) => loadAgentFiles(state, agentId),
                onSelectFile: (name) => {
                  state.agentFileActive = name;
                  if (!resolvedAgentId) {
                    return;
                  }
                  void loadAgentFileContent(state, resolvedAgentId, name);
                },
                onFileDraftChange: (name, content) => {
                  state.agentFileDrafts = { ...state.agentFileDrafts, [name]: content };
                },
                onFileReset: (name) => {
                  const base = state.agentFileContents[name] ?? "";
                  state.agentFileDrafts = { ...state.agentFileDrafts, [name]: base };
                },
                onFileSave: (name) => {
                  if (!resolvedAgentId) {
                    return;
                  }
                  const content =
                    state.agentFileDrafts[name] ?? state.agentFileContents[name] ?? "";
                  void saveAgentFile(state, resolvedAgentId, name, content);
                },
                onToolsProfileChange: (agentId, profile, clearAllow) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  const basePath = ["agents", "list", index, "tools"];
                  if (profile) {
                    updateConfigFormValue(state, [...basePath, "profile"], profile);
                  } else {
                    removeConfigFormValue(state, [...basePath, "profile"]);
                  }
                  if (clearAllow) {
                    removeConfigFormValue(state, [...basePath, "allow"]);
                  }
                },
                onToolsOverridesChange: (agentId, alsoAllow, deny) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  const basePath = ["agents", "list", index, "tools"];
                  if (alsoAllow.length > 0) {
                    updateConfigFormValue(state, [...basePath, "alsoAllow"], alsoAllow);
                  } else {
                    removeConfigFormValue(state, [...basePath, "alsoAllow"]);
                  }
                  if (deny.length > 0) {
                    updateConfigFormValue(state, [...basePath, "deny"], deny);
                  } else {
                    removeConfigFormValue(state, [...basePath, "deny"]);
                  }
                },
                onConfigReload: () => loadConfig(state),
                onConfigSave: async () => {
                  await saveConfig(state);
                  if (!state.lastError) {
                    state.agentConfigSaveSuccess = true;
                    window.setTimeout(() => {
                      state.agentConfigSaveSuccess = false;
                    }, 2500);
                  }
                },
                onChannelsRefresh: () => loadChannels(state, false),
                onCronRefresh: () => state.loadCron(),
                onSkillsFilterChange: (next) => (state.skillsFilter = next),
                onSkillsRefresh: () => {
                  if (resolvedAgentId) {
                    void loadAgentSkills(state, resolvedAgentId);
                  }
                },
                onAgentSkillToggle: (agentId, skillName, enabled) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  const entry = list[index] as { skills?: unknown };
                  const normalizedSkill = skillName.trim();
                  if (!normalizedSkill) {
                    return;
                  }
                  const allSkills =
                    state.agentSkillsReport?.skills?.map((skill) => skill.name).filter(Boolean) ??
                    [];
                  const existing = Array.isArray(entry.skills)
                    ? entry.skills.map((name) => String(name).trim()).filter(Boolean)
                    : undefined;
                  const base = existing ?? allSkills;
                  const next = new Set(base);
                  if (enabled) {
                    next.add(normalizedSkill);
                  } else {
                    next.delete(normalizedSkill);
                  }
                  updateConfigFormValue(state, ["agents", "list", index, "skills"], [...next]);
                },
                onAgentSkillsClear: (agentId) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  removeConfigFormValue(state, ["agents", "list", index, "skills"]);
                },
                onAgentSkillsDisableAll: (agentId) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  updateConfigFormValue(state, ["agents", "list", index, "skills"], []);
                },
                onModelChange: (agentId, modelId) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  const basePath = ["agents", "list", index, "model"];
                  if (!modelId) {
                    removeConfigFormValue(state, basePath);
                    return;
                  }
                  const entry = list[index] as { model?: unknown };
                  const existing = entry?.model;
                  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                    const fallbacks = (existing as { fallbacks?: unknown }).fallbacks;
                    const next = {
                      primary: modelId,
                      ...(Array.isArray(fallbacks) ? { fallbacks } : {}),
                    };
                    updateConfigFormValue(state, basePath, next);
                  } else {
                    updateConfigFormValue(state, basePath, modelId);
                  }
                },
                onModelFallbacksChange: (agentId, fallbacks) => {
                  if (!configValue) {
                    return;
                  }
                  const list = (configValue as { agents?: { list?: unknown[] } }).agents?.list;
                  if (!Array.isArray(list)) {
                    return;
                  }
                  const index = list.findIndex(
                    (entry) =>
                      entry &&
                      typeof entry === "object" &&
                      "id" in entry &&
                      (entry as { id?: string }).id === agentId,
                  );
                  if (index < 0) {
                    return;
                  }
                  const basePath = ["agents", "list", index, "model"];
                  const entry = list[index] as { model?: unknown };
                  const normalized = fallbacks.map((name) => name.trim()).filter(Boolean);
                  const existing = entry.model;
                  const resolvePrimary = () => {
                    if (typeof existing === "string") {
                      return existing.trim() || null;
                    }
                    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                      const primary = (existing as { primary?: unknown }).primary;
                      if (typeof primary === "string") {
                        const trimmed = primary.trim();
                        return trimmed || null;
                      }
                    }
                    return null;
                  };
                  const primary = resolvePrimary();
                  if (normalized.length === 0) {
                    if (primary) {
                      updateConfigFormValue(state, basePath, primary);
                    } else {
                      removeConfigFormValue(state, basePath);
                    }
                    return;
                  }
                  const next = primary
                    ? { primary, fallbacks: normalized }
                    : { fallbacks: normalized };
                  updateConfigFormValue(state, basePath, next);
                },
                // Create/Delete callbacks
                onShowCreateDialog: () => {
                  state.agentCreateForm = { name: "", workspace: "", emoji: "" };
                  state.agentCreateError = null;
                  state.agentShowCreateDialog = true;
                },
                onHideCreateDialog: () => {
                  state.agentShowCreateDialog = false;
                },
                onCreateFormChange: (field, value) => {
                  state.agentCreateForm = { ...state.agentCreateForm, [field]: value };
                },
                onCreateAgent: async () => {
                  const ok = await createAgent(state, state.agentCreateForm);
                  if (ok) {
                    state.agentShowCreateDialog = false;
                    const agentIds = state.agentsList?.agents?.map((entry) => entry.id) ?? [];
                    if (agentIds.length > 0) {
                      void loadAgentIdentities(state, agentIds);
                    }
                    await loadConfig(state);
                    // Load the newly created agent's identity and tools catalog
                    const newAgentId = state.agentsSelectedId;
                    if (newAgentId) {
                      await loadAgentIdentity(state, newAgentId);
                      await loadToolsCatalog(state, newAgentId);
                    }
                  }
                },
                onShowDeleteConfirm: (agentId) => {
                  state.agentDeleteError = null;
                  state.agentShowDeleteConfirm = agentId;
                },
                onHideDeleteConfirm: () => {
                  state.agentShowDeleteConfirm = null;
                },
                onDeleteAgent: async (agentId) => {
                  const ok = await deleteAgent(state, agentId);
                  if (ok) {
                    state.agentShowDeleteConfirm = null;
                    const agentIds = state.agentsList?.agents?.map((entry) => entry.id) ?? [];
                    if (agentIds.length > 0) {
                      void loadAgentIdentities(state, agentIds);
                    }
                    await loadConfig(state);
                  }
                },
                onSetDefaultAgent: async (agentId) => {
                  const ok = await setDefaultAgent(state, agentId);
                  if (ok) {
                    await loadAgents(state);
                  }
                },
              })
            : nothing
        }

        <!-- ========================================
           SKILLS 标签页：技能插件面板
           ======================================== -->
        ${
          state.tab === "skills"
            ? renderSkills({
                loading: state.skillsLoading,
                report: state.skillsReport,
                error: state.skillsError,
                filter: state.skillsFilter,
                edits: state.skillEdits,
                messages: state.skillMessages,
                busyKey: state.skillsBusyKey,
                fileEditing: state.skillFileEditing,
                fileContent: state.skillFileContent,
                fileOriginal: state.skillFileOriginal,
                fileEditable: state.skillFileEditable,
                filePath: state.skillFilePath,
                fileSaving: state.skillFileSaving,
                onFilterChange: (next) => (state.skillsFilter = next),
                onRefresh: () => loadSkills(state, { clearMessages: true }),
                onToggle: (key, enabled) => updateSkillEnabled(state, key, enabled),
                onEdit: (key, value) => updateSkillEdit(state, key, value),
                onSaveKey: (key) => saveSkillApiKey(state, key),
                onInstall: (skillKey, name, installId) =>
                  installSkill(state, skillKey, name, installId),
                onEditFile: (skillKey) => loadSkillFile(state, skillKey),
                onFileContentChange: (content) => updateSkillFileContent(state, content),
                onFileSave: () => saveSkillFile(state),
                onFileClose: () => closeSkillFileEditor(state),
              })
            : nothing
        }

        <!-- ========================================
           NODES 标签页：节点设备管理面板
           ======================================== -->
        ${
          state.tab === "nodes"
            ? renderNodes({
                loading: state.nodesLoading,
                nodes: state.nodes,
                devicesLoading: state.devicesLoading,
                devicesError: state.devicesError,
                devicesList: state.devicesList,
                configForm:
                  state.configForm ??
                  (state.configSnapshot?.config as Record<string, unknown> | null),
                configLoading: state.configLoading,
                configSaving: state.configSaving,
                configDirty: state.configFormDirty,
                configFormMode: state.configFormMode,
                execApprovalsLoading: state.execApprovalsLoading,
                execApprovalsSaving: state.execApprovalsSaving,
                execApprovalsDirty: state.execApprovalsDirty,
                execApprovalsSnapshot: state.execApprovalsSnapshot,
                execApprovalsForm: state.execApprovalsForm,
                execApprovalsSelectedAgent: state.execApprovalsSelectedAgent,
                execApprovalsTarget: state.execApprovalsTarget,
                execApprovalsTargetNodeId: state.execApprovalsTargetNodeId,
                onRefresh: () => loadNodes(state),
                onDevicesRefresh: () => loadDevices(state),
                onDeviceApprove: (requestId) => approveDevicePairing(state, requestId),
                onDeviceReject: (requestId) => rejectDevicePairing(state, requestId),
                onDeviceRotate: (deviceId, role, scopes) =>
                  rotateDeviceToken(state, { deviceId, role, scopes }),
                onDeviceRevoke: (deviceId, role) => revokeDeviceToken(state, { deviceId, role }),
                onLoadConfig: () => loadConfig(state),
                onLoadExecApprovals: () => {
                  const target =
                    state.execApprovalsTarget === "node" && state.execApprovalsTargetNodeId
                      ? { kind: "node" as const, nodeId: state.execApprovalsTargetNodeId }
                      : { kind: "gateway" as const };
                  return loadExecApprovals(state, target);
                },
                onBindDefault: (nodeId) => {
                  if (nodeId) {
                    updateConfigFormValue(state, ["tools", "exec", "node"], nodeId);
                  } else {
                    removeConfigFormValue(state, ["tools", "exec", "node"]);
                  }
                },
                onBindAgent: (agentIndex, nodeId) => {
                  const basePath = ["agents", "list", agentIndex, "tools", "exec", "node"];
                  if (nodeId) {
                    updateConfigFormValue(state, basePath, nodeId);
                  } else {
                    removeConfigFormValue(state, basePath);
                  }
                },
                onSaveBindings: () => saveConfig(state),
                onExecApprovalsTargetChange: (kind, nodeId) => {
                  state.execApprovalsTarget = kind;
                  state.execApprovalsTargetNodeId = nodeId;
                  state.execApprovalsSnapshot = null;
                  state.execApprovalsForm = null;
                  state.execApprovalsDirty = false;
                  state.execApprovalsSelectedAgent = null;
                },
                onExecApprovalsSelectAgent: (agentId) => {
                  state.execApprovalsSelectedAgent = agentId;
                },
                onExecApprovalsPatch: (path, value) =>
                  updateExecApprovalsFormValue(state, path, value),
                onExecApprovalsRemove: (path) => removeExecApprovalsFormValue(state, path),
                onSaveExecApprovals: () => {
                  const target =
                    state.execApprovalsTarget === "node" && state.execApprovalsTargetNodeId
                      ? { kind: "node" as const, nodeId: state.execApprovalsTargetNodeId }
                      : { kind: "gateway" as const };
                  return saveExecApprovals(state, target);
                },
              })
            : nothing
        }

        <!-- ========================================
           CHAT 标签页：聊天界面
           ======================================== -->
        ${
          state.tab === "chat" && state.activeGroupId === null
            ? renderChat({
                sessionKey: state.sessionKey,
                onSessionKeyChange: (next) => {
                  // Use switchSession to properly handle session switching with state cleanup
                  void switchSession(state as unknown as Parameters<typeof switchSession>[0], next);
                },
                thinkingLevel: state.chatThinkingLevel,
                showThinking,
                loading: state.chatLoading,
                sending: state.chatSending,
                compactionStatus: state.compactionStatus,
                fallbackStatus: state.fallbackStatus,
                assistantAvatarUrl: chatAvatarUrl,
                messages: state.chatMessages,
                toolMessages: state.chatToolMessages,
                stream: state.chatStream,
                streamSegments: state.chatStreamSegments,
                streamStartedAt: state.chatStreamStartedAt,
                draft: state.chatMessage,
                queue: state.chatQueue,
                connected: state.connected,
                canSend: state.connected,
                disabledReason: chatDisabledReason,
                error: state.lastError,
                sessions: state.sessionsResult,
                focusMode: chatFocus,
                onRefresh: () => {
                  state.resetToolStream();
                  return Promise.all([loadChatHistory(state), refreshChatAvatar(state)]);
                },
                onToggleFocusMode: () => {
                  if (state.onboarding) {
                    return;
                  }
                  state.applySettings({
                    ...state.settings,
                    chatFocusMode: !state.settings.chatFocusMode,
                  });
                },
                onChatScroll: (event) => state.handleChatScroll(event),
                onDraftChange: (next) => (state.chatMessage = next),
                attachments: state.chatAttachments,
                onAttachmentsChange: (next) => (state.chatAttachments = next),
                onSend: () => state.handleSendChat(),
                canAbort: Boolean(state.chatRunId),
                onAbort: () => void state.handleAbortChat(),
                onQueueRemove: (id) => state.removeQueuedMessage(id),
                onNewSession: async () => {
                  // Refresh agents list to get up-to-date defaultId before creating session
                  if (state.client && state.connected && !state.agentsLoading) {
                    try {
                      const res = await state.client.request<import("./types.ts").AgentsListResult>(
                        "agents.list",
                        {},
                      );
                      if (res) {
                        state.agentsList = res;
                      }
                    } catch {
                      // Best-effort; fall through to use cached agentsList
                    }
                  }
                  // Generate a new unique session key using the default agent
                  const agentId = state.agentsList?.defaultId ?? "main";
                  const timestamp = Date.now();
                  const randomSuffix = Math.random().toString(36).substring(2, 8);
                  const newSessionKey = `agent:${agentId}:${timestamp}-${randomSuffix}`;

                  // Add the new session to local sessions list immediately for UI display
                  // The session will be persisted on backend when user sends first message
                  const existingSessions = state.sessionsResult?.sessions ?? [];
                  const newSession = {
                    key: newSessionKey,
                    kind: "direct" as const,
                    label: "",
                    updatedAt: timestamp,
                  };
                  if (state.sessionsResult) {
                    state.sessionsResult = {
                      ...state.sessionsResult,
                      sessions: [newSession, ...existingSessions],
                    };
                  } else {
                    // Create a minimal sessionsResult if none exists
                    state.sessionsResult = {
                      ts: timestamp,
                      path: "",
                      count: 1,
                      defaults: { model: null, contextTokens: null },
                      sessions: [newSession],
                    };
                  }

                  // Switch to the new session
                  // Clear current state and update session key
                  state.chatStream = null;
                  state.chatStreamSegments = null;
                  state.chatStreamStartedAt = null;
                  state.chatRunId = null;
                  state.chatQueue = [];
                  state.chatSending = false;
                  state.chatMessage = "";
                  state.chatAttachments = [];
                  state.lastError = null;
                  state.chatMessages = [];
                  state.chatToolMessages = [];
                  state.sessionKey = newSessionKey;
                  state.chatAgentId = agentId;

                  // Sync URL with new session key
                  syncUrlWithSessionKey(
                    state as unknown as Parameters<typeof syncUrlWithSessionKey>[0],
                    newSessionKey,
                    false,
                  );

                  // Update last active session key
                  state.applySettings({
                    ...state.settings,
                    lastActiveSessionKey: newSessionKey,
                  });

                  // Load assistant identity for the new session
                  void state.loadAssistantIdentity();

                  // Reset tool stream and scroll
                  state.resetToolStream();
                  state.resetChatScroll();
                },
                showNewMessages: state.chatNewMessagesBelow && !state.chatManualRefreshInFlight,
                onScrollToBottom: () => state.scrollToBottom(),
                // Sidebar props for tool output viewing
                sidebarOpen: state.sidebarOpen,
                sidebarContent: state.sidebarContent,
                sidebarError: state.sidebarError,
                splitRatio: state.splitRatio,
                onOpenSidebar: (content: string) => state.handleOpenSidebar(content),
                onCloseSidebar: () => state.handleCloseSidebar(),
                onSplitRatioChange: (ratio: number) => state.handleSplitRatioChange(ratio),
                assistantName: state.assistantName,
                assistantAvatar: state.assistantAvatar,
                // Sessions sidebar props
                sessionsSidebarOpen: state.settings.chatSessionsSidebarOpen,
                onToggleSessionsSidebar: () => {
                  state.applySettings({
                    ...state.settings,
                    chatSessionsSidebarOpen: !state.settings.chatSessionsSidebarOpen,
                  });
                },
                onSelectSession: (key) => {
                  // Leave group chat before switching to single chat session
                  state.activeGroupId = null;
                  state.activeGroupMeta = null;
                  void switchSession(state as unknown as Parameters<typeof switchSession>[0], key);
                },
              })
            : nothing
        }

        <!-- ========================================
           GROUP CHAT 视图：群聊界面（chat tab 内子视图）
           ======================================== -->
        ${
          state.tab === "chat" && state.activeGroupId !== null
            ? renderGroupChat({
                connected: state.connected,
                activeGroupId: state.activeGroupId,
                activeGroupMeta: state.activeGroupMeta,
                groupMessages: state.groupMessages,
                groupStreams: state.groupStreams,
                groupPendingAgents: state.groupPendingAgents,
                groupToolMessages: state.groupToolMessages,
                groupIndex: state.groupIndex,
                groupListLoading: state.groupListLoading,
                groupChatLoading: state.groupChatLoading,
                groupSending: state.groupSending,
                groupDraft: state.groupDraft,
                groupError: state.groupError,
                groupCreateDialog: state.groupCreateDialog,
                groupAddMemberDialog: state.groupAddMemberDialog,
                groupDisbandDialog: state.groupDisbandDialog,
                groupInfoPanelOpen: state.groupInfoPanelOpen,
                agentsList: (state.agentsList?.agents ?? []).map((a) => ({
                  id: a.id,
                  identity: a.identity as { name?: string; emoji?: string } | undefined,
                })),
                onEnterGroup: (groupId) =>
                  void enterGroupChat(
                    state as unknown as Parameters<typeof enterGroupChat>[0],
                    groupId,
                  ),
                onLeaveGroup: () =>
                  leaveGroupChat(state as unknown as Parameters<typeof leaveGroupChat>[0]),
                onSendMessage: (message, mentions) => {
                  if (state.activeGroupId) {
                    void sendGroupMessage(
                      state as unknown as Parameters<typeof sendGroupMessage>[0],
                      state.activeGroupId,
                      message,
                      mentions,
                    );
                  }
                },
                onAbort: () => {
                  if (state.activeGroupId) {
                    void abortGroupChat(
                      state as unknown as Parameters<typeof abortGroupChat>[0],
                      state.activeGroupId,
                    );
                  }
                },
                onDraftChange: (next) => (state.groupDraft = next),
                onCreateGroup: (opts) =>
                  void createGroup(state as unknown as Parameters<typeof createGroup>[0], opts),
                onDeleteGroup: (groupId) =>
                  void deleteGroup(state as unknown as Parameters<typeof deleteGroup>[0], groupId),
                onOpenCreateDialog: () => {
                  state.groupCreateDialog = {
                    name: "",
                    selectedAgents: [],
                    messageMode: "unicast",
                    isBusy: false,
                    error: null,
                  };
                },
                onCloseCreateDialog: () => (state.groupCreateDialog = null),
                onOpenAddMemberDialog: () => {
                  state.groupAddMemberDialog = {
                    selectedAgents: [],
                    isBusy: false,
                    error: null,
                  };
                },
                onCloseAddMemberDialog: () => (state.groupAddMemberDialog = null),
                onAddMembers: (members) => {
                  if (state.activeGroupId) {
                    void updateGroupMembers(
                      state as unknown as Parameters<typeof updateGroupMembers>[0],
                      state.activeGroupId,
                      "add",
                      { members },
                    );
                  }
                },
                onToggleInfoPanel: () => (state.groupInfoPanelOpen = !state.groupInfoPanelOpen),
                onRefresh: () =>
                  void loadGroupList(state as unknown as Parameters<typeof loadGroupList>[0]),
                // Group settings callbacks
                onUpdateGroupName: (name) => {
                  if (state.activeGroupId) {
                    void (async () => {
                      const { updateGroupName } = await import("./controllers/group-chat.ts");
                      await updateGroupName(
                        state as unknown as Parameters<typeof updateGroupName>[0],
                        state.activeGroupId!,
                        name,
                      );
                    })();
                  }
                },
                onUpdateMessageMode: (mode) => {
                  if (state.activeGroupId) {
                    void (async () => {
                      const { updateGroupMessageMode } =
                        await import("./controllers/group-chat.ts");
                      await updateGroupMessageMode(
                        state as unknown as Parameters<typeof updateGroupMessageMode>[0],
                        state.activeGroupId!,
                        mode,
                      );
                    })();
                  }
                },
                onUpdateAnnouncement: (content) => {
                  if (state.activeGroupId) {
                    void (async () => {
                      const { updateGroupAnnouncement } =
                        await import("./controllers/group-chat.ts");
                      await updateGroupAnnouncement(
                        state as unknown as Parameters<typeof updateGroupAnnouncement>[0],
                        state.activeGroupId!,
                        content,
                      );
                    })();
                  }
                },
                showThinking: state.settings.groupShowThinking,
                onToggleShowThinking: () => {
                  state.applySettings({
                    ...state.settings,
                    groupShowThinking: !state.settings.groupShowThinking,
                  });
                },
                onOpenDisbandDialog: () => {
                  if (state.activeGroupId && state.activeGroupMeta) {
                    openDisbandGroupDialog(
                      state as unknown as Parameters<typeof openDisbandGroupDialog>[0],
                      state.activeGroupId,
                      state.activeGroupMeta.name,
                    );
                  }
                },
                onCloseDisbandDialog: () => {
                  closeDisbandGroupDialog(
                    state as unknown as Parameters<typeof closeDisbandGroupDialog>[0],
                  );
                },
                onConfirmDisbandGroup: () => {
                  void confirmDisbandGroup(
                    state as unknown as Parameters<typeof confirmDisbandGroup>[0],
                  );
                },
              })
            : nothing
        }

        <!-- ========================================
           CONFIG 标签页：配置面板
           ======================================== -->
        ${
          state.tab === "config"
            ? renderConfig({
                raw: state.configRaw,
                originalRaw: state.configRawOriginal,
                valid: state.configValid,
                issues: state.configIssues,
                loading: state.configLoading,
                saving: state.configSaving,
                applying: state.configApplying,
                updating: state.updateRunning,
                connected: state.connected,
                schema: state.configSchema,
                schemaLoading: state.configSchemaLoading,
                uiHints: state.configUiHints,
                formMode: state.configFormMode,
                formValue: state.configForm,
                originalValue: state.configFormOriginal,
                searchQuery: state.configSearchQuery,
                activeSection: state.configActiveSection,
                activeSubsection: state.configActiveSubsection,
                onRawChange: (next) => {
                  state.configRaw = next;
                },
                onFormModeChange: (mode) => (state.configFormMode = mode),
                onFormPatch: (path, value) => updateConfigFormValue(state, path, value),
                onSearchChange: (query) => (state.configSearchQuery = query),
                onSectionChange: (section) => {
                  state.configActiveSection = section;
                  state.configActiveSubsection = null;
                },
                onSubsectionChange: (section) => (state.configActiveSubsection = section),
                onReload: () => loadConfig(state),
                onSave: () => saveConfig(state),
                onApply: () => applyConfig(state),
                onUpdate: () => runUpdate(state),
              })
            : nothing
        }

        <!-- ========================================
           DEBUG 标签页：调试工具面板
           ======================================== -->
        ${
          state.tab === "debug"
            ? renderDebug({
                loading: state.debugLoading,
                status: state.debugStatus,
                health: state.debugHealth,
                models: state.debugModels,
                heartbeat: state.debugHeartbeat,
                eventLog: state.eventLog,
                callMethod: state.debugCallMethod,
                callParams: state.debugCallParams,
                callResult: state.debugCallResult,
                callError: state.debugCallError,
                onCallMethodChange: (next) => (state.debugCallMethod = next),
                onCallParamsChange: (next) => (state.debugCallParams = next),
                onRefresh: () => loadDebug(state),
                onCall: () => callDebugMethod(state),
              })
            : nothing
        }

        <!-- ========================================
           LOGS 标签页：日志查看面板
           ======================================== -->
        ${
          state.tab === "logs"
            ? renderLogs({
                loading: state.logsLoading,
                error: state.logsError,
                file: state.logsFile,
                entries: state.logsEntries,
                filterText: state.logsFilterText,
                levelFilters: state.logsLevelFilters,
                autoFollow: state.logsAutoFollow,
                truncated: state.logsTruncated,
                onFilterTextChange: (next) => (state.logsFilterText = next),
                onLevelToggle: (level, enabled) => {
                  state.logsLevelFilters = { ...state.logsLevelFilters, [level]: enabled };
                },
                onToggleAutoFollow: (next) => (state.logsAutoFollow = next),
                onRefresh: () => loadLogs(state, { reset: true }),
                onExport: (lines, label) => state.exportLogs(lines, label),
                onScroll: (event) => state.handleLogsScroll(event),
              })
            : nothing
        }
      </main>

      <!-- ========================================
         模态对话框和提示组件
         ======================================== -->

      <!-- 执行批准提示对话框 -->
      ${renderExecApprovalPrompt(state)}

      <!-- Gateway URL 确认对话框 -->
      ${renderGatewayUrlConfirmation(state)}

      <!-- 删除会话确认对话框 -->
      ${renderDeleteSessionDialog(state as unknown as Parameters<typeof renderDeleteSessionDialog>[0])}
    </div>
  `;
}
