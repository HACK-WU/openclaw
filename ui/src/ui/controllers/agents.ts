import type { GatewayBrowserClient } from "../gateway.ts";
import type { AgentsListResult, ToolsCatalogResult } from "../types.ts";
import type { CliAgentCreateForm, CliAgentsListResult, CliTestResult } from "../views/agents.ts";
import { saveConfig } from "./config.ts";
import type { ConfigState } from "./config.ts";

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
  agentCreateBusy?: boolean;
  agentCreateError?: string | null;
  agentDeleteBusy?: boolean;
  agentDeleteError?: string | null;
  // CLI Agent create state
  agentCliCreateBusy?: boolean;
  agentCliCreateError?: string | null;
  // CLI Agents list state
  cliAgentsList?: CliAgentsListResult | null;
  cliAgentsLoading?: boolean;
  cliAgentsError?: string | null;
  // CLI Agent test state
  cliTestRunning?: boolean;
  cliTestResult?: CliTestResult | null;
  cliTestTerminalOpen?: boolean;
  cliTestTerminalData?: string[];
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
