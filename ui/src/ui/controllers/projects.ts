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

// ─── Doc Export/Import Types ───

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
  previewDocs: DocImportPreviewDoc[];
  conflictStrategy: "rename" | "overwrite" | "skip";
  isImporting: boolean;
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
  // 文档导出/导入状态
  projectDocExportDialog: DocExportDialogState | null;
  projectDocImportDialog: DocImportDialogState | null;
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

// ─── Doc Export/Import RPC Functions ───

export function openDocExportDialog(host: ProjectsHost): void {
  const dialog = host.projectManageDialog;
  if (!dialog) {
    return;
  }
  // Default: select all docs
  const selectedDocIds = new Set(host.projectDocs.map((d) => d.id));
  host.projectDocExportDialog = {
    projectId: dialog.projectId,
    selectedDocIds,
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
  const selected = new Set(dialog.selectedDocIds);
  if (selected.has(docId)) {
    selected.delete(docId);
  } else {
    selected.add(docId);
  }
  host.projectDocExportDialog = { ...dialog, selectedDocIds: selected };
}

export function toggleDocExportSelectAll(host: ProjectsHost): void {
  const dialog = host.projectDocExportDialog;
  if (!dialog) {
    return;
  }
  const allSelected = dialog.selectedDocIds.size === host.projectDocs.length;
  const selectedDocIds = allSelected
    ? new Set<string>()
    : new Set(host.projectDocs.map((d) => d.id));
  host.projectDocExportDialog = { ...dialog, selectedDocIds };
}

export async function exportProjectDocsFromDialog(host: ProjectsHost): Promise<void> {
  const dialog = host.projectDocExportDialog;
  if (!dialog || !host.client || !host.connected) {
    return;
  }
  if (dialog.selectedDocIds.size === 0) {
    host.projectDocExportDialog = { ...dialog, error: "Please select at least one document" };
    return;
  }
  host.projectDocExportDialog = { ...dialog, isExporting: true, error: null };
  try {
    const docIds = Array.from(dialog.selectedDocIds);
    const result = await host.client.request<DocExportResult>("projects.docs.export", {
      projectId: dialog.projectId,
      docIds,
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
    host.projectDocExportDialog = { ...dialog, isExporting: false, error: String(err) };
  }
}

export async function openDocImportDialog(host: ProjectsHost): Promise<void> {
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
      const format = file.name.endsWith(".json") ? "json" : "zip";

      // Get preview
      if (host.client && host.connected) {
        try {
          const preview = await host.client.request<DocImportPreviewResult>(
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
            previewDocs: preview.preview,
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
            previewDocs: [],
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
    const _result = await host.client.request<DocImportResult>("projects.docs.import", {
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
    host.projectDocImportDialog = { ...dialog, isImporting: false, error: String(err) };
    return false;
  }
}
