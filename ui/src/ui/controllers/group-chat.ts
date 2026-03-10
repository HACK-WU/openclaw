/**
 * Group Chat — Frontend Controller
 *
 * Handles all group.* RPC calls and group chat state management.
 * Follows the same patterns as controllers/chat.ts.
 */

import { stripThinkingTags } from "../format.ts";
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
  /** Thinking level for all agents in this group */
  thinkingLevel?: string;
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
  groupStreams: Map<string, { runId: string; text: string; startedAt: number }>;
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
  /** Error state */
  groupError: string | null;
  /** Create dialog state */
  groupCreateDialog: GroupCreateDialogState | null;
  /** Add member dialog state */
  groupAddMemberDialog: GroupAddMemberDialogState | null;
  /** Disband group dialog state */
  groupDisbandDialog: GroupDisbandDialogState | null;
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

export type GroupDisbandDialogState = {
  groupId: string;
  groupName: string;
  isDisbanding: boolean;
  error: string | null;
};

export const DEFAULT_GROUP_CHAT_STATE: GroupChatState = {
  activeGroupId: null,
  groupListOpen: false,
  activeGroupMeta: null,
  groupMessages: [],
  groupStreams: new Map(),
  groupPendingAgents: new Set(),
  groupToolMessages: new Map(),
  groupIndex: [],
  groupListLoading: false,
  groupChatLoading: false,
  groupSending: false,
  groupDraft: "",
  groupError: null,
  groupCreateDialog: null,
  groupDisbandDialog: null,
  groupAddMemberDialog: null,
  groupInfoPanelOpen: false,
};

// ─── Helpers ───

export type GroupHost = {
  client: GatewayBrowserClient | null;
  connected: boolean;
} & GroupChatState;

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
  host.groupPendingAgents = new Set();
  host.groupToolMessages = new Map();
  host.groupChatLoading = false;
  host.groupSending = false;
  host.groupDraft = "";
  host.groupError = null;
  host.groupAddMemberDialog = null;
  host.groupDisbandDialog = null;
  host.groupInfoPanelOpen = false;
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
const PRE_SUMMARY_DELIVER_MS = 5_000; // Deliver pending mentions 5s before summary
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
    console.log(`[group-chat] scheduleSummaryCheck: no chain for ${groupId}`);
    return;
  }
  if (chain.initiators.length === 0) {
    console.log(`[group-chat] scheduleSummaryCheck: no initiators for ${groupId}`);
    return;
  }

  const hasPendingAgents = chain.pendingAgents.size > 0;
  const activeStreamCount = getGroupActiveStreamCount(groupId);
  const hasActiveStreams = activeStreamCount > 0;
  const isConversationBusy = hasPendingAgents || hasActiveStreams;

  console.log(
    `[group-chat] scheduleSummaryCheck: group=${groupId} initiators=[${chain.initiators.join(",")}] ` +
      `pendingAgents=[${[...chain.pendingAgents].join(",")}] ` +
      `busy=${isConversationBusy} (pending=${hasPendingAgents}, streams=${activeStreamCount})`,
  );

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

  console.log(`[group-chat] scheduleSummaryCheck: scheduling summary in ${delay}ms`);

  const timer = window.setTimeout(() => {
    void executeSummaryFlow(host, groupId);
  }, delay);
  summaryTimers.set(groupId, timer);
}

/**
 * Execute summary flow:
 * 1. Deliver pending mentions to non-initiator agents
 * 2. Wait 5 seconds for them to process
 * 3. Send summary to initiators
 */
async function executeSummaryFlow(host: GroupHost, groupId: string): Promise<void> {
  cancelSummaryTimer(groupId);
  if (summaryInFlight.has(groupId)) {
    summaryRerunRequested.add(groupId);
    return;
  }

  console.log(`[group-chat] executeSummaryFlow: starting for ${groupId}`);
  const chain = groupChainStates.get(groupId);
  if (!chain) {
    console.log(`[group-chat] executeSummaryFlow: no chain for ${groupId}`);
    return;
  }

  summaryInFlight.add(groupId);
  try {
    await deliverPendingMentions(host, groupId);
    await new Promise((resolve) => setTimeout(resolve, PRE_SUMMARY_DELIVER_MS));

    const latestChain = groupChainStates.get(groupId);
    if (latestChain?.initiators.length) {
      await sendSummaryMessage(host, groupId);
    }
  } finally {
    summaryInFlight.delete(groupId);
    if (summaryRerunRequested.delete(groupId)) {
      scheduleSummaryCheck(host, groupId);
    }
  }
}

/**
 * Deliver pending @mention messages to non-initiator agents.
 * Initiators will receive their pending mentions in the summary message.
 */
async function deliverPendingMentions(host: GroupHost, groupId: string): Promise<void> {
  const chain = groupChainStates.get(groupId);
  if (!chain || chain.pendingMentions.length === 0 || !host.client || !host.connected) {
    return;
  }

  const meta = await resolveGroupMeta(host, groupId);
  if (!meta) {
    return;
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
      console.log(
        `[group-chat] delivered pending mentions to ${agentId}: ${pendings.length} messages`,
      );
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
  }
}

/** Send summary message to trigger initiators */
async function sendSummaryMessage(host: GroupHost, groupId: string): Promise<void> {
  const chain = groupChainStates.get(groupId);
  if (!chain || chain.initiators.length === 0) {
    return;
  }

  const rounds = summaryRounds.get(groupId) ?? 0;
  if (rounds >= MAX_SUMMARY_ROUNDS) {
    console.log(`[group-chat] summary rounds limit: group=${groupId} rounds=${rounds}`);
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

    const now = Date.now();
    groupChainStates.set(groupId, {
      count: 0,
      startedAt: now,
      initiators: [],
      pendingAgents: new Set(validInitiators),
      lastMessageAt: now,
      mentionedAgents: [],
      pendingMentions: [],
    });

    console.log(`[group-chat] summary sent: group=${groupId} to=[${validInitiators.join(",")}]`);
  } catch (err) {
    console.error(`[group-chat] summary failed: group=${groupId}`, err);
  }
}

/** Reset chain state — new conversation round */
export function resetChainState(groupId: string): void {
  if (groupChainStates.has(groupId)) {
    console.log(`[group-chat] chain state reset: group=${groupId}`);
  }
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
    console.log(
      `[group-chat] no dedicated mentions, chain exists: ${!!chain}, initiators: [${chain?.initiators.join(",") ?? "none"}]`,
    );
    if (chain && chain.initiators.length > 0) {
      chain.lastMessageAt = Date.now();
      console.log(`[group-chat] scheduling summary check due to no mentions`);
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
    console.log(
      `[group-chat] added initiator: ${senderAgentId}, current initiators: [${chain.initiators.join(",")}]`,
    );
  }

  // Separate first-time mentions from repeated mentions
  const firstTimeMentions: string[] = [];

  for (const agentId of mentionedIds) {
    if (hasBeenMentioned(chain, agentId)) {
      // Already triggered in this chain, save for later delivery
      chain.pendingMentions.push({
        agentId,
        message,
        fromAgentId: senderAgentId ?? "unknown",
      });
      console.log(`[group-chat] pending mention saved: ${agentId} already triggered`);
    } else {
      // First time being mentioned
      firstTimeMentions.push(agentId);
      addMentionedAgent(chain, agentId);
    }
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

  console.log(
    `[group-chat] auto-forward: group=${message.groupId} from=${senderAgentId} to=[${firstTimeMentions.join(",")}] chain=${chain.count}/${MAX_CHAIN_FORWARDS}`,
  );

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
    }
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
    await host.client.request("group.send", {
      groupId,
      message: message.trim(),
      mentions: mentions?.length ? mentions : undefined,
    });
    host.groupDraft = "";
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
    resetChainState(groupId);
    groupMetaCache.delete(groupId);
    groupActiveStreamKeys.delete(groupId);
    clearParsedMentionMessages(groupId);
    if (host.activeGroupId === groupId) {
      openGroupList(host);
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
  return updateGroupSettings(host, groupId, "setMaxRounds", { maxRounds });
}

export async function updateGroupMaxConsecutive(
  host: GroupHost,
  groupId: string,
  maxConsecutive: number,
): Promise<void> {
  return updateGroupSettings(host, groupId, "setMaxConsecutive", { maxConsecutive });
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

// ─── Event Handlers ───

export function handleGroupMessageEvent(
  host: GroupChatState,
  payload: { groupId: string } & GroupChatMessage,
): void {
  console.log("[GROUP_CHAT_DEBUG] RECEIVED_MESSAGE", {
    timestamp: new Date().toISOString(),
    groupId: payload.groupId,
    messageId: payload.id,
    sender: payload.sender,
    role: payload.role,
    serverSeq: payload.serverSeq,
    messageTimestamp: payload.timestamp,
    contentLength: payload.content.length,
    contentPreview: payload.content.slice(0, 100),
    mentions: payload.mentions,
  });

  const isActiveGroup = payload.groupId === host.activeGroupId;
  if (isActiveGroup) {
    if (host.groupMessages.some((m) => m.id === payload.id)) {
      console.log("[GROUP_CHAT_DEBUG] DUPLICATE_MESSAGE_SKIPPED", {
        messageId: payload.id,
      });
    } else {
      host.groupMessages = [...host.groupMessages, payload];
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
let streamSyncTimer: number | null = null;

export function handleGroupStreamEvent(host: GroupChatState, payload: GroupStreamPayload): void {
  console.log("[GROUP_CHAT_DEBUG] RECEIVED_STREAM", {
    timestamp: new Date().toISOString(),
    groupId: payload.groupId,
    agentId: payload.agentId,
    runId: payload.runId,
    state: payload.state,
    contentLength: payload.content?.length ?? 0,
    hasMessage: !!payload.message,
    messageSender: payload.message?.sender,
    messageContent: payload.message?.content?.slice(0, 100),
  });

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
      if (!streamSyncTimer) {
        streamSyncTimer = window.setTimeout(() => {
          syncGroupStreams(host);
          streamSyncTimer = null;
        }, 50);
      }
      return;
    }

    if (host.groupPendingAgents.has(payload.agentId)) {
      const next = new Set(host.groupPendingAgents);
      next.delete(payload.agentId);
      host.groupPendingAgents = next;
    }

    for (const [oldKey] of streamBuffers) {
      const [oldAgentId, oldRunId] = oldKey.split(":");
      if (oldAgentId === payload.agentId && oldRunId !== payload.runId) {
        streamBuffers.delete(oldKey);
      }
    }

    streamBuffers.set(streamKey, deltaText);

    if (!streamSyncTimer) {
      streamSyncTimer = window.setTimeout(() => {
        syncGroupStreams(host);
        streamSyncTimer = null;
      }, 50);
    }
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
      const next = new Set(host.groupPendingAgents);
      next.delete(payload.agentId);
      host.groupPendingAgents = next;
    }

    const next = new Map(host.groupStreams);
    const currentStream = next.get(payload.agentId);
    if (currentStream && currentStream.runId === payload.runId) {
      next.delete(payload.agentId);
    }
    host.groupStreams = next;

    streamBuffers.delete(`${payload.agentId}:${payload.runId}`);
    const currentToolMessages = host.groupToolMessages ?? new Map();
    const toolNext = new Map(currentToolMessages);
    toolNext.delete(`${payload.agentId}:${payload.runId}`);
    host.groupToolMessages = toolNext;

    requestSummaryCheck(host as GroupHost, payload.groupId);
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
  const eventName = getGroupSystemEventName(payload);
  if (!eventName) {
    return;
  }

  const isActiveGroup = payload.groupId === host.activeGroupId;
  const groupHost = host as GroupHost;

  if (eventName === "round_limit" && isActiveGroup) {
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
    return;
  }

  if (!groupHost.client || !groupHost.connected) {
    return;
  }

  if (eventName === "archived") {
    resetChainState(payload.groupId);
    groupMetaCache.delete(payload.groupId);
    groupActiveStreamKeys.delete(payload.groupId);
    clearParsedMentionMessages(payload.groupId);
    if (isActiveGroup) {
      openGroupList(host);
    }
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
  ]);

  if (shouldRefreshMeta.has(eventName)) {
    void refreshGroupMetaCache(groupHost, payload.groupId);
  }

  if (eventName === "created" || eventName === "archived" || shouldRefreshMeta.has(eventName)) {
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
  host.groupPendingAgents = new Set();
  host.groupToolMessages = new Map();
  host.groupError = null;
  host.groupDraft = "";
  // Clear stale stream buffers from the previous group to avoid ghost bubbles
  streamBuffers.clear();
  await Promise.all([loadGroupInfo(host, groupId), loadGroupHistory(host, groupId)]);
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
  openGroupList(host);
}
