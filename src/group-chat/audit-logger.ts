/**
 * Group Chat — Bridge Assistant Audit Logger
 *
 * Persists audit entries for every bridge-assistant intervention.
 * Storage: ~/.openclaw/audit/bridge-assistant/{YYYY-MM}.log (JSONL)
 * Retention: 30 days (caller is responsible for cleanup).
 */

import fs from "node:fs";
import path from "node:path";
import { STATE_DIR } from "../config/paths.js";
import { getLogger } from "../logging.js";
import type { BridgeAuditLogEntry } from "./bridge-types.js";

const log = getLogger("group-chat:audit");

const AUDIT_DIR = path.join(STATE_DIR, "audit", "bridge-assistant");

/**
 * Append an audit entry to the monthly log file.
 */
export async function appendAuditEntry(entry: BridgeAuditLogEntry): Promise<void> {
  try {
    fs.mkdirSync(AUDIT_DIR, { recursive: true, mode: 0o700 });

    const now = new Date(entry.timestamp);
    const filename = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}.log`;
    const filePath = path.join(AUDIT_DIR, filename);

    const line = JSON.stringify(entry) + "\n";
    await fs.promises.appendFile(filePath, line, { encoding: "utf-8", mode: 0o600 });

    log.info("[AUDIT_ENTRY]", {
      groupId: entry.groupId,
      cliAgentId: entry.cliAgentId,
      result: entry.result,
      actionPerformed: entry.actionPerformed,
    });
  } catch (err) {
    // Audit logging should never break the main flow
    log.info("[AUDIT_WRITE_ERROR]", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Read audit entries for a given group (optionally filtered by date range).
 * Returns entries in chronological order.
 */
export function readAuditEntries(params: {
  groupId?: string;
  cliAgentId?: string;
  since?: Date;
  until?: Date;
  limit?: number;
}): BridgeAuditLogEntry[] {
  const entries: BridgeAuditLogEntry[] = [];

  try {
    if (!fs.existsSync(AUDIT_DIR)) {
      return [];
    }

    const files = fs
      .readdirSync(AUDIT_DIR)
      .filter((f) => f.endsWith(".log"))
      .toSorted();

    for (const file of files) {
      const filePath = path.join(AUDIT_DIR, file);
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as BridgeAuditLogEntry;

          // Apply filters
          if (params.groupId && entry.groupId !== params.groupId) {
            continue;
          }
          if (params.cliAgentId && entry.cliAgentId !== params.cliAgentId) {
            continue;
          }

          const ts = new Date(entry.timestamp);
          if (params.since && ts < params.since) {
            continue;
          }
          if (params.until && ts > params.until) {
            continue;
          }

          entries.push(entry);
          if (params.limit && entries.length >= params.limit) {
            return entries;
          }
        } catch {
          // Skip malformed lines
        }
      }
    }
  } catch {
    // Return what we have
  }

  return entries;
}
