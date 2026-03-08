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
  errorMessage?: string;
  /** Tool messages for real-time tool card display */
  toolMessages?: GroupToolMessage[];
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

// ─── @mention Detection & Auto-Forward ───

/**
 * Extract routing targets from lines that contain ONLY @mentions.
 * Uses exact matching based on member IDs (not regex patterns).
 *
 * @param content - The message content to parse
 * @param memberIds - List of valid member agentIds for exact matching
 * @returns Array of member IDs mentioned on dedicated lines
 *
 * Examples (with memberIds = ["dev", "test"]):
 * - "@dev" → ["dev"] (triggers routing)
 * - "@dev @test" → ["dev", "test"] (triggers routing to both)
 * - "请回答 @dev" → [] (same line has other content, no routing)
 * - "@unknown" → [] (not a member, no routing)
 */
export function extractDedicatedMentions(content: string, memberIds: string[]): string[] {
  if (!memberIds.length) {
    return [];
  }

  const lines = content.trim().split("\n");
  const mentions: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      continue;
    }

    // Check if line is ONLY @mentions (possibly multiple, separated by spaces)
    // Pattern: "@id1 @id2 @id3" where each id is a valid member
    const parts = trimmedLine.split(/\s+/);
    let allPartsAreMentions = true;
    const lineMentions: string[] = [];

    for (const part of parts) {
      if (part.startsWith("@")) {
        const agentId = part.slice(1);
        // Only count as mention if it's a valid member
        if (memberIds.includes(agentId)) {
          lineMentions.push(agentId);
        } else {
          // Not a valid member, so this part is just regular text
          allPartsAreMentions = false;
          break;
        }
      } else {
        // Not a mention at all
        allPartsAreMentions = false;
        break;
      }
    }

    // Only add mentions if the ENTIRE line is made of valid @mentions
    if (allPartsAreMentions && lineMentions.length > 0) {
      mentions.push(...lineMentions);
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

/** Per-group chain state for forward limiting and initiator tracking */
type ChainState = {
  count: number;
  startedAt: number;
  initiators: string[]; // Ordered list of agents who @mentioned others (deduped)
  pendingAgents: Set<string>; // Agents triggered but not yet replied
  lastMessageAt: number; // Timestamp of last message
};

const groupChainStates = new Map<string, ChainState>();

// Summary timers and counters
const summaryTimers = new Map<string, number>();
const summaryRounds = new Map<string, number>();

const MAX_CHAIN_FORWARDS = 10;
const MAX_CHAIN_DURATION_MS = 5 * 60_000; // 5 minutes
const SUMMARY_DELAY_MS = 10_000; // Wait after all agents replied
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

/** Cancel summary timer for a group */
function cancelSummaryTimer(groupId: string): void {
  const timer = summaryTimers.get(groupId);
  if (timer) {
    clearTimeout(timer);
    summaryTimers.delete(groupId);
  }
}

/** Schedule a summary check */
function scheduleSummaryCheck(host: GroupHost, groupId: string): void {
  const chain = groupChainStates.get(groupId);
  if (!chain || chain.initiators.length === 0) {
    return;
  }

  // Cancel existing timer
  cancelSummaryTimer(groupId);

  const now = Date.now();
  const elapsed = now - chain.lastMessageAt;
  const totalWait = now - chain.startedAt;

  let delay: number;

  if (chain.pendingAgents.size === 0) {
    // All agents replied, wait SUMMARY_DELAY_MS
    delay = Math.max(0, SUMMARY_DELAY_MS - elapsed);
  } else {
    // Some agents pending
    if (totalWait >= MAX_PENDING_WAIT_MS) {
      // Waited too long, trigger summary immediately
      delay = 0;
    } else {
      // Continue waiting
      delay = Math.min(SUMMARY_DELAY_MS, MAX_PENDING_WAIT_MS - totalWait);
    }
  }

  const timer = window.setTimeout(() => {
    void sendSummaryMessage(host, groupId);
  }, delay);
  summaryTimers.set(groupId, timer);
}

/** Send summary message to trigger initiators */
async function sendSummaryMessage(host: GroupHost, groupId: string): Promise<void> {
  const chain = groupChainStates.get(groupId);
  if (!chain || chain.initiators.length === 0) {
    return;
  }

  // Check summary rounds limit
  const rounds = summaryRounds.get(groupId) ?? 0;
  if (rounds >= MAX_SUMMARY_ROUNDS) {
    console.log(`[group-chat] summary rounds limit: group=${groupId} rounds=${rounds}`);
    return;
  }

  // Filter out initiators who left the group
  const meta = host.activeGroupMeta;
  if (!meta || !host.client || !host.connected) {
    return;
  }

  const validInitiators = chain.initiators.filter((id) =>
    meta.members.some((m) => m.agentId === id),
  );

  if (validInitiators.length === 0) {
    return;
  }

  // Increment summary rounds
  summaryRounds.set(groupId, rounds + 1);

  // Show summary trigger notification
  appendSystemMessageToUI(
    host,
    groupId,
    `📢 已触发汇总，等待 ${validInitiators.map((id) => `@${id}`).join(" ")} 回复...`,
  );

  // Summary message
  const summaryMessage = `请确认是否有新的想法或补充。

如果当前讨论已结束或没有新内容，可以：
- 不回复（跳过）
- 回复简单语句，如"收到"、"明白"、"了解"`;

  try {
    await host.client.request("group.send", {
      groupId,
      message: summaryMessage,
      mentions: validInitiators,
      sender: { type: "owner" },
      skipTranscript: true,
    });

    // Reset chain state after summary (clear initiators for new round)
    const now = Date.now();
    groupChainStates.set(groupId, {
      count: 0,
      startedAt: now,
      initiators: [], // Clear for new round
      pendingAgents: new Set(validInitiators), // Track who was triggered
      lastMessageAt: now,
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
 * IMPORTANT: Only mentions on DEDICATED LINES (lines with only @mentions)
 * trigger routing. Mentions on lines with other content are for display only.
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
  // Get all member IDs for filtering dedicated mention lines
  const allMemberIds = meta.members.map((m) => m.agentId);
  // Get current chain state to exclude initiators from mention matching
  // This prevents initiators from being unexpectedly triggered mid-conversation
  const currentChain = groupChainStates.get(message.groupId);
  const initiatorSet = new Set(currentChain?.initiators ?? []);
  // Exclude initiators from memberIds so @initiator won't trigger them
  const memberIds = allMemberIds.filter((id) => !initiatorSet.has(id));

  // Only extract mentions from DEDICATED LINES (lines with only @mentions)
  const dedicatedMentions = extractDedicatedMentions(message.content, memberIds);

  if (dedicatedMentions.length === 0) {
    // No dedicated mention lines → chain naturally ends
    resetChainState(message.groupId);
    return;
  }

  // Exclude sender from mentions
  const senderAgentId = message.sender.type === "agent" ? message.sender.agentId : undefined;
  const mentionedIds = [...new Set(dedicatedMentions.filter((id) => id !== senderAgentId))];

  if (mentionedIds.length === 0) {
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

  // Update chain state
  chain.count += 1;
  chain.lastMessageAt = now;

  // Track initiator (agent who @mentioned others)
  if (senderAgentId) {
    addInitiator(chain, senderAgentId);
  }

  // Track pending agents (who will be triggered)
  for (const id of mentionedIds) {
    chain.pendingAgents.add(id);
  }

  // Remove dedicated mention lines from forwarded message (they're routing markers, not content)
  // Keep inline mentions as-is for display
  const lines = message.content.split("\n");
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
    `[group-chat] auto-forward: group=${message.groupId} from=${senderAgentId} to=[${mentionedIds.join(",")}] chain=${chain.count}/${MAX_CHAIN_FORWARDS}`,
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

  // Owner sends a new message → reset chain state but preserve initiators
  const existingChain = groupChainStates.get(groupId);
  const existingInitiators = existingChain?.initiators ?? [];

  // Cancel any pending summary timer
  cancelSummaryTimer(groupId);

  // Reset summary rounds (new conversation)
  summaryRounds.delete(groupId);

  // Reset chain state with preserved initiators
  const now = Date.now();
  groupChainStates.set(groupId, {
    count: 0,
    startedAt: now,
    initiators: existingInitiators, // Keep previous initiators
    pendingAgents: new Set(),
    lastMessageAt: now,
  });

  host.groupSending = true;
  host.groupError = null;

  // Predict which agents will respond so we can show pending indicators immediately
  const meta = host.activeGroupMeta;
  if (meta) {
    const pendingAgents = resolvePendingAgents(meta, mentions);
    if (pendingAgents.length > 0) {
      host.groupPendingAgents = new Set(pendingAgents);
      // Also add to chain's pendingAgents
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

export async function updateGroupThinkingLevel(
  host: GroupHost,
  groupId: string,
  level: string,
): Promise<void> {
  return updateGroupSettings(host, groupId, "setThinkingLevel", { level });
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
  if (payload.groupId !== host.activeGroupId) {
    return;
  }
  // Deduplicate by message id
  if (host.groupMessages.some((m) => m.id === payload.id)) {
    return;
  }
  host.groupMessages = [...host.groupMessages, payload];

  // Track agent reply and schedule summary check
  if (payload.sender.type === "agent") {
    const chain = groupChainStates.get(payload.groupId);
    if (chain) {
      // Remove from pending agents (they replied)
      chain.pendingAgents.delete(payload.sender.agentId);
      chain.lastMessageAt = Date.now();
    }

    // Auto-detect @mentions and forward
    void detectAndForwardMentions(host as GroupHost, payload);

    // Schedule summary check after message processed
    scheduleSummaryCheck(host as GroupHost, payload.groupId);
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
    // Key for this agent's run (used for tool messages and stream buffers)
    const streamKey = `${payload.agentId}:${payload.runId}`;

    // Handle tool messages FIRST (even if text is empty)
    // This ensures tool cards show immediately when tools start executing
    if (payload.toolMessages && payload.toolMessages.length > 0) {
      const currentToolMessages = host.groupToolMessages ?? new Map();
      const existingTools = currentToolMessages.get(streamKey) ?? [];
      // Merge new tool messages, avoiding duplicates by id
      const newToolMap = new Map(existingTools.map((t) => [t.id, t]));
      for (const toolMsg of payload.toolMessages) {
        newToolMap.set(toolMsg.id, toolMsg);
      }
      host.groupToolMessages = new Map(currentToolMessages).set(
        streamKey,
        Array.from(newToolMap.values()),
      );

      // Create a placeholder stream entry for tool messages (if no text content yet)
      // This allows tool cards to render even before the agent starts streaming text
      if (!streamBuffers.has(streamKey)) {
        streamBuffers.set(streamKey, ""); // Empty placeholder
      }

      // Remove from pending and show streaming bubble with tool cards
      if (host.groupPendingAgents.has(payload.agentId)) {
        const next = new Set(host.groupPendingAgents);
        next.delete(payload.agentId);
        host.groupPendingAgents = next;
      }
    }

    // Empty delta means "stream started but no content yet" - but tool messages may exist
    // Still need to trigger sync so tool cards can render
    if (deltaText.length === 0) {
      // Trigger UI sync for tool messages (even if no text content)
      if (!streamSyncTimer) {
        streamSyncTimer = window.setTimeout(() => {
          syncGroupStreams(host);
          streamSyncTimer = null;
        }, 50);
      }
      return;
    }

    // Non-empty delta: remove from pending and show streaming bubble
    if (host.groupPendingAgents.has(payload.agentId)) {
      const next = new Set(host.groupPendingAgents);
      next.delete(payload.agentId);
      host.groupPendingAgents = next;
    }

    // Buffer stream updates, throttle at 50ms
    // Clean up old buffers for the same agent (if this is a new run)
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
    // Clear tool messages for this run (they're now in the transcript)
    const currentToolMessages = host.groupToolMessages ?? new Map();
    const toolNext = new Map(currentToolMessages);
    toolNext.delete(`${payload.agentId}:${payload.runId}`);
    host.groupToolMessages = toolNext;
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
  host.groupToolMessages = new Map();
  host.groupError = null;
  host.groupDraft = "";
}
