/**
 * Group Chat — RPC Handlers
 *
 * Implements all group.* gateway methods.
 * Follows the same handler pattern as sessions.ts / chat.ts.
 */

import { randomUUID } from "node:crypto";
import { triggerAgentReasoning } from "../../group-chat/agent-trigger.js";
import { canTriggerAgent, createChainState } from "../../group-chat/anti-loop.js";
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
import type {
  GroupChatMessage,
  MessageSender,
  ConversationChainState,
} from "../../group-chat/types.js";
import type { GatewayRequestHandler, GatewayRequestHandlers } from "./types.js";

// ─── Handlers ───

const handleGroupCreate: GatewayRequestHandler = async ({ params, respond, context }) => {
  const members = params.members as Array<{ agentId: string; role: "assistant" | "member" }>;
  if (!Array.isArray(members) || members.length === 0) {
    respond(false, undefined, { message: "members is required and must be non-empty", code: 400 });
    return;
  }

  const assistants = members.filter((m) => m.role === "assistant");
  if (assistants.length !== 1) {
    respond(false, undefined, { message: "Exactly one assistant is required", code: 400 });
    return;
  }

  const entry = await createGroup({
    name: (params.name as string) || undefined,
    members,
    messageMode: (params.messageMode as "unicast" | "broadcast") || undefined,
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
  // Map groupName to name for frontend compatibility
  const { groupName, ...rest } = meta;
  respond(true, { ...rest, name: groupName ?? "" });
};

const handleGroupDelete: GatewayRequestHandler = async ({ params, respond, context }) => {
  const groupId = params.groupId as string;
  if (!groupId) {
    respond(false, undefined, { message: "groupId is required", code: 400 });
    return;
  }
  await archiveGroup(groupId);
  respond(true, { ok: true });
  broadcastGroupSystem(context.broadcast, groupId, "archived", {});
};

const handleGroupAddMembers: GatewayRequestHandler = async ({ params, respond, context }) => {
  const groupId = params.groupId as string;
  const newMembers = params.members as Array<{ agentId: string; role?: "member" }>;
  if (!groupId || !Array.isArray(newMembers) || newMembers.length === 0) {
    respond(false, undefined, { message: "groupId and members are required", code: 400 });
    return;
  }

  const updated = await updateGroupMeta(groupId, (meta) => {
    const existingIds = new Set(meta.members.map((m) => m.agentId));
    const now = Date.now();
    for (const nm of newMembers) {
      if (!existingIds.has(nm.agentId)) {
        meta.members.push({ agentId: nm.agentId, role: nm.role ?? "member", joinedAt: now });
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

  const updated = await updateGroupMeta(groupId, (meta) => {
    const removeSet = new Set(agentIds);
    // Cannot remove the assistant
    const assistant = meta.members.find((m) => m.role === "assistant");
    if (assistant && removeSet.has(assistant.agentId)) {
      removeSet.delete(assistant.agentId);
    }
    meta.members = meta.members.filter((m) => !removeSet.has(m.agentId));
    meta.memberRolePrompts = meta.memberRolePrompts.filter((p) => !removeSet.has(p.agentId));
    return meta;
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

type BackendChainState = { count: number; startedAt: number };
const agentChainStates = new Map<string, BackendChainState>();

const AGENT_CHAIN_MAX = 20; // max forwards per chain
const AGENT_CHAIN_MAX_DURATION_MS = 5 * 60_000; // 5 minutes

function resetAgentChainState(groupId: string): void {
  agentChainStates.delete(groupId);
}

function checkAgentChainLimit(groupId: string): { ok: boolean; reason?: string } {
  const now = Date.now();
  const chain = agentChainStates.get(groupId);

  if (chain) {
    if (chain.count >= AGENT_CHAIN_MAX) {
      return { ok: false, reason: "count" };
    }
    if (now - chain.startedAt >= AGENT_CHAIN_MAX_DURATION_MS) {
      return { ok: false, reason: "timeout" };
    }
  }

  agentChainStates.set(groupId, {
    count: (chain?.count ?? 0) + 1,
    startedAt: chain?.startedAt ?? now,
  });
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
    const chainCheck = checkAgentChainLimit(groupId);
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

  // When frontend forwards an agent's already-persisted reply via skipTranscript,
  // skip duplicate transcript write and broadcast — only proceed to dispatch.
  const skipTranscript = params.skipTranscript === true && resolvedSender.type === "agent";

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

  const chainState =
    resolvedSender.type === "owner"
      ? createChainState(savedMsg.id)
      : ((params.__chainState as ConversationChainState) ?? createChainState(savedMsg.id));

  const abortController = new AbortController();
  registerGroupAbort(groupId, savedMsg.id, abortController);

  try {
    if (dispatch.mode === "broadcast") {
      // Parallel trigger all targets
      const transcriptSnapshot = getTranscriptSnapshot(groupId);
      const promises = dispatch.targets.map((target) => {
        const check = canTriggerAgent(chainState, target.agentId, meta);
        if (!check.allowed) {
          return null;
        }

        return triggerAgentReasoning({
          groupId,
          agentId: target.agentId,
          meta,
          transcriptSnapshot,
          triggerMessage: savedMsg,
          chainState,
          broadcast: context.broadcast,
          signal: abortController.signal,
        });
      });

      await Promise.allSettled(promises.filter(Boolean));
    } else {
      // Serial trigger for unicast/mention
      let currentChainState = chainState;
      for (const target of dispatch.targets) {
        const check = canTriggerAgent(currentChainState, target.agentId, meta);
        if (!check.allowed) {
          await appendSystemMessage(groupId, `Conversation round limit reached (${check.reason})`);
          broadcastGroupSystem(context.broadcast, groupId, "round_limit", { reason: check.reason });
          break;
        }

        const result = await triggerAgentReasoning({
          groupId,
          agentId: target.agentId,
          meta,
          transcriptSnapshot: getTranscriptSnapshot(groupId),
          triggerMessage: savedMsg,
          chainState: currentChainState,
          broadcast: context.broadcast,
          signal: abortController.signal,
        });

        currentChainState = result.chainState;
      }
    }
  } finally {
    unregisterGroupAbort(groupId, savedMsg.id);
  }
};

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

// ─── Export handler map ───

export const groupHandlers: GatewayRequestHandlers = {
  "group.create": handleGroupCreate,
  "group.list": handleGroupList,
  "group.info": handleGroupInfo,
  "group.delete": handleGroupDelete,
  "group.addMembers": handleGroupAddMembers,
  "group.removeMembers": handleGroupRemoveMembers,
  "group.setAssistant": handleGroupSetAssistant,
  "group.setMessageMode": handleGroupSetMessageMode,
  "group.setAnnouncement": handleGroupSetAnnouncement,
  "group.setSkills": handleGroupSetSkills,
  "group.setMemberRolePrompt": handleGroupSetMemberRolePrompt,
  "group.send": handleGroupSend,
  "group.history": handleGroupHistory,
  "group.abort": handleGroupAbort,
};
