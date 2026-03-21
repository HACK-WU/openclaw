/**
 * Path Validation Utilities
 *
 * Validates workspace paths for agent creation.
 * Blocks restricted system directories and provides safety checks.
 */

import { statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, normalize, resolve, sep } from "node:path";

// Linux/Unix system core directories
const RESTRICTED_DIRECTORIES: string[] = [
  // Root
  "/",

  // Linux system directories
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib32",
  "/lib64",
  "/libx32",
  "/proc",
  "/run",
  "/sbin",
  "/srv",
  "/sys",
  "/usr",
  "/var",

  // macOS system directories
  "/System",
  "/Library",
  "/private",
  "/.Spotlight-V100",
  "/.fseventsd",
  "/Volumes",
  "/Network",
];

// Directories that are restricted only on exact match (subdirectories allowed)
const RESTRICTED_EXACT_MATCH: string[] = ["/root", "/Users/Shared"];

// Directories that require caution (allowed but warned)
const CAUTION_DIRECTORIES: string[] = ["/opt", "/usr/local"];

// User sensitive directories (exact match only)
const USER_SENSITIVE_DIRECTORIES: string[] = ["~/.ssh", "~/.gnupg"];

export interface PathValidationResult {
  valid: boolean;
  exists: boolean;
  isDirectory: boolean;
  isRestricted: boolean;
  needsCreation: boolean;
  error?: string;
  warning?: string;
}

/**
 * Expand ~ to user home directory
 */
export function expandTilde(inputPath: string): string {
  if (inputPath.startsWith("~/")) {
    return join(homedir(), inputPath.slice(2));
  }
  if (inputPath === "~") {
    return homedir();
  }
  return inputPath;
}

/**
 * Check if path is a restricted directory
 */
export function isRestrictedDirectory(inputPath: string): boolean {
  const expanded = expandTilde(inputPath);
  const resolved = resolve(normalize(expanded));

  // 1. Check exact match restricted list
  for (const restricted of RESTRICTED_EXACT_MATCH) {
    if (resolved === restricted) {
      return true;
    }
  }

  // 2. Check regular restricted directories (exact or subdirectory)
  for (const restricted of RESTRICTED_DIRECTORIES) {
    if (resolved === restricted || resolved.startsWith(restricted + sep)) {
      return true;
    }
  }

  // 3. Check user sensitive directories (after expanding ~)
  for (const sensitive of USER_SENSITIVE_DIRECTORIES) {
    const expandedSensitive = expandTilde(sensitive);
    const resolvedSensitive = resolve(expandedSensitive);
    if (resolved === resolvedSensitive || resolved.startsWith(resolvedSensitive + sep)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if path is a caution directory
 */
export function isCautionDirectory(inputPath: string): boolean {
  const resolved = resolve(normalize(expandTilde(inputPath)));

  for (const caution of CAUTION_DIRECTORIES) {
    if (resolved === caution || resolved.startsWith(caution + sep)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate workspace path
 */
export function validateWorkspacePath(inputPath: string): PathValidationResult {
  // 1. Empty path check
  if (!inputPath || !inputPath.trim()) {
    return {
      valid: false,
      exists: false,
      isDirectory: false,
      isRestricted: false,
      needsCreation: false,
      error: "agent.create.workspace.error.required",
    };
  }

  // 2. Expand and normalize path
  const expanded = expandTilde(inputPath);
  const resolved = resolve(normalize(expanded));

  // 3. Check restricted directories
  if (isRestrictedDirectory(resolved)) {
    return {
      valid: false,
      exists: false,
      isDirectory: false,
      isRestricted: true,
      needsCreation: false,
      error: "agent.create.workspace.error.forbidden",
    };
  }

  // 4. Check if path exists
  try {
    const stats = statSync(resolved);
    if (stats.isDirectory()) {
      // Path exists and is a directory
      const result: PathValidationResult = {
        valid: true,
        exists: true,
        isDirectory: true,
        isRestricted: false,
        needsCreation: false,
      };

      // Check caution directories
      if (isCautionDirectory(resolved)) {
        result.warning = "agent.create.workspace.warning.caution";
      }

      return result;
    } else {
      // Path exists but is not a directory
      return {
        valid: false,
        exists: true,
        isDirectory: false,
        isRestricted: false,
        needsCreation: false,
        error: "agent.create.workspace.error.notDirectory",
      };
    }
  } catch {
    // 5. Path doesn't exist, check parent directory
    const parentDir = dirname(resolved);
    try {
      const parentStats = statSync(parentDir);
      if (parentStats.isDirectory()) {
        // Parent exists, can create
        return {
          valid: true,
          exists: false,
          isDirectory: false,
          isRestricted: false,
          needsCreation: true,
          warning: "agent.create.workspace.autoCreate",
        };
      }
    } catch {
      // Parent directory doesn't exist
      return {
        valid: false,
        exists: false,
        isDirectory: false,
        isRestricted: false,
        needsCreation: false,
        error: "agent.create.workspace.error.parentNotFound",
      };
    }
  }

  return {
    valid: true,
    exists: false,
    isDirectory: false,
    isRestricted: false,
    needsCreation: true,
    warning: "agent.create.workspace.autoCreate",
  };
}

/**
 * Get a safe directory name
 * Converts name to filesystem-safe directory name
 */
export function sanitizeDirName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "_") // Windows disallowed chars
    .replace(/\s+/g, "_") // Spaces to underscores
    .replace(/\.+/g, "_") // Multiple dots to underscores
    .substring(0, 50); // Length limit
}

// Helper function: avoid top-level import
function join(...paths: string[]): string {
  return paths.join(sep).replace(new RegExp(`\\${sep}+`, "g"), sep);
}
