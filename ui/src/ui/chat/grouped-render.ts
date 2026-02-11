import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { AssistantIdentity } from "../assistant-identity.ts";
import type { MessageGroup, ToolCard } from "../types/chat-types.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";
import { detectTextDirection } from "../text-direction.ts";
import { renderCopyAsMarkdownButton } from "./copy-as-markdown.ts";
import {
  extractTextCached,
  extractThinkingCached,
  formatReasoningMarkdown,
} from "./message-extract.ts";
import { isToolResultMessage, normalizeRoleForGrouping } from "./message-normalizer.ts";
import {
  classifyToolCards,
  extractToolCards,
  renderBashCommandCard,
  renderPtyTerminalCard,
  renderToolGroupCard,
} from "./tool-cards.ts";
import { typewriter } from "./typewriter-directive.ts";

type ImageBlock = {
  url: string;
  alt?: string;
};

function extractImages(message: unknown): ImageBlock[] {
  const m = message as Record<string, unknown>;
  const content = m.content;
  const images: ImageBlock[] = [];

  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block !== "object" || block === null) {
        continue;
      }
      const b = block as Record<string, unknown>;

      if (b.type === "image") {
        // Handle source object format (from sendChatMessage)
        const source = b.source as Record<string, unknown> | undefined;
        if (source?.type === "base64" && typeof source.data === "string") {
          const data = source.data;
          const mediaType = (source.media_type as string) || "image/png";
          // If data is already a data URL, use it directly
          const url = data.startsWith("data:") ? data : `data:${mediaType};base64,${data}`;
          images.push({ url });
        } else if (typeof b.url === "string") {
          images.push({ url: b.url });
        }
      } else if (b.type === "image_url") {
        // OpenAI format
        const imageUrl = b.image_url as Record<string, unknown> | undefined;
        if (typeof imageUrl?.url === "string") {
          images.push({ url: imageUrl.url });
        }
      }
    }
  }

  return images;
}

export function renderReadingIndicatorGroup(assistant?: AssistantIdentity) {
  return html`
    <div class="chat-group assistant">
      ${renderAvatar("assistant", assistant)}
      <div class="chat-group-messages">
        <div class="chat-bubble chat-reading-indicator" aria-hidden="true">
          <span class="chat-reading-indicator__dots">
            <span></span><span></span><span></span>
          </span>
        </div>
      </div>
    </div>
  `;
}

/**
 * Collect and classify tool cards from real-time tool stream messages.
 */
function collectStreamToolCards(
  toolMessages: unknown[],
  onOpenSidebar?: (content: string) => void,
) {
  const allCards: ToolCard[] = [];
  for (const msg of toolMessages) {
    const cards = extractToolCards(msg);
    allCards.push(...cards);
  }
  if (allCards.length === 0) {
    return nothing;
  }
  const classified = classifyToolCards(allCards);
  return renderInlineToolCards(classified, onOpenSidebar);
}

export function renderStreamingGroup(
  text: string,
  startedAt: number,
  onOpenSidebar?: (content: string) => void,
  assistant?: AssistantIdentity,
  toolMessages?: unknown[],
  segments?: string[],
) {
  const timestamp = new Date(startedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const name = assistant?.name ?? "Assistant";

  const hasTools = toolMessages && toolMessages.length > 0;

  // Tool cards from real-time tool stream
  const toolCardsHtml = hasTools ? collectStreamToolCards(toolMessages, onOpenSidebar) : nothing;

  // Use backend-provided segments to split into multiple bubbles.
  // Segments represent text between tool call boundaries, provided by the gateway.
  const hasSegments = segments && segments.length > 1;

  if (!hasSegments) {
    // Single segment or no segments: render as one bubble
    return html`
      <div class="chat-group assistant">
        ${renderAvatar("assistant", assistant)}
        <div class="chat-group-messages">
          ${toolCardsHtml}
          <div class="chat-bubble streaming fade-in">
            <div class="chat-text chat-text-streaming" ${typewriter(text)}></div>
          </div>
          <div class="chat-group-footer">
            <span class="chat-sender-name">${name}</span>
            <span class="chat-group-timestamp">${timestamp}</span>
          </div>
        </div>
      </div>
    `;
  }

  // Multiple segments: completed segments as static bubbles,
  // tool cards after them, then the active segment with typewriter.
  const completedSegments = segments.slice(0, -1);
  const activeSegment = segments[segments.length - 1];

  return html`
    <div class="chat-group assistant">
      ${renderAvatar("assistant", assistant)}
      <div class="chat-group-messages">
        ${completedSegments.map(
          (seg) => html`
            <div class="chat-bubble fade-in">
              <div class="chat-text">${unsafeHTML(toSanitizedMarkdownHtml(seg))}</div>
            </div>
          `,
        )}
        ${toolCardsHtml}
        <div class="chat-bubble streaming fade-in">
          <div class="chat-text chat-text-streaming" ${typewriter(activeSegment)}></div>
        </div>
        <div class="chat-group-footer">
          <span class="chat-sender-name">${name}</span>
          <span class="chat-group-timestamp">${timestamp}</span>
        </div>
      </div>
    </div>
  `;
}

export function renderMessageGroup(
  group: MessageGroup,
  opts: {
    onOpenSidebar?: (content: string) => void;
    showReasoning: boolean;
    assistantName?: string;
    assistantAvatar?: string | null;
  },
) {
  const normalizedRole = normalizeRoleForGrouping(group.role);
  const assistantName = opts.assistantName ?? "Assistant";
  const who =
    normalizedRole === "user"
      ? "You"
      : normalizedRole === "assistant"
        ? assistantName
        : normalizedRole;
  const roleClass =
    normalizedRole === "user" ? "user" : normalizedRole === "assistant" ? "assistant" : "other";
  const timestamp = new Date(group.timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  // Collect all tool cards across all messages in this group,
  // then classify and render them once as merged cards at the group level.
  const allToolCards: ToolCard[] = [];
  for (const item of group.messages) {
    const cards = extractToolCards(item.message);
    allToolCards.push(...cards);
    // For tool result messages without extracted cards, synthesize one from text
    if (cards.length === 0 && isToolResultMessage(item.message)) {
      const text = extractTextCached(item.message)?.trim() || undefined;
      if (text) {
        allToolCards.push({
          kind: "result",
          name: extractToolName(item.message),
          text,
        });
      }
    }
  }
  const classified = allToolCards.length > 0 ? classifyToolCards(allToolCards) : null;

  return html`
    <div class="chat-group ${roleClass}">
      ${renderAvatar(group.role, {
        name: assistantName,
        avatar: opts.assistantAvatar ?? null,
      })}
      <div class="chat-group-messages">
        ${group.messages.map((item, index) =>
          renderGroupedMessage(
            item.message,
            {
              isStreaming: group.isStreaming && index === group.messages.length - 1,
              showReasoning: opts.showReasoning,
            },
            opts.onOpenSidebar,
          ),
        )}
        ${classified ? renderInlineToolCards(classified, opts.onOpenSidebar) : nothing}
        <div class="chat-group-footer">
          <span class="chat-sender-name">${who}</span>
          <span class="chat-group-timestamp">${timestamp}</span>
        </div>
      </div>
    </div>
  `;
}

function renderAvatar(role: string, assistant?: Pick<AssistantIdentity, "name" | "avatar">) {
  const normalized = normalizeRoleForGrouping(role);
  const assistantName = assistant?.name?.trim() || "Assistant";
  const assistantAvatar = assistant?.avatar?.trim() || "";
  const initial =
    normalized === "user"
      ? "U"
      : normalized === "assistant"
        ? assistantName.charAt(0).toUpperCase() || "A"
        : normalized === "tool"
          ? "⚙"
          : "?";
  const className =
    normalized === "user"
      ? "user"
      : normalized === "assistant"
        ? "assistant"
        : normalized === "tool"
          ? "tool"
          : "other";

  if (assistantAvatar && normalized === "assistant") {
    if (isAvatarUrl(assistantAvatar)) {
      return html`<img
        class="chat-avatar ${className}"
        src="${assistantAvatar}"
        alt="${assistantName}"
      />`;
    }
    return html`<div class="chat-avatar ${className}">${assistantAvatar}</div>`;
  }

  return html`<div class="chat-avatar ${className}">${initial}</div>`;
}

function isAvatarUrl(value: string): boolean {
  return (
    /^https?:\/\//i.test(value) || /^data:image\//i.test(value) || value.startsWith("/") // Relative paths from avatar endpoint
  );
}

function renderMessageImages(images: ImageBlock[]) {
  if (images.length === 0) {
    return nothing;
  }

  return html`
    <div class="chat-message-images">
      ${images.map(
        (img) => html`
          <img
            src=${img.url}
            alt=${img.alt ?? "Attached image"}
            class="chat-message-image"
            @click=${() => window.open(img.url, "_blank")}
          />
        `,
      )}
    </div>
  `;
}

function renderGroupedMessage(
  message: unknown,
  opts: { isStreaming: boolean; showReasoning: boolean },
  _onOpenSidebar?: (content: string) => void,
) {
  const m = message as Record<string, unknown>;
  const role = typeof m.role === "string" ? m.role : "unknown";
  const isToolResult =
    isToolResultMessage(message) ||
    role.toLowerCase() === "toolresult" ||
    role.toLowerCase() === "tool_result" ||
    typeof m.toolCallId === "string" ||
    typeof m.tool_call_id === "string";

  const images = extractImages(message);
  const hasImages = images.length > 0;

  const extractedText = extractTextCached(message);
  const extractedThinking =
    opts.showReasoning && role === "assistant" ? extractThinkingCached(message) : null;
  const markdownBase = extractedText?.trim() ? extractedText : null;
  const reasoningMarkdown = extractedThinking ? formatReasoningMarkdown(extractedThinking) : null;
  const markdown = markdownBase;
  const canCopyMarkdown = role === "assistant" && Boolean(markdown?.trim());

  const bubbleClasses = [
    "chat-bubble",
    canCopyMarkdown ? "has-copy" : "",
    opts.isStreaming ? "streaming" : "",
    "fade-in",
  ]
    .filter(Boolean)
    .join(" ");

  // Tool result messages: tool cards are rendered at the group level,
  // so here we only render images if present, otherwise skip.
  if (isToolResult) {
    if (hasImages) {
      return html`
        <div class="chat-bubble fade-in">
          ${renderMessageImages(images)}
        </div>
      `;
    }
    // No content to render — tool cards handled at group level
    return nothing;
  }

  if (!markdown && !hasImages) {
    return nothing;
  }

  // Assistant/user messages: render text + images (tool cards at group level)
  return html`
    <div class="${bubbleClasses}">
      ${canCopyMarkdown ? renderCopyAsMarkdownButton(markdown!) : nothing}
      ${renderMessageImages(images)}
      ${
        reasoningMarkdown
          ? html`<div class="chat-thinking">${unsafeHTML(
              toSanitizedMarkdownHtml(reasoningMarkdown),
            )}</div>`
          : nothing
      }
      ${
        markdown
          ? html`<div class="chat-text" dir="${detectTextDirection(markdown)}">${unsafeHTML(toSanitizedMarkdownHtml(markdown))}</div>`
          : nothing
      }
    </div>
  `;
}

/** 从 tool result 消息中提取工具名称 */
function extractToolName(message: unknown): string {
  const m = message as Record<string, unknown>;
  if (typeof m.toolName === "string") return m.toolName;
  if (typeof m.tool_name === "string") return m.tool_name;
  if (typeof m.name === "string") return m.name;
  return "tool";
}

/**
 * Render classified tool cards inline with the new card types:
 * - General tools → merged into one collapsible group card
 * - Bash commands → merged into one collapsible command card
 * - PTY terminals → each gets its own collapsible terminal card with live xterm
 *   (deduplicated by name in classifyToolCards; PTY tool_calls are skipped
 *    so the terminal only renders once from the tool_result)
 *
 * All cards default to collapsed; click header to expand via DOM class toggle.
 */
function renderInlineToolCards(
  classified: ReturnType<typeof classifyToolCards>,
  onOpenSidebar?: (content: string) => void,
) {
  const parts = [];

  // Render general tools as a merged group card (collapsible)
  if (classified.generalTools.length > 0) {
    parts.push(renderToolGroupCard(classified.generalTools, onOpenSidebar));
  }

  // Render bash commands as a merged command card (collapsible)
  if (classified.bashCommands.length > 0) {
    parts.push(renderBashCommandCard(classified.bashCommands, onOpenSidebar));
  }

  // Render PTY terminals as individual collapsible terminal cards
  for (const card of classified.ptyTerminals) {
    parts.push(renderPtyTerminalCard(card, onOpenSidebar));
  }

  return parts.length > 0 ? html`${parts}` : nothing;
}
