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
  let rafSpy: ReturnType<typeof vi.fn>;
  let cafSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    host = createHost();

    // Make requestAnimationFrame deterministic under fake timers.
    rafSpy = vi.fn((cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 16));
    cafSpy = vi.fn((id: number) => window.clearTimeout(id));

    vi.stubGlobal("requestAnimationFrame", rafSpy);
    vi.stubGlobal("cancelAnimationFrame", cafSpy);
  });

  afterEach(() => {
    render(nothingTemplate(), host);
    host.remove();

    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reveals content over multiple frames (not all at once)", () => {
    const text = "abcdefghijklmnopqrstuvwxyz"; // long enough to require multiple frames

    render(html`<div class="chat-text-streaming" ${typewriter(text)}></div>`, host);

    const el = host.querySelector(".chat-text-streaming") as HTMLDivElement;
    expect(el).toBeTruthy();

    const before = el.innerHTML;
    expect(before).toBe("");

    vi.advanceTimersByTime(16);
    const after1 = el.innerHTML;
    expect(after1.length).toBeGreaterThan(0);
    expect(after1.length).toBeLessThan(text.length);

    vi.advanceTimersByTime(16);
    const after2 = el.innerHTML;
    expect(after2.length).toBeGreaterThan(after1.length);
    expect(after2.length).toBeLessThanOrEqual(text.length);

    // Run enough frames to finish.
    vi.advanceTimersByTime(16 * 20);
    expect(el.innerHTML).toBe(text);
  });

  it("does not restart from 0 when the stream truncates to a shorter prefix", () => {
    const base = "abcdefghijklmnopqrstuvwxyz";
    render(html`<div class="chat-text-streaming" ${typewriter(base)}></div>`, host);

    // Reveal a few frames.
    vi.advanceTimersByTime(16 * 2);

    const elBefore = host.querySelector(".chat-text-streaming") as HTMLDivElement;
    const revealedBefore = elBefore.innerHTML;
    expect(revealedBefore.length).toBeGreaterThan(0);

    // Truncate to a shorter prefix.
    const truncated = base.slice(0, 10);
    render(html`<div class="chat-text-streaming" ${typewriter(truncated)}></div>`, host);

    const elAfter = host.querySelector(".chat-text-streaming") as HTMLDivElement;

    // If the same DOM node is preserved, the directive should clamp+flush synchronously.
    // If Lit decides to replace the node, the first frame will populate content.
    if (elAfter === elBefore) {
      expect(elAfter.innerHTML.length).toBeGreaterThan(0);
    } else {
      vi.advanceTimersByTime(16);
      expect(elAfter.innerHTML.length).toBeGreaterThan(0);
    }

    expect(elAfter.innerHTML.length).toBeLessThanOrEqual(truncated.length);
    expect(truncated.startsWith(elAfter.innerHTML)).toBe(true);
  });

  it("cancels pending animation when disconnected", () => {
    const text = "abcdefghijklmnopqrstuvwxyz";
    render(html`<div class="chat-text-streaming" ${typewriter(text)}></div>`, host);

    // A frame should be scheduled.
    expect(rafSpy).toHaveBeenCalled();

    // Remove the element entirely to trigger directive disconnection.
    render(html``, host);

    expect(cafSpy).toHaveBeenCalled();

    // Advancing timers should not schedule more RAF.
    const rafCallsBefore = rafSpy.mock.calls.length;
    vi.advanceTimersByTime(16 * 10);
    expect(rafSpy.mock.calls.length).toBe(rafCallsBefore);
  });
});

function nothingTemplate() {
  return html``;
}
