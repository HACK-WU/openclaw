import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import xtermStyles from "@xterm/xterm/css/xterm.css?inline";
/**
 * 终端查看器组件 - 使用 xterm.js 渲染 PTY 输出。
 *
 * 用于正确显示包含 ANSI 转义序列的终端输出，例如颜色、光标控制、文本样式等。
 */
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * Global registry to track terminal instances by session ID.
 * Ensures only one terminal instance per active session (singleton pattern).
 */
const terminalRegistry = new Map<string, TerminalViewer>();

/**
 * Get or create a terminal viewer instance for the given session ID.
 * This implements a singleton pattern per session.
 */
export function getOrCreateTerminalViewer(sessionId: string): TerminalViewer | null {
  return terminalRegistry.get(sessionId) || null;
}

/**
 * Register a terminal viewer instance with the given session ID.
 */
export function registerTerminalViewer(sessionId: string, viewer: TerminalViewer): void {
  terminalRegistry.set(sessionId, viewer);
}

/**
 * Unregister a terminal viewer instance when it's disconnected.
 */
export function unregisterTerminalViewer(viewer: TerminalViewer): void {
  for (const [sessionId, instance] of terminalRegistry.entries()) {
    if (instance === viewer) {
      terminalRegistry.delete(sessionId);
      break;
    }
  }
}

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
const MIN_ROWS = 4;
const PREVIEW_ROWS = 6;
/** Maximum lines to keep in terminal scrollback buffer */
const DEFAULT_SCROLLBACK_LINES = 10000;

/**
 * Interval between line reveals (ms) for typewriter effect.
 * Lower = faster typing, Higher = slower more visible typing.
 * 10ms ≈ 100 lines/sec (very fast and smooth)
 */
const TYPEWRITER_LINE_INTERVAL_MS = 10;

@customElement("terminal-viewer")
export class TerminalViewer extends LitElement {
  /** PTY 原始输出内容（包含 ANSI 转义序列） */
  @property({ type: String }) content = "";

  /** 是否为预览模式（限制高度，用于 tool card 内联预览） */
  @property({ type: Boolean }) preview = false;

  /** 是否为实时模式（增量写入，用于流式 PTY 输出） */
  @property({ type: Boolean }) live = false;

  /** Session ID for singleton pattern - ensures one terminal per session */
  @property({ type: String }) sessionId?: string;

  private term: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private resizeObserver: ResizeObserver | null = null;
  /** Track the full content that has been displayed */
  private _displayedContent = "";
  /** Current line index for typewriter animation */
  private _currentLineIndex = 0;
  /** All lines from target content */
  private _targetLines: string[] = [];
  /** Typewriter animation timer */
  private _typewriterTimer: number | null = null;

  static styles = css`
    :host {
      display: block;
      width: 100%;
    }

    .terminal-container {
      border-radius: var(--radius-md, 6px);
      overflow: hidden;
      background: #1e1e2e;
    }

    .terminal-container.preview {
      max-height: 140px;
      overflow: hidden;
      position: relative;
    }

    .terminal-container.preview::after {
      content: "";
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 32px;
      background: linear-gradient(transparent, #1e1e2e);
      pointer-events: none;
    }

    .terminal-container .xterm {
      padding: 8px;
    }

    .terminal-container .xterm-viewport {
      overflow-y: auto !important;
    }

    .terminal-container.preview .xterm-viewport {
      overflow: hidden !important;
    }
  `;

  /** 将 xterm.js 的样式注入 Shadow DOM */
  protected createRenderRoot() {
    const root = super.createRenderRoot();
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(xtermStyles);
    (root as ShadowRoot).adoptedStyleSheets = [...(root as ShadowRoot).adoptedStyleSheets, sheet];
    return root;
  }

  protected firstUpdated() {
    this.initTerminal();
  }

  protected updated(changed: Map<string, unknown>) {
    if (changed.has("content") && this.term) {
      // Stop any existing typewriter animation
      this._stopTypewriter();

      if (
        this.live &&
        this.content.length > this._displayedContent.length &&
        this.content.startsWith(this._displayedContent)
      ) {
        // Live mode: new content is an append of old content, write only the delta
        const delta = this.content.slice(this._displayedContent.length);
        if (delta) {
          this.term.write(delta);
        }
        this._displayedContent = this.content;
      } else {
        // Full mode: check if this is new content or same content
        if (this.preview) {
          // Preview mode: show all content immediately
          this.term.reset();
          if (this.content) {
            this.term.write(this.content);
          }
          this._displayedContent = this.content;
        } else {
          // Non-preview mode: first display shows history, new output animates
          if (!this._displayedContent) {
            // First time: show all content immediately (no animation for history)
            this.term.reset();
            if (this.content) {
              this.term.write(this.content);
            }
            this._displayedContent = this.content;
          } else if (this.content !== this._displayedContent) {
            // Content changed: determine if it's an append or replacement
            if (
              this.content.length > this._displayedContent.length &&
              this.content.startsWith(this._displayedContent)
            ) {
              // Append scenario: only animate the new delta
              const delta = this.content.slice(this._displayedContent.length);
              if (delta) {
                // Start animation for delta - _displayedContent will be updated when animation completes
                this._startTypewriterForDelta(delta);
              } else {
                // No delta but content is different - update immediately
                this._displayedContent = this.content;
              }
            } else {
              // Replacement scenario: content is completely different
              this.term.reset();
              if (this.content) {
                this.term.write(this.content);
              }
              this._displayedContent = this.content;
            }
          }
          // If content is the same, do nothing (skip animation)
        }
      }
    }
  }

  /**
   * Fit terminal width to container without changing the row count.
   * Using fitAddon.fit() directly causes a feedback loop: fit() shrinks rows
   * → container shrinks → ResizeObserver fires → fit() shrinks again → terminal
   * collapses to near-zero height. Instead, use proposeDimensions() to get
   * the ideal column count, then resize with the current row count preserved.
   */
  private fitWidth() {
    if (!this.fitAddon || !this.term) {
      return;
    }
    try {
      const dims = this.fitAddon.proposeDimensions();
      if (dims && dims.cols > 0 && dims.cols !== this.term.cols) {
        this.term.resize(dims.cols, this.term.rows);
      }
    } catch {
      // ignore fit errors
    }
  }

  private initTerminal() {
    const container = this.shadowRoot?.querySelector(".terminal-container") as HTMLElement | null;
    if (!container) {
      return;
    }

    const rows = this.preview ? PREVIEW_ROWS : this.computeRows();

    this.term = new Terminal({
      disableStdin: true,
      cursorBlink: false,
      cursorStyle: "block",
      cursorInactiveStyle: "none",
      cols: DEFAULT_COLS,
      rows,
      fontSize: 12,
      fontFamily: "'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
      lineHeight: 1.2,
      scrollback: this.preview ? 0 : DEFAULT_SCROLLBACK_LINES,
      convertEol: true,
      theme: {
        background: "#1e1e2e",
        foreground: "#cdd6f4",
        cursor: "#f5e0dc",
        selectionBackground: "#585b7066",
        black: "#45475a",
        red: "#f38ba8",
        green: "#a6e3a1",
        yellow: "#f9e2af",
        blue: "#89b4fa",
        magenta: "#f5c2e7",
        cyan: "#94e2d5",
        white: "#bac2de",
        brightBlack: "#585b70",
        brightRed: "#f38ba8",
        brightGreen: "#a6e3a1",
        brightYellow: "#f9e2af",
        brightBlue: "#89b4fa",
        brightMagenta: "#f5c2e7",
        brightCyan: "#94e2d5",
        brightWhite: "#a6adc8",
      },
    });

    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.open(container);

    // Don't write content here - let updated() handle it.
    // Writing here causes duplicate content because updated() will also trigger.
    // Just track that terminal is initialized.
    this._displayedContent = "";

    if (!this.preview) {
      // 非预览模式下尝试自适应容器宽度（只调整列数，不改行数）
      this.fitWidth();

      // 监听容器大小变化以自适应宽度
      this.resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          this.fitWidth();
        });
      });
      this.resizeObserver.observe(container);
    }
  }

  private computeRows(): number {
    if (!this.content) {
      return MIN_ROWS;
    }
    const lineCount = this.content.split("\n").length;
    return Math.max(MIN_ROWS, Math.min(lineCount + 2, DEFAULT_ROWS));
  }

  connectedCallback() {
    super.connectedCallback();
    // Register this instance with the registry if sessionId is provided
    if (this.sessionId) {
      registerTerminalViewer(this.sessionId, this);
    }
  }

  disconnectedCallback() {
    // Unregister this instance when disconnected
    unregisterTerminalViewer(this);

    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.term?.dispose();
    this.term = null;
    this.fitAddon = null;
    this._stopTypewriter();
  }

  render() {
    return html`<div class="terminal-container ${this.preview ? "preview" : ""}"></div>`;
  }

  /**
   * Start the typewriter animation effect for complete content.
   * Splits content into lines and reveals them one by one with delay.
   */
  private _startTypewriter() {
    if (!this.term) {
      return;
    }

    this._currentLineIndex = 0;
    this._targetLines = this.content.split("\n");

    // Start the animation loop
    this._scheduleTypewriterTick();
  }

  /**
   * Start typewriter animation for delta content only (appended lines).
   * Animates only the new lines while preserving existing content.
   */
  private _startTypewriterForDelta(delta: string) {
    if (!this.term) {
      return;
    }

    // Split delta into lines and animate each line
    const deltaLines = delta.split("\n");
    this._currentLineIndex = 0;
    this._targetLines = deltaLines;

    // Start the animation loop for delta lines
    this._scheduleTypewriterTick();
  }

  /**
   * Stop the typewriter animation and show all remaining content.
   */
  private _stopTypewriter() {
    if (this._typewriterTimer !== null) {
      clearTimeout(this._typewriterTimer);
      this._typewriterTimer = null;
    }
  }

  /**
   * Schedule the next typewriter tick.
   */
  private _scheduleTypewriterTick() {
    this._typewriterTimer = window.setTimeout(() => {
      this._typewriterTimer = null;
      this._typewriterTick();
    }, TYPEWRITER_LINE_INTERVAL_MS);
  }

  /**
   * One tick of the typewriter animation.
   * Reveals one complete line at a time with proper delay between lines.
   */
  private _typewriterTick() {
    if (!this.term || this._currentLineIndex >= this._targetLines.length) {
      // Animation complete - update displayed content tracking
      // For delta animations, we need to append to existing content
      this._displayedContent = this.content;
      return;
    }

    const currentLine = this._targetLines[this._currentLineIndex];

    // Write the entire line at once (no character-by-character animation)
    this.term.write(currentLine);

    // Move to next line
    this._currentLineIndex++;

    // Add newline and scroll if there are more lines
    if (this._currentLineIndex < this._targetLines.length) {
      this.term.write("\r\n");

      // Scroll to bottom after adding each line
      this._scrollToBottom();

      // Schedule next line with delay
      this._scheduleTypewriterTick();
    }
  }

  /**
   * Scroll terminal viewport to bottom.
   */
  private _scrollToBottom() {
    if (this.term) {
      // Force scroll to bottom
      this.term.scrollLines(9999);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "terminal-viewer": TerminalViewer;
  }
}
