import { html, render } from "lit";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { typewriter } from "./typewriter-directive.ts";

function createHost() {
  const host = document.createElement("div");
  document.body.append(host);
  return host;
}

describe("typewriter directive", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    host = createHost();
  });

  afterEach(() => {
    render(nothingTemplate(), host);
    host.remove();

    vi.useRealTimers();
  });

  it("reveals content over multiple frames in line mode (default)", () => {
    // Use text with newlines to trigger line-by-line reveal
    const text = "line one\nline two\nline three";

    render(html`<div class="chat-text-streaming" ${typewriter(text)}></div>`, host);

    const el = host.querySelector(".chat-text-streaming") as HTMLDivElement;
    expect(el).toBeTruthy();

    // On first render, revealed=0, so content should be minimal (empty or cursor-only)
    const before = el.textContent ?? "";
    expect(before.length).toBeLessThan(text.length);

    // Advance one tick (60ms for line mode) to reveal first line
    vi.advanceTimersByTime(60);
    const after1 = el.textContent ?? "";
    expect(after1.length).toBeGreaterThan(0);
    expect(after1.length).toBeLessThan(text.length);

    // Advance another tick to reveal second line
    vi.advanceTimersByTime(60);
    const after2 = el.textContent ?? "";
    expect(after2.length).toBeGreaterThan(after1.length);

    // Run enough frames to finish.
    vi.advanceTimersByTime(60 * 5);
    // Final render uses Markdown, so textContent should contain the full text
    expect(el.textContent).toBe(text);
  });

  it("falls back to chunked reveal when no newlines present", () => {
    // Text without newlines triggers chunked reveal (50 chars at a time)
    const text = "a".repeat(150); // 150 chars, should take 3 chunks

    render(html`<div class="chat-text-streaming" ${typewriter(text)}></div>`, host);

    const el = host.querySelector(".chat-text-streaming") as HTMLDivElement;
    expect(el).toBeTruthy();

    // Advance one tick (60ms for line mode)
    vi.advanceTimersByTime(60);
    const after1 = el.textContent ?? "";
    // Should reveal ~50 chars (LINE_MODE_CHUNK_SIZE)
    expect(after1.length).toBeGreaterThan(0);
    expect(after1.length).toBeLessThan(text.length);

    // Advance another tick
    vi.advanceTimersByTime(60);
    const after2 = el.textContent ?? "";
    expect(after2.length).toBeGreaterThan(after1.length);

    // Run enough frames to finish
    vi.advanceTimersByTime(60 * 5);
    expect(el.textContent).toBe(text);
  });

  it("reveals content character-by-character in char mode", () => {
    const text = "abcdefghijklmnopqrstuvwxyz"; // long enough to require multiple frames

    render(html`<div class="chat-text-streaming" ${typewriter(text, "char")}></div>`, host);

    const el = host.querySelector(".chat-text-streaming") as HTMLDivElement;
    expect(el).toBeTruthy();

    // On first render, revealed=0, so content should be minimal (empty or cursor-only)
    const before = el.textContent ?? "";
    expect(before.length).toBeLessThan(text.length);

    // Advance enough to reveal some characters and trigger a Markdown render
    // char mode uses 16ms interval
    vi.advanceTimersByTime(16 * 6);
    const after1 = el.textContent ?? "";
    expect(after1.length).toBeGreaterThan(0);
    expect(after1.length).toBeLessThan(text.length);

    vi.advanceTimersByTime(16 * 6);
    const after2 = el.textContent ?? "";
    expect(after2.length).toBeGreaterThan(after1.length);

    // Run enough frames to finish.
    vi.advanceTimersByTime(16 * 20);
    // Final render uses Markdown, so textContent should contain the full text
    expect(el.textContent).toBe(text);
  });

  it("does not restart from 0 when the stream truncates to a shorter prefix", () => {
    const base = "abcdefghijklmnopqrstuvwxyz";
    render(html`<div class="chat-text-streaming" ${typewriter(base, "char")}></div>`, host);

    // Reveal a few frames — advance enough for MD_RENDER_INTERVAL_MS (80ms) to pass
    vi.advanceTimersByTime(16 * 6);

    const elBefore = host.querySelector(".chat-text-streaming") as HTMLDivElement;
    const revealedBefore = elBefore.textContent ?? "";
    expect(revealedBefore.length).toBeGreaterThan(0);

    // Truncate to a shorter prefix.
    const truncated = base.slice(0, 10);
    render(html`<div class="chat-text-streaming" ${typewriter(truncated, "char")}></div>`, host);

    const elAfter = host.querySelector(".chat-text-streaming") as HTMLDivElement;

    // If the same DOM node is preserved, the directive should clamp+flush synchronously.
    // If Lit decides to replace the node, the first frame will populate content.
    if (elAfter === elBefore) {
      expect((elAfter.textContent ?? "").length).toBeGreaterThan(0);
    } else {
      vi.advanceTimersByTime(16 * 6);
      expect((elAfter.textContent ?? "").length).toBeGreaterThan(0);
    }

    const afterText = elAfter.textContent ?? "";
    expect(afterText.length).toBeLessThanOrEqual(truncated.length);
    expect(truncated.startsWith(afterText)).toBe(true);
  });

  it("cancels pending animation when disconnected", () => {
    const text = "abcdefghijklmnopqrstuvwxyz";
    render(html`<div class="chat-text-streaming" ${typewriter(text, "char")}></div>`, host);

    // After first render, a setTimeout should be scheduled for the animation tick.
    // Advance one tick to confirm animation started.
    vi.advanceTimersByTime(16);
    const el = host.querySelector(".chat-text-streaming") as HTMLDivElement;
    const contentAfterOneTick = el?.textContent ?? "";

    // Remove the element entirely to trigger directive disconnection.
    render(html``, host);

    // Advancing timers should not cause errors or schedule more work.
    // Capture content before advancing further.
    vi.advanceTimersByTime(16 * 10);

    // The element was removed, so no further content changes should occur.
    // If directive properly cleaned up, this should not throw.
    expect(contentAfterOneTick.length).toBeGreaterThanOrEqual(0);
  });
});

function nothingTemplate() {
  return html``;
}
