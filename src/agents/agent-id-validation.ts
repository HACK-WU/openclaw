/**
 * Agent ID Validation
 *
 * Shared validation utilities for Agent names and IDs.
 * Applies to both general Agents and CLI Agents.
 *
 * Rules:
 * - AgentID: only [a-zA-Z0-9_] (letters, digits, underscore)
 * - Agent Name: any characters (Chinese, spaces, special chars allowed)
 * - Both must be globally unique across general Agents + CLI Agents
 */

/** AgentID must match: letters, digits, underscore only. */
const AGENT_ID_PATTERN = /^[a-zA-Z0-9_]+$/;

/** Maximum length for an AgentID. */
export const AGENT_ID_MAX_LENGTH = 64;

/** Maximum length for an Agent name. */
export const AGENT_NAME_MAX_LENGTH = 100;

/**
 * Check whether an AgentID string is valid.
 * Valid IDs contain only `[a-zA-Z0-9_]` and are non-empty.
 */
export function isValidAgentId(id: string): boolean {
  if (!id || id.length === 0 || id.length > AGENT_ID_MAX_LENGTH) {
    return false;
  }
  return AGENT_ID_PATTERN.test(id);
}

/**
 * Check whether an Agent name can be used directly as an AgentID.
 * Returns true when the name satisfies the `[a-zA-Z0-9_]+` pattern
 * (no Chinese characters, spaces, hyphens, or other special chars).
 */
export function canAutoGenerateAgentId(name: string): boolean {
  if (!name || name.length === 0) {
    return false;
  }
  return AGENT_ID_PATTERN.test(name);
}

/**
 * Validate that an AgentID and Agent name are globally unique.
 *
 * The check covers both general Agents (from `openclaw.json agents.list`)
 * and CLI Agents (from `cli-agents/bridge.json`).
 *
 * @param agentId    - The proposed AgentID
 * @param agentName  - The proposed Agent display name
 * @param existingAgents    - General agents `{ id, name }[]`
 * @param existingCliAgents - CLI agents `{ id, name }[]`
 * @param excludeId  - Optional: ID to exclude from checks (for updates)
 */
export function validateAgentUniqueness(
  agentId: string,
  agentName: string,
  existingAgents: ReadonlyArray<{ id: string; name?: string }>,
  existingCliAgents: ReadonlyArray<{ id: string; name: string }>,
  excludeId?: string,
): { valid: boolean; error?: string } {
  // Check AgentID uniqueness across general agents
  for (const agent of existingAgents) {
    if (excludeId && agent.id === excludeId) {
      continue;
    }
    if (agent.id.toLowerCase() === agentId.toLowerCase()) {
      return {
        valid: false,
        error: `AgentID "${agentId}" conflicts with existing general agent "${agent.id}"`,
      };
    }
  }

  // Check AgentID uniqueness across CLI agents
  for (const agent of existingCliAgents) {
    if (excludeId && agent.id === excludeId) {
      continue;
    }
    if (agent.id.toLowerCase() === agentId.toLowerCase()) {
      return {
        valid: false,
        error: `AgentID "${agentId}" conflicts with existing CLI agent "${agent.id}"`,
      };
    }
  }

  // Check Agent name uniqueness across general agents
  for (const agent of existingAgents) {
    if (excludeId && agent.id === excludeId) {
      continue;
    }
    if (agent.name && agent.name.toLowerCase() === agentName.toLowerCase()) {
      return {
        valid: false,
        error: `Agent name "${agentName}" conflicts with existing general agent "${agent.name}"`,
      };
    }
  }

  // Check Agent name uniqueness across CLI agents
  for (const agent of existingCliAgents) {
    if (excludeId && agent.id === excludeId) {
      continue;
    }
    if (agent.name.toLowerCase() === agentName.toLowerCase()) {
      return {
        valid: false,
        error: `Agent name "${agentName}" conflicts with existing CLI agent "${agent.name}"`,
      };
    }
  }

  return { valid: true };
}

/**
 * Describe why an AgentID is invalid (for user-facing error messages).
 */
export function describeAgentIdError(id: string): string | null {
  if (!id || id.length === 0) {
    return "AgentID cannot be empty";
  }
  if (id.length > AGENT_ID_MAX_LENGTH) {
    return `AgentID cannot exceed ${AGENT_ID_MAX_LENGTH} characters`;
  }
  if (!AGENT_ID_PATTERN.test(id)) {
    return "AgentID can only contain letters, digits, and underscores (a-z, A-Z, 0-9, _)";
  }
  return null;
}
