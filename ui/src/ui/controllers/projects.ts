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

// ─── State ───

export type ProjectsState = {
  projectsList: ProjectIndexEntry[];
  projectsLoading: boolean;
  activeProject: Project | null;
  projectCreateDialog: ProjectCreateDialogState | null;
  projectEditDialog: ProjectEditDialogState | null;
  projectDeleteDialog: ProjectDeleteDialogState | null;
  projectError: string | null;
};

export const DEFAULT_PROJECTS_STATE: ProjectsState = {
  projectsList: [],
  projectsLoading: false,
  activeProject: null,
  projectCreateDialog: null,
  projectEditDialog: null,
  projectDeleteDialog: null,
  projectError: null,
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
  params: { directory?: string; documents?: string[]; description?: string },
): Promise<boolean> {
  if (!host.client || !host.connected) {
    return false;
  }
  const dialog = host.projectEditDialog;
  if (!dialog) {
    return false;
  }
  host.projectEditDialog = { ...dialog, isBusy: true, error: null };
  try {
    await host.client.request("projects.update", { projectId, ...params });
    host.projectEditDialog = null;
    await loadProjectsList(host);
    return true;
  } catch (err) {
    host.projectEditDialog = { ...dialog, isBusy: false, error: String(err) };
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
