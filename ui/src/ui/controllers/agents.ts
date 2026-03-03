import type { GatewayBrowserClient } from "../gateway.ts";
import type { AgentsListResult, ToolsCatalogResult } from "../types.ts";

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
};

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
