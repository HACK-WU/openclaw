/**
 * Built-in CLI Agent Personality Templates
 *
 * This module provides the built-in personality templates for CLI Agents.
 * Each personality defines a unique working style and communication approach.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Personality metadata for listing
 */
export interface PersonalityMeta {
  id: string;
  name: string;
  label: string;
  description: string;
}

/**
 * Full personality definition
 */
export interface Personality extends PersonalityMeta {
  content: string;
}

/**
 * Built-in personality IDs
 */
export const PERSONALITY_IDS = [
  "architect",
  "implementer",
  "reviewer",
  "explorer",
  "guardian",
] as const;

export type PersonalityId = (typeof PERSONALITY_IDS)[number];

/**
 * Personality metadata (static, for fast listing)
 */
export const PERSONALITY_METADATA: Record<PersonalityId, PersonalityMeta> = {
  architect: {
    id: "architect",
    name: "严谨架构师",
    label: "严谨架构师",
    description: "从全局视角审视问题，关注系统长期演进",
  },
  implementer: {
    id: "implementer",
    name: "快速实现者",
    label: "快速实现者",
    description: "以结果为导向，追求快速交付可工作的代码",
  },
  reviewer: {
    id: "reviewer",
    name: "挑剔审查者",
    label: "挑剔审查者",
    description: "带着怀疑的眼光审视一切，关注质量和风险",
  },
  explorer: {
    id: "explorer",
    name: "创意探索者",
    label: "创意探索者",
    description: "对新技术充满好奇，喜欢探索不同解决方案",
  },
  guardian: {
    id: "guardian",
    name: "稳健守护者",
    label: "稳健守护者",
    description: "稳定压倒一切，任何改动都要考虑风险",
  },
};

/**
 * List all available personalities
 */
export function listPersonalities(): PersonalityMeta[] {
  return PERSONALITY_IDS.map((id) => PERSONALITY_METADATA[id]);
}

/**
 * Get a specific personality by ID
 * Returns null if the personality doesn't exist
 */
export function getPersonality(id: string): Personality | null {
  if (!PERSONALITY_IDS.includes(id as PersonalityId)) {
    return null;
  }

  const meta = PERSONALITY_METADATA[id as PersonalityId];
  if (!meta) {
    return null;
  }

  // Read the personality file content
  // Try multiple possible locations (source and dist)
  const possiblePaths = [
    path.join(__dirname, `${id}.md`),
    path.join(__dirname, "..", "..", "src", "personalities", `${id}.md`),
    path.join(__dirname, "..", "personalities", `${id}.md`),
    path.join(process.cwd(), "src", "personalities", `${id}.md`),
  ];

  for (const filePath of possiblePaths) {
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        return {
          ...meta,
          content,
        };
      }
    } catch {
      // Continue to next path
    }
  }

  // Fallback: return personality without content if file not found
  return {
    ...meta,
    content: "",
  };
}

/**
 * Get personality content by ID (for writing to PERSONALITY.md)
 * Returns empty string if the personality doesn't exist
 */
export function getPersonalityContent(id: string | null | undefined): string {
  if (!id) {
    return "";
  }
  const personality = getPersonality(id);
  return personality?.content ?? "";
}

/**
 * Check if a personality ID is valid
 */
export function isValidPersonalityId(id: string): boolean {
  return PERSONALITY_IDS.includes(id as PersonalityId);
}
