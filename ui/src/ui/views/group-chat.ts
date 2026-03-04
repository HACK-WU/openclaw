/**
 * Group Chat — Main View
 *
 * Renders the group chat interface including message list,
 * active streams, and compose area.
 */

import { html, nothing } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { typewriter } from "../chat/typewriter-directive.ts";
import type {
  GroupChatMessage,
  GroupSessionMeta,
  GroupIndexEntry,
  GroupCreateDialogState,
} from "../controllers/group-chat.ts";
import { t } from "../i18n/index.ts";
import { icons } from "../icons.ts";

// ─── Props ───

export type GroupChatViewProps = {
  connected: boolean;
  // State
  activeGroupId: string | null;
  activeGroupMeta: GroupSessionMeta | null;
  groupMessages: GroupChatMessage[];
  groupStreams: Map<string, { runId: string; text: string; startedAt: number }>;
  groupIndex: GroupIndexEntry[];
  groupListLoading: boolean;
  groupChatLoading: boolean;
  groupSending: boolean;
  groupDraft: string;
  groupError: string | null;
  groupCreateDialog: GroupCreateDialogState | null;
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
  onToggleInfoPanel: () => void;
  onRefresh: () => void;
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
  const { activeGroupMeta: meta, groupMessages, groupStreams, groupSending, groupError } = props;
  if (!meta) {
    return nothing;
  }

  const hasActiveStreams = groupStreams.size > 0;

  return html`
    <div class="group-chat-room">
      <!-- Header -->
      <div class="group-chat-room__header">
        <button class="btn btn--sm btn--icon" @click=${() => props.onLeaveGroup()} title="Back">
          ${icons.arrowLeft}
        </button>
        <div class="group-chat-room__header-info">
          <span class="group-chat-room__header-name">👥 ${meta.name || meta.groupId.slice(0, 8)}</span>
          <span class="group-chat-room__header-meta">
            ${meta.members.length} ${t("chat.group.members")} · ${meta.messageMode}
          </span>
        </div>
        <button
          class="btn btn--sm btn--icon"
          @click=${() => props.onToggleInfoPanel()}
          title=${t("chat.group.info")}
        >
          ${icons.info}
        </button>
      </div>

      ${groupError ? html`<div class="group-chat-room__error">${groupError}</div>` : nothing}

      <!-- Messages -->
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

        <!-- Active Streams -->
        ${Array.from(groupStreams.entries()).map(([agentId, stream]) =>
          renderGroupStreamBubble(agentId, stream, meta, props.agentsList),
        )}
      </div>

      <!-- Compose -->
      <div class="group-chat-room__compose">
        <div class="group-chat-room__compose-input-wrap">
          <textarea
            class="group-chat-room__compose-input"
            placeholder=${t("chat.group.placeholder")}
            .value=${props.groupDraft}
            @input=${(e: Event) => props.onDraftChange((e.target as HTMLTextAreaElement).value)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (props.groupDraft.trim()) {
                  const { text, mentions } = parseMentions(props.groupDraft, meta.members);
                  props.onSendMessage(text, mentions);
                }
              }
            }}
            ?disabled=${groupSending || !props.connected}
            rows="1"
          ></textarea>
        </div>
        <div class="group-chat-room__compose-actions">
          ${
            hasActiveStreams
              ? html`
                <button class="btn btn--sm btn--danger" @click=${() => props.onAbort()}>
                  ${icons.square} ${t("chat.group.abort")}
                </button>
              `
              : html`
                <button
                  class="btn btn--sm btn--primary"
                  ?disabled=${!props.groupDraft.trim() || groupSending || !props.connected}
                  @click=${() => {
                    if (props.groupDraft.trim()) {
                      const { text, mentions } = parseMentions(props.groupDraft, meta.members);
                      props.onSendMessage(text, mentions);
                    }
                  }}
                >
                  ${groupSending ? icons.loader : icons.send} ${t("chat.group.send")}
                </button>
              `
          }
        </div>
      </div>

      <!-- Info Panel -->
      ${props.groupInfoPanelOpen ? renderGroupInfoPanel(meta, props) : nothing}
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
  const timestamp = new Date(msg.timestamp).toLocaleTimeString();

  return html`
    <div class="group-msg group-msg--${roleClass}">
      <div class="group-msg__avatar">${senderEmoji}</div>
      <div class="group-msg__body">
        <div class="group-msg__header">
          <span class="group-msg__sender">${senderName}</span>
          <span class="group-msg__time">${timestamp}</span>
        </div>
        <div class="group-msg__content">${msg.content}</div>
      </div>
    </div>
  `;
}

function renderGroupStreamBubble(
  agentId: string,
  stream: { runId: string; text: string; startedAt: number },
  meta: GroupSessionMeta,
  agentsList: GroupChatViewProps["agentsList"],
) {
  const sender: { type: "agent"; agentId: string } = { type: "agent", agentId };
  const senderName = resolveSenderName(sender, meta, agentsList);
  const senderEmoji = resolveSenderEmoji(sender, meta, agentsList);

  return html`
    <div class="group-msg group-msg--assistant group-msg--streaming">
      <div class="group-msg__avatar">${senderEmoji}</div>
      <div class="group-msg__body">
        <div class="group-msg__header">
          <span class="group-msg__sender">${senderName}</span>
          <span class="group-msg__streaming-indicator">${icons.loader}</span>
        </div>
        <div class="group-msg__content" ${typewriter(stream.text || "...")}></div>
      </div>
    </div>
  `;
}

// ─── Info Panel ───

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
        <div class="group-info-panel__section">
          <label>${t("chat.group.groupName")}</label>
          <div>${meta.name || "-"}</div>
        </div>
        <div class="group-info-panel__section">
          <label>${t("chat.group.messageMode")}</label>
          <div>${meta.messageMode}</div>
        </div>
        ${
          meta.announcement
            ? html`
              <div class="group-info-panel__section">
                <label>${t("chat.group.announcement")}</label>
                <div>${meta.announcement}</div>
              </div>
            `
            : nothing
        }
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
        <div class="group-info-panel__section">
          <label>${t("chat.group.settings")}</label>
          <div class="group-info-panel__settings">
            <span>Max rounds: ${meta.maxRounds}</span>
            <span>Max consecutive: ${meta.maxConsecutive}</span>
          </div>
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
      <div class="modal-card">
        <div class="modal-header">
          <h3 class="modal-title">${t("chat.group.createTitle")}</h3>
        </div>
        <div class="modal-body">
          <div class="form-field">
            <label>${t("chat.group.groupName")}</label>
            <input
              type="text"
              class="field"
              placeholder=${t("chat.group.namePlaceholder")}
              .value=${dialog.name}
              @input=${(e: Event) => {
                dialog.name = (e.target as HTMLInputElement).value;
              }}
            />
          </div>
          <div class="form-field">
            <label>${t("chat.group.selectAgents")}</label>
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
                    <span>${agent.identity?.emoji ?? "🤖"}</span>
                    <span>${agent.identity?.name ?? agent.id}</span>
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
          <div class="form-field">
            <label>${t("chat.group.messageMode")}</label>
            <select
              class="field"
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
        <div class="modal-actions">
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
  while ((match = mentionPattern.exec(text)) !== null) {
    const name = match[1];
    const member = members.find((m) => m.agentId === name || m.agentId.includes(name));
    if (member) {
      mentions.push(member.agentId);
    }
  }
  return { text, mentions: [...new Set(mentions)] };
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
