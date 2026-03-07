/**
 * Group Chat — Frontend Controller
 *
 * Handles all group.* RPC calls and group chat state management.
 * Follows the same patterns as controllers/chat.ts.
 */

import type { GatewayBrowserClient } from "../gateway.ts";

// ─── Types ───

export type GroupMember = {
  agentId: string;
  role: "assistant" | "member";
  joinedAt: number;
};

export type GroupMemberRolePrompt = {
  agentId: string;
  rolePrompt: string;
  updatedAt: number;
};

export type GroupSessionMeta = {
  groupId: string;
  name: string;
  members: GroupMember[];
  memberRolePrompts: GroupMemberRolePrompt[];
  messageMode: "unicast" | "broadcast";
  announcement: string;
  groupSkills: string[];
  maxRounds: number;
  maxConsecutive: number;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
};

export type GroupIndexEntry = {
  groupId: string;
  name: string;
  memberCount: number;
  messageMode: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
};

export type GroupMessageSender =
  | { type: "owner" }
  | { type: "agent"; agentId: string }
  | { type: "system" };

export type GroupChatMessage = {
  id: string;
  groupId: string;
  role: "user" | "assistant" | "system";
  content: string;
  sender: GroupMessageSender;
  mentions?: string[];
  agentRunId?: string;
  serverSeq: number;
  timestamp: number;
};

export type GroupStreamPayload = {
  groupId: string;
  agentId: string;
  runId: string;
  state: "delta" | "final" | "error" | "aborted";
  content?: string; // delta text (backend field name)
  text?: string; // alias for content (frontend compatibility)
  errorMessage?: string;
};

export type GroupSystemPayload = {
  groupId: string;
  action: string;
  data?: unknown;
};

// ─── State ───

export type GroupChatState = {
  /** Currently viewed group ID, null if not in group chat view */
  activeGroupId: string | null;
  /** Loaded group metadata */
  activeGroupMeta: GroupSessionMeta | null;
  /** Group chat messages */
  groupMessages: GroupChatMessage[];
  /** Active agent streams (agentId → current text) */
  groupStreams: Map<string, { runId: string; text: string; startedAt: number }>;
  /** Agents that are pending response (waiting for first stream delta) */
  groupPendingAgents: Set<string>;
  /** Group list for sidebar */
  groupIndex: GroupIndexEntry[];
  /** Loading states */
  groupListLoading: boolean;
  groupChatLoading: boolean;
  groupSending: boolean;
  /** Draft message */
  groupDraft: string;
  /** Error state */
  groupError: string | null;
  /** Create dialog state */
  groupCreateDialog: GroupCreateDialogState | null;
  /** Add member dialog state */
  groupAddMemberDialog: GroupAddMemberDialogState | null;
  /** Info panel open */
  groupInfoPanelOpen: boolean;
};

export type GroupCreateDialogState = {
  name: string;
  selectedAgents: Array<{ agentId: string; role: "assistant" | "member" }>;
  messageMode: "unicast" | "broadcast";
  isBusy: boolean;
  error: string | null;
};

export type GroupAddMemberDialogState = {
  selectedAgents: Array<{ agentId: string; role: "member" }>;
  isBusy: boolean;
  error: string | null;
};

export const DEFAULT_GROUP_CHAT_STATE: GroupChatState = {
  activeGroupId: null,
  activeGroupMeta: null,
  groupMessages: [],
  groupStreams: new Map(),
  groupPendingAgents: new Set(),
  groupIndex: [],
  groupListLoading: false,
  groupChatLoading: false,
  groupSending: false,
  groupDraft: "",
  groupError: null,
  groupCreateDialog: null,
  groupAddMemberDialog: null,
  groupInfoPanelOpen: false,
};

// ─── Helpers ───

export type GroupHost = {
  client: GatewayBrowserClient | null;
  connected: boolean;
} & GroupChatState;

// ─── <<@>> Mention Detection & Auto-Forward ───

/** Mention marker pattern: <<@agentId>> */
const MENTION_MARKER_RE = /<<@(\S+?)>>/g;

/**
 * Extract mentions from the LAST LINE of a message only.
 * Mentions in the middle of text are for display purposes and do NOT trigger routing.
 */
export function extractLastLineMentions(content: string): string[] {
  const lines = content.trim().split("\n");
  const lastLine = lines[lines.length - 1] || "";
  const matches = [...lastLine.matchAll(MENTION_MARKER_RE)];
  return [...new Set(matches.map((m) => m[1]))];
}

/** Per-group chain state for forward limiting */
type ChainState = { count: number; startedAt: number };
const groupChainStates = new Map<string, ChainState>();

const MAX_CHAIN_FORWARDS = 10;
const MAX_CHAIN_DURATION_MS = 5 * 60_000; // 5 minutes

/** Reset chain state — new conversation round */
export function resetChainState(groupId: string): void {
  if (groupChainStates.has(groupId)) {
    console.log(`[group-chat] chain state reset: group=${groupId}`);
  }
  groupChainStates.delete(groupId);
}

/**
 * Detect <<@agentId>> markers in an agent's reply and auto-forward
 * the message to trigger the mentioned agents.
 *
 * IMPORTANT: Only mentions on the LAST LINE trigger routing.
 * Mentions in the middle of text are for display only.
 *
 * Called after a group.message event is received and rendered.
 */
export async function detectAndForwardMentions(
  host: GroupHost,
  message: GroupChatMessage,
): Promise<void> {
  // Only process agent messages
  if (message.sender.type !== "agent") {
    return;
  }
  if (!host.client || !host.connected || !host.activeGroupMeta) {
    return;
  }

  const meta = host.activeGroupMeta;

  // Only extract mentions from the LAST LINE
  const lastLineMentions = extractLastLineMentions(message.content);

  if (lastLineMentions.length === 0) {
    // No markers on last line → chain naturally ends
    resetChainState(message.groupId);
    return;
  }

  // Extract valid agentIds (must be current group members, exclude sender)
  const senderAgentId = message.sender.type === "agent" ? message.sender.agentId : undefined;
  const mentionedIds = [
    ...new Set(
      lastLineMentions.filter(
        (id) => id !== senderAgentId && meta.members.some((m) => m.agentId === id),
      ),
    ),
  ];

  if (mentionedIds.length === 0) {
    resetChainState(message.groupId);
    return;
  }

  // Check chain limits (count + duration)
  const chain = groupChainStates.get(message.groupId);
  const now = Date.now();

  if (chain && chain.count >= MAX_CHAIN_FORWARDS) {
    console.warn(
      `[group-chat] chain count limit: group=${message.groupId} count=${chain.count}/${MAX_CHAIN_FORWARDS}`,
    );
    appendSystemMessageToUI(
      host,
      message.groupId,
      `⚠️ Auto-forward limit reached (${MAX_CHAIN_FORWARDS} rounds). ` +
        `Agents will no longer be automatically triggered. ` +
        `Send a new message to start a fresh conversation.`,
    );
    return;
  }

  if (chain && now - chain.startedAt >= MAX_CHAIN_DURATION_MS) {
    const elapsed = Math.round((now - chain.startedAt) / 1000);
    console.warn(`[group-chat] chain duration limit: group=${message.groupId} elapsed=${elapsed}s`);
    appendSystemMessageToUI(
      host,
      message.groupId,
      `⚠️ Conversation chain timeout (exceeded ${MAX_CHAIN_DURATION_MS / 60_000} minutes). ` +
        `Auto-forwarding has been stopped. ` +
        `Send a new message to start a fresh conversation.`,
    );
    return;
  }

  // Update chain state
  const nextCount = (chain?.count ?? 0) + 1;
  groupChainStates.set(message.groupId, {
    count: nextCount,
    startedAt: chain?.startedAt ?? now,
  });

  // Replace <<@agentId>> → @agentId ONLY on the last line for the forwarded message
  // (mentions in the middle are preserved as-is for display)
  const lines = message.content.split("\n");
  if (lines.length > 0) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(MENTION_MARKER_RE, "@$1");
  }
  const forwardedText = lines.join("\n");

  console.log(
    `[group-chat] auto-forward: group=${message.groupId} from=${senderAgentId} to=[${mentionedIds.join(",")}] chain=${nextCount}/${MAX_CHAIN_FORWARDS}`,
  );

  // Forward: reuse group.send with sender set to the replying agent
  // skipTranscript: true → backend skips duplicate write + broadcast
  try {
    await host.client.request("group.send", {
      groupId: message.groupId,
      message: forwardedText,
      sender: { type: "agent", agentId: senderAgentId },
      mentions: mentionedIds,
      skipTranscript: true,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes("Chain limit") || errMsg.includes("429")) {
      console.warn(`[group-chat] backend chain limit: group=${message.groupId} err=${errMsg}`);
      appendSystemMessageToUI(
        host,
        message.groupId,
        `⚠️ Server-side chain limit reached. Auto-forwarding has been stopped. ` +
          `Send a new message to start a fresh conversation.`,
      );
    } else {
      console.error("[group-chat] forward mention failed:", err);
    }
  }
}

/** Append a local system message to the UI (not persisted to backend) */
function appendSystemMessageToUI(host: GroupChatState, groupId: string, content: string): void {
  const msg: GroupChatMessage = {
    id: `sys-chain-${Date.now()}`,
    groupId,
    role: "system",
    content,
    sender: { type: "system" },
    serverSeq: 0,
    timestamp: Date.now(),
  };
  host.groupMessages = [...host.groupMessages, msg];
}

/**
 * Predict which agents will respond to a message.
 * Mirrors the backend dispatch logic in message-dispatch.ts.
 */
function resolvePendingAgents(meta: GroupSessionMeta, mentions?: string[]): string[] {
  // Check for @all mention
  const hasAllMention = mentions?.includes("all") ?? false;

  if (hasAllMention) {
    return meta.members.map((m) => m.agentId);
  }

  const validMentions = mentions?.filter((id) => meta.members.some((m) => m.agentId === id)) ?? [];

  if (validMentions.length > 0) {
    return validMentions;
  }

  if (meta.messageMode === "unicast") {
    const assistant = meta.members.find((m) => m.role === "assistant");
    return assistant ? [assistant.agentId] : [];
  }

  // Broadcast: all members
  return meta.members.map((m) => m.agentId);
}

// ─── API Controllers ───

export async function loadGroupList(host: GroupHost): Promise<void> {
  if (!host.client || !host.connected) {
    return;
  }
  host.groupListLoading = true;
  try {
    const result = await host.client.request<GroupIndexEntry[]>("group.list");
    host.groupIndex = result ?? [];
  } catch (err) {
    host.groupError = `Failed to load groups: ${String(err)}`;
  } finally {
    host.groupListLoading = false;
  }
}

export async function loadGroupInfo(host: GroupHost, groupId: string): Promise<void> {
  if (!host.client || !host.connected) {
    return;
  }
  host.groupChatLoading = true;
  try {
    const meta = await host.client.request<GroupSessionMeta>("group.info", { groupId });
    host.activeGroupMeta = meta;
    host.activeGroupId = groupId;
  } catch (err) {
    host.groupError = `Failed to load group: ${String(err)}`;
  } finally {
    host.groupChatLoading = false;
  }
}

export async function loadGroupHistory(
  host: GroupHost,
  groupId: string,
  limit = 50,
): Promise<void> {
  if (!host.client || !host.connected) {
    return;
  }
  host.groupChatLoading = true;
  try {
    const messages = await host.client.request<GroupChatMessage[]>("group.history", {
      groupId,
      limit,
    });
    host.groupMessages = messages ?? [];
  } catch (err) {
    host.groupError = `Failed to load history: ${String(err)}`;
  } finally {
    host.groupChatLoading = false;
  }
}

export async function sendGroupMessage(
  host: GroupHost,
  groupId: string,
  message: string,
  mentions?: string[],
): Promise<void> {
  if (!host.client || !host.connected || !message.trim()) {
    return;
  }
  // Owner sends a new message → reset chain forward counter
  resetChainState(groupId);
  host.groupSending = true;
  host.groupError = null;

  // Predict which agents will respond so we can show pending indicators immediately
  const meta = host.activeGroupMeta;
  if (meta) {
    const pendingAgents = resolvePendingAgents(meta, mentions);
    if (pendingAgents.length > 0) {
      host.groupPendingAgents = new Set(pendingAgents);
    }
  }

  try {
    await host.client.request("group.send", {
      groupId,
      message: message.trim(),
      mentions: mentions?.length ? mentions : undefined,
    });
    host.groupDraft = "";
  } catch (err) {
    host.groupError = `Failed to send: ${String(err)}`;
    // Clear pending on error
    host.groupPendingAgents = new Set();
  } finally {
    host.groupSending = false;
  }
}

export async function abortGroupChat(host: GroupHost, groupId: string): Promise<void> {
  if (!host.client || !host.connected) {
    return;
  }
  try {
    await host.client.request("group.abort", { groupId });
  } catch {
    // best-effort
  }
}

export async function createGroup(
  host: GroupHost,
  opts: {
    name?: string;
    members: Array<{ agentId: string; role: "assistant" | "member" }>;
    messageMode?: "unicast" | "broadcast";
  },
): Promise<string | null> {
  if (!host.client || !host.connected) {
    return null;
  }
  const dialog = host.groupCreateDialog;
  if (dialog) {
    dialog.isBusy = true;
    dialog.error = null;
  }
  try {
    const result = await host.client.request<{ groupId: string; sessionKey: string }>(
      "group.create",
      opts,
    );
    if (dialog) {
      host.groupCreateDialog = null;
    }
    await loadGroupList(host);
    return result?.groupId ?? null;
  } catch (err) {
    if (dialog) {
      dialog.isBusy = false;
      dialog.error = String(err);
    }
    return null;
  }
}

export async function deleteGroup(host: GroupHost, groupId: string): Promise<void> {
  if (!host.client || !host.connected) {
    return;
  }
  try {
    await host.client.request("group.delete", { groupId });
    if (host.activeGroupId === groupId) {
      host.activeGroupId = null;
      host.activeGroupMeta = null;
      host.groupMessages = [];
      host.groupStreams = new Map();
    }
    await loadGroupList(host);
  } catch (err) {
    host.groupError = `Failed to delete group: ${String(err)}`;
  }
}

export async function updateGroupMembers(
  host: GroupHost,
  groupId: string,
  action: "add" | "remove",
  payload: { members?: Array<{ agentId: string }>; agentIds?: string[] },
): Promise<void> {
  if (!host.client || !host.connected) {
    return;
  }
  const dialog = host.groupAddMemberDialog;
  if (dialog) {
    dialog.isBusy = true;
    dialog.error = null;
  }
  try {
    const method = action === "add" ? "group.addMembers" : "group.removeMembers";
    await host.client.request(method, { groupId, ...payload });
    if (dialog) {
      host.groupAddMemberDialog = null;
    }
    await loadGroupInfo(host, groupId);
    await loadGroupList(host);
  } catch (err) {
    if (dialog) {
      dialog.isBusy = false;
      dialog.error = String(err);
    }
    host.groupError = `Failed to update members: ${String(err)}`;
  }
}

export async function updateGroupSettings(
  host: GroupHost,
  groupId: string,
  setting: string,
  value: unknown,
): Promise<void> {
  if (!host.client || !host.connected) {
    return;
  }
  try {
    await host.client.request(`group.${setting}`, { groupId, ...((value ?? {}) as object) });
    await loadGroupInfo(host, groupId);
  } catch (err) {
    host.groupError = `Failed to update setting: ${String(err)}`;
  }
}

// ─── Event Handlers ───

export function handleGroupMessageEvent(
  host: GroupChatState,
  payload: { groupId: string } & GroupChatMessage,
): void {
  if (payload.groupId !== host.activeGroupId) {
    return;
  }
  // Deduplicate by message id
  if (host.groupMessages.some((m) => m.id === payload.id)) {
    return;
  }
  host.groupMessages = [...host.groupMessages, payload];

  // Auto-detect <<@agentId>> markers in agent replies and forward
  if (payload.sender.type === "agent") {
    void detectAndForwardMentions(host as GroupHost, payload);
  }
}

const streamBuffers = new Map<string, string>();
let streamSyncTimer: number | null = null;

export function handleGroupStreamEvent(host: GroupChatState, payload: GroupStreamPayload): void {
  if (payload.groupId !== host.activeGroupId) {
    return;
  }

  // Handle both 'content' (backend) and 'text' (legacy frontend) fields
  const deltaText = payload.content ?? payload.text;

  if (payload.state === "delta" && typeof deltaText === "string") {
    // Empty delta means "stream started but no content yet" - keep pending indicator
    // Non-empty delta means "actual content" - switch to streaming bubble
    if (deltaText.length === 0) {
      // Empty delta: agent is still preparing, keep pending indicator
      // Don't remove from pendingAgents yet
      return;
    }

    // Non-empty delta: remove from pending and show streaming bubble
    if (host.groupPendingAgents.has(payload.agentId)) {
      const next = new Set(host.groupPendingAgents);
      next.delete(payload.agentId);
      host.groupPendingAgents = next;
    }

    // Buffer stream updates, throttle at 50ms
    // Key includes runId to distinguish concurrent runs from the same agent
    const key = `${payload.agentId}:${payload.runId}`;

    // Clean up old buffers for the same agent (if this is a new run)
    for (const [oldKey] of streamBuffers) {
      const [oldAgentId, oldRunId] = oldKey.split(":");
      if (oldAgentId === payload.agentId && oldRunId !== payload.runId) {
        streamBuffers.delete(oldKey);
      }
    }

    streamBuffers.set(key, deltaText);
    if (!streamSyncTimer) {
      streamSyncTimer = window.setTimeout(() => {
        syncGroupStreams(host);
        streamSyncTimer = null;
      }, 50);
    }
    return;
  }

  if (payload.state === "final" || payload.state === "error" || payload.state === "aborted") {
    // Remove from pending (in case we never got non-empty delta)
    if (host.groupPendingAgents.has(payload.agentId)) {
      const next = new Set(host.groupPendingAgents);
      next.delete(payload.agentId);
      host.groupPendingAgents = next;
    }
    // Remove stream entry for this specific run
    const next = new Map(host.groupStreams);
    const currentStream = next.get(payload.agentId);
    // Only remove if the runId matches (prevent removing a newer run)
    if (currentStream && currentStream.runId === payload.runId) {
      next.delete(payload.agentId);
    }
    host.groupStreams = next;
    // Clear buffer for this specific run
    streamBuffers.delete(`${payload.agentId}:${payload.runId}`);
    return;
  }
}

function syncGroupStreams(host: GroupChatState): void {
  const next = new Map(host.groupStreams);
  for (const [key, text] of streamBuffers) {
    const [agentId, runId] = key.split(":");
    if (!agentId || !runId) {
      continue;
    }

    const existing = next.get(agentId);
    // Only update if this is the same run or newer (runId is unique, so we always update)
    next.set(agentId, {
      runId,
      text,
      startedAt: existing?.startedAt ?? Date.now(),
    });
  }
  host.groupStreams = next;
}

export function handleGroupSystemEvent(host: GroupChatState, payload: GroupSystemPayload): void {
  if (payload.groupId !== host.activeGroupId) {
    return;
  }
  // System events can trigger state refreshes
  // For now, append as a system message for display
  if (payload.action === "round_limit") {
    const systemMsg: GroupChatMessage = {
      id: `sys-${Date.now()}`,
      groupId: payload.groupId,
      role: "system",
      content: `Conversation round limit reached`,
      sender: { type: "system" },
      serverSeq: 0,
      timestamp: Date.now(),
    };
    host.groupMessages = [...host.groupMessages, systemMsg];
  }
}

/** Enter a group chat view */
export async function enterGroupChat(host: GroupHost, groupId: string): Promise<void> {
  host.activeGroupId = groupId;
  host.groupMessages = [];
  host.groupStreams = new Map();
  host.groupPendingAgents = new Set();
  host.groupError = null;
  host.groupDraft = "";
  await Promise.all([loadGroupInfo(host, groupId), loadGroupHistory(host, groupId)]);
}

/** Leave group chat view */
export function leaveGroupChat(host: GroupChatState): void {
  host.activeGroupId = null;
  host.activeGroupMeta = null;
  host.groupMessages = [];
  host.groupStreams = new Map();
  host.groupPendingAgents = new Set();
  host.groupError = null;
  host.groupDraft = "";
}
