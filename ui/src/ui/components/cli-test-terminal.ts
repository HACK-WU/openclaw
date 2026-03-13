/**
 * CLI Test Terminal Component — xterm.js terminal for CLI Agent test dialog.
 *
 * Renders live CLI TUI output in a dialog using xterm.js for full ANSI support.
 */
import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";

// xterm.css raw content — dynamically loaded and injected into Shadow DOM
// so xterm renders correctly. Without this, the hidden textarea helper, viewport,
// and screen elements are unstyled and appear as visible white boxes / garbled text.
let xtermCssText: string | null = null;

// ─── Terminal Interface ───

interface ITerminalLike {
  write(data: string | Uint8Array): void;
  clear(): void;
  dispose(): void;
  cols: number;
  rows: number;
}

/**
 * Plain-text fallback terminal when xterm.js is not available.
 * Accumulates raw text output (with ANSI stripped).
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

  getContent(): string {
    return this.buffer.join("");
  }
}

// ─── Component ───

@customElement("cli-test-terminal")
export class CliTestTerminal extends LitElement {
  /** Terminal data buffer (array of base64 strings) */
  @property({ type: Array }) data: string[] = [];

  /** Whether terminal is active/visible */
  @property({ type: Boolean }) active = true;

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

  /** Plain text fallback instance */
  private _plainTextTerminal: PlainTextTerminal | null = null;

  /** Track how many items from `data` have already been written to the terminal. */
  private _lastWrittenIndex = 0;

  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    .cli-test-terminal-wrapper {
      width: 100%;
      height: 100%;
      background: #1e1e2e;
      border-radius: var(--radius-md, 6px);
      overflow: auto;
    }

    .terminal-container {
      width: 100%;
      min-width: fit-content;
      height: 100%;
      padding: 8px;
      box-sizing: border-box;
    }

    /* Fallback plain-text display */
    .terminal-plaintext {
      margin: 0;
      padding: 8px;
      color: #cdd6f4;
      background: #1e1e2e;
      font-family: "Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace;
      font-size: 12px;
      line-height: 1.3;
      white-space: pre-wrap;
      overflow-x: auto;
      overflow-y: auto;
      height: 100%;
      box-sizing: border-box;
      tab-size: 8;
      word-break: break-all;
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
    void this._initTerminal();
  }

  disconnectedCallback() {
    this._disposeTerminal();
    super.disconnectedCallback();
  }

  updated(changedProperties: Map<string, unknown>): void {
    super.updated(changedProperties);
    if (changedProperties.has("data")) {
      this._writeNewData();
    }
  }

  // ─── Public API ───

  /**
   * Clear terminal content and reset write index.
   */
  clearTerminal(): void {
    this._terminal?.clear();
    this._plainTextTerminal?.clear();
    this._lastWrittenIndex = 0;
  }

  // ─── Private Methods ───

  private async _initTerminal(): Promise<void> {
    try {
      // Dynamically load xterm.js
      const xtermModule = await import("@xterm/xterm");
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
          fontSize: 13,
          cols: 120, // Match backend DEFAULT_PTY_COLS for correct rendering
          fontFamily:
            '"FiraCode Nerd Font", "Hack Nerd Font", "JetBrainsMono Nerd Font", "Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace',
          theme: {
            background: "#1e1e2e",
            foreground: "#cdd6f4",
            cursor: "#f5e0dc",
            selectionBackground: "#585b70",
            selectionForeground: "#cdd6f4",
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
          convertEol: true,
          allowProposedApi: true,
        });

        this._fitAddon = new FitAddon();
        terminal.loadAddon(this._fitAddon);
        terminal.open(this._terminalContainer);

        // Create wrapper
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
        };

        this._terminal = terminalWrapper;

        // Write any data that arrived before xterm loaded
        this._writeNewData();

        // Fit terminal rows to container height; keep wide cols for horizontal scroll
        setTimeout(() => {
          try {
            if (this._fitAddon) {
              const dims = this._fitAddon.proposeDimensions();
              if (dims) {
                // Only resize rows to fit container height; keep cols at least 120 (matching backend PTY)
                const cols = Math.max(dims.cols, 120);
                terminal.resize(cols, dims.rows);
              }
            }
          } catch {
            // Container may not be visible yet
          }
        }, 100);
      }
    } catch (err) {
      // xterm.js not available — fall back to plain text mode
      console.warn(
        "[cli-test-terminal] @xterm/xterm not available, using plain-text fallback.",
        err,
      );
      this._xtermLoaded = false;

      if (!this._plainTextTerminal) {
        this._plainTextTerminal = new PlainTextTerminal();
      }
      this._terminal = this._plainTextTerminal;
    }
  }

  /**
   * Write only NEW data items (since _lastWrittenIndex) to the terminal.
   * This prevents duplicate writes when the `data` array grows incrementally.
   */
  private _writeNewData(): void {
    if (!this._terminal) {
      return;
    }

    // If data was reset (e.g. dialog reopened), reset our index too
    if (this.data.length < this._lastWrittenIndex) {
      this._lastWrittenIndex = 0;
    }

    // Write only items we haven't written yet
    for (let i = this._lastWrittenIndex; i < this.data.length; i++) {
      try {
        const binary = atob(this.data[i]);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        this._terminal.write(bytes);
      } catch {
        // Ignore decode errors
      }
    }

    this._lastWrittenIndex = this.data.length;
  }

  private _disposeTerminal(): void {
    this._terminal?.dispose();
    this._terminal = null;
    this._plainTextTerminal = null;
    this._fitAddon = null;
    this._TerminalClass = null;
  }

  // ─── Render ───

  render() {
    return html`
      <div class="cli-test-terminal-wrapper">
        ${
          this._xtermLoaded
            ? html`
                <div class="terminal-container"></div>
              `
            : html`<pre class="terminal-plaintext">${this._plainTextTerminal?.getContent() ?? ""}</pre>`
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cli-test-terminal": CliTestTerminal;
  }
}
