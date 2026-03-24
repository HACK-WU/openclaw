import type { GatewayBrowserClient } from "../gateway.ts";
import type { AgentsListResult, SessionsListResult, ToolsCatalogResult } from "../types.ts";
import type {
  AgentCreateForm,
  CliAgentCreateForm,
  CliAgentsListResult,
  CliTestResult,
  CliType,
} from "../views/agents.ts";
import type { ConfigState } from "./config.ts";
import { saveConfig } from "./config.ts";

/**
 * Check if an agent is referenced in any session.
 * Returns true if the agent can be deleted (not referenced).
 */
export async function checkAgentCanBeDeleted(
  client: GatewayBrowserClient,
  agentId: string,
): Promise<{ canDelete: boolean; reason?: string }> {
  const normalizedAgentId = agentId.toLowerCase();

  try {
    // 并行获取 session 列表和群聊列表
    const [sessionsRes, groupListRes] = await Promise.all([
      client.request<SessionsListResult>("sessions.list", {
        includeGlobal: true,
        includeUnknown: true,
      }),
      client.request<Array<{ groupId: string; name?: string }>>("group.list", {}).catch(() => null),
    ]);

    const sessions = sessionsRes?.sessions ?? [];

    // 构建 groupId → groupName 映射
    const groupNameMap = new Map<string, string>();
    if (Array.isArray(groupListRes)) {
      for (const g of groupListRes) {
        if (g.groupId && g.name) {
          groupNameMap.set(g.groupId.toLowerCase(), g.name);
        }
      }
    }

    // Check if any session key contains the agentId
    for (const session of sessions) {
      const key = (session.key ?? "").toLowerCase();
      // Fuzzy match: check if agentId appears anywhere in the session key
      if (key.includes(normalizedAgentId)) {
        const isGroup = session.kind === "group" || key.includes(":group:");

        if (isGroup) {
          // 从 key 中提取 groupId（格式: ...group:<groupId>... 或 ...group:<groupId>:<agentId>）
          const groupIdMatch = key.match(/:group:([^:]+)/)?.[1] ?? session.groupId;
          const groupName = groupIdMatch ? groupNameMap.get(groupIdMatch.toLowerCase()) : undefined;
          // 群聊：优先显示名称，没有则显示群聊 ID 前 8 位
          const groupLabel = groupName || (groupIdMatch ? groupIdMatch.slice(0, 8) : session.key);
          return {
            canDelete: false,
            reason: `无法删除：该 Agent 被群聊 "${groupLabel}" 引用，请先解散该群聊后再试`,
          };
        }

        // 普通对话：优先显示标题，没有则显示 session key
        const directLabel = session.label || session.displayName || session.key;
        return {
          canDelete: false,
          reason: `无法删除：该 Agent 被对话 "${directLabel}" 引用，请先删除该对话后再试`,
        };
      }
    }

    return { canDelete: true };
  } catch (err) {
    return {
      canDelete: false,
      reason: `检查引用失败: ${String(err)}`,
    };
  }
}

export type AgentsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  agentsLoading: boolean;
  agentsError: string | null;
  agentsList: AgentsListResult | null;
  agentsSelectedId: string | null;
  toolsCatalogLoading: boolean;
  toolsCatalogError: string | null;
  toolsCatalogResult: ToolsCatalogResult | null;
  // Agent create state
  agentCreateBusy?: boolean;
  agentCreateError?: string | null;
  agentCreateForm?: AgentCreateForm;
  agentDeleteBusy?: boolean;
  agentDeleteError?: string | null;
  // CLI Agent create state
  agentCliCreateBusy?: boolean;
  agentCliCreateError?: string | null;
  agentCliCreateForm?: CliAgentCreateForm;
  agentShowCliCreateDialog?: boolean;
  agentShowAddMenu?: boolean;
  // CLI Agents list state
  cliAgentsList?: CliAgentsListResult | null;
  cliAgentsLoading?: boolean;
  cliAgentsError?: string | null;
  // CLI Agent edit state
  agentCliEditBusy?: boolean;
  agentCliEditError?: string | null;
  agentCliEditAgentId?: string | null;
  agentShowCliEditDialog?: boolean;
  // CLI Agent test state
  cliTestRunning?: boolean;
  cliTestResult?: CliTestResult | null;
  cliTestTerminalOpen?: boolean;
  cliTestTerminalData?: string[];
  // Personalities state
  personalitiesList?: Array<{
    id: string;
    name: string;
    label: string;
    description: string;
  }>;
  personalitiesLoading?: boolean;
  personalitiesError?: string | null;
  selectedPersonalityId?: string | null;
  personalityViewDialog?: {
    open: boolean;
    personality: {
      id: string;
      name: string;
      label: string;
      description: string;
      content: string;
    } | null;
  };
};

export type AgentsConfigSaveState = AgentsState & ConfigState;

export async function loadAgents(state: AgentsState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.agentsLoading) {
    return;
  }
  state.agentsLoading = true;
  state.agentsError = null;
  try {
    const res = await state.client.request<AgentsListResult>("agents.list", {});
    if (res) {
      state.agentsList = res;
      const selected = state.agentsSelectedId;
      const known = res.agents.some((entry) => entry.id === selected);
      if (!selected || !known) {
        state.agentsSelectedId = res.defaultId ?? res.agents[0]?.id ?? null;
      }
    }
  } catch (err) {
    state.agentsError = String(err);
  } finally {
    state.agentsLoading = false;
  }
}

export async function loadToolsCatalog(state: AgentsState, agentId?: string | null) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.toolsCatalogLoading) {
    return;
  }
  state.toolsCatalogLoading = true;
  state.toolsCatalogError = null;
  try {
    const res = await state.client.request<ToolsCatalogResult>("tools.catalog", {
      agentId: agentId ?? state.agentsSelectedId ?? undefined,
      includePlugins: true,
    });
    if (res) {
      state.toolsCatalogResult = res;
    }
  } catch (err) {
    state.toolsCatalogError = String(err);
  } finally {
    state.toolsCatalogLoading = false;
  }
}

export type CreateAgentParams = {
  name: string;
  agentId?: string;
  workspace: string;
  emoji?: string;
  personalityId?: string | null;
};

export async function createAgent(state: AgentsState, params: CreateAgentParams): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  state.agentCreateBusy = true;
  state.agentCreateError = null;
  try {
    const res = await state.client.request<{ ok: boolean; agentId: string }>("agents.create", {
      name: params.name,
      ...(params.agentId?.trim() ? { agentId: params.agentId.trim() } : {}),
      workspace: params.workspace,
      ...(params.emoji ? { emoji: params.emoji } : {}),
      ...(params.personalityId ? { personalityId: params.personalityId } : {}),
    });
    if (res?.ok) {
      await loadAgents(state);
      state.agentsSelectedId = res.agentId;
      return true;
    }
    return false;
  } catch (err) {
    state.agentCreateError = String(err);
    return false;
  } finally {
    state.agentCreateBusy = false;
  }
}

export async function deleteAgent(
  state: AgentsState,
  agentId: string,
  deleteFiles = true,
): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  state.agentDeleteBusy = true;
  state.agentDeleteError = null;
  try {
    const res = await state.client.request<{ ok: boolean }>("agents.delete", {
      agentId,
      deleteFiles,
    });
    if (res?.ok) {
      await loadAgents(state);
      return true;
    }
    return false;
  } catch (err) {
    state.agentDeleteError = String(err);
    return false;
  } finally {
    state.agentDeleteBusy = false;
  }
}

export async function setDefaultAgent(state: AgentsState, agentId: string): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  try {
    const res = await state.client.request<{ ok: boolean }>("agents.setDefault", {
      agentId,
    });
    return res?.ok ?? false;
  } catch {
    return false;
  }
}

export async function saveAgentsConfig(state: AgentsConfigSaveState) {
  const selectedBefore = state.agentsSelectedId;
  await saveConfig(state);
  await loadAgents(state);
  if (selectedBefore && state.agentsList?.agents.some((entry) => entry.id === selectedBefore)) {
    state.agentsSelectedId = selectedBefore;
  }
}

export type PathValidationResult = {
  valid: boolean;
  exists: boolean;
  isDirectory: boolean;
  isRestricted: boolean;
  needsCreation: boolean;
  error?: string;
  warning?: string;
};

export async function checkWorkspacePath(
  state: AgentsState,
  path: string,
): Promise<PathValidationResult | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  try {
    const res = await state.client.request<PathValidationResult>("agents.checkWorkspacePath", {
      path,
    });
    return res ?? null;
  } catch {
    return null;
  }
}

export async function getDefaultWorkspacePath(state: AgentsState, name?: string): Promise<string> {
  if (!state.client || !state.connected) {
    return "";
  }
  try {
    const res = await state.client.request<{ path: string }>("agents.getDefaultWorkspacePath", {
      name,
    });
    return res?.path ?? "";
  } catch {
    return "";
  }
}

export type CliAgentCreateParams = CliAgentCreateForm;

/**
 * Load CLI Agents from the independent `cliAgents.list` RPC endpoint.
 */
export async function loadCliAgents(state: AgentsState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.cliAgentsLoading) {
    return;
  }
  state.cliAgentsLoading = true;
  state.cliAgentsError = null;
  try {
    const res = await state.client.request<CliAgentsListResult>("cliAgents.list", {});
    if (res) {
      state.cliAgentsList = res;
    }
  } catch (err) {
    state.cliAgentsError = String(err);
  } finally {
    state.cliAgentsLoading = false;
  }
}

/**
 * Create a CLI Agent via the `cliAgents.create` RPC endpoint.
 * Single API call — the backend handles bridge.json + workspace files.
 */
export async function createCliAgent(
  state: AgentsState,
  params: CliAgentCreateParams,
): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  state.agentCliCreateBusy = true;
  state.agentCliCreateError = null;
  try {
    // Build env object from the form's key-value array
    const envObj: Record<string, string> = {};
    for (const e of params.env) {
      if (e.key.trim()) {
        envObj[e.key.trim()] = e.value;
      }
    }

    // Resolve the effective agentId
    const AGENT_ID_PATTERN = /^[a-zA-Z0-9_]+$/;
    const nameIsValidId = AGENT_ID_PATTERN.test(params.name);
    const effectiveAgentId = params.agentId?.trim() || (nameIsValidId ? params.name : "");

    const res = await state.client.request<{ ok: boolean; agentId: string }>("cliAgents.create", {
      agentId: effectiveAgentId,
      name: params.name,
      cliType: params.cliType,
      command: params.command,
      ...(params.args.trim() ? { args: params.args.trim().split(/\s+/) } : {}),
      cwd: params.workspace || undefined,
      ...(Object.keys(envObj).length > 0 ? { env: envObj } : {}),
      timeout: params.timeout * 1000, // convert seconds to ms
      emoji: params.emoji || "🔧",
      tailTrimMarker: params.tailTrimMarker || undefined,
      personalityId: params.personalityId || undefined,
    });

    if (res?.ok) {
      await loadCliAgents(state);
      state.agentsSelectedId = res.agentId;
      return true;
    }
    state.agentCliCreateError = "Failed to create CLI Agent";
    return false;
  } catch (err) {
    state.agentCliCreateError = String(err);
    return false;
  } finally {
    state.agentCliCreateBusy = false;
  }
}

/**
 * Delete a CLI Agent via `cliAgents.delete` RPC.
 */
export async function deleteCliAgent(state: AgentsState, agentId: string): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  state.agentDeleteBusy = true;
  state.agentDeleteError = null;
  try {
    const res = await state.client.request<{ ok: boolean }>("cliAgents.delete", {
      agentId,
    });
    if (res?.ok) {
      await loadCliAgents(state);
      // If the deleted agent was selected, clear selection
      if (state.agentsSelectedId === agentId) {
        const cliAgents = state.cliAgentsList?.agents ?? [];
        const generalAgents = state.agentsList?.agents ?? [];
        state.agentsSelectedId = generalAgents[0]?.id ?? cliAgents[0]?.id ?? null;
      }
      return true;
    }
    return false;
  } catch (err) {
    state.agentDeleteError = String(err);
    return false;
  } finally {
    state.agentDeleteBusy = false;
  }
}

/**
 * Test a CLI Agent via `cliAgents.test` RPC.
 */
export async function testCliAgent(state: AgentsState, agentId: string): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  state.cliTestRunning = true;
  state.cliTestResult = null;
  try {
    const res = await state.client.request<CliTestResult>("cliAgents.test", {
      agentId,
    });
    if (res) {
      state.cliTestResult = res;
    }
  } catch (err) {
    state.cliTestResult = {
      ok: false,
      agentId,
      checks: [{ name: "request", ok: false, message: String(err) }],
    };
  } finally {
    state.cliTestRunning = false;
  }
}

/**
 * Stop a CLI Agent test via `cliAgents.testStop` RPC.
 */
export async function stopCliAgentTest(state: AgentsState, agentId: string): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("cliAgents.testStop", { agentId });
  } catch {
    // Best-effort stop
  }
  state.cliTestRunning = false;
}

/**
 * Send input text to a running CLI Agent test PTY.
 */
export async function sendTestInput(
  state: AgentsState,
  agentId: string,
  input: string,
): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    await state.client.request("cliAgents.testSendInput", { agentId, input });
  } catch {
    // Best-effort
  }
}

/**
 * Show CLI Agent edit dialog and load current config into the form.
 */
export function showCliEditDialog(state: AgentsState, agentId: string): void {
  const agent = state.cliAgentsList?.agents.find((a) => a.id === agentId);
  if (!agent) {
    state.agentCliEditError = `CLI Agent "${agentId}" not found`;
    return;
  }

  // Load current config into the create form (reuse the same form state)
  state.agentCliCreateForm = {
    name: agent.name,
    agentId: agent.id,
    workspace: agent.cwd || "",
    emoji: agent.emoji || "🔧",
    cliType: agent.type as CliType,
    command: agent.command,
    args: Array.isArray(agent.args) ? agent.args.join(" ") : "",
    env: agent.env ? Object.entries(agent.env).map(([key, value]) => ({ key, value })) : [],
    timeout: agent.timeout ? Math.round(agent.timeout / 1000) : 300,
    idleTimeout: 600, // Default value
    tailTrimMarker: agent.tailTrimMarker || "",
    personalityId: (agent as { personalityId?: string }).personalityId || null,
  };

  state.agentCliEditAgentId = agentId;
  state.agentShowCliEditDialog = true;
  state.agentCliEditError = null;
}

/**
 * Hide CLI Agent edit dialog.
 */
export function hideCliEditDialog(state: AgentsState): void {
  state.agentShowCliEditDialog = false;
}

/**
 * Update CLI Agent configuration via `cliAgents.update` RPC.
 */
export async function updateCliAgent(state: AgentsState): Promise<boolean> {
  if (!state.client || !state.connected || !state.agentCliEditAgentId) {
    return false;
  }

  state.agentCliEditBusy = true;
  state.agentCliEditError = null;

  try {
    const cliCreateForm = state.agentCliCreateForm;
    const agentCliEditAgentId = state.agentCliEditAgentId;

    if (!cliCreateForm) {
      state.agentCliEditError = "Form not initialized";
      return false;
    }

    // Build env object from the form's key-value array
    const envObj: Record<string, string> = {};
    for (const e of cliCreateForm.env) {
      if (e.key.trim()) {
        envObj[e.key.trim()] = e.value;
      }
    }

    await state.client.request("cliAgents.update", {
      agentId: agentCliEditAgentId,
      name: cliCreateForm.name,
      command: cliCreateForm.command,
      args: cliCreateForm.args.trim() ? cliCreateForm.args.trim().split(/\s+/) : undefined,
      cwd: cliCreateForm.workspace || undefined,
      env: Object.keys(envObj).length > 0 ? envObj : undefined,
      timeout: cliCreateForm.timeout * 1000,
      emoji: cliCreateForm.emoji || "🔧",
      tailTrimMarker: cliCreateForm.tailTrimMarker || undefined,
      personalityId: cliCreateForm.personalityId || undefined,
    });

    await loadCliAgents(state);
    return true;
  } catch (err) {
    state.agentCliEditError = String(err);
    return false;
  } finally {
    state.agentCliEditBusy = false;
  }
}

// ─── Personalities ───

export type PersonalityMeta = {
  id: string;
  name: string;
  label: string;
  description: string;
};

export type Personality = PersonalityMeta & {
  content: string;
};

/**
 * Load available personalities from the backend.
 */
export async function loadPersonalities(state: AgentsState): Promise<void> {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.personalitiesLoading) {
    return;
  }
  state.personalitiesLoading = true;
  state.personalitiesError = null;
  try {
    const res = await state.client.request<{ personalities: PersonalityMeta[] }>(
      "personalities.list",
      {},
    );
    if (res) {
      state.personalitiesList = res.personalities;
    }
  } catch (err) {
    state.personalitiesError = String(err);
  } finally {
    state.personalitiesLoading = false;
  }
}

/**
 * Get a specific personality by ID (for viewing details).
 */
export async function getPersonality(state: AgentsState, id: string): Promise<Personality | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  try {
    const res = await state.client.request<{ personality: Personality }>("personalities.get", {
      id,
    });
    return res?.personality ?? null;
  } catch {
    return null;
  }
}

/**
 * Open the personality view dialog.
 */
export async function openPersonalityViewDialog(state: AgentsState, id: string): Promise<void> {
  const personality = await getPersonality(state, id);
  state.personalityViewDialog = {
    open: true,
    personality,
  };
}

/**
 * Close the personality view dialog.
 */
export function closePersonalityViewDialog(state: AgentsState): void {
  state.personalityViewDialog = {
    open: false,
    personality: null,
  };
}

/**
 * Select a personality for the Agent create form (both regular and CLI).
 */
export function selectPersonality(state: AgentsState, id: string | null): void {
  state.selectedPersonalityId = id;
  // Update CLI Agent create form
  if (state.agentCliCreateForm) {
    state.agentCliCreateForm = {
      ...state.agentCliCreateForm,
      personalityId: id,
    };
  }
  // Update regular Agent create form
  if (state.agentCreateForm) {
    state.agentCreateForm = {
      ...state.agentCreateForm,
      personalityId: id,
    };
  }
}
