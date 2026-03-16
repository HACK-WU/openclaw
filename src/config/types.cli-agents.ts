/**
 * CLI Agent Type Definitions
 *
 * Types for the independent CLI Agent management system.
 * CLI Agents are stored separately from general Agents
 * in `cli-agents/bridge.json` (not in `openclaw.json`).
 */

import type { CliType } from "../group-chat/bridge-types.js";

/**
 * A single CLI Agent entry in the global registry (`bridge.json`).
 */
export type CliAgentEntry = {
  /** System-internal identifier. Only `[a-zA-Z0-9_]`. Used for directory names, API params, data transfer. */
  id: string;
  /** User-visible display name. Allows Chinese, spaces, any characters. Used in UI, @mention display. */
  name: string;
  /** Agent icon (emoji). */
  emoji?: string;
  /** CLI type preset (codebuddy / claude-code / opencode / custom). */
  type: CliType;
  /** CLI startup command (executable path or command name). */
  command: string;
  /** CLI startup arguments. */
  args?: string[];
  /** CLI working directory. */
  cwd?: string;
  /** CLI environment variables. */
  env?: Record<string, string>;
  /** Single-reply timeout in milliseconds. Default: 300_000 (5 min). */
  timeout?: number;
  /**
   * Regex pattern to detect the CLI prompt area at the end of terminal output.
   * When the extracted text matches this pattern (searched from the last line upward),
   * the matching line and everything below it (plus any leading chrome lines) are trimmed.
   * Example for CodeBuddy: "↵\\s*send"
   */
  tailTrimMarker?: string;
};

/**
 * The global CLI Agent registry file (`cli-agents/bridge.json`).
 * Contains all CLI Agent entries in a single file for easy access.
 */
export type CliBridgeConfig = {
  agents: CliAgentEntry[];
};
