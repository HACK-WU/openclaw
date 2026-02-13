import { html, nothing } from "lit";
import type { ClassifiedToolCards, ToolCard, ToolCardCategory } from "../types/chat-types.ts";
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
        // PTY tool calls don't produce their own card — the terminal output
        // comes in the corresponding tool_result message instead.
        // Skip adding a "call" card for PTY to avoid duplicate terminal cards.
        continue;
      }
      cards.push({
        kind: "call",
        name: (item.name as string) ?? "tool",
        args,
        isPty: false,
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
    // 对于独立的 tool result 消息，通过启发式检测"终端控制码样式"的输出来判断
    const isPty = hasPtyCall || (text ? isTerminalLikeOutput(text) : false);
    cards.push({ kind: "result", name, text, isPty });
  }

  // If a PTY call was found but no result card exists yet (output not arrived),
  // create a placeholder PTY card so the terminal shows "Waiting for output..."
  if (hasPtyCall && !cards.some((c) => c.kind === "result" && c.isPty)) {
    const ptyItem = content.find((item) => {
      const kind = (typeof item.type === "string" ? item.type : "").toLowerCase();
      return (
        (["toolcall", "tool_call", "tooluse", "tool_use"].includes(kind) ||
          (typeof item.name === "string" && item.arguments != null)) &&
        isPtyFromArgs(coerceArgs(item.arguments ?? item.args))
      );
    });
    const ptyName = typeof ptyItem?.name === "string" ? ptyItem.name : "exec";
    cards.push({ kind: "result", name: ptyName, text: undefined, isPty: true });
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

/** Bash command tool names */
const BASH_TOOL_NAMES = new Set([
  "bash",
  "execute_bash",
  "run_bash",
  "shell",
  "execute_command",
  "run_command",
  "terminal",
]);

/**
 * Determine the category of a tool card.
 */
function getToolCategory(card: ToolCard): ToolCardCategory {
  if (card.isPty) {
    return "pty";
  }
  const normalizedName = card.name.toLowerCase().replace(/[-_]/g, "");
  if (
    BASH_TOOL_NAMES.has(card.name.toLowerCase()) ||
    normalizedName.includes("bash") ||
    normalizedName.includes("shell")
  ) {
    return "bash";
  }
  return "general";
}

/**
 * Classify tool cards into categories for grouped rendering.
 * PTY terminals are deduplicated by name — only the latest text is kept
 * so the same process doesn't produce multiple terminal cards.
 */
export function classifyToolCards(cards: ToolCard[]): ClassifiedToolCards {
  const result: ClassifiedToolCards = {
    generalTools: [],
    bashCommands: [],
    ptyTerminals: [],
  };

  // Dedup PTY cards by name: keep one card per name, merge text (latest wins)
  const ptyByName = new Map<string, ToolCard>();

  for (const card of cards) {
    const category = getToolCategory(card);
    switch (category) {
      case "pty": {
        const key = card.name.toLowerCase();
        const existing = ptyByName.get(key);
        if (existing) {
          // Merge: prefer the card that has text, or the latest one
          if (card.text?.trim()) {
            existing.text = card.text;
          }
          // Merge args if the new card has them
          if (card.args && !existing.args) {
            existing.args = card.args;
          }
        } else {
          // Clone to avoid mutating the original
          ptyByName.set(key, { ...card });
        }
        break;
      }
      case "bash":
        result.bashCommands.push(card);
        break;
      default:
        result.generalTools.push(card);
    }
  }

  result.ptyTerminals = [...ptyByName.values()];

  return result;
}

/**
 * Toggle expand/collapse on a tool card via DOM class toggle.
 * Uses display:none/block (no animation) for reliable, jank-free toggling.
 * When expanding, scrolls body-inner to bottom and ensures subsequent
 * cards (e.g. PTY terminals) remain visible.
 */
function toggleCardExpand(e: Event) {
  const header = (e.target as HTMLElement).closest(".chat-tool-card__header");
  if (!header) {
    return;
  }
  const card = header.closest(".chat-tool-card");
  if (!card) {
    return;
  }

  const wasExpanded = card.classList.contains("chat-tool-card--expanded");
  card.classList.toggle("chat-tool-card--expanded");

  if (!wasExpanded) {
    // Scroll the list inside the card to the bottom
    const bodyInner = card.querySelector(".chat-tool-card__body-inner");
    if (bodyInner) {
      bodyInner.scrollTop = bodyInner.scrollHeight;
    }
    // Scroll so the content after the card (e.g. PTY terminal) is visible
    requestAnimationFrame(() => {
      const nextSibling = card.nextElementSibling;
      if (nextSibling) {
        nextSibling.scrollIntoView({ behavior: "smooth", block: "nearest" });
      } else {
        card.scrollIntoView({ behavior: "smooth", block: "end" });
      }
    });
  }
}

/**
 * Render a collapsible card header with chevron.
 */
function renderCardHeader(title: string, icon: keyof typeof icons, badge?: string) {
  return html`
    <div class="chat-tool-card__header" @click=${toggleCardExpand}>
      <div class="chat-tool-card__title">
        <span class="chat-tool-card__icon">${icons[icon]}</span>
        <span>${title}</span>
        ${badge ? html`<span class="chat-tool-card__badge">${badge}</span>` : nothing}
      </div>
      <span class="chat-tool-card__chevron">
        <svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
      </span>
    </div>
  `;
}

/**
 * Render a merged tool group card (for non-bash, non-PTY tools).
 * Defaults to collapsed; click header to expand/collapse via DOM toggle.
 */
export function renderToolGroupCard(cards: ToolCard[], onOpenSidebar?: (content: string) => void) {
  if (cards.length === 0) {
    return nothing;
  }

  const title =
    cards.length === 1
      ? resolveToolDisplay({ name: cards[0].name, args: cards[0].args }).label
      : `${cards.length} Tools`;

  // Collapsed summary: show the last tool's name + detail
  const lastCard = cards[cards.length - 1];
  const lastDisplay = resolveToolDisplay({ name: lastCard.name, args: lastCard.args });
  const lastDetail = formatToolDetail(lastDisplay);
  const summaryText = lastDetail ? `${lastDisplay.label}: ${lastDetail}` : lastDisplay.label;

  return html`
    <div class="chat-tool-card chat-tool-card--group">
      ${renderCardHeader(title, "wrench")}
      <div class="chat-tool-card__collapsed-summary">
        <span class="mono">${summaryText}</span>
      </div>
      <div class="chat-tool-card__body">
        <div class="chat-tool-card__body-inner">
          <div class="chat-tool-card__list">
            ${cards.map((card) => renderToolListItem(card, onOpenSidebar))}
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render a single item in the tool list (inside merged card).
 */
function renderToolListItem(card: ToolCard, onOpenSidebar?: (content: string) => void) {
  const display = resolveToolDisplay({ name: card.name, args: card.args });
  const detail = formatToolDetail(display);
  const hasText = Boolean(card.text?.trim());

  const handleSidebarClick = onOpenSidebar
    ? (e: Event) => {
        e.stopPropagation();
        if (hasText) {
          onOpenSidebar(formatToolOutputForSidebar(card.text!));
        } else {
          const info = `## ${display.label}\n\n${
            detail ? `**Command:** \`${detail}\`\n\n` : ""
          }*No output — tool completed successfully.*`;
          onOpenSidebar(info);
        }
      }
    : undefined;

  return html`
    <div class="chat-tool-card__list-item">
      <span class="chat-tool-card__list-item-icon">${icons[display.icon]}</span>
      <div class="chat-tool-card__list-item-content">
        <div class="chat-tool-card__list-item-name">${display.label}</div>
        ${detail ? html`<div class="chat-tool-card__list-item-detail mono">${detail}</div>` : nothing}
        ${
          handleSidebarClick
            ? html`<button class="chat-tool-card__sidebar-link" @click=${handleSidebarClick}>
              <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
              View in sidebar
            </button>`
            : nothing
        }
      </div>
      ${!hasText ? html`<span class="chat-tool-card__status">${icons.check}</span>` : nothing}
    </div>
  `;
}

/**
 * Render a merged bash command card (all bash/exec/process commands in one card).
 * Defaults to collapsed; click header to expand/collapse via DOM toggle.
 */
export function renderBashCommandCard(
  cards: ToolCard[],
  onOpenSidebar?: (content: string) => void,
) {
  if (cards.length === 0) {
    return nothing;
  }

  const title =
    cards.length === 1
      ? resolveToolDisplay({ name: cards[0].name, args: cards[0].args }).label
      : `${cards.length} Commands`;

  // Collapsed summary: show the last command's name + detail
  const lastCard = cards[cards.length - 1];
  const lastDisplay = resolveToolDisplay({ name: lastCard.name, args: lastCard.args });
  const lastDetail = formatToolDetail(lastDisplay);
  const summaryText = lastDetail ? `${lastDisplay.label}: ${lastDetail}` : lastDisplay.label;

  return html`
    <div class="chat-tool-card chat-tool-card--bash">
      ${renderCardHeader(title, "monitor")}
      <div class="chat-tool-card__collapsed-summary">
        <span class="mono">${summaryText}</span>
      </div>
      <div class="chat-tool-card__body">
        <div class="chat-tool-card__body-inner">
          <div class="chat-tool-card__list">
            ${cards.map((card) => renderBashListItem(card, onOpenSidebar))}
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render a single bash command item inside the merged bash card.
 */
function renderBashListItem(card: ToolCard, onOpenSidebar?: (content: string) => void) {
  const display = resolveToolDisplay({ name: card.name, args: card.args });
  const detail = formatToolDetail(display);
  const hasText = Boolean(card.text?.trim());

  const handleSidebarClick = onOpenSidebar
    ? (e: Event) => {
        e.stopPropagation();
        if (hasText) {
          onOpenSidebar(formatToolOutputForSidebar(card.text!));
        } else {
          const info = `## ${display.label}\n\n${
            detail ? `**Command:** \`${detail}\`\n\n` : ""
          }*No output — command completed successfully.*`;
          onOpenSidebar(info);
        }
      }
    : undefined;

  return html`
    <div class="chat-tool-card__list-item">
      <span class="chat-tool-card__list-item-icon">${icons[display.icon]}</span>
      <div class="chat-tool-card__list-item-content">
        <div class="chat-tool-card__list-item-name">${display.label}</div>
        ${detail ? html`<div class="chat-tool-card__list-item-detail mono">${detail}</div>` : nothing}
        ${
          hasText
            ? html`<div class="chat-tool-card__list-item-preview mono">${getTruncatedPreview(card.text!)}</div>`
            : nothing
        }
        ${
          handleSidebarClick
            ? html`<button class="chat-tool-card__sidebar-link" @click=${handleSidebarClick}>
              <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
              View full output
            </button>`
            : nothing
        }
      </div>
      ${!hasText ? html`<span class="chat-tool-card__status">${icons.check}</span>` : nothing}
    </div>
  `;
}

/**
 * Render a PTY terminal card (real-time terminal with live updates).
 * Defaults to collapsed; click header to expand/collapse via DOM toggle.
 */
export function renderPtyTerminalCard(card: ToolCard, onOpenSidebar?: (content: string) => void) {
  const display = resolveToolDisplay({ name: card.name, args: card.args });
  const hasText = Boolean(card.text?.trim());

  const handleSidebarClick =
    onOpenSidebar && hasText
      ? (e: Event) => {
          e.stopPropagation();
          onOpenSidebar(PTY_SIDEBAR_PREFIX + card.text!);
        }
      : undefined;

  return html`
    <div class="chat-tool-card chat-tool-card--pty">
      ${renderCardHeader(display.label, "monitor", "Terminal")}
      <div class="chat-tool-card__body">
        <div class="chat-tool-card__body-inner">
          ${
            hasText
              ? html`<terminal-viewer .content=${card.text!} ?live=${true}></terminal-viewer>`
              : html`
                  <div class="chat-tool-card__status-text muted">Waiting for output...</div>
                `
          }
          ${
            handleSidebarClick
              ? html`<button class="chat-tool-card__sidebar-link" @click=${handleSidebarClick}>
                <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
                View in sidebar
              </button>`
              : nothing
          }
        </div>
      </div>
    </div>
  `;
}
