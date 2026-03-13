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

// ─── Types ───

export type BridgeTerminalStatus = "idle" | "working" | "completed" | "error" | "disconnected";

/**
 * Event fired when xterm.js buffer text is extracted for transcript.
 * The parent controller captures this and sends it back to the backend.
 */
export class BridgeTerminalTextExtractedEvent extends Event {
  static readonly eventName = "bridge-terminal-text-extracted";
  constructor(
    public readonly groupId: string,
    public readonly agentId: string,
    public readonly text: string,
  ) {
    super(BridgeTerminalTextExtractedEvent.eventName, { bubbles: true, composed: true });
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

// ─── Terminal Interface (for xterm.js or fallback) ───

interface ITerminalLike {
  write(data: string | Uint8Array): void;
  clear(): void;
  dispose(): void;
  cols: number;
  rows: number;
  /** Extract visible text from terminal buffer */
  extractText(): string;
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
    return this.buffer.join("").trim();
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

  /** Whether terminal is collapsed */
  @state() private _collapsed = false;

  /** Whether xterm.js is loaded */
  @state() private _xtermLoaded = false;

  /** Internal terminal instance */
  private _terminal: ITerminalLike | null = null;

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

    .bridge-terminal-header__status--completed {
      color: #a6e3a1;
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
  `;

  connectedCallback() {
    super.connectedCallback();
    if (this.groupId && this.agentId) {
      bridgeTerminalRegistry.set(registryKey(this.groupId, this.agentId), this);
    }
    void this._initTerminal();
  }

  disconnectedCallback() {
    const key = registryKey(this.groupId, this.agentId);
    if (bridgeTerminalRegistry.get(key) === this) {
      bridgeTerminalRegistry.delete(key);
    }
    this._disposeTerminal();
    super.disconnectedCallback();
  }

  // ─── Public API ───

  /**
   * Write raw PTY data to the terminal.
   * Called by the controller when a `group.terminal` event is received.
   */
  writeData(data: string): void {
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
  }

  /**
   * Write raw binary data (Uint8Array) to the terminal.
   */
  writeBinaryData(data: Uint8Array): void {
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
  }

  /**
   * Extract visible text from the terminal buffer.
   * Used for creating the plain-text transcript message.
   */
  extractVisibleText(): string {
    if (this._terminal) {
      return this._terminal.extractText();
    }
    if (this._plainTextTerminal) {
      return this._plainTextTerminal.extractText();
    }
    return "";
  }

  /**
   * Fire a text-extracted event for the controller to pick up.
   */
  fireTextExtracted(): void {
    const text = this.extractVisibleText();
    this.dispatchEvent(new BridgeTerminalTextExtractedEvent(this.groupId, this.agentId, text));
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

        // Create wrapper with extractText support
        const terminalWrapper: ITerminalLike = {
          write: (data: string | Uint8Array) => terminal.write(data),
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
              if (line) {
                lines.push(line.translateToString(true));
              }
            }
            return lines.filter((line) => line.trim().length > 0).join("\n");
          },
        };

        this._terminal = terminalWrapper;

        // Replay any buffered plain text data
        if (this._plainTextTerminal) {
          const buffered = this._plainTextTerminal.getContent();
          if (buffered) {
            terminal.write(buffered);
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
    switch (this.status) {
      case "working":
        return `🔧 ${this._cliDisplayName()} 正在工作...`;
      case "completed":
        return `📦 ${this._cliDisplayName()} 执行完毕`;
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
    const isWorking = this.status === "working";
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
   * Called when the terminal should complete and fold.
   * Extracts text and fires the extract event.
   */
  completeAndFold(): void {
    this.status = "completed";
    this.fireTextExtracted();
    this.collapse();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "bridge-terminal": BridgeTerminal;
  }
}
