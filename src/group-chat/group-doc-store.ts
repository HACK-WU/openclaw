/**
 * Group Chat — Document Store
 *
 * Manages group-level shared documents stored under:
 *   ~/.openclaw/group-chats/{groupId}/docs/
 *
 * Structure:
 *   docs/
 *     index.json      — lightweight document index
 *     {docId}.md      — Markdown document file
 *
 * Follows the same patterns as group-store.ts:
 * - Atomic write (temp file + rename)
 * - In-memory cache with TTL + mtime invalidation
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getLogger } from "../logging.js";
import { resolveGroupDir } from "./group-store.js";
import type { GroupDoc, GroupDocIndexEntry } from "./types.js";

const log = getLogger("group-chat:doc-store");

// ─── Path Resolution ───

function resolveGroupDocsDir(groupId: string): string {
  return path.join(resolveGroupDir(groupId), "docs");
}

function resolveGroupDocsIndexPath(groupId: string): string {
  return path.join(resolveGroupDocsDir(groupId), "index.json");
}

function resolveGroupDocFilePath(groupId: string, docId: string): string {
  return path.join(resolveGroupDocsDir(groupId), `${docId}.md`);
}

// ─── Atomic Write ───

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmpPath = `${filePath}.${randomUUID().slice(0, 8)}.tmp`;
  const content = JSON.stringify(data, null, 2);
  await fs.promises.writeFile(tmpPath, content, { encoding: "utf-8", mode: 0o600 });
  await fs.promises.rename(tmpPath, filePath);
}

// ─── Cache ───

type CacheEntry<T> = { data: T; mtime: number; loadedAt: number };
const CACHE_TTL_MS = 30_000;

const docIndexCache = new Map<string, CacheEntry<GroupDocIndexEntry[]>>();

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

function invalidateDocIndexCache(groupId: string): void {
  docIndexCache.delete(groupId);
}

// ─── Index Operations ───

export function loadGroupDocsIndex(groupId: string): GroupDocIndexEntry[] {
  const indexPath = resolveGroupDocsIndexPath(groupId);
  const cached = docIndexCache.get(groupId);
  if (isCacheValid(cached, CACHE_TTL_MS, indexPath)) {
    return structuredClone(cached!.data);
  }

  try {
    const raw = fs.readFileSync(indexPath, "utf-8");
    const data: GroupDocIndexEntry[] = JSON.parse(raw);
    const stat = fs.statSync(indexPath);
    docIndexCache.set(groupId, { data, mtime: stat.mtimeMs, loadedAt: Date.now() });
    return structuredClone(data);
  } catch {
    return [];
  }
}

async function updateGroupDocsIndex(
  groupId: string,
  mutator: (index: GroupDocIndexEntry[]) => GroupDocIndexEntry[],
): Promise<void> {
  const current = loadGroupDocsIndex(groupId);
  const next = mutator(current);
  await atomicWriteJson(resolveGroupDocsIndexPath(groupId), next);
  invalidateDocIndexCache(groupId);
}

// ─── Document CRUD ───

export function loadGroupDoc(groupId: string, docId: string): GroupDoc | null {
  const docPath = resolveGroupDocFilePath(groupId, docId);
  if (!fs.existsSync(docPath)) {
    return null;
  }

  const content = fs.readFileSync(docPath, "utf-8");
  const index = loadGroupDocsIndex(groupId);
  const entry = index.find((e) => e.id === docId);
  if (!entry) {
    return null;
  }

  return {
    id: docId,
    groupId,
    name: entry.name,
    content,
    createdBy: entry.createdBy,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

export async function createGroupDoc(params: {
  groupId: string;
  name: string;
  content: string;
  createdBy: string;
}): Promise<GroupDoc> {
  const { groupId, name, content, createdBy } = params;
  const docsDir = resolveGroupDocsDir(groupId);
  fs.mkdirSync(docsDir, { recursive: true });

  const docId = randomUUID();
  const now = Date.now();

  // Write document file
  const docPath = resolveGroupDocFilePath(groupId, docId);
  await fs.promises.writeFile(docPath, content, { encoding: "utf-8", mode: 0o600 });

  // Update index
  const newEntry: GroupDocIndexEntry = {
    id: docId,
    name,
    createdBy,
    createdAt: now,
    updatedAt: now,
    size: Buffer.byteLength(content, "utf-8"),
  };

  await updateGroupDocsIndex(groupId, (index) => {
    index.push(newEntry);
    index.sort((a, b) => b.updatedAt - a.updatedAt);
    return index;
  });

  log.info(`Group doc created: ${docId} (${name}) in group ${groupId}`);

  return {
    id: docId,
    groupId,
    name,
    content,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateGroupDoc(
  groupId: string,
  docId: string,
  content: string,
): Promise<GroupDoc | null> {
  const docPath = resolveGroupDocFilePath(groupId, docId);
  if (!fs.existsSync(docPath)) {
    return null;
  }

  await fs.promises.writeFile(docPath, content, { encoding: "utf-8", mode: 0o600 });

  const now = Date.now();
  await updateGroupDocsIndex(groupId, (index) => {
    const entry = index.find((e) => e.id === docId);
    if (entry) {
      entry.updatedAt = now;
      entry.size = Buffer.byteLength(content, "utf-8");
    }
    return index;
  });

  return loadGroupDoc(groupId, docId);
}

export async function renameGroupDoc(
  groupId: string,
  docId: string,
  name: string,
): Promise<GroupDoc | null> {
  const docPath = resolveGroupDocFilePath(groupId, docId);
  if (!fs.existsSync(docPath)) {
    return null;
  }

  await updateGroupDocsIndex(groupId, (index) => {
    const entry = index.find((e) => e.id === docId);
    if (entry) {
      entry.name = name;
      entry.updatedAt = Date.now();
    }
    return index;
  });

  return loadGroupDoc(groupId, docId);
}

export async function deleteGroupDoc(groupId: string, docId: string): Promise<boolean> {
  const docPath = resolveGroupDocFilePath(groupId, docId);
  if (!fs.existsSync(docPath)) {
    return false;
  }

  await fs.promises.unlink(docPath);
  await updateGroupDocsIndex(groupId, (index) => index.filter((e) => e.id !== docId));

  log.info(`Group doc deleted: ${docId} in group ${groupId}`);
  return true;
}

/** Refresh the document index by scanning the docs directory on disk. */
export async function refreshGroupDocsIndex(groupId: string): Promise<GroupDocIndexEntry[]> {
  const docsDir = resolveGroupDocsDir(groupId);
  if (!fs.existsSync(docsDir)) {
    invalidateDocIndexCache(groupId);
    return [];
  }

  const files = fs.readdirSync(docsDir).filter((f) => f.endsWith(".md"));
  const index: GroupDocIndexEntry[] = [];

  for (const file of files) {
    const docId = file.replace(/\.md$/, "");
    const filePath = path.join(docsDir, file);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }

    // Try to match with existing index entry for metadata (name, createdBy)
    const existingIndex = loadGroupDocsIndex(groupId);
    const existing = existingIndex.find((e) => e.id === docId);

    index.push({
      id: docId,
      name: existing?.name ?? docId,
      createdBy: existing?.createdBy ?? "unknown",
      createdAt: stat.birthtimeMs,
      updatedAt: stat.mtimeMs,
      size: stat.size,
    });
  }

  index.sort((a, b) => b.updatedAt - a.updatedAt);
  await atomicWriteJson(resolveGroupDocsIndexPath(groupId), index);
  invalidateDocIndexCache(groupId);

  return index;
}

/** Get the docs directory path for a group (used in context injection). */
export function getGroupDocsPath(groupId: string): string {
  return resolveGroupDocsDir(groupId);
}

/** Clean up docs directory when a group is deleted. */
export async function cleanupGroupDocs(groupId: string): Promise<void> {
  const docsDir = resolveGroupDocsDir(groupId);
  try {
    await fs.promises.rm(docsDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  invalidateDocIndexCache(groupId);
}
