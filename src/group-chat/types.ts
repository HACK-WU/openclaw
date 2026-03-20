/**
 * Group Chat — Type Definitions
 *
 * All types for the multi-agent group chat feature.
 * Kept in a single file to avoid circular imports.
 */

import type { BridgeConfig, ContextConfig } from "./bridge-types.js";

// ─── Group Member ───

export type GroupMemberRole = "assistant" | "member" | "bridge-assistant";

/**
 * Bridge-assistant agent ID prefix.
 * Any agentId starting with this prefix is treated as a bridge-assistant
 * and excluded from normal dispatch (@all, broadcast, etc.).
 */
export const BRIDGE_ASSISTANT_PREFIX = "__bridge-assistant__";

/** Check whether an agentId belongs to a bridge-assistant. */
export function isBridgeAssistant(agentId: string): boolean {
  return agentId.startsWith(BRIDGE_ASSISTANT_PREFIX);
}

export type GroupMember = {
  agentId: string;
  role: GroupMemberRole;
  joinedAt: number; // epoch ms
  // ─── Bridge Agent fields ───
  /** Present when this member is a Bridge (CLI) Agent. */
  bridge?: BridgeConfig;
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
  /** @deprecated No longer used - maxRounds controls all agent triggers globally */
  maxConsecutive: number; // default 3 (kept for backward compatibility)
  /** Chain timeout in ms - max duration of a conversation chain (default: 300000 = 5min) */
  chainTimeout?: number;
  /** CLI execution timeout in ms - max time for a single CLI command (default: 120000 = 2min) */
  cliTimeout?: number;
  historyLimit: number; // default 50
  compaction?: GroupCompactionConfig;
  /** Thinking level for all agents in this group (default: inherit from agent config) */
  thinkingLevel?: string;
  createdAt: number;
  updatedAt: number;
  label?: string;
  archived?: boolean;
  // ─── Bridge Agent extensions ───
  /** Project configuration for Bridge Agents (optional). */
  project?: {
    /** Project root directory. CLI agents start in this cwd. */
    directory?: string;
    /** Paths to project documentation files for context injection. */
    docs?: string[];
  };
  /** Context configuration for CLI agent interactions. */
  contextConfig?: ContextConfig;
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
  /** Tool calls made during this message (for tool card display) */
  toolCalls?: GroupToolCall[];
};

/** Simplified tool call info for message storage */
export type GroupToolCall = {
  /** Tool call ID */
  id: string;
  /** Tool name */
  name: string;
  /** Tool arguments */
  args?: Record<string, unknown>;
  /** Tool result (if available) */
  result?: string;
  /** Timestamp when tool was called */
  timestamp: number;
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
  /** Owner's original message ID that started this chain */
  originMessageId: string;
  /** Number of agents that have been triggered in this chain */
  roundCount: number;
  /** Timestamp when this chain was started (Owner sent message) */
  startedAt: number;
  /** Agent IDs that have been triggered in this chain (for dedup) */
  triggeredAgents: string[];
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

// ─── Tool Message (for tool call/result cards) ───

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
  /** Tool messages for real-time tool card display */
  toolMessages?: GroupToolMessage[];
};

// ─── Group Reply Tool Args ───

export type GroupReplyArgs = {
  message: string;
  mentions?: string[];
};
