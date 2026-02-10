import { html } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { PTY_SIDEBAR_PREFIX } from "../chat/tool-cards.ts";
import { stripAnsiEscapes } from "../chat/tool-helpers.ts";
import { icons } from "../icons.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";
import "../components/terminal-viewer.ts";

export type MarkdownSidebarProps = {
  content: string | null;
  error: string | null;
  onClose: () => void;
  onViewRawText: () => void;
};

/**
 * PTY 输出特殊前缀标记：用于在 sidebarContent 中区分终端输出与 Markdown 文本。
 * 阶段 1 先用字符串协议实现，后续可演进为结构化类型。
 */

function isPtyContent(content: string | null): boolean {
  return content != null && content.startsWith(PTY_SIDEBAR_PREFIX);
}

function extractPtyContent(content: string): string {
  return content.slice(PTY_SIDEBAR_PREFIX.length);
}

const COPIED_FOR_MS = 1500;
const ERROR_FOR_MS = 2000;

async function handleCopyTerminalOutput(e: Event, content: string) {
  const btn = e.currentTarget as HTMLButtonElement | null;
  if (!btn || btn.dataset.copying === "1") return;

  btn.dataset.copying = "1";
  btn.disabled = true;

  let ok = false;
  try {
    await navigator.clipboard.writeText(stripAnsiEscapes(content));
    ok = true;
  } catch {
    // clipboard write failed
  }

  if (!btn.isConnected) return;
  delete btn.dataset.copying;
  btn.disabled = false;

  if (ok) {
    delete btn.dataset.error;
    btn.dataset.copied = "1";
    btn.title = "Copied";
    btn.setAttribute("aria-label", "Copied");
    window.setTimeout(() => {
      if (!btn.isConnected) return;
      delete btn.dataset.copied;
      btn.title = "Copy terminal output";
      btn.setAttribute("aria-label", "Copy terminal output");
    }, COPIED_FOR_MS);
  } else {
    delete btn.dataset.copied;
    btn.dataset.error = "1";
    btn.title = "Copy failed";
    btn.setAttribute("aria-label", "Copy failed");
    window.setTimeout(() => {
      if (!btn.isConnected) return;
      delete btn.dataset.error;
      btn.title = "Copy terminal output";
      btn.setAttribute("aria-label", "Copy terminal output");
    }, ERROR_FOR_MS);
  }
}

export function renderMarkdownSidebar(props: MarkdownSidebarProps) {
  const isPty = isPtyContent(props.content);
  const title = isPty ? "Terminal Output" : "Tool Output";
  const ptyRaw = isPty && props.content ? extractPtyContent(props.content) : "";

  return html`
    <div class="sidebar-panel">
      <div class="sidebar-header">
        <div class="sidebar-title">${title}</div>
        <div class="sidebar-header-actions">
          ${
            isPty
              ? html`              <button
                class="sidebar-copy-btn"
                type="button"
                title="Copy terminal output"
                aria-label="Copy terminal output"
                @click=${(e: Event) => handleCopyTerminalOutput(e, ptyRaw)}
              >
                <span class="sidebar-copy-btn__icon" aria-hidden="true">
                  <span class="sidebar-copy-btn__icon-copy">${icons.copy}</span>
                  <span class="sidebar-copy-btn__icon-check">${icons.check}</span>
                </span>
              </button>`
              : ""
          }
          <button @click=${props.onClose} class="btn" title="Close sidebar">
            ${icons.x}
          </button>
        </div>
      </div>
      <div class="sidebar-content">
        ${
          props.error
            ? html`
              <div class="callout danger">${props.error}</div>
              <button @click=${props.onViewRawText} class="btn" style="margin-top: 12px;">
                View Raw Text
              </button>
            `
            : isPty && props.content
              ? html`<terminal-viewer .content=${extractPtyContent(props.content)}></terminal-viewer>`
              : props.content
                ? html`<div class="sidebar-markdown">${unsafeHTML(toSanitizedMarkdownHtml(props.content))}</div>`
                : html`
                    <div class="muted">No content available</div>
                  `
        }
      </div>
    </div>
  `;
}
