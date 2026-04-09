/**
 * Group Chat — Agent Trigger
 *
 * Triggers agent reasoning within a group chat context.
 * Builds the necessary context, applies read-only tool policy,
 * and manages streaming events.
 *
 * Integrates with getReplyFromConfig() from the existing auto-reply
 * system, using the same patterns as chat.send handler.
 */

import { randomUUID } from "node:crypto";
import { dispatchInboundMessage } from "../auto-reply/dispatch.js";
import { createReplyDispatcher } from "../auto-reply/reply/reply-dispatcher.js";
import type { MsgContext } from "../auto-reply/templating.js";
import { loadConfig } from "../config/config.js";
import type { GatewayBroadcastFn } from "../gateway/server-broadcast.js";
import {
  injectTimestamp,
  timestampOptsFromConfig,
} from "../gateway/server-methods/agent-timestamp.js";
import { getLogger } from "../logging.js";
import { loadProjectMeta } from "../projects/project-store.js";
import { stripReasoningTagsFromText } from "../shared/text/reasoning-tags.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../utils/message-channel.js";
import { triggerBridgeAgent } from "./bridge-trigger.js";
import {
  DEFAULT_CONTEXT_MAX_CHARACTERS,
  DEFAULT_CONTEXT_MAX_MESSAGES,
  type ContextConfig,
} from "./bridge-types.js";
import { buildGroupChatContext } from "./context-builder.js";
import { buildGroupSessionKey } from "./group-session-key.js";
import {
  getLlmAgentState,
  incrementLlmInteraction,
  updateLastRoleReminder,
} from "./llm-agent-state.js";
import { broadcastGroupMessage, broadcastGroupStream } from "./parallel-stream.js";
import { appendGroupMessage } from "./transcript.js";
import type {
  ConversationChainState,
  GroupAgentRun,
  GroupChatMessage,
  GroupSessionEntry,
  GroupToolCall,
  GroupToolMessage,
} from "./types.js";

const log = getLogger("group-chat:agent");

export type TriggerAgentParams = {
  groupId: string;
  agentId: string;
  meta: GroupSessionEntry;
  transcriptSnapshot: GroupChatMessage[];
  triggerMessage: GroupChatMessage;
  chainState: ConversationChainState;
  broadcast: GatewayBroadcastFn;
  signal: AbortSignal;
  /** 用户附带的图片（仅 Owner 发送时携带，Agent 转发不带图片） */
  images?: Array<{ type: "image"; data: string; mimeType: string }>;
};

// Tool message collector for real-time display
type ToolCollectorState = {
  messages: GroupToolMessage[];
  seenToolCallIds: Set<string>;
  pendingToolCalls: Map<string, { toolName: string; toolArgs: Record<string, unknown> }>;
};

function createToolCollector(): ToolCollectorState {
  return {
    messages: [],
    seenToolCallIds: new Set(),
    pendingToolCalls: new Map(),
  };
}

function addToolCall(
  collector: ToolCollectorState,
  params: {
    groupId: string;
    agentId: string;
    runId: string;
    toolCallId: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
  },
): GroupToolMessage {
  const message: GroupToolMessage = {
    id: `tool-call-${params.toolCallId}`,
    groupId: params.groupId,
    agentId: params.agentId,
    runId: params.runId,
    role: "tool_call",
    toolCallId: params.toolCallId,
    toolName: params.toolName,
    toolArgs: params.toolArgs,
    timestamp: Date.now(),
  };
  collector.messages.push(message);
  collector.seenToolCallIds.add(params.toolCallId);
  collector.pendingToolCalls.set(params.toolCallId, {
    toolName: params.toolName,
    toolArgs: params.toolArgs,
  });
  return message;
}

/**
 * Add a tool result message to the collector.
 * Marks the corresponding tool_call as completed.
 */
function addToolResult(
  collector: ToolCollectorState,
  params: {
    groupId: string;
    agentId: string;
    runId: string;
    toolCallId: string;
  },
): GroupToolMessage {
  const pending = collector.pendingToolCalls.get(params.toolCallId);
  const message: GroupToolMessage = {
    id: `tool-result-${params.toolCallId}`,
    groupId: params.groupId,
    agentId: params.agentId,
    runId: params.runId,
    role: "tool",
    toolCallId: params.toolCallId,
    toolName: pending?.toolName,
    toolArgs: pending?.toolArgs,
    timestamp: Date.now(),
  };
  collector.messages.push(message);
  collector.pendingToolCalls.delete(params.toolCallId);
  return message;
}

export type TriggerAgentResult = {
  run: GroupAgentRun;
  replyMessage?: GroupChatMessage;
  chainState: ConversationChainState;
};

/**
 * Build a conversation history string from the transcript snapshot
 * for injection into BodyForAgent so the agent has context.
 *
 * @param snapshot - Transcript messages
 * @param currentAgentId - The agent being triggered (for "(you)" labeling)
 * @param contextConfig - Optional context configuration (maxMessages, etc.)
 */
function buildConversationHistory(
  snapshot: GroupChatMessage[],
  currentAgentId: string,
  contextConfig?: ContextConfig,
): string {
  if (snapshot.length === 0) {
    return "";
  }
  const maxMessages = contextConfig?.maxMessages ?? DEFAULT_CONTEXT_MAX_MESSAGES;
  const maxCharacters = contextConfig?.maxCharacters ?? DEFAULT_CONTEXT_MAX_CHARACTERS;
  const includeSystemMessages = contextConfig?.includeSystemMessages ?? false;

  // Filter out system messages if not included
  const filtered = includeSystemMessages
    ? snapshot
    : snapshot.filter((msg) => msg.role !== "system");

  // Apply maxMessages limit first, then apply maxCharacters limit
  const sliced = filtered.slice(-maxMessages);

  // Apply character limit: walk backward from most recent, accumulate chars
  let totalChars = 0;
  let startIdx = 0;
  for (let i = sliced.length - 1; i >= 0; i--) {
    const msgLen = sliced[i].content.length;
    if (totalChars + msgLen > maxCharacters) {
      startIdx = i + 1;
      break;
    }
    totalChars += msgLen;
  }
  const truncated = sliced.slice(startIdx);

  const lines = truncated.map((msg) => {
    let senderLabel: string;
    if (msg.sender.type === "owner") {
      senderLabel = "Owner";
    } else if (msg.sender.type === "agent") {
      senderLabel =
        msg.sender.agentId === currentAgentId
          ? `${msg.sender.agentId} (you)`
          : (msg.sender.agentId ?? "agent");
    } else {
      senderLabel = "System";
    }
    // Strip thinking tags from content so agents don't see thinking in conversation history
    const cleanContent =
      msg.role === "assistant"
        ? stripReasoningTagsFromText(msg.content, { mode: "strict" })
        : msg.content;
    return `[${senderLabel}]: ${cleanContent}`;
  });
  return lines.join("\n");
}

/**
 * Trigger a single agent's reasoning in group chat context.
 *
 * Flow:
 * 1. Build group chat context (extraSystemPrompt via GroupSystemPrompt)
 * 2. Apply read-only tool policy (groupPolicy in pipeline slot 7)
 * 3. Construct MsgContext following chat.send patterns
 * 4. Call dispatchInboundMessage → getReplyFromConfig → agent runner
 * 5. Stream delta/final events via WebSocket
 * 6. Write final reply to transcript
 */
export async function triggerAgentReasoning(
  params: TriggerAgentParams,
): Promise<TriggerAgentResult> {
  const { groupId, agentId, meta, transcriptSnapshot, triggerMessage, broadcast, signal, images } =
    params;
  let { chainState } = params;

  // ─── Bridge Agent fork ───
  // If the target agent has a bridge config, route to PTY-based Bridge Agent flow
  // instead of the LLM-based reasoning flow.
  const member = meta.members.find((m) => m.agentId === agentId);
  if (member?.bridge) {
    return triggerBridgeAgent(params, member.bridge);
  }
  // ─── End Bridge Agent fork ───

  const runId = randomUUID();
  const now = Date.now();

  const run: GroupAgentRun = {
    runId,
    groupId,
    agentId,
    agentName: agentId,
    status: "running",
    startedAt: now,
  };

  // Build group chat context for system prompt injection
  const llmState = getLlmAgentState(groupId, agentId);
  const isFirstInteraction = llmState === undefined;
  const { content: groupChatSystemPrompt, roleReminderSent } = await buildGroupChatContext({
    meta,
    agentId,
    groupId,
    isFirstInteraction,
    interactionCount: llmState?.interactionCount ?? 0,
    lastRoleReminderAt: llmState?.lastRoleReminderAt ?? 0,
    contextConfig: meta.contextConfig,
  });

  // Build conversation history for the agent
  const conversationHistory = buildConversationHistory(
    transcriptSnapshot,
    agentId,
    meta.contextConfig,
  );
  const triggerText = triggerMessage.content;
  const bodyForAgent = conversationHistory
    ? `${conversationHistory}\n\n[Latest message]: ${triggerText}`
    : triggerText;

  // Broadcast stream start
  broadcastGroupStream(broadcast, {
    groupId,
    runId,
    agentId,
    agentName: agentId,
    state: "delta",
    content: "",
  });

  try {
    if (signal.aborted) {
      run.status = "aborted";
      broadcastGroupStream(broadcast, {
        groupId,
        runId,
        agentId,
        agentName: agentId,
        state: "aborted",
      });
      return { run, chainState };
    }

    // Load config
    const cfg = loadConfig();

    // Inject timestamp
    const stampedBody = injectTimestamp(bodyForAgent, timestampOptsFromConfig(cfg));

    // Build session key for group chat agent — per-agent isolation
    const sessionKey = buildGroupSessionKey(groupId, agentId);

    // Construct MsgContext following chat.send pattern
    const ctx: MsgContext = {
      Body: triggerText,
      BodyForAgent: stampedBody,
      BodyForCommands: triggerText,
      RawBody: triggerText,
      CommandBody: triggerText,
      SessionKey: sessionKey,
      Provider: INTERNAL_MESSAGE_CHANNEL,
      Surface: INTERNAL_MESSAGE_CHANNEL,
      OriginatingChannel: INTERNAL_MESSAGE_CHANNEL,
      ChatType: "group",
      CommandAuthorized: false, // No commands in group chat
      MessageSid: runId,
      // Inject group context via GroupSystemPrompt — this gets included in extraSystemPrompt
      GroupSystemPrompt: groupChatSystemPrompt,
    };

    // Collect final reply parts, thinking content, and tool messages
    let replyText = "";
    let thinkingText = "";
    const toolCollector = createToolCollector();

    const dispatcher = createReplyDispatcher({
      onError: (err) => {
        console.error(`[group-chat] dispatch error for agent ${agentId}:`, err);
      },
      deliver: async (payload, info) => {
        if (info.kind === "final" && payload.text?.trim()) {
          replyText += (replyText ? "\n\n" : "") + payload.text.trim();
        }
      },
    });

    // Helper to broadcast stream with tool messages
    const broadcastStream = (text?: string, tools?: GroupToolMessage[]) => {
      broadcastGroupStream(broadcast, {
        groupId,
        runId,
        agentId,
        agentName: agentId,
        state: "delta",
        content: text ?? "",
        toolMessages: tools && tools.length > 0 ? tools : undefined,
      });
    };

    // Call dispatchInboundMessage — same pattern as chat.send
    // Resolve project directory for LLM agent workspace override
    const resolvedProjectForWorkspace = meta.project?.directory
      ? meta.project
      : meta.projectId
        ? (loadProjectMeta(meta.projectId) ?? undefined)
        : undefined;
    await dispatchInboundMessage({
      ctx,
      cfg,
      dispatcher,
      replyOptions: {
        runId,
        abortSignal: signal,
        images: images && images.length > 0 ? images : undefined,
        suppressTyping: true,
        agentId, // Pass explicit agentId for group chat
        skillFilter: meta.groupSkills.length > 0 ? meta.groupSkills : undefined,
        workspaceDirOverride: resolvedProjectForWorkspace?.directory,
        onPartialReply: (payload) => {
          // Broadcast text content
          if (payload.text) {
            broadcastStream(payload.text, toolCollector.messages);
          }
        },
        onReasoningStream: (payload) => {
          // Accumulate thinking/reasoning content from model
          if (payload.text) {
            thinkingText += payload.text;
          }
        },
        onToolStart: (toolInfo) => {
          if (!toolInfo.toolCallId) {
            return;
          }
          const phase = toolInfo.phase ?? "";

          if (phase === "start" && toolInfo.name) {
            // Tool call started - add to collector and broadcast
            addToolCall(toolCollector, {
              groupId,
              agentId,
              runId,
              toolCallId: toolInfo.toolCallId,
              toolName: toolInfo.name,
              toolArgs: toolInfo.args ?? {},
            });
            // Broadcast immediately so UI shows tool call card
            broadcastStream(undefined, toolCollector.messages);
          } else if (phase === "result") {
            // Tool call completed - add result to collector and broadcast
            addToolResult(toolCollector, {
              groupId,
              agentId,
              runId,
              toolCallId: toolInfo.toolCallId,
            });
            // Broadcast so UI updates tool card status to completed
            broadcastStream(undefined, toolCollector.messages);
          }
          // phase === "update" is intentionally not handled here;
          // partial results are not streamed to group chat to keep things simple.
        },
      },
    });

    // If no reply was collected, use a minimal fallback
    if (!replyText) {
      run.status = "completed";
      run.completedAt = Date.now();
      broadcastGroupStream(broadcast, {
        groupId,
        runId,
        agentId,
        agentName: agentId,
        state: "final",
      });
      // Track LLM agent interaction count (even when no reply)
      incrementLlmInteraction(groupId, agentId);
      if (roleReminderSent) {
        updateLastRoleReminder(groupId, agentId);
      }
      // chainState is no longer updated here - increment happens in group.ts
      return { run, chainState };
    }

    // Extract tool calls from collector for message storage
    const toolCalls: GroupToolCall[] = [];
    const toolCallMap = new Map<string, GroupToolCall>();

    for (const msg of toolCollector.messages) {
      if (msg.role === "tool_call" && msg.toolCallId && msg.toolName) {
        const toolCall: GroupToolCall = {
          id: msg.toolCallId,
          name: msg.toolName,
          args: msg.toolArgs,
          timestamp: msg.timestamp,
        };
        toolCallMap.set(msg.toolCallId, toolCall);
      } else if (msg.role === "tool" && msg.toolCallId) {
        // Add result to corresponding tool call
        const existing = toolCallMap.get(msg.toolCallId);
        if (existing) {
          existing.result = msg.content;
        }
      }
    }

    toolCalls.push(...toolCallMap.values());

    // Build final content: prepend thinking as <think> tags so frontend can extract
    const finalContent = thinkingText.trim()
      ? `<think>${thinkingText.trim()}</think>\n\n${replyText}`
      : replyText;

    // Write reply to transcript
    const replyMessage = await appendGroupMessage(groupId, {
      id: randomUUID(),
      groupId,
      role: "assistant",
      content: finalContent,
      sender: { type: "agent", agentId, agentName: agentId },
      timestamp: Date.now(),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    });

    log.info("[AGENT_REPLY]", {
      groupId,
      runId,
      agentId,
      messageId: replyMessage.id,
      sender: replyMessage.sender,
      serverSeq: replyMessage.serverSeq,
      contentPreview: replyMessage.content.slice(0, 50),
    });

    // Broadcast final
    broadcastGroupStream(broadcast, {
      groupId,
      runId,
      agentId,
      agentName: agentId,
      state: "final",
      message: replyMessage,
    });

    broadcastGroupMessage(broadcast, groupId, replyMessage);

    run.status = "completed";
    run.completedAt = Date.now();
    // Track LLM agent interaction count
    incrementLlmInteraction(groupId, agentId);
    if (roleReminderSent) {
      updateLastRoleReminder(groupId, agentId);
    }
    // chainState is no longer updated here - increment happens in group.ts

    return { run, replyMessage, chainState };
  } catch (err) {
    run.status = "error";
    run.completedAt = Date.now();

    broadcastGroupStream(broadcast, {
      groupId,
      runId,
      agentId,
      agentName: agentId,
      state: "error",
      error: err instanceof Error ? err.message : String(err),
    });

    return { run, chainState };
  }
}
