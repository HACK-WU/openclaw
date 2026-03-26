/**
 * Group Chat — Bridge Agent Trigger
 *
 * Drives the full response cycle for a Bridge (CLI) Agent:
 * 1. Build context message from transcript
 * 2. Write context to PTY stdin
 * 3. Stream raw PTY output via group.terminal (Channel 1)
 * 4. Detect completion (idle timeout)
 * 5. Extract plain-text reply
 * 6. Send group.stream final + write transcript (Channel 2)
 * 7. Trigger bridge-assistant if CLI appears stuck
 *
 * This module REPLACES the LLM-based triggerAgentReasoning() for Bridge Agents.
 */

import { randomUUID } from "node:crypto";
import type { GatewayBroadcastFn } from "../gateway/server-broadcast.js";
import { getLogger } from "../logging.js";
import type { TriggerAgentParams, TriggerAgentResult } from "./agent-trigger.js";
import { updateChainState } from "./anti-loop.js";
import { buildCoreFilesContentSection, buildCoreFilesPathSection } from "./bridge-context.js";
import {
    clearFrontendExtractedText,
    createBridgePty,
    getPtyState,
    isPtyRunning,
    killBridgePty,
    setInputPhase,
    updateLastTranscriptIndex,
    waitForFrontendExtractedText,
    writeToPty,
} from "./bridge-pty.js";
import type { BridgeConfig } from "./bridge-types.js";
import {
    DEFAULT_CONTEXT_MAX_CHARACTERS,
    DEFAULT_CONTEXT_MAX_MESSAGES,
    DEFAULT_REPLY_TIMEOUT_MS,
    DEFAULT_ROLE_REMINDER_INTERVAL,
    MAX_SINGLE_MESSAGE_CHARS,
} from "./bridge-types.js";
import { broadcastGroupMessage, broadcastGroupStream } from "./parallel-stream.js";
import { broadcastTerminalData, broadcastTerminalStatus } from "./terminal-events.js";
import { appendGroupMessage } from "./transcript.js";
import type { GroupAgentRun, GroupChatMessage, GroupSessionEntry } from "./types.js";
import { isBridgeAssistant } from "./types.js";

const log = getLogger();

const bridgeAgentQueues = new Map<string, Promise<void>>();

function getBridgeQueueKey(groupId: string, agentId: string): string {
  return `${groupId}:${agentId}`;
}

async function runBridgeAgentQueued<T>(
  groupId: string,
  agentId: string,
  task: () => Promise<T>,
): Promise<T> {
  const key = getBridgeQueueKey(groupId, agentId);
  const previous = bridgeAgentQueues.get(key) ?? Promise.resolve();

  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  bridgeAgentQueues.set(key, tail);

  try {
    await previous.catch(() => undefined);
    return await task();
  } finally {
    release();
    if (bridgeAgentQueues.get(key) === tail) {
      bridgeAgentQueues.delete(key);
    }
  }
}

/** @internal for tests */
export function resetBridgeAgentQueues(): void {
  bridgeAgentQueues.clear();
}

/**
 * Trigger a Bridge Agent's response cycle.
 *
 * Unlike internal agents (which call LLM APIs), Bridge Agents communicate
 * through PTY stdin/stdout with an external CLI tool.
 */
export async function triggerBridgeAgent(
  params: TriggerAgentParams,
  bridgeConfig: BridgeConfig,
): Promise<TriggerAgentResult> {
  return runBridgeAgentQueued(params.groupId, params.agentId, () =>
    triggerBridgeAgentInternal(params, bridgeConfig),
  );
}

async function triggerBridgeAgentInternal(
  params: TriggerAgentParams,
  bridgeConfig: BridgeConfig,
): Promise<TriggerAgentResult> {
  const { groupId, agentId, meta, transcriptSnapshot, broadcast, signal } = params;
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

  // Broadcast stream start (so UI knows agent is working)
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

    // 1. Ensure PTY process is running
    const ptyRunning = isPtyRunning(groupId, agentId);
    let isFirstInteraction = !ptyRunning;

    if (!ptyRunning) {
      // Determine effective cwd
      const effectiveCwd = meta.project?.directory ?? bridgeConfig.cwd;

      let outputReceived = false;

      await createBridgePty({
        groupId,
        agentId,
        config: bridgeConfig,
        effectiveCwd,
        onRawData: (data) => {
          outputReceived = true;
          // Channel 1: broadcast raw terminal data to all connected clients
          broadcastTerminalData(broadcast, groupId, agentId, data);
        },
        onExit: (code, _sig) => {
          broadcastTerminalStatus(
            broadcast,
            groupId,
            agentId,
            "offline",
            code != null ? `CLI process exited with code ${code}` : `CLI process terminated`,
          );
        },
      });

      // Phase 1: PTY created → broadcast "running" so frontend renders terminal (collapsed)
      broadcastTerminalStatus(broadcast, groupId, agentId, "running", "CLI process started");
      isFirstInteraction = true;

      // Phase 2: Wait for CLI to initialize and produce output (like test flow)
      // First give the CLI 2s to boot up
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));

      // Then wait up to 10s for some output (indicating the CLI is ready)
      const waitStart = Date.now();
      while (!outputReceived && isPtyRunning(groupId, agentId) && Date.now() - waitStart < 10_000) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        if (signal.aborted) {
          break;
        }
      }

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

      // Phase 3: CLI is ready → broadcast "ready" status so frontend shows success indicator
      broadcastTerminalStatus(
        broadcast,
        groupId,
        agentId,
        "ready",
        outputReceived ? "CLI agent is ready" : "CLI agent started (no initial output)",
      );

      log.info("[BRIDGE_CLI_READY]", {
        groupId,
        agentId,
        outputReceived,
        waitMs: Date.now() - waitStart,
      });
    } else {
      // PTY session already exists (for example after a page refresh or a
      // follow-up @mention). Frontend terminal state is ephemeral, so we must
      // rebroadcast a status event to make the terminal bubble visible again.
      broadcastTerminalStatus(broadcast, groupId, agentId, "ready", "CLI agent session reused");
    }

    // 2. Build hidden context + visible request for the CLI.
    const { contextMessage, requestContent, roleReminderSent } = await buildCliContextMessage({
      meta,
      groupId,
      agentId,
      transcriptSnapshot,
      isFirstInteraction,
      bridgeConfig,
    });

    // 3a. Inject hidden context first.
    //     Suppress onRawData broadcast during this phase so the terminal does
    //     not show the full injected context block.
    setInputPhase(groupId, agentId, true);
    const writtenContext = contextMessage ? writeToPty(groupId, agentId, contextMessage) : true;
    if (!writtenContext) {
      setInputPhase(groupId, agentId, false);
      run.status = "error";
      run.completedAt = Date.now();
      broadcastGroupStream(broadcast, {
        groupId,
        runId,
        agentId,
        agentName: agentId,
        state: "error",
        error: "Failed to write hidden CLI context",
      });
      return { run, chainState };
    }

    // Give the PTY a moment to absorb the hidden context before the visible
    // request is typed, then re-enable broadcasting.
    await new Promise<void>((r) => setTimeout(r, 150));
    setInputPhase(groupId, agentId, false);

    // 3b. Type the actual request visibly, then submit it with Enter.
    //     Append a visible separator line so the frontend can distinguish
    //     user input from CLI output during text extraction.
    const INPUT_END_MARKER = "# ──── End of Input ────";
    const requestWithMarker = `${requestContent}\n${INPUT_END_MARKER}`;
    const writtenRequest = writeToPty(groupId, agentId, requestWithMarker);
    if (!writtenRequest) {
      run.status = "error";
      run.completedAt = Date.now();
      broadcastGroupStream(broadcast, {
        groupId,
        runId,
        agentId,
        agentName: agentId,
        state: "error",
        error: "Failed to write CLI request",
      });
      return { run, chainState };
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    const submitted = writeToPty(groupId, agentId, "\r");
    if (!submitted) {
      run.status = "error";
      run.completedAt = Date.now();
      broadcastGroupStream(broadcast, {
        groupId,
        runId,
        agentId,
        agentName: agentId,
        state: "error",
        error: "Failed to submit CLI request",
      });
      return { run, chainState };
    }

    // 4. Wait for frontend completion detection + text extraction.
    //    Clear any stale frontend extraction first so we only consume the
    //    xterm-rendered text from this run.
    clearFrontendExtractedText(groupId, agentId);

    // Use cliTimeout from group meta (Layer 1), fallback to bridge config, then default
    const timeout = meta.cliTimeout ?? bridgeConfig.timeout ?? DEFAULT_REPLY_TIMEOUT_MS;
    const replyText = await waitForCompletion({
      groupId,
      agentId,
      signal,
      timeoutMs: timeout,
      broadcast,
      runId,
    });

    // Update transcript index for incremental context next time
    updateLastTranscriptIndex(groupId, agentId, transcriptSnapshot.length, {
      roleReminderSent,
    });

    // 5. If we got a reply, write it to transcript
    if (replyText && replyText.trim()) {
      // Use `now` (the run start time) instead of Date.now() so the formal
      // message keeps the same timeline position as the live stream.  This
      // prevents the CLI reply from jumping to the bottom after page refresh
      // (where only persisted messages exist and are sorted by timestamp).
      const replyMessage = await appendGroupMessage(groupId, {
        id: randomUUID(),
        groupId,
        role: "assistant",
        content: replyText,
        sender: { type: "agent", agentId, agentName: agentId },
        timestamp: now,
      });

      log.info("[BRIDGE_REPLY]", {
        groupId,
        runId,
        agentId,
        messageId: replyMessage.id,
        contentPreview: replyMessage.content.slice(0, 50),
      });

      // Channel 2: broadcast final text message
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
      chainState = updateChainState(chainState);

      return { run, replyMessage, chainState };
    }

    // No reply text — still complete the run
    run.status = "completed";
    run.completedAt = Date.now();
    broadcastGroupStream(broadcast, {
      groupId,
      runId,
      agentId,
      agentName: agentId,
      state: "final",
    });
    chainState = updateChainState(chainState);

    return { run, chainState };
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

// ─── Context Message Builder ───

/**
 * Build the hidden context block and the visible request that will be
 * submitted to the CLI. The context uses # comment syntax for safe injection
 * (CLI treats # as comments), while the actual request is typed separately so
 * the terminal behaves more like the test flow.
 */
async function buildCliContextMessage(params: {
  meta: GroupSessionEntry;
  groupId: string;
  agentId: string;
  transcriptSnapshot: GroupChatMessage[];
  isFirstInteraction: boolean;
  bridgeConfig: BridgeConfig;
}): Promise<{ contextMessage: string; requestContent: string; roleReminderSent: boolean }> {
  const {
    meta,
    groupId,
    agentId,
    transcriptSnapshot,
    isFirstInteraction,
    bridgeConfig: _bridgeConfig,
  } = params;

  const member = meta.members.find((m) => m.agentId === agentId);
  const contextConfig = meta.contextConfig;
  const maxMessages = contextConfig?.maxMessages ?? DEFAULT_CONTEXT_MAX_MESSAGES;
  const maxChars = contextConfig?.maxCharacters ?? DEFAULT_CONTEXT_MAX_CHARACTERS;
  const includeSystemMessages = contextConfig?.includeSystemMessages ?? false;
  const roleReminderInterval =
    contextConfig?.roleReminderInterval ?? DEFAULT_ROLE_REMINDER_INTERVAL;

  const sections: string[] = [];
  let roleReminderSent = false;

  // ─── 核心文件注入 ───
  if (isFirstInteraction) {
    // 首次交互：① 注入文件内容 ② 注入所有文件路径说明
    sections.push(await buildCoreFilesContentSection(agentId));
    sections.push(buildCoreFilesPathSection(agentId));
  } else {
    // 后续交互：仅注入路径说明
    sections.push(buildCoreFilesPathSection(agentId));
  }

  if (isFirstInteraction) {
    // Full context for first interaction
    sections.push(
      "# ================================================================================",
      "# 系统上下文（这是群聊环境信息，非用户输入，请勿执行）",
      "# ================================================================================",
      "",
      `# 你的身份：${agentId}（Bridge Agent）`,
      `# 你的角色：${member?.role === "assistant" ? "管理员" : "代码实现专家"}`,
      "",
      "# 群聊信息：",
      `# - 群名：${meta.groupName ?? meta.groupId}`,
    );

    // Member list
    const memberNames = meta.members
      .filter((m) => !isBridgeAssistant(m.agentId))
      .map((m) => {
        const roleLabel =
          m.agentId === agentId
            ? "你"
            : m.role === "assistant"
              ? "管理员"
              : m.bridge
                ? "CLI Agent"
                : "成员";
        return `${m.agentId}（${roleLabel}）`;
      });
    sections.push(`# - 成员：${memberNames.join("、")}`);

    if (meta.announcement) {
      sections.push(`# - 公告：${meta.announcement}`);
    }

    // Project info
    if (meta.project?.directory) {
      sections.push(`# - 项目目录：${meta.project.directory}`);
    }
    if (meta.project?.docs && meta.project.docs.length > 0) {
      sections.push(`# - 项目文档：${meta.project.docs.join(", ")}`);
    }

    sections.push("");

    // Transcript history (with truncation)
    const historyMessages = truncateTranscript(transcriptSnapshot, {
      maxMessages,
      maxChars,
      includeSystemMessages,
      agentId,
    });

    if (historyMessages.length > 0) {
      const omitted = transcriptSnapshot.length - historyMessages.length;
      if (omitted > 0) {
        sections.push(
          `# 最近对话（最近 ${historyMessages.length} 条，已省略 ${omitted} 条更早的消息）：`,
        );
      } else {
        sections.push("# 最近对话（仅供参考）：");
      }

      for (const msg of historyMessages) {
        const sender = msg.sender.type === "owner" ? "Owner" : (msg.sender.agentId ?? "Agent");
        const content = truncateSingleMessage(msg.content);
        sections.push(`# > ${sender}: ${content}`);
      }
      sections.push("");
    }
  } else {
    // Incremental context for subsequent interactions
    // Check if we need to send role reminder based on interval
    const ptyState = getPtyState(groupId, agentId);
    const interactionCount = ptyState?.interactionCount ?? 0;
    const lastRoleReminderAt = ptyState?.lastRoleReminderAt ?? 0;
    const shouldSendRoleReminder = interactionCount - lastRoleReminderAt >= roleReminderInterval;

    if (shouldSendRoleReminder) {
      // Send role reminder
      sections.push(
        "# ================================================================================",
        "# 角色提醒（请保持角色一致性）",
        "# ================================================================================",
        "",
        `# 你的身份：${agentId}（Bridge Agent）`,
        `# 你的角色：${member?.role === "assistant" ? "管理员" : "代码实现专家"}`,
        "",
      );
      roleReminderSent = true;
    }

    // Get lastTranscriptIndex from PTY state for incremental context
    const lastTranscriptIndex = ptyState?.lastTranscriptIndex ?? 0;

    // Only include messages since last interaction
    // Slice from lastTranscriptIndex + 1 to get new messages only
    const newMessages = transcriptSnapshot.slice(lastTranscriptIndex + 1);
    if (newMessages.length > 0) {
      sections.push(
        "# ================================================================================",
        "# 增量上下文（自上次交互以来的新消息）",
        "# ================================================================================",
        "",
        "# 新增对话：",
      );

      for (const msg of newMessages) {
        if (!includeSystemMessages && msg.role === "system") {
          continue;
        }
        const sender = msg.sender.type === "owner" ? "Owner" : (msg.sender.agentId ?? "Agent");
        const content = truncateSingleMessage(msg.content);
        sections.push(`# > ${sender}: ${content}`);
      }
      sections.push("");
    }
  }

  // The actual request (trigger message — the last user/agent message)
  const triggerMsg = transcriptSnapshot[transcriptSnapshot.length - 1];
  const requestContent = extractVisibleRequestContent(triggerMsg);

  sections.push(
    "# ========================== [OPENCLAW_CTX_END] ==========================",
    "# 用户请求（下一次可见输入是实际需要处理的内容）",
    "# ========================== [OPENCLAW_CTX_END] ==========================",
    "",
  );

  return {
    contextMessage: sections.join("\n"),
    requestContent,
    roleReminderSent,
  };
}

// ─── Transcript Truncation ───

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractVisibleRequestContent(triggerMsg: GroupChatMessage | undefined): string {
  const raw = (triggerMsg?.content ?? "").trim();
  if (!raw) {
    return "";
  }

  const mentions = triggerMsg?.mentions ?? [];
  let cleaned = raw;

  for (const mention of mentions) {
    const mentionPattern = new RegExp(`(^|\\s)@${escapeRegExp(mention)}(?=\\s|$)`, "g");
    cleaned = cleaned.replace(mentionPattern, "$1");
  }

  cleaned = cleaned.replace(/(^|\s)@all(?=\s|$)/g, "$1");
  cleaned = cleaned.replace(/\s+/g, " ").trim();

  return cleaned || raw;
}

function truncateTranscript(
  messages: GroupChatMessage[],
  params: {
    maxMessages: number;
    maxChars: number;
    includeSystemMessages: boolean;
    agentId: string;
  },
): GroupChatMessage[] {
  const { maxMessages, maxChars, includeSystemMessages, agentId } = params;

  // Filter out system messages if not included
  let filtered = includeSystemMessages ? messages : messages.filter((m) => m.role !== "system");

  // Sort by priority: @mention messages first, then by recency
  const withPriority = filtered.map((msg, idx) => ({
    msg,
    idx,
    hasMention: msg.mentions?.includes(agentId) ?? false,
  }));

  // Take from the end (most recent), but prioritize @mentions
  const recent = withPriority.slice(-maxMessages * 2); // take more than needed for prioritization

  // Sort: most recent first, @mentions get a boost
  recent.sort((a, b) => {
    if (a.hasMention && !b.hasMention) {
      return 1;
    } // mentions at end (kept)
    if (!a.hasMention && b.hasMention) {
      return -1;
    }
    return a.idx - b.idx; // chronological
  });

  // Take the last maxMessages entries
  const selected = recent.slice(-maxMessages);

  // Re-sort chronologically
  selected.sort((a, b) => a.idx - b.idx);

  // Apply character limit
  let totalChars = 0;
  const result: GroupChatMessage[] = [];
  for (let i = selected.length - 1; i >= 0; i--) {
    const msg = selected[i].msg;
    const msgLen = Math.min(msg.content.length, MAX_SINGLE_MESSAGE_CHARS);
    if (totalChars + msgLen > maxChars) {
      break;
    }
    totalChars += msgLen;
    result.unshift(msg);
  }

  return result;
}

function truncateSingleMessage(content: string): string {
  if (content.length <= MAX_SINGLE_MESSAGE_CHARS) {
    return content;
  }
  return content.slice(0, MAX_SINGLE_MESSAGE_CHARS) + " [...]";
}

// ─── Completion Detection ───

/**
 * Wait for frontend to push extracted text, or abort/timeout.
 *
 * The frontend is the sole authority for completion detection:
 * 8s idle on xterm.js data → extract buffer text → push back via WebSocket.
 *
 * This function simply waits for that push, with fallbacks for:
 * - PTY process exit (crash/termination)
 * - Abort signal
 * - Global timeout
 */
async function waitForCompletion(params: {
  groupId: string;
  agentId: string;
  signal: AbortSignal;
  timeoutMs: number;
  broadcast: GatewayBroadcastFn;
  runId: string;
}): Promise<string> {
  const { groupId, agentId, signal, timeoutMs, broadcast } = params;

  return new Promise<string>((resolve) => {
    let resolved = false;

    const cleanup = () => {
      clearTimeout(globalTimer);
      clearInterval(pollInterval);
      signal.removeEventListener("abort", onAbort);
    };

    const finish = (text: string) => {
      if (resolved) {
        return;
      }
      resolved = true;
      cleanup();
      resolve(text);
    };

    // 1. Main path: wait for frontend-pushed extracted text.
    //    The frontend detects 8s idle → extracts xterm buffer → sends via WebSocket.
    //    Use the same timeout as the global timeout so the waiter doesn't expire early.
    void waitForFrontendExtractedText(groupId, agentId, timeoutMs).then((text) => {
      if (text !== null) {
        broadcastTerminalStatus(broadcast, groupId, agentId, "completed", "CLI response completed");
        finish(text.trim());
      }
      // If null (timeout), the global timer or abort will handle it
    });

    // 2. Global timeout fallback — kill PTY and resolve
    const globalTimer = setTimeout(() => {
      broadcastTerminalStatus(broadcast, groupId, agentId, "timeout", "CLI response timeout");
      // Terminate the PTY process on timeout (cliTimeout)
      void killBridgePty(groupId, agentId, "cli_timeout");
      finish("");
    }, timeoutMs);
    globalTimer.unref();

    // 3. Abort signal
    const onAbort = () => {
      finish("");
    };
    signal.addEventListener("abort", onAbort, { once: true });

    // 4. PTY exit detection (process crashed/terminated)
    const pollInterval = setInterval(() => {
      if (resolved) {
        clearInterval(pollInterval);
        return;
      }
      if (!isPtyRunning(groupId, agentId)) {
        clearInterval(pollInterval);
        broadcastTerminalStatus(broadcast, groupId, agentId, "completed", "CLI process exited");
        // Give frontend 2s to push whatever it has extracted so far
        void waitForFrontendExtractedText(groupId, agentId, 2_000).then((text) => {
          finish((text ?? "").trim());
        });
      }
    }, 2_000);
    pollInterval.unref();

    // Check for immediate completion (PTY may have already exited)
    if (!isPtyRunning(groupId, agentId)) {
      broadcastTerminalStatus(broadcast, groupId, agentId, "completed", "CLI process exited");
      void waitForFrontendExtractedText(groupId, agentId, 2_000).then((text) => {
        finish((text ?? "").trim());
      });
    }
  });
}

export const _test = {
  resetBridgeAgentQueues,
};
