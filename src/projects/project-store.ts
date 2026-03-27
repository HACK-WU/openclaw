/**
 * Project Management — Storage Layer
 *
 * Manages project metadata (meta.json) and index (index.json).
 * Storage root: ~/.openclaw/projects/
 *
 * Replicates group-store patterns:
 * - Memory queue lock per projectId
 * - Atomic write (temp file + rename)
 * - In-memory cache with TTL + mtime invalidation
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { Project, ProjectIndexEntry, ProjectRule } from "./types.js";

// ─── Path resolution ───

function resolveProjectsRoot(): string {
  return path.join(resolveStateDir(), "projects");
}

export function resolveProjectsDir(): string {
  return resolveProjectsRoot();
}

export function resolveProjectDir(projectId: string): string {
  return path.join(resolveProjectsRoot(), projectId);
}

export function resolveProjectIndexPath(): string {
  return path.join(resolveProjectsRoot(), "index.json");
}

export function resolveProjectMetaPath(projectId: string): string {
  return path.join(resolveProjectDir(projectId), "meta.json");
}

// ─── Lock mechanism (per-projectId memory queue) ───

const projectLocks = new Map<string, Promise<void>>();

export async function withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = projectLocks.get(projectId) ?? Promise.resolve();
  let resolve!: () => void;
  const next = new Promise<void>((r) => {
    resolve = r;
  });
  projectLocks.set(projectId, next);

  await prev;
  try {
    return await fn();
  } finally {
    resolve();
    if (projectLocks.get(projectId) === next) {
      projectLocks.delete(projectId);
    }
  }
}

// ─── Cache ───

type CacheEntry<T> = { data: T; mtime: number; loadedAt: number };

const INDEX_CACHE_TTL_MS = 45_000;
const META_CACHE_TTL_MS = 30_000;

let indexCache: CacheEntry<ProjectIndexEntry[]> | null = null;
const metaCache = new Map<string, CacheEntry<Project>>();

function isCacheValid<T>(
  entry: CacheEntry<T> | null | undefined,
  ttl: number,
  filePath: string,
): boolean {
  if (!entry) {
    return false;
  }
  if (Date.now() - entry.loadedAt > ttl) {
    return false;
  }
  try {
    const stat = fs.statSync(filePath);
    return stat.mtimeMs === entry.mtime;
  } catch {
    return false;
  }
}

function invalidateIndexCache(): void {
  indexCache = null;
}

function invalidateMetaCache(projectId: string): void {
  metaCache.delete(projectId);
}

// ─── Ensure storage dir exists ───

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

// ─── Atomic write helper ───

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmpPath = `${filePath}.${randomUUID().slice(0, 8)}.tmp`;
  const content = JSON.stringify(data, null, 2);
  await fs.promises.writeFile(tmpPath, content, { encoding: "utf-8", mode: 0o600 });
  await fs.promises.rename(tmpPath, filePath);
}

// ─── Index operations ───

export function loadProjectIndex(): ProjectIndexEntry[] {
  const filePath = resolveProjectIndexPath();
  if (isCacheValid(indexCache, INDEX_CACHE_TTL_MS, filePath)) {
    return structuredClone(indexCache!.data);
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data: ProjectIndexEntry[] = JSON.parse(raw);
    const stat = fs.statSync(filePath);
    indexCache = { data, mtime: stat.mtimeMs, loadedAt: Date.now() };
    return structuredClone(data);
  } catch {
    return [];
  }
}

export async function updateProjectIndex(
  mutator: (index: ProjectIndexEntry[]) => ProjectIndexEntry[],
): Promise<void> {
  const filePath = resolveProjectIndexPath();
  const current = loadProjectIndex();
  const next = mutator(current);
  await atomicWriteJson(filePath, next);
  invalidateIndexCache();
}

// ─── Project CRUD ───

export async function createProject(params: {
  name: string;
  directory: string;
  documents?: string[];
  description?: string;
}): Promise<Project> {
  const projectId = randomUUID();
  const now = Date.now();

  const project: Project = {
    id: projectId,
    name: params.name,
    directory: params.directory,
    documents: params.documents ?? [],
    description: params.description || undefined,
    createdAt: now,
    updatedAt: now,
  };

  // 创建目录并写入 meta
  const projectDir = resolveProjectDir(projectId);
  ensureDir(projectDir);
  await atomicWriteJson(resolveProjectMetaPath(projectId), project);

  // 更新索引
  await updateProjectIndex((idx) => [
    ...idx,
    { id: projectId, name: project.name, updatedAt: now },
  ]);

  return project;
}

export function loadProjectMeta(projectId: string): Project | null {
  const filePath = resolveProjectMetaPath(projectId);
  const cached = metaCache.get(projectId);
  if (isCacheValid(cached, META_CACHE_TTL_MS, filePath)) {
    return structuredClone(cached!.data);
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data: Project = JSON.parse(raw);
    const stat = fs.statSync(filePath);
    metaCache.set(projectId, { data, mtime: stat.mtimeMs, loadedAt: Date.now() });
    return structuredClone(data);
  } catch {
    return null;
  }
}

export async function updateProjectMeta(
  projectId: string,
  mutator: (meta: Project) => Project,
): Promise<Project> {
  return withProjectLock(projectId, async () => {
    invalidateMetaCache(projectId);
    const current = loadProjectMeta(projectId);
    if (!current) {
      throw new Error(`Project ${projectId} not found`);
    }

    const next = mutator(current);
    next.updatedAt = Date.now();
    await atomicWriteJson(resolveProjectMetaPath(projectId), next);
    invalidateMetaCache(projectId);

    // 更新索引时间戳
    await updateProjectIndex((idx) =>
      idx.map((e) =>
        e.id === projectId ? { ...e, name: next.name, updatedAt: next.updatedAt } : e,
      ),
    );

    return next;
  });
}

export async function deleteProject(projectId: string): Promise<void> {
  const projectDir = resolveProjectDir(projectId);
  try {
    await fs.promises.rm(projectDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  invalidateMetaCache(projectId);
  await updateProjectIndex((idx) => idx.filter((e) => e.id !== projectId));
}

/**
 * 按名称查找项目（用于唯一性校验）
 */
export function findProjectByName(name: string): Project | null {
  const index = loadProjectIndex();
  const entry = index.find((e) => e.name === name);
  if (!entry) {
    return null;
  }
  return loadProjectMeta(entry.id);
}

// ─── Project Rules CRUD ───

export function resolveProjectRulesDir(projectId: string): string {
  return path.join(resolveProjectDir(projectId), "rules");
}

export function resolveProjectRulePath(projectId: string, ruleId: string): string {
  return path.join(resolveProjectRulesDir(projectId), `${ruleId}.json`);
}

/**
 * 加载项目的所有规则
 */
export function loadProjectRules(projectId: string): ProjectRule[] {
  const rulesDir = resolveProjectRulesDir(projectId);
  try {
    const entries = fs.readdirSync(rulesDir);
    const rules: ProjectRule[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) {
        continue;
      }
      try {
        const raw = fs.readFileSync(path.join(rulesDir, entry), "utf-8");
        const rule: ProjectRule = JSON.parse(raw);
        rules.push(rule);
      } catch {
        // 跳过无法解析的文件
      }
    }
    // 按创建时间排序
    rules.sort((a, b) => a.createdAt - b.createdAt);
    return rules;
  } catch {
    return [];
  }
}

/**
 * 加载单条规则
 */
export function loadProjectRule(projectId: string, ruleId: string): ProjectRule | null {
  const filePath = resolveProjectRulePath(projectId, ruleId);
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ProjectRule;
  } catch {
    return null;
  }
}

/**
 * 创建项目规则
 */
export async function createProjectRule(
  projectId: string,
  params: { title: string; content: string },
): Promise<ProjectRule> {
  const ruleId = randomUUID();
  const now = Date.now();

  const rule: ProjectRule = {
    id: ruleId,
    projectId,
    title: params.title,
    content: params.content,
    createdAt: now,
    updatedAt: now,
  };

  const rulesDir = resolveProjectRulesDir(projectId);
  ensureDir(rulesDir);
  await atomicWriteJson(resolveProjectRulePath(projectId, ruleId), rule);

  return rule;
}

/**
 * 更新项目规则
 */
export async function updateProjectRule(
  projectId: string,
  ruleId: string,
  params: { title?: string; content?: string },
): Promise<ProjectRule> {
  return withProjectLock(`rule:${ruleId}`, async () => {
    const current = loadProjectRule(projectId, ruleId);
    if (!current) {
      throw new Error(`Rule ${ruleId} not found in project ${projectId}`);
    }

    const updated: ProjectRule = {
      ...current,
      ...(params.title !== undefined ? { title: params.title } : {}),
      ...(params.content !== undefined ? { content: params.content } : {}),
      updatedAt: Date.now(),
    };

    await atomicWriteJson(resolveProjectRulePath(projectId, ruleId), updated);
    return updated;
  });
}

/**
 * 删除项目规则
 */
export async function deleteProjectRule(projectId: string, ruleId: string): Promise<void> {
  const filePath = resolveProjectRulePath(projectId, ruleId);
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // 文件不存在则忽略
  }
}
