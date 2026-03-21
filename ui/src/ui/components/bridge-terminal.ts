/**
 * Bridge Terminal Component — Real-time xterm.js terminal for Bridge (CLI) Agents.
 *
 * Renders live CLI TUI output within a group chat message bubble.
 * Receives raw PTY data via `group.terminal` WebSocket events and renders
 * it with xterm.js for full ANSI/TUI support.
 *
 * Key features:
 * - Real-time TUI rendering (progress bars, spinners, syntax highlighting)
 * - Collapsible/expandable terminal view
 * - Pure text extraction from xterm.js buffer for transcript
 * - Disconnect recovery with replay
 * - Status indicator (working/idle/completed/error)
 *
 * NOTE: Requires `@xterm/xterm` package to be installed.
 *       Install: `pnpm add @xterm/xterm`
 *       The component degrades to plain-text mode if xterm is unavailable.
 */
import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { stripAnsiEscapes } from "../chat/tool-helpers.ts";

// xterm.css raw content — injected into Shadow DOM so xterm renders correctly.
// Without this, the hidden textarea helper, viewport, and screen elements are unstyled
// and appear as visible white boxes / garbled text.
let xtermCssText: string | null = null;

// ─── Types ───

export type BridgeTerminalStatus =
  | "idle"
  | "working"
  | "ready"
  | "completed"
  | "timeout"
  | "error"
  | "disconnected";

/**
 * Event fired periodically while the terminal is active (working/ready),
 * carrying the latest visible text from the xterm.js buffer.
 * The controller uses this to drive a streaming chat bubble that mirrors
 * terminal output in real time — including in-place line overwrites.
 */
export class BridgeTerminalStreamUpdateEvent extends Event {
  static readonly eventName = "bridge-terminal-stream-update";
  constructor(
    public readonly groupId: string,
    public readonly agentId: string,
    public readonly text: string,
  ) {
    super(BridgeTerminalStreamUpdateEvent.eventName, { bubbles: true, composed: true });
  }
}

/**
 * Event fired when the bridge terminal's streaming output ends (either by
 * backend status or frontend idle detection). The controller uses this to
 * clean up the streaming chat bubble and push the extracted text to the
 * backend for transcript persistence.
 */
export class BridgeTerminalStreamEndEvent extends Event {
  static readonly eventName = "bridge-terminal-stream-end";
  constructor(
    public readonly groupId: string,
    public readonly agentId: string,
    public readonly extractedText: string = "",
  ) {
    super(BridgeTerminalStreamEndEvent.eventName, { bubbles: true, composed: true });
  }
}

/**
 * Event fired when user resizes the terminal.
 */
export class BridgeTerminalResizeEvent extends Event {
  static readonly eventName = "bridge-terminal-resize";
  constructor(
    public readonly groupId: string,
    public readonly agentId: string,
    public readonly cols: number,
    public readonly rows: number,
  ) {
    super(BridgeTerminalResizeEvent.eventName, { bubbles: true, composed: true });
  }
}

// ─── Global Registry ───

/** Track active bridge terminal instances by (groupId, agentId). */
const bridgeTerminalRegistry = new Map<string, BridgeTerminal>();

function registryKey(groupId: string, agentId: string): string {
  return `${groupId}:${agentId}`;
}

/** Get an active bridge terminal instance. */
export function getBridgeTerminal(groupId: string, agentId: string): BridgeTerminal | null {
  return bridgeTerminalRegistry.get(registryKey(groupId, agentId)) ?? null;
}

function isTerminalChromeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  return /^[─━│┃┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬=\-\s]+$/.test(trimmed) || /^[█▉▊▋▌▍▎▏▄▖▗▘▝▐]+$/.test(trimmed);
}

function normalizeExtractedTerminalText(text: string): string {
  const sourceLines = text.replace(/\r\n?/g, "\n").split("\n");
  const cleanedLines: string[] = [];

  for (const rawLine of sourceLines) {
    const line = rawLine.replace(/\u00a0/g, " ").trimEnd();

    if (isTerminalChromeLine(line)) {
      continue;
    }

    if (!line.trim()) {
      if (cleanedLines[cleanedLines.length - 1] !== "") {
        cleanedLines.push("");
      }
      continue;
    }

    cleanedLines.push(line);
  }

  while (cleanedLines[0] === "") {
    cleanedLines.shift();
  }
  while (cleanedLines[cleanedLines.length - 1] === "") {
    cleanedLines.pop();
  }

  return cleanedLines.join("\n");
}

/**
 * 检测是否是上下文注释行
 * 后端注入的上下文消息包含特定的关键字标记
 */
function isContextCommentLine(line: string): boolean {
  const trimmed = line.trim();

  // 必须以 # 开头
  if (!trimmed.startsWith("#")) {
    return false;
  }

  // 检测上下文关键字
  const contextPatterns = [
    /^#\s*你的身份/,
    /^#\s*你的角色/,
    /^#\s*群聊信息/,
    /^#\s*-.*成员/,
    /^#\s*>.*:/, // 对话历史引用
    /^#\s*项目上下文/,
    /^#\s*项目说明文档/,
  ];

  return contextPatterns.some((p) => p.test(trimmed));
}

/** Unique marker embedded in the last context separator line by bridge-trigger.ts. */
const CTX_END_MARKER = "[OPENCLAW_CTX_END]";

/**
 * Visible separator line appended after the user's request text (before Enter).
 * Everything above (and including) the last occurrence of this line is stripped
 * during text extraction so the final output contains only the CLI's response.
 */
const INPUT_END_MARKER = "# ──── End of Input ────";

/**
 * 过滤上下文消息块
 *
 * 策略：从后往前查找最后一个包含 `[OPENCLAW_CTX_END]` 标记的行，
 * 只保留该标记之后的内容（跳过紧随的空行）。
 * 这样无论上下文块格式怎么变、有没有"用户请求"标记，都能精确定位。
 *
 * 如果没有找到标记（旧版后端），回退到基于 `#=` 分隔线 + "用户请求"
 * 的状态机扫描（兼容模式）。
 */
function filterContextBlock(text: string): string {
  const lines = text.split("\n");

  // ─── 最高优先：从后往前查找 "# ──── End of Input ────" 标记 ───
  // This marker is appended after the user's visible request text.
  // Everything above it (context + user input echo) should be stripped.
  let lastInputEndIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes(INPUT_END_MARKER)) {
      lastInputEndIndex = i;
      break;
    }
  }

  if (lastInputEndIndex !== -1) {
    // Skip the marker line and any trailing empty lines
    let startIndex = lastInputEndIndex + 1;
    while (startIndex < lines.length && lines[startIndex].trim() === "") {
      startIndex++;
    }
    return lines.slice(startIndex).join("\n").trim();
  }

  // ─── 次优先：从后往前查找 [OPENCLAW_CTX_END] 标记 ───
  let lastMarkerIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes(CTX_END_MARKER)) {
      lastMarkerIndex = i;
      break;
    }
  }

  if (lastMarkerIndex !== -1) {
    // 跳过标记行之后的空行
    let startIndex = lastMarkerIndex + 1;
    while (startIndex < lines.length && lines[startIndex].trim() === "") {
      startIndex++;
    }
    return lines.slice(startIndex).join("\n").trim();
  }

  // ─── 兼容回退：旧版状态机扫描（从前往后） ───
  const filtered: string[] = [];
  let inContextBlock = false;
  let foundUserRequest = false;

  for (const line of lines) {
    if (line.match(/^[#=]{10,}/) || line.includes("系统上下文")) {
      inContextBlock = true;
      continue;
    }

    if (line.includes("用户请求")) {
      inContextBlock = false;
      foundUserRequest = true;
      continue;
    }

    if (foundUserRequest && line.match(/^[#=]{10,}/)) {
      foundUserRequest = false;
      continue;
    }

    if (inContextBlock) {
      continue;
    }

    if (isContextCommentLine(line)) {
      continue;
    }

    filtered.push(line);
  }

  return filtered.join("\n").trim();
}

/**
 * Trim the CLI "waiting for input" prompt area from the end of extracted text.
 *
 * Strategy: search from the last line upward for the `tailTrimMarker` regex.
 * Once found, continue upward to skip any chrome lines (─═ etc.) that form
 * the prompt's top border. Everything from that point onward is removed.
 *
 * Example (CodeBuddy):
 *   ─────────────────────────────────────────────────
 *   > 帮我写一个Python小程序                 ↵ send   ← marker matches here
 *   ─────────────────────────────────────────────────
 *   ⏵⏵ bypass permissions on (shift+tab to cycle)
 *   ? for shortcuts
 *
 * All of the above gets trimmed.
 */
function trimTailPrompt(text: string, markerPattern: string): string {
  if (!markerPattern) {
    return text;
  }

  let marker: RegExp;
  try {
    marker = new RegExp(markerPattern);
  } catch {
    // Invalid regex — skip trimming
    return text;
  }

  const lines = text.split("\n");

  // 1. Strip trailing empty lines first
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  // 2. Search from the last line upward for the marker
  let markerLineIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (marker.test(lines[i])) {
      markerLineIndex = i;
      break;
    }
    // Don't search too far back — limit to last 15 lines
    if (lines.length - 1 - i > 15) {
      break;
    }
  }

  if (markerLineIndex === -1) {
    return text; // Marker not found — no trimming
  }

  // 3. From the marker line, continue upward to skip chrome lines (prompt border)
  let cutIndex = markerLineIndex;
  for (let i = markerLineIndex - 1; i >= 0; i--) {
    if (isTerminalChromeLine(lines[i]) || lines[i].trim() === "") {
      cutIndex = i;
    } else {
      break; // Hit a non-chrome, non-empty line — stop
    }
  }

  // 4. Truncate: keep everything before cutIndex
  const result = lines.slice(0, cutIndex);

  // Clean trailing empty lines from the result
  while (result.length > 0 && result[result.length - 1].trim() === "") {
    result.pop();
  }

  return result.join("\n");
}

// ─── Terminal Interface (for xterm.js or fallback) ───

interface ITerminalLike {
  write(data: string | Uint8Array): void;
  clear(): void;
  dispose(): void;
  cols: number;
  rows: number;
  /** Extract visible text from terminal buffer */
  extractText(): string;
  /** Wait until queued terminal writes have been flushed */
  whenIdle(): Promise<void>;
}

/**
 * Plain-text fallback terminal when xterm.js is not available.
 * Accumulates raw text output (with ANSI stripped via simple regex).
 */
class PlainTextTerminal implements ITerminalLike {
  private buffer: string[] = [];
  cols = 80;
  rows = 24;

  write(data: string | Uint8Array): void {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    // Strip basic ANSI escape sequences for plain-text display
    const cleaned = text.replace(
      // eslint-disable-next-line no-control-regex
      /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][AB012]|\x1b\[[?]?[0-9;]*[hl]/g,
      "",
    );
    this.buffer.push(cleaned);
  }

  clear(): void {
    this.buffer = [];
  }

  dispose(): void {
    this.buffer = [];
  }

  extractText(): string {
    // 1. 规范化（清理终端框架字符、空白行）
    let text = normalizeExtractedTerminalText(this.buffer.join(""));
    // 2. 过滤上下文消息
    text = filterContextBlock(text);
    // 3. 清理 ANSI 序列（二次清理）
    text = stripAnsiEscapes(text);
    return text;
  }

  whenIdle(): Promise<void> {
    return Promise.resolve();
  }

  getContent(): string {
    return this.buffer.join("");
  }
}

// ─── Component ───

@customElement("bridge-terminal")
export class BridgeTerminal extends LitElement {
  /** Group chat ID */
  @property({ type: String }) groupId = "";

  /** Bridge Agent ID */
  @property({ type: String }) agentId = "";

  /** CLI tool type for status display */
  @property({ type: String }) cliType = "custom";

  /** Terminal status */
  @property({ type: String }) status: BridgeTerminalStatus = "idle";

  /** Replay buffer (Base64-encoded terminal data, for page refresh restoration) */
  @property({ type: String }) replayBuffer = "";

  /**
   * Regex pattern to detect CLI prompt area at the end of terminal output.
   * When matched (searched from last line upward), the line and everything
   * below it (plus leading chrome lines) are trimmed from extracted text.
   */
  @property({ type: String }) tailTrimMarker = "";

  /** Whether terminal is collapsed (default: collapsed, user clicks to expand) */
  @state() private _collapsed = true;

  /** Whether xterm.js is loaded */
  @state() private _xtermLoaded = false;

  /** Internal terminal instance */
  private _terminal: ITerminalLike | null = null;

  /** Track terminal initialisation so completion waits for xterm if available. */
  private _initTerminalPromise: Promise<void> | null = null;

  /** Dynamic status indicator - whether terminal is actively receiving data */
  @state() private _isWorking = false;

  /** Idle timer for dynamic status indicator (2.5 seconds) */
  private _idleTimer: number | null = null;

  /** Idle timeout for status indicator (ms) */
  private readonly IDLE_TIMEOUT = 2500;

  /** Frontend-based completion detection */
  private _lastDataTime = 0;
  private _completionCheckTimer: number | null = null;
  private readonly COMPLETION_IDLE_SECS = 8;

  /** Container element for xterm.js rendering */
  private _terminalContainer: HTMLElement | null = null;

  /** xterm.js Terminal class (dynamically loaded) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _TerminalClass: any = null;

  /** xterm.js FitAddon */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _fitAddon: any = null;

  /** Plain text fallback instance (used when xterm is not available) */
  private _plainTextTerminal: PlainTextTerminal | null = null;

  // ─── Streaming text extraction (real-time chat bubble) ───

  /** Timer for throttled stream-update events (fires every ~200ms while active). */
  private _streamExtractTimer: number | null = null;

  /** Interval between stream-update extractions (ms). */
  private readonly STREAM_EXTRACT_INTERVAL = 200;

  /** Last emitted stream text — used to avoid redundant events when nothing changed. */
  private _lastStreamText = "";

  /** Whether we have ever emitted a stream update during this working cycle. */
  private _streamUpdateEmitted = false;

  static styles = css`
    :host {
      display: block;
      width: 100%;
    }

    .bridge-terminal-wrapper {
      border-radius: var(--radius-md, 6px);
      overflow: hidden;
      border: 1px solid var(--border-color, rgba(255, 255, 255, 0.1));
      background: #1e1e2e;
    }

    .bridge-terminal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      background: rgba(255, 255, 255, 0.05);
      cursor: pointer;
      user-select: none;
      font-size: 12px;
      color: #cdd6f4;
    }

    .bridge-terminal-header:hover {
      background: rgba(255, 255, 255, 0.08);
    }

    .bridge-terminal-header__left {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .bridge-terminal-header__status {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .bridge-terminal-header__status--working {
      color: #f9e2af;
    }

    .bridge-terminal-header__status--ready {
      color: #a6e3a1;
    }

    .bridge-terminal-header__status--completed {
      color: #a6e3a1;
    }

    .bridge-terminal-header__status--timeout {
      color: #ff9933;
      font-weight: bold;
    }

    .bridge-terminal-header__status--error {
      color: #f38ba8;
    }

    .bridge-terminal-header__status--disconnected {
      color: #fab387;
    }

    .bridge-terminal-header__toggle {
      font-size: 10px;
      transition: transform 0.2s ease;
    }

    .bridge-terminal-header__toggle--collapsed {
      transform: rotate(-90deg);
    }

    .bridge-terminal-body {
      max-height: 450px;
      overflow: hidden;
      transition: max-height 0.3s ease;
    }

    .bridge-terminal-body--collapsed {
      max-height: 0;
    }

    .terminal-container {
      width: 100%;
      min-height: 100px;
    }

    /* Fallback plain-text display */
    .terminal-plaintext {
      margin: 0;
      padding: 8px;
      color: #cdd6f4;
      background: #1e1e2e;
      font-family: "Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace;
      font-size: 12px;
      line-height: 1.2;
      white-space: pre-wrap;
      overflow-x: auto;
      overflow-y: auto;
      max-height: 440px;
      tab-size: 8;
      word-break: break-all;
    }

    @keyframes pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.5;
      }
    }

    .working-indicator {
      animation: pulse 1.5s ease-in-out infinite;
    }

    /* xterm.js theme overrides */
    .xterm .xterm-viewport {
      background: #1e1e2e !important;
    }

    /*
     * Critical xterm.js helper textarea fix — prevents it from appearing as
     * a visible white box in Shadow DOM when the full xterm.css hasn't loaded yet.
     */
    .xterm .xterm-helper-textarea {
      position: absolute;
      opacity: 0;
      left: -9999em;
      top: 0;
      width: 0;
      height: 0;
      z-index: -5;
      overflow: hidden;
      resize: none;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    if (this.groupId && this.agentId) {
      bridgeTerminalRegistry.set(registryKey(this.groupId, this.agentId), this);
    }
    this._initTerminalPromise = this._initTerminal();
    void this._initTerminalPromise;
  }

  disconnectedCallback() {
    const key = registryKey(this.groupId, this.agentId);
    if (bridgeTerminalRegistry.get(key) === this) {
      bridgeTerminalRegistry.delete(key);
    }
    // Clear idle timer for dynamic status indicator
    if (this._idleTimer !== null) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
    // Clear completion check timer
    if (this._completionCheckTimer !== null) {
      clearTimeout(this._completionCheckTimer);
      this._completionCheckTimer = null;
    }
    // Clear stream extraction timer
    this._resetStreamState();
    this._disposeTerminal();
    super.disconnectedCallback();
  }

  protected updated(changedProperties: Map<string, unknown>): void {
    super.updated(changedProperties);

    // Start completion detection when status becomes "working" or "ready"
    // This handles the case where terminal is restored after page refresh
    if (changedProperties.has("status")) {
      const prevStatus = changedProperties.get("status") as string | undefined;

      if (this.status === "working" || this.status === "ready") {
        // When transitioning from a finished state (completed/timeout/error) to working,
        // clear the terminal buffer to prevent unbounded accumulation across
        // multiple interaction cycles.
        if (prevStatus === "completed" || prevStatus === "timeout" || prevStatus === "error") {
          this._terminal?.clear();
          this._plainTextTerminal?.clear();
          this._resetStreamState();
        }

        // Initialize lastDataTime to now
        this._lastDataTime = Date.now();
        // Start completion check timer
        this._resetCompletionCheck();
      }
    }

    // Restore terminal content from replay buffer (after page refresh)
    if (changedProperties.has("replayBuffer") && this.replayBuffer && this._terminal) {
      try {
        // Decode Base64 replay buffer
        const binary = atob(this.replayBuffer);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));

        // Write to terminal
        if (this._terminal) {
          this._terminal.write(bytes);
        }

        // If the terminal is already completed (page refresh of a finished session),
        // emit a stream update so the controller can create a frozen bubble.
        // Use a short delay to let xterm process the write buffer first.
        if (this.status === "completed") {
          setTimeout(() => {
            const text = this.extractVisibleText();
            if (text.trim()) {
              this.dispatchEvent(
                new BridgeTerminalStreamUpdateEvent(this.groupId, this.agentId, text),
              );
            }
          }, 100);
        }
      } catch (err) {
        console.warn("[bridge-terminal] Failed to restore replay buffer:", err);
      }
    }
  }

  // ─── Public API ───

  /**
   * Write raw PTY data to the terminal.
   * Called by the controller when a `group.terminal` event is received.
   */
  writeData(data: string): void {
    // After completion/timeout, stray PTY data (cursor blinks, heartbeats) should
    // still be written to the terminal for display, but should NOT restart
    // completion detection or flip the status indicator back to working.
    const isFinished = this.status === "completed" || this.status === "timeout";

    if (!isFinished) {
      // Set working status when data is written (for dynamic status indicator)
      this._setWorkingStatus();
      // Update last data time for frontend completion detection
      this._lastDataTime = Date.now();
    }

    if (!this._terminal) {
      // Buffer data if terminal hasn't initialized yet
      if (!this._plainTextTerminal) {
        this._plainTextTerminal = new PlainTextTerminal();
      }
      this._plainTextTerminal.write(data);
      this.requestUpdate();
      return;
    }
    this._terminal.write(data);
    if (!this._xtermLoaded) {
      this.requestUpdate();
    }

    // Schedule stream text extraction for real-time chat bubble
    if (!isFinished) {
      this._scheduleStreamExtract();
    }

    // Reset completion check timer (frontend-based detection) — skip if already finished
    if (!isFinished) {
      this._resetCompletionCheck();
    }
  }

  /**
   * Write raw binary data (Uint8Array) to the terminal.
   */
  writeBinaryData(data: Uint8Array): void {
    const isFinished = this.status === "completed" || this.status === "timeout";

    if (!isFinished) {
      // Set working status when data is written (for dynamic status indicator)
      this._setWorkingStatus();
      // Update last data time for frontend completion detection
      this._lastDataTime = Date.now();
    }

    if (!this._terminal) {
      if (!this._plainTextTerminal) {
        this._plainTextTerminal = new PlainTextTerminal();
      }
      this._plainTextTerminal.write(new TextDecoder().decode(data));
      this.requestUpdate();
      return;
    }
    this._terminal.write(data);
    if (!this._xtermLoaded) {
      this.requestUpdate();
    }

    // Schedule stream text extraction for real-time chat bubble
    if (!isFinished) {
      this._scheduleStreamExtract();
    }

    // Reset completion check timer (frontend-based detection) — skip if already finished
    if (!isFinished) {
      this._resetCompletionCheck();
    }
  }

  // ─── Streaming Text Extraction (Real-time Chat Bubble) ───

  /**
   * Schedule a throttled extraction of visible text for the streaming chat bubble.
   * Uses a fixed-interval timer: the first call starts it, subsequent calls
   * within the interval are coalesced. The extraction reads the xterm.js buffer
   * (which already handles \r, cursor moves, overwrites) so in-place updates
   * in the terminal are automatically reflected as text changes.
   */
  private _scheduleStreamExtract(): void {
    if (this._streamExtractTimer !== null) {
      return; // Timer already scheduled
    }
    this._streamExtractTimer = window.setTimeout(() => {
      this._streamExtractTimer = null;
      this._emitStreamUpdate();
    }, this.STREAM_EXTRACT_INTERVAL);
  }

  /**
   * Extract visible text from the terminal buffer and fire a stream-update event.
   * Only fires if the text has changed since the last emission.
   */
  private _emitStreamUpdate(): void {
    const text = this.extractVisibleText();
    if (text === this._lastStreamText) {
      return; // No change — skip
    }
    this._lastStreamText = text;
    this._streamUpdateEmitted = true;
    this.dispatchEvent(new BridgeTerminalStreamUpdateEvent(this.groupId, this.agentId, text));
  }

  /**
   * Clear streaming state. Called when the terminal transitions to a new working cycle.
   */
  private _resetStreamState(): void {
    if (this._streamExtractTimer !== null) {
      clearTimeout(this._streamExtractTimer);
      this._streamExtractTimer = null;
    }
    this._lastStreamText = "";
    this._streamUpdateEmitted = false;
  }

  // ─── Dynamic Status Indicator ───

  /**
   * Set working status and reset idle timer.
   * Called when terminal data is written to indicate active work.
   */
  private _setWorkingStatus(): void {
    // Set to working status if not already
    if (!this._isWorking) {
      this._isWorking = true;
    }

    // Clear existing idle timer
    if (this._idleTimer !== null) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }

    // Set new idle timer (2.5 seconds)
    this._idleTimer = window.setTimeout(() => {
      this._isWorking = false;
      this._idleTimer = null;
    }, this.IDLE_TIMEOUT);
  }

  // ─── Frontend-Based Completion Detection ───

  /**
   * Reset completion check timer.
   * Called when new data is written to the terminal.
   */
  private _resetCompletionCheck(): void {
    // Clear existing timer
    if (this._completionCheckTimer !== null) {
      clearTimeout(this._completionCheckTimer);
      this._completionCheckTimer = null;
    }

    // Only start completion detection if status is "working" or "ready"
    if (this.status !== "working" && this.status !== "ready") {
      return;
    }

    // Set new timer
    this._completionCheckTimer = window.setTimeout(() => {
      this._checkCompletion();
    }, this.COMPLETION_IDLE_SECS * 1000);
  }

  /**
   * Check if CLI has completed based on frontend idle detection.
   * Called after COMPLETION_IDLE_SECS seconds of no new data.
   *
   * When idle timeout fires, we stop the streaming chat bubble (freeze it
   * at its current content) and mark the terminal as completed.
   */
  private _checkCompletion(): void {
    // Verify that we've been idle for the required time
    const now = Date.now();
    const idleTime = now - this._lastDataTime;

    if (idleTime < this.COMPLETION_IDLE_SECS * 1000) {
      return; // Not idle yet, timer was reset
    }

    // Double-check status
    if (this.status !== "working" && this.status !== "ready") {
      return;
    }

    console.log("[bridge-terminal] Frontend idle timeout — freezing stream bubble");

    // Extract text before resetting stream state — this is the final output
    // that needs to be sent to the backend for transcript persistence.
    const extractedText = this.extractVisibleText();

    // Stop streaming: notify controller to freeze the chat bubble,
    // push extracted text to backend, then clean up local stream state.
    if (this._streamUpdateEmitted) {
      this.dispatchEvent(
        new BridgeTerminalStreamEndEvent(this.groupId, this.agentId, extractedText),
      );
    }
    this._resetStreamState();

    // Mark as completed (the frozen bubble remains as the final output)
    this.status = "completed";
  }

  /**
   * Extract visible text from the terminal buffer.
   * Used for creating the plain-text transcript message.
   */
  extractVisibleText(): string {
    let text = "";
    if (this._terminal) {
      text = this._terminal.extractText();
    } else if (this._plainTextTerminal) {
      text = this._plainTextTerminal.extractText();
    }
    // Apply tail trim if configured (remove CLI prompt area from end)
    if (this.tailTrimMarker && text) {
      text = trimTailPrompt(text, this.tailTrimMarker);
    }
    return text;
  }

  /**
   * Whether this terminal has emitted any stream-update events during
   * the current working cycle. Used by the controller to decide whether
   * to clean up the streaming chat bubble on completion.
   */
  get hasStreamedOutput(): boolean {
    return this._streamUpdateEmitted;
  }

  /**
   * Collapse the terminal view (called when CLI completes).
   */
  collapse(): void {
    this._collapsed = true;
  }

  /**
   * Expand the terminal view.
   */
  expand(): void {
    this._collapsed = false;
  }

  /**
   * Clear terminal content (e.g. on CLI restart).
   */
  clearTerminal(): void {
    this._terminal?.clear();
    this._plainTextTerminal?.clear();
  }

  // ─── Private Methods ───

  private async _initTerminal(): Promise<void> {
    try {
      // Try to dynamically load xterm.js
      // NOTE: Requires `@xterm/xterm` and `@xterm/addon-fit` packages.
      //       Install: `pnpm add @xterm/xterm @xterm/addon-fit`
      // @ts-expect-error -- @xterm/xterm may not be installed yet
      const xtermModule = await import("@xterm/xterm");
      // @ts-expect-error -- @xterm/addon-fit may not be installed yet
      const { FitAddon } = await import("@xterm/addon-fit");

      // Dynamically load xterm.css and inject into Shadow DOM
      if (!xtermCssText) {
        try {
          const cssModule = await import("@xterm/xterm/css/xterm.css?raw");
          xtermCssText = cssModule.default;
        } catch {
          // Fallback: CSS not available
        }
      }
      if (xtermCssText && this.shadowRoot) {
        const xtermSheet = new CSSStyleSheet();
        xtermSheet.replaceSync(xtermCssText);
        this.shadowRoot.adoptedStyleSheets = [...this.shadowRoot.adoptedStyleSheets, xtermSheet];
      }

      this._TerminalClass = xtermModule.Terminal;
      this._xtermLoaded = true;

      // Wait for render to get the container element
      await this.updateComplete;
      this._terminalContainer = this.renderRoot.querySelector(".terminal-container");

      if (this._terminalContainer) {
        const terminal = new this._TerminalClass({
          cursorBlink: false,
          disableStdin: true, // Read-only terminal
          scrollback: 5000,
          fontSize: 12,
          fontFamily: '"Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace',
          theme: {
            background: "#1e1e2e",
            foreground: "#cdd6f4",
            cursor: "#f5e0dc",
            selectionBackground: "#585b70",
            selectionForeground: "#cdd6f4",
          },
          convertEol: true,
          allowProposedApi: true,
        });

        this._fitAddon = new FitAddon();
        terminal.loadAddon(this._fitAddon);
        terminal.open(this._terminalContainer);

        let pendingWrites = 0;
        const idleResolvers: Array<() => void> = [];
        const resolveIdle = () => {
          if (pendingWrites !== 0) {
            return;
          }
          while (idleResolvers.length > 0) {
            idleResolvers.shift()?.();
          }
        };

        // Create wrapper with extractText support
        const terminalWrapper: ITerminalLike = {
          write: (data: string | Uint8Array) => {
            pendingWrites++;
            terminal.write(data, () => {
              pendingWrites = Math.max(0, pendingWrites - 1);
              resolveIdle();
            });
          },
          clear: () => terminal.clear(),
          dispose: () => terminal.dispose(),
          get cols() {
            return terminal.cols;
          },
          get rows() {
            return terminal.rows;
          },
          extractText: () => {
            const buffer = terminal.buffer.active;
            const lines: string[] = [];
            for (let i = 0; i < buffer.length; i++) {
              const line = buffer.getLine(i);
              if (!line) {
                continue;
              }
              const translated = line.translateToString(true);
              if (line.isWrapped && lines.length > 0) {
                lines[lines.length - 1] += translated;
              } else {
                lines.push(translated);
              }
            }
            // 1. 规范化（清理终端框架字符、空白行）
            let text = normalizeExtractedTerminalText(lines.join("\n"));
            // 2. 过滤上下文消息
            text = filterContextBlock(text);
            // 3. 清理 ANSI 序列（二次清理）
            text = stripAnsiEscapes(text);
            return text;
          },
          whenIdle: () =>
            pendingWrites === 0
              ? Promise.resolve()
              : new Promise<void>((resolve) => idleResolvers.push(resolve)),
        };

        this._terminal = terminalWrapper;

        // Replay any buffered plain text data
        if (this._plainTextTerminal) {
          const buffered = this._plainTextTerminal.getContent();
          if (buffered) {
            terminalWrapper.write(buffered);
          }
          this._plainTextTerminal = null;
        }

        // Fit terminal to container
        try {
          this._fitAddon.fit();
        } catch {
          // Container may not be visible yet
        }

        // Listen for resize
        const resizeObserver = new ResizeObserver(() => {
          try {
            this._fitAddon?.fit();
            if (this._terminal) {
              this.dispatchEvent(
                new BridgeTerminalResizeEvent(
                  this.groupId,
                  this.agentId,
                  this._terminal.cols,
                  this._terminal.rows,
                ),
              );
            }
          } catch {
            // Ignore resize errors during teardown
          }
        });
        resizeObserver.observe(this._terminalContainer);
      }
    } catch {
      // xterm.js not available — fall back to plain text mode
      console.warn(
        "[bridge-terminal] @xterm/xterm not available, using plain-text fallback. " +
          "Install with: pnpm add @xterm/xterm @xterm/addon-fit",
      );
      this._xtermLoaded = false;

      if (!this._plainTextTerminal) {
        this._plainTextTerminal = new PlainTextTerminal();
      }
      this._terminal = this._plainTextTerminal;
    }
  }

  private _disposeTerminal(): void {
    this._terminal?.dispose();
    this._terminal = null;
    this._plainTextTerminal = null;
    this._fitAddon = null;
    this._TerminalClass = null;
  }

  private _toggleCollapse = (): void => {
    this._collapsed = !this._collapsed;
  };

  private _getStatusLabel(): string {
    // For idle/ready status, use dynamic working status indicator
    if (this.status === "idle" || this.status === "ready") {
      if (this._isWorking) {
        return `🔧 ${this._cliDisplayName()} 正在工作...`;
      } else {
        return `🔧 ${this._cliDisplayName()}`;
      }
    }

    // For other statuses, use static labels
    switch (this.status) {
      case "working":
        return `🔧 ${this._cliDisplayName()} 正在工作...`;
      case "completed":
        return `📦 ${this._cliDisplayName()} 执行完毕`;
      case "timeout":
        return `⏱️ ${this._cliDisplayName()} 执行超时，已中断`;
      case "error":
        return `❌ ${this._cliDisplayName()} 出现错误`;
      case "disconnected":
        return `⚡ 连接中断，等待恢复...`;
      default:
        return `⏳ ${this._cliDisplayName()} 待命`;
    }
  }

  private _cliDisplayName(): string {
    switch (this.cliType) {
      case "claude-code":
        return "Claude Code";
      case "opencode":
        return "OpenCode";
      case "codebuddy":
        return "CodeBuddy";
      default:
        return this.agentId;
    }
  }

  // ─── Render ───

  render() {
    const statusClass = `bridge-terminal-header__status bridge-terminal-header__status--${this.status}`;
    // Show working indicator animation when status is "working" OR when terminal is actively receiving data
    const isWorking = this.status === "working" || this._isWorking;
    const toggleClass = `bridge-terminal-header__toggle ${this._collapsed ? "bridge-terminal-header__toggle--collapsed" : ""}`;
    const bodyClass = `bridge-terminal-body ${this._collapsed ? "bridge-terminal-body--collapsed" : ""}`;

    return html`
      <div class="bridge-terminal-wrapper">
        <div class="bridge-terminal-header" @click=${this._toggleCollapse}>
          <div class="bridge-terminal-header__left">
            <span class="${statusClass} ${isWorking ? "working-indicator" : ""}">
              ${this._getStatusLabel()}
            </span>
          </div>
          <span class="${toggleClass}">▼</span>
        </div>
        <div class="${bodyClass}">
          ${
            this._xtermLoaded
              ? html`
                  <div class="terminal-container"></div>
                `
              : html`<pre class="terminal-plaintext">${this._plainTextTerminal?.getContent() ?? ""}</pre>`
          }
        </div>
      </div>
    `;
  }

  /**
   * Called when the backend signals that the bridge agent has completed or timed out.
   * Cleans up streaming state and marks the terminal as finished.
   * (The streaming chat bubble is cleared by the controller directly.)
   */
  completeAndFold(status: "completed" | "timeout" = "completed"): void {
    // Prevent duplicate completion calls
    if (this.status === "completed" || this.status === "timeout") {
      return;
    }

    // Clean up streaming state (the controller handles clearing the stream
    // bubble directly when it receives the backend completion signal).
    this._resetStreamState();

    this.status = status;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "bridge-terminal": BridgeTerminal;
  }
}
