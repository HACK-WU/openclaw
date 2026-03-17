import { noChange } from "lit";
import { AsyncDirective } from "lit/async-directive.js";
import { directive, type ElementPart, type PartInfo, PartType } from "lit/directive.js";
import { renderMarkdownUncached } from "../markdown.ts";

/**
 * Reveal mode for the typewriter effect.
 * - "char": reveal character-by-character (default, for LLM streaming text)
 * - "line": reveal line-by-line (for terminal/CLI output)
 */
export type TypewriterMode = "char" | "line";

/**
 * Minimum interval between character reveals (ms).
 * Lower = faster typing, Higher = slower more visible typing.
 * 16ms ≈ 60 chars/sec (smooth but visible, matches 60fps)
 */
const TYPEWRITER_INTERVAL_MS = 16;

/**
 * Characters to reveal per tick (char mode).
 * Keep at 1 for most natural, visible character-by-character effect.
 * Can increase to 2-3 for slightly faster but still smooth animation.
 * Increased to 2 to reduce animation time while maintaining visual effect.
 */
const CHARS_PER_TICK = 2;

/**
 * When the unrevealed text exceeds this threshold,
 * increase reveal speed to prevent falling too far behind LLM streaming.
 * Lowered to catch up sooner when text is streaming quickly.
 */
const CATCH_UP_THRESHOLD = 50;

/**
 * Multiplier applied to CHARS_PER_TICK when catching up.
 * Increased to catch up faster when falling behind streaming text.
 */
const CATCH_UP_MULTIPLIER = 4;

/**
 * Minimum interval (ms) between Markdown re-renders during animation.
 * Always use Markdown rendering (no cheap plain-text mode) to avoid
 * the visual flicker caused by switching between plain-text and Markdown
 * DOM structures. Throttle to keep rendering cost manageable.
 */
const MD_RENDER_INTERVAL_MS = 80;

/**
 * Interval between line reveals in "line" mode (ms).
 * Slightly slower than char mode to create a visible "line-by-line" feel.
 */
const LINE_REVEAL_INTERVAL_MS = 60;

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
  // Current timer handle (requestAnimationFrame)
  private _timer: number | null = null;
  // Timestamp of last Markdown render (for throttling)
  private _lastMdRender = 0;
  // Last rendered HTML string to avoid redundant DOM updates
  private _lastRenderedHtml = "";
  // Reveal mode: "char" (character-by-character) or "line" (line-by-line)
  private _mode: TypewriterMode = "char";

  constructor(partInfo: PartInfo) {
    super(partInfo);
    if (partInfo.type !== PartType.ELEMENT) {
      throw new Error("typewriter directive must be used as an element directive");
    }
  }

  override update(part: ElementPart, [text, mode]: [string, TypewriterMode?]) {
    this._element = part.element;
    const prevTarget = this._target;
    this._target = text;
    this._mode = mode ?? "char";

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
    this._flush(true);

    // Start the animation loop if not already running and there's text to reveal.
    if (this._timer === null && this._revealed < this._target.length && this.isConnected) {
      this._scheduleTick();
    }

    // If we've already caught up, ensure no pending timer is left behind.
    if (this._revealed >= this._target.length && this._timer !== null) {
      this._cancelTick();
    }

    return noChange;
  }

  protected override disconnected() {
    this._cancelTick();
  }

  protected override reconnected() {
    if (this._timer === null && this._revealed < this._target.length) {
      this._scheduleTick();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  override render(_text: string, _mode?: TypewriterMode) {
    return noChange;
  }

  private _scheduleTick() {
    const interval = this._mode === "line" ? LINE_REVEAL_INTERVAL_MS : TYPEWRITER_INTERVAL_MS;
    // Use setTimeout for consistent interval timing, then align DOM
    // writes with the next animation frame to avoid mid-frame flicker.
    this._timer = window.setTimeout(() => {
      this._timer = null;
      this._tick();
    }, interval);
  }

  private _cancelTick() {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private _tick() {
    if (!this.isConnected || !this._element || this._revealed >= this._target.length) {
      return;
    }

    if (this._mode === "line") {
      // Line-by-line mode: reveal up to the end of the next line.
      const nextNewline = this._target.indexOf("\n", this._revealed);
      if (nextNewline !== -1) {
        // Reveal up to and including the newline
        this._revealed = nextNewline + 1;
      } else {
        // No more newlines — reveal everything remaining
        this._revealed = this._target.length;
      }
    } else {
      // Character-by-character mode (original behavior)
      const remaining = this._target.length - this._revealed;
      const speed =
        remaining > CATCH_UP_THRESHOLD ? CHARS_PER_TICK * CATCH_UP_MULTIPLIER : CHARS_PER_TICK;
      this._revealed = Math.min(this._revealed + speed, this._target.length);
    }

    this._flush(false);

    // Continue if there's more to reveal
    if (this._revealed < this._target.length) {
      this._scheduleTick();
    }
  }

  /**
   * Render the current revealed text with Markdown.
   * Always uses Markdown rendering to avoid flicker from switching between
   * plain-text and Markdown DOM structures. Throttled during animation
   * to keep rendering cost manageable (~12fps Markdown updates).
   *
   * @param force - If true, always render (used for content changes / final render).
   */
  private _flush(force: boolean) {
    if (!this._element) {
      return;
    }

    const now = performance.now();
    const isAnimating = this._revealed < this._target.length;

    // Always render when animation completes, on forced updates,
    // or when enough time has passed since the last render.
    if (!force && isAnimating && now - this._lastMdRender < MD_RENDER_INTERVAL_MS) {
      return;
    }

    const slice = this._target.slice(0, this._revealed);
    const html = renderMarkdownUncached(slice, isAnimating);

    // Skip DOM update if the rendered HTML hasn't changed
    if (html === this._lastRenderedHtml) {
      return;
    }

    this._lastRenderedHtml = html;
    (this._element as HTMLElement).innerHTML = html;
    this._lastMdRender = now;
  }
}

/**
 * A Lit directive that reveals text with a typewriter effect for streaming
 * chat output.
 *
 * Supports two modes:
 * - `"char"` (default): character-by-character reveal for LLM streaming text
 * - `"line"`: line-by-line reveal for terminal/CLI output
 *
 * Usage (element binding):
 * ```ts
 * html`<div ${typewriter(text)}></div>`             // char mode (default)
 * html`<div ${typewriter(text, "line")}></div>`     // line mode
 * ```
 *
 * The directive directly manipulates the element's innerHTML for performance,
 * bypassing Lit's diffing for the streaming text content.
 */
export const typewriter = directive(TypewriterDirective);
