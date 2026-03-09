/**
 * Group Chat — SessionKey utilities
 *
 * Format: group:<groupId> (shared / frontend)
 *         group:<groupId>:<agentId> (per-agent session isolation)
 * Parallel to existing agent:<agentId>:<rest> keys.
 */

export const GROUP_SESSION_KEY_PREFIX = "group:";

export function isGroupSessionKey(key: string): boolean {
  return key.startsWith(GROUP_SESSION_KEY_PREFIX);
}

export function buildGroupSessionKey(groupId: string, agentId?: string): string {
  if (agentId) {
    return `${GROUP_SESSION_KEY_PREFIX}${groupId}:${agentId}`;
  }
  return `${GROUP_SESSION_KEY_PREFIX}${groupId}`;
}

export function parseGroupSessionKey(key: string): { groupId: string; agentId?: string } | null {
  if (!isGroupSessionKey(key)) {
    return null;
  }
  const rest = key.slice(GROUP_SESSION_KEY_PREFIX.length);
  if (!rest) {
    return null;
  }
  const colonIdx = rest.indexOf(":");
  if (colonIdx === -1) {
    return { groupId: rest };
  }
  const groupId = rest.slice(0, colonIdx);
  const agentId = rest.slice(colonIdx + 1) || undefined;
  return groupId ? { groupId, agentId } : null;
}
