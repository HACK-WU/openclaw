/**
 * Group Chat — Parallel Stream Manager
 *
 * Manages broadcast-mode parallel agent reasoning.
 * Each agent gets the same transcript snapshot, independent runId.
 */

import type { GatewayBroadcastFn } from "../gateway/server-broadcast.js";
import type { GroupChatMessage, GroupStreamPayload } from "./types.js";

// ─── WebSocket event broadcasting ───

export function broadcastGroupStream(
  broadcast: GatewayBroadcastFn,
  payload: GroupStreamPayload,
): void {
  broadcast("group.stream", payload);
}

export function broadcastGroupMessage(
  broadcast: GatewayBroadcastFn,
  groupId: string,
  message: GroupChatMessage,
): void {
  broadcast("group.message", { groupId, message });
}

export function broadcastGroupSystem(
  broadcast: GatewayBroadcastFn,
  groupId: string,
  event: string,
  data: unknown,
): void {
  broadcast("group.system", { groupId, event, data });
}

// ─── Abort management ───

const groupAbortControllers = new Map<string, Map<string, AbortController>>();

export function registerGroupAbort(
  groupId: string,
  key: string,
  controller: AbortController,
): void {
  let inner = groupAbortControllers.get(groupId);
  if (!inner) {
    inner = new Map();
    groupAbortControllers.set(groupId, inner);
  }
  inner.set(key, controller);
}

export function unregisterGroupAbort(groupId: string, key: string): void {
  const inner = groupAbortControllers.get(groupId);
  if (inner) {
    inner.delete(key);
    if (inner.size === 0) {
      groupAbortControllers.delete(groupId);
    }
  }
}

export function abortGroupRun(groupId: string, runId?: string): void {
  const controllers = groupAbortControllers.get(groupId);
  if (!controllers) {
    return;
  }

  if (runId) {
    controllers.get(runId)?.abort();
  } else {
    for (const ctrl of controllers.values()) {
      ctrl.abort();
    }
    controllers.clear();
  }
}
