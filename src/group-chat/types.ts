/**
 * Group Chat — Type Definitions
 *
 * All types for the multi-agent group chat feature.
 * Kept in a single file to avoid circular imports.
 */

// ─── Group Member ───

export type GroupMemberRole = "assistant" | "member";

export type GroupMember = {
  agentId: string;
  role: GroupMemberRole;
  joinedAt: number; // epoch ms
};

// ─── Role Prompt ───

export type GroupMemberRolePrompt = {
  agentId: string;
  rolePrompt: string; // custom prompt; empty string → use default
  updatedAt?: number;
};

// ─── Compaction Config ───

export type GroupCompactionConfig = {
  enabled: boolean; // default true
  maxHistoryShare: number; // default 0.5
  reserveTokensFloor: number; // default 20_000
};

// ─── Group Session Entry (meta.json) ───

export type GroupSessionEntry = {
  groupId: string; // UUID
  groupName?: string; // auto-generated if not set
  messageMode: "unicast" | "broadcast";
  members: GroupMember[];
  memberRolePrompts: GroupMemberRolePrompt[];
  announcement?: string; // max 2000 chars
  groupSkills: string[]; // skill name references
  maxRounds: number; // default 10
  maxConsecutive: number; // default 3
  historyLimit: number; // default 50
  compaction?: GroupCompactionConfig;
  createdAt: number;
  updatedAt: number;
  label?: string;
  archived?: boolean;
};

// ─── Group Index Entry (index.json — lightweight) ───

export type GroupIndexEntry = {
  groupId: string;
  groupName?: string;
  updatedAt: number;
  archived?: boolean;
};

// ─── Message Sender ───

export type MessageSender = {
  type: "owner" | "agent";
  agentId?: string; // required when type === "agent"
  agentName?: string; // UI display
};

// ─── Group Chat Message ───

export type GroupChatMessage = {
  id: string; // UUID
  groupId: string;
  role: "user" | "assistant" | "system";
  content: string;
  sender: MessageSender;
  mentions?: string[]; // agentId[]
  replyTo?: string; // referenced message ID
  timestamp: number; // epoch ms
  serverSeq?: number; // monotonic server sequence for cross-client ordering
};

// ─── Dispatch ───

export type DispatchTarget = {
  agentId: string;
  agentName?: string;
  role: GroupMemberRole;
};

export type DispatchResult = {
  targets: DispatchTarget[];
  mode: "unicast" | "broadcast" | "mention";
};

// ─── Conversation Chain State (anti-loop) ───

export type ConversationChainState = {
  originMessageId: string; // Owner's original message ID
  roundCount: number;
  agentTriggerCounts: Map<string, number>; // agentId → consecutive trigger count
  lastTriggeredAgentId?: string;
};

// ─── Parallel Agent Run ───

export type GroupAgentRun = {
  runId: string;
  groupId: string;
  agentId: string;
  agentName: string;
  status: "running" | "completed" | "error" | "aborted";
  startedAt: number;
  completedAt?: number;
};

// ─── WebSocket Event Payloads ───

export type GroupStreamPayload = {
  groupId: string;
  runId: string;
  agentId: string;
  agentName: string;
  agentAvatar?: string;
  state: "delta" | "final" | "error" | "aborted";
  content?: string; // delta text
  message?: GroupChatMessage; // final message
  error?: string; // error info
};

// ─── Group Reply Tool Args ───

export type GroupReplyArgs = {
  message: string;
  mentions?: string[];
};
