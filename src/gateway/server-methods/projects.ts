/**
 * Project Management — RPC Handlers
 *
 * Implements all projects.* gateway methods.
 * Follows the same handler pattern as group.ts.
 */

import {
  clearProjectIdFromGroups,
  findGroupsByProjectId,
  loadGroupMeta,
  updateGroupMeta,
} from "../../group-chat/group-store.js";
import { getLogger } from "../../logging.js";
import {
  createProject,
  createProjectDoc,
  createProjectRule,
  createProjectSkill,
  deleteProject,
  deleteProjectDoc,
  deleteProjectRule,
  deleteProjectSkill,
  findProjectByName,
  loadProjectDoc,
  loadProjectDocs,
  loadProjectIndex,
  loadProjectMeta,
  loadProjectRule,
  loadProjectRules,
  loadProjectSkill,
  loadProjectSkills,
  updateProjectDoc,
  updateProjectMeta,
  updateProjectRule,
  updateProjectSkill,
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

  const name = params.name as string | undefined;
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
      ...(name !== undefined ? { name: name.trim() } : {}),
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
    // Clear projectId from all associated groups
    await clearProjectIdFromGroups(projectId);

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

// ─── List Project Rules ───

const handleProjectsRulesList: GatewayRequestHandler = ({ params, respond }) => {
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

  const rules = loadProjectRules(projectId);
  respond(true, rules);
};

// ─── Get Project Rule ───

const handleProjectsRulesGet: GatewayRequestHandler = ({ params, respond }) => {
  const projectId = params.projectId as string;
  const ruleId = params.ruleId as string;
  if (!projectId || !ruleId) {
    respond(false, undefined, { message: "projectId and ruleId are required", code: 400 });
    return;
  }

  const rule = loadProjectRule(projectId, ruleId);
  if (!rule) {
    respond(false, undefined, { message: "Rule not found", code: 404 });
    return;
  }

  respond(true, rule);
};

// ─── Create Project Rule ───

const handleProjectsRulesCreate: GatewayRequestHandler = async ({ params, respond }) => {
  const projectId = params.projectId as string;
  const title = (params.title as string)?.trim();
  const content = (params.content as string)?.trim();

  if (!projectId) {
    respond(false, undefined, { message: "projectId is required", code: 400 });
    return;
  }
  if (!title) {
    respond(false, undefined, { message: "Rule title is required", code: 400 });
    return;
  }
  if (!content) {
    respond(false, undefined, { message: "Rule content is required", code: 400 });
    return;
  }

  const meta = loadProjectMeta(projectId);
  if (!meta) {
    respond(false, undefined, { message: "Project not found", code: 404 });
    return;
  }

  try {
    const rule = await createProjectRule(projectId, { title, content });
    log.info(`Rule created: ${rule.id} in project ${projectId}`);
    respond(true, rule);
  } catch (err) {
    log.error(`Failed to create rule: ${String(err)}`);
    respond(false, undefined, { message: "Failed to create rule", code: 500 });
  }
};

// ─── Update Project Rule ───

const handleProjectsRulesUpdate: GatewayRequestHandler = async ({ params, respond }) => {
  const projectId = params.projectId as string;
  const ruleId = params.ruleId as string;
  const title = params.title as string | undefined;
  const content = params.content as string | undefined;

  if (!projectId || !ruleId) {
    respond(false, undefined, { message: "projectId and ruleId are required", code: 400 });
    return;
  }

  try {
    const updated = await updateProjectRule(projectId, ruleId, {
      title: title?.trim(),
      content: content?.trim(),
    });
    log.info(`Rule updated: ${ruleId} in project ${projectId}`);
    respond(true, updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      respond(false, undefined, { message: "Rule not found", code: 404 });
    } else {
      log.error(`Failed to update rule: ${String(err)}`);
      respond(false, undefined, { message: "Failed to update rule", code: 500 });
    }
  }
};

// ─── Delete Project Rule ───

const handleProjectsRulesDelete: GatewayRequestHandler = async ({ params, respond }) => {
  const projectId = params.projectId as string;
  const ruleId = params.ruleId as string;

  if (!projectId || !ruleId) {
    respond(false, undefined, { message: "projectId and ruleId are required", code: 400 });
    return;
  }

  const rule = loadProjectRule(projectId, ruleId);
  if (!rule) {
    respond(false, undefined, { message: "Rule not found", code: 404 });
    return;
  }

  try {
    await deleteProjectRule(projectId, ruleId);
    log.info(`Rule deleted: ${ruleId} in project ${projectId}`);
    respond(true, { ok: true });
  } catch (err) {
    log.error(`Failed to delete rule: ${String(err)}`);
    respond(false, undefined, { message: "Failed to delete rule", code: 500 });
  }
};

// ─── Export Handlers (moved to end of file) ───

// ─── Group Integration (Phase 2) ───

const handleProjectsGetLinkedGroups: GatewayRequestHandler = ({ params, respond }) => {
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

  const groups = findGroupsByProjectId(projectId);
  respond(true, groups);
};

const handleProjectsLinkGroup: GatewayRequestHandler = async ({ params, respond }) => {
  const projectId = params.projectId as string;
  const groupId = params.groupId as string;

  if (!projectId || !groupId) {
    respond(false, undefined, { message: "projectId and groupId are required", code: 400 });
    return;
  }

  const projectMeta = loadProjectMeta(projectId);
  if (!projectMeta) {
    respond(false, undefined, { message: "Project not found", code: 404 });
    return;
  }

  const groupMeta = loadGroupMeta(groupId);
  if (!groupMeta) {
    respond(false, undefined, { message: "Group not found", code: 404 });
    return;
  }

  try {
    await updateGroupMeta(groupId, (meta) => ({
      ...meta,
      projectId,
      // Inherit project settings if not already set
      project: meta.project ?? {
        directory: projectMeta.directory,
        docs: projectMeta.documents,
      },
    }));
    log.info(`Group ${groupId} linked to project ${projectId}`);
    respond(true, { ok: true });
  } catch (err) {
    log.error(`Failed to link group: ${String(err)}`);
    respond(false, undefined, { message: "Failed to link group", code: 500 });
  }
};

const handleProjectsUnlinkGroup: GatewayRequestHandler = async ({ params, respond }) => {
  const projectId = params.projectId as string;
  const groupId = params.groupId as string;

  if (!projectId || !groupId) {
    respond(false, undefined, { message: "projectId and groupId are required", code: 400 });
    return;
  }

  const groupMeta = loadGroupMeta(groupId);
  if (!groupMeta) {
    respond(false, undefined, { message: "Group not found", code: 404 });
    return;
  }

  // Verify the group is actually linked to this project
  if (groupMeta.projectId !== projectId) {
    respond(false, undefined, { message: "Group is not linked to this project", code: 400 });
    return;
  }

  try {
    await updateGroupMeta(groupId, (meta) => {
      const { projectId: _, ...rest } = meta;
      return rest as typeof meta;
    });
    log.info(`Group ${groupId} unlinked from project ${projectId}`);
    respond(true, { ok: true });
  } catch (err) {
    log.error(`Failed to unlink group: ${String(err)}`);
    respond(false, undefined, { message: "Failed to unlink group", code: 500 });
  }
};

// ─── Export Handlers ───

// ─── Project Skills CRUD ───

const handleProjectsSkillsList: GatewayRequestHandler = ({ params, respond }) => {
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

  const skills = loadProjectSkills(projectId);
  respond(true, skills);
};

const handleProjectsSkillsGet: GatewayRequestHandler = ({ params, respond }) => {
  const projectId = params.projectId as string;
  const skillId = params.skillId as string;
  if (!projectId || !skillId) {
    respond(false, undefined, { message: "projectId and skillId are required", code: 400 });
    return;
  }

  const skill = loadProjectSkill(projectId, skillId);
  if (!skill) {
    respond(false, undefined, { message: "Skill not found", code: 404 });
    return;
  }

  respond(true, skill);
};

const handleProjectsSkillsCreate: GatewayRequestHandler = async ({ params, respond }) => {
  const projectId = params.projectId as string;
  const name = (params.name as string)?.trim();
  const content = (params.content as string)?.trim();

  if (!projectId) {
    respond(false, undefined, { message: "projectId is required", code: 400 });
    return;
  }
  if (!name) {
    respond(false, undefined, { message: "Skill name is required", code: 400 });
    return;
  }
  if (!content) {
    respond(false, undefined, { message: "Skill content is required", code: 400 });
    return;
  }

  const meta = loadProjectMeta(projectId);
  if (!meta) {
    respond(false, undefined, { message: "Project not found", code: 404 });
    return;
  }

  try {
    const skill = await createProjectSkill(projectId, { name, content });
    log.info(`Skill created: ${skill.id} in project ${projectId}`);
    respond(true, skill);
  } catch (err) {
    log.error(`Failed to create skill: ${String(err)}`);
    respond(false, undefined, { message: "Failed to create skill", code: 500 });
  }
};

const handleProjectsSkillsUpdate: GatewayRequestHandler = async ({ params, respond }) => {
  const projectId = params.projectId as string;
  const skillId = params.skillId as string;
  const name = params.name as string | undefined;
  const content = params.content as string | undefined;

  if (!projectId || !skillId) {
    respond(false, undefined, { message: "projectId and skillId are required", code: 400 });
    return;
  }

  try {
    const updated = await updateProjectSkill(projectId, skillId, {
      name: name?.trim(),
      content: content?.trim(),
    });
    log.info(`Skill updated: ${skillId} in project ${projectId}`);
    respond(true, updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      respond(false, undefined, { message: "Skill not found", code: 404 });
    } else {
      log.error(`Failed to update skill: ${String(err)}`);
      respond(false, undefined, { message: "Failed to update skill", code: 500 });
    }
  }
};

const handleProjectsSkillsDelete: GatewayRequestHandler = async ({ params, respond }) => {
  const projectId = params.projectId as string;
  const skillId = params.skillId as string;

  if (!projectId || !skillId) {
    respond(false, undefined, { message: "projectId and skillId are required", code: 400 });
    return;
  }

  const skill = loadProjectSkill(projectId, skillId);
  if (!skill) {
    respond(false, undefined, { message: "Skill not found", code: 404 });
    return;
  }

  try {
    await deleteProjectSkill(projectId, skillId);
    log.info(`Skill deleted: ${skillId} in project ${projectId}`);
    respond(true, { ok: true });
  } catch (err) {
    log.error(`Failed to delete skill: ${String(err)}`);
    respond(false, undefined, { message: "Failed to delete skill", code: 500 });
  }
};

// ─── Project Docs CRUD ───

const handleProjectsDocsList: GatewayRequestHandler = ({ params, respond }) => {
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

  const docs = loadProjectDocs(projectId);
  respond(true, docs);
};

const handleProjectsDocsGet: GatewayRequestHandler = ({ params, respond }) => {
  const projectId = params.projectId as string;
  const docId = params.docId as string;
  if (!projectId || !docId) {
    respond(false, undefined, { message: "projectId and docId are required", code: 400 });
    return;
  }

  const doc = loadProjectDoc(projectId, docId);
  if (!doc) {
    respond(false, undefined, { message: "Doc not found", code: 404 });
    return;
  }

  respond(true, doc);
};

const handleProjectsDocsCreate: GatewayRequestHandler = async ({ params, respond }) => {
  const projectId = params.projectId as string;
  const name = (params.name as string)?.trim();
  const content = (params.content as string)?.trim();

  if (!projectId) {
    respond(false, undefined, { message: "projectId is required", code: 400 });
    return;
  }
  if (!name) {
    respond(false, undefined, { message: "Doc name is required", code: 400 });
    return;
  }
  if (!content) {
    respond(false, undefined, { message: "Doc content is required", code: 400 });
    return;
  }

  const meta = loadProjectMeta(projectId);
  if (!meta) {
    respond(false, undefined, { message: "Project not found", code: 404 });
    return;
  }

  try {
    const doc = await createProjectDoc(projectId, { name, content });
    log.info(`Doc created: ${doc.id} in project ${projectId}`);
    respond(true, doc);
  } catch (err) {
    log.error(`Failed to create doc: ${String(err)}`);
    respond(false, undefined, { message: "Failed to create doc", code: 500 });
  }
};

const handleProjectsDocsUpdate: GatewayRequestHandler = async ({ params, respond }) => {
  const projectId = params.projectId as string;
  const docId = params.docId as string;
  const name = params.name as string | undefined;
  const content = params.content as string | undefined;

  if (!projectId || !docId) {
    respond(false, undefined, { message: "projectId and docId are required", code: 400 });
    return;
  }

  try {
    const updated = await updateProjectDoc(projectId, docId, {
      name: name?.trim(),
      content: content?.trim(),
    });
    log.info(`Doc updated: ${docId} in project ${projectId}`);
    respond(true, updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not found")) {
      respond(false, undefined, { message: "Doc not found", code: 404 });
    } else {
      log.error(`Failed to update doc: ${String(err)}`);
      respond(false, undefined, { message: "Failed to update doc", code: 500 });
    }
  }
};

const handleProjectsDocsDelete: GatewayRequestHandler = async ({ params, respond }) => {
  const projectId = params.projectId as string;
  const docId = params.docId as string;

  if (!projectId || !docId) {
    respond(false, undefined, { message: "projectId and docId are required", code: 400 });
    return;
  }

  const doc = loadProjectDoc(projectId, docId);
  if (!doc) {
    respond(false, undefined, { message: "Doc not found", code: 404 });
    return;
  }

  try {
    await deleteProjectDoc(projectId, docId);
    log.info(`Doc deleted: ${docId} in project ${projectId}`);
    respond(true, { ok: true });
  } catch (err) {
    log.error(`Failed to delete doc: ${String(err)}`);
    respond(false, undefined, { message: "Failed to delete doc", code: 500 });
  }
};

// ─── Export Handlers ───

export const projectsHandlers: GatewayRequestHandlers = {
  "projects.list": handleProjectsList,
  "projects.info": handleProjectsInfo,
  "projects.create": handleProjectsCreate,
  "projects.update": handleProjectsUpdate,
  "projects.delete": handleProjectsDelete,
  "projects.validatePaths": handleProjectsValidatePaths,
  "projects.rules.list": handleProjectsRulesList,
  "projects.rules.get": handleProjectsRulesGet,
  "projects.rules.create": handleProjectsRulesCreate,
  "projects.rules.update": handleProjectsRulesUpdate,
  "projects.rules.delete": handleProjectsRulesDelete,
  // Skills
  "projects.skills.list": handleProjectsSkillsList,
  "projects.skills.get": handleProjectsSkillsGet,
  "projects.skills.create": handleProjectsSkillsCreate,
  "projects.skills.update": handleProjectsSkillsUpdate,
  "projects.skills.delete": handleProjectsSkillsDelete,
  // Docs
  "projects.docs.list": handleProjectsDocsList,
  "projects.docs.get": handleProjectsDocsGet,
  "projects.docs.create": handleProjectsDocsCreate,
  "projects.docs.update": handleProjectsDocsUpdate,
  "projects.docs.delete": handleProjectsDocsDelete,
  // Phase 2: Group integration
  "projects.getLinkedGroups": handleProjectsGetLinkedGroups,
  "projects.linkGroup": handleProjectsLinkGroup,
  "projects.unlinkGroup": handleProjectsUnlinkGroup,
};
