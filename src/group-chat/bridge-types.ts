/**
 * Group Chat — Bridge Agent Type Definitions
 *
 * Types for the CLI Bridge Agent feature:
 * - BridgeConfig: CLI agent configuration (command, args, env, etc.)
 * - BridgePtyState: Runtime PTY process state
 * - AssistantTriggerState: Cooldown/limit tracking for bridge-assistant
 * - Terminal event payloads
 */

// ─── CLI Type Presets ───

export type CliType = "claude-code" | "opencode" | "codebuddy" | "qwen" | "custom";

// ─── Bridge Configuration ───

/**
 * Configuration for a Bridge (CLI) Agent.
 * Stored in GroupMember.bridge; presence indicates this member is a Bridge Agent.
 */
export type BridgeConfig = {
  /** CLI tool type — drives preset defaults. */
  type: CliType;
  /** CLI executable path or command name (e.g. "claude", "opencode"). */
  command: string;
  /** Extra CLI arguments. */
  args?: string[];
  /** Working directory override (default: group project dir or agent config cwd). */
  cwd?: string;
  /** Extra environment variables injected into the PTY process. */
  env?: Record<string, string>;
  /** Single-reply timeout in ms. Default 300_000 (5 min). */
  timeout?: number;
  /** Agent avatar identifier (auto-filled from CLI type, overridable). */
  avatar?: string;
  /**
   * Regex pattern to detect the CLI prompt area at the end of terminal output.
   * When matched, the line and everything below (plus leading chrome lines) are trimmed.
   * Example for CodeBuddy: "↵\\s*send"
   */
  tailTrimMarker?: string;
};

// ─── PTY Process State ───

export type BridgePtyStatus =
  | "idle"
  | "running"
  | "ready"
  | "completed"
  | "stuck"
  | "error"
  | "offline";

/**
 * Runtime state of a single PTY process instance.
 * Keyed by `(groupId, agentId)`.
 */
export type BridgePtyState = {
  /** PTY process ID (from node-pty). */
  pid?: number;
  /** Current status. */
  status: BridgePtyStatus;
  /** Whether the PTY process has been initialised (lazy-init on first @mention). */
  initialised: boolean;
  /** Timestamp of the last data output from the PTY. */
  lastOutputAt: number;
  /** Timestamp of the last message written to PTY stdin. */
  lastInputAt: number;
  /** Number of automatic restarts attempted in the current lifecycle. */
  restartCount: number;
  /** Maximum restarts before giving up. */
  maxRestarts: number;
  /** Idle timeout in ms (default 600_000 = 10 min). Triggers process reclamation. */
  idleTimeoutMs: number;
  /** Index into the transcript at the last interaction (for incremental context). */
  lastTranscriptIndex: number;
  /** Whether this is the first interaction (full context) or subsequent (incremental). */
  isFirstInteraction: boolean;
  /** Number of interactions since PTY creation (first interaction not counted). */
  interactionCount: number;
  /** Interaction count at the last role reminder (for interval-based reminders). */
  lastRoleReminderAt: number;
};

// ─── Bridge-Assistant Trigger State ───

/**
 * Tracks cooldown/limit state for the bridge-assistant's interventions
 * on a particular CLI agent within a group.
 */
export type AssistantTriggerState = {
  /** Timestamp of the last trigger. */
  lastTriggerTime: number;
  /** Number of triggers in the current CLI run (resets on restart/completion). */
  triggerCount: number;
  /** Result of the last trigger ("success" | "no_action" | "failed" | "escalated"). */
  lastResult?: string;
};

// ─── Terminal Event Payloads ───

/** Server → Client: raw PTY output (Base64 encoded). */
export type GroupTerminalPayload = {
  groupId: string;
  agentId: string;
  /** Base64-encoded PTY output data. */
  data: string;
};

/** Client → Server: terminal resize request. */
export type GroupTerminalResizePayload = {
  groupId: string;
  agentId: string;
  cols: number;
  rows: number;
};

/** Server → Client: terminal status change. */
export type GroupTerminalStatusPayload = {
  groupId: string;
  agentId: string;
  status: BridgePtyStatus;
  /** Human-readable message (e.g. "CLI process exited with code 1"). */
  message?: string;
};

// ─── Context Configuration ───

/**
 * Configurable context limits for CLI agent interactions.
 * Stored in GroupSessionEntry.contextConfig.
 */
export type ContextConfig = {
  /** Maximum number of transcript messages to include in context. Default 30. */
  maxMessages?: number;
  /** Maximum total character count for context. Default 50_000. */
  maxCharacters?: number;
  /** Whether to include system messages in context. Default false. */
  includeSystemMessages?: boolean;
  /** Role reminder interval (send role reminder every N interactions). Default 5. */
  roleReminderInterval?: number;
};

// ─── Audit Log Entry ───

/** A single audit log entry for bridge-assistant actions. */
export type BridgeAuditLogEntry = {
  timestamp: string; // ISO 8601
  groupId: string;
  cliAgentId: string;
  assistantAgentId: string;
  idleDuration: number;
  tuiContentSnippet: string; // last ≤500 chars of visible TUI text
  analysisResult: string;
  actionPerformed: boolean;
  operationType?: "confirm" | "authorize" | "interrupt" | "other";
  operationDetail?: string;
  result: "success" | "no_action" | "failed" | "escalated";
  resultDetail?: string;
};

// ─── Constants ───

/** Default columns for new PTY instances. */
export const DEFAULT_PTY_COLS = 120;
/** Default rows for new PTY instances. */
export const DEFAULT_PTY_ROWS = 30;
/** Default single-reply timeout (5 minutes). */
export const DEFAULT_REPLY_TIMEOUT_MS = 300_000;
/** Default idle reclaim timeout (10 minutes). */
export const DEFAULT_IDLE_TIMEOUT_MS = 600_000;
/** Maximum restarts before giving up. */
export const DEFAULT_MAX_RESTARTS = 3;
/** Cooldown between assistant triggers (ms). */
export const ASSISTANT_TRIGGER_COOLDOWN_MS = 60_000;
/** Max assistant triggers per CLI run. */
export const ASSISTANT_MAX_TRIGGERS_PER_RUN = 3;
/** Size of the ring buffer for terminal reconnection (bytes). */
export const TERMINAL_RING_BUFFER_SIZE = 256 * 1024; // 256 KB
/** Max characters per single message in context truncation. */
export const MAX_SINGLE_MESSAGE_CHARS = 2_000;
/** Default max messages in context. */
export const DEFAULT_CONTEXT_MAX_MESSAGES = 30;
/** Default max characters in context. */
export const DEFAULT_CONTEXT_MAX_CHARACTERS = 50_000;
/** Default role reminder interval (send role reminder every N interactions). */
export const DEFAULT_ROLE_REMINDER_INTERVAL = 5;
