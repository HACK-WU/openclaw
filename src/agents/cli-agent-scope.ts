/**
 * CLI Agent — Scope & Directory Resolution
 *
 * Resolves paths for CLI Agent storage:
 * - Root directory: ~/.openclaw/cli-agents/
 * - Bridge config: ~/.openclaw/cli-agents/bridge.json
 * - Agent workspace: ~/.openclaw/cli-agents/{agentId}/
 */

import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

const CLI_AGENTS_DIRNAME = "cli-agents";
const BRIDGE_CONFIG_FILENAME = "bridge.json";

/**
 * Resolve the CLI Agents root directory.
 * Default: ~/.openclaw/cli-agents/
 */
export function resolveCliAgentsRootDir(env: NodeJS.ProcessEnv = process.env): string {
  const stateDir = resolveStateDir(env);
  return path.join(stateDir, CLI_AGENTS_DIRNAME);
}

/**
 * Resolve the bridge.json global registry path.
 * i.e. ~/.openclaw/cli-agents/bridge.json
 */
export function resolveCliBridgeConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveCliAgentsRootDir(env), BRIDGE_CONFIG_FILENAME);
}

/**
 * Resolve a single CLI Agent's workspace directory.
 * i.e. ~/.openclaw/cli-agents/{agentId}/
 */
export function resolveCliAgentWorkspaceDir(
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveCliAgentsRootDir(env), agentId);
}
