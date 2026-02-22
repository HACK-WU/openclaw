/**
 * Terminal viewer component — renders pre-rendered terminal output as plain text.
 *
 * Content is pre-rendered by the backend @xterm/headless engine, so the frontend
 * only needs to display the plain text screen snapshot in a <pre> element.
 * Each content update is treated as a full screen snapshot that replaces
 * the previous content entirely.
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

@customElement("terminal-viewer")
export class TerminalViewer extends LitElement {
  /** Pre-rendered terminal output (plain text from backend @xterm/headless) */
  @property({ type: String }) content = "";

  /** Preview mode: limited height with gradient fade, used in tool card inline preview */
  @property({ type: Boolean }) preview = false;

  /** Live mode: streaming PTY output, auto-scrolls to bottom */
  @property({ type: Boolean }) live = false;

  /** Session ID for singleton pattern - ensures one terminal per session */
  @property({ type: String }) sessionId?: string;

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

    pre {
      margin: 0;
      padding: 8px;
      color: #cdd6f4;
      background: #1e1e2e;
      font-family: "Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace;
      font-size: 12px;
      line-height: 1.2;
      white-space: pre;
      overflow-x: auto;
      overflow-y: auto;
      max-height: 450px;
      tab-size: 8;
    }

    .preview pre {
      overflow: hidden;
      max-height: none;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    if (this.sessionId) {
      registerTerminalViewer(this.sessionId, this);
    }
  }

  disconnectedCallback() {
    unregisterTerminalViewer(this);
    super.disconnectedCallback();
  }

  protected updated(changed: Map<string, unknown>) {
    if (changed.has("content") && !this.preview) {
      const pre = this.renderRoot.querySelector("pre");
      if (pre) {
        // Smart scroll: only auto-scroll if user is already at the bottom
        const isAtBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 30;
        if (isAtBottom) {
          requestAnimationFrame(() => {
            pre.scrollTop = pre.scrollHeight;
          });
        }
      }
    }
  }

  render() {
    return html`<div class="terminal-container ${this.preview ? "preview" : ""}">
      <pre>${this.content}</pre>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "terminal-viewer": TerminalViewer;
  }
}
