import fs from "node:fs";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import {
  AVATAR_MAX_BYTES,
  isAvatarDataUrl,
  isAvatarHttpUrl,
  isPathWithinRoot,
  isSupportedLocalAvatarExtension,
} from "../shared/avatar-policy.js";
import { resolveUserPath } from "../utils.js";
import { resolveAgentIdentityDir, resolveAgentWorkspaceDir } from "./agent-scope.js";
import { loadAgentIdentityFromWorkspace } from "./identity-file.js";
import { resolveAgentIdentity } from "./identity.js";

export type AgentAvatarResolution =
  | { kind: "none"; reason: string }
  | { kind: "local"; filePath: string }
  | { kind: "remote"; url: string }
  | { kind: "data"; url: string };

function normalizeAvatarValue(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function resolveAvatarSource(cfg: OpenClawConfig, agentId: string): string | null {
  const fromConfig = normalizeAvatarValue(resolveAgentIdentity(cfg, agentId)?.avatar);
  if (fromConfig) {
    return fromConfig;
  }
  // Try identityDir first, then fall back to workspace dir
  const identityDir = resolveAgentIdentityDir(cfg, agentId);
  const fromIdentityDir = normalizeAvatarValue(loadAgentIdentityFromWorkspace(identityDir)?.avatar);
  if (fromIdentityDir) {
    return fromIdentityDir;
  }
  const workspace = resolveAgentWorkspaceDir(cfg, agentId);
  if (workspace !== identityDir) {
    const fromWorkspace = normalizeAvatarValue(loadAgentIdentityFromWorkspace(workspace)?.avatar);
    return fromWorkspace;
  }
  return null;
}

function resolveExistingPath(value: string): string {
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

function resolveLocalAvatarPath(params: {
  raw: string;
  workspaceDir: string;
}): { ok: true; filePath: string } | { ok: false; reason: string } {
  const workspaceRoot = resolveExistingPath(params.workspaceDir);
  const raw = params.raw;
  const resolved =
    raw.startsWith("~") || path.isAbsolute(raw)
      ? resolveUserPath(raw)
      : path.resolve(workspaceRoot, raw);
  const realPath = resolveExistingPath(resolved);
  if (!isPathWithinRoot(workspaceRoot, realPath)) {
    return { ok: false, reason: "outside_workspace" };
  }
  if (!isSupportedLocalAvatarExtension(realPath)) {
    return { ok: false, reason: "unsupported_extension" };
  }
  try {
    const stat = fs.statSync(realPath);
    if (!stat.isFile()) {
      return { ok: false, reason: "missing" };
    }
    if (stat.size > AVATAR_MAX_BYTES) {
      return { ok: false, reason: "too_large" };
    }
  } catch {
    return { ok: false, reason: "missing" };
  }
  return { ok: true, filePath: realPath };
}

export function resolveAgentAvatar(cfg: OpenClawConfig, agentId: string): AgentAvatarResolution {
  const source = resolveAvatarSource(cfg, agentId);
  if (!source) {
    return { kind: "none", reason: "missing" };
  }
  if (isAvatarHttpUrl(source)) {
    return { kind: "remote", url: source };
  }
  if (isAvatarDataUrl(source)) {
    return { kind: "data", url: source };
  }
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  const resolved = resolveLocalAvatarPath({ raw: source, workspaceDir });
  if (!resolved.ok) {
    return { kind: "none", reason: resolved.reason };
  }
  return { kind: "local", filePath: resolved.filePath };
}
