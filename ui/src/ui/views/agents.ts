import { html, nothing } from "lit";
import type {
  AgentIdentityResult,
  AgentsFilesListResult,
  AgentsListResult,
  ChannelsStatusSnapshot,
  CronJob,
  CronStatus,
  SkillStatusReport,
  ToolsCatalogResult,
} from "../types.ts";
import "../components/cli-test-terminal.ts";
import {
  renderAgentFiles,
  renderAgentChannels,
  renderAgentCron,
} from "./agents-panels-status-files.ts";
import { renderAgentTools, renderAgentSkills } from "./agents-panels-tools-skills.ts";
import {
  agentBadgeText,
  buildAgentContext,
  buildModelOptions,
  normalizeAgentLabel,
  normalizeModelValue,
  resolveAgentConfig,
  resolveAgentEmoji,
  resolveConfiguredModels,
  resolveEffectiveModelFallbacks,
  resolveModelLabel,
  resolveModelPrimary,
} from "./agents-utils.ts";

/** Result from `cliAgents.list` RPC call. */
export type CliAgentsListResult = {
  agents: Array<{
    id: string;
    name: string;
    emoji?: string;
    type: string;
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  }>;
};

/** Result from `cliAgents.test` RPC call. */
export type CliTestResult = {
  ok: boolean;
  agentId: string;
  checks: Array<{ name: string; ok: boolean; message?: string }>;
};

/** AgentID validation pattern — only [a-zA-Z0-9_]. */
const AGENT_ID_PATTERN = /^[a-zA-Z0-9_]+$/;

export type AgentsPanel = "overview" | "files" | "tools" | "skills" | "channels" | "cron" | "test";

export type AgentCreateForm = {
  name: string;
  /** Optional explicit AgentID — only [a-zA-Z0-9_]. */
  agentId: string;
  workspace: string;
  emoji: string;
};

export type CliType = "claude-code" | "opencode" | "codebuddy" | "custom";

export type CliAgentCreateForm = {
  name: string;
  /** Explicit AgentID — only [a-zA-Z0-9_]. Auto-synced from name when name is valid. */
  agentId: string;
  workspace: string;
  emoji: string;
  cliType: CliType;
  command: string;
  args: string;
  env: Array<{ key: string; value: string }>;
  timeout: number;
  idleTimeout: number;
};

/** CLI type presets for auto-filling form fields. */
const _CLI_PRESETS: Record<CliType, { name: string; command: string; emoji: string }> = {
  "claude-code": { name: "claude-code", command: "claude", emoji: "🤖" },
  opencode: { name: "opencode", command: "opencode", emoji: "🔧" },
  codebuddy: { name: "codebuddy", command: "codebuddy", emoji: "🛠️" },
  custom: { name: "", command: "", emoji: "🔧" },
};

export type AgentsProps = {
  loading: boolean;
  error: string | null;
  agentsList: AgentsListResult | null;
  selectedAgentId: string | null;
  activePanel: AgentsPanel;
  configForm: Record<string, unknown> | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  channelsLoading: boolean;
  channelsError: string | null;
  channelsSnapshot: ChannelsStatusSnapshot | null;
  channelsLastSuccess: number | null;
  cronLoading: boolean;
  cronStatus: CronStatus | null;
  cronJobs: CronJob[];
  cronError: string | null;
  agentFilesLoading: boolean;
  agentFilesError: string | null;
  agentFilesList: AgentsFilesListResult | null;
  agentFileActive: string | null;
  agentFileContents: Record<string, string>;
  agentFileDrafts: Record<string, string>;
  agentFileContents: Record<string, string>;
  agentFileSaving: boolean;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  agentIdentityById: Record<string, AgentIdentityResult>;
  agentSkillsLoading: boolean;
  agentSkillsReport: SkillStatusReport | null;
  agentSkillsError: string | null;
  agentSkillsAgentId: string | null;
  toolsCatalogLoading: boolean;
  toolsCatalogError: string | null;
  toolsCatalogResult: ToolsCatalogResult | null;
  skillsFilter: string;
  // Save feedback
  configSaveSuccess: boolean;
  // Create/Delete state
  showCreateDialog: boolean;
  createForm: AgentCreateForm;
  createBusy: boolean;
  createError: string | null;
  deleteBusy: boolean;
  deleteError: string | null;
  showDeleteConfirm: string | null;
  // CLI Agent create state
  showCliCreateDialog: boolean;
  cliCreateForm: CliAgentCreateForm;
  cliCreateBusy: boolean;
  cliCreateError: string | null;
  showAddMenu: boolean;
  // CLI Agents data (independent from agentsList)
  cliAgentsList: CliAgentsListResult | null;
  cliAgentsLoading: boolean;
  cliAgentsError: string | null;
  // CLI Agent test state
  cliTestRunning: boolean;
  cliTestResult: CliTestResult | null;
  // CLI Agent test terminal dialog
  cliTestTerminalOpen: boolean;
  cliTestTerminalData: string[];
  onRefresh: () => void;
  onSelectAgent: (agentId: string) => void;
  onSelectPanel: (panel: AgentsPanel) => void;
  onLoadFiles: (agentId: string) => void;
  onSelectFile: (name: string) => void;
  onFileDraftChange: (name: string, content: string) => void;
  onFileReset: (name: string) => void;
  onFileSave: (name: string) => void;
  onToolsProfileChange: (agentId: string, profile: string | null, clearAllow: boolean) => void;
  onToolsOverridesChange: (agentId: string, alsoAllow: string[], deny: string[]) => void;
  onConfigReload: () => void;
  onConfigSave: () => void;
  onModelChange: (agentId: string, modelId: string | null) => void;
  onModelFallbacksChange: (agentId: string, fallbacks: string[]) => void;
  onChannelsRefresh: () => void;
  onCronRefresh: () => void;
  onSkillsFilterChange: (next: string) => void;
  onSkillsRefresh: () => void;
  onAgentSkillToggle: (agentId: string, skillName: string, enabled: boolean) => void;
  onAgentSkillsClear: (agentId: string) => void;
  onAgentSkillsDisableAll: (agentId: string) => void;
  // Create/Delete callbacks
  onShowCreateDialog: () => void;
  onHideCreateDialog: () => void;
  onCreateFormChange: (field: keyof AgentCreateForm, value: string) => void;
  onCreateAgent: () => void;
  // CLI Agent create callbacks
  onShowCliCreateDialog: () => void;
  onHideCliCreateDialog: () => void;
  onCliCreateFormChange: (field: string, value: unknown) => void;
  onCliTypeChange: (cliType: CliType) => void;
  onCliEnvAdd: () => void;
  onCliEnvRemove: (index: number) => void;
  onCliEnvChange: (index: number, field: "key" | "value", value: string) => void;
  onCreateCliAgent: () => void;
  onToggleAddMenu: () => void;
  // CLI Agent test callbacks
  onCliAgentTest: (agentId: string) => void;
  onCliAgentTestStop: (agentId: string) => void;
  onCliTestTerminalClose: () => void;
  onCliTestSendInput: (agentId: string, input: string) => void;
  // CLI Agent delete callback
  onDeleteCliAgent: (agentId: string) => void;
  // Delete callbacks
  onDeleteAgent: (agentId: string) => void;
  onShowDeleteConfirm: (agentId: string) => void;
  onHideDeleteConfirm: () => void;
  onSetDefaultAgent: (agentId: string) => void;
};

export type AgentContext = {
  workspace: string;
  model: string;
  identityName: string;
  identityEmoji: string;
  skillsLabel: string;
  isDefault: boolean;
};

/** Check if an agent is a CLI Agent by looking at its identity theme. */
function _isCliAgent(
  agent: { identity?: { theme?: string } },
  identityResult?: { theme?: string } | null,
): boolean {
  const theme = identityResult?.theme?.trim() || agent.identity?.theme?.trim() || "";
  return theme.startsWith("CLI Agent");
}

/** Try to parse the bridge.json file content from an agent's file list. */
function parseBridgeConfig(
  agent: { id: string },
  filesList: AgentsFilesListResult | null,
  fileContents: Record<string, string>,
): Record<string, unknown> | null {
  if (!filesList || filesList.agentId !== agent.id) {
    return null;
  }
  const hasFile = filesList.files?.some((f: { name: string }) => f.name === "bridge.json");
  if (!hasFile) {
    return null;
  }
  const raw = fileContents["bridge.json"];
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Render the CLI bridge configuration section in agent overview. */
function renderBridgeConfigSection(
  agent: AgentsListResult["agents"][number],
  agentFilesList: AgentsFilesListResult | null,
  agentFileContents?: Record<string, string>,
) {
  // Check if this is a CLI Agent
  const theme = agent.identity?.theme?.trim() || "";
  if (!theme.startsWith("CLI Agent")) {
    return nothing;
  }

  const bridge = parseBridgeConfig(agent, agentFilesList, agentFileContents ?? {});

  return html`
    <div class="agents-overview-grid" style="margin-top: 16px; border-top: 1px solid var(--border); padding-top: 16px;">
      <div class="agent-kv" style="grid-column: 1 / -1;">
        <div class="label" style="font-weight: 600; font-size: 13px;">🔧 CLI Configuration</div>
      </div>
      ${
        bridge
          ? html`
          <div class="agent-kv">
            <div class="label">CLI Type</div>
            <div class="mono">${typeof bridge.type === "string" ? bridge.type : "-"}</div>
          </div>
          <div class="agent-kv">
            <div class="label">Command</div>
            <div class="mono">${typeof bridge.command === "string" ? bridge.command : "-"}</div>
          </div>
          <div class="agent-kv">
            <div class="label">Arguments</div>
            <div class="mono">${Array.isArray(bridge.args) ? (bridge.args as string[]).join(" ") : "-"}</div>
          </div>
          <div class="agent-kv">
            <div class="label">Working Directory</div>
            <div class="mono">${typeof bridge.cwd === "string" ? bridge.cwd : "-"}</div>
          </div>
          <div class="agent-kv">
            <div class="label">Reply Timeout</div>
            <div>${bridge.timeout ? `${Math.round(Number(bridge.timeout) / 1000)}s` : "300s (default)"}</div>
          </div>
          <div class="agent-kv">
            <div class="label">Environment Variables</div>
            <div>${bridge.env && typeof bridge.env === "object" ? `${Object.keys(bridge.env).length} configured` : "none"}</div>
          </div>
        `
          : html`
              <div class="agent-kv" style="grid-column: 1 / -1">
                <div class="muted">
                  Bridge configuration will be available after switching to the Files tab to load bridge.json.
                </div>
              </div>
            `
      }
    </div>
  `;
}

export function renderAgents(props: AgentsProps) {
  const agents = props.agentsList?.agents ?? [];
  const cliAgents = props.cliAgentsList?.agents ?? [];
  const defaultId = props.agentsList?.defaultId ?? null;
  const selectedId =
    props.selectedAgentId ?? defaultId ?? agents[0]?.id ?? cliAgents[0]?.id ?? null;
  const selectedAgent = selectedId
    ? (agents.find((agent) => agent.id === selectedId) ?? null)
    : null;
  const selectedCliAgent =
    selectedId && !selectedAgent ? (cliAgents.find((a) => a.id === selectedId) ?? null) : null;
  const isDefault = Boolean(defaultId && selectedId === defaultId);

  return html`
    <div class="agents-layout" @click=${() => {
      if (props.showAddMenu) {
        props.onToggleAddMenu();
      }
    }}>
      <section class="card agents-sidebar">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">Agents</div>
            <div class="card-sub">${agents.length + cliAgents.length} configured.</div>
          </div>
          <div class="row" style="gap: 6px;">
            <button class="btn btn--sm" ?disabled=${props.loading} @click=${props.onRefresh}>
              ${props.loading ? "Loading…" : "Refresh"}
            </button>
            <div class="add-menu-wrapper" style="position: relative;" @click=${(e: Event) => e.stopPropagation()}>
              <button class="btn btn--sm primary" @click=${props.onToggleAddMenu}>+ Add</button>
              ${
                props.showAddMenu
                  ? html`
                      <div class="add-menu-dropdown" @click=${(e: Event) => e.stopPropagation()}>
                        <button
                          class="add-menu-item"
                          @click=${() => {
                            props.onShowCreateDialog();
                          }}
                        >
                          <span class="add-menu-icon">🤖</span>
                          <div>
                            <div class="add-menu-title">通用 Agent</div>
                            <div class="add-menu-desc">添加带工作空间和身份的 Agent</div>
                          </div>
                        </button>
                        <button
                          class="add-menu-item"
                          @click=${() => {
                            props.onShowCliCreateDialog();
                          }}
                        >
                          <span class="add-menu-icon">🔧</span>
                          <div>
                            <div class="add-menu-title">CLI Agent</div>
                            <div class="add-menu-desc">添加外部 CLI 工具 (Claude Code, OpenCode 等)</div>
                          </div>
                        </button>
                      </div>
                    `
                  : nothing
              }
            </div>
          </div>
        </div>
        ${
          props.error
            ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
            : nothing
        }
        <!-- General Agents Section -->
        <div style="margin-top: 12px;">
          <div class="section-label" style="font-size: 11px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.5px; margin-bottom: 6px;">通用 Agent</div>
          <div class="agent-list">
            ${
              agents.length === 0
                ? html`
                    <div class="muted" style="padding: 4px 0; font-size: 13px">No general agents.</div>
                  `
                : agents.map((agent) => {
                    const badge = agentBadgeText(agent.id, defaultId);
                    const emoji = resolveAgentEmoji(
                      agent,
                      props.agentIdentityById[agent.id] ?? null,
                    );
                    return html`
                      <button
                        type="button"
                        class="agent-row ${selectedId === agent.id ? "active" : ""}"
                        @click=${() => props.onSelectAgent(agent.id)}
                      >
                        <div class="agent-avatar">${emoji || normalizeAgentLabel(agent).slice(0, 1)}</div>
                        <div class="agent-info">
                          <div class="agent-title">${normalizeAgentLabel(agent)}</div>
                        </div>
                        ${badge ? html`<span class="agent-pill">${badge}</span>` : nothing}
                      </button>
                    `;
                  })
            }
          </div>
        </div>
        <!-- CLI Agents Section -->
        <div style="margin-top: 16px;">
          <div class="section-label" style="font-size: 11px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.5px; margin-bottom: 6px;">CLI Agent</div>
          <div class="agent-list">
            ${
              cliAgents.length === 0
                ? html`
                    <div class="muted" style="padding: 4px 0; font-size: 13px">No CLI agents.</div>
                  `
                : cliAgents.map(
                    (agent) => html`
                    <button
                      type="button"
                      class="agent-row ${selectedId === agent.id ? "active" : ""}"
                      @click=${() => props.onSelectAgent(agent.id)}
                    >
                      <div class="agent-avatar">${agent.emoji || "🔧"}</div>
                      <div class="agent-info">
                        <div class="agent-title">${agent.name}</div>
                      </div>
                      <span class="agent-pill agent-pill--cli">CLI</span>
                    </button>
                  `,
                  )
            }
          </div>
        </div>
      </section>
      <section class="agents-main">
        ${
          !selectedAgent && !selectedCliAgent
            ? html`
                <div class="card">
                  <div class="card-title">Select an agent</div>
                  <div class="card-sub">Pick an agent to inspect its workspace and tools.</div>
                </div>
              `
            : selectedCliAgent
              ? renderCliAgentDetail(props, selectedCliAgent)
              : html`
                ${renderAgentHeader(
                  selectedAgent!,
                  defaultId,
                  props.agentIdentityById[selectedAgent!.id] ?? null,
                  isDefault,
                  props.deleteBusy,
                  props.showDeleteConfirm === selectedAgent!.id,
                  () => props.onShowDeleteConfirm(selectedAgent!.id),
                  () => props.onHideDeleteConfirm(),
                  () => props.onDeleteAgent(selectedAgent!.id),
                  () => props.onSetDefaultAgent(selectedAgent!.id),
                )}
                ${
                  props.deleteError && props.showDeleteConfirm === selectedAgent!.id
                    ? html`<div class="callout danger" style="margin-top: -8px;">${props.deleteError}</div>`
                    : nothing
                }
                ${renderAgentTabs(props.activePanel, (panel) => props.onSelectPanel(panel))}
                ${
                  props.activePanel === "overview"
                    ? renderAgentOverview({
                        agent: selectedAgent!,
                        defaultId,
                        configForm: props.configForm,
                        agentFilesList: props.agentFilesList,
                        agentFileContents: props.agentFileContents,
                        agentIdentity: props.agentIdentityById[selectedAgent!.id] ?? null,
                        agentIdentityError: props.agentIdentityError,
                        agentIdentityLoading: props.agentIdentityLoading,
                        configLoading: props.configLoading,
                        configSaving: props.configSaving,
                        configDirty: props.configDirty,
                        configSaveSuccess: props.configSaveSuccess,
                        onConfigReload: props.onConfigReload,
                        onConfigSave: props.onConfigSave,
                        onModelChange: props.onModelChange,
                        onModelFallbacksChange: props.onModelFallbacksChange,
                      })
                    : nothing
                }
                ${
                  props.activePanel === "files"
                    ? renderAgentFiles({
                        agentId: selectedAgent!.id,
                        agentFilesList: props.agentFilesList,
                        agentFilesLoading: props.agentFilesLoading,
                        agentFilesError: props.agentFilesError,
                        agentFileActive: props.agentFileActive,
                        agentFileContents: props.agentFileContents,
                        agentFileDrafts: props.agentFileDrafts,
                        agentFileSaving: props.agentFileSaving,
                        onLoadFiles: props.onLoadFiles,
                        onSelectFile: props.onSelectFile,
                        onFileDraftChange: props.onFileDraftChange,
                        onFileReset: props.onFileReset,
                        onFileSave: props.onFileSave,
                      })
                    : nothing
                }
                ${
                  props.activePanel === "tools"
                    ? renderAgentTools({
                        agentId: selectedAgent!.id,
                        configForm: props.configForm,
                        configLoading: props.configLoading,
                        configSaving: props.configSaving,
                        configDirty: props.configDirty,
                        toolsCatalogLoading: props.toolsCatalogLoading,
                        toolsCatalogError: props.toolsCatalogError,
                        toolsCatalogResult: props.toolsCatalogResult,
                        onProfileChange: props.onToolsProfileChange,
                        onOverridesChange: props.onToolsOverridesChange,
                        onConfigReload: props.onConfigReload,
                        onConfigSave: props.onConfigSave,
                      })
                    : nothing
                }
                ${
                  props.activePanel === "skills"
                    ? renderAgentSkills({
                        agentId: selectedAgent!.id,
                        report: props.agentSkillsReport,
                        loading: props.agentSkillsLoading,
                        error: props.agentSkillsError,
                        activeAgentId: props.agentSkillsAgentId,
                        configForm: props.configForm,
                        configLoading: props.configLoading,
                        configSaving: props.configSaving,
                        configDirty: props.configDirty,
                        filter: props.skillsFilter,
                        onFilterChange: props.onSkillsFilterChange,
                        onRefresh: props.onSkillsRefresh,
                        onToggle: props.onAgentSkillToggle,
                        onClear: props.onAgentSkillsClear,
                        onDisableAll: props.onAgentSkillsDisableAll,
                        onConfigReload: props.onConfigReload,
                        onConfigSave: props.onConfigSave,
                      })
                    : nothing
                }
                ${
                  props.activePanel === "channels"
                    ? renderAgentChannels({
                        context: buildAgentContext(
                          selectedAgent!,
                          props.configForm,
                          props.agentFilesList,
                          defaultId,
                          props.agentIdentityById[selectedAgent!.id] ?? null,
                        ),
                        configForm: props.configForm,
                        snapshot: props.channelsSnapshot,
                        loading: props.channelsLoading,
                        error: props.channelsError,
                        lastSuccess: props.channelsLastSuccess,
                        onRefresh: props.onChannelsRefresh,
                      })
                    : nothing
                }
                ${
                  props.activePanel === "cron"
                    ? renderAgentCron({
                        context: buildAgentContext(
                          selectedAgent!,
                          props.configForm,
                          props.agentFilesList,
                          defaultId,
                          props.agentIdentityById[selectedAgent!.id] ?? null,
                        ),
                        agentId: selectedAgent!.id,
                        jobs: props.cronJobs,
                        status: props.cronStatus,
                        loading: props.cronLoading,
                        error: props.cronError,
                        onRefresh: props.onCronRefresh,
                      })
                    : nothing
                }
              `
        }
      </section>
    </div>
    ${props.showCreateDialog ? renderCreateAgentDialog(props) : nothing}
    ${props.showCliCreateDialog ? renderCreateCliAgentDialog(props) : nothing}
    ${props.showDeleteConfirm ? renderDeleteConfirmOverlay(props) : nothing}
  `;
}

/** Render CLI Agent detail — header + tabs (Overview/Files/Test) + panels. */
function renderCliAgentDetail(props: AgentsProps, agent: CliAgentsListResult["agents"][number]) {
  const cliTabs: Array<{ id: AgentsPanel; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "files", label: "Files" },
    { id: "test", label: "Test" },
  ];
  return html`
    <!-- CLI Agent Header -->
    <section class="card agent-header">
      <div class="agent-header-main">
        <div class="agent-avatar agent-avatar--lg">${agent.emoji || "🔧"}</div>
        <div>
          <div class="card-title">${agent.name}</div>
          <div class="card-sub">CLI Agent workspace and configuration.</div>
        </div>
      </div>
      <div class="agent-header-meta">
        <div class="mono">${agent.id}</div>
        <span class="agent-pill agent-pill--cli">CLI</span>
        <button
          class="btn btn--sm danger"
          ?disabled=${props.deleteBusy}
          @click=${() => props.onDeleteCliAgent(agent.id)}
        >Delete</button>
      </div>
    </section>

    <!-- CLI Agent Tabs -->
    <div class="agent-tabs">
      ${cliTabs.map(
        (tab) => html`
          <button
            class="agent-tab ${props.activePanel === tab.id ? "active" : ""}"
            type="button"
            @click=${() => props.onSelectPanel(tab.id)}
          >
            ${tab.label}
          </button>
        `,
      )}
    </div>

    <!-- CLI Agent Overview Panel -->
    ${props.activePanel === "overview" ? renderCliAgentOverview(agent) : nothing}

    <!-- CLI Agent Files Panel (reuse existing) -->
    ${
      props.activePanel === "files"
        ? renderAgentFiles({
            agentId: agent.id,
            agentFilesList: props.agentFilesList,
            agentFilesLoading: props.agentFilesLoading,
            agentFilesError: props.agentFilesError,
            agentFileActive: props.agentFileActive,
            agentFileContents: props.agentFileContents,
            agentFileDrafts: props.agentFileDrafts,
            agentFileSaving: props.agentFileSaving,
            onLoadFiles: props.onLoadFiles,
            onSelectFile: props.onSelectFile,
            onFileDraftChange: props.onFileDraftChange,
            onFileReset: props.onFileReset,
            onFileSave: props.onFileSave,
          })
        : nothing
    }

    <!-- CLI Agent Test Panel -->
    ${props.activePanel === "test" ? renderCliAgentTest(props, agent) : nothing}
  `;
}

/** Render CLI Agent Overview — shows CLI-specific config, no model/skills. */
function renderCliAgentOverview(agent: CliAgentsListResult["agents"][number]) {
  const envCount = agent.env ? Object.keys(agent.env).length : 0;
  const timeoutLabel = agent.timeout ? `${Math.round(agent.timeout / 1000)}s` : "300s (default)";

  return html`
    <section class="card">
      <div class="card-title">Overview</div>
      <div class="card-sub">CLI Agent identity and configuration.</div>
      <div class="agents-overview-grid" style="margin-top: 16px;">
        <div class="agent-kv" style="grid-column: 1 / -1;">
          <div class="label" style="font-weight: 600; font-size: 13px;">Identity</div>
        </div>
        <div class="agent-kv">
          <div class="label">Agent 名称</div>
          <div>${agent.name}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Agent ID</div>
          <div class="mono">${agent.id}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Emoji</div>
          <div>${agent.emoji || "🔧"}</div>
        </div>
      </div>

      <div class="agents-overview-grid" style="margin-top: 16px; border-top: 1px solid var(--border); padding-top: 16px;">
        <div class="agent-kv" style="grid-column: 1 / -1;">
          <div class="label" style="font-weight: 600; font-size: 13px;">🔧 CLI Configuration</div>
        </div>
        <div class="agent-kv">
          <div class="label">CLI Type</div>
          <div class="mono">${agent.type}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Command</div>
          <div class="mono">${agent.command}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Arguments</div>
          <div class="mono">${Array.isArray(agent.args) && agent.args.length > 0 ? agent.args.join(" ") : "(none)"}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Working Directory</div>
          <div class="mono">${agent.cwd || "(default)"}</div>
        </div>
      </div>

      <div class="agents-overview-grid" style="margin-top: 16px; border-top: 1px solid var(--border); padding-top: 16px;">
        <div class="agent-kv" style="grid-column: 1 / -1;">
          <div class="label" style="font-weight: 600; font-size: 13px;">Timeout</div>
        </div>
        <div class="agent-kv">
          <div class="label">Reply Timeout</div>
          <div>${timeoutLabel}</div>
        </div>
      </div>

      <div class="agents-overview-grid" style="margin-top: 16px; border-top: 1px solid var(--border); padding-top: 16px;">
        <div class="agent-kv" style="grid-column: 1 / -1;">
          <div class="label" style="font-weight: 600; font-size: 13px;">Environment Variables</div>
        </div>
        <div class="agent-kv">
          <div class="label">Configured</div>
          <div>${envCount > 0 ? `${envCount} variables (values masked)` : "none"}</div>
        </div>
      </div>
    </section>
  `;
}

/** Render CLI Agent Test panel. */
function renderCliAgentTest(props: AgentsProps, agent: CliAgentsListResult["agents"][number]) {
  const result = props.cliTestResult;
  const isThisAgent = result && result.agentId === agent.id;
  return html`
    <section class="card">
      <div class="card-title">Test</div>
      <div class="card-sub">
        测试 CLI Agent 能否正常启动和响应。点击测试后将启动 PTY 终端并显示 CLI 的 TUI 界面。
      </div>

      <div style="margin-top: 16px;">
        <button
          class="btn btn--sm primary"
          type="button"
          ?disabled=${props.cliTestRunning}
          @click=${() => props.onCliAgentTest(agent.id)}
        >
          ${props.cliTestRunning ? "🔄 测试中…" : "🧪 Start Test"}
        </button>
        ${
          props.cliTestRunning
            ? html`
              <button
                class="btn btn--sm"
                type="button"
                style="margin-left: 8px;"
                @click=${() => props.onCliAgentTestStop(agent.id)}
              >⏹ 停止</button>
            `
            : nothing
        }
      </div>

      ${
        isThisAgent
          ? html`
            <div style="margin-top: 16px; border-top: 1px solid var(--border); padding-top: 12px;">
              <div style="font-weight: 600; font-size: 13px; margin-bottom: 8px;">
                ${result.ok ? "✅ 测试通过" : "❌ 测试失败"}
              </div>
              <div class="test-checks">
                ${result.checks.map(
                  (check) => html`
                    <div style="display: flex; gap: 8px; align-items: center; padding: 4px 0; font-size: 13px;">
                      <span>${check.ok ? "✅" : "❌"}</span>
                      <span class="mono">${check.name}</span>
                      <span class="muted">${check.message || ""}</span>
                    </div>
                  `,
                )}
              </div>
            </div>
          `
          : nothing
      }
    </section>

    ${props.cliTestTerminalOpen ? renderCliTestTerminalDialog(props, agent) : nothing}
  `;
}

/** Render the xterm.js terminal dialog for CLI Agent test. */
function renderCliTestTerminalDialog(
  props: AgentsProps,
  agent: CliAgentsListResult["agents"][number],
) {
  const result = props.cliTestResult;
  const isThisAgent = result && result.agentId === agent.id;
  const statusLabel = props.cliTestRunning
    ? "🔄 测试中…"
    : isThisAgent
      ? result.ok
        ? "✅ 测试通过"
        : "❌ 测试失败"
      : "";

  return html`
    <div class="dialog-overlay" @click=${props.onCliTestTerminalClose}>
      <div
        class="dialog-card"
        style="width: 960px; max-width: 95vw; max-height: 85vh; display: flex; flex-direction: column;"
        @click=${(e: Event) => e.stopPropagation()}
      >
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
          <div>
            <div class="card-title" style="margin: 0;">🧪 CLI Agent Test — ${agent.name}</div>
            <div class="card-sub" style="margin-top: 4px;">${statusLabel}</div>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            ${
              props.cliTestRunning
                ? html`
                  <button
                    class="btn btn--sm danger"
                    type="button"
                    @click=${() => props.onCliAgentTestStop(agent.id)}
                  >⏹ 停止</button>
                `
                : nothing
            }
            <button
              class="btn btn--sm"
              type="button"
              @click=${props.onCliTestTerminalClose}
            >✕ 关闭</button>
          </div>
        </div>

        <!-- Terminal area with xterm.js -->
        <div
          class="cli-test-terminal-container"
          style="
            flex: 1;
            min-height: 350px;
            max-height: 60vh;
            background: #1e1e2e;
            border-radius: var(--radius-md, 6px);
            border: 1px solid var(--border);
            overflow: auto;
          "
        >
          <cli-test-terminal
            .data=${props.cliTestTerminalData}
            .active=${props.cliTestTerminalOpen}
          ></cli-test-terminal>
        </div>

        <!-- Check results -->
        ${
          isThisAgent
            ? html`
              <div style="margin-top: 12px; border-top: 1px solid var(--border); padding-top: 8px;">
                <div style="font-weight: 600; font-size: 12px; margin-bottom: 6px; color: var(--muted);">
                  检查结果:
                </div>
                ${result.checks.map(
                  (check) => html`
                    <div style="display: flex; gap: 6px; align-items: center; padding: 2px 0; font-size: 12px;">
                      <span>${check.ok ? "✅" : "❌"}</span>
                      <span class="mono">${check.name}</span>
                      <span class="muted">${check.message || ""}</span>
                    </div>
                  `,
                )}
              </div>
            `
            : nothing
        }

        <!-- Quick test input buttons — shown after test completes while PTY is still running -->
        ${
          !props.cliTestRunning && isThisAgent
            ? html`
          <div style="margin-top: 10px; border-top: 1px solid var(--border); padding-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">
            <span style="font-size: 11px; color: var(--muted); margin-right: 4px;">快捷测试:</span>
            ${[
              { label: "👋 hello", text: "hello" },
              { label: "🌤️ 查询天气", text: "今天北京天气怎么样" },
              { label: "🕐 当前时间", text: "现在几点了" },
            ].map(
              (item) => html`
                <button
                  class="btn btn--sm"
                  type="button"
                  style="font-size: 11px; padding: 2px 8px;"
                  @click=${() => props.onCliTestSendInput(agent.id, item.text)}
                >${item.label}</button>
              `,
            )}
          </div>
        `
            : nothing
        }
      </div>
    </div>
  `;
}

function renderAgentHeader(
  agent: AgentsListResult["agents"][number],
  defaultId: string | null,
  agentIdentity: AgentIdentityResult | null,
  isDefault: boolean,
  deleteBusy: boolean,
  showDeleteConfirm: boolean,
  onShowDelete: () => void,
  _onHideDelete: () => void,
  _onConfirmDelete: () => void,
  onSetDefault: () => void,
) {
  const badge = agentBadgeText(agent.id, defaultId);
  const displayName = normalizeAgentLabel(agent);
  const subtitle = agent.identity?.theme?.trim() || "Agent workspace and routing.";
  const emoji = resolveAgentEmoji(agent, agentIdentity);
  return html`
    <section class="card agent-header">
      <div class="agent-header-main">
        <div class="agent-avatar agent-avatar--lg">${emoji || displayName.slice(0, 1)}</div>
        <div>
          <div class="card-title">${displayName}</div>
          <div class="card-sub">${subtitle}</div>
        </div>
      </div>
      <div class="agent-header-meta">
        <div class="mono">${agent.id}</div>
        ${badge ? html`<span class="agent-pill">${badge}</span>` : nothing}
        ${
          !isDefault
            ? html`
                <button
                  class="btn btn--sm"
                  ?disabled=${deleteBusy || showDeleteConfirm}
                  @click=${onSetDefault}
                >
                  设为默认
                </button>
                <button
                  class="btn btn--sm danger"
                  ?disabled=${deleteBusy || showDeleteConfirm}
                  @click=${onShowDelete}
                >
                  Delete
                </button>
              `
            : nothing
        }
      </div>
    </section>
  `;
}

function renderAgentTabs(active: AgentsPanel, onSelect: (panel: AgentsPanel) => void) {
  const tabs: Array<{ id: AgentsPanel; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "files", label: "Files" },
    { id: "tools", label: "Tools" },
    { id: "skills", label: "Skills" },
    { id: "channels", label: "Channels" },
    { id: "cron", label: "Cron Jobs" },
  ];
  return html`
    <div class="agent-tabs">
      ${tabs.map(
        (tab) => html`
          <button
            class="agent-tab ${active === tab.id ? "active" : ""}"
            type="button"
            @click=${() => onSelect(tab.id)}
          >
            ${tab.label}
          </button>
        `,
      )}
    </div>
  `;
}

function renderAgentOverview(params: {
  agent: AgentsListResult["agents"][number];
  defaultId: string | null;
  configForm: Record<string, unknown> | null;
  agentFilesList: AgentsFilesListResult | null;
  agentFileContents: Record<string, string>;
  agentIdentity: AgentIdentityResult | null;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  configSaveSuccess: boolean;
  onConfigReload: () => void;
  onConfigSave: () => void;
  onModelChange: (agentId: string, modelId: string | null) => void;
  onModelFallbacksChange: (agentId: string, fallbacks: string[]) => void;
}) {
  const {
    agent,
    configForm,
    agentFilesList,
    agentFileContents,
    agentIdentity,
    agentIdentityLoading,
    agentIdentityError,
    configLoading,
    configSaving,
    configDirty,
    configSaveSuccess,
    onConfigReload,
    onConfigSave,
    onModelChange,
    onModelFallbacksChange,
  } = params;
  const isDefault = Boolean(params.defaultId && agent.id === params.defaultId);
  const config = resolveAgentConfig(configForm, agent.id);
  const workspaceFromFiles =
    agentFilesList && agentFilesList.agentId === agent.id ? agentFilesList.workspace : null;
  const workspace =
    workspaceFromFiles || config.entry?.workspace || config.defaults?.workspace || "default";
  const defaultModel = resolveModelLabel(config.defaults?.model);
  // Agent's own model primary (null if agent has no per-agent model set)
  const agentOwnPrimary = resolveModelPrimary(config.entry?.model);
  const defaultPrimary =
    resolveModelPrimary(config.defaults?.model) ||
    (defaultModel !== "-" ? normalizeModelValue(defaultModel) : null);
  // For the select value: only use the agent's own setting, not the fallback.
  // Non-default agents with no model set should show "Inherit default" (empty value).
  const effectivePrimary = agentOwnPrimary ?? (isDefault ? defaultPrimary : null);
  const modelFallbacks = resolveEffectiveModelFallbacks(
    config.entry?.model,
    config.defaults?.model,
  );
  // Overview "Primary Model" label: derive from the same effectivePrimary used by the select,
  // so both always show consistent values.
  const fallbackCount = modelFallbacks ? modelFallbacks.length : 0;
  const overviewModelLabel = effectivePrimary
    ? fallbackCount > 0
      ? `${effectivePrimary} (+${fallbackCount} fallback)`
      : effectivePrimary
    : defaultPrimary
      ? fallbackCount > 0
        ? `${defaultPrimary} (+${fallbackCount} fallback) (inherited)`
        : `${defaultPrimary} (inherited)`
      : "-";
  const identityName =
    agentIdentity?.name?.trim() ||
    agent.identity?.name?.trim() ||
    agent.name?.trim() ||
    config.entry?.name ||
    "-";
  const resolvedEmoji = resolveAgentEmoji(agent, agentIdentity);
  const identityEmoji = resolvedEmoji || "-";
  const skillFilter = Array.isArray(config.entry?.skills) ? config.entry?.skills : null;
  const skillCount = skillFilter?.length ?? null;
  const identityStatus = agentIdentityLoading
    ? "Loading…"
    : agentIdentityError
      ? "Unavailable"
      : "";

  return html`
    <section class="card">
      <div class="card-title">Overview</div>
      <div class="card-sub">Workspace paths and identity metadata.</div>
      <div class="agents-overview-grid" style="margin-top: 16px;">
        <div class="agent-kv">
          <div class="label">Workspace</div>
          <div class="mono">${workspace}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Primary Model</div>
          <div class="mono">${overviewModelLabel}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Identity Name</div>
          <div>${identityName}</div>
          ${identityStatus ? html`<div class="agent-kv-sub muted">${identityStatus}</div>` : nothing}
        </div>
        <div class="agent-kv">
          <div class="label">Default</div>
          <div>${isDefault ? "yes" : "no"}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Identity Emoji</div>
          <div>${identityEmoji}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Skills Filter</div>
          <div>${skillFilter ? `${skillCount} selected` : "all skills"}</div>
        </div>
      </div>

      ${renderBridgeConfigSection(agent, agentFilesList, agentFileContents)}

      <div class="agent-model-select" style="margin-top: 20px;">
        <div class="label">Model Selection</div>
        <div class="row" style="gap: 12px; flex-wrap: wrap;">
          <label class="field" style="min-width: 260px; flex: 1;">
            <span>Primary model${isDefault ? " (default)" : ""}</span>
            <select
              .value=${effectivePrimary ?? ""}
              ?disabled=${!configForm || configLoading || configSaving}
              @change=${(e: Event) =>
                onModelChange(agent.id, (e.target as HTMLSelectElement).value || null)}
            >
              ${
                isDefault
                  ? nothing
                  : html`
                      <option value="">
                        ${defaultPrimary ? `Inherit default (${defaultPrimary})` : "Inherit default"}
                      </option>
                    `
              }
              ${buildModelOptions(configForm, effectivePrimary ?? undefined)}
            </select>
          </label>
          ${renderFallbacksDropdown({
            configForm,
            effectivePrimary: effectivePrimary ?? null,
            modelFallbacks: modelFallbacks ?? [],
            disabled: !configForm || configLoading || configSaving,
            onModelFallbacksChange: (fallbacks: string[]) =>
              onModelFallbacksChange(agent.id, fallbacks),
          })}
        </div>
        <div class="row" style="justify-content: flex-end; gap: 8px; align-items: center;">
          ${
            configSaveSuccess
              ? html`
                  <span class="save-toast">Config saved</span>
                `
              : nothing
          }
          <button class="btn btn--sm" ?disabled=${configLoading} @click=${onConfigReload}>
            Reload Config
          </button>
          <button
            class="btn btn--sm primary"
            ?disabled=${configSaving || !configDirty}
            @click=${onConfigSave}
          >
            ${configSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </section>
  `;
}

function renderFallbacksDropdown(params: {
  configForm: Record<string, unknown> | null;
  effectivePrimary: string | null;
  modelFallbacks: string[];
  disabled: boolean;
  onModelFallbacksChange: (fallbacks: string[]) => void;
}) {
  const { configForm, effectivePrimary, modelFallbacks, disabled, onModelFallbacksChange } = params;
  const allModels = resolveConfiguredModels(configForm);
  // Exclude the primary model from fallback options
  const fallbackOptions = allModels.filter((option) => option.value !== effectivePrimary);
  // Also include any currently selected fallbacks that aren't in the configured models list
  const existingValues = new Set(fallbackOptions.map((o) => o.value));
  for (const fb of modelFallbacks) {
    if (!existingValues.has(fb)) {
      fallbackOptions.push({ value: fb, label: fb });
    }
  }
  const selectedCount = modelFallbacks.length;

  const toggleModel = (value: string, checked: boolean) => {
    let next: string[];
    if (checked) {
      next = [...modelFallbacks, value];
    } else {
      next = modelFallbacks.filter((v) => v !== value);
    }
    onModelFallbacksChange(next);
  };

  const selectedSet = new Set(modelFallbacks);

  const onToggle = (e: Event) => {
    const details = e.target as HTMLDetailsElement;
    if (details.open) {
      // Close other open dropdowns
      document.querySelectorAll(".fallback-dropdown[open]").forEach((el) => {
        if (el !== details) {
          (el as HTMLDetailsElement).open = false;
        }
      });
    }
  };

  const allSelected =
    fallbackOptions.length > 0 && fallbackOptions.every((opt) => selectedSet.has(opt.value));

  const toggleSelectAll = () => {
    if (allSelected) {
      // Deselect all
      onModelFallbacksChange([]);
    } else {
      // Select all
      onModelFallbacksChange(fallbackOptions.map((opt) => opt.value));
    }
  };

  // Close dropdown when clicking outside
  const onClickOutside = (e: Event) => {
    const details = (e.currentTarget as HTMLElement).querySelector(
      ".fallback-dropdown",
    ) as HTMLDetailsElement;
    if (!details) {
      return;
    }
    const target = e.target as HTMLElement;
    if (!details.contains(target)) {
      details.open = false;
    }
  };

  return html`
    <div class="field fallback-field" style="min-width: 260px; flex: 1;" @click=${onClickOutside}>
      <span>Fallbacks${selectedCount > 0 ? ` (${selectedCount})` : ""}</span>
      <details class="fallback-dropdown" ?disabled=${disabled} @toggle=${onToggle}>
        <summary class="fallback-dropdown__trigger">
          <span class="fallback-dropdown__text">
            ${
              selectedCount === 0
                ? "No fallback models"
                : selectedCount === 1
                  ? modelFallbacks[0]
                  : `${modelFallbacks[0]} +${selectedCount - 1} more`
            }
          </span>
          <svg class="fallback-dropdown__arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </summary>
        <div class="fallback-dropdown__panel">
          ${
            fallbackOptions.length === 0
              ? html`
                  <div class="muted" style="padding: 10px 12px; font-size: 13px">No other models available.</div>
                `
              : html`
                  <div class="fallback-dropdown__header">
                    <label class="fallback-dropdown__option fallback-dropdown__select-all">
                      <input
                        type="checkbox"
                        .checked=${allSelected}
                        @change=${toggleSelectAll}
                      />
                      <span class="fallback-dropdown__option-label">Select All</span>
                    </label>
                  </div>
                  <div class="fallback-dropdown__list">
                    ${fallbackOptions.map(
                      (option) => html`
                        <label class="fallback-dropdown__option ${selectedSet.has(option.value) ? "selected" : ""}">
                          <input
                            type="checkbox"
                            .checked=${selectedSet.has(option.value)}
                            @change=${(e: Event) =>
                              toggleModel(option.value, (e.target as HTMLInputElement).checked)}
                          />
                          <span class="fallback-dropdown__option-label">${option.label}</span>
                        </label>
                      `,
                    )}
                  </div>
                `
          }
        </div>
      </details>
    </div>
  `;
}

function renderCreateAgentDialog(props: AgentsProps) {
  const { createForm, createBusy, createError } = props;
  const nameIsValidId = AGENT_ID_PATTERN.test(createForm.name);
  const agentIdValue = createForm.agentId || (nameIsValidId ? createForm.name : "");
  const canSubmit =
    createForm.name.trim().length > 0 &&
    createForm.workspace.trim().length > 0 &&
    agentIdValue.trim().length > 0 &&
    AGENT_ID_PATTERN.test(agentIdValue.trim());
  return html`
    <div class="dialog-overlay" @click=${props.onHideCreateDialog}>
      <div class="dialog-card" @click=${(e: Event) => e.stopPropagation()}>
        <div class="card-title">Create Agent</div>
        <div class="card-sub">Add a new agent with its own workspace and identity.</div>
        ${createError ? html`<div class="callout danger" style="margin-top: 8px;">${createError}</div>` : nothing}
        <div class="dialog-form">
          <label class="field">
            <span>Name <span class="required">*</span></span>
            <input
              type="text"
              .value=${createForm.name}
              placeholder="e.g. researcher"
              ?disabled=${createBusy}
              @input=${(e: Event) => props.onCreateFormChange("name", (e.target as HTMLInputElement).value)}
            />
          </label>
          <label class="field">
            <span>Agent ID <span class="required">*</span></span>
            <input
              type="text"
              .value=${createForm.agentId || (nameIsValidId ? createForm.name : "")}
              placeholder="e.g. researcher"
              ?disabled=${createBusy}
              @input=${(e: Event) => props.onCreateFormChange("agentId", (e.target as HTMLInputElement).value)}
            />
            ${
              !nameIsValidId && createForm.name.trim().length > 0
                ? html`
                    <span class="field-hint" style="color: var(--warning)"
                      >⚠️ Agent 名称包含特殊字符，请手动指定 Agent ID（仅限字母、数字、下划线）</span
                    >
                  `
                : html`
                    <span class="field-hint">仅限字母、数字、下划线 [a-zA-Z0-9_]</span>
                  `
            }
          </label>
          <label class="field">
            <span>Workspace Path <span class="required">*</span></span>
            <input
              type="text"
              .value=${createForm.workspace}
              placeholder="e.g. ~/agents/researcher"
              ?disabled=${createBusy}
              @input=${(e: Event) => props.onCreateFormChange("workspace", (e.target as HTMLInputElement).value)}
            />
          </label>
          <label class="field">
            <span>Emoji (optional)</span>
            <input
              type="text"
              .value=${createForm.emoji}
              placeholder="e.g. \uD83D\uDD2C"
              ?disabled=${createBusy}
              @input=${(e: Event) => props.onCreateFormChange("emoji", (e.target as HTMLInputElement).value)}
            />
          </label>
        </div>
        <div class="row" style="justify-content: flex-end; gap: 8px; margin-top: 16px;">
          <button class="btn btn--sm" ?disabled=${createBusy} @click=${props.onHideCreateDialog}>
            Cancel
          </button>
          <button
            class="btn btn--sm primary"
            ?disabled=${!canSubmit || createBusy}
            @click=${props.onCreateAgent}
          >
            ${createBusy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderCreateCliAgentDialog(props: AgentsProps) {
  const { cliCreateForm, cliCreateBusy, cliCreateError } = props;
  const nameIsValidId = AGENT_ID_PATTERN.test(cliCreateForm.name);
  const agentIdValue = cliCreateForm.agentId || (nameIsValidId ? cliCreateForm.name : "");
  // Resolve default workspace from config (agents.defaults.workspace)
  const cfgAny = props.configForm as { agents?: { defaults?: { workspace?: string } } } | null;
  const defaultWorkspace = cfgAny?.agents?.defaults?.workspace || "";
  const effectiveWorkspace = cliCreateForm.workspace || defaultWorkspace;
  const canSubmit =
    cliCreateForm.name.trim().length > 0 &&
    cliCreateForm.command.trim().length > 0 &&
    effectiveWorkspace.trim().length > 0 &&
    agentIdValue.trim().length > 0 &&
    AGENT_ID_PATTERN.test(agentIdValue.trim());
  const cliTypes: Array<{ value: CliType; label: string }> = [
    { value: "claude-code", label: "Claude Code" },
    { value: "opencode", label: "OpenCode" },
    { value: "codebuddy", label: "CodeBuddy" },
    { value: "custom", label: "Custom" },
  ];
  return html`
    <div class="dialog-overlay" @click=${props.onHideCliCreateDialog}>
      <div class="dialog-card dialog-card--wide" @click=${(e: Event) => e.stopPropagation()}>
        <div class="card-title">添加 CLI Agent</div>
        <div class="card-sub">添加外部 CLI 编码工具作为 Agent，可在群聊中使用。</div>
        ${cliCreateError ? html`<div class="callout danger" style="margin-top: 8px;">${cliCreateError}</div>` : nothing}
        <div class="dialog-form" style="max-height: 60vh; overflow-y: auto;">
          <!-- CLI Type -->
          <label class="field">
            <span>CLI 类型 <span class="required">*</span></span>
            <select
              .value=${cliCreateForm.cliType}
              ?disabled=${cliCreateBusy}
              @change=${(e: Event) => props.onCliTypeChange((e.target as HTMLSelectElement).value as CliType)}
            >
              ${cliTypes.map(
                (t) =>
                  html`<option value=${t.value} ?selected=${t.value === cliCreateForm.cliType}>${t.label}</option>`,
              )}
            </select>
          </label>

          <!-- Agent Name -->
          <label class="field">
            <span>Agent 名称 <span class="required">*</span></span>
            <input
              type="text"
              .value=${cliCreateForm.name}
              placeholder="e.g. claude-code"
              ?disabled=${cliCreateBusy}
              @input=${(e: Event) => props.onCliCreateFormChange("name", (e.target as HTMLInputElement).value)}
            />
            <span class="field-hint">用于 @mention 的标识符</span>
          </label>

          <!-- Agent ID -->
          <label class="field">
            <span>Agent ID <span class="required">*</span></span>
            <input
              type="text"
              .value=${cliCreateForm.agentId || (nameIsValidId ? cliCreateForm.name : "")}
              placeholder="e.g. claude_code"
              ?disabled=${cliCreateBusy}
              @input=${(e: Event) => props.onCliCreateFormChange("agentId", (e.target as HTMLInputElement).value)}
            />
            ${
              !nameIsValidId && cliCreateForm.name.trim().length > 0
                ? html`
                    <span class="field-hint" style="color: var(--warning)"
                      >⚠️ Agent 名称包含特殊字符，请手动指定 Agent ID（仅限字母、数字、下划线）</span
                    >
                  `
                : html`
                    <span class="field-hint">仅限字母、数字、下划线 [a-zA-Z0-9_]，用作系统标识符和目录名</span>
                  `
            }
          </label>

          <!-- Command -->
          <label class="field">
            <span>启动命令 <span class="required">*</span></span>
            <input
              type="text"
              .value=${cliCreateForm.command}
              placeholder="e.g. claude"
              ?disabled=${cliCreateBusy}
              @input=${(e: Event) => props.onCliCreateFormChange("command", (e.target as HTMLInputElement).value)}
            />
            <span class="field-hint">CLI 可执行文件路径或命令名</span>
          </label>

          <!-- Emoji -->
          <label class="field">
            <span>图标</span>
            <input
              type="text"
              .value=${cliCreateForm.emoji}
              placeholder="🔧"
              style="max-width: 120px;"
              ?disabled=${cliCreateBusy}
              @input=${(e: Event) => props.onCliCreateFormChange("emoji", (e.target as HTMLInputElement).value)}
            />
          </label>

          <!-- Args -->
          <label class="field">
            <span>启动参数</span>
            <input
              type="text"
              .value=${cliCreateForm.args}
              placeholder="e.g. --verbose --no-confirm"
              ?disabled=${cliCreateBusy}
              @input=${(e: Event) => props.onCliCreateFormChange("args", (e.target as HTMLInputElement).value)}
            />
            <span class="field-hint">额外的命令行参数（空格分隔）</span>
          </label>

          <!-- Workspace -->
          <label class="field">
            <span>工作空间 <span class="required">*</span></span>
            <input
              type="text"
              .value=${effectiveWorkspace}
              placeholder="e.g. /home/user/project"
              ?disabled=${cliCreateBusy}
              @input=${(e: Event) => props.onCliCreateFormChange("workspace", (e.target as HTMLInputElement).value)}
            />
            <span class="field-hint">CLI 启动时的工作目录（也是 Agent 工作空间）${!cliCreateForm.workspace && defaultWorkspace ? "（已自动填入默认值）" : ""}</span>
          </label>

          <!-- Environment Variables -->
          <div class="field">
            <span>环境变量</span>
            <div class="env-vars-list">
              ${cliCreateForm.env.map(
                (envVar, index) => html`
                  <div class="row env-var-row" style="gap: 8px; margin-bottom: 4px;">
                    <input
                      type="text"
                      .value=${envVar.key}
                      placeholder="KEY"
                      style="flex: 1;"
                      ?disabled=${cliCreateBusy}
                      @input=${(e: Event) => props.onCliEnvChange(index, "key", (e.target as HTMLInputElement).value)}
                    />
                    <span style="color: var(--muted); line-height: 32px;">=</span>
                    <input
                      type="text"
                      .value=${envVar.value}
                      placeholder="value"
                      style="flex: 2;"
                      ?disabled=${cliCreateBusy}
                      @input=${(e: Event) => props.onCliEnvChange(index, "value", (e.target as HTMLInputElement).value)}
                    />
                    <button
                      class="btn btn--sm danger"
                      ?disabled=${cliCreateBusy}
                      @click=${() => props.onCliEnvRemove(index)}
                    >✕</button>
                  </div>
                `,
              )}
              <button
                class="btn btn--sm"
                ?disabled=${cliCreateBusy}
                @click=${props.onCliEnvAdd}
                style="margin-top: 4px;"
              >+ 添加环境变量</button>
            </div>
          </div>

          <!-- Timeout -->
          <div class="row" style="gap: 12px;">
            <label class="field" style="flex: 1;">
              <span>单次回复超时</span>
              <div class="row" style="gap: 6px; align-items: center;">
                <input
                  type="number"
                  .value=${String(cliCreateForm.timeout)}
                  min="30"
                  max="1800"
                  style="flex: 1;"
                  ?disabled=${cliCreateBusy}
                  @input=${(e: Event) => props.onCliCreateFormChange("timeout", Number((e.target as HTMLInputElement).value))}
                />
                <span class="muted">秒</span>
              </div>
            </label>
            <label class="field" style="flex: 1;">
              <span>空闲回收时间</span>
              <div class="row" style="gap: 6px; align-items: center;">
                <input
                  type="number"
                  .value=${String(cliCreateForm.idleTimeout)}
                  min="60"
                  max="3600"
                  style="flex: 1;"
                  ?disabled=${cliCreateBusy}
                  @input=${(e: Event) => props.onCliCreateFormChange("idleTimeout", Number((e.target as HTMLInputElement).value))}
                />
                <span class="muted">秒</span>
              </div>
            </label>
          </div>
        </div>
        <div class="row" style="justify-content: flex-end; gap: 8px; margin-top: 16px;">
          <button class="btn btn--sm" ?disabled=${cliCreateBusy} @click=${props.onHideCliCreateDialog}>
            取消
          </button>
          <button
            class="btn btn--sm primary"
            ?disabled=${!canSubmit || cliCreateBusy}
            @click=${props.onCreateCliAgent}
          >
            ${cliCreateBusy ? "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderDeleteConfirmOverlay(props: AgentsProps) {
  const agentId = props.showDeleteConfirm;
  if (!agentId) {
    return nothing;
  }
  return html`
    <div class="dialog-overlay" @click=${props.onHideDeleteConfirm}>
      <div class="dialog-card" @click=${(e: Event) => e.stopPropagation()}>
        <div class="card-title">Delete Agent</div>
        <div class="card-sub">
          Are you sure you want to delete agent <strong>${agentId}</strong>?
          This will also remove workspace files and session transcripts.
        </div>
        ${props.deleteError ? html`<div class="callout danger" style="margin-top: 8px;">${props.deleteError}</div>` : nothing}
        <div class="row" style="justify-content: flex-end; gap: 8px; margin-top: 16px;">
          <button class="btn btn--sm" ?disabled=${props.deleteBusy} @click=${props.onHideDeleteConfirm}>
            Cancel
          </button>
          <button
            class="btn btn--sm danger"
            ?disabled=${props.deleteBusy}
            @click=${() => props.onDeleteAgent(agentId)}
          >
            ${props.deleteBusy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  `;
}
