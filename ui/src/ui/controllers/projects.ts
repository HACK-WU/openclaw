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

// ─── Skill Types ───

export type ProjectSkill = {
  id: string;
  projectId: string;
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

export type ProjectSkillCreateDialogState = {
  name: string;
  content: string;
  previewMode: boolean;
  isBusy: boolean;
  error: string | null;
};

export type ProjectSkillEditDialogState = {
  skillId: string;
  name: string;
  content: string;
  previewMode: boolean;
  isBusy: boolean;
  error: string | null;
};

export type ProjectSkillDeleteDialogState = {
  skillId: string;
  skillName: string;
  isBusy: boolean;
  error: string | null;
};

// ─── Doc Types ───

export type ProjectDoc = {
  id: string;
  projectId: string;
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

export type ProjectDocCreateDialogState = {
  name: string;
  content: string;
  previewMode: boolean;
  isBusy: boolean;
  error: string | null;
};

export type ProjectDocEditDialogState = {
  docId: string;
  name: string;
  content: string;
  previewMode: boolean;
  isBusy: boolean;
  error: string | null;
};

export type ProjectDocDeleteDialogState = {
  docId: string;
  docName: string;
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
  // 当前选中的 tab: "overview" | "rules" | "skills" | "docs"
  activeTab: "overview" | "rules" | "skills" | "docs";
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
  // 技能管理状态
  projectSkills: ProjectSkill[];
  projectSkillsLoading: boolean;
  projectSkillCreateDialog: ProjectSkillCreateDialogState | null;
  projectSkillEditDialog: ProjectSkillEditDialogState | null;
  projectSkillDeleteDialog: ProjectSkillDeleteDialogState | null;
  // 文档管理状态
  projectDocs: ProjectDoc[];
  projectDocsLoading: boolean;
  projectDocCreateDialog: ProjectDocCreateDialogState | null;
  projectDocEditDialog: ProjectDocEditDialogState | null;
  projectDocDeleteDialog: ProjectDocDeleteDialogState | null;
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
  projectSkills: [],
  projectSkillsLoading: false,
  projectSkillCreateDialog: null,
  projectSkillEditDialog: null,
  projectSkillDeleteDialog: null,
  projectDocs: [],
  projectDocsLoading: false,
  projectDocCreateDialog: null,
  projectDocEditDialog: null,
  projectDocDeleteDialog: null,
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

// ─── Skill RPC Functions ───

export async function loadProjectSkills(host: ProjectsHost, projectId: string): Promise<void> {
  if (!host.client || !host.connected) {
    return;
  }
  host.projectSkillsLoading = true;
  try {
    const result = await host.client.request<ProjectSkill[]>("projects.skills.list", { projectId });
    host.projectSkills = result ?? [];
  } catch (err) {
    host.projectError = String(err);
  } finally {
    host.projectSkillsLoading = false;
  }
}

export async function createProjectSkill(
  host: ProjectsHost,
  projectId: string,
  params: { name: string; content: string },
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  const dialog = host.projectSkillCreateDialog;
  if (!dialog) {
    return false;
  }
  host.projectSkillCreateDialog = { ...dialog, isBusy: true, error: null };
  try {
    await host.client.request("projects.skills.create", { projectId, ...params });
    host.projectSkillCreateDialog = null;
    await loadProjectSkills(host, projectId);
    return true;
  } catch (err) {
    host.projectSkillCreateDialog = { ...dialog, isBusy: false, error: String(err) };
    return false;
  }
}

export async function updateProjectSkill(
  host: ProjectsHost,
  projectId: string,
  skillId: string,
  params: { name?: string; content?: string },
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  const dialog = host.projectSkillEditDialog;
  if (!dialog) {
    return false;
  }
  host.projectSkillEditDialog = { ...dialog, isBusy: true, error: null };
  try {
    await host.client.request("projects.skills.update", { projectId, skillId, ...params });
    host.projectSkillEditDialog = null;
    await loadProjectSkills(host, projectId);
    return true;
  } catch (err) {
    host.projectSkillEditDialog = { ...dialog, isBusy: false, error: String(err) };
    return false;
  }
}

export async function deleteProjectSkill(
  host: ProjectsHost,
  projectId: string,
  skillId: string,
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  const dialog = host.projectSkillDeleteDialog;
  if (!dialog) {
    return false;
  }
  host.projectSkillDeleteDialog = { ...dialog, isBusy: true, error: null };
  try {
    await host.client.request("projects.skills.delete", { projectId, skillId });
    host.projectSkillDeleteDialog = null;
    await loadProjectSkills(host, projectId);
    return true;
  } catch (err) {
    host.projectSkillDeleteDialog = { ...dialog, isBusy: false, error: String(err) };
    return false;
  }
}

// ─── Doc RPC Functions ───

export async function loadProjectDocs(host: ProjectsHost, projectId: string): Promise<void> {
  if (!host.client || !host.connected) {
    return;
  }
  host.projectDocsLoading = true;
  try {
    const result = await host.client.request<ProjectDoc[]>("projects.docs.list", { projectId });
    host.projectDocs = result ?? [];
  } catch (err) {
    host.projectError = String(err);
  } finally {
    host.projectDocsLoading = false;
  }
}

export async function createProjectDoc(
  host: ProjectsHost,
  projectId: string,
  params: { name: string; content: string },
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  const dialog = host.projectDocCreateDialog;
  if (!dialog) {
    return false;
  }
  host.projectDocCreateDialog = { ...dialog, isBusy: true, error: null };
  try {
    await host.client.request("projects.docs.create", { projectId, ...params });
    host.projectDocCreateDialog = null;
    await loadProjectDocs(host, projectId);
    return true;
  } catch (err) {
    host.projectDocCreateDialog = { ...dialog, isBusy: false, error: String(err) };
    return false;
  }
}

export async function updateProjectDoc(
  host: ProjectsHost,
  projectId: string,
  docId: string,
  params: { name?: string; content?: string },
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  const dialog = host.projectDocEditDialog;
  if (!dialog) {
    return false;
  }
  host.projectDocEditDialog = { ...dialog, isBusy: true, error: null };
  try {
    await host.client.request("projects.docs.update", { projectId, docId, ...params });
    host.projectDocEditDialog = null;
    await loadProjectDocs(host, projectId);
    return true;
  } catch (err) {
    host.projectDocEditDialog = { ...dialog, isBusy: false, error: String(err) };
    return false;
  }
}

export async function deleteProjectDoc(
  host: ProjectsHost,
  projectId: string,
  docId: string,
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  const dialog = host.projectDocDeleteDialog;
  if (!dialog) {
    return false;
  }
  host.projectDocDeleteDialog = { ...dialog, isBusy: true, error: null };
  try {
    await host.client.request("projects.docs.delete", { projectId, docId });
    host.projectDocDeleteDialog = null;
    await loadProjectDocs(host, projectId);
    return true;
  } catch (err) {
    host.projectDocDeleteDialog = { ...dialog, isBusy: false, error: String(err) };
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
  // 加载项目详情、规则、技能和文档
  await loadProjectInfo(host, projectId);
  await loadProjectRules(host, projectId);
  await loadProjectSkills(host, projectId);
  await loadProjectDocs(host, projectId);

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
  host.projectSkills = [];
  host.projectDocs = [];
  host.projectLinkedGroups = [];
}

export function setProjectManageTab(
  host: ProjectsHost,
  tab: "overview" | "rules" | "skills" | "docs",
): void {
  if (host.projectManageDialog) {
    host.projectManageDialog = {
      ...host.projectManageDialog,
      activeTab: tab,
    };
  }
}
