/**
 * Group Chat — Bridge Assistant
 *
 * The bridge-assistant is a system-level agent that monitors CLI Agents.
 * It is triggered automatically when a CLI Agent appears stuck (idle timeout).
 *
 * Responsibilities:
 * - Analyse TUI content to determine CLI state (stuck / running / exited)
 * - Autonomously operate CLI (confirm, authorize, interrupt) for simple cases
 * - Escalate to Owner for complex situations
 * - Record all actions in the audit log
 *
 * Trigger flow:
 * 1. CLI idle timeout fires in bridge-trigger.ts
 * 2. canTriggerAssistant() checks cooldown/limits
 * 3. triggerBridgeAssistant() analyses TUI and takes action
 * 4. Action result is reported to group chat and audit log
 */

import { randomUUID } from "node:crypto";
import type { GatewayBroadcastFn } from "../gateway/server-broadcast.js";
import { getLogger } from "../logging.js";
import { appendAuditEntry } from "./audit-logger.js";
import { getRecentVisibleText, writeToPty } from "./bridge-pty.js";
import type { AssistantTriggerState, BridgeAuditLogEntry } from "./bridge-types.js";
import { ASSISTANT_MAX_TRIGGERS_PER_RUN, ASSISTANT_TRIGGER_COOLDOWN_MS } from "./bridge-types.js";
import { broadcastGroupMessage } from "./parallel-stream.js";
import { appendGroupMessage } from "./transcript.js";

const log = getLogger("group-chat:bridge-assistant");

// ─── Trigger State Management ───

const triggerStates = new Map<string, AssistantTriggerState>();

function triggerKey(groupId: string, agentId: string): string {
  return `${groupId}:${agentId}`;
}

/**
 * Check whether the bridge-assistant can be triggered for a given CLI agent.
 */
export function canTriggerAssistant(groupId: string, cliAgentId: string): boolean {
  const key = triggerKey(groupId, cliAgentId);
  const state = triggerStates.get(key);
  const now = Date.now();

  if (!state) {
    return true; // First trigger
  }

  // Check cooldown
  if (now - state.lastTriggerTime < ASSISTANT_TRIGGER_COOLDOWN_MS) {
    return false;
  }

  // Check trigger count
  if (state.triggerCount >= ASSISTANT_MAX_TRIGGERS_PER_RUN) {
    return false;
  }

  return true;
}

/**
 * Record that the assistant was triggered.
 */
function recordTrigger(groupId: string, cliAgentId: string, result: string): void {
  const key = triggerKey(groupId, cliAgentId);
  const state = triggerStates.get(key);

  if (state) {
    state.lastTriggerTime = Date.now();
    state.triggerCount++;
    state.lastResult = result;
  } else {
    triggerStates.set(key, {
      lastTriggerTime: Date.now(),
      triggerCount: 1,
      lastResult: result,
    });
  }
}

/**
 * Reset trigger state (called when CLI completes a reply or restarts).
 */
export function resetAssistantTriggerState(groupId: string, cliAgentId: string): void {
  triggerStates.delete(triggerKey(groupId, cliAgentId));
}

/**
 * Get current trigger state for a CLI agent.
 */
export function getAssistantTriggerState(
  groupId: string,
  cliAgentId: string,
): AssistantTriggerState | null {
  return triggerStates.get(triggerKey(groupId, cliAgentId)) ?? null;
}

// ─── TUI Analysis ───

type CliStatus =
  | "waiting_confirmation"
  | "waiting_authorization"
  | "error_stopped"
  | "loop_detected"
  | "long_running"
  | "exited_normal"
  | "exited_error"
  | "crashed"
  | "unknown";

type AnalysisResult = {
  status: CliStatus;
  confidence: "high" | "medium" | "low";
  description: string;
  suggestedAction?: "confirm" | "authorize" | "interrupt" | "report" | "none";
  suggestedInput?: string;
};

/**
 * Analyse TUI content to determine CLI status.
 * This is a rule-based heuristic; the actual bridge-assistant Skill
 * provides LLM-powered analysis as a complement.
 */
function analyseTuiContent(tuiContent: string, _cliType: string): AnalysisResult {
  const _lower = tuiContent.toLowerCase();
  const lastLines = tuiContent.split("\n").slice(-20).join("\n");
  const lastLinesLower = lastLines.toLowerCase();

  // Priority 1: Check for exit indicators
  if (/process exited with code 0/i.test(lastLines) || /completed successfully/i.test(lastLines)) {
    return {
      status: "exited_normal",
      confidence: "high",
      description: "CLI process has exited normally",
      suggestedAction: "none",
    };
  }

  if (/process exited with code [1-9]/i.test(lastLines)) {
    return {
      status: "exited_error",
      confidence: "high",
      description: "CLI process has exited with an error",
      suggestedAction: "report",
    };
  }

  if (/panic|segmentation fault|fatal/i.test(lastLines)) {
    return {
      status: "crashed",
      confidence: "high",
      description: "CLI process appears to have crashed",
      suggestedAction: "report",
    };
  }

  // Priority 2: Check for confirmation prompts
  const confirmPatterns = [
    /\[y\/n\]/i,
    /\[y\/N\]/,
    /\[Y\/n\]/,
    /\(y\/n\)/i,
    /\(yes\/no\)/i,
    /continue\?\s*\[/i,
    /proceed\?\s*\[/i,
    /do you want to (?:proceed|continue)\?/i,
    /allow this action\?/i,
  ];

  for (const pattern of confirmPatterns) {
    if (pattern.test(lastLines)) {
      return {
        status: "waiting_confirmation",
        confidence: "high",
        description: "CLI is waiting for user confirmation",
        suggestedAction: "confirm",
        suggestedInput: "y\n",
      };
    }
  }

  // Priority 3: Check for authorization prompts
  const authPatterns = [/permission/i, /authorize/i, /allow/i, /approve/i, /grant access/i];

  for (const pattern of authPatterns) {
    if (pattern.test(lastLinesLower) && /\?/.test(lastLines)) {
      return {
        status: "waiting_authorization",
        confidence: "medium",
        description: "CLI is waiting for authorization",
        suggestedAction: "authorize",
        suggestedInput: "y\n",
      };
    }
  }

  // Priority 4: Check for errors
  if (/\berror\b/i.test(lastLinesLower) && !/error handling|error recovery/i.test(lastLinesLower)) {
    return {
      status: "error_stopped",
      confidence: "medium",
      description: "CLI appears to have encountered an error",
      suggestedAction: "report",
    };
  }

  // Priority 5: Check for normal running indicators
  const runningIndicators = [
    /building/i,
    /compiling/i,
    /installing/i,
    /downloading/i,
    /thinking/i,
    /processing/i,
    /generating/i,
    /running/i,
    /%/,
    /\.\.\./,
  ];

  for (const pattern of runningIndicators) {
    if (pattern.test(lastLinesLower)) {
      return {
        status: "long_running",
        confidence: "medium",
        description: "CLI appears to be executing a long-running task",
        suggestedAction: "none",
      };
    }
  }

  // Priority 6: Unknown
  return {
    status: "unknown",
    confidence: "low",
    description: "Cannot determine CLI status from TUI content",
    suggestedAction: "report",
  };
}

// ─── Sensitive Information Redaction ───

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /sk-[a-zA-Z0-9-]{20,}/g, label: "api_key" },
  { pattern: /sk-ant-[a-zA-Z0-9-]+/g, label: "anthropic_key" },
  { pattern: /AKIA[0-9A-Z]{16}/g, label: "aws_key" },
  { pattern: /ghp_[a-zA-Z0-9]{36,}/g, label: "github_token" },
  {
    pattern: /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g,
    label: "private_key",
  },
  { pattern: /password\s*[=:]\s*\S+/gi, label: "password" },
  { pattern: /token\s*[=:]\s*\S+/gi, label: "token" },
  { pattern: /mongodb?:\/\/[^@\s]+:[^@\s]+@/g, label: "db_connection" },
];

function redactSensitiveInfo(text: string): { redacted: string; types: string[]; count: number } {
  let redacted = text;
  const detectedTypes: Set<string> = new Set();
  let totalCount = 0;

  for (const { pattern, label } of SENSITIVE_PATTERNS) {
    const matches = redacted.match(pattern);
    if (matches) {
      detectedTypes.add(label);
      totalCount += matches.length;
      redacted = redacted.replace(pattern, "***REDACTED***");
    }
  }

  return {
    redacted,
    types: [...detectedTypes],
    count: totalCount,
  };
}

// ─── Main Trigger Function ───

/**
 * Trigger the bridge-assistant to analyse and potentially operate on a stuck CLI.
 *
 * @returns Whether an action was performed
 */
export async function triggerBridgeAssistant(params: {
  groupId: string;
  cliAgentId: string;
  assistantAgentId: string;
  cliType: string;
  idleDuration: number;
  broadcast: GatewayBroadcastFn;
}): Promise<boolean> {
  const { groupId, cliAgentId, assistantAgentId, cliType, idleDuration, broadcast } = params;

  // Check cooldown/limits
  if (!canTriggerAssistant(groupId, cliAgentId)) {
    const state = getAssistantTriggerState(groupId, cliAgentId);
    if (state && state.triggerCount >= ASSISTANT_MAX_TRIGGERS_PER_RUN) {
      // Reached limit — send notification
      const limitMsg = await appendGroupMessage(groupId, {
        id: randomUUID(),
        groupId,
        role: "assistant",
        content:
          `⚠️ CLI Agent \`${cliAgentId}\` 持续无响应，辅助 Agent 触发次数已达上限（${ASSISTANT_MAX_TRIGGERS_PER_RUN} 次）。\n\n` +
          "建议检查 CLI 终端状态或手动终止。",
        sender: { type: "agent", agentId: assistantAgentId, agentName: assistantAgentId },
        timestamp: Date.now(),
      });
      broadcastGroupMessage(broadcast, groupId, limitMsg);
    }
    return false;
  }

  // Get TUI content
  const tuiContent = getRecentVisibleText(groupId, cliAgentId);
  if (!tuiContent) {
    recordTrigger(groupId, cliAgentId, "no_content");
    return false;
  }

  // Analyse TUI content
  const analysis = analyseTuiContent(tuiContent, cliType);

  // Redact sensitive info for reporting
  const {
    redacted: redactedTui,
    types: _sensitiveTypes,
    count: _redactedCount,
  } = redactSensitiveInfo(tuiContent.slice(-500));

  log.info("[BRIDGE_ASSISTANT_TRIGGER]", {
    groupId,
    cliAgentId,
    status: analysis.status,
    confidence: analysis.confidence,
    idleDuration,
  });

  // Build audit entry
  const auditEntry: BridgeAuditLogEntry = {
    timestamp: new Date().toISOString(),
    groupId,
    cliAgentId,
    assistantAgentId,
    idleDuration,
    tuiContentSnippet: redactedTui,
    analysisResult: analysis.description,
    actionPerformed: false,
    result: "no_action",
  };

  let actionPerformed = false;

  // Decide action based on analysis
  switch (analysis.suggestedAction) {
    case "confirm":
    case "authorize": {
      if (analysis.confidence === "high" || analysis.confidence === "medium") {
        const input = analysis.suggestedInput ?? "y\n";
        const success = writeToPty(groupId, cliAgentId, input);
        actionPerformed = success;

        auditEntry.actionPerformed = success;
        auditEntry.operationType = analysis.suggestedAction;
        auditEntry.operationDetail = `输入 '${input.trim()}' ${analysis.suggestedAction === "confirm" ? "确认继续" : "授权操作"}`;
        auditEntry.result = success ? "success" : "failed";
        auditEntry.resultDetail = success ? "指令已发送到 CLI" : "无法写入 PTY stdin";

        // Send operation report
        const reportContent =
          `🔧 辅助 Agent 操作报告\n\n` +
          `CLI Agent: ${cliAgentId}\n` +
          `检测时间: ${new Date().toISOString()}\n` +
          `空闲时长: ${idleDuration} 秒\n\n` +
          `状态分析:\n` +
          `  ${analysis.description}\n\n` +
          `执行操作:\n` +
          `  → ${auditEntry.operationDetail}\n\n` +
          `请关注 CLI 终端窗口查看后续执行情况。`;

        const reportMsg = await appendGroupMessage(groupId, {
          id: randomUUID(),
          groupId,
          role: "assistant",
          content: reportContent,
          sender: { type: "agent", agentId: assistantAgentId, agentName: assistantAgentId },
          timestamp: Date.now(),
        });
        broadcastGroupMessage(broadcast, groupId, reportMsg);
      } else {
        // Low confidence — escalate
        auditEntry.result = "escalated";
        auditEntry.resultDetail = "置信度低，上报 Owner";
        await sendEscalationReport(params, analysis, redactedTui);
      }
      break;
    }

    case "interrupt": {
      const success = writeToPty(groupId, cliAgentId, "\x03"); // Ctrl+C
      actionPerformed = success;
      auditEntry.actionPerformed = success;
      auditEntry.operationType = "interrupt";
      auditEntry.operationDetail = "发送 Ctrl+C 中断指令";
      auditEntry.result = success ? "success" : "failed";

      const interruptReport =
        `🔧 辅助 Agent 操作报告\n\n` +
        `CLI Agent: ${cliAgentId}\n` +
        `检测时间: ${new Date().toISOString()}\n` +
        `空闲时长: ${idleDuration} 秒\n\n` +
        `状态分析:\n  ${analysis.description}\n\n` +
        `执行操作:\n  → 发送 Ctrl+C 中断指令\n\n` +
        `请关注 CLI 终端窗口查看后续状态。`;

      const interruptMsg = await appendGroupMessage(groupId, {
        id: randomUUID(),
        groupId,
        role: "assistant",
        content: interruptReport,
        sender: { type: "agent", agentId: assistantAgentId, agentName: assistantAgentId },
        timestamp: Date.now(),
      });
      broadcastGroupMessage(broadcast, groupId, interruptMsg);
      break;
    }

    case "none": {
      // Normal running or exited — just report
      auditEntry.result = "no_action";
      auditEntry.resultDetail = analysis.description;

      const statusReport =
        `🔧 辅助 Agent 状态报告\n\n` +
        `CLI Agent: ${cliAgentId}\n` +
        `检测时间: ${new Date().toISOString()}\n` +
        `空闲时长: ${idleDuration} 秒\n\n` +
        `状态分析:\n  ${analysis.description}\n\n` +
        `操作: 无需干预${analysis.status === "long_running" ? "，继续等待。" : "。"}`;

      const statusMsg = await appendGroupMessage(groupId, {
        id: randomUUID(),
        groupId,
        role: "assistant",
        content: statusReport,
        sender: { type: "agent", agentId: assistantAgentId, agentName: assistantAgentId },
        timestamp: Date.now(),
      });
      broadcastGroupMessage(broadcast, groupId, statusMsg);
      break;
    }

    case "report":
    default: {
      auditEntry.result = "escalated";
      auditEntry.resultDetail = "需要人工介入";
      await sendEscalationReport(params, analysis, redactedTui);
      break;
    }
  }

  // Record trigger and write audit
  recordTrigger(groupId, cliAgentId, auditEntry.result);
  await appendAuditEntry(auditEntry);

  return actionPerformed;
}

// ─── Escalation Report ───

async function sendEscalationReport(
  params: {
    groupId: string;
    cliAgentId: string;
    assistantAgentId: string;
    idleDuration: number;
    broadcast: GatewayBroadcastFn;
  },
  analysis: AnalysisResult,
  redactedTui: string,
): Promise<void> {
  const escalationReport =
    `🔧 辅助 Agent 需要人工介入\n\n` +
    `CLI Agent: ${params.cliAgentId}\n` +
    `检测时间: ${new Date().toISOString()}\n` +
    `空闲时长: ${params.idleDuration} 秒\n\n` +
    `状态分析:\n  ${analysis.description}\n\n` +
    `TUI 内容摘要:\n  ${redactedTui.slice(0, 200)}\n\n` +
    `建议操作:\n` +
    `  1. 检查 CLI 终端窗口中的完整信息\n` +
    `  2. 根据情况决定是重启 CLI 还是修复配置\n` +
    `  3. 如需终止 CLI，点击成员列表中的终止按钮`;

  const escalationMsg = await appendGroupMessage(params.groupId, {
    id: randomUUID(),
    groupId: params.groupId,
    role: "assistant",
    content: escalationReport,
    sender: {
      type: "agent",
      agentId: params.assistantAgentId,
      agentName: params.assistantAgentId,
    },
    timestamp: Date.now(),
  });
  broadcastGroupMessage(params.broadcast, params.groupId, escalationMsg);
}
