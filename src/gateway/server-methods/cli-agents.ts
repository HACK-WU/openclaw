/**
 * CLI Agent — Gateway RPC Handlers
 *
 * Implements all `cliAgents.*` gateway methods.
 * CLI Agents are fully independent from general Agents:
 * - Stored in `cli-agents/bridge.json` (not `openclaw.json`)
 * - Workspace at `cli-agents/{agentId}/` (not `agents/{agentId}/`)
 * - No model/skills/channels configuration
 */

import { describeAgentIdError, validateAgentUniqueness } from "../../agents/agent-id-validation.js";
import { resolveCliAgentWorkspaceDir } from "../../agents/cli-agent-scope.js";
import { listAgentEntries } from "../../commands/agents.config.js";
import {
  findCliAgentEntry,
  generateCliAgentWorkspaceFiles,
  isAllowedCliAgentFile,
  listCliAgentEntries,
  listCliAgentFiles,
  readCliAgentFile,
  removeCliAgentEntry,
  upsertCliAgentEntry,
  writeCliAgentFile,
} from "../../commands/cli-agents.config.js";
import { loadConfig } from "../../config/config.js";
import type { CliAgentEntry } from "../../config/types.cli-agents.js";
import type { CliType } from "../../group-chat/bridge-types.js";
import { getLogger } from "../../logging.js";
import type { GatewayRequestHandler, GatewayRequestHandlers } from "./types.js";

const log = getLogger("cli-agents:handler");

// ─── Validation Helpers ───

const VALID_CLI_TYPES = new Set<string>(["claude-code", "opencode", "codebuddy", "custom"]);

function isValidCliType(value: unknown): value is CliType {
  return typeof value === "string" && VALID_CLI_TYPES.has(value);
}

function requireString(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

function optionalStringArray(params: Record<string, unknown>, key: string): string[] | undefined {
  const value = params[key];
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return value;
  }
  return undefined;
}

function optionalRecord(
  params: Record<string, unknown>,
  key: string,
): Record<string, string> | undefined {
  const value = params[key];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === "string") {
        record[k] = v;
      }
    }
    return Object.keys(record).length > 0 ? record : undefined;
  }
  return undefined;
}

function optionalTimeout(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  if (typeof value === "number" && Number.isFinite(value) && value >= 1000) {
    return value;
  }
  return undefined;
}

/**
 * Collect existing general agents as `{ id, name }[]` for uniqueness checks.
 */
function getExistingGeneralAgents(): Array<{ id: string; name?: string }> {
  try {
    const cfg = loadConfig();
    return listAgentEntries(cfg).map((a) => ({
      id: a.id,
      name: a.name,
    }));
  } catch {
    return [];
  }
}

// ─── Handlers ───

const handleCliAgentsList: GatewayRequestHandler = ({ respond }) => {
  const agents = listCliAgentEntries();
  respond(true, { agents });
};

const handleCliAgentsCreate: GatewayRequestHandler = async ({ params, respond }) => {
  // Validate required params
  const agentId = requireString(params, "agentId");
  const name = requireString(params, "name");
  const command = requireString(params, "command");
  const cliTypeRaw = params.cliType;

  if (!agentId || !name || !command) {
    respond(false, undefined, {
      message: "agentId, name, and command are required",
      code: 400,
    });
    return;
  }

  if (!isValidCliType(cliTypeRaw)) {
    respond(false, undefined, {
      message: `Invalid cliType "${String(cliTypeRaw)}". Must be one of: claude-code, opencode, codebuddy, custom`,
      code: 400,
    });
    return;
  }

  // Validate AgentID format
  const idError = describeAgentIdError(agentId);
  if (idError) {
    respond(false, undefined, { message: `Invalid agentId: ${idError}`, code: 400 });
    return;
  }

  // Validate global uniqueness (across general Agents + CLI Agents)
  const existingGeneralAgents = getExistingGeneralAgents();
  const existingCliAgents = listCliAgentEntries();
  const uniqueness = validateAgentUniqueness(
    agentId,
    name,
    existingGeneralAgents,
    existingCliAgents,
  );
  if (!uniqueness.valid) {
    respond(false, undefined, { message: uniqueness.error!, code: 409 });
    return;
  }

  // Build entry
  const entry: CliAgentEntry = {
    id: agentId,
    name,
    type: cliTypeRaw,
    command,
    args: optionalStringArray(params, "args"),
    cwd: optionalString(params, "cwd"),
    env: optionalRecord(params, "env"),
    timeout: optionalTimeout(params, "timeout"),
    emoji: optionalString(params, "emoji"),
  };

  // Write to bridge.json + create workspace files
  await upsertCliAgentEntry(entry);
  await generateCliAgentWorkspaceFiles(entry);

  const workspace = resolveCliAgentWorkspaceDir(agentId);
  log.info("[CLI_AGENT_CREATED]", { agentId, name, cliType: cliTypeRaw, workspace });
  respond(true, { ok: true, agentId, workspace });
};

const handleCliAgentsUpdate: GatewayRequestHandler = async ({ params, respond }) => {
  const agentId = requireString(params, "agentId");
  if (!agentId) {
    respond(false, undefined, { message: "agentId is required", code: 400 });
    return;
  }

  const existing = findCliAgentEntry(agentId);
  if (!existing) {
    respond(false, undefined, { message: `CLI Agent "${agentId}" not found`, code: 404 });
    return;
  }

  // Build updated entry (merge with existing)
  const updatedName = optionalString(params, "name");

  // If name changes, check uniqueness
  if (updatedName && updatedName !== existing.name) {
    const existingGeneralAgents = getExistingGeneralAgents();
    const existingCliAgents = listCliAgentEntries();
    const uniqueness = validateAgentUniqueness(
      agentId,
      updatedName,
      existingGeneralAgents,
      existingCliAgents,
      agentId, // exclude self
    );
    if (!uniqueness.valid) {
      respond(false, undefined, { message: uniqueness.error!, code: 409 });
      return;
    }
  }

  const updated: CliAgentEntry = {
    ...existing,
    ...(updatedName ? { name: updatedName } : {}),
    ...(optionalString(params, "command") ? { command: optionalString(params, "command")! } : {}),
    ...(optionalStringArray(params, "args") !== undefined
      ? { args: optionalStringArray(params, "args") }
      : {}),
    ...(optionalString(params, "cwd") !== undefined ? { cwd: optionalString(params, "cwd") } : {}),
    ...(optionalRecord(params, "env") !== undefined ? { env: optionalRecord(params, "env") } : {}),
    ...(optionalTimeout(params, "timeout") !== undefined
      ? { timeout: optionalTimeout(params, "timeout") }
      : {}),
    ...(optionalString(params, "emoji") !== undefined
      ? { emoji: optionalString(params, "emoji") }
      : {}),
  };

  await upsertCliAgentEntry(updated);
  log.info("[CLI_AGENT_UPDATED]", { agentId });
  respond(true, { ok: true, agentId });
};

const handleCliAgentsDelete: GatewayRequestHandler = async ({ params, respond }) => {
  const agentId = requireString(params, "agentId");
  if (!agentId) {
    respond(false, undefined, { message: "agentId is required", code: 400 });
    return;
  }

  const removed = await removeCliAgentEntry(agentId);
  if (!removed) {
    respond(false, undefined, { message: `CLI Agent "${agentId}" not found`, code: 404 });
    return;
  }

  log.info("[CLI_AGENT_DELETED]", { agentId });
  respond(true, { ok: true, agentId });
};

const handleCliAgentsFilesList: GatewayRequestHandler = async ({ params, respond }) => {
  const agentId = requireString(params, "agentId");
  if (!agentId) {
    respond(false, undefined, { message: "agentId is required", code: 400 });
    return;
  }

  const existing = findCliAgentEntry(agentId);
  if (!existing) {
    respond(false, undefined, { message: `CLI Agent "${agentId}" not found`, code: 404 });
    return;
  }

  const files = await listCliAgentFiles(agentId);
  const workspace = resolveCliAgentWorkspaceDir(agentId);
  respond(true, { agentId, workspace, files });
};

const handleCliAgentsFilesGet: GatewayRequestHandler = async ({ params, respond }) => {
  const agentId = requireString(params, "agentId");
  const name = requireString(params, "name");
  if (!agentId || !name) {
    respond(false, undefined, { message: "agentId and name are required", code: 400 });
    return;
  }

  if (!isAllowedCliAgentFile(name)) {
    respond(false, undefined, {
      message: `File "${name}" is not allowed for CLI Agent workspace`,
      code: 400,
    });
    return;
  }

  const existing = findCliAgentEntry(agentId);
  if (!existing) {
    respond(false, undefined, { message: `CLI Agent "${agentId}" not found`, code: 404 });
    return;
  }

  const result = await readCliAgentFile(agentId, name);
  const workspace = resolveCliAgentWorkspaceDir(agentId);

  if (!result) {
    respond(true, {
      agentId,
      workspace,
      file: { name, path: `${workspace}/${name}`, missing: true },
    });
    return;
  }

  respond(true, {
    agentId,
    workspace,
    file: {
      name,
      path: `${workspace}/${name}`,
      missing: false,
      size: result.size,
      content: result.content,
    },
  });
};

const handleCliAgentsFilesSet: GatewayRequestHandler = async ({ params, respond }) => {
  const agentId = requireString(params, "agentId");
  const name = requireString(params, "name");
  if (!agentId || !name) {
    respond(false, undefined, { message: "agentId and name are required", code: 400 });
    return;
  }

  if (!isAllowedCliAgentFile(name)) {
    respond(false, undefined, {
      message: `File "${name}" is not allowed for CLI Agent workspace`,
      code: 400,
    });
    return;
  }

  const existing = findCliAgentEntry(agentId);
  if (!existing) {
    respond(false, undefined, { message: `CLI Agent "${agentId}" not found`, code: 404 });
    return;
  }

  const content = typeof params.content === "string" ? params.content : "";
  const written = await writeCliAgentFile(agentId, name, content);
  if (!written) {
    respond(false, undefined, { message: "Failed to write file", code: 500 });
    return;
  }

  const workspace = resolveCliAgentWorkspaceDir(agentId);
  respond(true, {
    ok: true,
    agentId,
    workspace,
    file: { name, path: `${workspace}/${name}`, missing: false, content },
  });
};

const handleCliAgentsTest: GatewayRequestHandler = async ({ params, respond, context }) => {
  const agentId = requireString(params, "agentId");
  if (!agentId) {
    respond(false, undefined, { message: "agentId is required", code: 400 });
    return;
  }

  const existing = findCliAgentEntry(agentId);
  if (!existing) {
    respond(false, undefined, { message: `CLI Agent "${agentId}" not found`, code: 404 });
    return;
  }

  const { command, cwd } = existing;
  const checks: Array<{ name: string; ok: boolean; message?: string }> = [];

  // Check 1: command defined
  checks.push({ name: "command_defined", ok: Boolean(command), message: command || "not set" });
  if (!command) {
    respond(true, { ok: false, agentId, checks });
    return;
  }

  // Check 2: command exists (which)
  try {
    const { execSync } = await import("node:child_process");
    const whichResult = execSync(
      `which ${command} 2>/dev/null || command -v ${command} 2>/dev/null`,
      {
        timeout: 5000,
        encoding: "utf-8",
      },
    ).trim();
    checks.push({ name: "command_exists", ok: true, message: whichResult || command });
  } catch {
    checks.push({ name: "command_exists", ok: false, message: `"${command}" not found in PATH` });
    respond(true, { ok: false, agentId, checks });
    return;
  }

  // Check 3: cwd accessible
  if (cwd) {
    try {
      const fs = await import("node:fs");
      // If directory doesn't exist, try to create it (default workspace may not exist yet)
      if (!fs.existsSync(cwd)) {
        try {
          fs.mkdirSync(cwd, { recursive: true });
          checks.push({ name: "cwd_accessible", ok: true, message: `${cwd} (created)` });
        } catch {
          checks.push({ name: "cwd_accessible", ok: false, message: `${cwd} is not accessible` });
          respond(true, { ok: false, agentId, checks });
          return;
        }
      } else {
        fs.accessSync(cwd, fs.constants.R_OK);
        checks.push({ name: "cwd_accessible", ok: true, message: cwd });
      }
    } catch {
      checks.push({ name: "cwd_accessible", ok: false, message: `${cwd} is not accessible` });
      respond(true, { ok: false, agentId, checks });
      return;
    }
  } else {
    checks.push({ name: "cwd_accessible", ok: true, message: "(default)" });
  }

  // Check 4: PTY spawn test — launch the CLI with a short timeout
  const testGroupId = `__test__${agentId}`;
  const broadcast = context.broadcast;

  try {
    const { createBridgePty } = await import("../../group-chat/bridge-pty.js");

    let completed = false;
    let outputReceived = false;

    const ptyState = await createBridgePty({
      groupId: testGroupId,
      agentId,
      config: {
        type: existing.type,
        command: existing.command,
        args: existing.args,
        cwd: existing.cwd,
        env: existing.env,
        timeout: 15_000, // 15 second timeout for test
      },
      completionIdleSecs: 5,
      onRawData: (data: string) => {
        outputReceived = true;
        // Stream test output to connected clients
        broadcast("cliAgents.testOutput", {
          agentId,
          data: Buffer.from(data, "utf-8").toString("base64"),
        });
      },
      onCompletion: () => {
        completed = true;
      },
      onExit: (_code: number | null, _signal: number | null) => {
        completed = true;
      },
    });

    checks.push({
      name: "pty_spawn",
      ok: Boolean(ptyState.pid),
      message: ptyState.pid ? `PID ${ptyState.pid}` : "no pid",
    });

    // Wait for CLI to initialize and produce output (no stdin needed — TUI programs start on their own)
    await new Promise<void>((resolve) => setTimeout(resolve, 2000));

    // Wait up to 10 seconds for some output
    const waitStart = Date.now();
    while (!completed && Date.now() - waitStart < 10_000) {
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }

    checks.push({
      name: "output_received",
      ok: outputReceived,
      message: outputReceived ? "CLI produced output" : "no output received",
    });

    // NOTE: Do NOT kill the PTY here — keep it alive so the user can interact
    // via quick-test buttons. The PTY is cleaned up when the user clicks
    // "Stop" (cliAgents.testStop) or closes the dialog.
    activeTestKeys.add(agentId);

    const allOk = checks.every((c) => c.ok);
    respond(true, { ok: allOk, agentId, checks });
  } catch (err) {
    checks.push({
      name: "pty_spawn",
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    });
    // Ensure cleanup
    try {
      const { killBridgePty } = await import("../../group-chat/bridge-pty.js");
      await killBridgePty(testGroupId, agentId, "test_error");
    } catch {
      /* ignore cleanup errors */
    }
    respond(true, { ok: false, agentId, checks });
  }
};

/** Active test PTY tracking for testStop */
const activeTestKeys = new Set<string>();

const handleCliAgentsTestStop: GatewayRequestHandler = async ({ params, respond }) => {
  const agentId = requireString(params, "agentId");
  if (!agentId) {
    respond(false, undefined, { message: "agentId is required", code: 400 });
    return;
  }

  const testGroupId = `__test__${agentId}`;
  try {
    const { killBridgePty } = await import("../../group-chat/bridge-pty.js");
    await killBridgePty(testGroupId, agentId, "test_stopped");
  } catch {
    /* ignore */
  }

  activeTestKeys.delete(agentId);
  respond(true, { ok: true, agentId });
};

const handleCliAgentsTestSendInput: GatewayRequestHandler = async ({ params, respond }) => {
  const agentId = requireString(params, "agentId");
  const input = requireString(params, "input");
  if (!agentId || input == null) {
    respond(false, undefined, { message: "agentId and input are required", code: 400 });
    return;
  }
  const testGroupId = `__test__${agentId}`;
  try {
    const { writeToPty, isPtyRunning } = await import("../../group-chat/bridge-pty.js");
    if (!isPtyRunning(testGroupId, agentId)) {
      respond(false, undefined, { message: "No running test PTY", code: 404 });
      return;
    }
    // Write text first, then send \r (Enter) after a short delay.
    // ink's raw-mode TUI treats \r as the Enter/submit key.
    // Sending them together can cause the TUI to misinterpret the input;
    // the delay lets the TUI process the text before receiving Enter.
    writeToPty(testGroupId, agentId, input);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    const ok = writeToPty(testGroupId, agentId, "\r");
    respond(true, { ok, agentId });
  } catch (err) {
    respond(false, undefined, {
      message: err instanceof Error ? err.message : String(err),
      code: 500,
    });
  }
};

// ─── Export handler map ───

export const cliAgentsHandlers: GatewayRequestHandlers = {
  "cliAgents.list": handleCliAgentsList,
  "cliAgents.create": handleCliAgentsCreate,
  "cliAgents.update": handleCliAgentsUpdate,
  "cliAgents.delete": handleCliAgentsDelete,
  "cliAgents.files.list": handleCliAgentsFilesList,
  "cliAgents.files.get": handleCliAgentsFilesGet,
  "cliAgents.files.set": handleCliAgentsFilesSet,
  "cliAgents.test": handleCliAgentsTest,
  "cliAgents.testStop": handleCliAgentsTestStop,
  "cliAgents.testSendInput": handleCliAgentsTestSendInput,
};
