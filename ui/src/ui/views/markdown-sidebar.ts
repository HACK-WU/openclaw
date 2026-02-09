import { html } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { PTY_SIDEBAR_PREFIX } from "../chat/tool-cards.ts";
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

export function renderMarkdownSidebar(props: MarkdownSidebarProps) {
  const isPty = isPtyContent(props.content);
  const title = isPty ? "Terminal Output" : "Tool Output";

  return html`
    <div class="sidebar-panel">
      <div class="sidebar-header">
        <div class="sidebar-title">${title}</div>
        <button @click=${props.onClose} class="btn" title="Close sidebar">
          ${icons.x}
        </button>
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
