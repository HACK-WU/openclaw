/**
 * Group Chat — Storage Layer
 *
 * Manages group chat metadata (meta.json) and index (index.json).
 * Storage root: ~/.openclaw/group-chats/
 *
 * Replicates session store patterns:
 * - Memory queue lock per groupId
 * - Atomic write (temp file + rename)
 * - In-memory cache with TTL + mtime invalidation
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import type { BridgeConfig, ContextConfig } from "./bridge-types.js";
import type { GroupIndexEntry, GroupMember, GroupSessionEntry } from "./types.js";

// ─── Path resolution ───
// Use dynamic resolveStateDir() instead of the module-level STATE_DIR constant
// to ensure the correct state directory is used when running under a CLI profile
// (e.g. --dev → ~/.openclaw-dev instead of ~/.openclaw).

function resolveGroupChatsRoot(): string {
  return path.join(resolveStateDir(), "group-chats");
}

export function resolveGroupChatsDir(): string {
  return resolveGroupChatsRoot();
}

export function resolveGroupDir(groupId: string): string {
  return path.join(resolveGroupChatsRoot(), groupId);
}

export function resolveGroupIndexPath(): string {
  return path.join(resolveGroupChatsRoot(), "index.json");
}

export function resolveGroupMetaPath(groupId: string): string {
  return path.join(resolveGroupDir(groupId), "meta.json");
}

export function resolveGroupTranscriptPath(groupId: string): string {
  return path.join(resolveGroupDir(groupId), "transcript.jsonl");
}

// ─── Lock mechanism (per-groupId memory queue) ───

const groupLocks = new Map<string, Promise<void>>();

export async function withGroupLock<T>(groupId: string, fn: () => Promise<T>): Promise<T> {
  const prev = groupLocks.get(groupId) ?? Promise.resolve();
  let resolve!: () => void;
  const next = new Promise<void>((r) => {
    resolve = r;
  });
  groupLocks.set(groupId, next);

  await prev;
  try {
    return await fn();
  } finally {
    resolve();
    if (groupLocks.get(groupId) === next) {
      groupLocks.delete(groupId);
    }
  }
}

// ─── Cache ───

type CacheEntry<T> = { data: T; mtime: number; loadedAt: number };

const INDEX_CACHE_TTL_MS = 45_000;
const META_CACHE_TTL_MS = 30_000;

let indexCache: CacheEntry<GroupIndexEntry[]> | null = null;
const metaCache = new Map<string, CacheEntry<GroupSessionEntry>>();

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

function invalidateMetaCache(groupId: string): void {
  metaCache.delete(groupId);
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

export function loadGroupIndex(): GroupIndexEntry[] {
  const filePath = resolveGroupIndexPath();
  if (isCacheValid(indexCache, INDEX_CACHE_TTL_MS, filePath)) {
    return structuredClone(indexCache!.data);
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data: GroupIndexEntry[] = JSON.parse(raw);
    const stat = fs.statSync(filePath);
    indexCache = { data, mtime: stat.mtimeMs, loadedAt: Date.now() };
    return structuredClone(data);
  } catch {
    return [];
  }
}

export async function updateGroupIndex(
  mutator: (index: GroupIndexEntry[]) => GroupIndexEntry[],
): Promise<void> {
  const filePath = resolveGroupIndexPath();
  const current = loadGroupIndex();
  const next = mutator(current);
  await atomicWriteJson(filePath, next);
  invalidateIndexCache();
}

// ─── Group CRUD ───

export async function createGroup(params: {
  name?: string;
  members: Array<{
    agentId: string;
    role: "assistant" | "member" | "bridge-assistant";
    bridge?: BridgeConfig;
  }>;
  messageMode?: "unicast" | "broadcast";
  project?: {
    directory?: string;
    docs?: string[];
  };
  contextConfig?: ContextConfig;
}): Promise<GroupSessionEntry> {
  const groupId = randomUUID();
  const now = Date.now();

  const members: GroupMember[] = params.members.map((m) => ({
    agentId: m.agentId,
    role: m.role,
    joinedAt: now,
    ...(m.bridge ? { bridge: m.bridge } : {}),
  }));

  const entry: GroupSessionEntry = {
    groupId,
    groupName: params.name || undefined,
    messageMode: params.messageMode ?? "unicast",
    members,
    memberRolePrompts: [],
    groupSkills: [],
    maxRounds: 10,
    maxConsecutive: 3,
    historyLimit: 50,
    compaction: { enabled: true, maxHistoryShare: 0.5, reserveTokensFloor: 20_000 },
    createdAt: now,
    updatedAt: now,
    ...(params.project ? { project: params.project } : {}),
    ...(params.contextConfig ? { contextConfig: params.contextConfig } : {}),
  };

  // Create directory and write meta
  const groupDir = resolveGroupDir(groupId);
  ensureDir(groupDir);
  await atomicWriteJson(resolveGroupMetaPath(groupId), entry);

  // Initialize empty transcript with session header
  const transcriptPath = resolveGroupTranscriptPath(groupId);
  const header = {
    type: "session",
    version: "1.0",
    id: groupId,
    timestamp: new Date(now).toISOString(),
    sessionType: "group",
  };
  await fs.promises.writeFile(transcriptPath, `${JSON.stringify(header)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });

  // Update index
  await updateGroupIndex((idx) => [
    ...idx,
    { groupId, groupName: entry.groupName, updatedAt: now },
  ]);

  return entry;
}

export function loadGroupMeta(groupId: string): GroupSessionEntry | null {
  const filePath = resolveGroupMetaPath(groupId);
  const cached = metaCache.get(groupId);
  if (isCacheValid(cached, META_CACHE_TTL_MS, filePath)) {
    return structuredClone(cached!.data);
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const data: GroupSessionEntry = JSON.parse(raw);
    const stat = fs.statSync(filePath);
    metaCache.set(groupId, { data, mtime: stat.mtimeMs, loadedAt: Date.now() });
    return structuredClone(data);
  } catch {
    return null;
  }
}

export async function updateGroupMeta(
  groupId: string,
  mutator: (meta: GroupSessionEntry) => GroupSessionEntry,
): Promise<GroupSessionEntry> {
  return withGroupLock(groupId, async () => {
    invalidateMetaCache(groupId);
    const current = loadGroupMeta(groupId);
    if (!current) {
      throw new Error(`Group ${groupId} not found`);
    }

    const next = mutator(current);
    next.updatedAt = Date.now();
    await atomicWriteJson(resolveGroupMetaPath(groupId), next);
    invalidateMetaCache(groupId);

    // Update index timestamp
    await updateGroupIndex((idx) =>
      idx.map((e) =>
        e.groupId === groupId ? { ...e, groupName: next.groupName, updatedAt: next.updatedAt } : e,
      ),
    );

    return next;
  });
}

export async function archiveGroup(groupId: string): Promise<void> {
  await updateGroupMeta(groupId, (meta) => ({ ...meta, archived: true }));
  await updateGroupIndex((idx) =>
    idx.map((e) => (e.groupId === groupId ? { ...e, archived: true } : e)),
  );
}

export async function deleteGroup(groupId: string): Promise<void> {
  const groupDir = resolveGroupDir(groupId);
  try {
    await fs.promises.rm(groupDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  invalidateMetaCache(groupId);
  await updateGroupIndex((idx) => idx.filter((e) => e.groupId !== groupId));
}
