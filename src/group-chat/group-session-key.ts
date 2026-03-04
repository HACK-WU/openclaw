/**
 * Group Chat — SessionKey utilities
 *
 * Format: group:<groupId>
 * Parallel to existing agent:<agentId>:<rest> keys.
 */

export const GROUP_SESSION_KEY_PREFIX = "group:";

export function isGroupSessionKey(key: string): boolean {
  return key.startsWith(GROUP_SESSION_KEY_PREFIX);
}

export function buildGroupSessionKey(groupId: string): string {
  return `${GROUP_SESSION_KEY_PREFIX}${groupId}`;
}

export function parseGroupSessionKey(key: string): { groupId: string } | null {
  if (!isGroupSessionKey(key)) {
    return null;
  }
  const groupId = key.slice(GROUP_SESSION_KEY_PREFIX.length);
  return groupId ? { groupId } : null;
}
