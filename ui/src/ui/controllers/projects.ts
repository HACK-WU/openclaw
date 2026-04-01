/**
 * Project Management — Frontend Controller
 *
 * Handles all projects.* RPC calls and project state management.
 * Follows the same patterns as controllers/group-chat.ts.
 */

import type { GatewayBrowserClient } from "../gateway.ts";

// ─── Types ───

export type Project = {
  id: string;
  name: string;
  directory: string;
  documents: string[];
  description?: string;
  createdAt: number;
  updatedAt: number;
};

export type ProjectIndexEntry = {
  id: string;
  name: string;
  directory: string;
  documentsCount: number;
  description: string;
  createdAt: number;
  updatedAt: number;
};

export type ProjectCreateDialogState = {
  name: string;
  directory: string;
  documents: string;
  description: string;
  isBusy: boolean;
  error: string | null;
};

export type ProjectEditDialogState = {
  projectId: string;
  name: string;
  directory: string;
  documents: string;
  description: string;
  isBusy: boolean;
  error: string | null;
};

export type ProjectDeleteDialogState = {
  projectId: string;
  projectName: string;
  linkedGroupCount: number;
  isBusy: boolean;
  error: string | null;
};

export type ValidationResult = {
  path: string;
  exists: boolean;
  isDirectory?: boolean;
  isFile?: boolean;
  error?: string;
};

export type ProjectRule = {
  id: string;
  projectId: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

export type ProjectRuleCreateDialogState = {
  title: string;
  content: string;
  previewMode: boolean;
  isBusy: boolean;
  error: string | null;
};

export type ProjectRuleEditDialogState = {
  ruleId: string;
  title: string;
  content: string;
  previewMode: boolean;
  isBusy: boolean;
  error: string | null;
};

export type ProjectRuleDeleteDialogState = {
  ruleId: string;
  ruleTitle: string;
  isBusy: boolean;
  error: string | null;
};

// 关联群聊条目（从后端 GroupIndexEntry 映射）
export type LinkedGroupEntry = {
  groupId: string;
  groupName?: string;
  updatedAt: number;
  archived?: boolean;
};

// 管理弹框状态
export type ProjectManageDialogState = {
  projectId: string;
  projectName: string;
  // 当前选中的 tab: "overview" | "rules"
  activeTab: "overview" | "rules";
};

// ─── State ───

export type ProjectsState = {
  projectsList: ProjectIndexEntry[];
  projectsLoading: boolean;
  activeProject: Project | null;
  projectCreateDialog: ProjectCreateDialogState | null;
  projectEditDialog: ProjectEditDialogState | null;
  projectDeleteDialog: ProjectDeleteDialogState | null;
  projectManageDialog: ProjectManageDialogState | null;
  projectError: string | null;
  // 规则管理状态
  projectRules: ProjectRule[];
  projectRulesLoading: boolean;
  projectRuleCreateDialog: ProjectRuleCreateDialogState | null;
  projectRuleEditDialog: ProjectRuleEditDialogState | null;
  projectRuleDeleteDialog: ProjectRuleDeleteDialogState | null;
  // 关联群聊
  projectLinkedGroups: LinkedGroupEntry[];
  projectLinkedGroupsLoading: boolean;
};

export const DEFAULT_PROJECTS_STATE: ProjectsState = {
  projectsList: [],
  projectsLoading: false,
  activeProject: null,
  projectCreateDialog: null,
  projectEditDialog: null,
  projectDeleteDialog: null,
  projectManageDialog: null,
  projectError: null,
  projectRules: [],
  projectRulesLoading: false,
  projectRuleCreateDialog: null,
  projectRuleEditDialog: null,
  projectRuleDeleteDialog: null,
  projectLinkedGroups: [],
  projectLinkedGroupsLoading: false,
};

export type ProjectsHost = {
  client: GatewayBrowserClient | null;
  connected: boolean;
} & ProjectsState;

// ─── RPC Functions ───

export async function loadProjectsList(host: ProjectsHost): Promise<void> {
  if (!host.client || !host.connected) {
    return;
  }
  host.projectsLoading = true;
  host.projectError = null;
  try {
    const result = await host.client.request<ProjectIndexEntry[]>("projects.list");
    host.projectsList = result ?? [];
  } catch (err) {
    host.projectError = String(err);
  } finally {
    host.projectsLoading = false;
  }
}

export async function loadProjectInfo(host: ProjectsHost, projectId: string): Promise<void> {
  if (!host.client || !host.connected) {
    return;
  }
  try {
    const result = await host.client.request<Project>("projects.info", { projectId });
    host.activeProject = result ?? null;
  } catch (err) {
    host.projectError = String(err);
    host.activeProject = null;
  }
}

export async function createProject(
  host: ProjectsHost,
  params: { name: string; directory: string; documents?: string[]; description?: string },
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  const dialog = host.projectCreateDialog;
  if (!dialog) {
    return false;
  }
  host.projectCreateDialog = { ...dialog, isBusy: true, error: null };
  try {
    await host.client.request("projects.create", params);
    host.projectCreateDialog = null;
    await loadProjectsList(host);
    return true;
  } catch (err) {
    host.projectCreateDialog = { ...dialog, isBusy: false, error: String(err) };
    return false;
  }
}

export async function updateProject(
  host: ProjectsHost,
  projectId: string,
  params: { name?: string; directory?: string; documents?: string[]; description?: string },
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  try {
    await host.client.request("projects.update", { projectId, ...params });
    // Reload project list and info
    await loadProjectsList(host);
    if (host.activeProject?.id === projectId) {
      await loadProjectInfo(host, projectId);
    }
    return true;
  } catch (err) {
    host.projectError = String(err);
    return false;
  }
}

export async function deleteProject(host: ProjectsHost, projectId: string): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  const dialog = host.projectDeleteDialog;
  if (!dialog) {
    return false;
  }
  host.projectDeleteDialog = { ...dialog, isBusy: true, error: null };
  try {
    await host.client.request("projects.delete", { projectId });
    host.projectDeleteDialog = null;
    host.activeProject = null;
    await loadProjectsList(host);
    return true;
  } catch (err) {
    host.projectDeleteDialog = { ...dialog, isBusy: false, error: String(err) };
    return false;
  }
}

export async function validateProjectPaths(
  host: ProjectsHost,
  paths: string[],
  type: "directory" | "file",
): Promise<ValidationResult[]> {
  if (!host.client || !host.connected) {
    return [];
  }
  try {
    const result = await host.client.request<{ results: ValidationResult[] }>(
      "projects.validatePaths",
      { paths, type },
    );
    return result?.results ?? [];
  } catch {
    return [];
  }
}

// ─── Rule RPC Functions ───

export async function loadProjectRules(host: ProjectsHost, projectId: string): Promise<void> {
  if (!host.client || !host.connected) {
    return;
  }
  host.projectRulesLoading = true;
  try {
    const result = await host.client.request<ProjectRule[]>("projects.rules.list", { projectId });
    host.projectRules = result ?? [];
  } catch (err) {
    host.projectError = String(err);
  } finally {
    host.projectRulesLoading = false;
  }
}

export async function createProjectRule(
  host: ProjectsHost,
  projectId: string,
  params: { title: string; content: string },
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  const dialog = host.projectRuleCreateDialog;
  if (!dialog) {
    return false;
  }
  host.projectRuleCreateDialog = { ...dialog, isBusy: true, error: null };
  try {
    await host.client.request("projects.rules.create", { projectId, ...params });
    host.projectRuleCreateDialog = null;
    await loadProjectRules(host, projectId);
    return true;
  } catch (err) {
    host.projectRuleCreateDialog = { ...dialog, isBusy: false, error: String(err) };
    return false;
  }
}

export async function updateProjectRule(
  host: ProjectsHost,
  projectId: string,
  ruleId: string,
  params: { title?: string; content?: string },
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  const dialog = host.projectRuleEditDialog;
  if (!dialog) {
    return false;
  }
  host.projectRuleEditDialog = { ...dialog, isBusy: true, error: null };
  try {
    await host.client.request("projects.rules.update", { projectId, ruleId, ...params });
    host.projectRuleEditDialog = null;
    await loadProjectRules(host, projectId);
    return true;
  } catch (err) {
    host.projectRuleEditDialog = { ...dialog, isBusy: false, error: String(err) };
    return false;
  }
}

export async function deleteProjectRule(
  host: ProjectsHost,
  projectId: string,
  ruleId: string,
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  const dialog = host.projectRuleDeleteDialog;
  if (!dialog) {
    return false;
  }
  host.projectRuleDeleteDialog = { ...dialog, isBusy: true, error: null };
  try {
    await host.client.request("projects.rules.delete", { projectId, ruleId });
    host.projectRuleDeleteDialog = null;
    await loadProjectRules(host, projectId);
    return true;
  } catch (err) {
    host.projectRuleDeleteDialog = { ...dialog, isBusy: false, error: String(err) };
    return false;
  }
}

// ─── Linked Groups ───

export async function loadLinkedGroups(host: ProjectsHost, projectId: string): Promise<void> {
  if (!host.client || !host.connected) {
    return;
  }
  host.projectLinkedGroupsLoading = true;
  try {
    const result = await host.client.request<LinkedGroupEntry[]>("projects.getLinkedGroups", {
      projectId,
    });
    host.projectLinkedGroups = result ?? [];
  } catch (err) {
    host.projectError = String(err);
    host.projectLinkedGroups = [];
  } finally {
    host.projectLinkedGroupsLoading = false;
  }
}

// ─── Manage Dialog Functions ───

export async function openProjectManageDialog(
  host: ProjectsHost,
  projectId: string,
  projectName: string,
): Promise<void> {
  // 加载项目详情和规则
  await loadProjectInfo(host, projectId);
  await loadProjectRules(host, projectId);

  host.projectManageDialog = {
    projectId,
    projectName,
    activeTab: "overview",
  };
}

export function closeProjectManageDialog(host: ProjectsHost): void {
  host.projectManageDialog = null;
  host.activeProject = null;
  host.projectRules = [];
  host.projectLinkedGroups = [];
}

export function setProjectManageTab(host: ProjectsHost, tab: "overview" | "rules"): void {
  if (host.projectManageDialog) {
    host.projectManageDialog = {
      ...host.projectManageDialog,
      activeTab: tab,
    };
  }
}
