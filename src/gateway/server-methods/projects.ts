/**
 * Project Management — RPC Handlers
 *
 * Implements all projects.* gateway methods.
 * Follows the same handler pattern as group.ts.
 */

import { getLogger } from "../../logging.js";
import {
  createProject,
  deleteProject,
  findProjectByName,
  loadProjectIndex,
  loadProjectMeta,
  updateProjectMeta,
} from "../../projects/project-store.js";
import type { GatewayRequestHandler, GatewayRequestHandlers } from "./types.js";

const log = getLogger("projects:handler");

// ─── List Projects ───

const handleProjectsList: GatewayRequestHandler = ({ respond }) => {
  const index = loadProjectIndex();
  const mapped = index.map((entry) => {
    const meta = loadProjectMeta(entry.id);
    return {
      id: entry.id,
      name: entry.name,
      directory: meta?.directory ?? "",
      documentsCount: meta?.documents.length ?? 0,
      description: meta?.description ?? "",
      createdAt: meta?.createdAt ?? entry.updatedAt,
      updatedAt: entry.updatedAt,
    };
  });
  respond(true, mapped);
};

// ─── Get Project Info ───

const handleProjectsInfo: GatewayRequestHandler = ({ params, respond }) => {
  const projectId = params.projectId as string;
  if (!projectId) {
    respond(false, undefined, { message: "projectId is required", code: 400 });
    return;
  }

  const meta = loadProjectMeta(projectId);
  if (!meta) {
    respond(false, undefined, { message: "Project not found", code: 404 });
    return;
  }

  respond(true, meta);
};

// ─── Create Project ───

const handleProjectsCreate: GatewayRequestHandler = async ({ params, respond }) => {
  const name = (params.name as string)?.trim();
  const directory = (params.directory as string)?.trim();
  const documents = params.documents as string[] | undefined;
  const description = params.description as string | undefined;

  // 参数校验
  if (!name) {
    respond(false, undefined, { message: "Project name is required", code: 400 });
    return;
  }
  if (!directory) {
    respond(false, undefined, { message: "Project directory is required", code: 400 });
    return;
  }

  // 名称唯一性校验
  const existing = findProjectByName(name);
  if (existing) {
    respond(false, undefined, { message: "Project name already exists", code: 409 });
    return;
  }

  // 目录存在性校验
  try {
    const { stat } = await import("node:fs/promises");
    const stats = await stat(directory);
    if (!stats.isDirectory()) {
      respond(false, undefined, { message: "Path is not a directory", code: 400 });
      return;
    }
  } catch {
    respond(false, undefined, { message: "Directory does not exist", code: 400 });
    return;
  }

  try {
    const project = await createProject({
      name,
      directory,
      documents: documents ?? [],
      description: description?.trim() || undefined,
    });

    log.info(`Project created: ${project.id} (${project.name})`);
    respond(true, project);
  } catch (err) {
    log.error(`Failed to create project: ${String(err)}`);
    respond(false, undefined, { message: "Failed to create project", code: 500 });
  }
};

// ─── Update Project ───

const handleProjectsUpdate: GatewayRequestHandler = async ({ params, respond }) => {
  const projectId = params.projectId as string;
  if (!projectId) {
    respond(false, undefined, { message: "projectId is required", code: 400 });
    return;
  }

  const directory = params.directory as string | undefined;
  const documents = params.documents as string[] | undefined;
  const description = params.description as string | undefined;

  // 目录存在性校验（如果提供了新目录）
  if (directory) {
    try {
      const { stat } = await import("node:fs/promises");
      const stats = await stat(directory.trim());
      if (!stats.isDirectory()) {
        respond(false, undefined, { message: "Path is not a directory", code: 400 });
        return;
      }
    } catch {
      respond(false, undefined, { message: "Directory does not exist", code: 400 });
      return;
    }
  }

  try {
    const updated = await updateProjectMeta(projectId, (meta) => ({
      ...meta,
      ...(directory !== undefined ? { directory: directory.trim() } : {}),
      ...(documents !== undefined ? { documents } : {}),
      ...(description !== undefined ? { description: description.trim() || undefined } : {}),
    }));

    log.info(`Project updated: ${projectId}`);
    respond(true, updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      respond(false, undefined, { message: "Project not found", code: 404 });
    } else {
      log.error(`Failed to update project: ${String(err)}`);
      respond(false, undefined, { message: "Failed to update project", code: 500 });
    }
  }
};

// ─── Delete Project ───

const handleProjectsDelete: GatewayRequestHandler = async ({ params, respond }) => {
  const projectId = params.projectId as string;
  if (!projectId) {
    respond(false, undefined, { message: "projectId is required", code: 400 });
    return;
  }

  const meta = loadProjectMeta(projectId);
  if (!meta) {
    respond(false, undefined, { message: "Project not found", code: 404 });
    return;
  }

  try {
    // TODO: Phase 2 — 清除关联群聊的 projectId（待 GroupSessionEntry 添加 projectId 字段后实现）

    await deleteProject(projectId);
    log.info(`Project deleted: ${projectId} (${meta.name})`);
    respond(true, { ok: true });
  } catch (err) {
    log.error(`Failed to delete project: ${String(err)}`);
    respond(false, undefined, { message: "Failed to delete project", code: 500 });
  }
};

// ─── Validate Paths ───

const handleProjectsValidatePaths: GatewayRequestHandler = async ({ params, respond }) => {
  const paths = params.paths as string[] | undefined;
  const type = params.type as "directory" | "file" | undefined;

  if (!Array.isArray(paths) || paths.length === 0) {
    respond(true, { results: [] });
    return;
  }

  const { stat } = await import("node:fs/promises");

  const results: Array<{
    path: string;
    exists: boolean;
    isDirectory?: boolean;
    isFile?: boolean;
    error?: string;
  }> = [];

  for (const p of paths) {
    if (!p || typeof p !== "string") {
      results.push({ path: String(p), exists: false, error: "Invalid path" });
      continue;
    }

    try {
      const stats = await stat(p);
      const isDirectory = stats.isDirectory();
      const isFile = stats.isFile();

      if (type === "directory" && !isDirectory) {
        results.push({ path: p, exists: true, isDirectory, isFile, error: "Not a directory" });
      } else if (type === "file" && !isFile) {
        results.push({ path: p, exists: true, isDirectory, isFile, error: "Not a file" });
      } else {
        results.push({ path: p, exists: true, isDirectory, isFile });
      }
    } catch {
      results.push({ path: p, exists: false });
    }
  }

  respond(true, { results });
};

// ─── Export Handlers ───

export const projectsHandlers: GatewayRequestHandlers = {
  "projects.list": handleProjectsList,
  "projects.info": handleProjectsInfo,
  "projects.create": handleProjectsCreate,
  "projects.update": handleProjectsUpdate,
  "projects.delete": handleProjectsDelete,
  "projects.validatePaths": handleProjectsValidatePaths,
};
