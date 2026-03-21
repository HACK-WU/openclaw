/**
 * Group Chat — Transcript Read/Write
 *
 * JSONL-based transcript for group chat messages.
 * Uses per-groupId lock for concurrent write safety.
 * Assigns monotonic serverSeq for cross-client ordering.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { resolveGroupTranscriptPath } from "./group-store.js";
import { withGroupLock } from "./group-store.js";
import type { GroupChatMessage } from "./types.js";

// ─── Server sequence counters ───

const seqCounters = new Map<string, number>();

function nextServerSeq(groupId: string): number {
  const current = seqCounters.get(groupId) ?? 0;
  const next = current + 1;
  seqCounters.set(groupId, next);
  return next;
}

/**
 * Initialize seq counter from existing transcript.
 * Called on first read to ensure monotonicity.
 */
function ensureSeqInitialized(groupId: string, messages: GroupChatMessage[]): void {
  if (seqCounters.has(groupId)) {
    return;
  }
  let maxSeq = 0;
  for (const msg of messages) {
    if (msg.serverSeq && msg.serverSeq > maxSeq) {
      maxSeq = msg.serverSeq;
    }
  }
  seqCounters.set(groupId, maxSeq);
}

// ─── Read ───

/**
 * Read group chat messages from transcript JSONL.
 * Skips the session header line.
 */
export function readGroupMessages(
  groupId: string,
  limit?: number,
  before?: number,
): GroupChatMessage[] {
  const filePath = resolveGroupTranscriptPath(groupId);
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    const messages: GroupChatMessage[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        // Skip session header
        if (parsed.type === "session") {
          continue;
        }
        // Must have an id field to be a message
        if (!parsed.id) {
          continue;
        }

        const msg = parsed as GroupChatMessage;
        if (before && msg.timestamp >= before) {
          continue;
        }
        messages.push(msg);
      } catch {
        // skip malformed lines
      }
    }

    ensureSeqInitialized(groupId, messages);

    // Sort by serverSeq for consistent ordering
    messages.sort((a, b) => (a.serverSeq ?? 0) - (b.serverSeq ?? 0));

    if (limit && messages.length > limit) {
      return messages.slice(-limit);
    }
    return messages;
  } catch {
    return [];
  }
}

/**
 * Get a snapshot of the transcript for parallel reasoning.
 * Returns a copy of current messages.
 */
export function getTranscriptSnapshot(groupId: string): GroupChatMessage[] {
  return readGroupMessages(groupId);
}

// ─── Write (with lock) ───

/**
 * Append a single message to the transcript.
 * Automatically assigns serverSeq.
 * Uses withGroupLock for concurrent write safety.
 */
export async function appendGroupMessage(
  groupId: string,
  message: Omit<GroupChatMessage, "serverSeq">,
): Promise<GroupChatMessage> {
  return withGroupLock(groupId, async () => {
    // Ensure seq is initialized
    if (!seqCounters.has(groupId)) {
      readGroupMessages(groupId); // triggers ensureSeqInitialized
    }

    const seq = nextServerSeq(groupId);
    const fullMessage: GroupChatMessage = { ...message, serverSeq: seq };

    const filePath = resolveGroupTranscriptPath(groupId);
    await fs.promises.appendFile(filePath, `${JSON.stringify(fullMessage)}\n`, {
      encoding: "utf-8",
    });

    return fullMessage;
  });
}

/**
 * Append a system message to the transcript.
 */
export async function appendSystemMessage(
  groupId: string,
  content: string,
): Promise<GroupChatMessage> {
  const msg: Omit<GroupChatMessage, "serverSeq"> = {
    id: randomUUID(),
    groupId,
    role: "system",
    content,
    sender: { type: "owner" },
    timestamp: Date.now(),
  };
  return appendGroupMessage(groupId, msg);
}

/**
 * Rough token estimate for a group transcript.
 * Uses ~4 chars per token heuristic.
 */
export function estimateGroupTranscriptTokens(messages: GroupChatMessage[]): number {
  let totalChars = 0;
  for (const msg of messages) {
    totalChars += msg.content.length;
    if (msg.sender.agentName) {
      totalChars += msg.sender.agentName.length + 3;
    }
  }
  return Math.ceil(totalChars / 4);
}

/**
 * Clear all messages from a group transcript.
 * Preserves the session header and resets the sequence counter.
 * Uses withGroupLock for concurrent write safety.
 */
export async function clearGroupMessages(groupId: string): Promise<void> {
  return withGroupLock(groupId, async () => {
    const filePath = resolveGroupTranscriptPath(groupId);

    // Preserve session header
    const header = {
      type: "session",
      version: "1.0",
      id: groupId,
      timestamp: new Date().toISOString(),
      sessionType: "group",
    };

    // Rewrite file with only the header
    await fs.promises.writeFile(filePath, `${JSON.stringify(header)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
    });

    // Reset sequence counter
    seqCounters.set(groupId, 0);
  });
}
