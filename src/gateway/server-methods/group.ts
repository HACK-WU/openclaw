/**
 * Group Chat — RPC Handlers
 *
 * Implements all group.* gateway methods.
 * Follows the same handler pattern as sessions.ts / chat.ts.
 */

import { randomUUID } from "node:crypto";
import { findCliAgentEntry } from "../../commands/cli-agents.config.js";
import { triggerAgentReasoning } from "../../group-chat/agent-trigger.js";
import {
  cleanupGroupBridgeAgents,
  getGroupActivePtys,
  getPtyReplayBuffer,
  killBridgePty,
  recordFrontendExtractedText,
  resizePty,
} from "../../group-chat/bridge-pty.js";
import type { BridgeConfig, ContextConfig } from "../../group-chat/bridge-types.js";
import {
  initChainState,
  atomicCheckAndIncrement,
  getChainState,
  getDefaultChainTimeout,
  startChainMonitor,
  setChainMonitor,
  stopChainMonitor,
  removeChainMonitor,
  hasActiveMonitor,
  enqueueOwnerMessage,
  drainQueuedMessages,
} from "../../group-chat/chain-state-store.js";
import { buildGroupSessionKey } from "../../group-chat/group-session-key.js";
import {
  archiveGroup,
  createGroup,
  loadGroupIndex,
  loadGroupMeta,
  updateGroupMeta,
} from "../../group-chat/group-store.js";
import { resolveDispatchTargets } from "../../group-chat/message-dispatch.js";
import {
  broadcastGroupMessage,
  broadcastGroupSystem,
  registerGroupAbort,
  unregisterGroupAbort,
  abortGroupRun,
} from "../../group-chat/parallel-stream.js";
import {
  appendGroupMessage,
  appendSystemMessage,
  readGroupMessages,
  getTranscriptSnapshot,
} from "../../group-chat/transcript.js";
import type { GroupIndexEntry as RawGroupIndexEntry } from "../../group-chat/types.js";
import type { GroupChatMessage, MessageSender } from "../../group-chat/types.js";
import { getLogger } from "../../logging.js";
import type { GatewayRequestHandler, GatewayRequestHandlers } from "./types.js";

const log = getLogger("group-chat:handler");

// ─── CLI Agent → Bridge Config Resolution ───
// When a member is added without an explicit bridge config,
// check if it matches a CLI Agent and auto-populate the bridge.

function resolveBridgeForMember(member: {
  agentId: string;
  bridge?: BridgeConfig;
}): BridgeConfig | undefined {
  if (member.bridge) {
    return member.bridge;
  }
  const cliEntry = findCliAgentEntry(member.agentId);
  if (!cliEntry) {
    return undefined;
  }
  return {
    type: cliEntry.type,
    command: cliEntry.command,
    args: cliEntry.args,
    cwd: cliEntry.cwd,
    env: cliEntry.env,
    timeout: cliEntry.timeout,
    avatar: cliEntry.emoji,
    tailTrimMarker: cliEntry.tailTrimMarker,
  };
}

// ─── Handlers ───

const handleGroupCreate: GatewayRequestHandler = async ({ params, respond, context }) => {
  const members = params.members as Array<{
    agentId: string;
    role: "assistant" | "member" | "bridge-assistant";
    bridge?: BridgeConfig;
  }>;
  if (!Array.isArray(members) || members.length === 0) {
    respond(false, undefined, { message: "members is required and must be non-empty", code: 400 });
    return;
  }

  const assistants = members.filter((m) => m.role === "assistant");
  if (assistants.length !== 1) {
    respond(false, undefined, { message: "Exactly one assistant is required", code: 400 });
    return;
  }

  const project = params.project as { directory?: string; docs?: string[] } | undefined;
  const contextConfig = params.contextConfig as ContextConfig | undefined;

  const entry = await createGroup({
    name: (params.name as string) || undefined,
    members: members.map((m) => ({
      ...m,
      bridge: resolveBridgeForMember(m) ?? m.bridge,
    })),
    messageMode: (params.messageMode as "unicast" | "broadcast") || undefined,
    project,
    contextConfig,
  });

  respond(true, {
    groupId: entry.groupId,
    sessionKey: buildGroupSessionKey(entry.groupId),
  });

  broadcastGroupSystem(context.broadcast, entry.groupId, "created", { entry });
};

const handleGroupList: GatewayRequestHandler = ({ respond }) => {
  const index = loadGroupIndex();
  // Load full meta for each group to get memberCount and messageMode
  const mapped = index
    .map((entry: RawGroupIndexEntry) => {
      const meta = loadGroupMeta(entry.groupId);
      return {
        groupId: entry.groupId,
        name: entry.groupName ?? "",
        memberCount: meta?.members.length ?? 0,
        messageMode: meta?.messageMode ?? "unicast",
        createdAt: meta?.createdAt ?? entry.updatedAt,
        updatedAt: entry.updatedAt,
        archived: entry.archived ?? false,
      };
    })
    .filter((g) => !g.archived);
  respond(true, mapped);
};

const handleGroupInfo: GatewayRequestHandler = ({ params, respond }) => {
  const groupId = params.groupId as string;
  if (!groupId) {
    respond(false, undefined, { message: "groupId is required", code: 400 });
    return;
  }
  const meta = loadGroupMeta(groupId);
  if (!meta) {
    respond(false, undefined, { message: "Group not found", code: 404 });
    return;
  }

  // Get active PTY states for terminal restoration after page refresh
  const activePtys = getGroupActivePtys(groupId);
  const bridgeTerminalStatuses: Record<string, string> = {};
  const bridgeTerminalReplayBuffers: Record<string, string> = {};

  for (const [agentId, status] of activePtys.entries()) {
    bridgeTerminalStatuses[agentId] = status;

    // Get replay buffer for each active PTY (to restore terminal content after page refresh)
    const replayBuffer = getPtyReplayBuffer(groupId, agentId);
    if (replayBuffer) {
      bridgeTerminalReplayBuffers[agentId] = replayBuffer;
    }
  }

  // Map groupName to name for frontend compatibility
  const { groupName, ...rest } = meta;
  respond(true, {
    ...rest,
    name: groupName ?? "",
    bridgeTerminalStatuses, // Include active terminal states
    bridgeTerminalReplayBuffers, // Include terminal replay buffers for content restoration
  });
};

const handleGroupDelete: GatewayRequestHandler = async ({ params, respond, context }) => {
  const groupId = params.groupId as string;
  if (!groupId) {
    respond(false, undefined, { message: "groupId is required", code: 400 });
    return;
  }

  // Cleanup all Bridge Agent PTY processes before archiving
  await cleanupGroupBridgeAgents(groupId, context.broadcast);

  await archiveGroup(groupId);
  respond(true, { ok: true });
  broadcastGroupSystem(context.broadcast, groupId, "archived", {});
};

const handleGroupAddMembers: GatewayRequestHandler = async ({ params, respond, context }) => {
  const groupId = params.groupId as string;
  const newMembers = params.members as Array<{
    agentId: string;
    role?: "member" | "bridge-assistant";
    bridge?: BridgeConfig;
  }>;
  if (!groupId || !Array.isArray(newMembers) || newMembers.length === 0) {
    respond(false, undefined, { message: "groupId and members are required", code: 400 });
    return;
  }

  const updated = await updateGroupMeta(groupId, (meta) => {
    const existingIds = new Set(meta.members.map((m) => m.agentId));
    const now = Date.now();
    for (const nm of newMembers) {
      if (!existingIds.has(nm.agentId)) {
        const bridge = resolveBridgeForMember(nm);
        meta.members.push({
          agentId: nm.agentId,
          role: nm.role ?? "member",
          joinedAt: now,
          ...(bridge ? { bridge } : {}),
        });
      }
    }
    return meta;
  });

  respond(true, { ok: true });

  for (const nm of newMembers) {
    await appendSystemMessage(groupId, `${nm.agentId} joined the group`);
  }
  broadcastGroupSystem(context.broadcast, groupId, "member_added", {
    members: updated.members,
  });
};

const handleGroupRemoveMembers: GatewayRequestHandler = async ({ params, respond, context }) => {
  const groupId = params.groupId as string;
  const agentIds = params.agentIds as string[];
  if (!groupId || !Array.isArray(agentIds) || agentIds.length === 0) {
    respond(false, undefined, { message: "groupId and agentIds are required", code: 400 });
    return;
  }

  // Before removing, check if any are Bridge Agents and cleanup PTY processes
  const meta = loadGroupMeta(groupId);
  if (meta) {
    for (const id of agentIds) {
      const member = meta.members.find((m) => m.agentId === id);
      if (member?.bridge) {
        await killBridgePty(groupId, id, "member_removed");
      }
    }
  }

  const updated = await updateGroupMeta(groupId, (m) => {
    const removeSet = new Set(agentIds);
    // Cannot remove the assistant
    const assistant = m.members.find((mem) => mem.role === "assistant");
    if (assistant && removeSet.has(assistant.agentId)) {
      removeSet.delete(assistant.agentId);
    }
    m.members = m.members.filter((mem) => !removeSet.has(mem.agentId));
    m.memberRolePrompts = m.memberRolePrompts.filter((p) => !removeSet.has(p.agentId));
    return m;
  });

  respond(true, { ok: true });

  for (const id of agentIds) {
    await appendSystemMessage(groupId, `${id} was removed from the group`);
  }
  broadcastGroupSystem(context.broadcast, groupId, "member_removed", {
    members: updated.members,
  });
};

const handleGroupSetAssistant: GatewayRequestHandler = async ({ params, respond, context }) => {
  const groupId = params.groupId as string;
  const agentId = params.agentId as string;
  if (!groupId || !agentId) {
    respond(false, undefined, { message: "groupId and agentId are required", code: 400 });
    return;
  }

  const updated = await updateGroupMeta(groupId, (meta) => {
    const target = meta.members.find((m) => m.agentId === agentId);
    if (!target) {
      throw new Error(`Agent ${agentId} is not a member of this group`);
    }

    for (const m of meta.members) {
      m.role = m.agentId === agentId ? "assistant" : "member";
    }
    return meta;
  });

  respond(true, { ok: true });
  await appendSystemMessage(groupId, `${agentId} is now the assistant`);
  broadcastGroupSystem(context.broadcast, groupId, "assistant_changed", {
    members: updated.members,
  });
};

const handleGroupSetMessageMode: GatewayRequestHandler = async ({ params, respond, context }) => {
  const groupId = params.groupId as string;
  const mode = params.mode as "unicast" | "broadcast";
  if (!groupId || !mode) {
    respond(false, undefined, { message: "groupId and mode are required", code: 400 });
    return;
  }

  await updateGroupMeta(groupId, (meta) => ({ ...meta, messageMode: mode }));
  respond(true, { ok: true });
  await appendSystemMessage(groupId, `Message mode changed to ${mode}`);
  broadcastGroupSystem(context.broadcast, groupId, "mode_changed", { mode });
};

const handleGroupSetAnnouncement: GatewayRequestHandler = async ({ params, respond, context }) => {
  const groupId = params.groupId as string;
  const content = params.content as string;
  if (!groupId) {
    respond(false, undefined, { message: "groupId is required", code: 400 });
    return;
  }

  await updateGroupMeta(groupId, (meta) => ({
    ...meta,
    announcement: (content ?? "").slice(0, 2000),
  }));
  respond(true, { ok: true });
  await appendSystemMessage(groupId, "Group announcement updated");
  broadcastGroupSystem(context.broadcast, groupId, "announcement_changed", { content });
};

const handleGroupSetSkills: GatewayRequestHandler = async ({ params, respond, context }) => {
  const groupId = params.groupId as string;
  const skills = params.skills as string[];
  if (!groupId || !Array.isArray(skills)) {
    respond(false, undefined, { message: "groupId and skills are required", code: 400 });
    return;
  }

  await updateGroupMeta(groupId, (meta) => ({ ...meta, groupSkills: skills }));
  respond(true, { ok: true });
  broadcastGroupSystem(context.broadcast, groupId, "skills_changed", { skills });
};

const handleGroupSetName: GatewayRequestHandler = async ({ params, respond, context }) => {
  const groupId = params.groupId as string;
  const name = params.name as string;
  if (!groupId) {
    respond(false, undefined, { message: "groupId is required", code: 400 });
    return;
  }

  await updateGroupMeta(groupId, (meta) => ({ ...meta, groupName: (name ?? "").slice(0, 100) }));
  respond(true, { ok: true });
  await appendSystemMessage(
    groupId,
    name ? `Group name changed to "${name}"` : "Group name cleared",
  );
  broadcastGroupSystem(context.broadcast, groupId, "name_changed", { name });
};

const handleGroupSetMemberRolePrompt: GatewayRequestHandler = async ({ params, respond }) => {
  const groupId = params.groupId as string;
  const agentId = params.agentId as string;
  const rolePrompt = params.rolePrompt as string;
  if (!groupId || !agentId) {
    respond(false, undefined, { message: "groupId and agentId are required", code: 400 });
    return;
  }

  await updateGroupMeta(groupId, (meta) => {
    const existing = meta.memberRolePrompts.find((p) => p.agentId === agentId);
    if (existing) {
      existing.rolePrompt = (rolePrompt ?? "").slice(0, 2000);
      existing.updatedAt = Date.now();
    } else {
      meta.memberRolePrompts.push({
        agentId,
        rolePrompt: (rolePrompt ?? "").slice(0, 2000),
        updatedAt: Date.now(),
      });
    }
    return meta;
  });
  respond(true, { ok: true });
};

const handleGroupHistory: GatewayRequestHandler = ({ params, respond }) => {
  const groupId = params.groupId as string;
  if (!groupId) {
    respond(false, undefined, { message: "groupId is required", code: 400 });
    return;
  }

  const limit = (params.limit as number) ?? 50;
  const before = params.before as number | undefined;
  const messages = readGroupMessages(groupId, limit, before);
  respond(true, messages);
};

// ─── Backend Agent Chain Rate Limiting ───
// Prevents runaway agent-to-agent forwarding even if frontend misbehaves.
// Limits are per "conversation chain" — reset when Owner sends a new message.
// NOTE: The actual chain state is managed in chain-state-store.ts.
// This section only provides backward-compatible functions.

const AGENT_CHAIN_MAX = 20; // max forwards per chain (Layer 2 hard limit)

function resetAgentChainState(_groupId: string): void {
  // Chain state is now managed in chain-state-store.ts
  // This function is kept for backward compatibility but does nothing
  // The actual reset happens via initChainState() in chain-state-store.ts
}

function checkAgentChainLimit(
  groupId: string,
  chainTimeout?: number,
): { ok: boolean; reason?: string } {
  const state = getChainState(groupId);
  if (!state) {
    // No chain state means this is not part of an active chain
    return { ok: true };
  }

  const now = Date.now();

  // Check user-configured timeout (Layer 1)
  if (state.startedAt && now - state.startedAt >= (chainTimeout ?? 300_000)) {
    return { ok: false, reason: "timeout" };
  }

  // Check backend hard limit (Layer 2)
  if (state.roundCount >= AGENT_CHAIN_MAX) {
    return { ok: false, reason: "count" };
  }

  return { ok: true };
}

const handleGroupSend: GatewayRequestHandler = async ({ params, respond, context }) => {
  const groupId = params.groupId as string;
  const messageText = params.message as string;
  if (!groupId || !messageText) {
    respond(false, undefined, { message: "groupId and message are required", code: 400 });
    return;
  }

  const meta = loadGroupMeta(groupId);
  if (!meta || meta.archived) {
    respond(false, undefined, { message: "Group not found or archived", code: 404 });
    return;
  }

  // Resolve sender (default: owner)
  const senderParam = params.sender as MessageSender | undefined;
  const resolvedSender: MessageSender = senderParam ?? { type: "owner" };

  // Validate agent sender — must be a group member
  if (resolvedSender.type === "agent") {
    const isMember = meta.members.some((m) => m.agentId === resolvedSender.agentId);
    if (!isMember) {
      respond(false, undefined, {
        message: `Agent ${resolvedSender.agentId} is not a member of this group`,
        code: 403,
      });
      return;
    }
  }

  // Owner sends a message → reset backend chain state (new conversation round)
  if (resolvedSender.type === "owner") {
    resetAgentChainState(groupId);
  }

  // Agent sends a message → check backend chain limit (count + duration)
  if (resolvedSender.type === "agent") {
    const chainCheck = checkAgentChainLimit(groupId, meta.chainTimeout);
    if (!chainCheck.ok) {
      const detail =
        chainCheck.reason === "timeout"
          ? "chain duration exceeded maximum time limit"
          : "too many agent-to-agent forwards in this conversation";
      respond(false, undefined, {
        message: `Chain limit: ${detail}`,
        code: 429,
      });
      return;
    }
  }

  // Resolve mentions (only agentIds, must be members)
  const mentions = ((params.mentions as string[]) ?? []).filter((id) =>
    meta.members.some((m) => m.agentId === id),
  );

  // Build message
  const msg: Omit<GroupChatMessage, "serverSeq"> = {
    id: randomUUID(),
    groupId,
    role: resolvedSender.type === "owner" ? "user" : "assistant",
    content: messageText,
    sender: resolvedSender,
    mentions: mentions.length > 0 ? mentions : undefined,
    timestamp: Date.now(),
  };

  log.info("[HANDLE_GROUP_SEND]", {
    groupId,
    messageId: msg.id,
    sender: resolvedSender,
    senderParam: params.sender,
    contentPreview: messageText.slice(0, 50),
  });

  // When frontend forwards an agent's already-persisted reply via skipTranscript,
  // or when sending system/owner messages that shouldn't be displayed (e.g., delivery, summary),
  // skip duplicate transcript write and broadcast — only proceed to dispatch.
  const skipTranscript = params.skipTranscript === true;

  let savedMsg: GroupChatMessage;
  if (!skipTranscript) {
    // Normal flow: write to transcript + broadcast to UI
    savedMsg = await appendGroupMessage(groupId, msg);
    respond(true, { messageId: savedMsg.id });
    broadcastGroupMessage(context.broadcast, groupId, savedMsg);
  } else {
    // Skip write and broadcast — message was already persisted by the original reply flow.
    // Assign a synthetic serverSeq of 0; dispatch only cares about content + mentions.
    savedMsg = { ...msg, serverSeq: 0 } as GroupChatMessage;
    respond(true, { messageId: savedMsg.id });
  }

  // Dispatch to agents
  const dispatch = resolveDispatchTargets(meta, savedMsg);
  if (dispatch.targets.length === 0) {
    return;
  }

  // Initialize chain state when Owner sends a message (roundCount = 0)
  // For agent-forwarded messages, use existing chain state from params
  if (resolvedSender.type === "owner") {
    // Check if there's an active chain running — if so, queue this message
    const chainState = getChainState(groupId);
    if (chainState && hasActiveMonitor(groupId)) {
      // Active chain running → enqueue Owner message
      const mentionedAgents = dispatch.targets.map((t) => t.agentId);
      enqueueOwnerMessage(groupId, savedMsg.id, mentionedAgents, mentionedAgents.length > 0);
      log.info(
        `[CHAIN_QUEUE] Owner message ${savedMsg.id} queued for group ${groupId}, ` +
          `mentioned: [${mentionedAgents.join(", ")}]`,
      );
      return;
    }

    // No active chain → start a new one
    initChainState(groupId, savedMsg.id);
  }

  const abortController = new AbortController();
  registerGroupAbort(groupId, savedMsg.id, abortController);

  // Start chainTimeout monitor for Owner-initiated chains
  if (resolvedSender.type === "owner") {
    const chainTimeout = getDefaultChainTimeout(meta);
    const stopMonitor = startChainMonitor({
      groupId,
      chainTimeout,
      startedAt: Date.now(),
      abortController,
      onTimeout: (gid) => {
        log.info(`[CHAIN_TIMEOUT] Chain timed out for group ${gid}`);
        void appendSystemMessage(
          gid,
          `对话链超时（${Math.round(chainTimeout / 60000)} 分钟），正在终止所有 Agent...`,
        );
        broadcastGroupSystem(context.broadcast, gid, "chain_timeout", {
          duration: chainTimeout,
        });
        removeChainMonitor(gid);
      },
    });
    setChainMonitor(groupId, stopMonitor);
  }

  try {
    if (dispatch.mode === "broadcast") {
      // Parallel trigger all targets using atomic check-and-increment
      const transcriptSnapshot = getTranscriptSnapshot(groupId);
      const promises = dispatch.targets.map(async (target) => {
        // Atomic check and increment roundCount
        const check = await atomicCheckAndIncrement(groupId, meta, target.agentId);
        if (!check.allowed) {
          log.info(`[BROADCAST_BLOCKED] Agent ${target.agentId} blocked: ${check.reason}`);
          return { agentId: target.agentId, blocked: true, reason: check.reason };
        }

        // Execute agent reasoning
        return triggerAgentReasoning({
          groupId,
          agentId: target.agentId,
          meta,
          transcriptSnapshot,
          triggerMessage: savedMsg,
          chainState: check.newState,
          broadcast: context.broadcast,
          signal: abortController.signal,
        });
      });

      const results = await Promise.allSettled(promises);

      // Log blocked agents
      for (const result of results) {
        if (
          result.status === "fulfilled" &&
          result.value &&
          "blocked" in result.value &&
          result.value.blocked
        ) {
          log.info(
            `[BROADCAST_BLOCKED] Agent ${result.value.agentId} was blocked: ${result.value.reason}`,
          );
        }
      }

      // Handle chain end (stop monitor, drain queued messages)
      if (resolvedSender.type === "owner") {
        await handleChainEnd(groupId, meta, context, abortController);
      }
    } else {
      // Serial trigger for unicast/mention
      for (const target of dispatch.targets) {
        // Atomic check and increment roundCount
        const check = await atomicCheckAndIncrement(groupId, meta, target.agentId);
        if (!check.allowed) {
          await appendSystemMessage(groupId, `Conversation round limit reached (${check.reason})`);
          broadcastGroupSystem(context.broadcast, groupId, "round_limit", { reason: check.reason });
          break;
        }

        await triggerAgentReasoning({
          groupId,
          agentId: target.agentId,
          meta,
          transcriptSnapshot: getTranscriptSnapshot(groupId),
          triggerMessage: savedMsg,
          chainState: check.newState,
          broadcast: context.broadcast,
          signal: abortController.signal,
        });

        // chainState is no longer updated by triggerAgentReasoning
        // The increment is done by atomicCheckAndIncrement above
      }

      // Handle chain end (stop monitor, drain queued messages)
      if (resolvedSender.type === "owner") {
        await handleChainEnd(groupId, meta, context, abortController);
      }
    }
  } finally {
    unregisterGroupAbort(groupId, savedMsg.id);
  }
};

// ─── Chain End Handler ───

/**
 * Handle chain end: stop monitor, drain queued messages, recurse if needed.
 */
async function handleChainEnd(
  groupId: string,
  meta: GroupSessionEntry,
  context: Parameters<GatewayRequestHandler>[0]["context"],
  currentAbortController: AbortController,
  depth = 0,
): Promise<void> {
  if (depth > 10) {
    log.warn(`[CHAIN_DRAIN] Recursive drain limit reached for group ${groupId}`);
    return;
  }

  try {
    // 1. Stop monitor
    stopChainMonitor(groupId);

    // 2. Get current triggeredAgents for dedup
    const chainState = getChainState(groupId);
    const currentTriggered = chainState?.triggeredAgents ?? [];

    // 3. Drain queued messages
    const drained = drainQueuedMessages(groupId, currentTriggered);

    if (!drained) {
      return;
    }

    log.info(
      `[CHAIN_DRAIN] Group ${groupId}: processing queued message ${drained.triggerMessageId}, ` +
        `targets: [${drained.targetAgentIds.join(", ")}]`,
    );

    // 4. Start new chain round
    initChainState(groupId, drained.triggerMessageId);

    const newAbortController = new AbortController();
    registerGroupAbort(groupId, drained.triggerMessageId, newAbortController);

    // 5. Start new monitor
    const chainTimeout = getDefaultChainTimeout(meta);
    const stopMonitor = startChainMonitor({
      groupId,
      chainTimeout,
      startedAt: Date.now(),
      abortController: newAbortController,
      onTimeout: (gid) => {
        log.info(`[CHAIN_TIMEOUT] Chain timed out for group ${gid} (drained message)`);
        void appendSystemMessage(
          gid,
          `对话链超时（${Math.round(chainTimeout / 60000)} 分钟），正在终止所有 Agent...`,
        );
        broadcastGroupSystem(context.broadcast, gid, "chain_timeout", { duration: chainTimeout });
        removeChainMonitor(gid);
      },
    });
    setChainMonitor(groupId, stopMonitor);

    try {
      // 6. Trigger merged target agents (parallel)
      const transcriptSnapshot = getTranscriptSnapshot(groupId);
      const promises = drained.targetAgentIds.map(async (agentId) => {
        const check = await atomicCheckAndIncrement(groupId, meta, agentId);
        if (!check.allowed) {
          log.info(`[CHAIN_DRAIN_BLOCKED] Agent ${agentId} blocked: ${check.reason}`);
          return { agentId, blocked: true, reason: check.reason };
        }

        // Find trigger message in transcript
        const triggerMessage = transcriptSnapshot.find((m) => m.id === drained.triggerMessageId);
        if (!triggerMessage) {
          log.warn(
            `[CHAIN_DRAIN] Trigger message ${drained.triggerMessageId} not found in transcript`,
          );
          return { agentId, blocked: true, reason: "message_not_found" };
        }

        return triggerAgentReasoning({
          groupId,
          agentId,
          meta,
          transcriptSnapshot,
          triggerMessage,
          chainState: check.newState,
          broadcast: context.broadcast,
          signal: newAbortController.signal,
        });
      });

      await Promise.allSettled(promises);

      // 7. Recurse if more queued messages arrived during this round
      await handleChainEnd(groupId, meta, context, newAbortController, depth + 1);
    } finally {
      unregisterGroupAbort(groupId, drained.triggerMessageId);
    }
  } catch (error) {
    log.error(`[CHAIN_DRAIN] Error in handleChainEnd for group ${groupId}:`, error);
  }
}

const handleGroupAbort: GatewayRequestHandler = ({ params, respond }) => {
  const groupId = params.groupId as string;
  if (!groupId) {
    respond(false, undefined, { message: "groupId is required", code: 400 });
    return;
  }
  const runId = params.runId as string | undefined;
  abortGroupRun(groupId, runId);
  respond(true, { ok: true });
};

// ─── Get Chain State ───

/**
 * Get the current conversation chain state for a group.
 * Used by frontend to sync state after page refresh.
 */
const handleGroupGetChainState: GatewayRequestHandler = ({ params, respond }) => {
  const groupId = params.groupId as string;
  if (!groupId) {
    respond(false, undefined, { message: "groupId is required", code: 400 });
    return;
  }

  const chainState = getChainState(groupId);
  respond(true, { chainState: chainState ?? null });
};

// ─── Set Anti-Loop Config ───

const handleGroupSetAntiLoopConfig: GatewayRequestHandler = async ({
  params,
  respond,
  context,
}) => {
  const groupId = params.groupId as string;
  const maxRounds = params.maxRounds as number | undefined;
  const chainTimeout = params.chainTimeout as number | undefined;
  const cliTimeout = params.cliTimeout as number | undefined;

  if (!groupId) {
    respond(false, undefined, { message: "groupId is required", code: 400 });
    return;
  }

  // Validate ranges
  if (maxRounds !== undefined && (maxRounds < 1 || maxRounds > 100)) {
    respond(false, undefined, { message: "maxRounds must be between 1 and 100", code: 400 });
    return;
  }
  if (chainTimeout !== undefined && (chainTimeout < 60000 || chainTimeout > 1800000)) {
    respond(false, undefined, {
      message: "chainTimeout must be between 60000 and 1800000",
      code: 400,
    });
    return;
  }
  if (cliTimeout !== undefined && (cliTimeout < 30000 || cliTimeout > 600000)) {
    respond(false, undefined, {
      message: "cliTimeout must be between 30000 and 600000",
      code: 400,
    });
    return;
  }

  const updated = await updateGroupMeta(groupId, (meta) => {
    if (maxRounds !== undefined) {
      meta.maxRounds = maxRounds;
    }
    if (chainTimeout !== undefined) {
      meta.chainTimeout = chainTimeout;
    }
    if (cliTimeout !== undefined) {
      meta.cliTimeout = cliTimeout;
    }
    return meta;
  });

  respond(true, { ok: true });
  broadcastGroupSystem(context.broadcast, groupId, "anti_loop_config_changed", {
    maxRounds: updated.maxRounds,
    chainTimeout: updated.chainTimeout,
    cliTimeout: updated.cliTimeout,
  });
};

// ─── Export Transcript as Markdown ───

/**
 * Format a group chat transcript as Markdown.
 *
 * Output structure:
 * - H1: group name
 * - Metadata block: members, mode, created/exported timestamps
 * - Messages in chronological order, each with sender label + timestamp
 * - System messages rendered as italicised notes
 */
function formatTranscriptMarkdown(
  meta: NonNullable<ReturnType<typeof loadGroupMeta>>,
  messages: GroupChatMessage[],
): string {
  const lines: string[] = [];

  // Header
  const title = meta.groupName || `Group ${meta.groupId.slice(0, 8)}`;
  lines.push(`# ${title}`);
  lines.push("");

  // Metadata
  lines.push(`> **Members**: ${meta.members.map((m) => `${m.agentId} (${m.role})`).join(", ")}`);
  lines.push(`> **Mode**: ${meta.messageMode}`);
  if (meta.announcement) {
    lines.push(`> **Announcement**: ${meta.announcement}`);
  }
  lines.push(`> **Created**: ${new Date(meta.createdAt).toISOString()}`);
  lines.push(`> **Exported**: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Messages
  for (const msg of messages) {
    const time = new Date(msg.timestamp).toLocaleString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    if (msg.role === "system") {
      lines.push(`*[${time}] — ${msg.content}*`);
      lines.push("");
      continue;
    }

    const senderLabel =
      msg.sender.type === "owner"
        ? "**You**"
        : `**${msg.sender.agentName ?? msg.sender.agentId ?? "Agent"}**`;

    const mentionSuffix =
      msg.mentions && msg.mentions.length > 0
        ? ` → ${msg.mentions.map((id) => `@${id}`).join(" ")}`
        : "";

    lines.push(`### ${senderLabel}  <sub>${time}${mentionSuffix}</sub>`);
    lines.push("");
    lines.push(msg.content);
    lines.push("");
  }

  return lines.join("\n");
}

const handleGroupExportTranscript: GatewayRequestHandler = ({ params, respond }) => {
  const groupId = params.groupId as string;
  if (!groupId) {
    respond(false, undefined, { message: "groupId is required", code: 400 });
    return;
  }

  const meta = loadGroupMeta(groupId);
  if (!meta) {
    respond(false, undefined, { message: "Group not found", code: 404 });
    return;
  }

  // Read all messages (no limit) for a complete export
  const messages = readGroupMessages(groupId, 10_000);
  const markdown = formatTranscriptMarkdown(meta, messages);

  const safeTitle = (meta.groupName ?? groupId.slice(0, 8))
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff _-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `${safeTitle}-${dateStr}.md`;

  respond(true, { markdown, filename });
};

// ─── Terminal Resize Handler ───

const handleGroupTerminalResize: GatewayRequestHandler = ({ params, respond }) => {
  const groupId = params.groupId as string;
  const agentId = params.agentId as string;
  const cols = params.cols as number;
  const rows = params.rows as number;

  if (!groupId || !agentId || !cols || !rows) {
    respond(false, undefined, {
      message: "groupId, agentId, cols, and rows are required",
      code: 400,
    });
    return;
  }

  const success = resizePty(groupId, agentId, cols, rows);
  respond(true, { ok: success });
};

// ─── Context Config Handler ───

const handleGroupSetContextConfig: GatewayRequestHandler = async ({ params, respond, context }) => {
  const groupId = params.groupId as string;
  const contextConfig = params.contextConfig as ContextConfig | undefined;

  if (!groupId) {
    respond(false, undefined, { message: "groupId is required", code: 400 });
    return;
  }

  // Validate config limits
  if (contextConfig) {
    if (contextConfig.maxMessages != null) {
      if (contextConfig.maxMessages < 5 || contextConfig.maxMessages > 100) {
        respond(false, undefined, {
          message: "maxMessages must be between 5 and 100",
          code: 400,
        });
        return;
      }
    }
    if (contextConfig.maxCharacters != null) {
      if (contextConfig.maxCharacters < 10_000 || contextConfig.maxCharacters > 200_000) {
        respond(false, undefined, {
          message: "maxCharacters must be between 10000 and 200000",
          code: 400,
        });
        return;
      }
    }
  }

  await updateGroupMeta(groupId, (meta) => ({
    ...meta,
    contextConfig: contextConfig ?? undefined,
  }));

  respond(true, { ok: true });
  broadcastGroupSystem(context.broadcast, groupId, "context_config_changed", { contextConfig });
};

// ─── Project Docs Handler ───
// Updates the project documentation paths for a group.
// Project directory is locked at creation time and cannot be changed.

const handleGroupSetProjectDocs: GatewayRequestHandler = async ({ params, respond, context }) => {
  const groupId = params.groupId as string;
  const docs = params.docs as string[] | undefined;

  if (!groupId) {
    respond(false, undefined, { message: "groupId is required", code: 400 });
    return;
  }

  if (docs != null && !Array.isArray(docs)) {
    respond(false, undefined, { message: "docs must be an array of strings", code: 400 });
    return;
  }

  // Validate doc paths (basic sanity checks)
  if (docs) {
    for (const doc of docs) {
      if (typeof doc !== "string" || doc.includes("..")) {
        respond(false, undefined, {
          message: "Invalid document path: paths cannot contain '..'",
          code: 400,
        });
        return;
      }
    }
  }

  await updateGroupMeta(groupId, (meta) => ({
    ...meta,
    project: {
      ...meta.project,
      docs: docs ?? [],
    },
  }));

  respond(true, { ok: true });
  broadcastGroupSystem(context.broadcast, groupId, "project_docs_changed", { docs });
};

// ─── Terminal Text Extracted Handler ───
// Receives extracted plain text from the frontend's xterm.js buffer.
// This is the preferred transcript source for bridge terminals because it
// reflects the real browser xterm rendering; backend extraction remains a
// fallback when no active frontend is available.

const handleGroupTerminalTextExtracted: GatewayRequestHandler = ({ params, respond }) => {
  const groupId = params.groupId as string;
  const agentId = params.agentId as string;
  const text = params.text as string;

  if (!groupId || !agentId || typeof text !== "string") {
    respond(false, undefined, {
      message: "groupId, agentId, and text are required",
      code: 400,
    });
    return;
  }

  recordFrontendExtractedText(groupId, agentId, text);

  log.info("[GROUP_TERMINAL_TEXT_EXTRACTED]", {
    groupId,
    agentId,
    textLength: text.length,
    preview: text.slice(0, 100),
  });

  respond(true, { ok: true });
};

// ─── Path Validation ───

/**
 * Validate paths (directory or files) for project configuration.
 * Used by the group create dialog to verify user input before submission.
 */
const handleGroupValidatePath: GatewayRequestHandler = async ({ params, respond }) => {
  const paths = params.paths as string[] | undefined;
  const type = params.type as "directory" | "file" | undefined;

  if (!Array.isArray(paths) || paths.length === 0) {
    respond(true, { results: [] });
    return;
  }

  const { pathExists } = await import("../../utils.js");
  const { stat } = await import("node:fs/promises");

  const results: Array<{
    path: string;
    exists: boolean;
    isDirectory?: boolean;
    isFile?: boolean;
    error?: string;
  }> = [];

  for (const p of paths) {
    if (!p || typeof p !== "string") {
      results.push({ path: String(p), exists: false, error: "Invalid path" });
      continue;
    }

    try {
      const exists = await pathExists(p);
      if (!exists) {
        results.push({ path: p, exists: false });
        continue;
      }

      const stats = await stat(p);
      const isDirectory = stats.isDirectory();
      const isFile = stats.isFile();

      // Type-specific validation
      if (type === "directory" && !isDirectory) {
        results.push({ path: p, exists: true, isDirectory, isFile, error: "Not a directory" });
      } else if (type === "file" && !isFile) {
        results.push({ path: p, exists: true, isDirectory, isFile, error: "Not a file" });
      } else {
        results.push({ path: p, exists: true, isDirectory, isFile });
      }
    } catch (err) {
      results.push({ path: p, exists: false, error: String(err) });
    }
  }

  respond(true, { results });
};

// ─── Export handler map ───

export const groupHandlers: GatewayRequestHandlers = {
  "group.create": handleGroupCreate,
  "group.list": handleGroupList,
  "group.info": handleGroupInfo,
  "group.delete": handleGroupDelete,
  "group.addMembers": handleGroupAddMembers,
  "group.removeMembers": handleGroupRemoveMembers,
  "group.setAssistant": handleGroupSetAssistant,
  "group.setName": handleGroupSetName,
  "group.setMessageMode": handleGroupSetMessageMode,
  "group.setAnnouncement": handleGroupSetAnnouncement,
  "group.setSkills": handleGroupSetSkills,
  "group.setMemberRolePrompt": handleGroupSetMemberRolePrompt,
  "group.send": handleGroupSend,
  "group.history": handleGroupHistory,
  "group.abort": handleGroupAbort,
  "group.getChainState": handleGroupGetChainState,
  "group.exportTranscript": handleGroupExportTranscript,
  // Bridge Agent handlers
  "group.terminalResize": handleGroupTerminalResize,
  "group.setContextConfig": handleGroupSetContextConfig,
  "group.setProjectDocs": handleGroupSetProjectDocs,
  "group.terminalTextExtracted": handleGroupTerminalTextExtracted,
  // Path validation
  "group.validatePath": handleGroupValidatePath,
  "group.setAntiLoopConfig": handleGroupSetAntiLoopConfig,
};
