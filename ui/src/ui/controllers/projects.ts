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

// ─── Doc Export/Import Types (Legacy) ───

export type DocExportDialogState = {
  projectId: string;
  selectedDocIds: Set<string>;
  isExporting: boolean;
  error: string | null;
};

export type DocImportDialogState = {
  projectId: string;
  fileName: string;
  fileData: string; // base64
  format: "zip" | "json";
  preview: DocImportPreviewDoc[];
  conflictStrategy: "rename" | "overwrite" | "skip";
  isImporting: boolean;
  error: string | null;
};

export type DocExportResult = {
  filename: string;
  contentType: string;
  data: string; // base64
  docCount: number;
  docIds?: string[];
};

export type DocImportPreviewDoc = {
  name: string;
  contentPreview?: string;
  hasConflict: boolean;
  existingDocId?: string;
};

export type DocImportPreviewResult = {
  preview: DocImportPreviewDoc[];
};

export type DocImportResult = {
  imported: number;
  skipped: number;
  errors: Array<{ name: string; reason: string }>;
  importedDocIds?: string[];
};

// ─── Unified Resource Export/Import Types ───

export type ResourceExportDialogState = {
  projectId: string;
  // 选中的资源类型
  selectedTypes: Set<"docs" | "rules" | "skills">;
  // 选中的具体资源 ID
  selectedDocIds: Set<string>;
  selectedRuleIds: Set<string>;
  selectedSkillIds: Set<string>;
  isExporting: boolean;
  error: string | null;
};

export type ImportPreviewItem = {
  id: string;
  name: string;
  type: "doc" | "rule" | "skill";
  hasConflict: boolean;
  existingId?: string;
};

export type ResourceImportDialogState = {
  projectId: string;
  fileName: string;
  fileData: string; // base64
  // 预览结果
  preview: {
    stats: {
      docs: { total: number; new: number; conflict: number };
      rules: { total: number; new: number; conflict: number };
      skills: { total: number; new: number; conflict: number };
    };
    resources: {
      docs: ImportPreviewItem[];
      rules: ImportPreviewItem[];
      skills: ImportPreviewItem[];
    };
  };
  conflictStrategy: "rename" | "overwrite" | "skip";
  isImporting: boolean;
  error: string | null;
};

export type ResourceExportResult = {
  filename: string;
  contentType: string;
  data: string; // base64
  stats: {
    docs: number;
    rules: number;
    skills: number;
    total: number;
  };
  exportedAt: number;
};

export type ResourceImportPreviewResult = {
  stats: {
    docs: { total: number; new: number; conflict: number };
    rules: { total: number; new: number; conflict: number };
    skills: { total: number; new: number; conflict: number };
  };
  resources: {
    docs: ImportPreviewItem[];
    rules: ImportPreviewItem[];
    skills: ImportPreviewItem[];
  };
};

export type ResourceImportResult = {
  imported: {
    docs: number;
    rules: number;
    skills: number;
  };
  skipped: {
    docs: number;
    rules: number;
    skills: number;
  };
  errors: Array<{
    type: "doc" | "rule" | "skill";
    name: string;
    reason: string;
  }>;
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
  // 文档导出/导入状态（旧版）
  projectDocExportDialog: DocExportDialogState | null;
  projectDocImportDialog: DocImportDialogState | null;
  // 统一资源导出/导入状态
  projectResourceExportDialog: ResourceExportDialogState | null;
  projectResourceImportDialog: ResourceImportDialogState | null;
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
  projectDocExportDialog: null,
  projectDocImportDialog: null,
  projectResourceExportDialog: null,
  projectResourceImportDialog: null,
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

// ─── Doc Export/Import Functions (Legacy) ───

export function openDocExportDialog(host: ProjectsHost): void {
  const dialog = host.projectManageDialog;
  if (!dialog) {
    return;
  }
  // Default: select all docs
  host.projectDocExportDialog = {
    projectId: dialog.projectId,
    selectedDocIds: new Set(host.projectDocs.map((d) => d.id)),
    isExporting: false,
    error: null,
  };
}

export function closeDocExportDialog(host: ProjectsHost): void {
  host.projectDocExportDialog = null;
}

export function toggleDocExportSelection(host: ProjectsHost, docId: string): void {
  const dialog = host.projectDocExportDialog;
  if (!dialog) {
    return;
  }
  const selectedDocIds = new Set(dialog.selectedDocIds);
  if (selectedDocIds.has(docId)) {
    selectedDocIds.delete(docId);
  } else {
    selectedDocIds.add(docId);
  }
  host.projectDocExportDialog = { ...dialog, selectedDocIds };
}

export function toggleDocExportSelectAll(host: ProjectsHost): void {
  const dialog = host.projectDocExportDialog;
  if (!dialog) {
    return;
  }
  const allSelected = dialog.selectedDocIds.size === host.projectDocs.length;
  if (allSelected) {
    // Unselect all
    host.projectDocExportDialog = {
      ...dialog,
      selectedDocIds: new Set(),
    };
  } else {
    // Select all
    host.projectDocExportDialog = {
      ...dialog,
      selectedDocIds: new Set(host.projectDocs.map((d) => d.id)),
    };
  }
}

export async function exportProjectDocsFromDialog(host: ProjectsHost): Promise<void> {
  const dialog = host.projectDocExportDialog;
  if (!dialog || !host.client || !host.connected) {
    return;
  }

  if (dialog.selectedDocIds.size === 0) {
    host.projectDocExportDialog = {
      ...dialog,
      error: "Please select at least one document",
    };
    return;
  }

  host.projectDocExportDialog = { ...dialog, isExporting: true, error: null };

  try {
    const result = await host.client.request<DocExportResult>("projects.docs.export", {
      projectId: dialog.projectId,
      docIds: Array.from(dialog.selectedDocIds),
      format: "zip",
    });

    // Trigger browser download
    const binaryStr = atob(result.data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: result.contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Close dialog on success
    host.projectDocExportDialog = null;
  } catch (err) {
    host.projectDocExportDialog = {
      ...dialog,
      isExporting: false,
      error: String(err),
    };
  }
}

export function openDocImportDialog(host: ProjectsHost): void {
  const dialog = host.projectManageDialog;
  if (!dialog) {
    return;
  }

  // Open file picker
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".zip,.json";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    // Read file as base64
    const fileReader = new FileReader();
    fileReader.addEventListener("load", async () => {
      const arrayBuffer = fileReader.result as ArrayBuffer;
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      // Determine format
      const format = file.name.endsWith(".json") ? "json" : "zip";

      // Get preview
      if (host.client && host.connected) {
        try {
          const previewResult = await host.client.request<DocImportPreviewResult>(
            "projects.docs.importPreview",
            {
              projectId: dialog.projectId,
              data: base64,
              format,
            },
          );

          host.projectDocImportDialog = {
            projectId: dialog.projectId,
            fileName: file.name,
            fileData: base64,
            format,
            preview: previewResult.preview,
            conflictStrategy: "rename",
            isImporting: false,
            error: null,
          };
        } catch (err) {
          host.projectDocImportDialog = {
            projectId: dialog.projectId,
            fileName: file.name,
            fileData: base64,
            format,
            preview: [],
            conflictStrategy: "rename",
            isImporting: false,
            error: String(err),
          };
        }
      }
    });
    fileReader.readAsArrayBuffer(file);
  });
  input.click();
}

export function closeDocImportDialog(host: ProjectsHost): void {
  host.projectDocImportDialog = null;
}

export function setDocImportConflictStrategy(
  host: ProjectsHost,
  strategy: "rename" | "overwrite" | "skip",
): void {
  const dialog = host.projectDocImportDialog;
  if (!dialog) {
    return;
  }
  host.projectDocImportDialog = { ...dialog, conflictStrategy: strategy };
}

export async function importProjectDocsFromDialog(host: ProjectsHost): Promise<boolean> {
  const dialog = host.projectDocImportDialog;
  if (!dialog || !host.client || !host.connected) {
    return false;
  }

  host.projectDocImportDialog = { ...dialog, isImporting: true, error: null };

  try {
    await host.client.request<DocImportResult>("projects.docs.import", {
      projectId: dialog.projectId,
      data: dialog.fileData,
      format: dialog.format,
      conflictStrategy: dialog.conflictStrategy,
    });

    // Refresh docs list
    await loadProjectDocs(host, dialog.projectId);

    // Close dialog on success
    host.projectDocImportDialog = null;
    return true;
  } catch (err) {
    host.projectDocImportDialog = {
      ...dialog,
      isImporting: false,
      error: String(err),
    };
    return false;
  }
}

// ─── Unified Resource Export/Import Functions ───

export function openResourceExportDialog(host: ProjectsHost): void {
  const dialog = host.projectManageDialog;
  if (!dialog) {
    return;
  }
  // Default: select all types and all resources
  host.projectResourceExportDialog = {
    projectId: dialog.projectId,
    selectedTypes: new Set(["docs", "rules", "skills"]),
    selectedDocIds: new Set(host.projectDocs.map((d) => d.id)),
    selectedRuleIds: new Set(host.projectRules.map((r) => r.id)),
    selectedSkillIds: new Set(host.projectSkills.map((s) => s.id)),
    isExporting: false,
    error: null,
  };
}

export function closeResourceExportDialog(host: ProjectsHost): void {
  host.projectResourceExportDialog = null;
}

export function toggleResourceExportType(
  host: ProjectsHost,
  type: "docs" | "rules" | "skills",
): void {
  const dialog = host.projectResourceExportDialog;
  if (!dialog) {
    return;
  }
  const selectedTypes = new Set(dialog.selectedTypes);
  if (selectedTypes.has(type)) {
    selectedTypes.delete(type);
  } else {
    selectedTypes.add(type);
  }
  host.projectResourceExportDialog = { ...dialog, selectedTypes };
}

export function toggleResourceExportDoc(host: ProjectsHost, docId: string): void {
  const dialog = host.projectResourceExportDialog;
  if (!dialog) {
    return;
  }
  const selectedDocIds = new Set(dialog.selectedDocIds);
  if (selectedDocIds.has(docId)) {
    selectedDocIds.delete(docId);
  } else {
    selectedDocIds.add(docId);
  }
  host.projectResourceExportDialog = { ...dialog, selectedDocIds };
}

export function toggleResourceExportRule(host: ProjectsHost, ruleId: string): void {
  const dialog = host.projectResourceExportDialog;
  if (!dialog) {
    return;
  }
  const selectedRuleIds = new Set(dialog.selectedRuleIds);
  if (selectedRuleIds.has(ruleId)) {
    selectedRuleIds.delete(ruleId);
  } else {
    selectedRuleIds.add(ruleId);
  }
  host.projectResourceExportDialog = { ...dialog, selectedRuleIds };
}

export function toggleResourceExportSkill(host: ProjectsHost, skillId: string): void {
  const dialog = host.projectResourceExportDialog;
  if (!dialog) {
    return;
  }
  const selectedSkillIds = new Set(dialog.selectedSkillIds);
  if (selectedSkillIds.has(skillId)) {
    selectedSkillIds.delete(skillId);
  } else {
    selectedSkillIds.add(skillId);
  }
  host.projectResourceExportDialog = { ...dialog, selectedSkillIds };
}

export function toggleResourceExportSelectAll(host: ProjectsHost): void {
  const dialog = host.projectResourceExportDialog;
  if (!dialog) {
    return;
  }
  // Check if all resources are selected
  const allDocsSelected =
    dialog.selectedTypes.has("docs") && dialog.selectedDocIds.size === host.projectDocs.length;
  const allRulesSelected =
    dialog.selectedTypes.has("rules") && dialog.selectedRuleIds.size === host.projectRules.length;
  const allSkillsSelected =
    dialog.selectedTypes.has("skills") &&
    dialog.selectedSkillIds.size === host.projectSkills.length;

  const allSelected = allDocsSelected && allRulesSelected && allSkillsSelected;

  if (allSelected) {
    // Unselect all
    host.projectResourceExportDialog = {
      ...dialog,
      selectedTypes: new Set(),
      selectedDocIds: new Set(),
      selectedRuleIds: new Set(),
      selectedSkillIds: new Set(),
    };
  } else {
    // Select all
    host.projectResourceExportDialog = {
      ...dialog,
      selectedTypes: new Set(["docs", "rules", "skills"]),
      selectedDocIds: new Set(host.projectDocs.map((d) => d.id)),
      selectedRuleIds: new Set(host.projectRules.map((r) => r.id)),
      selectedSkillIds: new Set(host.projectSkills.map((s) => s.id)),
    };
  }
}

export async function exportProjectResourcesFromDialog(host: ProjectsHost): Promise<void> {
  const dialog = host.projectResourceExportDialog;
  if (!dialog || !host.client || !host.connected) {
    return;
  }

  // Check if at least one type is selected
  if (dialog.selectedTypes.size === 0) {
    host.projectResourceExportDialog = {
      ...dialog,
      error: "Please select at least one resource type",
    };
    return;
  }

  // Check if at least one resource is selected
  const hasSelection =
    (dialog.selectedTypes.has("docs") && dialog.selectedDocIds.size > 0) ||
    (dialog.selectedTypes.has("rules") && dialog.selectedRuleIds.size > 0) ||
    (dialog.selectedTypes.has("skills") && dialog.selectedSkillIds.size > 0);

  if (!hasSelection) {
    host.projectResourceExportDialog = {
      ...dialog,
      error: "Please select at least one resource to export",
    };
    return;
  }

  host.projectResourceExportDialog = { ...dialog, isExporting: true, error: null };

  try {
    const resourceTypes = Array.from(dialog.selectedTypes);
    const docIds = dialog.selectedTypes.has("docs") ? Array.from(dialog.selectedDocIds) : undefined;
    const ruleIds = dialog.selectedTypes.has("rules")
      ? Array.from(dialog.selectedRuleIds)
      : undefined;
    const skillIds = dialog.selectedTypes.has("skills")
      ? Array.from(dialog.selectedSkillIds)
      : undefined;

    const result = await host.client.request<ResourceExportResult>("projects.resources.export", {
      projectId: dialog.projectId,
      resourceTypes,
      docIds,
      ruleIds,
      skillIds,
    });

    // Trigger browser download
    const binaryStr = atob(result.data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: result.contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Close dialog on success
    host.projectResourceExportDialog = null;
  } catch (err) {
    host.projectResourceExportDialog = {
      ...dialog,
      isExporting: false,
      error: String(err),
    };
  }
}

export async function openResourceImportDialog(host: ProjectsHost): Promise<void> {
  const dialog = host.projectManageDialog;
  if (!dialog) {
    return;
  }

  // Open file picker
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".zip";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    // Read file as base64
    const fileReader = new FileReader();
    fileReader.addEventListener("load", async () => {
      const arrayBuffer = fileReader.result as ArrayBuffer;
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      // Get preview
      if (host.client && host.connected) {
        try {
          const preview = await host.client.request<ResourceImportPreviewResult>(
            "projects.resources.importPreview",
            {
              projectId: dialog.projectId,
              data: base64,
            },
          );

          host.projectResourceImportDialog = {
            projectId: dialog.projectId,
            fileName: file.name,
            fileData: base64,
            preview,
            conflictStrategy: "rename",
            isImporting: false,
            error: null,
          };
        } catch (err) {
          host.projectResourceImportDialog = {
            projectId: dialog.projectId,
            fileName: file.name,
            fileData: base64,
            preview: {
              stats: {
                docs: { total: 0, new: 0, conflict: 0 },
                rules: { total: 0, new: 0, conflict: 0 },
                skills: { total: 0, new: 0, conflict: 0 },
              },
              resources: {
                docs: [],
                rules: [],
                skills: [],
              },
            },
            conflictStrategy: "rename",
            isImporting: false,
            error: String(err),
          };
        }
      }
    });
    fileReader.readAsArrayBuffer(file);
  });
  input.click();
}

export function closeResourceImportDialog(host: ProjectsHost): void {
  host.projectResourceImportDialog = null;
}

export function setResourceImportConflictStrategy(
  host: ProjectsHost,
  strategy: "rename" | "overwrite" | "skip",
): void {
  const dialog = host.projectResourceImportDialog;
  if (!dialog) {
    return;
  }
  host.projectResourceImportDialog = { ...dialog, conflictStrategy: strategy };
}

export async function importProjectResourcesFromDialog(host: ProjectsHost): Promise<boolean> {
  const dialog = host.projectResourceImportDialog;
  if (!dialog || !host.client || !host.connected) {
    return false;
  }

  host.projectResourceImportDialog = { ...dialog, isImporting: true, error: null };

  try {
    const _result = await host.client.request<ResourceImportResult>("projects.resources.import", {
      projectId: dialog.projectId,
      data: dialog.fileData,
      conflictStrategy: dialog.conflictStrategy,
    });

    // Refresh all resource lists
    await loadProjectDocs(host, dialog.projectId);
    await loadProjectRules(host, dialog.projectId);
    await loadProjectSkills(host, dialog.projectId);

    // Close dialog on success
    host.projectResourceImportDialog = null;
    return true;
  } catch (err) {
    host.projectResourceImportDialog = {
      ...dialog,
      isImporting: false,
      error: String(err),
    };
    return false;
  }
}
