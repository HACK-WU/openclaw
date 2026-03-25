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
import { extractThinkingCached, formatReasoningMarkdown } from "../chat/message-extract.ts";
import { classifyToolCards, extractToolCards } from "../chat/tool-cards.ts";
import { typewriter } from "../chat/typewriter-directive.ts";
import {
    BridgeTerminalResizeEvent,
    BridgeTerminalStreamEndEvent,
    BridgeTerminalStreamUpdateEvent,
} from "../components/bridge-terminal.ts";
import type {
    GroupAddMemberDialogState,
    GroupChatMessage,
    GroupClearMessagesDialogState,
    GroupCreateDialogState,
    GroupDisbandDialogState,
    GroupIndexEntry,
    GroupRemoveMemberDialogState,
    GroupSessionMeta,
    GroupToolMessage,
} from "../controllers/group-chat.ts";
import { getMentionedAgents, isBridgeAssistantAgent } from "../controllers/group-chat.ts";
import { stripThinkingTags } from "../format.ts";
import { t } from "../i18n/index.ts";
import { icons } from "../icons.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";
import type { ToolCard } from "../types/chat-types.ts";
import type { ChatAttachment } from "../ui-types.ts";
import { renderMarkdownSidebar } from "./markdown-sidebar.ts";

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

// ─── Image Paste & Attachment Helpers ───

function generateGroupAttachmentId(): string {
  return `gatt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function handleGroupPaste(e: ClipboardEvent, props: GroupChatViewProps) {
  const items = e.clipboardData?.items;
  if (!items || !props.onGroupAttachmentsChange) {
    return;
  }

  const imageItems: DataTransferItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.startsWith("image/")) {
      imageItems.push(item);
    }
  }

  if (imageItems.length === 0) {
    return;
  }

  e.preventDefault();

  for (const item of imageItems) {
    const file = item.getAsFile();
    if (!file) {
      continue;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const dataUrl = reader.result as string;
      const newAttachment: ChatAttachment = {
        id: generateGroupAttachmentId(),
        dataUrl,
        mimeType: file.type,
      };
      const current = props.groupAttachments ?? [];
      props.onGroupAttachmentsChange?.([...current, newAttachment]);
    });
    reader.readAsDataURL(file);
  }
}

function renderGroupAttachmentPreview(props: GroupChatViewProps) {
  const attachments = props.groupAttachments ?? [];
  if (attachments.length === 0) {
    return nothing;
  }

  return html`
    <div class="chat-attachments">
      ${attachments.map(
        (att) => html`
          <div class="chat-attachment">
            <img
              src=${att.dataUrl}
              alt="Attachment preview"
              class="chat-attachment__img"
            />
            <button
              class="chat-attachment__remove"
              type="button"
              aria-label="Remove attachment"
              @click=${() => {
                const next = (props.groupAttachments ?? []).filter((a) => a.id !== att.id);
                props.onGroupAttachmentsChange?.(next);
              }}
            >
              ${icons.x}
            </button>
          </div>
        `,
      )}
    </div>
  `;
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

function getSelectedMention(agentsList?: GroupChatViewProps["agentsList"]): { agentId: string; agentName: string } | null {
  const displayItems = getDisplayItems(mentionDropdownState.members).filter(
    (m) => m.agentId.toLowerCase().includes(mentionDropdownState.filter) || m.agentId === "all" ||
      (agentsList ? resolveAgentName(m.agentId, agentsList) : m.agentId).toLowerCase().includes(mentionDropdownState.filter),
  );
  const selected = displayItems[mentionDropdownState.selectedIndex];
  if (!selected) {
    return null;
  }
  const displayName = selected.agentId === "all" ? "全体成员" : (agentsList ? resolveAgentName(selected.agentId, agentsList) : selected.agentId);
  return { agentId: selected.agentId, agentName: displayName };
}

// ─── Props ───

export type GroupChatViewProps = {
  connected: boolean;
  // State
  groupListOpen: boolean;
  activeGroupId: string | null;
  activeGroupMeta: GroupSessionMeta | null;
  groupMessages: GroupChatMessage[];
  groupStreams: Map<string, { runId: string; text: string; startedAt: number; frozen?: boolean }>;
  groupPendingAgents: Set<string>;
  groupToolMessages: Map<string, GroupToolMessage[]>;
  groupIndex: GroupIndexEntry[];
  groupListLoading: boolean;
  groupChatLoading: boolean;
  groupSending: boolean;
  groupDraft: string;
  groupError: string | null;
  groupNotFound: boolean;
  groupCreateDialog: GroupCreateDialogState | null;
  groupAddMemberDialog: GroupAddMemberDialogState | null;
  groupRemoveMemberDialog: GroupRemoveMemberDialogState | null;
  groupDisbandDialog: GroupDisbandDialogState | null;
  groupClearMessagesDialog: GroupClearMessagesDialogState | null;
  groupInfoPanelOpen: boolean;
  // Agents
  agentsList: Array<{ id: string; identity?: { name?: string; emoji?: string } }>;
  // Callbacks
  onEnterGroup: (groupId: string) => void;
  onLeaveGroup: () => void;
  onSendMessage: (message: string, mentions?: string[], attachments?: ChatAttachment[]) => void;
  onAbort: () => void;
  onDraftChange: (next: string) => void;
  onCreateGroup: (opts: {
    name?: string;
    members: Array<{ agentId: string; role: "assistant" | "member" | "bridge-assistant" }>;
    messageMode?: "unicast" | "broadcast";
    project?: { directory?: string; docs?: string[] };
  }) => void;
  onDeleteGroup: (groupId: string) => void;
  onDeleteOrphanSession: () => void;
  onOpenCreateDialog: () => void;
  onCloseCreateDialog: () => void;
  onOpenAddMemberDialog: () => void;
  onCloseAddMemberDialog: () => void;
  onAddMembers: (members: Array<{ agentId: string; role: "member" | "bridge-assistant" }>) => void;
  onOpenRemoveMemberDialog: (agentId: string, agentName: string) => void;
  onCloseRemoveMemberDialog: () => void;
  onRemoveMember: (agentId: string) => void;
  onToggleInfoPanel: () => void;
  onRefresh: () => void;
  // Group settings callbacks
  onUpdateGroupName: (name: string) => void;
  onUpdateMessageMode: (mode: "unicast" | "broadcast") => void;
  onUpdateAnnouncement: (content: string) => void;
  onUpdateMaxRounds: (maxRounds: number) => void;
  onUpdateMaxConsecutive: (maxConsecutive: number) => void;
  onUpdateAntiLoopConfig: (config: {
    maxRounds?: number;
    chainTimeout?: number;
    cliTimeout?: number;
  }) => void;
  onUpdateContextConfig: (config: {
    maxMessages?: number;
    maxCharacters?: number;
    includeSystemMessages?: boolean;
  }) => void;
  onUpdateProjectDocs: (docs: string[]) => void;
  onOpenDisbandDialog: () => void;
  onCloseDisbandDialog: () => void;
  onConfirmDisbandGroup: () => void;
  // Clear messages
  onOpenClearMessagesDialog: () => void;
  onCloseClearMessagesDialog: () => void;
  onConfirmClearMessages: () => void;
  // Export transcript
  onExportTranscript: () => void;
  // Path validation
  onValidatePaths?: (
    paths: string[],
    type: "directory" | "file",
  ) => Promise<Array<{ path: string; exists: boolean; error?: string }>>;
  onTerminalResize?: (groupId: string, agentId: string, cols: number, rows: number) => void;
  onTerminalStreamUpdate?: (groupId: string, agentId: string, text: string) => void;
  onTerminalStreamEnd?: (groupId: string, agentId: string, extractedText: string) => void;
  // Announcement editor
  announcementEditor: { open: boolean; draft: string; preview: boolean };
  onOpenAnnouncementEditor: () => void;
  onCloseAnnouncementEditor: () => void;
  onAnnouncementEditorDraftChange: (draft: string) => void;
  onAnnouncementEditorTogglePreview: (preview: boolean) => void;
  // Thinking toggle (matches single chat pattern)
  showThinking: boolean;
  onToggleShowThinking: () => void;
  // Sidebar for tool output viewing (overlay mode — covers members panel)
  sidebarOpen?: boolean;
  sidebarContent?: string | null;
  sidebarError?: string | null;
  onOpenSidebar?: (content: string) => void;
  onCloseSidebar?: () => void;
  // Bridge terminal
  bridgeTerminalStatuses?: Map<
    string,
    "idle" | "working" | "ready" | "completed" | "error" | "disconnected"
  >;
  /** Terminal replay buffers (Base64-encoded, for page refresh restoration) */
  bridgeTerminalReplayBuffers?: Map<string, string>;
  // Image attachments
  groupAttachments?: ChatAttachment[];
  onGroupAttachmentsChange?: (attachments: ChatAttachment[]) => void;
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
    groupNotFound,
  } = props;
  if (!meta) {
    if (groupNotFound && groupError) {
      return html`
        <div class="group-chat-room">
          <div class="group-chat-room__header">
            <div class="group-chat-room__header-info">
              <span class="group-chat-room__header-name">👥 Group Not Found</span>
            </div>
          </div>
          <div class="group-chat-room__error">
            <span>${groupError}</span>
            <button
              class="group-chat-room__error-action"
              @click=${() => props.onDeleteOrphanSession()}
            >
              Delete Session
            </button>
          </div>
        </div>
      `;
    }
    return nothing;
  }

  // Ensure groupToolMessages is defined (defensive check)
  const toolMessages = groupToolMessages ?? new Map();

  const hasActiveStreams = groupStreams.size > 0;
  const hasPendingAgents = groupPendingAgents.size > 0;

  // Pending agents that are NOT yet streaming and do not already have an
  // active bridge terminal rendered.
  const pendingOnly = [...groupPendingAgents].filter(
    (id) => !groupStreams.has(id) && !props.bridgeTerminalStatuses?.has(id),
  );

  // Sidebar state — overlay mode for group chat (covers members panel, does not push content)
  const sidebarOpen = Boolean(props.sidebarOpen && props.onCloseSidebar);

  return html`
    <div
      class="group-chat-room"
      @bridge-terminal-resize=${(event: Event) => {
        const resizeEvent = event as BridgeTerminalResizeEvent;
        props.onTerminalResize?.(
          resizeEvent.groupId,
          resizeEvent.agentId,
          resizeEvent.cols,
          resizeEvent.rows,
        );
      }}
      @bridge-terminal-stream-update=${(event: Event) => {
        const streamEvent = event as BridgeTerminalStreamUpdateEvent;
        props.onTerminalStreamUpdate?.(streamEvent.groupId, streamEvent.agentId, streamEvent.text);
      }}
      @bridge-terminal-stream-end=${(event: Event) => {
        const endEvent = event as BridgeTerminalStreamEndEvent;
        props.onTerminalStreamEnd?.(endEvent.groupId, endEvent.agentId, endEvent.extractedText);
      }}
    >
      <div class="group-chat-room__header">
        <div class="group-chat-room__header-info">
          <span class="group-chat-room__header-name">👥 ${meta.name || meta.groupId.slice(0, 8)}</span>
          <span class="group-chat-room__header-meta">
            ${meta.members.length} ${t("chat.group.members")} · ${meta.messageMode}
          </span>
        </div>
        <div class="group-chat-room__header-actions">
          <!-- Thinking Toggle (matches single chat) -->
          <button
            class="btn btn--sm btn--icon ${props.showThinking ? "active" : ""}"
            @click=${() => props.onToggleShowThinking()}
            aria-pressed=${props.showThinking}
            title=${t("chat.thinkingToggle")}
          >
            ${icons.brain}
          </button>
          <button
            class="btn btn--sm btn--icon"
            @click=${() => props.onExportTranscript()}
            title=${t("chat.group.export")}
          >
            ${icons.download}
          </button>
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
              (m) =>
                renderGroupMessage(
                  m,
                  meta,
                  props.agentsList,
                  props.showThinking,
                  props.onOpenSidebar,
                ),
            )}

            ${Array.from(groupStreams.entries()).map(([agentId, stream]) => {
              const toolKey = `${agentId}:${stream.runId}`;
              const tools = toolMessages.get(toolKey);
              const isBridgeStream = stream.runId.startsWith("__bridge__");
              return html`
                ${renderGroupStreamBubble(
                  agentId,
                  stream,
                  meta,
                  props.agentsList,
                  tools,
                  props.showThinking,
                  props.onOpenSidebar,
                  isBridgeStream,
                  stream.frozen,
                )}
                ${isBridgeStream ? renderBridgeTerminalForAgent(agentId, meta, props) : nothing}
              `;
            })}

            ${renderOrphanBridgeTerminals(meta, props, groupStreams)}

            ${pendingOnly.map((agentId) =>
              renderPendingAgentIndicator(agentId, meta, props.agentsList),
            )}
          </div>

          <div class="chat-compose group-chat-room__compose">
            ${renderGroupAttachmentPreview(props)}
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
                        const selected = getSelectedMention(props.agentsList);
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
                    const hasGroupAttachments = (props.groupAttachments?.length ?? 0) > 0;
                    if (props.groupDraft.trim() || hasGroupAttachments) {
                      const { text, mentions } = parseMentions(props.groupDraft, meta.members, props.agentsList);
                      props.onSendMessage(text, mentions, props.groupAttachments);
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
                  @paste=${(e: ClipboardEvent) => handleGroupPaste(e, props)}
                ></textarea>
              </label>
              ${renderMentionDropdown(props.agentsList)}
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
                  ?disabled=${!props.connected || (!props.groupDraft.trim() && !hasActiveStreams && !hasPendingAgents && !props.groupAttachments?.length)}
                  @click=${() => {
                    const hasGroupAttachments = (props.groupAttachments?.length ?? 0) > 0;
                    if (props.groupDraft.trim() || hasGroupAttachments) {
                      const { text, mentions } = parseMentions(props.groupDraft, meta.members, props.agentsList);
                      props.onSendMessage(text, mentions, props.groupAttachments);
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

        ${
          sidebarOpen
            ? html`
              <div class="group-chat-room__sidebar-overlay">
                ${renderMarkdownSidebar({
                  content: props.sidebarContent ?? null,
                  error: props.sidebarError ?? null,
                  onClose: props.onCloseSidebar!,
                  onViewRawText: () => {
                    if (!props.sidebarContent || !props.onOpenSidebar) {
                      return;
                    }
                    props.onOpenSidebar(`\`\`\`\n${props.sidebarContent}\n\`\`\``);
                  },
                })}
              </div>
            `
            : nothing
        }
      </div>

      ${props.groupInfoPanelOpen ? renderGroupInfoPanel(meta, props) : nothing}
      ${props.groupAddMemberDialog ? renderAddMemberDialog(props) : nothing}
      ${props.groupRemoveMemberDialog ? renderRemoveMemberDialog(props) : nothing}
      ${renderDisbandGroupDialog(props)}
      ${renderClearMessagesDialog(props)}
      ${renderAnnouncementEditDialog(meta, props)}
    </div>
  `;
}

// ─── Message Rendering ───

function renderGroupMessage(
  msg: GroupChatMessage,
  meta: GroupSessionMeta,
  agentsList: GroupChatViewProps["agentsList"],
  showThinking = false,
  onOpenSidebar?: (content: string) => void,
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
  const isAssistant = msg.role === "assistant";
  const senderName = resolveSenderName(msg.sender, meta, agentsList);
  const senderEmoji = resolveSenderEmoji(msg.sender, meta, agentsList);
  const roleClass = isUser ? "user" : "assistant";
  const timestamp = new Date(msg.timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });

  // Extract tool cards from message
  const toolCards = extractToolCards(msg as unknown as Record<string, unknown>);
  const classified = toolCards.length > 0 ? classifyToolCards(toolCards) : null;

  // Extract thinking content for assistant messages when showThinking is enabled
  const extractedThinking = showThinking && isAssistant ? extractThinkingCached(msg) : null;
  const reasoningMarkdown = extractedThinking ? formatReasoningMarkdown(extractedThinking) : null;

  // Render markdown content with mention highlighting
  // Step 1: Strip thinking tags from assistant content (so thinking is shown separately, not inline)
  // Step 2: Handle escapes (\@ → @) before markdown processing
  // Step 3: Convert markdown to HTML
  // Step 4: Highlight @mentions in the HTML (exclude sender's own mention)
  const memberIds = meta.members.map((m) => m.agentId);
  const senderId = msg.sender.type === "agent" ? msg.sender.agentId : undefined;
  const mentionedAgents = getMentionedAgents(msg.groupId);
  const cleanContent = isAssistant ? stripThinkingTags(msg.content) : msg.content;
  const contentWithEscapes = cleanContent.replace(/\\@/g, "@");
  const markdownHtml = toSanitizedMarkdownHtml(contentWithEscapes);
  const contentHtml = highlightMentionsInHtml(markdownHtml, memberIds, senderId, mentionedAgents);

  // 渲染消息中的图片附件
  const messageImages = msg.images ?? [];
  const hasImages = messageImages.length > 0;
  const imagesHtml = hasImages
    ? html`
        <div class="chat-message-images">
          ${messageImages.map((img) => {
            const url = img.data.startsWith("data:")
              ? img.data
              : `data:${img.mimeType};base64,${img.data}`;
            return html`
              <img
                src=${url}
                alt="Attached image"
                class="chat-message-image"
              />
            `;
          })}
        </div>
      `
    : nothing;

  // 纯图片消息（content 为占位文本）时不显示文本
  const isImagePlaceholder = msg.content === "[Image attached]" && hasImages;

  return html`
    <div class="chat-group ${roleClass}">
      <div class="chat-avatar ${roleClass}">${isUser ? "U" : senderEmoji}</div>
      <div class="chat-group-messages">
        <div class="chat-bubble ${isUser ? "" : "assistant"}">
          ${
            reasoningMarkdown
              ? html`<div class="chat-thinking">${unsafeHTML(
                  toSanitizedMarkdownHtml(reasoningMarkdown),
                )}</div>`
              : nothing
          }
          ${isImagePlaceholder ? nothing : html`<div class="chat-text">${unsafeHTML(contentHtml)}</div>`}
          ${imagesHtml}
        </div>
        ${classified ? renderInlineToolCards(classified, onOpenSidebar) : nothing}
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
  stream: { runId: string; text: string; startedAt: number; frozen?: boolean },
  meta: GroupSessionMeta,
  agentsList: GroupChatViewProps["agentsList"],
  toolMessages?: GroupToolMessage[],
  showThinking = false,
  onOpenSidebar?: (content: string) => void,
  isBridgeStream = false,
  frozen = false,
) {
  const sender: { type: "agent"; agentId: string } = { type: "agent", agentId };
  const senderName = resolveSenderName(sender, meta, agentsList);
  const senderEmoji = resolveSenderEmoji(sender, meta, agentsList);
  const timestamp = new Date(stream.startedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
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
    toolCards = renderInlineToolCards(classified, onOpenSidebar);
  }

  // For streaming text, extract thinking if <think> tags are present
  const streamText = stream.text;
  let displayText = streamText;
  let streamThinkingHtml: ReturnType<typeof html> | typeof nothing = nothing;

  if (showThinking && streamText) {
    // Extract thinking from streaming text (may contain partial <think> tags)
    const thinkMatch = streamText.match(
      /<\s*think(?:ing)?\s*>([\s\S]*?)(<\s*\/\s*think(?:ing)?\s*>|$)/i,
    );
    if (thinkMatch) {
      const thinkContent = (thinkMatch[1] ?? "").trim();
      if (thinkContent) {
        const reasoningMd = formatReasoningMarkdown(thinkContent);
        streamThinkingHtml = html`<div class="chat-thinking">${unsafeHTML(
          toSanitizedMarkdownHtml(reasoningMd),
        )}</div>`;
      }
      // Strip thinking tags from displayed text
      displayText = stripThinkingTags(streamText);
    }
  } else if (streamText) {
    // Even when not showing thinking, strip thinking tags from display
    displayText = stripThinkingTags(streamText);
  }

  return html`
    <div class="chat-group assistant ${frozen ? "" : "streaming"}">
      <div class="chat-avatar assistant">${senderEmoji}</div>
      <div class="chat-group-messages">
        <div class="chat-bubble ${frozen ? "" : "streaming"}">
          ${streamThinkingHtml}
          ${
            displayText?.trim()
              ? frozen
                ? html`<div class="chat-text">${unsafeHTML(toSanitizedMarkdownHtml(displayText))}</div>`
                : html`<div class="chat-text chat-text-streaming" ${typewriter(displayText, isBridgeStream ? "line" : "char")}></div>`
              : nothing
          }
        </div>
        ${toolCards}
        <div class="chat-group-footer">
          <span class="chat-sender-name">${senderName}</span>
          ${
            frozen
              ? nothing
              : html`
              <span class="group-stream-indicator">
                <span class="group-stream-indicator__label">${t("chat.group.generating")}</span>
                <span class="group-stream-indicator__dots">
                  <span></span><span></span><span></span>
                </span>
              </span>
            `
          }
          <span class="chat-group-timestamp">${timestamp}</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render a bridge terminal for a specific agent, placed inline with its stream bubble.
 * This ensures the terminal card follows the agent's message position instead of
 * being fixed at the bottom of the message list.
 */
function renderBridgeTerminalForAgent(
  agentId: string,
  meta: GroupSessionMeta,
  props: GroupChatViewProps,
) {
  const statuses = props.bridgeTerminalStatuses;
  if (!statuses || !statuses.has(agentId)) {
    return nothing;
  }

  const member = meta.members.find(
    (m) => m.agentId === agentId && m.bridge && !isBridgeAssistantAgent(m.agentId),
  );
  if (!member) {
    return nothing;
  }

  const status = statuses.get(agentId) ?? "idle";
  const senderName = resolveSenderName(
    { type: "agent", agentId },
    meta,
    props.agentsList,
  );
  const senderEmoji = resolveSenderEmoji(
    { type: "agent", agentId },
    meta,
    props.agentsList,
  );

  return html`
    <div class="chat-group assistant">
      <div class="chat-avatar assistant">${senderEmoji}</div>
      <div class="chat-group-messages">
        <bridge-terminal
          .groupId=${meta.groupId}
          .agentId=${agentId}
          .cliType=${member.bridge?.cliType ?? "custom"}
          .status=${status}
          .replayBuffer=${props.bridgeTerminalReplayBuffers?.get(agentId)}
          .tailTrimMarker=${member.bridge?.tailTrimMarker ?? ""}
        ></bridge-terminal>
        <div class="chat-group-footer">
          <span class="chat-sender-name">${senderName}</span>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render bridge terminals for agents that have an active terminal status
 * but do NOT have a corresponding stream bubble in groupStreams.
 * These "orphan" terminals need to be rendered independently (e.g. when
 * the terminal just started and no stream text has been emitted yet).
 */
function renderOrphanBridgeTerminals(
  meta: GroupSessionMeta,
  props: GroupChatViewProps,
  groupStreams: Map<string, { runId: string; text: string; startedAt: number; frozen?: boolean }>,
) {
  const statuses = props.bridgeTerminalStatuses;
  if (!statuses || statuses.size === 0) {
    return nothing;
  }

  const bridgeMembers = meta.members.filter((m) => m.bridge && !isBridgeAssistantAgent(m.agentId));

  if (bridgeMembers.length === 0) {
    return nothing;
  }

  // Only render terminals for agents that don't already have a bridge stream bubble
  // (those are rendered inline with their stream bubble via renderBridgeTerminalForAgent)
  const orphanMembers = bridgeMembers.filter((m) => {
    if (!statuses.has(m.agentId)) {
      return false;
    }
    const stream = groupStreams.get(m.agentId);
    // If there's a bridge stream for this agent, the terminal is already rendered inline
    if (stream && stream.runId.startsWith("__bridge__")) {
      return false;
    }
    return true;
  });

  if (orphanMembers.length === 0) {
    return nothing;
  }

  return orphanMembers.map((m) => renderBridgeTerminalForAgent(m.agentId, meta, props));
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
  // Render announcement content as markdown if available
  const announcementHtml = meta.announcement ? toSanitizedMarkdownHtml(meta.announcement) : null;

  return html`
    <div class="group-members-panel">
      <!-- Announcement section (display only) -->
      <div class="group-members-panel__announcement">
        <div class="group-members-panel__announcement-header">
          <span class="group-members-panel__announcement-title">${t("chat.group.announcement")}</span>
        </div>
        <div class="group-members-panel__announcement-content">
          ${
            announcementHtml
              ? html`<div class="group-members-panel__announcement-md">${unsafeHTML(announcementHtml)}</div>`
              : html`<span class="group-members-panel__announcement-empty">${t("chat.group.noAnnouncement")}</span>`
          }
        </div>
      </div>

      <!-- Member list header -->
      <div class="group-members-panel__header">
        <div class="group-members-panel__header-left">
          <h3>${t("chat.group.memberList")}</h3>
          <span class="group-members-panel__count">${meta.members.filter((m) => !isBridgeAssistantAgent(m.agentId)).length}</span>
        </div>
      </div>

      <!-- Member list (excluding bridge-assistants) -->
      <ul class="group-members-panel__list">
        ${meta.members
          .filter((m) => !isBridgeAssistantAgent(m.agentId))
          .map((m) => {
            const displayName = resolveAgentName(m.agentId, props.agentsList);
            const showId = displayName !== m.agentId;
            const roleLabel = m.bridge ? "bridge" : m.role;
            const canRemove = m.role !== "assistant";
            return html`
              <li class="group-members-panel__item">
                <span class="group-members-panel__emoji">
                  ${resolveSenderEmoji({ type: "agent", agentId: m.agentId }, meta, props.agentsList)}
                </span>
                <span class="group-members-panel__text">
                  <span class="group-members-panel__name">${displayName}</span>
                  ${showId ? html`<span class="group-members-panel__id">@${m.agentId}</span>` : nothing}
                </span>
                <span class="group-members-panel__role badge badge--${roleLabel}">${roleLabel}</span>
                ${
                  canRemove
                    ? html`
                        <button
                          class="btn btn--sm btn--icon group-members-panel__remove-btn"
                          @click=${() => props.onOpenRemoveMemberDialog(m.agentId, displayName)}
                          title=${t("chat.group.removeMember")}
                        >
                          ${icons.x}
                        </button>
                      `
                    : nothing
                }
              </li>
            `;
          })}
      </ul>
    </div>
  `;
}

// ─── Announcement Edit Dialog ───

function renderAnnouncementEditDialog(meta: GroupSessionMeta, props: GroupChatViewProps) {
  const editor = props.announcementEditor;
  if (!editor.open) {
    return nothing;
  }

  const previewHtml = editor.draft.trim() ? toSanitizedMarkdownHtml(editor.draft) : "";

  return html`
    <div class="modal-overlay" role="dialog" aria-modal="true"
      @click=${(e: Event) => {
        if ((e.target as HTMLElement).classList.contains("modal-overlay")) {
          props.onCloseAnnouncementEditor();
        }
      }}
    >
      <div class="modal-card announcement-edit-dialog">
        <div class="modal-header announcement-edit-dialog__header">
          <h3 class="modal-title">${t("chat.group.announcement")}</h3>
          <div class="announcement-edit-dialog__tabs">
            <button
              class="btn ${!editor.preview ? "btn--primary" : ""}"
              @click=${() => props.onAnnouncementEditorTogglePreview(false)}
            >
              ${icons.edit} ${t("action.edit")}
            </button>
            <button
              class="btn ${editor.preview ? "btn--primary" : ""}"
              @click=${() => props.onAnnouncementEditorTogglePreview(true)}
            >
              ${icons.fileText} ${t("action.preview")}
            </button>
          </div>
        </div>
        <div class="announcement-edit-dialog__body">
          ${
            editor.preview
              ? html`
                <div class="announcement-edit-dialog__preview">
                  ${
                    previewHtml
                      ? html`<div class="chat-text">${unsafeHTML(previewHtml)}</div>`
                      : html`<span class="group-members-panel__announcement-empty">${t("chat.group.noAnnouncement")}</span>`
                  }
                </div>
              `
              : html`
                <textarea
                  class="announcement-edit-dialog__textarea"
                  .value=${editor.draft}
                  @input=${(e: Event) => {
                    props.onAnnouncementEditorDraftChange((e.target as HTMLTextAreaElement).value);
                  }}
                  placeholder=${t("chat.group.announcementPlaceholder")}
                ></textarea>
                <div class="announcement-edit-dialog__hint">
                  ${t("chat.group.announcementMarkdownHint")}
                </div>
              `
          }
        </div>
        <div class="announcement-edit-dialog__actions">
          <button
            class="btn btn--secondary"
            @click=${() => props.onCloseAnnouncementEditor()}
          >
            ${t("action.cancel")}
          </button>
          <button
            class="btn btn--primary"
            @click=${() => {
              props.onUpdateAnnouncement(editor.draft.trim());
              props.onCloseAnnouncementEditor();
            }}
          >
            ${t("action.save")}
          </button>
        </div>
      </div>
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
              <option value="unicast" ?selected=${meta.messageMode === "unicast"}>${t("chat.group.messageMode.unicast")}</option>
              <option value="broadcast" ?selected=${meta.messageMode === "broadcast"}>${t("chat.group.messageMode.broadcast")}</option>
            </select>
            <span class="group-info-panel__mode-desc ${meta.messageMode === "broadcast" ? "group-info-panel__mode-desc--warn" : ""}">
              ${meta.messageMode === "unicast" ? t("chat.group.messageMode.unicastDesc") : t("chat.group.messageMode.broadcastDesc")}
            </span>
          </div>
        </div>

        <!-- Announcement (edit button opens modal) -->
        <div class="group-info-panel__section">
          <label>${t("chat.group.announcement")}</label>
          <div class="group-info-panel__editable">
            <button
              class="btn btn--secondary btn--sm"
              @click=${() => props.onOpenAnnouncementEditor()}
            >
              ${icons.edit} ${meta.announcement ? t("action.edit") : t("action.add")}
            </button>
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
            <div class="group-info-panel__setting-item">
              <div class="group-info-panel__setting-header">
                <span class="group-info-panel__setting-name">${t("chat.group.maxRounds")}</span>
                <input
                  type="number"
                  class="field group-info-panel__setting-input"
                  .value=${String(meta.maxRounds)}
                  min="1"
                  max="100"
                  @change=${(e: Event) => {
                    const value = parseInt((e.target as HTMLInputElement).value, 10);
                    if (!isNaN(value) && value > 0) {
                      props.onUpdateMaxRounds(value);
                    }
                  }}
                />
              </div>
              <span class="group-info-panel__setting-desc">${t("chat.group.maxRoundsHint")}</span>
            </div>
            <div class="group-info-panel__setting-item">
              <div class="group-info-panel__setting-header">
                <span class="group-info-panel__setting-name">${t("chat.group.chainTimeout")}</span>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <input
                    type="number"
                    class="field group-info-panel__setting-input"
                    style="width: 80px;"
                    .value=${String(Math.floor((meta.chainTimeout ?? (meta.messageMode === "unicast" ? 900000 : 480000)) / 60000))}
                    min="1"
                    max="30"
                    @change=${(e: Event) => {
                      const minutes = parseInt((e.target as HTMLInputElement).value, 10);
                      if (!isNaN(minutes) && minutes > 0) {
                        props.onUpdateAntiLoopConfig({ chainTimeout: minutes * 60000 });
                      }
                    }}
                  />
                  <span style="font-size: 12px; color: var(--text-secondary);">${t("chat.group.timeoutMinutes")}</span>
                </div>
              </div>
              <span class="group-info-panel__setting-desc">${t("chat.group.chainTimeoutHint")}</span>
            </div>
            <div class="group-info-panel__setting-item">
              <div class="group-info-panel__setting-header">
                <span class="group-info-panel__setting-name">${t("chat.group.cliTimeout")}</span>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <input
                    type="number"
                    class="field group-info-panel__setting-input"
                    style="width: 80px;"
                    .value=${String(Math.floor((meta.cliTimeout ?? 300000) / 60000))}
                    min="1"
                    max="10"
                    step="0.5"
                    @change=${(e: Event) => {
                      const minutes = parseFloat((e.target as HTMLInputElement).value);
                      if (!isNaN(minutes) && minutes > 0) {
                        props.onUpdateAntiLoopConfig({ cliTimeout: Math.floor(minutes * 60000) });
                      }
                    }}
                  />
                  <span style="font-size: 12px; color: var(--text-secondary);">${t("chat.group.timeoutMinutes")}</span>
                </div>
              </div>
              <span class="group-info-panel__setting-desc">${t("chat.group.cliTimeoutHint")}</span>
            </div>
          </div>
        </div>

        <!-- Project Configuration -->
        <div class="group-info-panel__section">
          <label>${t("chat.group.projectConfiguration")}</label>
          <div class="group-info-panel__settings">
            <div class="group-info-panel__setting-item">
              <div class="group-info-panel__setting-header">
                <span class="group-info-panel__setting-name">${t("chat.group.projectDirectory")}</span>
              </div>
              ${
                meta.project?.directory
                  ? html`
                  <div class="mono" style="font-size: 12px; padding: 4px 0; display: flex; align-items: center; gap: 6px;">
                    <span>🔒</span>
                    <span>${meta.project.directory}</span>
                  </div>
                  <span class="group-info-panel__setting-desc">${t("chat.group.projectDirectoryLockedDesc")}</span>
                `
                  : html`
                      <span class="group-info-panel__setting-desc muted">${t("chat.group.projectDirectoryNotConfigured")}</span>
                    `
              }
            </div>
            <div class="group-info-panel__setting-item">
              <div class="group-info-panel__setting-header">
                <span class="group-info-panel__setting-name">${t("chat.group.projectDocs")}</span>
              </div>
              <div style="display: flex; flex-direction: column; gap: 4px;">
                ${(meta.project?.docs ?? []).map(
                  (doc, idx) => html`
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <span class="mono" style="font-size: 12px; flex: 1;">${doc}</span>
                      <button
                        class="btn btn--sm btn--icon"
                        style="padding: 2px;"
                        title=${t("action.remove")}
                        @click=${() => {
                          const updated = [...(meta.project?.docs ?? [])];
                          updated.splice(idx, 1);
                          props.onUpdateProjectDocs(updated);
                        }}
                      >${icons.x}</button>
                    </div>
                  `,
                )}
                <div style="display: flex; gap: 6px; margin-top: 4px;">
                  <input
                    type="text"
                    class="field"
                    style="font-size: 12px; flex: 1;"
                    placeholder="path/to/doc.md"
                    id="project-doc-input"
                    @keydown=${(e: KeyboardEvent) => {
                      if (e.key === "Enter") {
                        const input = e.target as HTMLInputElement;
                        const val = input.value.trim();
                        if (val) {
                          props.onUpdateProjectDocs([...(meta.project?.docs ?? []), val]);
                          input.value = "";
                        }
                      }
                    }}
                  />
                  <button
                    class="btn btn--sm btn--secondary"
                    @click=${() => {
                      const input = document.getElementById(
                        "project-doc-input",
                      ) as HTMLInputElement | null;
                      if (input && input.value.trim()) {
                        props.onUpdateProjectDocs([
                          ...(meta.project?.docs ?? []),
                          input.value.trim(),
                        ]);
                        input.value = "";
                      }
                    }}
                  >+ ${t("action.add")}</button>
                </div>
              </div>
              <span class="group-info-panel__setting-desc">${t("chat.group.projectDocsDesc")}</span>
            </div>
          </div>
        </div>

        <!-- Context Configuration -->
        <div class="group-info-panel__section">
          <label>${t("chat.group.contextConfiguration")}</label>
          <div class="group-info-panel__settings">
            <div class="group-info-panel__setting-item">
              <div class="group-info-panel__setting-header">
                <span class="group-info-panel__setting-name">${t("chat.group.maxMessages")}</span>
                <input
                  type="number"
                  class="field group-info-panel__setting-input"
                  .value=${String(meta.contextConfig?.maxMessages ?? 30)}
                  min="5"
                  max="100"
                  @change=${(e: Event) => {
                    const value = parseInt((e.target as HTMLInputElement).value, 10);
                    if (!isNaN(value) && value >= 5 && value <= 100) {
                      props.onUpdateContextConfig({
                        ...meta.contextConfig,
                        maxMessages: value,
                      });
                    }
                  }}
                />
              </div>
              <span class="group-info-panel__setting-desc">${t("chat.group.maxMessagesDesc")}</span>
            </div>
            <div class="group-info-panel__setting-item">
              <div class="group-info-panel__setting-header">
                <span class="group-info-panel__setting-name">${t("chat.group.maxCharacters")}</span>
                <input
                  type="number"
                  class="field group-info-panel__setting-input"
                  .value=${String(meta.contextConfig?.maxCharacters ?? 50000)}
                  min="10000"
                  max="200000"
                  step="5000"
                  @change=${(e: Event) => {
                    const value = parseInt((e.target as HTMLInputElement).value, 10);
                    if (!isNaN(value) && value >= 10000 && value <= 200000) {
                      props.onUpdateContextConfig({
                        ...meta.contextConfig,
                        maxCharacters: value,
                      });
                    }
                  }}
                />
              </div>
              <span class="group-info-panel__setting-desc">${t("chat.group.maxCharactersDesc")}</span>
            </div>
            <div class="group-info-panel__setting-item">
              <div class="group-info-panel__setting-header">
                <span class="group-info-panel__setting-name">${t("chat.group.includeSystemMessages")}</span>
                <input
                  type="checkbox"
                  .checked=${meta.contextConfig?.includeSystemMessages ?? false}
                  @change=${(e: Event) => {
                    props.onUpdateContextConfig({
                      ...meta.contextConfig,
                      includeSystemMessages: (e.target as HTMLInputElement).checked,
                    });
                  }}
                />
              </div>
              <span class="group-info-panel__setting-desc">${t("chat.group.includeSystemMessagesDesc")}</span>
            </div>
          </div>
        </div>

        <!-- Danger Zone -->
        <div class="group-info-panel__section group-info-panel__section--danger">
          <label>${t("chat.group.dangerZone")}</label>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <button
              class="btn btn--danger btn--sm"
              @click=${() => props.onOpenClearMessagesDialog()}
            >
              ${icons.trash} ${t("chat.group.clearMessages")}
            </button>
            <button
              class="btn btn--danger btn--sm"
              @click=${() => props.onOpenDisbandDialog()}
            >
              ${icons.trash} ${t("chat.group.disband")}
            </button>
          </div>
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
            <div class="modal-title">${t("chat.group.disband")}</div>
            <div class="modal-subtitle">${dialog.groupName}</div>
          </div>
        </div>

        <div class="modal-body">
          <div class="warning-box">
            <div class="warning-box__icon">${icons.alertTriangle}</div>
            <div class="warning-box__content">
              <div class="warning-box__title">${t("chat.sidebar.deleteWarningTitle")}</div>
              <div class="warning-box__text">${t("chat.group.disbandConfirmDetail")}</div>
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
            ${t("common.cancel")}
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
                  <span>${t("chat.group.disbanding")}</span>
                `
                : html`<span>${t("chat.group.disband")}</span>`
            }
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── Clear Messages Dialog ───

function renderClearMessagesDialog(props: GroupChatViewProps) {
  const dialog = props.groupClearMessagesDialog;
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
            <div class="modal-title">${t("chat.group.clearMessages")}</div>
            <div class="modal-subtitle">${dialog.groupName}</div>
          </div>
        </div>

        <div class="modal-body">
          <div class="warning-box">
            <div class="warning-box__icon">${icons.alertTriangle}</div>
            <div class="warning-box__content">
              <div class="warning-box__title">${t("chat.sidebar.deleteWarningTitle")}</div>
              <div class="warning-box__text">${t("chat.group.clearMessagesConfirmDetail")}</div>
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
            ?disabled=${dialog.isClearing}
            @click=${() => props.onCloseClearMessagesDialog()}
          >
            ${t("common.cancel")}
          </button>
          <button
            class="btn btn--danger"
            ?disabled=${dialog.isClearing}
            @click=${() => props.onConfirmClearMessages()}
          >
            ${
              dialog.isClearing
                ? html`
                  <span class="btn__spinner">${icons.loader}</span>
                  <span>${t("chat.group.clearing")}</span>
                `
                : html`<span>${t("chat.group.clearMessages")}</span>`
            }
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── Create Dialog ───

/**
 * Validate project directory path.
 * Checks if the directory exists via backend RPC.
 */
async function validateProjectDirectory(
  props: GroupChatViewProps,
  dialog: NonNullable<GroupChatViewProps["groupCreateDialog"]>,
): Promise<void> {
  const dirPath = dialog.projectDirectory.trim();
  if (!dirPath) {
    // Empty = optional, no error
    dialog.directoryError = undefined;
    return;
  }

  if (!props.onValidatePaths) {
    // No validator available, clear error
    dialog.directoryError = undefined;
    return;
  }

  try {
    const results = await props.onValidatePaths([dirPath], "directory");
    const result = results[0];
    if (!result) {
      dialog.directoryError = undefined;
      return;
    }

    if (!result.exists) {
      dialog.directoryError = t("chat.group.error.directoryNotFound");
    } else if (result.error) {
      dialog.directoryError = result.error;
    } else {
      dialog.directoryError = undefined;
    }
  } catch (err) {
    dialog.directoryError = String(err);
  }
}

/**
 * Validate project docs paths.
 * Checks if each file exists via backend RPC.
 */
async function validateProjectDocs(
  props: GroupChatViewProps,
  dialog: NonNullable<GroupChatViewProps["groupCreateDialog"]>,
): Promise<void> {
  const docsValue = dialog.projectDocs.trim();
  if (!docsValue) {
    // Empty = optional, no error
    dialog.docsError = undefined;
    return;
  }

  const paths = docsValue
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (paths.length === 0) {
    dialog.docsError = undefined;
    return;
  }

  if (!props.onValidatePaths) {
    // No validator available, clear error
    dialog.docsError = undefined;
    return;
  }

  try {
    const results = await props.onValidatePaths(paths, "file");
    const missingFiles: string[] = [];
    const errorFiles: string[] = [];

    for (const result of results) {
      if (!result.exists) {
        missingFiles.push(result.path);
      } else if (result.error) {
        errorFiles.push(`${result.path}: ${result.error}`);
      }
    }

    if (missingFiles.length > 0) {
      dialog.docsError = t("chat.group.error.fileNotFound", { files: missingFiles.join(", ") });
    } else if (errorFiles.length > 0) {
      dialog.docsError = errorFiles.join("; ");
    } else {
      dialog.docsError = undefined;
    }
  } catch (err) {
    dialog.docsError = String(err);
  }
}

/** Check if dialog has any validation errors */
function hasValidationErrors(
  dialog: NonNullable<GroupChatViewProps["groupCreateDialog"]>,
): boolean {
  return !!(dialog.directoryError || dialog.docsError);
}

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
              ${props.agentsList.map((agent) => {
                const selected = dialog.selectedAgents.find((s) => s.agentId === agent.id);
                // Get or compute default role: first checked = assistant, others = member
                const pendingRole = dialog.pendingRoles[agent.id];
                const defaultRole = dialog.selectedAgents.length === 0 ? "assistant" : "member";
                const currentRole = selected?.role ?? pendingRole ?? defaultRole;

                return html`
                    <label class="group-create__agent-option">
                      <input
                        type="checkbox"
                        .checked=${Boolean(selected)}
                        @change=${(e: Event) => {
                          const checked = (e.target as HTMLInputElement).checked;
                          if (checked) {
                            // Use the current role from dropdown (if set) or compute default
                            const role =
                              dialog.pendingRoles[agent.id] ??
                              (dialog.selectedAgents.length === 0 ? "assistant" : "member");
                            dialog.selectedAgents = [
                              ...dialog.selectedAgents,
                              { agentId: agent.id, role },
                            ];
                            // Clear pending role since it's now selected
                            delete dialog.pendingRoles[agent.id];
                          } else {
                            // Save current role to pending before removing
                            const existing = dialog.selectedAgents.find(
                              (s) => s.agentId === agent.id,
                            );
                            if (existing) {
                              dialog.pendingRoles[agent.id] = existing.role;
                            }
                            dialog.selectedAgents = dialog.selectedAgents.filter(
                              (s) => s.agentId !== agent.id,
                            );
                          }
                        }}
                      />
                      <span class="group-create__agent-emoji">${agent.identity?.emoji ?? "🤖"}</span>
                      <span class="group-create__agent-name">${agent.identity?.name ?? agent.id}</span>
                      <!-- Role dropdown always visible -->
                      <select
                        class="field group-create__role-select ${selected ? "" : "group-create__role-select--unselected"}"
                        style="margin-left: auto; width: auto; min-width: 120px; font-size: 12px; padding: 2px 6px;"
                        .value=${currentRole}
                        @click=${(e: Event) => e.stopPropagation()}
                        @change=${(e: Event) => {
                          const role = (e.target as HTMLSelectElement).value as
                            | "assistant"
                            | "member"
                            | "bridge-assistant";

                          if (selected) {
                            // Already selected: update immediately
                            dialog.selectedAgents = dialog.selectedAgents.map((s) =>
                              s.agentId === agent.id ? { ...s, role } : s,
                            );
                          } else {
                            // Not selected: save to pending roles
                            dialog.pendingRoles[agent.id] = role;
                          }
                        }}
                      >
                        <option value="assistant" ?selected=${currentRole === "assistant"}>${t("chat.group.role.assistant")}</option>
                        <option value="member" ?selected=${currentRole === "member"}>${t("chat.group.role.member")}</option>
                        <option value="bridge-assistant" ?selected=${currentRole === "bridge-assistant"}>${t("chat.group.role.cliAssistant")}</option>
                      </select>
                    </label>
                  `;
              })}
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
          <!-- Project Configuration (optional) -->
          <div class="form-field group-create__field ${dialog.directoryError ? "group-create__field--error" : ""}">
            <label class="group-create__label">${t("chat.group.projectDirectory")}</label>
            <input
              type="text"
              class="field group-create__input"
              placeholder="/home/user/my-project"
              .value=${dialog.projectDirectory}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  // Trigger validation on Enter
                  void validateProjectDirectory(props, dialog);
                }
              }}
              @blur=${() => {
                // Trigger validation on blur
                void validateProjectDirectory(props, dialog);
              }}
              @input=${(e: Event) => {
                dialog.projectDirectory = (e.target as HTMLInputElement).value;
                // Clear error when user types
                dialog.directoryError = undefined;
              }}
            />
            <span class="group-create__hint">${t("chat.group.projectDirectoryHint")}</span>
            ${dialog.directoryError ? html`<span class="group-create__error">${dialog.directoryError}</span>` : nothing}
          </div>
          <div class="form-field group-create__field ${dialog.docsError ? "group-create__field--error" : ""}">
            <label class="group-create__label">${t("chat.group.projectDocs")}</label>
            <input
              type="text"
              class="field group-create__input"
              placeholder="README.md, docs/architecture.md"
              .value=${dialog.projectDocs}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  // Trigger validation on Enter
                  void validateProjectDocs(props, dialog);
                }
              }}
              @blur=${() => {
                // Trigger validation on blur
                void validateProjectDocs(props, dialog);
              }}
              @input=${(e: Event) => {
                dialog.projectDocs = (e.target as HTMLInputElement).value;
                // Clear error when user types
                dialog.docsError = undefined;
              }}
            />
            <span class="group-create__hint">${t("chat.group.projectDocsHint")}</span>
            ${dialog.docsError ? html`<span class="group-create__error">${dialog.docsError}</span>` : nothing}
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
            ?disabled=${dialog.isBusy || dialog.selectedAgents.length < 1 || hasValidationErrors(dialog)}
            @click=${() => {
              const project: { directory?: string; docs?: string[] } = {};
              if (dialog.projectDirectory.trim()) {
                project.directory = dialog.projectDirectory.trim();
              }
              if (dialog.projectDocs.trim()) {
                project.docs = dialog.projectDocs
                  .split(",")
                  .map((d) => d.trim())
                  .filter(Boolean);
              }
              props.onCreateGroup({
                name: dialog.name || undefined,
                members: dialog.selectedAgents,
                messageMode: dialog.messageMode,
                ...(project.directory || project.docs ? { project } : {}),
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
                  ${availableAgents.map((agent) => {
                    const selected = dialog.selectedAgents.find((s) => s.agentId === agent.id);
                    // Get or compute default role: member (default for add member dialog)
                    const pendingRole = dialog.pendingRoles[agent.id];
                    const currentRole = selected?.role ?? pendingRole ?? "member";

                    return html`
                      <label class="group-create__agent-option">
                        <input
                          type="checkbox"
                          .checked=${Boolean(selected)}
                          @change=${(e: Event) => {
                            const checked = (e.target as HTMLInputElement).checked;
                            if (checked) {
                              // Use the current role from dropdown (if set) or default to member
                              const role = dialog.pendingRoles[agent.id] ?? "member";
                              dialog.selectedAgents = [
                                ...dialog.selectedAgents,
                                { agentId: agent.id, role },
                              ];
                              // Clear pending role since it's now selected
                              delete dialog.pendingRoles[agent.id];
                            } else {
                              // Save current role to pending before removing
                              const existing = dialog.selectedAgents.find(
                                (s) => s.agentId === agent.id,
                              );
                              if (existing) {
                                dialog.pendingRoles[agent.id] = existing.role;
                              }
                              dialog.selectedAgents = dialog.selectedAgents.filter(
                                (s) => s.agentId !== agent.id,
                              );
                            }
                          }}
                        />
                        <span class="group-create__agent-emoji">${agent.identity?.emoji ?? "🤖"}</span>
                        <span class="group-create__agent-name">${agent.identity?.name ?? agent.id}</span>
                        <!-- Role dropdown always visible -->
                        <select
                          class="field group-create__role-select ${selected ? "" : "group-create__role-select--unselected"}"
                          style="margin-left: auto; width: auto; min-width: 120px; font-size: 12px; padding: 2px 6px;"
                          .value=${currentRole}
                          @click=${(e: Event) => e.stopPropagation()}
                          @change=${(e: Event) => {
                            const role = (e.target as HTMLSelectElement).value as
                              | "member"
                              | "bridge-assistant";

                            if (selected) {
                              // Already selected: update immediately
                              dialog.selectedAgents = dialog.selectedAgents.map((s) =>
                                s.agentId === agent.id ? { ...s, role } : s,
                              );
                            } else {
                              // Not selected: save to pending roles
                              dialog.pendingRoles[agent.id] = role;
                            }
                          }}
                        >
                          <option value="member" ?selected=${currentRole === "member"}>${t("chat.group.role.member")}</option>
                          <option value="bridge-assistant" ?selected=${currentRole === "bridge-assistant"}>${t("chat.group.role.cliAssistant")}</option>
                        </select>
                      </label>
                    `;
                  })}
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

// ─── Remove Member Dialog ───

function renderRemoveMemberDialog(props: GroupChatViewProps) {
  const dialog = props.groupRemoveMemberDialog;
  if (!dialog) {
    return nothing;
  }

  return html`
    <div class="modal-overlay" role="dialog" aria-modal="true"
      @click=${(e: Event) => {
        if ((e.target as HTMLElement).classList.contains("modal-overlay")) {
          props.onCloseRemoveMemberDialog();
        }
      }}
    >
      <div class="modal-card">
        <div class="modal-header">
          <h3 class="modal-title">${t("chat.group.removeMember")}</h3>
        </div>
        <div class="modal-body">
          <p>${t("chat.group.removeMemberConfirm", { name: dialog.agentName })}</p>
          ${dialog.error ? html`<div class="modal-error">${dialog.error}</div>` : nothing}
        </div>
        <div class="modal-actions">
          <button
            class="btn btn--secondary"
            @click=${() => props.onCloseRemoveMemberDialog()}
            ?disabled=${dialog.isBusy}
          >
            ${t("action.cancel")}
          </button>
          <button
            class="btn btn--danger"
            ?disabled=${dialog.isBusy}
            @click=${() => props.onRemoveMember(dialog.agentId)}
          >
            ${dialog.isBusy ? html`<span class="btn__spinner">${icons.loader}</span>` : nothing}
            ${t("action.remove")}
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
  agentsList?: GroupChatViewProps["agentsList"],
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
      // Find member by agentId or by display name
      const member = members.find((m) => m.agentId === name) ??
        (agentsList ? members.find((m) => {
          const displayName = resolveAgentName(m.agentId, agentsList);
          return displayName === name;
        }) : undefined);
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

function renderMentionDropdown(agentsList: GroupChatViewProps["agentsList"]) {
  if (!mentionDropdownState.visible) {
    return nothing;
  }

  // Always show @all option plus filtered members
  const displayItems = getDisplayItems(mentionDropdownState.members).filter(
    (m) => m.agentId.toLowerCase().includes(mentionDropdownState.filter) || m.agentId === "all" ||
      resolveAgentName(m.agentId, agentsList).toLowerCase().includes(mentionDropdownState.filter),
  );

  if (displayItems.length === 0) {
    return nothing;
  }

  return html`
    <div class="mention-dropdown">
      ${displayItems.map(
        (m, i) => {
          const name = m.agentId === "all" ? "全体成员" : resolveAgentName(m.agentId, agentsList);
          const agentEntry = m.agentId !== "all" ? agentsList.find((a) => a.id === m.agentId) : null;
          const emoji = m.agentId === "all" ? "👥" : (agentEntry?.identity?.emoji ?? "🤖");
          return html`
            <div
              class="mention-item ${i === mentionDropdownState.selectedIndex ? "mention-item--selected" : ""}"
              @click=${() => {
                if (mentionDropdownState.onSelect) {
                  mentionDropdownState.onSelect(m.agentId, name);
                }
                hideMentionDropdown();
              }}
              @mouseenter=${() => {
                mentionDropdownState.selectedIndex = i;
              }}
            >
              <span class="mention-item__emoji">${emoji}</span>
              <span class="mention-item__name">${name}</span>
              ${m.agentId !== "all" ? html`<span class="mention-item__role badge badge--${m.role}">${m.role}</span>` : nothing}
            </div>
          `;
        },
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
 * Avoids replacing inside HTML tags or attributes, and excludes sender's own mention.
 */
/**
 * Highlight @mentions in HTML content.
 * Only highlights agents that have been triggered (in highlightIds).
 * If highlightIds is empty, falls back to highlighting all valid members.
 */
function highlightMentionsInHtml(
  html: string,
  memberIds: string[],
  excludeId?: string,
  highlightIds?: string[],
): string {
  if (!memberIds.length) {
    return html;
  }

  // Determine which IDs to highlight
  // If highlightIds is provided, only highlight those that are also valid members
  // Otherwise, highlight all valid members (backward compatibility)
  const idsToHighlight =
    highlightIds && highlightIds.length > 0
      ? highlightIds.filter((id) => memberIds.includes(id))
      : memberIds;

  if (!idsToHighlight.length) {
    return html;
  }

  // Sort by length descending to match longer IDs first
  const sortedIds = [...idsToHighlight].toSorted((a, b) => b.length - a.length);

  // Process each member ID
  let result = html;
  for (const agentId of sortedIds) {
    // Skip highlighting sender's own mention
    if (agentId === excludeId) {
      continue;
    }
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
