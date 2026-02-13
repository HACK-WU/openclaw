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

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
const MIN_ROWS = 4;
const PREVIEW_ROWS = 6;

@customElement("terminal-viewer")
export class TerminalViewer extends LitElement {
  /** PTY 原始输出内容（包含 ANSI 转义序列） */
  @property({ type: String }) content = "";

  /** 是否为预览模式（限制高度，用于 tool card 内联预览） */
  @property({ type: Boolean }) preview = false;

  /** 是否为实时模式（增量写入，用于流式 PTY 输出） */
  @property({ type: Boolean }) live = false;

  private term: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private resizeObserver: ResizeObserver | null = null;
  /** Track how many characters have been written (for incremental mode) */
  private _writtenLength = 0;
  /** Track the last content for detecting truncation/replacement */
  private _lastContent = "";

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
      if (
        this.live &&
        this.content.length > this._writtenLength &&
        this.content.startsWith(this._lastContent)
      ) {
        // Live mode: new content is an append of old content, write only the delta
        const delta = this.content.slice(this._writtenLength);
        if (delta) {
          this.term.write(delta);
        }
      } else {
        // Full mode: content was truncated/replaced/first write
        this.term.reset();
        if (this.content) {
          this.term.write(this.content);
        }
      }
      this._writtenLength = this.content.length;
      this._lastContent = this.content;
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
      scrollback: this.preview ? 0 : 5000,
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

    if (this.content) {
      this.term.write(this.content);
    }

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

  disconnectedCallback() {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.term?.dispose();
    this.term = null;
    this.fitAddon = null;
  }

  render() {
    return html`<div class="terminal-container ${this.preview ? "preview" : ""}"></div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "terminal-viewer": TerminalViewer;
  }
}
