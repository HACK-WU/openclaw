import type { Terminal as HeadlessTerminal } from "@xterm/headless";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import xtermHeadless from "@xterm/headless";
import fs from "node:fs";
const { Terminal: HeadlessTerminalCtor } = xtermHeadless;
import { createSessionSlug as createSessionSlugId } from "./session-slug.js";

const DEFAULT_JOB_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MIN_JOB_TTL_MS = 60 * 1000; // 1 minute
const MAX_JOB_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
const DEFAULT_PENDING_OUTPUT_CHARS = 30_000;
/** Truncation banner shown when terminal output is trimmed */
const TRUNCATION_BANNER = "\x1b[33m... (earlier output truncated)\x1b[0m\n";
/** Debug file path for PTY rendered output (what frontend sees) */
const PTY_RENDERED_FILE = "/tmp/test-pty-codebuddy-rendered.txt";

/**
 * Read the current viewport content from a headless xterm.js terminal.
 * Extracts plain text lines (right-trimmed) and strips leading/trailing empty lines.
 */
function readHeadlessContent(terminal: HeadlessTerminal): string {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < terminal.rows; i++) {
    const line = buffer.getLine(i);
    lines.push(line ? line.translateToString(true) : "");
  }
  // Trim trailing empty lines
  while (lines.length > 0 && !lines[lines.length - 1]) {
    lines.pop();
  }
  // Trim leading empty lines
  while (lines.length > 0 && !lines[0]) {
    lines.shift();
  }
  return lines.join("\n");
}

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
  /** @xterm/headless terminal instance for PTY rendering (full xterm.js engine, no DOM) */
  headlessTerminal?: HeadlessTerminal;
  /** Pre-rendered screen content from headless terminal (no cursor movements) */
  renderedContent?: string;
  /** Number of pending write() callbacks for PTY (race condition prevention) */
  pendingWrites?: number;
  /** Callbacks to invoke when pendingWrites reaches 0 */
  pendingWritesCallbacks?: Array<() => void>;
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

export function appendOutput(
  session: ProcessSession,
  stream: "stdout" | "stderr",
  chunk: string,
  onRendered?: () => void,
) {
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

  buffer.push(chunk);
  let pendingChars = bufferChars + chunk.length;
  if (pendingChars > pendingCap) {
    session.truncated = true;
    pendingChars = capPendingBuffer(buffer, pendingChars, pendingCap);
  }
  if (stream === "stdout") {
    session.pendingStdoutChars = pendingChars;
  } else {
    session.pendingStderrChars = pendingChars;
  }
  session.totalOutputChars += chunk.length;

  if (session.isPty) {
    // Feed chunk to the headless xterm.js terminal for pre-rendered screen snapshot.
    // @xterm/headless is the official headless xterm.js engine — it handles ALL ANSI
    // sequences correctly (cursor movements, clear-line, SGR, alt screen, etc.).
    // For PTY, we store the RENDERED content directly in `aggregated` so all consumers
    // automatically get clean text (no ANSI escape codes).
    if (!session.headlessTerminal) {
      session.headlessTerminal = new HeadlessTerminalCtor({
        cols: 120,
        rows: 30,
        scrollback: 0,
        allowProposedApi: true,
      });
    }

    // Track pending write() callbacks to prevent race condition on exit
    session.pendingWrites = (session.pendingWrites ?? 0) + 1;

    // write() is async — update aggregated with rendered content in the callback
    session.headlessTerminal.write(chunk, () => {
      const rendered = readHeadlessContent(session.headlessTerminal!);
      // IMPORTANT: Store rendered content directly in aggregated so all consumers get clean text
      session.aggregated = rendered;
      session.tail = rendered;
      session.renderedContent = rendered; // Keep for backwards compatibility

      // Write the FULL TUI snapshot to debug file for inspection
      try {
        fs.writeFileSync(PTY_RENDERED_FILE, rendered ?? "", "utf-8");
      } catch {
        // Ignore file write errors
      }

      // Decrement pending writes and invoke callbacks if we've reached zero
      session.pendingWrites = Math.max(0, (session.pendingWrites ?? 1) - 1);
      if (session.pendingWrites === 0 && session.pendingWritesCallbacks?.length) {
        const callbacks = session.pendingWritesCallbacks;
        session.pendingWritesCallbacks = [];
        for (const cb of callbacks) {
          try {
            cb();
          } catch {
            // Ignore callback errors
          }
        }
      }

      onRendered?.();
    });
    return;
  }

  // Non-PTY: simple concatenation with truncation
  const aggregated = trimWithCap(session.aggregated + chunk, session.maxOutputChars);
  session.truncated =
    session.truncated || aggregated.length < session.aggregated.length + chunk.length;
  session.aggregated = aggregated;
  session.tail = tail(session.aggregated, 2000);
  onRendered?.();
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

export function waitForPendingWrites(session: ProcessSession): Promise<void> {
  // If no pending writes or not a PTY session, resolve immediately
  if (!session.isPty || !session.pendingWrites || session.pendingWrites <= 0) {
    return Promise.resolve();
  }

  // Wait for all pending write callbacks to complete
  return new Promise((resolve) => {
    session.pendingWritesCallbacks ??= [];
    session.pendingWritesCallbacks.push(resolve);
  });
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

  // For PTY: do a final synchronous read of the headless terminal buffer.
  // This catches any content that was parsed but whose write callback hasn't fired yet.
  // The result is stored directly in `aggregated` so consumers get the final rendered content.
  if (session.isPty && session.headlessTerminal) {
    const finalContent = readHeadlessContent(session.headlessTerminal);
    if (finalContent) {
      session.aggregated = finalContent;
      session.renderedContent = finalContent; // Keep for backwards compatibility
    }
  }

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

  // Clean up headless terminal for PTY sessions
  if (session.headlessTerminal) {
    try {
      session.headlessTerminal.dispose();
    } catch {
      // Ignore disposal errors
    }
    delete session.headlessTerminal;
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
