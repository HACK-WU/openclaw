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
import { INTERNAL_MESSAGE_CHANNEL } from "../utils/message-channel.js";
import { updateChainState } from "./anti-loop.js";
import { buildGroupChatContext } from "./context-builder.js";
import { buildGroupSessionKey } from "./group-session-key.js";
import { broadcastGroupMessage, broadcastGroupStream } from "./parallel-stream.js";
import { appendGroupMessage } from "./transcript.js";
import type {
  ConversationChainState,
  GroupAgentRun,
  GroupChatMessage,
  GroupSessionEntry,
  GroupToolMessage,
} from "./types.js";

export type TriggerAgentParams = {
  groupId: string;
  agentId: string;
  meta: GroupSessionEntry;
  transcriptSnapshot: GroupChatMessage[];
  triggerMessage: GroupChatMessage;
  chainState: ConversationChainState;
  broadcast: GatewayBroadcastFn;
  signal: AbortSignal;
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

function addToolResult(
  collector: ToolCollectorState,
  params: {
    groupId: string;
    agentId: string;
    runId: string;
    toolCallId: string;
    content: string;
  },
): GroupToolMessage | null {
  // Only add result if we have the corresponding tool call
  if (!collector.seenToolCallIds.has(params.toolCallId)) {
    return null;
  }
  const message: GroupToolMessage = {
    id: `tool-result-${params.toolCallId}`,
    groupId: params.groupId,
    agentId: params.agentId,
    runId: params.runId,
    role: "tool",
    toolCallId: params.toolCallId,
    content: params.content,
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
 */
function buildConversationHistory(snapshot: GroupChatMessage[], currentAgentId: string): string {
  if (snapshot.length === 0) {
    return "";
  }
  const lines = snapshot.slice(-30).map((msg) => {
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
    return `[${senderLabel}]: ${msg.content}`;
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
  const { groupId, agentId, meta, transcriptSnapshot, triggerMessage, broadcast, signal } = params;
  let { chainState } = params;

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
  const groupChatSystemPrompt = buildGroupChatContext({ meta, agentId });

  // Build conversation history for the agent
  const conversationHistory = buildConversationHistory(transcriptSnapshot, agentId);
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

    // Build session key for group chat agent
    const sessionKey = buildGroupSessionKey(groupId);

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

    // Collect final reply parts and tool messages
    let replyText = "";
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
    await dispatchInboundMessage({
      ctx,
      cfg,
      dispatcher,
      replyOptions: {
        runId,
        abortSignal: signal,
        suppressTyping: true,
        agentId, // Pass explicit agentId for group chat
        skillFilter: meta.groupSkills.length > 0 ? meta.groupSkills : undefined,
        onPartialReply: (payload) => {
          // Broadcast text content
          if (payload.text) {
            broadcastStream(payload.text, toolCollector.messages);
          }
        },
        onToolStart: (toolInfo) => {
          // Tool call started - add to collector and broadcast
          if (toolInfo.name && toolInfo.phase === "start" && toolInfo.toolCallId) {
            addToolCall(toolCollector, {
              groupId,
              agentId,
              runId,
              toolCallId: toolInfo.toolCallId,
              toolName: toolInfo.name,
              toolArgs: toolInfo.args ?? {},
            });
            // Broadcast immediately so UI shows tool call
            broadcastStream(undefined, toolCollector.messages);
          }
        },
        onToolResult: (payload) => {
          // Tool result received - try to extract result content
          // The payload.text contains the formatted tool result text
          // We need to find the corresponding tool call and create a result message
          if (payload.text && toolCollector.pendingToolCalls.size > 0) {
            // Find the most recent pending tool call that matches this result
            // This is a heuristic - the text often contains the tool name or result
            const pendingEntries = Array.from(toolCollector.pendingToolCalls.entries());
            const lastPending = pendingEntries[pendingEntries.length - 1];
            if (lastPending) {
              const [toolCallId] = lastPending;
              addToolResult(toolCollector, {
                groupId,
                agentId,
                runId,
                toolCallId,
                content: payload.text,
              });
              // Broadcast updated tool messages
              broadcastStream(undefined, toolCollector.messages);
            }
          }
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
      chainState = updateChainState(chainState, agentId);
      return { run, chainState };
    }

    // Write reply to transcript
    const replyMessage = await appendGroupMessage(groupId, {
      id: randomUUID(),
      groupId,
      role: "assistant",
      content: replyText,
      sender: { type: "agent", agentId, agentName: agentId },
      timestamp: Date.now(),
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
    chainState = updateChainState(chainState, agentId);

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
