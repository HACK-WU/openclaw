import { noChange } from "lit";
import { AsyncDirective } from "lit/async-directive.js";
import { directive, type ElementPart, type PartInfo, PartType } from "lit/directive.js";
import { renderMarkdownUncached } from "../markdown.ts";

/**
 * Characters to reveal per animation frame at 60fps.
 * At 60fps → ~720 chars/sec — fast enough to keep up with most LLM streaming output
 * while still providing a smooth, consistent typewriter feel.
 */
const CHARS_PER_FRAME = 12;

/**
 * When the unrevealed text exceeds this threshold,
 * increase reveal speed to prevent the display from falling too far behind.
 */
const CATCH_UP_THRESHOLD = 200;

/**
 * Multiplier applied to CHARS_PER_FRAME when catching up.
 */
const CATCH_UP_MULTIPLIER = 4;

/**
 * Minimum interval (ms) between expensive Markdown re-renders.
 * During the animation loop we use cheap plain-text rendering;
 * Markdown is only parsed on content changes or when the animation completes.
 */
const MD_RENDER_INTERVAL_MS = 300;

/**
 * Escape HTML special characters for safe rendering as plain text.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Convert plain text (up to `len` characters) into safe HTML with <br> for newlines.
 */
function toHtml(text: string, len: number): string {
  const slice = text.slice(0, len);
  return escapeHtml(slice).replace(/\r?\n/g, "<br>");
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  for (let i = 0; i < limit; i++) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) {
      return i;
    }
  }
  return limit;
}

class TypewriterDirective extends AsyncDirective {
  // The full target text to reveal
  private _target = "";
  // How many characters are currently visible
  private _revealed = 0;
  // The DOM element we're writing into
  private _element: Element | null = null;
  // Current animation frame handle
  private _raf: number | null = null;
  // Timestamp of last Markdown render (for throttling)
  private _lastMdRender = 0;

  constructor(partInfo: PartInfo) {
    super(partInfo);
    if (partInfo.type !== PartType.ELEMENT) {
      throw new Error("typewriter directive must be used as an element directive");
    }
  }

  override update(part: ElementPart, [text]: [string]) {
    this._element = part.element;
    const prevTarget = this._target;
    this._target = text;

    // Streaming updates usually append text. However, we can occasionally see
    // truncation or minor rewrites (e.g. model revisions or transport oddities).
    // To avoid jarring "restart from 0" behavior, clamp the revealed cursor to
    // the common prefix of the previous and current text.
    if (text.startsWith(prevTarget)) {
      // Normal case: appended text — keep reveal position.
    } else if (prevTarget.startsWith(text)) {
      // Truncation: keep what we can.
      this._revealed = Math.min(this._revealed, text.length);
    } else {
      // Rewrite: keep only the common prefix.
      const prefix = commonPrefixLength(prevTarget, text);
      this._revealed = Math.min(this._revealed, prefix);
    }

    // Ensure revealed cursor is always within bounds.
    this._revealed = Math.min(this._revealed, this._target.length);

    // Keep DOM in sync immediately (especially important for truncation/rewrites).
    this._flush();

    // Start the animation loop if not already running and there's text to reveal.
    if (this._raf === null && this._revealed < this._target.length && this.isConnected) {
      this._scheduleFrame();
    }

    // If we've already caught up, ensure no pending frame is left behind.
    if (this._revealed >= this._target.length && this._raf !== null) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }

    return noChange;
  }

  protected override disconnected() {
    if (this._raf !== null) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  }

  protected override reconnected() {
    if (this._raf === null && this._revealed < this._target.length) {
      this._scheduleFrame();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override render(_text: string) {
    return noChange;
  }

  private _scheduleFrame() {
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._tick();
    });
  }

  private _tick() {
    if (!this.isConnected || !this._element || this._revealed >= this._target.length) {
      return;
    }

    const remaining = this._target.length - this._revealed;
    const speed =
      remaining > CATCH_UP_THRESHOLD ? CHARS_PER_FRAME * CATCH_UP_MULTIPLIER : CHARS_PER_FRAME;

    this._revealed = Math.min(this._revealed + speed, this._target.length);
    this._flush();

    // Continue if there's more to reveal
    if (this._revealed < this._target.length) {
      this._scheduleFrame();
    }
  }

  /**
   * Render the current revealed text cheaply (plain text → HTML).
   * Used during the per-frame animation loop where Markdown parsing
   * would be prohibitively expensive at 60fps.
   */
  private _flushCheap() {
    if (this._element) {
      (this._element as HTMLElement).innerHTML = toHtml(this._target, this._revealed);
    }
  }

  /**
   * Render the current revealed text with full Markdown parsing.
   * Only called on content changes, throttled during streaming,
   * and when the typewriter animation finishes.
   */
  private _flushMarkdown() {
    if (this._element) {
      const slice = this._target.slice(0, this._revealed);
      const isStreaming = this._revealed < this._target.length;
      (this._element as HTMLElement).innerHTML = renderMarkdownUncached(slice, isStreaming);
      this._lastMdRender = performance.now();
    }
  }

  private _flush() {
    if (!this._element) return;

    const now = performance.now();
    const isAnimating = this._revealed < this._target.length;

    if (!isAnimating) {
      // Animation complete: render with Markdown for final display
      this._flushMarkdown();
    } else if (now - this._lastMdRender >= MD_RENDER_INTERVAL_MS) {
      // Throttled Markdown render during streaming
      this._flushMarkdown();
    } else {
      // Cheap plain-text render during animation frames
      this._flushCheap();
    }
  }
}

/**
 * A Lit directive that reveals text character-by-character at a constant rate,
 * creating a smooth typewriter effect for streaming chat output.
 *
 * Usage (element binding):
 * ```ts
 * html`<div ${typewriter(text)}></div>`
 * ```
 *
 * The directive directly manipulates the element's innerHTML for performance,
 * bypassing Lit's diffing for the streaming text content.
 */
export const typewriter = directive(TypewriterDirective);
