/**
 * Group Chat — Bridge PTY Manager
 *
 * Manages PTY processes for Bridge (CLI) Agents.
 * Each process is uniquely keyed by (groupId, agentId).
 *
 * Responsibilities:
 * - Lazy process creation on first @mention
 * - Raw data streaming via callback (for group.terminal events)
 * - stdin writing (context messages, assistant commands)
 * - Terminal resize forwarding
 * - Idle-based completion detection
 * - Idle timeout reclamation
 * - Crash recovery with restart limits
 * - Ring buffer for WebSocket reconnection replay
 * - Graceful cleanup on group dismiss / member removal
 */

import type { GatewayBroadcastFn } from "../gateway/server-broadcast.js";
import { getLogger } from "../logging.js";
import { stripAnsi } from "../terminal/ansi.js";
import type { BridgeConfig, BridgePtyState } from "./bridge-types.js";
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_MAX_RESTARTS,
  DEFAULT_PTY_COLS,
  DEFAULT_PTY_ROWS,
  TERMINAL_RING_BUFFER_SIZE,
} from "./bridge-types.js";
import { broadcastGroupSystem } from "./parallel-stream.js";

const log = getLogger("group-chat:bridge-pty");

// ─── PTY module types (mirror existing pattern from process/supervisor/adapters/pty.ts) ───

type PtyExitEvent = { exitCode: number; signal?: number };
type PtyDisposable = { dispose: () => void };
type PtySpawnHandle = {
  pid: number;
  write: (data: string | Buffer) => void;
  onData: (listener: (value: string) => void) => PtyDisposable | void;
  onExit: (listener: (event: PtyExitEvent) => void) => PtyDisposable | void;
  kill: (signal?: string) => void;
  resize?: (cols: number, rows: number) => void;
};
type PtySpawn = (
  file: string,
  args: string[] | string,
  options: {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: Record<string, string>;
  },
) => PtySpawnHandle;
type PtyModule = {
  spawn?: PtySpawn;
  default?: { spawn?: PtySpawn };
};

// ─── Ring Buffer (for terminal reconnection replay) ───

class RingBuffer {
  private buffer: Buffer;
  private writePos = 0;
  private totalWritten = 0;

  constructor(private capacity: number) {
    this.buffer = Buffer.alloc(capacity);
  }

  write(data: Buffer): void {
    if (data.length >= this.capacity) {
      // Data larger than buffer — keep only the tail
      data.copy(this.buffer, 0, data.length - this.capacity);
      this.writePos = 0;
      this.totalWritten += data.length;
      return;
    }

    const spaceAtEnd = this.capacity - this.writePos;
    if (data.length <= spaceAtEnd) {
      data.copy(this.buffer, this.writePos);
    } else {
      data.copy(this.buffer, this.writePos, 0, spaceAtEnd);
      data.copy(this.buffer, 0, spaceAtEnd);
    }
    this.writePos = (this.writePos + data.length) % this.capacity;
    this.totalWritten += data.length;
  }

  read(): Buffer {
    const used = Math.min(this.totalWritten, this.capacity);
    if (used === 0) {
      return Buffer.alloc(0);
    }
    if (this.totalWritten <= this.capacity) {
      return Buffer.from(this.buffer.subarray(0, this.writePos));
    }
    // Wrapped — read from writePos to end, then from 0 to writePos
    return Buffer.concat([
      this.buffer.subarray(this.writePos, this.capacity),
      this.buffer.subarray(0, this.writePos),
    ]);
  }

  clear(): void {
    this.writePos = 0;
    this.totalWritten = 0;
  }
}

// ─── Managed PTY Instance ───

type ManagedPty = {
  handle: PtySpawnHandle;
  state: BridgePtyState;
  config: BridgeConfig;
  groupId: string;
  agentId: string;
  ringBuffer: RingBuffer;
  /** Recent visible-text buffer for assistant context extraction. */
  recentTextLines: string[];
  /** Maximum lines to keep in recentTextLines. */
  maxRecentLines: number;
  /** Data listener disposable (if returned by node-pty). */
  dataDisposable: PtyDisposable | null;
  /** Exit listener disposable. */
  exitDisposable: PtyDisposable | null;
  /** Idle reclaim timer. */
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** Completion detection timer (no-output idle). */
  completionTimer: ReturnType<typeof setTimeout> | null;
  /** Completion idle seconds threshold. */
  completionIdleSecs: number;
  /**
   * When true, PTY output is still recorded (ringBuffer, recentTextLines)
   * but the onRawData callback is NOT invoked, so the frontend does not
   * receive the data.  Used during context injection to suppress echo.
   */
  inputPhase: boolean;
  /** Callback: raw PTY data for group.terminal broadcast. */
  onRawData?: (data: string) => void;
  /** Callback: completion detected (idle timeout with no output). */
  onCompletion?: () => void;
  /** Callback: process exited. */
  onExit?: (code: number | null, signal: number | null) => void;
};

// ─── Global PTY Registry ───

const ptyInstances = new Map<string, ManagedPty>();

function ptyKey(groupId: string, agentId: string): string {
  return `${groupId}:${agentId}`;
}

// ─── Lazy PTY module loader ───

let cachedSpawn: PtySpawn | null = null;

async function loadPtySpawn(): Promise<PtySpawn> {
  if (cachedSpawn) {
    return cachedSpawn;
  }
  const mod = (await import("@lydell/node-pty")) as unknown as PtyModule;
  const spawn = mod.spawn ?? mod.default?.spawn;
  if (!spawn) {
    throw new Error("PTY support is unavailable (node-pty spawn not found).");
  }
  cachedSpawn = spawn;
  return spawn;
}

// ─── Public API ───

/**
 * Create and start a PTY process for a Bridge Agent.
 * If one already exists for this (groupId, agentId), it is killed first.
 */
export async function createBridgePty(params: {
  groupId: string;
  agentId: string;
  config: BridgeConfig;
  effectiveCwd?: string;
  completionIdleSecs?: number;
  onRawData?: (data: string) => void;
  onCompletion?: () => void;
  onExit?: (code: number | null, signal: number | null) => void;
}): Promise<BridgePtyState> {
  const key = ptyKey(params.groupId, params.agentId);

  // Kill any existing instance
  const existing = ptyInstances.get(key);
  if (existing) {
    await destroyPtyInstance(existing, "replaced");
  }

  const spawn = await loadPtySpawn();
  const cfg = params.config;

  const cwd = params.effectiveCwd ?? cfg.cwd ?? process.cwd();
  const env: Record<string, string> = {
    ...stringifyEnv(process.env),
    ...cfg.env,
    // Force non-interactive terminal
    TERM: "xterm-256color",
  };

  log.info("[BRIDGE_PTY_CREATE]", {
    groupId: params.groupId,
    agentId: params.agentId,
    command: cfg.command,
    args: cfg.args,
    cwd,
  });

  const handle = spawn(cfg.command, cfg.args ?? [], {
    name: "xterm-256color",
    cols: DEFAULT_PTY_COLS,
    rows: DEFAULT_PTY_ROWS,
    cwd,
    env,
  });

  const state: BridgePtyState = {
    pid: handle.pid || undefined,
    status: "running",
    initialised: true,
    lastOutputAt: Date.now(),
    lastInputAt: Date.now(),
    restartCount: 0,
    maxRestarts: DEFAULT_MAX_RESTARTS,
    idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
    lastTranscriptIndex: 0,
    isFirstInteraction: true,
  };

  const ringBuffer = new RingBuffer(TERMINAL_RING_BUFFER_SIZE);

  const managed: ManagedPty = {
    handle,
    state,
    config: cfg,
    groupId: params.groupId,
    agentId: params.agentId,
    ringBuffer,
    recentTextLines: [],
    maxRecentLines: 100,
    dataDisposable: null,
    exitDisposable: null,
    idleTimer: null,
    completionTimer: null,
    completionIdleSecs: params.completionIdleSecs ?? 8,
    inputPhase: false,
    onRawData: params.onRawData,
    onCompletion: params.onCompletion,
    onExit: params.onExit,
  };

  // Listen for data output
  managed.dataDisposable =
    handle.onData((data: string) => {
      handlePtyData(managed, data);
    }) ?? null;

  // Listen for exit
  managed.exitDisposable =
    handle.onExit((event: PtyExitEvent) => {
      handlePtyExit(managed, event);
    }) ?? null;

  // Start idle reclaim timer
  resetIdleTimer(managed);

  ptyInstances.set(key, managed);
  return state;
}

/**
 * Write data to a Bridge Agent's PTY stdin.
 */
export function writeToPty(groupId: string, agentId: string, data: string): boolean {
  const managed = ptyInstances.get(ptyKey(groupId, agentId));
  if (!managed) {
    log.info("[BRIDGE_PTY_WRITE_NO_INSTANCE]", { groupId, agentId });
    return false;
  }

  try {
    managed.handle.write(data);
    managed.state.lastInputAt = Date.now();
    // Reset completion timer on input — new output expected
    resetCompletionTimer(managed);
    resetIdleTimer(managed);
    return true;
  } catch (err) {
    log.info("[BRIDGE_PTY_WRITE_ERROR]", {
      groupId,
      agentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Toggle the input-phase flag on a Bridge Agent's PTY.
 *
 * While `active` is true, raw PTY output is still recorded internally
 * (ring buffer, recentTextLines) but is NOT broadcast to connected
 * clients via the onRawData callback.  This prevents context-injection
 * echo from leaking to the frontend terminal.
 */
export function setInputPhase(groupId: string, agentId: string, active: boolean): void {
  const managed = ptyInstances.get(ptyKey(groupId, agentId));
  if (managed) {
    managed.inputPhase = active;
  }
}

/**
 * Resize a Bridge Agent's PTY terminal.
 */
export function resizePty(groupId: string, agentId: string, cols: number, rows: number): boolean {
  const managed = ptyInstances.get(ptyKey(groupId, agentId));
  if (!managed?.handle.resize) {
    return false;
  }
  try {
    managed.handle.resize(cols, rows);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current state of a Bridge Agent's PTY.
 */
export function getPtyState(groupId: string, agentId: string): BridgePtyState | null {
  return ptyInstances.get(ptyKey(groupId, agentId))?.state ?? null;
}

/**
 * Check if a PTY instance exists and is running.
 */
export function isPtyRunning(groupId: string, agentId: string): boolean {
  const managed = ptyInstances.get(ptyKey(groupId, agentId));
  return managed != null && managed.state.status === "running";
}

/**
 * Get the ring buffer contents (for reconnection replay).
 * Returns Base64-encoded terminal data.
 */
export function getPtyReplayBuffer(groupId: string, agentId: string): string | null {
  const managed = ptyInstances.get(ptyKey(groupId, agentId));
  if (!managed) {
    return null;
  }
  const buf = managed.ringBuffer.read();
  if (buf.length === 0) {
    return null;
  }
  return buf.toString("base64");
}

/**
 * Get recent visible text from PTY output (stripped of ANSI).
 * Used by bridge-assistant for TUI content analysis.
 */
export function getRecentVisibleText(groupId: string, agentId: string, maxLines = 100): string {
  const managed = ptyInstances.get(ptyKey(groupId, agentId));
  if (!managed) {
    return "";
  }
  return managed.recentTextLines.slice(-maxLines).join("\n");
}

/**
 * Terminate a single Bridge Agent PTY process.
 * Sends SIGTERM → waits → SIGKILL if needed.
 */
export async function killBridgePty(
  groupId: string,
  agentId: string,
  reason = "manual",
): Promise<void> {
  const managed = ptyInstances.get(ptyKey(groupId, agentId));
  if (!managed) {
    return;
  }
  await destroyPtyInstance(managed, reason);
  ptyInstances.delete(ptyKey(groupId, agentId));
}

/**
 * Cleanup all Bridge Agent PTY processes in a group.
 * Called on group dismiss/archive/delete.
 */
export async function cleanupGroupBridgeAgents(
  groupId: string,
  broadcast?: GatewayBroadcastFn,
): Promise<void> {
  const toClean: ManagedPty[] = [];
  for (const [key, managed] of ptyInstances) {
    if (managed.groupId === groupId) {
      toClean.push(managed);
      ptyInstances.delete(key);
    }
  }

  for (const managed of toClean) {
    await destroyPtyInstance(managed, "group_cleanup");
    if (broadcast) {
      broadcastGroupSystem(broadcast, groupId, "bridge_agent_terminated", {
        agentId: managed.agentId,
        reason: "group_cleanup",
      });
    }
  }
}

/**
 * Reset the completion timer.
 * Call this after writing to stdin to start watching for completion.
 */
export function startCompletionDetection(groupId: string, agentId: string): void {
  const managed = ptyInstances.get(ptyKey(groupId, agentId));
  if (managed) {
    resetCompletionTimer(managed);
  }
}

/**
 * Cancel completion detection (e.g. when aborting).
 */
export function cancelCompletionDetection(groupId: string, agentId: string): void {
  const managed = ptyInstances.get(ptyKey(groupId, agentId));
  if (managed) {
    clearCompletionTimer(managed);
  }
}

/**
 * Get all active PTY instances for a given group.
 */
export function getGroupActivePtys(
  groupId: string,
): Array<{ agentId: string; state: BridgePtyState }> {
  const result: Array<{ agentId: string; state: BridgePtyState }> = [];
  for (const managed of ptyInstances.values()) {
    if (managed.groupId === groupId) {
      result.push({ agentId: managed.agentId, state: managed.state });
    }
  }
  return result;
}

/**
 * Update the last transcript index for incremental context.
 */
export function updateLastTranscriptIndex(groupId: string, agentId: string, index: number): void {
  const managed = ptyInstances.get(ptyKey(groupId, agentId));
  if (managed) {
    managed.state.lastTranscriptIndex = index;
    managed.state.isFirstInteraction = false;
  }
}

// ─── Internal helpers ───

function handlePtyData(managed: ManagedPty, data: string): void {
  const now = Date.now();
  managed.state.lastOutputAt = now;
  managed.state.status = "running";

  // Write to ring buffer (raw bytes)
  managed.ringBuffer.write(Buffer.from(data, "utf-8"));

  // Extract visible text lines for assistant context
  const stripped = stripAnsi(data);
  const lines = stripped.split("\n");
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (trimmed.length > 0) {
      managed.recentTextLines.push(trimmed);
    }
  }
  // Trim to max recent lines
  if (managed.recentTextLines.length > managed.maxRecentLines * 2) {
    managed.recentTextLines = managed.recentTextLines.slice(-managed.maxRecentLines);
  }

  // Reset completion timer — new output means CLI is still working
  resetCompletionTimer(managed);

  // Reset idle reclaim timer — activity detected
  resetIdleTimer(managed);

  // Callback for raw data broadcast — suppressed during inputPhase
  // so the frontend never sees context-injection echo.
  if (!managed.inputPhase) {
    managed.onRawData?.(data);
  }
}

function handlePtyExit(managed: ManagedPty, event: PtyExitEvent): void {
  const code = event.exitCode ?? null;
  const signal = event.signal && event.signal !== 0 ? event.signal : null;

  log.info("[BRIDGE_PTY_EXIT]", {
    groupId: managed.groupId,
    agentId: managed.agentId,
    code,
    signal,
    restartCount: managed.state.restartCount,
  });

  managed.state.status = "offline";

  // Clear timers
  clearIdleTimer(managed);
  clearCompletionTimer(managed);

  // Dispose listeners
  try {
    managed.dataDisposable?.dispose();
  } catch {
    /* ignore */
  }
  try {
    managed.exitDisposable?.dispose();
  } catch {
    /* ignore */
  }
  managed.dataDisposable = null;
  managed.exitDisposable = null;

  // Invoke exit callback
  managed.onExit?.(code, signal);
}

async function destroyPtyInstance(managed: ManagedPty, reason: string): Promise<void> {
  log.info("[BRIDGE_PTY_DESTROY]", {
    groupId: managed.groupId,
    agentId: managed.agentId,
    reason,
    pid: managed.state.pid,
  });

  // Clear timers first
  clearIdleTimer(managed);
  clearCompletionTimer(managed);

  // Attempt graceful termination
  try {
    managed.handle.kill("SIGTERM");
  } catch {
    /* ignore */
  }

  // Wait up to 5 seconds for exit
  await new Promise<void>((resolve) => {
    const checkTimer = setTimeout(() => {
      // Force kill if still alive
      try {
        managed.handle.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolve();
    }, 5_000);
    checkTimer.unref();

    // If process already exited, resolve immediately
    if (managed.state.status === "offline") {
      clearTimeout(checkTimer);
      resolve();
    }
  });

  // Dispose listeners
  try {
    managed.dataDisposable?.dispose();
  } catch {
    /* ignore */
  }
  try {
    managed.exitDisposable?.dispose();
  } catch {
    /* ignore */
  }
  managed.dataDisposable = null;
  managed.exitDisposable = null;

  // Clear ring buffer
  managed.ringBuffer.clear();
  managed.recentTextLines = [];
  managed.state.status = "offline";
}

function resetIdleTimer(managed: ManagedPty): void {
  clearIdleTimer(managed);
  managed.idleTimer = setTimeout(() => {
    log.info("[BRIDGE_PTY_IDLE_RECLAIM]", {
      groupId: managed.groupId,
      agentId: managed.agentId,
      idleTimeoutMs: managed.state.idleTimeoutMs,
    });
    managed.state.status = "idle";
    // Don't destroy — just mark as idle. The next @mention will re-activate.
    // But clear expensive resources.
    clearCompletionTimer(managed);
  }, managed.state.idleTimeoutMs);
  managed.idleTimer.unref();
}

function clearIdleTimer(managed: ManagedPty): void {
  if (managed.idleTimer) {
    clearTimeout(managed.idleTimer);
    managed.idleTimer = null;
  }
}

function resetCompletionTimer(managed: ManagedPty): void {
  clearCompletionTimer(managed);
  managed.completionTimer = setTimeout(() => {
    // No output for completionIdleSecs → completion detected
    managed.onCompletion?.();
  }, managed.completionIdleSecs * 1000);
  managed.completionTimer.unref();
}

function clearCompletionTimer(managed: ManagedPty): void {
  if (managed.completionTimer) {
    clearTimeout(managed.completionTimer);
    managed.completionTimer = null;
  }
}

/**
 * Convert NodeJS.ProcessEnv to Record<string, string>,
 * filtering out undefined values.
 */
function stringifyEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined) {
      result[k] = v;
    }
  }
  return result;
}
