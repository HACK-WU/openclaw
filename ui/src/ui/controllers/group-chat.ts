/**
 * Group Chat — Frontend Controller
 *
 * Handles all group.* RPC calls and group chat state management.
 * Follows the same patterns as controllers/chat.ts.
 */

import { getBridgeTerminal } from "../components/bridge-terminal.ts";
import { stripThinkingTags } from "../format.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { ChatAttachment } from "../ui-types.ts";
import { loadSessions } from "./sessions.ts";

// ─── Types ───

export type GroupMember = {
  agentId: string;
  role: "assistant" | "member" | "bridge-assistant";
  joinedAt: number;
  /** Present when this member is a Bridge (CLI) Agent. */
  bridge?: {
    cliType: "claude-code" | "opencode" | "codebuddy" | "custom";
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    idleTimeout?: number;
    avatar?: string;
    /** Regex pattern to trim CLI prompt area from extracted text. */
    tailTrimMarker?: string;
  };
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
  /** @deprecated Removed from anti-loop mechanism, kept for backward compatibility */
  maxConsecutive?: number;
  /** Chain timeout in milliseconds (default: unicast 900000 = 15 min / broadcast 480000 = 8 min, range: 60000-1800000) */
  chainTimeout?: number;
  /** CLI execution timeout in milliseconds (default: 300000 = 5 min, range: 30000-600000) */
  cliTimeout?: number;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  /** Thinking level for all agents in this group */
  thinkingLevel?: string;
  /** Project configuration for Bridge Agents. */
  project?: {
    directory?: string;
    docs?: string[];
  };
  /** Context configuration for CLI agent interactions. */
  contextConfig?: {
    maxMessages?: number;
    maxCharacters?: number;
    includeSystemMessages?: boolean;
  };
  /** Active terminal statuses for Bridge Agents (for page refresh restoration) */
  bridgeTerminalStatuses?: Record<string, string>;
  /** Terminal replay buffers for Bridge Agents (Base64-encoded, for content restoration) */
  bridgeTerminalReplayBuffers?: Record<string, string>;
};

// Tool message for real-time display
export type GroupToolMessage = {
  id: string;
  groupId: string;
  agentId: string;
  runId: string;
  role: "tool" | "tool_call";
  content?: string;
  toolCallId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  timestamp: number;
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
  /** Image attachments included with this message (base64-encoded) */
  images?: Array<{ type: "image"; data: string; mimeType: string }>;
};

export type BridgeTerminalStatus =
  | "idle"
  | "working"
  | "ready"
  | "completed"
  | "timeout"
  | "error"
  | "disconnected";

export type GroupStreamEntry = {
  runId: string;
  text: string;
  startedAt: number;
  timelineOrder: number;
};

export type GroupBridgeSnapshot = {
  id: string;
  groupId: string;
  agentId: string;
  runId: string;
  text: string;
  startedAt: number;
  timelineOrder: number;
  terminalVisible: boolean;
  terminalStatus: BridgeTerminalStatus;
  source: "live-freeze" | "refresh-recovery";
};

export type GroupStreamPayload = {
  groupId: string;
  agentId: string;
  runId: string;
  state: "delta" | "final" | "error" | "aborted";
  content?: string; // delta text (backend field name)
  text?: string; // alias for content (frontend compatibility)
  message?: GroupChatMessage; // final message (only present when state is "final")
  errorMessage?: string;
  /** Tool messages for real-time tool card display */
  toolMessages?: GroupToolMessage[];
};

export type GroupSystemPayload = {
  groupId: string;
  event?: string;
  action?: string;
  data?: unknown;
};

// ─── State ───

export type GroupChatState = {
  /** Currently viewed group ID, null if not in a group room */
  activeGroupId: string | null;
  /** Whether the group chat area (list or room) is currently open */
  groupListOpen: boolean;
  /** Loaded group metadata */
  activeGroupMeta: GroupSessionMeta | null;
  /** Group chat messages */
  groupMessages: GroupChatMessage[];
  /** Active agent streams (agentId → current text) */
  groupStreams: Map<string, GroupStreamEntry>;
  /** Frozen bridge snapshots that participate in unified timeline rendering */
  groupBridgeSnapshots: Map<string, GroupBridgeSnapshot>;
  /** Agents that are pending response (waiting for first stream delta) */
  groupPendingAgents: Set<string>;
  /** Tool messages for real-time display (key: "agentId:runId" → messages) */
  groupToolMessages: Map<string, GroupToolMessage[]>;
  /** Group list for sidebar */
  groupIndex: GroupIndexEntry[];
  /** Loading states */
  groupListLoading: boolean;
  groupChatLoading: boolean;
  groupSending: boolean;
  /** Draft message */
  groupDraft: string;
  /** Image attachments for group chat */
  groupAttachments: ChatAttachment[];
  /** Error state */
  groupError: string | null;
  /** Whether the current group was not found (deleted/expired) */
  groupNotFound: boolean;
  /** Create dialog state */
  groupCreateDialog: GroupCreateDialogState | null;
  /** Add member dialog state */
  groupAddMemberDialog: GroupAddMemberDialogState | null;
  /** Remove member dialog state */
  groupRemoveMemberDialog: GroupRemoveMemberDialogState | null;
  /** Disband group dialog state */
  groupDisbandDialog: GroupDisbandDialogState | null;
  /** Clear messages dialog state */
  groupClearMessagesDialog: GroupClearMessagesDialogState | null;
  /** Info panel open */
  groupInfoPanelOpen: boolean;
  // ─── Bridge Terminal state ───
  /** Active bridge terminal statuses (agentId → status) */
  bridgeTerminalStatuses?: Map<string, BridgeTerminalStatus>;
  /** Terminal replay buffers (Base64-encoded, for page refresh restoration) */
  bridgeTerminalReplayBuffers?: Map<string, string>;
};

export type GroupCreateDialogState = {
  name: string;
  selectedAgents: Array<{ agentId: string; role: "assistant" | "member" | "bridge-assistant" }>;
  /** Pending role selections for unchecked agents (agentId → role). */
  pendingRoles: Record<string, "assistant" | "member" | "bridge-assistant">;
  messageMode: "unicast" | "broadcast";
  /** Project directory for CLI Agents (optional). */
  projectDirectory: string;
  /** Project documentation paths (optional). */
  projectDocs: string;
  /** Directory validation error message. */
  directoryError?: string;
  /** Docs validation error message. */
  docsError?: string;
  /** Whether validation is in progress. */
  isValidating?: boolean;
  isBusy: boolean;
  error: string | null;
};

export type GroupAddMemberDialogState = {
  selectedAgents: Array<{ agentId: string; role: "member" | "bridge-assistant" }>;
  /** Pending role selections for unchecked agents (agentId → role). */
  pendingRoles: Record<string, "member" | "bridge-assistant">;
  isBusy: boolean;
  error: string | null;
};

export type GroupRemoveMemberDialogState = {
  agentId: string;
  agentName: string;
  isBusy: boolean;
  error: string | null;
};

export type GroupDisbandDialogState = {
  groupId: string;
  groupName: string;
  isDisbanding: boolean;
  error: string | null;
};

export type GroupClearMessagesDialogState = {
  groupId: string;
  groupName: string;
  isClearing: boolean;
  error: string | null;
};

export const DEFAULT_GROUP_CHAT_STATE: GroupChatState = {
  activeGroupId: null,
  groupListOpen: false,
  activeGroupMeta: null,
  groupMessages: [],
  groupStreams: new Map(),
  groupBridgeSnapshots: new Map(),
  groupPendingAgents: new Set(),
  groupToolMessages: new Map(),
  groupIndex: [],
  groupListLoading: false,
  groupChatLoading: false,
  groupSending: false,
  groupDraft: "",
  groupAttachments: [],
  groupError: null,
  groupNotFound: false,
  groupCreateDialog: null,
  groupDisbandDialog: null,
  groupAddMemberDialog: null,
  groupRemoveMemberDialog: null,
  groupClearMessagesDialog: null,
  groupInfoPanelOpen: false,
  bridgeTerminalStatuses: new Map(),
};

// ─── Helpers ───

export type GroupHost = {
  client: GatewayBrowserClient | null;
  connected: boolean;
} & GroupChatState;

let nextTimelineOrder = 1;

function allocateTimelineOrder(): number {
  return nextTimelineOrder++;
}

function getBridgeSnapshotKey(agentId: string, runId: string): string {
  return `${agentId}:${runId}`;
}

function upsertBridgeSnapshot(
  host: GroupChatState,
  snapshot: Omit<GroupBridgeSnapshot, "id">,
): void {
  const key = getBridgeSnapshotKey(snapshot.agentId, snapshot.runId);
  const nextSnapshots = new Map(host.groupBridgeSnapshots);
  nextSnapshots.set(key, {
    ...snapshot,
    id: `bridge-snapshot:${key}`,
  });
  host.groupBridgeSnapshots = nextSnapshots;
}

function removeBridgeSnapshot(host: GroupChatState, agentId: string, runId: string): boolean {
  const key = getBridgeSnapshotKey(agentId, runId);
  if (!host.groupBridgeSnapshots.has(key)) {
    return false;
  }
  const nextSnapshots = new Map(host.groupBridgeSnapshots);
  nextSnapshots.delete(key);
  host.groupBridgeSnapshots = nextSnapshots;
  return true;
}

function setBridgeSnapshotsTerminalVisible(
  host: GroupChatState,
  agentId: string,
  terminalVisible: boolean,
): void {
  if (host.groupBridgeSnapshots.size === 0) {
    return;
  }
  let changed = false;
  const nextSnapshots = new Map(host.groupBridgeSnapshots);
  for (const [key, snapshot] of host.groupBridgeSnapshots) {
    if (snapshot.agentId !== agentId || snapshot.terminalVisible === terminalVisible) {
      continue;
    }
    nextSnapshots.set(key, { ...snapshot, terminalVisible });
    changed = true;
  }
  if (changed) {
    host.groupBridgeSnapshots = nextSnapshots;
  }
}

function findLatestBridgeSnapshotByAgent(
  host: GroupChatState,
  agentId: string,
): GroupBridgeSnapshot | null {
  let latest: GroupBridgeSnapshot | null = null;
  for (const snapshot of host.groupBridgeSnapshots.values()) {
    if (snapshot.agentId !== agentId) {
      continue;
    }
    if (
      latest === null ||
      snapshot.timelineOrder > latest.timelineOrder ||
      (snapshot.timelineOrder === latest.timelineOrder && snapshot.startedAt > latest.startedAt)
    ) {
      latest = snapshot;
    }
  }
  return latest;
}

function removeBridgeSnapshotByAgentFallback(
  host: GroupChatState,
  agentId: string,
  messageTimestamp: number,
): boolean {
  const matchingSnapshots = [...host.groupBridgeSnapshots.values()].filter(
    (snapshot) => snapshot.agentId === agentId,
  );
  if (matchingSnapshots.length !== 1) {
    return false;
  }
  if (host.groupStreams.has(agentId)) {
    return false;
  }
  const [snapshot] = matchingSnapshots;
  if (Math.abs(snapshot.startedAt - messageTimestamp) > 5 * 60 * 1000) {
    return false;
  }
  return removeBridgeSnapshot(host, agentId, snapshot.runId);
}

const groupMetaCache = new Map<string, GroupSessionMeta>();
const groupActiveStreamKeys = new Map<string, Set<string>>();
const parsedMentionMessageIds = new Set<string>();
const summaryInFlight = new Set<string>();
const summaryRerunRequested = new Set<string>();

function cacheGroupMeta(meta: GroupSessionMeta): GroupSessionMeta {
  groupMetaCache.set(meta.groupId, meta);
  return meta;
}

async function fetchGroupMeta(host: GroupHost, groupId: string): Promise<GroupSessionMeta | null> {
  if (!host.client || !host.connected) {
    return null;
  }
  try {
    const meta = await host.client.request<GroupSessionMeta>("group.info", { groupId });
    return meta ? cacheGroupMeta(meta) : null;
  } catch (err) {
    console.warn(`[group-chat] failed to fetch group meta for ${groupId}:`, err);
    return null;
  }
}

async function resolveGroupMeta(
  host: GroupHost,
  groupId: string,
): Promise<GroupSessionMeta | null> {
  if (host.activeGroupId === groupId && host.activeGroupMeta) {
    return cacheGroupMeta(host.activeGroupMeta);
  }
  const cached = groupMetaCache.get(groupId);
  if (cached) {
    return cached;
  }
  return fetchGroupMeta(host, groupId);
}

async function refreshGroupMetaCache(host: GroupHost, groupId: string): Promise<void> {
  const meta = await fetchGroupMeta(host, groupId);
  if (!meta) {
    return;
  }
  if (host.activeGroupId === groupId) {
    host.activeGroupMeta = meta;
  }
}

function getOrCreateActiveStreamSet(groupId: string): Set<string> {
  let set = groupActiveStreamKeys.get(groupId);
  if (!set) {
    set = new Set<string>();
    groupActiveStreamKeys.set(groupId, set);
  }
  return set;
}

function markGroupStreamActive(groupId: string, agentId: string, runId: string): void {
  getOrCreateActiveStreamSet(groupId).add(`${agentId}:${runId}`);
}

function markGroupStreamInactive(groupId: string, agentId: string, runId: string): void {
  const set = groupActiveStreamKeys.get(groupId);
  if (!set) {
    return;
  }
  set.delete(`${agentId}:${runId}`);
  if (set.size === 0) {
    groupActiveStreamKeys.delete(groupId);
  }
}

function getGroupActiveStreamCount(groupId: string): number {
  return groupActiveStreamKeys.get(groupId)?.size ?? 0;
}

function getParsedMentionMessageKey(groupId: string, messageId: string): string {
  return `${groupId}:${messageId}`;
}

function hasParsedMentionMessage(groupId: string, messageId: string): boolean {
  return parsedMentionMessageIds.has(getParsedMentionMessageKey(groupId, messageId));
}

function markParsedMentionMessage(groupId: string, messageId: string): void {
  parsedMentionMessageIds.add(getParsedMentionMessageKey(groupId, messageId));
}

function clearParsedMentionMessages(groupId: string): void {
  const prefix = `${groupId}:`;
  for (const key of parsedMentionMessageIds) {
    if (key.startsWith(prefix)) {
      parsedMentionMessageIds.delete(key);
    }
  }
}

function resetGroupRoomState(host: GroupChatState): void {
  host.activeGroupId = null;
  host.activeGroupMeta = null;
  host.groupMessages = [];
  host.groupStreams = new Map();
  host.groupBridgeSnapshots = new Map();
  host.groupPendingAgents = new Set();
  host.groupToolMessages = new Map();
  host.groupChatLoading = false;
  host.groupSending = false;
  host.groupDraft = "";
  host.groupAttachments = [];
  host.groupError = null;
  host.groupNotFound = false;
  host.groupAddMemberDialog = null;
  host.groupRemoveMemberDialog = null;
  host.groupDisbandDialog = null;
  host.groupInfoPanelOpen = false;
  host.bridgeTerminalStatuses = new Map();
}

export function openGroupList(host: GroupChatState): void {
  host.groupListOpen = true;
  resetGroupRoomState(host);
}

export function closeGroupChatView(host: GroupChatState): void {
  host.groupListOpen = false;
  host.groupCreateDialog = null;
  resetGroupRoomState(host);
}

// ─── URL sync helpers ───

/** Update browser URL to include ?group=<groupId> parameter */
function syncUrlWithGroup(groupId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("session");
  url.searchParams.set("group", groupId);
  window.history.replaceState({}, "", url.toString());
}

/** Remove ?group= parameter from browser URL */
function clearUrlGroup(): void {
  if (typeof window === "undefined" || !window.location?.href) {
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("group");
  window.history.replaceState({}, "", url.toString());
}

// ─── @mention Detection & Auto-Forward ───

/**
 * Extract routable @mentions from message content.
 *
 * Historical note: the function name is retained for compatibility,
 * but the current behavior matches product rules where both inline
 * mentions and standalone mention lines can trigger routing.
 *
 * @param content - The message content to parse
 * @param memberIds - List of valid member agentIds for exact matching
 * @returns Array of valid member IDs mentioned anywhere in the content
 *
 * Examples (with memberIds = ["dev", "test"]):
 * - "@dev" → ["dev"] (triggers routing)
 * - "@dev @test" → ["dev", "test"] (triggers routing to both)
 * - "请回答 @dev" → ["dev"] (inline mention also triggers routing)
 * - "@unknown" → [] (not a member, no routing)
 */
export function extractDedicatedMentions(content: string, memberIds: string[]): string[] {
  if (!memberIds.length) {
    return [];
  }

  // Extract ALL @mentions from content (inline or dedicated lines)
  const mentions: string[] = [];

  // Match @agentId pattern globally
  // Use word boundary to avoid matching @ inside other words
  const mentionPattern = /@([a-zA-Z0-9_-]+)/g;
  let match;

  while ((match = mentionPattern.exec(content)) !== null) {
    const agentId = match[1];
    // Only count if it's a valid member
    if (memberIds.includes(agentId)) {
      mentions.push(agentId);
    }
  }

  return [...new Set(mentions)];
}

/**
 * Process message content for display:
 * 1. Convert \@ to @ (escape handling)
 * 2. Highlight @mentions for valid members
 *
 * @param content - The message content to process
 * @param memberIds - List of valid member agentIds for mention highlighting
 * @returns Processed content with escapes resolved and mentions wrapped
 *
 * Examples (with memberIds = ["dev", "test"]):
 * - "请 @dev 回答" → "请 <mark>@dev</mark> 回答"
 * - "邮箱 a\\@b.com" → "邮箱 a@b.com"
 * - "联系 user@example.com" → "联系 user@example.com" (unchanged, not a member)
 */
export function processMentionDisplay(content: string, memberIds: string[]): string {
  if (!content) {
    return content;
  }

  // Step 1: Replace \@ with a placeholder to protect it during mention processing
  const ESCAPE_PLACEHOLDER = "\x00ESC_AT\x00";
  let result = content.replace(/\\@/g, ESCAPE_PLACEHOLDER);

  // Step 2: Highlight @mentions for valid members only
  if (memberIds.length > 0) {
    // Sort by length descending to match longer IDs first (avoid partial matches)
    const sortedIds = [...memberIds].toSorted((a, b) => b.length - a.length);

    for (const agentId of sortedIds) {
      // Match @agentId that's not part of a longer word
      // This ensures @dev doesn't match inside @devops
      const pattern = new RegExp(`@${escapeRegExp(agentId)}(?![a-zA-Z0-9_-])`, "g");
      result = result.replace(pattern, `<mark class="mention">@${agentId}</mark>`);
    }
  }

  // Step 3: Convert escape placeholder back to @
  result = result.replace(new RegExp(ESCAPE_PLACEHOLDER, "g"), "@");

  return result;
}

/** Escape special regex characters in a string */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Initiator Summary Mechanism ───

/** Pending mention message for delayed delivery */
type PendingMention = {
  agentId: string; // Target agent who was @mentioned
  message: GroupChatMessage; // The message containing the @mention
  fromAgentId: string; // Sender agentId
};

/** Per-group chain state for forward limiting and initiator tracking */
type ChainState = {
  count: number;
  startedAt: number;
  initiators: string[]; // Ordered list of agents who @mentioned others (deduped)
  pendingAgents: Set<string>; // Agents triggered but not yet replied
  lastMessageAt: number; // Timestamp of last message
  mentionedAgents: string[]; // Agents already triggered in this chain (deduped, ordered)
  pendingMentions: PendingMention[]; // Repeated @mentions waiting for delivery
};

const groupChainStates = new Map<string, ChainState>();

// Summary timers and counters
const summaryTimers = new Map<string, number>();
const summaryRounds = new Map<string, number>();

const MAX_CHAIN_FORWARDS = 10;
const MAX_CHAIN_DURATION_MS = 5 * 60_000; // 5 minutes
const SUMMARY_DELAY_MS = 10_000; // Wait after all agents replied (summary trigger)
const MAX_PENDING_WAIT_MS = 30_000; // Max wait for pending agents
const MAX_SUMMARY_ROUNDS = 3;

/** Get or create chain state for a group */
function getOrCreateChainState(groupId: string): ChainState {
  let chain = groupChainStates.get(groupId);
  if (!chain) {
    const now = Date.now();
    chain = {
      count: 0,
      startedAt: now,
      initiators: [],
      pendingAgents: new Set(),
      lastMessageAt: now,
      mentionedAgents: [],
      pendingMentions: [],
    };
    groupChainStates.set(groupId, chain);
  }
  return chain;
}

/** Add initiator to list (deduped, ordered) */
function addInitiator(chain: ChainState, agentId: string): void {
  if (!chain.initiators.includes(agentId)) {
    chain.initiators.push(agentId);
  }
}

/** Add mentioned agent to list (deduped, ordered) */
function addMentionedAgent(chain: ChainState, agentId: string): void {
  if (!chain.mentionedAgents.includes(agentId)) {
    chain.mentionedAgents.push(agentId);
  }
}

/** Check if agent has already been mentioned in this chain */
function hasBeenMentioned(chain: ChainState, agentId: string): boolean {
  return chain.mentionedAgents.includes(agentId);
}

/** Cancel summary timer for a group */
function cancelSummaryTimer(groupId: string): void {
  const timer = summaryTimers.get(groupId);
  if (timer) {
    clearTimeout(timer);
    summaryTimers.delete(groupId);
  }
}

function getGroupSystemEventName(payload: GroupSystemPayload): string | null {
  return payload.event ?? payload.action ?? null;
}

function requestSummaryCheck(host: GroupHost, groupId: string): void {
  if (summaryInFlight.has(groupId)) {
    summaryRerunRequested.add(groupId);
    return;
  }
  scheduleSummaryCheck(host, groupId);
}

/** Schedule a summary check */
function scheduleSummaryCheck(host: GroupHost, groupId: string): void {
  const chain = groupChainStates.get(groupId);
  if (!chain) {
    return;
  }
  if (chain.initiators.length === 0) {
    return;
  }

  const hasPendingAgents = chain.pendingAgents.size > 0;
  const activeStreamCount = getGroupActiveStreamCount(groupId);
  const hasActiveStreams = activeStreamCount > 0;
  const isConversationBusy = hasPendingAgents || hasActiveStreams;

  cancelSummaryTimer(groupId);

  if (isConversationBusy) {
    const timer = window.setTimeout(() => {
      scheduleSummaryCheck(host, groupId);
    }, 1000);
    summaryTimers.set(groupId, timer);
    return;
  }

  const now = Date.now();
  const elapsed = now - chain.lastMessageAt;
  const totalWait = now - chain.startedAt;
  const delay = totalWait >= MAX_PENDING_WAIT_MS ? 0 : Math.max(0, SUMMARY_DELAY_MS - elapsed);

  const timer = window.setTimeout(() => {
    void executeSummaryFlow(host, groupId);
  }, delay);
  summaryTimers.set(groupId, timer);
}

/**
 * Execute summary flow (two-phase):
 * Phase 1: Deliver pending mentions → if delivered, re-enter scheduleSummaryCheck
 *          to wait for agents to reply (observe, don't blind-wait).
 * Phase 2: No pending mentions left → send summary to initiators.
 */
async function executeSummaryFlow(host: GroupHost, groupId: string): Promise<void> {
  cancelSummaryTimer(groupId);
  if (summaryInFlight.has(groupId)) {
    summaryRerunRequested.add(groupId);
    return;
  }

  const chain = groupChainStates.get(groupId);
  if (!chain) {
    return;
  }

  let delivered = false;
  summaryInFlight.add(groupId);
  try {
    // Phase 1: deliver pending mentions to non-initiator agents
    delivered = await deliverPendingMentions(host, groupId);

    if (delivered) {
      // Messages were delivered → agents may produce new replies with different opinions.
      // Re-enter the scheduling loop so we wait for those replies before summarizing.
      // pendingMentions for non-initiators are already cleared in deliverPendingMentions,
      // so the next executeSummaryFlow invocation won't re-deliver them.
      return; // finally block will clear summaryInFlight and re-schedule
    }

    // Phase 2: no pending mentions to deliver → send summary to initiators
    const latestChain = groupChainStates.get(groupId);
    if (latestChain?.initiators.length) {
      await sendSummaryMessage(host, groupId);
    }
  } finally {
    summaryInFlight.delete(groupId);
    if (delivered || summaryRerunRequested.delete(groupId)) {
      scheduleSummaryCheck(host, groupId);
    }
  }
}

/**
 * Deliver pending @mention messages to non-initiator agents.
 * Initiators will receive their pending mentions in the summary message.
 *
 * @returns true if any messages were actually delivered (caller should
 *          re-enter the scheduling loop to wait for agent replies).
 */
async function deliverPendingMentions(host: GroupHost, groupId: string): Promise<boolean> {
  const chain = groupChainStates.get(groupId);
  if (!chain || chain.pendingMentions.length === 0 || !host.client || !host.connected) {
    return false;
  }

  const meta = await resolveGroupMeta(host, groupId);
  if (!meta) {
    return false;
  }

  const memberIds = new Set(meta.members.map((m) => m.agentId));
  const initiatorSet = new Set(chain.initiators);
  const deliverMap = new Map<string, PendingMention[]>();

  for (const pending of chain.pendingMentions) {
    if (initiatorSet.has(pending.agentId) || !memberIds.has(pending.agentId)) {
      continue;
    }

    const list = deliverMap.get(pending.agentId) ?? [];
    list.push(pending);
    deliverMap.set(pending.agentId, list);
  }

  const agentsToDeliver: string[] = [];

  for (const agentId of chain.mentionedAgents) {
    const pendings = deliverMap.get(agentId);
    if (!pendings?.length) {
      continue;
    }

    agentsToDeliver.push(agentId);
    const messages = pendings
      .toSorted((a, b) => a.message.timestamp - b.message.timestamp)
      .map((p) => `[${p.fromAgentId}]: ${p.message.content}`);

    try {
      await host.client.request("group.send", {
        groupId,
        message: messages.join("\n\n"),
        mentions: [agentId],
        sender: { type: "owner" },
        skipTranscript: true,
      });
    } catch (err) {
      console.error(`[group-chat] failed to deliver pending mentions to ${agentId}:`, err);
    }
  }

  if (agentsToDeliver.length > 0) {
    appendSystemMessageToUI(
      host,
      groupId,
      `📤 正在投递待处理消息给 ${agentsToDeliver.map((id) => `@${id}`).join(" ")}`,
    );

    // Clear delivered (non-initiator) pending mentions.
    // Keep initiator pending mentions — they will be included in the summary message.
    // This ensures the next executeSummaryFlow invocation won't re-deliver.
    chain.pendingMentions = chain.pendingMentions.filter((p) => initiatorSet.has(p.agentId));
  }

  return agentsToDeliver.length > 0;
}

/** Send summary message to trigger initiators */
async function sendSummaryMessage(host: GroupHost, groupId: string): Promise<void> {
  const chain = groupChainStates.get(groupId);
  if (!chain || chain.initiators.length === 0) {
    return;
  }

  const rounds = summaryRounds.get(groupId) ?? 0;
  if (rounds >= MAX_SUMMARY_ROUNDS) {
    return;
  }

  if (!host.client || !host.connected) {
    return;
  }

  const meta = await resolveGroupMeta(host, groupId);
  if (!meta) {
    return;
  }

  const validInitiators = chain.initiators.filter((id) =>
    meta.members.some((m) => m.agentId === id),
  );

  if (validInitiators.length === 0) {
    resetChainState(groupId);
    return;
  }

  summaryRounds.set(groupId, rounds + 1);
  appendSystemMessageToUI(host, groupId, `📢 汇总 @${validInitiators.join(" @")}`);

  let summaryContent = `请确认是否有新的想法或补充。

如果当前讨论已结束或没有新内容，可以：
- 不回复（跳过）
- 回复简单语句，如"收到"、"明白"、"了解"`;

  for (const initiatorId of validInitiators) {
    const initiatorPendings = chain.pendingMentions.filter((p) => p.agentId === initiatorId);

    if (initiatorPendings.length > 0) {
      summaryContent += `\n\n---\n**以下是对你的提及：**`;
      for (const pending of initiatorPendings.toSorted(
        (a, b) => a.message.timestamp - b.message.timestamp,
      )) {
        summaryContent += `\n[${pending.fromAgentId}]: ${pending.message.content}`;
      }
    }
  }

  try {
    await host.client.request("group.send", {
      groupId,
      message: summaryContent,
      mentions: validInitiators,
      sender: { type: "owner" },
      skipTranscript: true,
    });

    // Reset chain state for summary round, but KEEP the original startedAt
    // so that the chain duration limit can eventually fire.
    const originalStartedAt = chain.startedAt;
    const now = Date.now();
    groupChainStates.set(groupId, {
      count: chain.count, // Preserve count — summary is part of the same chain
      startedAt: originalStartedAt, // Keep original start time for duration limit
      initiators: [],
      pendingAgents: new Set(validInitiators),
      lastMessageAt: now,
      mentionedAgents: [],
      pendingMentions: [],
    });
  } catch (err) {
    console.error(`[group-chat] summary failed: group=${groupId}`, err);
  }
}

/** Reset chain state — new conversation round */
export function resetChainState(groupId: string): void {
  groupChainStates.delete(groupId);
  cancelSummaryTimer(groupId);
  summaryInFlight.delete(groupId);
  summaryRerunRequested.delete(groupId);
  clearParsedMentionMessages(groupId);
}

/** Get mentioned agents for a group (agents that have been triggered in current chain) */
export function getMentionedAgents(groupId: string): string[] {
  const chain = groupChainStates.get(groupId);
  return chain?.mentionedAgents ?? [];
}

/** Cancel summary manually */
export function cancelSummary(host: GroupHost, groupId: string): void {
  cancelSummaryTimer(groupId);
  appendSystemMessageToUI(host, groupId, "已取消自动汇总。");
}

/** Trigger summary manually */
export async function triggerSummary(host: GroupHost, groupId: string): Promise<void> {
  const chain = groupChainStates.get(groupId);
  if (!chain || chain.initiators.length === 0) {
    return;
  }
  cancelSummaryTimer(groupId);
  await sendSummaryMessage(host, groupId);
}

/**
 * Detect @agentId markers in an agent's reply and auto-forward
 * the message to trigger the mentioned agents.
 *
 * Both inline mentions and standalone mention lines can trigger routing.
 * If a line contains only @mentions, that line is later treated as a
 * routing-only marker and removed from forwarded content.
 *
 * NEW: If an agent has already been triggered in this chain, the mention
 * is saved for later delivery (before summary or in summary message).
 *
 * Called after a group.stream (final) event is received.
 */
export async function detectAndForwardMentions(
  host: GroupHost,
  message: GroupChatMessage,
): Promise<void> {
  // Only process agent messages
  if (message.sender.type !== "agent") {
    return;
  }
  if (!host.client || !host.connected) {
    return;
  }

  const meta = await resolveGroupMeta(host, message.groupId);
  if (!meta) {
    return;
  }

  const allMemberIds = meta.members.map((m) => m.agentId);
  const currentChain = groupChainStates.get(message.groupId);
  const initiatorSet = new Set(currentChain?.initiators ?? []);
  const memberIds = allMemberIds.filter((id) => !initiatorSet.has(id));

  const cleanContent =
    message.role === "assistant" ? stripThinkingTags(message.content) : message.content;
  const dedicatedMentions = extractDedicatedMentions(cleanContent, memberIds);

  if (dedicatedMentions.length === 0) {
    const chain = groupChainStates.get(message.groupId);
    if (chain && chain.initiators.length > 0) {
      chain.lastMessageAt = Date.now();
      requestSummaryCheck(host, message.groupId);
      return;
    }
    resetChainState(message.groupId);
    return;
  }

  // Exclude sender from mentions
  const senderAgentId = message.sender.type === "agent" ? message.sender.agentId : undefined;
  const mentionedIds = [...new Set(dedicatedMentions.filter((id) => id !== senderAgentId))];

  if (mentionedIds.length === 0) {
    const chain = groupChainStates.get(message.groupId);
    if (chain && chain.initiators.length > 0) {
      chain.lastMessageAt = Date.now();
      requestSummaryCheck(host, message.groupId);
      return;
    }
    resetChainState(message.groupId);
    return;
  }

  // Check chain limits (count + duration)
  const chain = getOrCreateChainState(message.groupId);
  const now = Date.now();

  if (chain.count >= MAX_CHAIN_FORWARDS) {
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
    // Don't trigger summary when chain limit reached
    return;
  }

  if (now - chain.startedAt >= MAX_CHAIN_DURATION_MS) {
    const elapsed = Math.round((now - chain.startedAt) / 1000);
    console.warn(`[group-chat] chain duration limit: group=${message.groupId} elapsed=${elapsed}s`);
    appendSystemMessageToUI(
      host,
      message.groupId,
      `⚠️ Conversation chain timeout (exceeded ${MAX_CHAIN_DURATION_MS / 60_000} minutes). ` +
        `Auto-forwarding has been stopped. ` +
        `Send a new message to start a fresh conversation.`,
    );
    // Don't trigger summary when duration limit reached
    return;
  }

  // Track initiator (agent who @mentioned others)
  if (senderAgentId) {
    addInitiator(chain, senderAgentId);
  }

  // Separate first-time mentions from repeated mentions
  const firstTimeMentions: string[] = [];

  const queuedAgentIds: string[] = [];

  for (const agentId of mentionedIds) {
    if (hasBeenMentioned(chain, agentId)) {
      // Already triggered in this chain, save for later delivery
      chain.pendingMentions.push({
        agentId,
        message,
        fromAgentId: senderAgentId ?? "unknown",
      });
      queuedAgentIds.push(agentId);
    } else {
      // First time being mentioned - mark immediately to prevent race conditions
      // when the same message is processed multiple times (e.g., due to WebSocket reconnect)
      addMentionedAgent(chain, agentId);
      firstTimeMentions.push(agentId);
    }
  }

  // Notify user that repeated @mentions have been queued for later delivery
  if (queuedAgentIds.length > 0) {
    appendSystemMessageToUI(
      host,
      message.groupId,
      `⏳ ${queuedAgentIds.map((id) => `@${id}`).join(" ")} 正在回复中，消息已排队，将在当前回复完成后自动投递。`,
    );
  }

  // Only trigger first-time mentions
  if (firstTimeMentions.length === 0) {
    if (chain.initiators.length > 0) {
      requestSummaryCheck(host, message.groupId);
    }
    return;
  }

  // Update chain state
  chain.count += 1;
  chain.lastMessageAt = now;

  // Track pending agents (who will be triggered)
  for (const id of firstTimeMentions) {
    chain.pendingAgents.add(id);
  }

  // Remove pure mention lines from forwarded message (they are routing-only markers)
  // Strip thinking tags from forwarded content (thinking is not forwarded to triggered agents)
  // Keep inline mentions as-is in the forwarded message body
  const lines = cleanContent.split("\n");
  const contentLines = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return false;
    }
    // Check if line is ONLY @mentions (use all members including initiators)
    const parts = trimmed.split(/\s+/);
    const isAllMentions = parts.every((part) => {
      if (!part.startsWith("@")) {
        return false;
      }
      const id = part.slice(1);
      return allMemberIds.includes(id);
    });
    // Keep lines that are NOT all mentions (those are the content)
    return !isAllMentions;
  });
  const forwardedText = contentLines.join("\n");

  // Show auto-forward notification
  appendSystemMessageToUI(host, message.groupId, `🔄 触发 @${firstTimeMentions.join(" @")}`);

  // Predict which agents will respond so we can show pending indicators immediately
  // This is only a UI concern for the currently active room. Chain state already
  // tracks pending agents for all groups, including background groups.
  if (host.activeGroupId === message.groupId) {
    const currentPending = host.groupPendingAgents;
    const newPending = new Set(currentPending);
    for (const id of firstTimeMentions) {
      newPending.add(id);
    }
    host.groupPendingAgents = newPending;
  }

  // Forward: reuse group.send with sender set to the replying agent
  // skipTranscript: true → backend skips duplicate write + broadcast
  try {
    await host.client.request("group.send", {
      groupId: message.groupId,
      message: forwardedText,
      sender: { type: "agent", agentId: senderAgentId },
      mentions: firstTimeMentions,
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
      if (host.activeGroupId === message.groupId) {
        const next = new Set(host.groupPendingAgents);
        for (const id of firstTimeMentions) {
          next.delete(id);
        }
        host.groupPendingAgents = next;
      }
    } else {
      console.error("[group-chat] forward mention failed:", err);
    }
  }
}

/** Append a local system message to the UI (not persisted to backend) */
function appendSystemMessageToUI(host: GroupChatState, groupId: string, content: string): void {
  if (host.activeGroupId !== groupId) {
    return;
  }
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
    if (!meta) {
      return;
    }
    cacheGroupMeta(meta);
    if (host.activeGroupId === groupId) {
      host.activeGroupMeta = meta;

      // Restore terminal statuses and replay buffers from backend (for page refresh)
      if (meta.bridgeTerminalStatuses) {
        const statuses = new Map<
          string,
          "idle" | "working" | "ready" | "completed" | "timeout" | "error" | "disconnected"
        >();
        for (const [agentId, status] of Object.entries(meta.bridgeTerminalStatuses)) {
          // Map backend status strings to frontend status types
          const mappedStatus = mapPtyStatusToTerminalStatus(status);
          statuses.set(agentId, mappedStatus);
        }
        host.bridgeTerminalStatuses = statuses;
      }

      // Restore terminal replay buffers (for content restoration after page refresh)
      if (meta.bridgeTerminalReplayBuffers) {
        const replayBuffers = new Map<string, string>();
        for (const [agentId, buffer] of Object.entries(meta.bridgeTerminalReplayBuffers)) {
          replayBuffers.set(agentId, buffer);
        }
        host.bridgeTerminalReplayBuffers = replayBuffers;
      }
    }
  } catch (err) {
    const errMsg = String(err);
    // Detect "Group not found" (backend code 404) to allow cleanup
    if (errMsg.includes("Group not found") || errMsg.includes("404")) {
      host.groupNotFound = true;
      host.groupError = `Group "${groupId}" does not exist or has been deleted.`;
    } else {
      host.groupError = `Failed to load group: ${errMsg}`;
    }
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
  attachments?: ChatAttachment[],
): Promise<void> {
  const hasAttachments = attachments && attachments.length > 0;
  if (!host.client || !host.connected || (!message.trim() && !hasAttachments)) {
    return;
  }

  const existingChain = groupChainStates.get(groupId);
  const existingInitiators = existingChain?.initiators ?? [];

  cancelSummaryTimer(groupId);
  summaryRounds.delete(groupId);
  summaryRerunRequested.delete(groupId);

  const now = Date.now();
  groupChainStates.set(groupId, {
    count: 0,
    startedAt: now,
    initiators: existingInitiators,
    pendingAgents: new Set(),
    lastMessageAt: now,
    mentionedAgents: [],
    pendingMentions: [],
  });

  host.groupSending = true;
  host.groupError = null;

  const meta = await resolveGroupMeta(host, groupId);
  if (meta) {
    const pendingAgents = resolvePendingAgents(meta, mentions);
    if (pendingAgents.length > 0) {
      host.groupPendingAgents = new Set(pendingAgents);
      const chain = groupChainStates.get(groupId);
      if (chain) {
        for (const id of pendingAgents) {
          chain.pendingAgents.add(id);
        }
      }
    }
  }

  try {
    // 将 attachments 转换为 API 格式
    const apiAttachments = hasAttachments
      ? attachments
          .map((att) => {
            const match = /^data:([^;]+);base64,(.+)$/.exec(att.dataUrl);
            if (!match) {
              return null;
            }
            return {
              type: "image",
              mimeType: match[1],
              content: match[2],
            };
          })
          .filter((a): a is NonNullable<typeof a> => a !== null)
      : undefined;

    await host.client.request("group.send", {
      groupId,
      message: message.trim(),
      mentions: mentions?.length ? mentions : undefined,
      attachments: apiAttachments,
    });
    host.groupDraft = "";
    host.groupAttachments = [];
  } catch (err) {
    host.groupError = `Failed to send: ${String(err)}`;
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

/**
 * Validate paths (directories or files) via backend RPC.
 * Used by the create dialog to verify user input.
 */
export async function validatePaths(
  host: GroupHost,
  paths: string[],
  type: "directory" | "file",
): Promise<Array<{ path: string; exists: boolean; error?: string }>> {
  if (!host.client || !host.connected || paths.length === 0) {
    return paths.map((p) => ({ path: p, exists: false, error: "Not connected" }));
  }

  try {
    const result = await host.client.request<{
      results: Array<{ path: string; exists: boolean; error?: string }>;
    }>("group.validatePath", { paths, type });
    return result?.results ?? [];
  } catch (err) {
    return paths.map((p) => ({ path: p, exists: false, error: String(err) }));
  }
}

export async function createGroup(
  host: GroupHost,
  opts: {
    name?: string;
    members: Array<{ agentId: string; role: "assistant" | "member" | "bridge-assistant" }>;
    messageMode?: "unicast" | "broadcast";
    project?: { directory?: string; docs?: string[] };
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
    resetChainState(groupId);
    groupMetaCache.delete(groupId);
    groupActiveStreamKeys.delete(groupId);
    clearParsedMentionMessages(groupId);
    if (host.activeGroupId === groupId) {
      openGroupList(host);
    }
    await Promise.all([
      loadGroupList(host),
      loadSessions(host as unknown as Parameters<typeof loadSessions>[0]),
    ]);
  } catch (err) {
    host.groupError = `Failed to delete group: ${String(err)}`;
  }
}

export async function updateGroupMembers(
  host: GroupHost,
  groupId: string,
  action: "add" | "remove",
  payload: {
    members?: Array<{ agentId: string; role?: "member" | "bridge-assistant" }>;
    agentIds?: string[];
  },
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

export async function removeGroupMember(
  host: GroupHost,
  groupId: string,
  agentId: string,
): Promise<void> {
  if (!host.client || !host.connected) {
    return;
  }
  const dialog = host.groupRemoveMemberDialog;
  if (dialog) {
    dialog.isBusy = true;
    dialog.error = null;
  }
  try {
    await host.client.request("group.removeMembers", { groupId, agentIds: [agentId] });
    if (dialog) {
      host.groupRemoveMemberDialog = null;
    }
    await loadGroupInfo(host, groupId);
    await loadGroupList(host);
  } catch (err) {
    if (dialog) {
      dialog.isBusy = false;
      dialog.error = String(err);
    }
    host.groupError = `Failed to remove member: ${String(err)}`;
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
    await loadGroupList(host);
  } catch (err) {
    host.groupError = `Failed to update setting: ${String(err)}`;
  }
}

export async function updateGroupName(
  host: GroupHost,
  groupId: string,
  name: string,
): Promise<void> {
  return updateGroupSettings(host, groupId, "setName", { name });
}

export async function updateGroupMessageMode(
  host: GroupHost,
  groupId: string,
  mode: "unicast" | "broadcast",
): Promise<void> {
  return updateGroupSettings(host, groupId, "setMessageMode", { mode });
}

export async function updateGroupAnnouncement(
  host: GroupHost,
  groupId: string,
  content: string,
): Promise<void> {
  return updateGroupSettings(host, groupId, "setAnnouncement", { content });
}

export async function updateGroupMaxRounds(
  host: GroupHost,
  groupId: string,
  maxRounds: number,
): Promise<void> {
  return updateGroupAntiLoopConfig(host, groupId, { maxRounds });
}

/**
 * Update anti-loop configuration (maxRounds, chainTimeout, cliTimeout).
 * All parameters are optional - only provided values will be updated.
 */
export async function updateGroupAntiLoopConfig(
  host: GroupHost,
  groupId: string,
  config: {
    maxRounds?: number;
    chainTimeout?: number;
    cliTimeout?: number;
  },
): Promise<void> {
  if (!host.client || !host.connected) {
    return;
  }
  try {
    await host.client.request("group.setAntiLoopConfig", { groupId, ...config });
    await loadGroupInfo(host, groupId);
  } catch (err) {
    host.groupError = `Failed to update anti-loop config: ${String(err)}`;
  }
}

export async function updateGroupContextConfig(
  host: GroupHost,
  groupId: string,
  contextConfig: {
    maxMessages?: number;
    maxCharacters?: number;
    includeSystemMessages?: boolean;
  },
): Promise<void> {
  return updateGroupSettings(host, groupId, "setContextConfig", { contextConfig });
}

export async function updateGroupProjectDocs(
  host: GroupHost,
  groupId: string,
  docs: string[],
): Promise<void> {
  return updateGroupSettings(host, groupId, "setProjectDocs", { docs });
}

export async function disbandGroup(host: GroupHost, groupId: string): Promise<void> {
  return deleteGroup(host, groupId);
}

/**
 * 打开解散群聊确认对话框
 */
export function openDisbandGroupDialog(
  host: GroupChatState,
  groupId: string,
  groupName: string,
): void {
  host.groupDisbandDialog = {
    groupId,
    groupName,
    isDisbanding: false,
    error: null,
  };
}

/**
 * 关闭解散群聊确认对话框
 */
export function closeDisbandGroupDialog(host: GroupChatState): void {
  host.groupDisbandDialog = null;
}

/**
 * 确认解散群聊
 */
export async function confirmDisbandGroup(host: GroupHost): Promise<void> {
  const dialog = host.groupDisbandDialog;
  if (!dialog) {
    return;
  }

  // 设置解散中状态
  host.groupDisbandDialog = { ...dialog, isDisbanding: true, error: null };

  try {
    await disbandGroup(host, dialog.groupId);
    // 解散成功，关闭对话框
    host.groupDisbandDialog = null;
    // 关闭信息面板
    host.groupInfoPanelOpen = false;
  } catch (err) {
    // 解散失败，显示错误
    host.groupDisbandDialog = {
      ...dialog,
      isDisbanding: false,
      error: String(err),
    };
  }
}

// ─── Clear Messages ───

/**
 * 打开清空消息确认对话框
 */
export function openClearMessagesDialog(
  host: GroupChatState,
  groupId: string,
  groupName: string,
): void {
  host.groupClearMessagesDialog = {
    groupId,
    groupName,
    isClearing: false,
    error: null,
  };
}

/**
 * 关闭清空消息确认对话框
 */
export function closeClearMessagesDialog(host: GroupChatState): void {
  host.groupClearMessagesDialog = null;
}

/**
 * 确认清空消息
 */
export async function confirmClearMessages(host: GroupHost): Promise<void> {
  const dialog = host.groupClearMessagesDialog;
  if (!dialog) {
    return;
  }

  // Set clearing state
  host.groupClearMessagesDialog = { ...dialog, isClearing: true, error: null };

  try {
    if (!host.client || !host.connected) {
      throw new Error("Not connected");
    }

    await host.client.request("group.clearMessages", { groupId: dialog.groupId });

    // Clear local state
    host.groupMessages = [];
    host.groupStreams = new Map();
    host.groupBridgeSnapshots = new Map();
    host.groupPendingAgents = new Set();
    host.groupToolMessages = new Map();
    streamBuffers.clear();

    // Reset chain state
    resetChainState(dialog.groupId);

    // Close dialog
    host.groupClearMessagesDialog = null;
  } catch (err) {
    host.groupClearMessagesDialog = {
      ...dialog,
      isClearing: false,
      error: String(err),
    };
  }
}

// ─── Event Handlers ───

export function handleGroupMessageEvent(
  host: GroupChatState,
  payload: { groupId: string } & GroupChatMessage,
): void {
  const isActiveGroup = payload.groupId === host.activeGroupId;
  if (isActiveGroup) {
    // When a formal message from a bridge agent replaces a bridge snapshot,
    // inherit the snapshot's startedAt so the message stays at the same
    // timeline position instead of jumping to the bottom (the formal message's
    // timestamp is always later because it is created after CLI completion +
    // idle detection + network RTT).
    if (payload.sender.type === "agent" && "agentId" in payload.sender) {
      const replacedSnapshot = findLatestBridgeSnapshotByAgent(host, payload.sender.agentId);
      if (replacedSnapshot) {
        payload.timestamp = replacedSnapshot.startedAt;
      }
    }

    if (host.groupMessages.some((m) => m.id === payload.id)) {
      // duplicate message, skip
    } else {
      host.groupMessages = [...host.groupMessages, payload];
    }

    if (payload.sender.type === "agent" && "agentId" in payload.sender) {
      let snapshotRemoved = false;
      if (payload.agentRunId) {
        snapshotRemoved = removeBridgeSnapshot(host, payload.sender.agentId, payload.agentRunId);
      }
      if (!snapshotRemoved) {
        snapshotRemoved = removeBridgeSnapshotByAgentFallback(host, payload.sender.agentId, payload.timestamp);
      }

      // Once the formal message replaces the snapshot, clear the terminal status
      // so the terminal component does not appear as an orphan at the bottom.
      if (snapshotRemoved && host.bridgeTerminalStatuses?.has(payload.sender.agentId)) {
        const nextStatuses = new Map(host.bridgeTerminalStatuses);
        nextStatuses.delete(payload.sender.agentId);
        host.bridgeTerminalStatuses = nextStatuses;
      }
    }
  }

  if (payload.sender.type !== "agent") {
    return;
  }

  const chain = groupChainStates.get(payload.groupId);
  if (chain) {
    chain.pendingAgents.delete(payload.sender.agentId);
    chain.lastMessageAt = Date.now();
  }

  if (hasParsedMentionMessage(payload.groupId, payload.id)) {
    return;
  }
  markParsedMentionMessage(payload.groupId, payload.id);

  void detectAndForwardMentions(host as GroupHost, payload)
    .then(() => {
      requestSummaryCheck(host as GroupHost, payload.groupId);
    })
    .catch((err) => {
      console.error("[group-chat] detectAndForwardMentions failed:", err);
    });
}

const streamBuffers = new Map<string, string>();
const pendingSyncAgents = new Set<string>();
let batchSyncTimer: number | null = null;

function scheduleBatchSync(host: GroupChatState, agentId: string): void {
  pendingSyncAgents.add(agentId);
  if (batchSyncTimer !== null) {
    return;
  }
  batchSyncTimer = window.setTimeout(() => {
    batchSyncTimer = null;
    batchSyncGroupStreams(host);
  }, 60);
}

function flushPendingBridgeSyncIfNeeded(host: GroupChatState): void {
  if (batchSyncTimer !== null) {
    clearTimeout(batchSyncTimer);
    batchSyncTimer = null;
  }
  batchSyncGroupStreams(host);
}

export function handleGroupStreamEvent(host: GroupChatState, payload: GroupStreamPayload): void {
  const isActiveGroup = payload.groupId === host.activeGroupId;
  const deltaText = payload.content ?? payload.text;

  if (payload.state === "delta" && typeof deltaText === "string") {
    markGroupStreamActive(payload.groupId, payload.agentId, payload.runId);
    if (!isActiveGroup) {
      return;
    }

    const streamKey = `${payload.agentId}:${payload.runId}`;

    if (payload.toolMessages && payload.toolMessages.length > 0) {
      const currentToolMessages = host.groupToolMessages ?? new Map();
      const existingTools = currentToolMessages.get(streamKey) ?? [];
      const newToolMap = new Map(existingTools.map((t) => [t.id, t]));
      for (const toolMsg of payload.toolMessages) {
        newToolMap.set(toolMsg.id, toolMsg);
      }
      host.groupToolMessages = new Map(currentToolMessages).set(
        streamKey,
        Array.from(newToolMap.values()),
      );

      if (!streamBuffers.has(streamKey)) {
        streamBuffers.set(streamKey, "");
      }

      if (host.groupPendingAgents.has(payload.agentId)) {
        const next = new Set(host.groupPendingAgents);
        next.delete(payload.agentId);
        host.groupPendingAgents = next;
      }
    }

    if (deltaText.length === 0) {
      scheduleBatchSync(host, payload.agentId);
      return;
    }

    if (host.groupPendingAgents.has(payload.agentId)) {
      const next = new Set(host.groupPendingAgents);
      next.delete(payload.agentId);
      host.groupPendingAgents = next;
    }

    for (const [oldKey] of streamBuffers) {
      const idx = oldKey.indexOf(":");
      if (idx <= 0) {
        continue;
      }
      const oldAgentId = oldKey.slice(0, idx);
      const oldRunId = oldKey.slice(idx + 1);
      if (oldAgentId === payload.agentId && oldRunId !== payload.runId) {
        streamBuffers.delete(oldKey);
      }
    }

    streamBuffers.set(streamKey, deltaText);
    scheduleBatchSync(host, payload.agentId);
    return;
  }

  if (payload.state === "final" || payload.state === "error" || payload.state === "aborted") {
    markGroupStreamInactive(payload.groupId, payload.agentId, payload.runId);
    const chain = groupChainStates.get(payload.groupId);
    if (chain) {
      chain.pendingAgents.delete(payload.agentId);
      chain.lastMessageAt = Date.now();
    }

    if (!isActiveGroup) {
      requestSummaryCheck(host as GroupHost, payload.groupId);
      return;
    }

    if (host.groupPendingAgents.has(payload.agentId)) {
      const nextPending = new Set(host.groupPendingAgents);
      nextPending.delete(payload.agentId);
      host.groupPendingAgents = nextPending;
    }

    const next = new Map(host.groupStreams);
    const currentStream = next.get(payload.agentId);
    if (currentStream && currentStream.runId === payload.runId) {
      next.delete(payload.agentId);
    }
    host.groupStreams = next;

    streamBuffers.delete(`${payload.agentId}:${payload.runId}`);
    pendingSyncAgents.delete(payload.agentId);
    const currentToolMessages = host.groupToolMessages ?? new Map();
    const toolNext = new Map(currentToolMessages);
    toolNext.delete(`${payload.agentId}:${payload.runId}`);
    host.groupToolMessages = toolNext;

    requestSummaryCheck(host as GroupHost, payload.groupId);
    return;
  }
}

function batchSyncGroupStreams(host: GroupChatState): void {
  const agents = new Set(pendingSyncAgents);
  pendingSyncAgents.clear();
  if (agents.size === 0) {
    return;
  }

  const next = new Map(host.groupStreams);
  let changed = false;

  for (const [key, text] of streamBuffers) {
    const colonIdx = key.indexOf(":");
    if (colonIdx <= 0) {
      continue;
    }
    const agentId = key.slice(0, colonIdx);
    const runId = key.slice(colonIdx + 1);
    if (!runId || !agents.has(agentId)) {
      continue;
    }

    const existing = next.get(agentId);
    if (existing?.runId === runId && existing.text === text) {
      continue;
    }

    next.set(agentId, {
      runId,
      text,
      startedAt: existing?.runId === runId ? existing.startedAt : Date.now(),
      timelineOrder:
        existing?.runId === runId ? existing.timelineOrder : allocateTimelineOrder(),
    });
    changed = true;
  }

  if (changed) {
    host.groupStreams = next;
  }
}

export function handleGroupSystemEvent(host: GroupChatState, payload: GroupSystemPayload): void {
  const eventName = getGroupSystemEventName(payload);
  if (!eventName) {
    return;
  }

  const isActiveGroup = payload.groupId === host.activeGroupId;
  const groupHost = host as GroupHost;

  if (eventName === "round_limit") {
    // Reset chain state to prevent further forwards
    resetChainState(payload.groupId);

    if (isActiveGroup) {
      const systemMsg: GroupChatMessage = {
        id: `sys-${Date.now()}`,
        groupId: payload.groupId,
        role: "system",
        content: `已达到最大对话次数限制，对话链结束`,
        sender: { type: "system" },
        serverSeq: 0,
        timestamp: Date.now(),
      };
      host.groupMessages = [...host.groupMessages, systemMsg];
      host.groupPendingAgents = new Set();
      host.groupStreams = new Map();
      host.groupBridgeSnapshots = new Map();
      host.groupToolMessages = new Map();
      streamBuffers.clear();
    }
    return;
  }

  // Handle chain timeout with prominent warning
  if (eventName === "chain_timeout") {
    // Reset chain state FIRST — this prevents detectAndForwardMentions from
    // triggering new forwards for messages that arrive after the timeout.
    // Must happen regardless of whether this is the active group.
    resetChainState(payload.groupId);

    if (isActiveGroup) {
      const systemMsg: GroupChatMessage = {
        id: `sys-${Date.now()}`,
        groupId: payload.groupId,
        role: "system",
        content: `⏱️ 对话链超时，已中断连接`,
        sender: { type: "system" },
        serverSeq: 0,
        timestamp: Date.now(),
      };
      host.groupMessages = [...host.groupMessages, systemMsg];
      // Clear all pending/streaming states since chain is aborted
      host.groupPendingAgents = new Set();
      host.groupStreams = new Map();
      host.groupToolMessages = new Map();
      streamBuffers.clear();
    }
    return;
  }

  if (!groupHost.client || !groupHost.connected) {
    return;
  }

  if (eventName === "archived" || eventName === "deleted") {
    resetChainState(payload.groupId);
    groupMetaCache.delete(payload.groupId);
    groupActiveStreamKeys.delete(payload.groupId);
    clearParsedMentionMessages(payload.groupId);
    if (isActiveGroup) {
      openGroupList(host);
    }
    // Refresh sessions list to remove group chat sessions from the management view
    void loadSessions(groupHost as unknown as Parameters<typeof loadSessions>[0]);
  }

  // Handle messages cleared event
  if (eventName === "messages_cleared") {
    resetChainState(payload.groupId);
    clearParsedMentionMessages(payload.groupId);
    if (isActiveGroup) {
      host.groupMessages = [];
      host.groupStreams = new Map();
      host.groupPendingAgents = new Set();
      host.groupToolMessages = new Map();
      streamBuffers.clear();
    }
    return;
  }

  const shouldRefreshMeta = new Set([
    "assistant_changed",
    "announcement_changed",
    "member_added",
    "member_removed",
    "members_updated",
    "mode_changed",
    "name_changed",
    "skills_changed",
    "context_config_changed",
    "project_docs_changed",
  ]);

  if (shouldRefreshMeta.has(eventName)) {
    void refreshGroupMetaCache(groupHost, payload.groupId);
  }

  if (
    eventName === "created" ||
    eventName === "archived" ||
    eventName === "deleted" ||
    shouldRefreshMeta.has(eventName)
  ) {
    void loadGroupList(groupHost);
  }
}

/** Enter a group chat view */
export async function enterGroupChat(host: GroupHost, groupId: string): Promise<void> {
  host.groupListOpen = true;
  host.activeGroupId = groupId;
  host.activeGroupMeta = groupMetaCache.get(groupId) ?? null;
  host.groupMessages = [];
  host.groupStreams = new Map();
  host.groupBridgeSnapshots = new Map();
  host.groupPendingAgents = new Set();
  host.groupToolMessages = new Map();
  host.groupError = null;
  host.groupNotFound = false;
  host.groupDraft = "";
  host.groupAttachments = [];
  host.bridgeTerminalStatuses = new Map();
  // Clear stale stream buffers from the previous group to avoid ghost bubbles
  streamBuffers.clear();
  await Promise.all([loadGroupInfo(host, groupId), loadGroupHistory(host, groupId)]);
  // Sync URL with group parameter after successfully entering
  if (host.activeGroupId === groupId && !host.groupNotFound) {
    syncUrlWithGroup(groupId);
  }
}

/**
 * Export the current group chat transcript as a Markdown file.
 * Calls group.exportTranscript RPC and triggers a browser download.
 */
export async function exportGroupTranscript(host: GroupHost, groupId: string): Promise<void> {
  if (!host.client || !host.connected) {
    return;
  }
  try {
    const result = await host.client.request<{ markdown: string; filename: string }>(
      "group.exportTranscript",
      { groupId },
    );
    if (!result?.markdown) {
      return;
    }
    // Trigger browser download
    const blob = new Blob([result.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = result.filename ?? "group-chat-export.md";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    // Cleanup
    setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 100);
  } catch (err) {
    host.groupError = `Failed to export transcript: ${String(err)}`;
  }
}

/** Leave group chat room and return to the group list view */
export function leaveGroupChat(host: GroupChatState): void {
  clearUrlGroup();
  openGroupList(host);
}

// ─── Bridge Terminal Event Handlers ───

/** Payload from the `group.terminal` WebSocket event. */
export type GroupTerminalPayload = {
  groupId: string;
  agentId: string;
  /** Base64-encoded raw PTY output */
  data: string;
};

/** Payload from the `group.terminalStatus` WebSocket event. */
export type GroupTerminalStatusPayload = {
  groupId: string;
  agentId: string;
  /** Backend sends BridgePtyStatus; mapped to frontend BridgeTerminalStatus below. */
  status: string;
  /** Optional message (e.g. error details) */
  message?: string;
};

/** Map backend BridgePtyStatus → frontend BridgeTerminalStatus. */
function mapPtyStatusToTerminalStatus(
  backendStatus: string,
): "idle" | "working" | "ready" | "completed" | "timeout" | "error" | "disconnected" {
  switch (backendStatus) {
    case "running":
      // 映射为 ready 而非 working：进程在运行不等于正在执行任务。
      // 实际工作状态由 bridge-terminal 组件根据 PTY 数据流入动态判断。
      // 这避免了页面刷新后错误显示"正在工作"的问题。
      return "ready";
    case "ready":
      return "ready";
    case "stuck":
      return "error";
    case "offline":
      return "disconnected";
    case "idle":
    case "working":
    case "completed":
    case "timeout":
    case "error":
    case "disconnected":
      return backendStatus;
    default:
      return "idle";
  }
}

/**
 * Handle `group.terminal` event — raw PTY data from a Bridge Agent.
 * Routes data to the corresponding BridgeTerminal component.
 */
export function handleGroupTerminalEvent(
  host: GroupChatState,
  payload: GroupTerminalPayload,
): void {
  if (payload.groupId !== host.activeGroupId) {
    return;
  }

  const terminal = getBridgeTerminal(payload.groupId, payload.agentId);

  if (terminal) {
    // Decode base64 back to raw bytes before writing to xterm.
    // Writing the binary string returned by atob() directly will corrupt
    // multibyte UTF-8 characters (for example Chinese text) and can trigger
    // xterm parser errors.
    try {
      const binary = atob(payload.data);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      terminal.writeBinaryData(bytes);
    } catch {
      // If decoding fails, fall back to raw text so output is still visible.
      terminal.writeData(payload.data);
    }
  }

  // Update status to working — but NOT if already in a terminal state.
  // After completion/timeout/error/disconnected, stray PTY data (cursor blinks,
  // heartbeats, pre-kill buffer) should not flip the status back to working
  // until the next explicit trigger.
  const currentStatus = host.bridgeTerminalStatuses?.get(payload.agentId);
  if (
    currentStatus !== "working" &&
    currentStatus !== "completed" &&
    currentStatus !== "timeout" &&
    currentStatus !== "error" &&
    currentStatus !== "disconnected"
  ) {
    const statuses = new Map(host.bridgeTerminalStatuses);
    statuses.set(payload.agentId, "working");
    host.bridgeTerminalStatuses = statuses;
  }
}

/**
 * Handle `group.terminalStatus` event — status change for a Bridge Agent.
 */
export function handleGroupTerminalStatusEvent(
  host: GroupChatState,
  payload: GroupTerminalStatusPayload,
): void {
  if (payload.groupId !== host.activeGroupId) {
    return;
  }

  const mappedStatus = mapPtyStatusToTerminalStatus(payload.status);

  // Guard: once status is "timeout", it should NOT be overridden by
  // transient events like "offline" → "disconnected" (which fires when
  // killBridgePty terminates the process after timeout).  Only an explicit
  // new trigger (→ "working") can re-activate the terminal.
  const currentStatus = host.bridgeTerminalStatuses?.get(payload.agentId);
  if (currentStatus === "timeout" && mappedStatus !== "working") {
    return;
  }

  const statuses = new Map(host.bridgeTerminalStatuses);
  statuses.set(payload.agentId, mappedStatus);
  host.bridgeTerminalStatuses = statuses;

  if (
    mappedStatus === "working" ||
    mappedStatus === "ready" ||
    mappedStatus === "completed" ||
    mappedStatus === "timeout" ||
    mappedStatus === "error" ||
    mappedStatus === "disconnected"
  ) {
    const nextPending = new Set(host.groupPendingAgents);
    nextPending.delete(payload.agentId);
    host.groupPendingAgents = nextPending;
  }

  if (mappedStatus === "working") {
    activeBridgeStreamRuns.delete(payload.agentId);
    const nextStreams = new Map(host.groupStreams);
    nextStreams.delete(payload.agentId);
    host.groupStreams = nextStreams;
    setBridgeSnapshotsTerminalVisible(host, payload.agentId, false);
  }

  if (mappedStatus === "completed" || mappedStatus === "timeout") {
    clearBridgeTerminalStream(host, payload.agentId);
    const terminal = getBridgeTerminal(payload.groupId, payload.agentId);
    if (terminal) {
      const extractedText = terminal.extractVisibleText();
      if (extractedText?.trim() && "client" in host) {
        void sendTerminalTextExtracted(
          host as GroupHost,
          payload.groupId,
          payload.agentId,
          extractedText,
        );
      }
      terminal.completeAndFold(mappedStatus === "timeout" ? "timeout" : "completed");
    }
  }
}

/**
 * Check if a group member is a Bridge Agent.
 */
export function isBridgeAgent(member: GroupMember): boolean {
  return !!member.bridge;
}

/**
 * Check if an agentId belongs to a bridge-assistant.
 */
export function isBridgeAssistantAgent(agentId: string): boolean {
  return agentId.startsWith("__bridge-assistant__");
}

/**
 * Get visible members (excluding bridge-assistants).
 */
export function getVisibleMembers(meta: GroupSessionMeta): GroupMember[] {
  return meta.members.filter((m) => !isBridgeAssistantAgent(m.agentId));
}

/**
 * Send a terminal resize request to the backend.
 */
export async function sendTerminalResize(
  host: GroupHost,
  groupId: string,
  agentId: string,
  cols: number,
  rows: number,
): Promise<void> {
  if (!host.client || !host.connected) {
    return;
  }
  try {
    await host.client.request("group.terminalResize", { groupId, agentId, cols, rows });
  } catch (err) {
    console.warn("[group-chat] terminal resize failed:", err);
  }
}

/**
 * Push extracted terminal text to the backend for transcript persistence.
 *
 * When the frontend detects that the bridge terminal has become idle (no new
 * data for COMPLETION_IDLE_SECS), it extracts the visible text from the xterm
 * buffer and sends it to the backend via this RPC. The backend uses this text
 * to create a proper GroupMessage entry in the transcript, which is then
 * broadcast as `group.message` and persisted in `transcript.jsonl`.
 *
 * This is the critical step that makes bridge terminal output survive page
 * refresh — without it, the backend has no text to write to the transcript.
 */
export async function sendTerminalTextExtracted(
  host: GroupHost,
  groupId: string,
  agentId: string,
  text: string,
): Promise<void> {
  if (!host.client || !host.connected) {
    return;
  }
  try {
    await host.client.request("group.terminalTextExtracted", { groupId, agentId, text });
  } catch (err) {
    console.warn("[group-chat] terminal text extracted push failed:", err);
  }
}

// ─── Bridge Terminal Streaming (Real-time Chat Bubble) ───

/** Synthetic runId prefix for bridge terminal streams (not backend-allocated). */
const BRIDGE_STREAM_RUN_PREFIX = "__bridge__";

/** Map of active bridge stream runIds by agentId. */
const activeBridgeStreamRuns = new Map<string, string>();

/**
 * Get or create a synthetic runId for a bridge agent's current streaming session.
 * The runId is stable for the duration of a working cycle and is reset when
 * the terminal transitions back to working (new cycle).
 */
function getBridgeStreamRunId(agentId: string): string {
  let runId = activeBridgeStreamRuns.get(agentId);
  if (!runId) {
    runId = `${BRIDGE_STREAM_RUN_PREFIX}${agentId}:${Date.now()}`;
    activeBridgeStreamRuns.set(agentId, runId);
  }
  return runId;
}

/**
 * Handle real-time stream updates from a Bridge Terminal component.
 * Injects the visible text (from xterm.js buffer) into the same streaming
 * pipeline used by LLM agents (`streamBuffers` → `groupStreams`).
 *
 * Because xterm.js handles \r, cursor moves, and overwrites internally,
 * the extracted text already reflects in-place updates. The typewriter
 * directive's `commonPrefixLength()` logic handles text rewrites gracefully,
 * giving the chat bubble the same "in-place update" behavior.
 */
export function handleBridgeTerminalStreamUpdate(
  host: GroupChatState,
  groupId: string,
  agentId: string,
  text: string,
): void {
  if (groupId !== host.activeGroupId) {
    return;
  }

  const terminalStatus = host.bridgeTerminalStatuses?.get(agentId);
  if (
    terminalStatus === "completed" ||
    terminalStatus === "error" ||
    terminalStatus === "disconnected"
  ) {
    if (!text.trim()) {
      return;
    }

    const existingSnapshot = findLatestBridgeSnapshotByAgent(host, agentId);
    if (existingSnapshot) {
      upsertBridgeSnapshot(host, {
        groupId: existingSnapshot.groupId,
        agentId: existingSnapshot.agentId,
        runId: existingSnapshot.runId,
        text,
        startedAt: existingSnapshot.startedAt,
        timelineOrder: existingSnapshot.timelineOrder,
        terminalVisible: true,
        terminalStatus,
        source: existingSnapshot.source,
      });
      return;
    }

    const runId = `${BRIDGE_STREAM_RUN_PREFIX}${agentId}:restored`;
    const hasActive = host.groupStreams.get(agentId)?.runId === runId;
    const hasSnapshot = host.groupBridgeSnapshots.has(getBridgeSnapshotKey(agentId, runId));
    if (!hasActive && !hasSnapshot) {
      upsertBridgeSnapshot(host, {
        groupId,
        agentId,
        runId,
        text,
        startedAt: Date.now(),
        timelineOrder: allocateTimelineOrder(),
        terminalVisible: true,
        terminalStatus,
        source: "refresh-recovery",
      });
    }
    return;
  }

  const runId = getBridgeStreamRunId(agentId);
  const streamKey = `${agentId}:${runId}`;

  if (host.groupPendingAgents.has(agentId)) {
    const next = new Set(host.groupPendingAgents);
    next.delete(agentId);
    host.groupPendingAgents = next;
  }

  streamBuffers.set(streamKey, text);
  scheduleBatchSync(host, agentId);
}

/**
 * Convert the active bridge streaming bubble into a frozen snapshot when the
 * current run completes. This removes the active stream entry and persists the
 * frozen UI state in `groupBridgeSnapshots` instead of `groupStreams`.
 */
export function clearBridgeTerminalStream(host: GroupChatState, agentId: string): void {
  const runId = activeBridgeStreamRuns.get(agentId);

  if (runId) {
    streamBuffers.delete(`${agentId}:${runId}`);
  }

  for (const key of streamBuffers.keys()) {
    if (key.startsWith(`${agentId}:${BRIDGE_STREAM_RUN_PREFIX}`)) {
      streamBuffers.delete(key);
    }
  }
  pendingSyncAgents.delete(agentId);

  const nextStreams = new Map(host.groupStreams);
  const currentStream = nextStreams.get(agentId);
  if (currentStream) {
    const isExactMatch = runId && currentStream.runId === runId;
    const isBridgeStream = currentStream.runId.startsWith(BRIDGE_STREAM_RUN_PREFIX);
    if (isExactMatch || isBridgeStream) {
      nextStreams.delete(agentId);
      host.groupStreams = nextStreams;

      const text = currentStream.text?.trim() ?? "";
      if (text) {
        upsertBridgeSnapshot(host, {
          groupId: host.activeGroupId ?? "",
          agentId,
          runId: currentStream.runId,
          text: currentStream.text,
          startedAt: currentStream.startedAt,
          timelineOrder: currentStream.timelineOrder,
          terminalVisible: true,
          terminalStatus: host.bridgeTerminalStatuses?.get(agentId) ?? "completed",
          source: "live-freeze",
        });
      }
    }
  }

  activeBridgeStreamRuns.delete(agentId);
  flushPendingBridgeSyncIfNeeded(host);
}
