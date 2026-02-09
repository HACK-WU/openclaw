import { html, nothing } from "lit";
import type { ToolCard } from "../types/chat-types.ts";
import { icons } from "../icons.ts";
import { formatToolDetail, resolveToolDisplay } from "../tool-display.ts";
import { TOOL_INLINE_THRESHOLD } from "./constants.ts";
import { extractTextCached } from "./message-extract.ts";
import { isToolResultMessage } from "./message-normalizer.ts";
import {
  formatToolOutputForSidebar,
  getTruncatedPreview,
  isTerminalLikeOutput,
  stripAnsiEscapes,
} from "./tool-helpers.ts";
import "../components/terminal-viewer.ts";

/**
 * PTY 输出特殊前缀标记，用于在 sidebarContent 中标识终端输出。
 * 侧边栏渲染时检测此前缀来决定使用终端模拟器还是 Markdown 渲染。
 */
export const PTY_SIDEBAR_PREFIX = "__PTY_OUTPUT__";

/**
 * 检测工具调用参数中是否包含 pty=true 标记。
 */
function isPtyFromArgs(args: unknown): boolean {
  if (!args || typeof args !== "object") {
    return false;
  }
  return (args as Record<string, unknown>).pty === true;
}

export function extractToolCards(message: unknown): ToolCard[] {
  const m = message as Record<string, unknown>;
  const content = normalizeContent(m.content);
  const cards: ToolCard[] = [];

  // 收集所有 tool call 卡片，同时记录是否有 pty 标记
  let hasPtyCall = false;
  for (const item of content) {
    const kind = (typeof item.type === "string" ? item.type : "").toLowerCase();
    const isToolCall =
      ["toolcall", "tool_call", "tooluse", "tool_use"].includes(kind) ||
      (typeof item.name === "string" && item.arguments != null);
    if (isToolCall) {
      const args = coerceArgs(item.arguments ?? item.args);
      const isPty = isPtyFromArgs(args);
      if (isPty) {
        hasPtyCall = true;
      }
      cards.push({
        kind: "call",
        name: (item.name as string) ?? "tool",
        args,
        isPty,
      });
    }
  }

  // 收集 tool result 卡片，并将 pty 标记从 call 传递给 result
  for (const item of content) {
    const kind = (typeof item.type === "string" ? item.type : "").toLowerCase();
    if (kind !== "toolresult" && kind !== "tool_result") {
      continue;
    }
    const text = extractToolText(item);
    const name = typeof item.name === "string" ? item.name : "tool";
    // isPty: 优先从 call 卡片继承，否则启发式检测“终端控制码样式”的输出
    const isPty = hasPtyCall || (text ? isTerminalLikeOutput(text) : false);
    cards.push({ kind: "result", name, text, isPty });
  }

  if (isToolResultMessage(message) && !cards.some((card) => card.kind === "result")) {
    const name =
      (typeof m.toolName === "string" && m.toolName) ||
      (typeof m.tool_name === "string" && m.tool_name) ||
      "tool";
    const text = extractTextCached(message) ?? undefined;
    // 对于独立的 tool result 消息，通过启发式检测“终端控制码样式”的输出来判断
    const isPty = hasPtyCall || (text ? isTerminalLikeOutput(text) : false);
    cards.push({ kind: "result", name, text, isPty });
  }

  return cards;
}

export function renderToolCardSidebar(card: ToolCard, onOpenSidebar?: (content: string) => void) {
  const display = resolveToolDisplay({ name: card.name, args: card.args });
  const detail = formatToolDetail(display);
  const hasText = Boolean(card.text?.trim());
  const isPty = Boolean(card.isPty);

  const canClick = Boolean(onOpenSidebar);
  const handleClick = canClick
    ? () => {
        if (hasText) {
          if (isPty) {
            // PTY 输出：使用特殊前缀标记，侧边栏将使用终端模拟器渲染
            onOpenSidebar!(PTY_SIDEBAR_PREFIX + card.text!);
          } else {
            onOpenSidebar!(formatToolOutputForSidebar(card.text!));
          }
          return;
        }
        const info = `## ${display.label}\n\n${
          detail ? `**Command:** \`${detail}\`\n\n` : ""
        }*No output — tool completed successfully.*`;
        onOpenSidebar!(info);
      }
    : undefined;

  const isShort = hasText && (card.text?.length ?? 0) <= TOOL_INLINE_THRESHOLD;
  const showCollapsed = hasText && !isShort;
  const showInline = hasText && isShort;
  const isEmpty = !hasText;

  const previewContent =
    isPty && hasText
      ? html`<terminal-viewer .content=${card.text!} ?preview=${true}></terminal-viewer>`
      : nothing;

  const regularPreview =
    !isPty && showCollapsed
      ? html`<div class="chat-tool-card__preview mono">${getTruncatedPreview(card.text!)}</div>`
      : isPty && showCollapsed
        ? html`<div class="chat-tool-card__preview mono">${getTruncatedPreview(stripAnsiEscapes(card.text!))}</div>`
        : nothing;

  const inlineContent =
    !isPty && showInline
      ? html`<div class="chat-tool-card__inline mono">${card.text}</div>`
      : isPty && isShort
        ? html`<div class="chat-tool-card__inline mono">${stripAnsiEscapes(card.text!)}</div>`
        : nothing;

  return html`
    <div
      class="chat-tool-card ${canClick ? "chat-tool-card--clickable" : ""}"
      @click=${handleClick}
      role=${canClick ? "button" : nothing}
      tabindex=${canClick ? "0" : nothing}
      @keydown=${
        canClick
          ? (e: KeyboardEvent) => {
              if (e.key !== "Enter" && e.key !== " ") {
                return;
              }
              e.preventDefault();
              handleClick?.();
            }
          : nothing
      }
    >
      <div class="chat-tool-card__header">
        <div class="chat-tool-card__title">
          <span class="chat-tool-card__icon">${icons[display.icon]}</span>
          <span>${display.label}</span>
          ${
            isPty
              ? html`
                  <span class="chat-tool-card__badge">Terminal</span>
                `
              : nothing
          }
        </div>
        ${
          canClick
            ? html`<span class="chat-tool-card__action">${hasText ? "View" : ""} ${icons.check}</span>`
            : nothing
        }
        ${isEmpty && !canClick ? html`<span class="chat-tool-card__status">${icons.check}</span>` : nothing}
      </div>
      ${detail ? html`<div class="chat-tool-card__detail">${detail}</div>` : nothing}
      ${
        isEmpty
          ? html`
              <div class="chat-tool-card__status-text muted">Completed</div>
            `
          : nothing
      }
      ${previewContent}
      ${regularPreview}
      ${inlineContent}
    </div>
  `;
}

function normalizeContent(content: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(content)) {
    return [];
  }
  return content.filter(Boolean) as Array<Record<string, unknown>>;
}

function coerceArgs(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function extractToolText(item: Record<string, unknown>): string | undefined {
  if (typeof item.text === "string") {
    return item.text;
  }
  if (typeof item.content === "string") {
    return item.content;
  }
  return undefined;
}
