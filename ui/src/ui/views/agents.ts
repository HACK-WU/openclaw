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
  parseFallbackList,
  resolveAgentConfig,
  resolveAgentEmoji,
  resolveEffectiveModelFallbacks,
  resolveModelLabel,
  resolveModelPrimary,
} from "./agents-utils.ts";

export type AgentsPanel = "overview" | "files" | "tools" | "skills" | "channels" | "cron";

export type AgentCreateForm = {
  name: string;
  workspace: string;
  emoji: string;
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

export function renderAgents(props: AgentsProps) {
  const agents = props.agentsList?.agents ?? [];
  const defaultId = props.agentsList?.defaultId ?? null;
  const selectedId = props.selectedAgentId ?? defaultId ?? agents[0]?.id ?? null;
  const selectedAgent = selectedId
    ? (agents.find((agent) => agent.id === selectedId) ?? null)
    : null;
  const isDefault = Boolean(defaultId && selectedId === defaultId);

  return html`
    <div class="agents-layout">
      <section class="card agents-sidebar">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">Agents</div>
            <div class="card-sub">${agents.length} configured.</div>
          </div>
          <div class="row" style="gap: 6px;">
            <button class="btn btn--sm" ?disabled=${props.loading} @click=${props.onRefresh}>
              ${props.loading ? "Loading…" : "Refresh"}
            </button>
            <button class="btn btn--sm primary" @click=${props.onShowCreateDialog}>+ Add</button>
          </div>
        </div>
        ${
          props.error
            ? html`<div class="callout danger" style="margin-top: 12px;">${props.error}</div>`
            : nothing
        }
        <div class="agent-list" style="margin-top: 12px;">
          ${
            agents.length === 0
              ? html`
                  <div class="muted">No agents found.</div>
                `
              : agents.map((agent) => {
                  const badge = agentBadgeText(agent.id, defaultId);
                  const emoji = resolveAgentEmoji(agent, props.agentIdentityById[agent.id] ?? null);
                  return html`
                    <button
                      type="button"
                      class="agent-row ${selectedId === agent.id ? "active" : ""}"
                      @click=${() => props.onSelectAgent(agent.id)}
                    >
                      <div class="agent-avatar">${emoji || normalizeAgentLabel(agent).slice(0, 1)}</div>
                      <div class="agent-info">
                        <div class="agent-title">${normalizeAgentLabel(agent)}</div>
                        <div class="agent-sub mono">${agent.id}</div>
                      </div>
                      ${badge ? html`<span class="agent-pill">${badge}</span>` : nothing}
                    </button>
                  `;
                })
          }
        </div>
      </section>
      <section class="agents-main">
        ${
          !selectedAgent
            ? html`
                <div class="card">
                  <div class="card-title">Select an agent</div>
                  <div class="card-sub">Pick an agent to inspect its workspace and tools.</div>
                </div>
              `
            : html`
                ${renderAgentHeader(
                  selectedAgent,
                  defaultId,
                  props.agentIdentityById[selectedAgent.id] ?? null,
                  isDefault,
                  props.deleteBusy,
                  props.showDeleteConfirm === selectedAgent.id,
                  () => props.onShowDeleteConfirm(selectedAgent.id),
                  () => props.onHideDeleteConfirm(),
                  () => props.onDeleteAgent(selectedAgent.id),
                  () => props.onSetDefaultAgent(selectedAgent.id),
                )}
                ${
                  props.deleteError && props.showDeleteConfirm === selectedAgent.id
                    ? html`<div class="callout danger" style="margin-top: -8px;">${props.deleteError}</div>`
                    : nothing
                }
                ${renderAgentTabs(props.activePanel, (panel) => props.onSelectPanel(panel))}
                ${
                  props.activePanel === "overview"
                    ? renderAgentOverview({
                        agent: selectedAgent,
                        defaultId,
                        configForm: props.configForm,
                        agentFilesList: props.agentFilesList,
                        agentIdentity: props.agentIdentityById[selectedAgent.id] ?? null,
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
                        agentId: selectedAgent.id,
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
                        agentId: selectedAgent.id,
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
                        agentId: selectedAgent.id,
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
                          selectedAgent,
                          props.configForm,
                          props.agentFilesList,
                          defaultId,
                          props.agentIdentityById[selectedAgent.id] ?? null,
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
                          selectedAgent,
                          props.configForm,
                          props.agentFilesList,
                          defaultId,
                          props.agentIdentityById[selectedAgent.id] ?? null,
                        ),
                        agentId: selectedAgent.id,
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
    ${props.showDeleteConfirm ? renderDeleteConfirmOverlay(props) : nothing}
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
  const fallbackText = modelFallbacks ? modelFallbacks.join(", ") : "";
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
          <label class="field" style="min-width: 260px; flex: 1;">
            <span>Fallbacks (comma-separated)</span>
            <input
              .value=${fallbackText}
              ?disabled=${!configForm || configLoading || configSaving}
              placeholder="provider/model, provider/model"
              @input=${(e: Event) =>
                onModelFallbacksChange(
                  agent.id,
                  parseFallbackList((e.target as HTMLInputElement).value),
                )}
            />
          </label>
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

function renderCreateAgentDialog(props: AgentsProps) {
  const { createForm, createBusy, createError } = props;
  const canSubmit = createForm.name.trim().length > 0 && createForm.workspace.trim().length > 0;
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
