import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { createSessionSlug as createSessionSlugId } from "./session-slug.js";

const DEFAULT_JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MIN_JOB_TTL_MS = 60 * 1000; // 1 minute
const MAX_JOB_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
const DEFAULT_PENDING_OUTPUT_CHARS = 30_000;
/** Maximum lines to keep in terminal output (for PTY sessions) */
const DEFAULT_MAX_TERMINAL_LINES = 5000;
/** Truncation banner shown when terminal output is trimmed */
const TRUNCATION_BANNER = "\x1b[33m... (earlier output truncated)\x1b[0m\n";

function clampTtl(value: number | undefined) {
  if (!value || Number.isNaN(value)) {
    return DEFAULT_JOB_TTL_MS;
  }
  return Math.min(Math.max(value, MIN_JOB_TTL_MS), MAX_JOB_TTL_MS);
}

let jobTtlMs = clampTtl(Number.parseInt(process.env.PI_BASH_JOB_TTL_MS ?? "", 10));

export type ProcessStatus = "running" | "completed" | "failed" | "killed";

export type SessionStdin = {
  write: (data: string, cb?: (err?: Error | null) => void) => void;
  end: () => void;
  // When backed by a real Node stream (child.stdin), this exists; for PTY wrappers it may not.
  destroy?: () => void;
  destroyed?: boolean;
};

export interface ProcessSession {
  id: string;
  command: string;
  scopeKey?: string;
  sessionKey?: string;
  notifyOnExit?: boolean;
  exitNotified?: boolean;
  child?: ChildProcessWithoutNullStreams;
  stdin?: SessionStdin;
  pid?: number;
  startedAt: number;
  cwd?: string;
  maxOutputChars: number;
  pendingMaxOutputChars?: number;
  /** Maximum lines to keep for PTY terminal output */
  maxLines?: number;
  totalOutputChars: number;
  pendingStdout: string[];
  pendingStderr: string[];
  pendingStdoutChars: number;
  pendingStderrChars: number;
  aggregated: string;
  tail: string;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | number | null;
  exited: boolean;
  truncated: boolean;
  /** Whether terminal output was truncated by line count */
  truncatedByLines?: boolean;
  backgrounded: boolean;
  isPty?: boolean;
}

export interface FinishedSession {
  id: string;
  command: string;
  scopeKey?: string;
  startedAt: number;
  endedAt: number;
  cwd?: string;
  status: ProcessStatus;
  exitCode?: number | null;
  exitSignal?: NodeJS.Signals | number | null;
  aggregated: string;
  tail: string;
  truncated: boolean;
  /** Whether terminal output was truncated by line count */
  truncatedByLines?: boolean;
  totalOutputChars: number;
  isPty?: boolean;
}

const runningSessions = new Map<string, ProcessSession>();
const finishedSessions = new Map<string, FinishedSession>();

let sweeper: NodeJS.Timeout | null = null;

function isSessionIdTaken(id: string) {
  return runningSessions.has(id) || finishedSessions.has(id);
}

export function createSessionSlug(): string {
  return createSessionSlugId(isSessionIdTaken);
}

export function addSession(session: ProcessSession) {
  runningSessions.set(session.id, session);
  startSweeper();
}

export function getSession(id: string) {
  return runningSessions.get(id);
}

export function getFinishedSession(id: string) {
  return finishedSessions.get(id);
}

export function deleteSession(id: string) {
  runningSessions.delete(id);
  finishedSessions.delete(id);
}

export function appendOutput(session: ProcessSession, stream: "stdout" | "stderr", chunk: string) {
  session.pendingStdout ??= [];
  session.pendingStderr ??= [];
  session.pendingStdoutChars ??= sumPendingChars(session.pendingStdout);
  session.pendingStderrChars ??= sumPendingChars(session.pendingStderr);
  const buffer = stream === "stdout" ? session.pendingStdout : session.pendingStderr;
  const bufferChars = stream === "stdout" ? session.pendingStdoutChars : session.pendingStderrChars;
  const pendingCap = Math.min(
    session.pendingMaxOutputChars ?? DEFAULT_PENDING_OUTPUT_CHARS,
    session.maxOutputChars,
  );

  // DEBUG: Log before appending
  console.log("[ProcessRegistry] Append output:", {
    sessionId: session.id,
    isPty: session.isPty,
    stream,
    chunkLength: chunk.length,
    totalOutputCharsBefore: session.totalOutputChars,
    aggregatedLengthBefore: session.aggregated.length,
    pendingBufferLength: buffer.length,
    pendingCharsBefore: bufferChars,
    maxOutputChars: session.maxOutputChars,
    pendingMaxOutputChars: session.pendingMaxOutputChars ?? DEFAULT_PENDING_OUTPUT_CHARS,
    pendingCap,
    maxLines: session.maxLines ?? DEFAULT_MAX_TERMINAL_LINES,
  });

  buffer.push(chunk);
  let pendingChars = bufferChars + chunk.length;
  if (pendingChars > pendingCap) {
    session.truncated = true;
    console.warn("[ProcessRegistry] Pending buffer exceeded cap, truncating:", {
      sessionId: session.id,
      pendingChars,
      pendingCap,
      truncatedBy: "pending_buffer",
    });
    pendingChars = capPendingBuffer(buffer, pendingChars, pendingCap);
  }
  if (stream === "stdout") {
    session.pendingStdoutChars = pendingChars;
  } else {
    session.pendingStderrChars = pendingChars;
  }
  session.totalOutputChars += chunk.length;

  // Track if aggregation will be truncated
  const aggregatedBefore = session.aggregated;
  const aggregated = trimWithCap(session.aggregated + chunk, session.maxOutputChars);
  session.truncated =
    session.truncated || aggregated.length < session.aggregated.length + chunk.length;

  if (aggregated.length < aggregatedBefore.length + chunk.length) {
    console.warn("[ProcessRegistry] Aggregated output truncated by maxOutputChars:", {
      sessionId: session.id,
      originalLength: aggregatedBefore.length + chunk.length,
      truncatedLength: aggregated.length,
      removedChars: aggregatedBefore.length + chunk.length - aggregated.length,
      maxOutputChars: session.maxOutputChars,
      truncatedBy: "max_output_chars",
    });
  }

  session.aggregated = aggregated;

  // For PTY sessions, also trim by line count to keep terminal output manageable
  if (session.isPty) {
    const maxLines = session.maxLines ?? DEFAULT_MAX_TERMINAL_LINES;
    const trimmedByLines = trimByLines(session.aggregated, maxLines);
    if (trimmedByLines !== session.aggregated) {
      session.truncatedByLines = true;
      const linesRemoved = countLines(session.aggregated) - countLines(trimmedByLines);
      console.warn("[ProcessRegistry] PTY output truncated by line count:", {
        sessionId: session.id,
        originalLines: countLines(session.aggregated),
        truncatedLines: countLines(trimmedByLines),
        linesRemoved,
        maxLines,
        truncatedBy: "line_count",
      });
      session.aggregated = trimmedByLines;
    }
  }

  // Track tail truncation
  const tailBefore = session.tail;
  session.tail = tail(session.aggregated, 2000);
  if (tailBefore !== session.tail && session.aggregated.length > 2000) {
    console.log("[ProcessRegistry] Tail preview updated (last 2000 chars):", {
      sessionId: session.id,
      aggregatedLength: session.aggregated.length,
      tailLength: session.tail.length,
    });
  }

  // DEBUG: Log final state
  console.log("[ProcessRegistry] Output appended result:", {
    sessionId: session.id,
    totalOutputCharsAfter: session.totalOutputChars,
    aggregatedLengthAfter: session.aggregated.length,
    pendingStdoutChars: session.pendingStdoutChars,
    pendingStderrChars: session.pendingStderrChars,
    truncated: session.truncated,
    truncatedByLines: session.truncatedByLines,
    finalTailLength: session.tail.length,
  });
}

export function drainSession(session: ProcessSession) {
  const stdout = session.pendingStdout.join("");
  const stderr = session.pendingStderr.join("");
  session.pendingStdout = [];
  session.pendingStderr = [];
  session.pendingStdoutChars = 0;
  session.pendingStderrChars = 0;
  return { stdout, stderr };
}

export function markExited(
  session: ProcessSession,
  exitCode: number | null,
  exitSignal: NodeJS.Signals | number | null,
  status: ProcessStatus,
) {
  session.exited = true;
  session.exitCode = exitCode;
  session.exitSignal = exitSignal;
  session.tail = tail(session.aggregated, 2000);
  moveToFinished(session, status);
}

export function markBackgrounded(session: ProcessSession) {
  session.backgrounded = true;
}

function moveToFinished(session: ProcessSession, status: ProcessStatus) {
  runningSessions.delete(session.id);

  // Clean up child process stdio streams to prevent FD leaks
  if (session.child) {
    // Destroy stdio streams to release file descriptors
    session.child.stdin?.destroy?.();
    session.child.stdout?.destroy?.();
    session.child.stderr?.destroy?.();

    // Remove all event listeners to prevent memory leaks
    session.child.removeAllListeners?.();

    // Clear the reference
    delete session.child;
  }

  // Clean up stdin wrapper - call destroy if available, otherwise just remove reference
  if (session.stdin) {
    // Try to call destroy/end method if exists
    if (typeof session.stdin.destroy === "function") {
      session.stdin.destroy();
    } else if (typeof session.stdin.end === "function") {
      session.stdin.end();
    }
    // Only set flag if writable
    try {
      (session.stdin as { destroyed?: boolean }).destroyed = true;
    } catch {
      // Ignore if read-only
    }
    delete session.stdin;
  }

  if (!session.backgrounded) {
    return;
  }
  finishedSessions.set(session.id, {
    id: session.id,
    command: session.command,
    scopeKey: session.scopeKey,
    startedAt: session.startedAt,
    endedAt: Date.now(),
    cwd: session.cwd,
    status,
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    aggregated: session.aggregated,
    tail: session.tail,
    truncated: session.truncated,
    truncatedByLines: session.truncatedByLines,
    totalOutputChars: session.totalOutputChars,
    isPty: session.isPty,
  });
}

export function tail(text: string, max = 2000) {
  if (text.length <= max) {
    return text;
  }
  return text.slice(text.length - max);
}

function sumPendingChars(buffer: string[]) {
  let total = 0;
  for (const chunk of buffer) {
    total += chunk.length;
  }
  return total;
}

function capPendingBuffer(buffer: string[], pendingChars: number, cap: number) {
  if (pendingChars <= cap) {
    return pendingChars;
  }
  const last = buffer.at(-1);
  if (last && last.length >= cap) {
    buffer.length = 0;
    buffer.push(last.slice(last.length - cap));
    return cap;
  }
  while (buffer.length && pendingChars - buffer[0].length >= cap) {
    pendingChars -= buffer[0].length;
    buffer.shift();
  }
  if (buffer.length && pendingChars > cap) {
    const overflow = pendingChars - cap;
    buffer[0] = buffer[0].slice(overflow);
    pendingChars = cap;
  }
  return pendingChars;
}

export function trimWithCap(text: string, max: number) {
  if (text.length <= max) {
    return text;
  }
  return text.slice(text.length - max);
}

/**
 * Trim terminal output by line count, keeping the last N lines.
 * Appends a truncation banner at the start if content was trimmed.
 * @param text - The terminal output text
 * @param maxLines - Maximum number of lines to keep
 * @returns Trimmed text with optional truncation banner
 */
export function trimByLines(text: string, maxLines: number): string {
  if (!text) {
    return text;
  }
  // Fast path: count newlines without creating array
  let newlineCount = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      newlineCount++;
    }
  }
  // If within limits, return as-is
  if (newlineCount <= maxLines) {
    return text;
  }
  // Find the starting position of the (newlineCount - maxLines + 1)th newline
  // This gives us the start of the portion to keep
  const skipLines = newlineCount - maxLines;
  let foundNewlines = 0;
  let cutPosition = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      foundNewlines++;
      if (foundNewlines === skipLines) {
        cutPosition = i + 1; // Start after this newline
        break;
      }
    }
  }
  // Return truncated content with banner
  return TRUNCATION_BANNER + text.slice(cutPosition);
}

/**
 * Count lines in text efficiently without creating arrays.
 */
export function countLines(text: string): number {
  if (!text) {
    return 0;
  }
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      count++;
    }
  }
  return count;
}

export function listRunningSessions() {
  return Array.from(runningSessions.values()).filter((s) => s.backgrounded);
}

export function listFinishedSessions() {
  return Array.from(finishedSessions.values());
}

export function clearFinished() {
  finishedSessions.clear();
}

export function resetProcessRegistryForTests() {
  runningSessions.clear();
  finishedSessions.clear();
  stopSweeper();
}

export function setJobTtlMs(value?: number) {
  if (value === undefined || Number.isNaN(value)) {
    return;
  }
  jobTtlMs = clampTtl(value);
  stopSweeper();
  startSweeper();
}

function pruneFinishedSessions() {
  const cutoff = Date.now() - jobTtlMs;
  for (const [id, session] of finishedSessions.entries()) {
    if (session.endedAt < cutoff) {
      finishedSessions.delete(id);
    }
  }
}

function startSweeper() {
  if (sweeper) {
    return;
  }
  sweeper = setInterval(pruneFinishedSessions, Math.max(30_000, jobTtlMs / 6));
  sweeper.unref?.();
}

function stopSweeper() {
  if (!sweeper) {
    return;
  }
  clearInterval(sweeper);
  sweeper = null;
}
