/**
 * Group Chat — Main View
 *
 * Renders the group chat interface including message list,
 * active streams, and compose area.
 */

import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { renderInlineToolCards } from "../chat/grouped-render.ts";
import { extractToolCards, classifyToolCards } from "../chat/tool-cards.ts";
import { typewriter } from "../chat/typewriter-directive.ts";
import type {
  GroupChatMessage,
  GroupSessionMeta,
  GroupIndexEntry,
  GroupCreateDialogState,
  GroupAddMemberDialogState,
  GroupDisbandDialogState,
  GroupToolMessage,
} from "../controllers/group-chat.ts";
import { t } from "../i18n/index.ts";
import { icons } from "../icons.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";
import type { ToolCard } from "../types/chat-types.ts";

// ─── Mention Dropdown State ───
let mentionDropdownState = {
  visible: false,
  filter: "",
  selectedIndex: 0,
  members: [] as Array<{ agentId: string; role: string }>,
  onSelect: null as ((agentId: string, agentName: string) => void) | null,
};

/** Get display items including @all option at the top */
function getDisplayItems(
  members: Array<{ agentId: string; role: string }>,
): Array<{ agentId: string; role: string }> {
  const allOption = { agentId: "all", role: "all" };
  return [allOption, ...members];
}

// ─── Scroll Helpers ───

/**
 * Scroll the group chat messages container to bottom.
 * Uses smooth scroll if reduced motion is not preferred.
 */
function scrollGroupChatToBottom(smooth = false) {
  const container = document.querySelector(".group-chat-room__messages");
  if (!container) {
    return;
  }
  const scrollTop = container.scrollHeight;
  const smoothEnabled =
    smooth &&
    (typeof window === "undefined" ||
      typeof window.matchMedia !== "function" ||
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  if (typeof container.scrollTo === "function") {
    container.scrollTo({ top: scrollTop, behavior: smoothEnabled ? "smooth" : "auto" });
  } else {
    container.scrollTop = scrollTop;
  }
}

function showMentionDropdown(
  members: Array<{ agentId: string; role: string }>,
  filter: string,
  onSelect: (agentId: string, agentName: string) => void,
) {
  mentionDropdownState = {
    visible: true,
    filter: filter.toLowerCase(),
    selectedIndex: 0,
    members,
    onSelect,
  };
}

function hideMentionDropdown() {
  mentionDropdownState.visible = false;
}

function moveMentionSelection(delta: number) {
  const displayItems = getDisplayItems(mentionDropdownState.members).filter(
    (m) => m.agentId.toLowerCase().includes(mentionDropdownState.filter) || m.agentId === "all",
  );
  const newIndex =
    (mentionDropdownState.selectedIndex + delta + displayItems.length) % displayItems.length;
  mentionDropdownState.selectedIndex = newIndex;
  // Direct DOM update for instant feedback
  updateMentionDropdownSelection(newIndex);
}

function updateMentionDropdownSelection(selectedIndex: number) {
  const dropdown = document.querySelector(".mention-dropdown");
  if (!dropdown) {
    return;
  }
  const items = dropdown.querySelectorAll(".mention-item");
  items.forEach((item, index) => {
    if (index === selectedIndex) {
      item.classList.add("mention-item--selected");
      item.scrollIntoView({ block: "nearest" });
    } else {
      item.classList.remove("mention-item--selected");
    }
  });
}

function getSelectedMention(): { agentId: string; agentName: string } | null {
  const displayItems = getDisplayItems(mentionDropdownState.members).filter(
    (m) => m.agentId.toLowerCase().includes(mentionDropdownState.filter) || m.agentId === "all",
  );
  const selected = displayItems[mentionDropdownState.selectedIndex];
  if (!selected) {
    return null;
  }
  const displayName = selected.agentId === "all" ? "全体成员" : selected.agentId;
  return { agentId: selected.agentId, agentName: displayName };
}

// ─── Props ───

export type GroupChatViewProps = {
  connected: boolean;
  // State
  activeGroupId: string | null;
  activeGroupMeta: GroupSessionMeta | null;
  groupMessages: GroupChatMessage[];
  groupStreams: Map<string, { runId: string; text: string; startedAt: number }>;
  groupPendingAgents: Set<string>;
  groupToolMessages: Map<string, GroupToolMessage[]>;
  groupIndex: GroupIndexEntry[];
  groupListLoading: boolean;
  groupChatLoading: boolean;
  groupSending: boolean;
  groupDraft: string;
  groupError: string | null;
  groupCreateDialog: GroupCreateDialogState | null;
  groupAddMemberDialog: GroupAddMemberDialogState | null;
  groupDisbandDialog: GroupDisbandDialogState | null;
  groupInfoPanelOpen: boolean;
  // Agents
  agentsList: Array<{ id: string; identity?: { name?: string; emoji?: string } }>;
  // Callbacks
  onEnterGroup: (groupId: string) => void;
  onLeaveGroup: () => void;
  onSendMessage: (message: string, mentions?: string[]) => void;
  onAbort: () => void;
  onDraftChange: (next: string) => void;
  onCreateGroup: (opts: {
    name?: string;
    members: Array<{ agentId: string; role: "assistant" | "member" }>;
    messageMode?: "unicast" | "broadcast";
  }) => void;
  onDeleteGroup: (groupId: string) => void;
  onOpenCreateDialog: () => void;
  onCloseCreateDialog: () => void;
  onOpenAddMemberDialog: () => void;
  onCloseAddMemberDialog: () => void;
  onAddMembers: (members: Array<{ agentId: string; role: "member" }>) => void;
  onToggleInfoPanel: () => void;
  onRefresh: () => void;
  // Group settings callbacks
  onUpdateGroupName: (name: string) => void;
  onUpdateMessageMode: (mode: "unicast" | "broadcast") => void;
  onUpdateAnnouncement: (content: string) => void;
  onOpenDisbandDialog: () => void;
  onCloseDisbandDialog: () => void;
  onConfirmDisbandGroup: () => void;
  onUpdateThinkingLevel?: (level: string) => void;
};

// ─── Main Render ───

export function renderGroupChat(props: GroupChatViewProps) {
  if (props.activeGroupId && props.activeGroupMeta) {
    return renderGroupChatRoom(props);
  }
  return renderGroupList(props);
}

// ─── Group List View ───

function renderGroupList(props: GroupChatViewProps) {
  const { groupIndex, groupListLoading, connected } = props;
  const activeGroups = groupIndex.filter((g) => !g.archived);

  return html`
    <div class="group-chat-list">
      <div class="group-chat-list__header">
        <h2 class="group-chat-list__title">${t("chat.group.title")}</h2>
        <div class="group-chat-list__actions">
          <button
            class="btn btn--sm btn--icon"
            ?disabled=${!connected || groupListLoading}
            @click=${() => props.onRefresh()}
            title=${t("action.refresh")}
          >
            ${icons.refresh}
          </button>
          <button
            class="btn btn--sm btn--primary"
            ?disabled=${!connected}
            @click=${() => props.onOpenCreateDialog()}
          >
            ${icons.plus} ${t("chat.group.create")}
          </button>
        </div>
      </div>

      ${
        !connected
          ? html`<div class="group-chat-list__empty">${t("chat.disconnected")}</div>`
          : groupListLoading && activeGroups.length === 0
            ? html`<div class="group-chat-list__empty">${t("status.loading")}</div>`
            : activeGroups.length === 0
              ? html`<div class="group-chat-list__empty">${t("chat.group.noGroups")}</div>`
              : html`
                  <ul class="group-chat-list__items">
                    ${repeat(
                      activeGroups,
                      (g) => g.groupId,
                      (g) => renderGroupListItem(g, props),
                    )}
                  </ul>
                `
      }

      ${props.groupCreateDialog ? renderCreateGroupDialog(props) : nothing}
    </div>
  `;
}

function renderGroupListItem(entry: GroupIndexEntry, props: GroupChatViewProps) {
  const timeAgo = formatTimeAgo(entry.updatedAt);
  return html`
    <li class="group-chat-list__item" @click=${() => props.onEnterGroup(entry.groupId)}>
      <div class="group-chat-list__item-icon">
        <span class="group-chat-list__item-emoji">👥</span>
      </div>
      <div class="group-chat-list__item-info">
        <div class="group-chat-list__item-name">${entry.name || entry.groupId.slice(0, 8)}</div>
        <div class="group-chat-list__item-meta">
          ${entry.memberCount} ${t("chat.group.members")} · ${entry.messageMode}
          ${timeAgo ? html` · ${timeAgo}` : nothing}
        </div>
      </div>
      <button
        class="group-chat-list__item-delete btn btn--sm btn--icon"
        @click=${(e: Event) => {
          e.stopPropagation();
          props.onDeleteGroup(entry.groupId);
        }}
        title=${t("action.delete")}
      >
        ${icons.trash}
      </button>
    </li>
  `;
}

// ─── Group Chat Room ───

function renderGroupChatRoom(props: GroupChatViewProps) {
  const {
    activeGroupMeta: meta,
    groupMessages,
    groupStreams,
    groupPendingAgents,
    groupToolMessages,
    groupSending,
    groupError,
  } = props;
  if (!meta) {
    return nothing;
  }

  // Ensure groupToolMessages is defined (defensive check)
  const toolMessages = groupToolMessages ?? new Map();

  const hasActiveStreams = groupStreams.size > 0;
  const hasPendingAgents = groupPendingAgents.size > 0;

  // Pending agents that are NOT yet streaming (exclude agents already in groupStreams)
  const pendingOnly = [...groupPendingAgents].filter((id) => !groupStreams.has(id));

  return html`
    <div class="group-chat-room">
      <div class="group-chat-room__header">
        <button class="btn btn--sm btn--icon group-chat-room__back-btn" @click=${() => props.onLeaveGroup()} title=${t("chat.group.back")}>
          ${icons.arrowLeft}
        </button>
        <div class="group-chat-room__header-info">
          <span class="group-chat-room__header-name">👥 ${meta.name || meta.groupId.slice(0, 8)}</span>
          <span class="group-chat-room__header-meta">
            ${meta.members.length} ${t("chat.group.members")} · ${meta.messageMode}
          </span>
        </div>
        <div class="group-chat-room__header-actions">
          <!-- Thinking Level Selector -->
          <select
            class="field field--sm group-chat-room__thinking-select"
            .value=${meta.thinkingLevel || "inherit"}
            @change=${(e: Event) => {
              const value = (e.target as HTMLSelectElement).value;
              props.onUpdateThinkingLevel?.(value === "inherit" ? "" : value);
            }}
            title=${t("chat.group.thinkingLevel")}
          >
            <option value="inherit" ?selected=${!meta.thinkingLevel}>🧠 Inherit</option>
            <option value="off" ?selected=${meta.thinkingLevel === "off"}>🧠 Off</option>
            <option value="low" ?selected=${meta.thinkingLevel === "low"}>🧠 Low</option>
            <option value="medium" ?selected=${meta.thinkingLevel === "medium"}>🧠 Medium</option>
            <option value="high" ?selected=${meta.thinkingLevel === "high"}>🧠 High</option>
          </select>
          <button
            class="btn btn--sm btn--icon"
            @click=${() => props.onOpenAddMemberDialog()}
            title=${t("chat.group.addMember")}
          >
            ${icons.userPlus}
          </button>
          <button
            class="btn btn--sm btn--icon group-chat-room__info-toggle"
            @click=${() => props.onToggleInfoPanel()}
            title=${t("chat.group.info")}
          >
            ${icons.moreHorizontal}
          </button>
        </div>
      </div>

      ${groupError ? html`<div class="group-chat-room__error">${groupError}</div>` : nothing}

      <div class="group-chat-room__body">
        <div class="group-chat-room__main">
          <div class="group-chat-room__messages">
            ${
              props.groupChatLoading && groupMessages.length === 0
                ? html`<div class="group-chat-room__loading">${t("status.loading")}</div>`
                : nothing
            }

            ${repeat(
              groupMessages,
              (m) => m.id,
              (m) => renderGroupMessage(m, meta, props.agentsList),
            )}

            ${Array.from(groupStreams.entries()).map(([agentId, stream]) => {
              const toolKey = `${agentId}:${stream.runId}`;
              const tools = toolMessages.get(toolKey);
              return renderGroupStreamBubble(agentId, stream, meta, props.agentsList, tools);
            })}

            ${pendingOnly.map((agentId) =>
              renderPendingAgentIndicator(agentId, meta, props.agentsList),
            )}
          </div>

          <div class="chat-compose group-chat-room__compose">
            <div class="chat-compose__row" style="position: relative;">
              <label class="field chat-compose__field">
                <span>${t("chat.group.message")}</span>
                <textarea
                  id="group-chat-textarea"
                  .value=${props.groupDraft}
                  ?disabled=${!props.connected}
                  @keydown=${(e: KeyboardEvent) => {
                    // Handle mention dropdown navigation
                    if (mentionDropdownState.visible) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        moveMentionSelection(1);
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        moveMentionSelection(-1);
                        return;
                      }
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const selected = getSelectedMention();
                        if (selected && mentionDropdownState.onSelect) {
                          const cursorPos = (e.target as HTMLTextAreaElement).selectionStart;
                          const textBefore = props.groupDraft.slice(0, cursorPos);
                          const textAfter = props.groupDraft.slice(cursorPos);
                          // Find the @ pattern and replace it
                          const lastAtIndex = textBefore.lastIndexOf("@");
                          if (lastAtIndex >= 0) {
                            const newText =
                              textBefore.slice(0, lastAtIndex) +
                              `@${selected.agentName} ` +
                              textAfter;
                            props.onDraftChange(newText);
                            hideMentionDropdown();
                          }
                        }
                        return;
                      }
                      if (e.key === "Escape") {
                        hideMentionDropdown();
                        return;
                      }
                    }

                    if (e.key !== "Enter") {
                      return;
                    }
                    if (e.isComposing || e.keyCode === 229) {
                      return;
                    }
                    if (e.shiftKey) {
                      return;
                    }
                    if (!props.connected) {
                      return;
                    }
                    e.preventDefault();
                    if (props.groupDraft.trim()) {
                      const { text, mentions } = parseMentions(props.groupDraft, meta.members);
                      props.onSendMessage(text, mentions);
                      // Scroll to bottom after sending
                      scrollGroupChatToBottom(true);
                    }
                  }}
                  @input=${(e: Event) => {
                    const target = e.target as HTMLTextAreaElement;
                    target.style.height = "auto";
                    target.style.height = `${target.scrollHeight}px`;
                    const value = target.value;
                    const cursorPos = target.selectionStart;
                    props.onDraftChange(value);

                    // Check for @ mention trigger
                    const textBeforeCursor = value.slice(0, cursorPos);
                    const lastAtIndex = textBeforeCursor.lastIndexOf("@");
                    if (lastAtIndex >= 0) {
                      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
                      // Check if there's a space after @ (if so, close dropdown)
                      if (!textAfterAt.includes(" ")) {
                        showMentionDropdown(meta.members, textAfterAt, (agentId, agentName) => {
                          const newText =
                            value.slice(0, lastAtIndex) + `@${agentName} ` + value.slice(cursorPos);
                          props.onDraftChange(newText);
                          hideMentionDropdown();
                        });
                      } else {
                        hideMentionDropdown();
                      }
                    } else {
                      hideMentionDropdown();
                    }
                  }}
                  placeholder=${
                    props.connected ? t("chat.group.placeholder") : t("chat.disconnected")
                  }
                ></textarea>
              </label>
              ${renderMentionDropdown()}
              <div class="chat-compose__actions">
                ${
                  hasActiveStreams || hasPendingAgents
                    ? html`
                      <button
                        class="btn"
                        @click=${() => props.onAbort()}
                        title=${t("chat.group.abort")}
                      >
                        ${icons.square} ${t("chat.group.abort")}
                      </button>
                    `
                    : html`
                      <button
                        class="btn"
                        ?disabled=${!props.connected}
                        @click=${() => props.onLeaveGroup()}
                      >
                        ${t("chat.group.back")}
                      </button>
                    `
                }
                <button
                  class="btn primary"
                  ?disabled=${!props.connected || (!props.groupDraft.trim() && !hasActiveStreams && !hasPendingAgents)}
                  @click=${() => {
                    if (props.groupDraft.trim()) {
                      const { text, mentions } = parseMentions(props.groupDraft, meta.members);
                      props.onSendMessage(text, mentions);
                      // Scroll to bottom after sending
                      scrollGroupChatToBottom(true);
                    }
                  }}
                >
                  ${groupSending ? icons.loader : nothing}
                  ${t("chat.group.send")}<kbd class="btn-kbd">↵</kbd>
                </button>
              </div>
            </div>
          </div>
        </div>

        <aside class="group-chat-room__members-panel">
          ${renderGroupMembersPanel(meta, props)}
        </aside>
      </div>

      ${props.groupInfoPanelOpen ? renderGroupInfoPanel(meta, props) : nothing}
      ${props.groupAddMemberDialog ? renderAddMemberDialog(props) : nothing}
      ${renderDisbandGroupDialog(props)}
    </div>
  `;
}

// ─── Message Rendering ───

function renderGroupMessage(
  msg: GroupChatMessage,
  meta: GroupSessionMeta,
  agentsList: GroupChatViewProps["agentsList"],
) {
  const isSystem = msg.role === "system" || msg.sender.type === "system";
  if (isSystem) {
    return html`
      <div class="group-msg group-msg--system">
        <span class="group-msg__system-text">${msg.content}</span>
      </div>
    `;
  }

  const isUser = msg.sender.type === "owner";
  const senderName = resolveSenderName(msg.sender, meta, agentsList);
  const senderEmoji = resolveSenderEmoji(msg.sender, meta, agentsList);
  const roleClass = isUser ? "user" : "assistant";
  const timestamp = new Date(msg.timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  // Extract tool cards from message
  const toolCards = extractToolCards(msg as unknown as Record<string, unknown>);
  const classified = toolCards.length > 0 ? classifyToolCards(toolCards) : null;

  // Render markdown content with mention highlighting
  // Step 1: Handle escapes (\@ → @) before markdown processing
  // Step 2: Convert markdown to HTML
  // Step 3: Highlight @mentions in the HTML
  const memberIds = meta.members.map((m) => m.agentId);
  const contentWithEscapes = msg.content.replace(/\\@/g, "@");
  const markdownHtml = toSanitizedMarkdownHtml(contentWithEscapes);
  const contentHtml = highlightMentionsInHtml(markdownHtml, memberIds);

  return html`
    <div class="chat-group ${roleClass}">
      <div class="chat-avatar ${roleClass}">${isUser ? "U" : senderEmoji}</div>
      <div class="chat-group-messages">
        <div class="chat-bubble ${isUser ? "" : "assistant"}">
          <div class="chat-text">${unsafeHTML(contentHtml)}</div>
        </div>
        ${classified ? renderInlineToolCards(classified, undefined) : nothing}
        <div class="chat-group-footer">
          <span class="chat-sender-name">${isUser ? "You" : senderName}</span>
          <span class="chat-group-timestamp">${timestamp}</span>
        </div>
      </div>
    </div>
  `;
}

function renderGroupStreamBubble(
  agentId: string,
  stream: { runId: string; text: string; startedAt: number },
  meta: GroupSessionMeta,
  agentsList: GroupChatViewProps["agentsList"],
  toolMessages?: GroupToolMessage[],
) {
  const sender: { type: "agent"; agentId: string } = { type: "agent", agentId };
  const senderName = resolveSenderName(sender, meta, agentsList);
  const senderEmoji = resolveSenderEmoji(sender, meta, agentsList);
  const timestamp = new Date(stream.startedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  // Render tool cards if available
  let toolCards: ReturnType<typeof renderInlineToolCards> = nothing;
  if (toolMessages && toolMessages.length > 0) {
    // Convert GroupToolMessage[] to ToolCard[]
    const toolCardList: ToolCard[] = toolMessages.map((msg) => ({
      kind: msg.role === "tool_call" ? "call" : "result",
      name: msg.toolName ?? "tool",
      args: msg.toolArgs,
      text: msg.content,
    }));
    // Classify the tool cards and render them
    const classified = classifyToolCards(toolCardList);
    toolCards = renderInlineToolCards(classified);
  }

  return html`
    <div class="chat-group assistant streaming">
      <div class="chat-avatar assistant">${senderEmoji}</div>
      <div class="chat-group-messages">
        <div class="chat-bubble streaming">
          ${stream.text ? html`<div class="chat-text chat-text-streaming" ${typewriter(stream.text)}></div>` : nothing}
          ${toolCards}
        </div>
        <div class="chat-group-footer">
          <span class="chat-sender-name">${senderName}</span>
          <span class="group-stream-indicator">
            <span class="group-stream-indicator__label">${t("chat.group.generating")}</span>
            <span class="group-stream-indicator__dots">
              <span></span><span></span><span></span>
            </span>
          </span>
          <span class="chat-group-timestamp">${timestamp}</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render a "pending" indicator for an agent that is about to respond
 * but hasn't started streaming yet. Shows reading-indicator dots animation.
 */
function renderPendingAgentIndicator(
  agentId: string,
  meta: GroupSessionMeta,
  agentsList: GroupChatViewProps["agentsList"],
) {
  const sender: { type: "agent"; agentId: string } = { type: "agent", agentId };
  const senderName = resolveSenderName(sender, meta, agentsList);
  const senderEmoji = resolveSenderEmoji(sender, meta, agentsList);

  return html`
    <div class="chat-group assistant group-pending-indicator">
      <div class="chat-avatar assistant">${senderEmoji}</div>
      <div class="chat-group-messages">
        <div class="chat-bubble chat-reading-indicator">
          <span class="chat-reading-indicator__dots">
            <span></span><span></span><span></span>
          </span>
        </div>
        <div class="chat-group-footer">
          <span class="chat-sender-name">${senderName}</span>
          <span class="group-pending-indicator__label">${t("status.loading")}</span>
        </div>
      </div>
    </div>
  `;
}

// ─── Info Panel ───

function renderGroupMembersPanel(meta: GroupSessionMeta, props: GroupChatViewProps) {
  return html`
    <div class="group-members-panel">
      <!-- Announcement section -->
      <div
        class="group-members-panel__announcement"
        @click=${() => {
          /* TODO: expand announcement */
        }}
      >
        <div class="group-members-panel__announcement-header">
          <span class="group-members-panel__announcement-title">${t("chat.group.announcement")}</span>
          ${icons.chevronRight}
        </div>
        <div class="group-members-panel__announcement-content">
          ${
            meta.announcement
              ? meta.announcement.slice(0, 60) + (meta.announcement.length > 60 ? "…" : "")
              : html`<span class="group-members-panel__announcement-empty">${t("chat.group.noAnnouncement")}</span>`
          }
        </div>
      </div>

      <!-- Member list header -->
      <div class="group-members-panel__header">
        <div class="group-members-panel__header-left">
          <h3>${t("chat.group.memberList")}</h3>
          <span class="group-members-panel__count">${meta.members.length}</span>
        </div>
        <button
          class="btn btn--xs btn--icon"
          @click=${() => props.onOpenAddMemberDialog()}
          title=${t("chat.group.addMember")}
        >
          ${icons.userPlus}
        </button>
      </div>

      <!-- Member list -->
      <ul class="group-members-panel__list">
        ${meta.members.map((m) => {
          const displayName = resolveAgentName(m.agentId, props.agentsList);
          const showId = displayName !== m.agentId;
          return html`
            <li class="group-members-panel__item">
              <span class="group-members-panel__emoji">
                ${resolveSenderEmoji({ type: "agent", agentId: m.agentId }, meta, props.agentsList)}
              </span>
              <span class="group-members-panel__text">
                <span class="group-members-panel__name">${displayName}</span>
                ${showId ? html`<span class="group-members-panel__id">@${m.agentId}</span>` : nothing}
              </span>
              <span class="group-members-panel__role badge badge--${m.role}">${m.role}</span>
            </li>
          `;
        })}
      </ul>
    </div>
  `;
}

function renderGroupInfoPanel(meta: GroupSessionMeta, props: GroupChatViewProps) {
  return html`
    <div class="group-info-panel">
      <div class="group-info-panel__header">
        <h3>${t("chat.group.info")}</h3>
        <button class="btn btn--sm btn--icon" @click=${() => props.onToggleInfoPanel()}>
          ${icons.x}
        </button>
      </div>
      <div class="group-info-panel__body">
        <!-- Group Name (editable) -->
        <div class="group-info-panel__section">
          <label>${t("chat.group.groupName")}</label>
          <div class="group-info-panel__editable">
            <input
              type="text"
              class="field group-info-panel__input"
              .value=${meta.name || ""}
              placeholder=${t("chat.group.namePlaceholder")}
              @change=${(e: Event) => {
                const value = (e.target as HTMLInputElement).value.trim();
                props.onUpdateGroupName(value);
              }}
            />
          </div>
        </div>

        <!-- Message Mode (editable) -->
        <div class="group-info-panel__section">
          <label>${t("chat.group.messageMode")}</label>
          <div class="group-info-panel__editable">
            <select
              class="field group-info-panel__input"
              @change=${(e: Event) => {
                const value = (e.target as HTMLSelectElement).value as "unicast" | "broadcast";
                props.onUpdateMessageMode(value);
              }}
            >
              <option value="unicast" ?selected=${meta.messageMode === "unicast"}>Unicast</option>
              <option value="broadcast" ?selected=${meta.messageMode === "broadcast"}>Broadcast</option>
            </select>
          </div>
        </div>

        <!-- Announcement (editable) -->
        <div class="group-info-panel__section">
          <label>${t("chat.group.announcement")}</label>
          <div class="group-info-panel__editable">
            <textarea
              class="field group-info-panel__textarea"
              .value=${meta.announcement || ""}
              placeholder=${t("chat.group.announcementPlaceholder") || "Enter group announcement..."}
              rows="3"
              @change=${(e: Event) => {
                const value = (e.target as HTMLTextAreaElement).value.trim();
                props.onUpdateAnnouncement(value);
              }}
            ></textarea>
          </div>
        </div>

        <!-- Member List -->
        <div class="group-info-panel__section">
          <label>${t("chat.group.memberList")}</label>
          <ul class="group-info-panel__members">
            ${meta.members.map(
              (m) => html`
                <li class="group-info-panel__member">
                  <span class="group-info-panel__member-emoji">
                    ${resolveSenderEmoji({ type: "agent", agentId: m.agentId }, meta, props.agentsList)}
                  </span>
                  <span class="group-info-panel__member-name">
                    ${resolveAgentName(m.agentId, props.agentsList)}
                  </span>
                  <span class="group-info-panel__member-role badge badge--${m.role}">
                    ${m.role}
                  </span>
                </li>
              `,
            )}
          </ul>
        </div>

        <!-- Settings -->
        <div class="group-info-panel__section">
          <label>${t("chat.group.settings")}</label>
          <div class="group-info-panel__settings">
            <span>Max rounds: ${meta.maxRounds}</span>
            <span>Max consecutive: ${meta.maxConsecutive}</span>
          </div>
        </div>

        <!-- Danger Zone -->
        <div class="group-info-panel__section group-info-panel__section--danger">
          <label>${t("chat.group.dangerZone") || "Danger Zone"}</label>
          <button
            class="btn btn--danger btn--sm"
            @click=${() => props.onOpenDisbandDialog()}
          >
            ${icons.trash} ${t("chat.group.disband") || "Disband Group"}
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── Disband Group Dialog ───

function renderDisbandGroupDialog(props: GroupChatViewProps) {
  const dialog = props.groupDisbandDialog;
  if (!dialog) {
    return nothing;
  }

  return html`
    <div class="modal-overlay" role="dialog" aria-modal="true" aria-live="polite">
      <div class="modal-card modal-card--danger">
        <div class="modal-header">
          <div class="modal-icon modal-icon--danger">
            ${icons.trash}
          </div>
          <div class="modal-title-group">
            <div class="modal-title">${t("chat.group.disband") || "Disband Group"}</div>
            <div class="modal-subtitle">${dialog.groupName}</div>
          </div>
        </div>

        <div class="modal-body">
          <div class="warning-box">
            <div class="warning-box__icon">${icons.alertTriangle}</div>
            <div class="warning-box__content">
              <div class="warning-box__title">${t("chat.sidebar.deleteWarningTitle") || "This action cannot be undone"}</div>
              <div class="warning-box__text">${t("chat.group.disbandConfirmDetail") || "All messages and settings will be permanently deleted."}</div>
            </div>
          </div>

          ${
            dialog.error
              ? html`
                <div class="modal-error">
                  <span class="modal-error__icon">${icons.alertCircle}</span>
                  <span>${dialog.error}</span>
                </div>
              `
              : nothing
          }
        </div>

        <div class="modal-actions">
          <button
            class="btn btn--secondary"
            ?disabled=${dialog.isDisbanding}
            @click=${() => props.onCloseDisbandDialog()}
          >
            ${t("common.cancel") || "Cancel"}
          </button>
          <button
            class="btn btn--danger"
            ?disabled=${dialog.isDisbanding}
            @click=${() => props.onConfirmDisbandGroup()}
          >
            ${
              dialog.isDisbanding
                ? html`
                  <span class="btn__spinner">${icons.loader}</span>
                  <span>${t("chat.group.disbanding") || "Disbanding..."}</span>
                `
                : html`<span>${t("chat.group.disband") || "Disband Group"}</span>`
            }
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── Create Dialog ───

function renderCreateGroupDialog(props: GroupChatViewProps) {
  const dialog = props.groupCreateDialog;
  if (!dialog) {
    return nothing;
  }

  return html`
    <div class="modal-overlay" role="dialog" aria-modal="true">
      <div class="modal-card group-create-dialog">
        <div class="modal-header group-create-dialog__header">
          <h3 class="modal-title">${t("chat.group.createTitle")}</h3>
          <p class="group-create-dialog__sub">${t("chat.group.selectAgents")} · ${dialog.selectedAgents.length}</p>
        </div>
        <div class="modal-body group-create-dialog__body">
          <div class="form-field group-create__field">
            <label class="group-create__label">${t("chat.group.groupName")}</label>
            <input
              type="text"
              class="field group-create__input"
              placeholder=${t("chat.group.namePlaceholder")}
              .value=${dialog.name}
              @input=${(e: Event) => {
                dialog.name = (e.target as HTMLInputElement).value;
              }}
            />
          </div>
          <div class="form-field group-create__field">
            <label class="group-create__label">${t("chat.group.selectAgents")}</label>
            <div class="group-create__agents">
              ${props.agentsList.map(
                (agent) => html`
                  <label class="group-create__agent-option">
                    <input
                      type="checkbox"
                      .checked=${dialog.selectedAgents.some((s) => s.agentId === agent.id)}
                      @change=${(e: Event) => {
                        const checked = (e.target as HTMLInputElement).checked;
                        if (checked) {
                          const isFirst = dialog.selectedAgents.length === 0;
                          dialog.selectedAgents = [
                            ...dialog.selectedAgents,
                            { agentId: agent.id, role: isFirst ? "assistant" : "member" },
                          ];
                        } else {
                          dialog.selectedAgents = dialog.selectedAgents.filter(
                            (s) => s.agentId !== agent.id,
                          );
                        }
                      }}
                    />
                    <span class="group-create__agent-emoji">${agent.identity?.emoji ?? "🤖"}</span>
                    <span class="group-create__agent-name">${agent.identity?.name ?? agent.id}</span>
                    ${
                      dialog.selectedAgents.find((s) => s.agentId === agent.id)?.role ===
                      "assistant"
                        ? html`
                            <span class="badge badge--assistant">assistant</span>
                          `
                        : nothing
                    }
                  </label>
                `,
              )}
            </div>
          </div>
          <div class="form-field group-create__field">
            <label class="group-create__label">${t("chat.group.messageMode")}</label>
            <select
              class="field group-create__input"
              .value=${dialog.messageMode}
              @change=${(e: Event) => {
                dialog.messageMode = (e.target as HTMLSelectElement).value as
                  | "unicast"
                  | "broadcast";
              }}
            >
              <option value="unicast">Unicast</option>
              <option value="broadcast">Broadcast</option>
            </select>
          </div>
          ${dialog.error ? html`<div class="modal-error">${dialog.error}</div>` : nothing}
        </div>
        <div class="modal-actions group-create-dialog__actions">
          <button
            class="btn btn--secondary"
            @click=${() => props.onCloseCreateDialog()}
            ?disabled=${dialog.isBusy}
          >
            ${t("action.cancel")}
          </button>
          <button
            class="btn btn--primary"
            ?disabled=${dialog.isBusy || dialog.selectedAgents.length < 1}
            @click=${() => {
              props.onCreateGroup({
                name: dialog.name || undefined,
                members: dialog.selectedAgents,
                messageMode: dialog.messageMode,
              });
            }}
          >
            ${dialog.isBusy ? html`<span class="btn__spinner">${icons.loader}</span>` : nothing}
            ${t("chat.group.create")}
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── Add Member Dialog ───

function renderAddMemberDialog(props: GroupChatViewProps) {
  const dialog = props.groupAddMemberDialog;
  const meta = props.activeGroupMeta;
  if (!dialog || !meta) {
    return nothing;
  }

  // Filter out existing members
  const existingIds = new Set(meta.members.map((m) => m.agentId));
  const availableAgents = props.agentsList.filter((a) => !existingIds.has(a.id));

  return html`
    <div class="modal-overlay" role="dialog" aria-modal="true">
      <div class="modal-card group-create-dialog">
        <div class="modal-header group-create-dialog__header">
          <h3 class="modal-title">${t("chat.group.addMember")}</h3>
          <p class="group-create-dialog__sub">${t("chat.group.selectAgents")} · ${dialog.selectedAgents.length}</p>
        </div>
        <div class="modal-body group-create-dialog__body">
          ${
            availableAgents.length === 0
              ? html`<div class="group-chat-list__empty">${t("chat.group.noAvailableAgents")}</div>`
              : html`
                <div class="group-create__agents">
                  ${availableAgents.map(
                    (agent) => html`
                      <label class="group-create__agent-option">
                        <input
                          type="checkbox"
                          .checked=${dialog.selectedAgents.some((s) => s.agentId === agent.id)}
                          @change=${(e: Event) => {
                            const checked = (e.target as HTMLInputElement).checked;
                            if (checked) {
                              dialog.selectedAgents = [
                                ...dialog.selectedAgents,
                                { agentId: agent.id, role: "member" },
                              ];
                            } else {
                              dialog.selectedAgents = dialog.selectedAgents.filter(
                                (s) => s.agentId !== agent.id,
                              );
                            }
                          }}
                        />
                        <span class="group-create__agent-emoji">${agent.identity?.emoji ?? "🤖"}</span>
                        <span class="group-create__agent-name">${agent.identity?.name ?? agent.id}</span>
                      </label>
                    `,
                  )}
                </div>
              `
          }
          ${dialog.error ? html`<div class="modal-error">${dialog.error}</div>` : nothing}
        </div>
        <div class="modal-actions group-create-dialog__actions">
          <button
            class="btn btn--secondary"
            @click=${() => props.onCloseAddMemberDialog()}
            ?disabled=${dialog.isBusy}
          >
            ${t("action.cancel")}
          </button>
          <button
            class="btn btn--primary"
            ?disabled=${dialog.isBusy || dialog.selectedAgents.length < 1}
            @click=${() => {
              props.onAddMembers(dialog.selectedAgents);
            }}
          >
            ${dialog.isBusy ? html`<span class="btn__spinner">${icons.loader}</span>` : nothing}
            ${t("chat.group.add")}
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── Helpers ───

function resolveSenderName(
  sender: GroupChatMessage["sender"],
  _meta: GroupSessionMeta,
  agentsList: GroupChatViewProps["agentsList"],
): string {
  if (sender.type === "owner") {
    return "You";
  }
  if (sender.type === "system") {
    return "System";
  }
  return resolveAgentName(sender.agentId, agentsList);
}

function resolveSenderEmoji(
  sender: GroupChatMessage["sender"],
  _meta: GroupSessionMeta,
  agentsList: GroupChatViewProps["agentsList"],
): string {
  if (sender.type === "owner") {
    return "👤";
  }
  if (sender.type === "system") {
    return "⚙️";
  }
  const agent = agentsList.find((a) => a.id === sender.agentId);
  return agent?.identity?.emoji ?? "🤖";
}

function resolveAgentName(agentId: string, agentsList: GroupChatViewProps["agentsList"]): string {
  const agent = agentsList.find((a) => a.id === agentId);
  return agent?.identity?.name ?? agentId;
}

function parseMentions(
  text: string,
  members: GroupSessionMeta["members"],
): { text: string; mentions: string[] } {
  const mentions: string[] = [];
  const mentionPattern = /@(\S+)/g;
  let match: RegExpExecArray | null;
  let hasAllMention = false;

  while ((match = mentionPattern.exec(text)) !== null) {
    const name = match[1];
    // Check for @all or @全体成员
    if (name === "all" || name === "全体成员") {
      hasAllMention = true;
    } else {
      const member = members.find((m) => m.agentId === name || m.agentId.includes(name));
      if (member) {
        mentions.push(member.agentId);
      }
    }
  }

  // If @all or @全体成员 is mentioned, include all members
  if (hasAllMention) {
    members.forEach((m) => mentions.push(m.agentId));
  }

  return { text, mentions: [...new Set(mentions)] };
}

function renderMentionDropdown() {
  if (!mentionDropdownState.visible) {
    return nothing;
  }

  // Always show @all option plus filtered members
  const displayItems = getDisplayItems(mentionDropdownState.members).filter(
    (m) => m.agentId.toLowerCase().includes(mentionDropdownState.filter) || m.agentId === "all",
  );

  if (displayItems.length === 0) {
    return nothing;
  }

  return html`
    <div class="mention-dropdown">
      ${displayItems.map(
        (m, i) => html`
          <div
            class="mention-item ${i === mentionDropdownState.selectedIndex ? "mention-item--selected" : ""}"
            @click=${() => {
              if (mentionDropdownState.onSelect) {
                const displayName = m.agentId === "all" ? "全体成员" : m.agentId;
                mentionDropdownState.onSelect(m.agentId, displayName);
              }
              hideMentionDropdown();
            }}
            @mouseenter=${() => {
              mentionDropdownState.selectedIndex = i;
            }}
          >
            <span class="mention-item__emoji">${m.agentId === "all" ? "👥" : "🤖"}</span>
            <span class="mention-item__name">${m.agentId === "all" ? "全体成员" : m.agentId}</span>
            ${m.agentId !== "all" ? html`<span class="mention-item__role badge badge--${m.role}">${m.role}</span>` : nothing}
          </div>
        `,
      )}
    </div>
  `;
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) {
    return "just now";
  }
  if (diff < 3_600_000) {
    return `${Math.floor(diff / 60_000)}m ago`;
  }
  if (diff < 86_400_000) {
    return `${Math.floor(diff / 3_600_000)}h ago`;
  }
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/**
 * Highlight @mentions in HTML content.
 * Replaces @agentId with <mark class="mention">@agentId</mark> for valid members.
 * Avoids replacing inside HTML tags or attributes.
 */
function highlightMentionsInHtml(html: string, memberIds: string[]): string {
  if (!memberIds.length) {
    return html;
  }

  // Sort by length descending to match longer IDs first
  const sortedIds = [...memberIds].toSorted((a, b) => b.length - a.length);

  // Process each member ID
  let result = html;
  for (const agentId of sortedIds) {
    // Match @agentId that's not part of a longer word and not inside HTML tags
    // Use a regex that avoids matching inside <...>
    const pattern = new RegExp(`@${escapeRegExp(agentId)}(?![a-zA-Z0-9_-])(?![^<]*>)`, "g");
    result = result.replace(pattern, `<mark class="mention">@${agentId}</mark>`);
  }

  return result;
}

/** Escape special regex characters */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
