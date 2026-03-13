/**
 * Group Chat — Terminal Events
 *
 * WebSocket event definitions and broadcast helpers for Bridge Agent terminals.
 *
 * Events:
 * - group.terminal       (Server→Client): Raw PTY output data (Base64 encoded)
 * - group.terminalStatus (Server→Client): PTY status change notification
 * - group.terminalResize (Client→Server): Terminal resize request (handled in gateway)
 */

import type { GatewayBroadcastFn } from "../gateway/server-broadcast.js";
import type {
  BridgePtyStatus,
  GroupTerminalPayload,
  GroupTerminalStatusPayload,
} from "./bridge-types.js";

/**
 * Broadcast raw PTY output data to connected clients.
 * Data is Base64-encoded for safe WebSocket transport.
 */
export function broadcastTerminalData(
  broadcast: GatewayBroadcastFn,
  groupId: string,
  agentId: string,
  rawData: string,
): void {
  const payload: GroupTerminalPayload = {
    groupId,
    agentId,
    data: Buffer.from(rawData, "utf-8").toString("base64"),
  };
  broadcast("group.terminal", payload);
}

/**
 * Broadcast terminal status change to connected clients.
 */
export function broadcastTerminalStatus(
  broadcast: GatewayBroadcastFn,
  groupId: string,
  agentId: string,
  status: BridgePtyStatus,
  message?: string,
): void {
  const payload: GroupTerminalStatusPayload = {
    groupId,
    agentId,
    status,
    message,
  };
  broadcast("group.terminalStatus", payload);
}
