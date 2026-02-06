import { html } from "lit";
import type { SessionsListResult } from "../types.ts";
import { t } from "../i18n/index.ts";
import { icons } from "../icons.ts";

export type ChatSessionsSidebarProps = {
  open: boolean;
  sessions: SessionsListResult | null;
  currentSessionKey: string;
  loading: boolean;
  onToggle: () => void;
  onSelectSession: (sessionKey: string) => void;
  onNewSession: () => void;
};

export function renderChatSessionsSidebar(props: ChatSessionsSidebarProps) {
  return html`
    <aside class="chat-sessions-sidebar ${props.open ? "chat-sessions-sidebar--open" : ""}">
      <div class="chat-sessions-sidebar__header">
        <button
          class="chat-sessions-sidebar__toggle"
          @click=${props.onToggle}
          title="${props.open ? t("chat.sidebar.collapse") : t("chat.sidebar.expand")}"
          aria-label="${props.open ? t("chat.sidebar.collapse") : t("chat.sidebar.expand")}"
        >
          ${props.open ? icons.chevronLeft : icons.menu}
        </button>
      </div>
    </aside>
  `;
}
