#!/usr/bin/env node
/**
 * PTY Push Framework Test Script
 *
 * Tests the pty-push incremental push logic with codebuddy -y
 * Outputs incremental deltas and full content for debugging.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { stripDsrRequests, buildCursorPositionResponse } from "../src/agents/pty-dsr.js";
import { matchCommandProfile, calculateDelta } from "../src/agents/pty-push/index.js";

const LOG_FILE = path.join(os.tmpdir(), "test-pty-push.log");
const DELTA_LOG_FILE = path.join(os.tmpdir(), "test-pty-push-deltas.log");

function log(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  fs.appendFileSync(LOG_FILE, line + "\n", "utf-8");
}

function logDelta(message) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  fs.appendFileSync(DELTA_LOG_FILE, line + "\n", "utf-8");
}

async function main() {
  console.log("=".repeat(80));
  console.log("PTY Push Framework Test - codebuddy -y");
  console.log("=".repeat(80));
  console.log(`Log file: ${LOG_FILE}`);
  console.log(`Delta log: ${DELTA_LOG_FILE}`);
  console.log("Commands:");
  console.log("  Type normally to send to codebuddy");
  console.log("  Ctrl+C to exit");
  console.log("-".repeat(80));
  console.log();

  // Clear log files
  fs.writeFileSync(LOG_FILE, "", "utf-8");
  fs.writeFileSync(DELTA_LOG_FILE, "", "utf-8");

  // Dynamically import node-pty (same as bash-tools.exec.ts)
  const ptyModule = await import("@lydell/node-pty");
  const spawn = ptyModule.spawn || ptyModule.default?.spawn;
  if (!spawn) {
    throw new Error("PTY spawn not found in @lydell/node-pty module");
  }

  const command = "codebuddy -y";
  const commandProfile = matchCommandProfile(command);

  log(`Command: ${command}`);
  log(`Matched profile: ${commandProfile.id}`);
  log(`Fixed lines: ${commandProfile.fixedRegion.fixedLines || "dynamic"}`);
  log(`Position: ${commandProfile.fixedRegion.position}`);

  const shell = process.platform === "win32" ? "powershell.exe" : "bash";
  const args = ["-c", command];

  const pty = spawn(shell, args, {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: process.cwd(),
    env: process.env,
  });

  log(`PTY spawned with PID: ${pty.pid}`);

  let aggregated = "";
  let pushState = undefined;
  let sessionId = `test-${Date.now()}`;

  function processAndPush(fullText) {
    const result = calculateDelta({
      fullText,
      sessionId,
      isPty: true,
      warnings: [],
      state: pushState,
      profile: commandProfile,
    });

    pushState = result.newState;

    if (result.shouldPush) {
      logDelta("=".repeat(60));
      logDelta(`Reason: ${result.reason}`);
      logDelta(`Profile: ${commandProfile.id}`);
      logDelta(`Fixed Lines: ${pushState.fixedLines}`);
      logDelta(`Full Length: ${fullText.length} chars`);
      logDelta(`Delta Size: ${result.content.length} chars`);
      logDelta(`Last Position: ${pushState.lastPushedPosition}`);
      logDelta(`Dynamic Line Changed: ${result.reason.includes("dynamic") ? "YES" : "NO"}`);
      logDelta("-".repeat(60));
      logDelta("DELTA CONTENT:");
      logDelta(result.content);
      logDelta("=".repeat(60));
      logDelta("");

      // Also output to console with visual separator
      console.log("\n" + "=".repeat(60));
      console.log(`[DELTA] ${result.reason} | ${result.content.length} chars`);
      console.log("=".repeat(60));
      console.log(result.content);
      console.log("=".repeat(60) + "\n");
    } else {
      logDelta(`[SKIPPED] ${result.reason}`);
    }
  }

  // Handle PTY output
  pty.onData((data) => {
    const raw = data.toString();
    log(`RAW PTY (${raw.length} chars)`);

    // Process DSR requests (same as bash-tools.exec.ts)
    const cursorResponse = buildCursorPositionResponse();
    const { cleaned, requests } = stripDsrRequests(raw);

    if (requests > 0) {
      log(`DSR requests: ${requests}`);
      for (let i = 0; i < requests; i++) {
        pty.write(cursorResponse);
      }
    }

    if (cleaned) {
      aggregated += cleaned;
      processAndPush(aggregated);
    }
  });

  // Handle PTY exit
  pty.onExit((event) => {
    log(`PTY exited with code: ${event.exitCode}`);
    console.log("\n");
    console.log("=".repeat(80));
    console.log("Final aggregated content:");
    console.log("=".repeat(80));
    console.log(aggregated);
    console.log("=".repeat(80));
    console.log(`Session ended. Logs saved to:`);
    console.log(`  ${LOG_FILE}`);
    console.log(`  ${DELTA_LOG_FILE}`);
    process.exit(event.exitCode ?? 0);
  });

  // Setup stdin handling
  readline.emitKeypressEvents(process.stdin);

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.on("keypress", (str, key) => {
    if (key.ctrl && key.name === "c") {
      log("Ctrl+C pressed, killing PTY...");
      pty.kill("SIGTERM");
      return;
    }

    if (key.name === "return") {
      pty.write("\r");
      log("Sent: <RETURN>");
    } else if (key.name === "backspace") {
      pty.write("\x7f");
      log("Sent: <BACKSPACE>");
    } else if (key.name === "tab") {
      pty.write("\t");
      log("Sent: <TAB>");
    } else if (key.name === "escape") {
      pty.write("\x1b");
      log("Sent: <ESCAPE>");
    } else if (key.name === "up") {
      pty.write("\x1b[A");
      log("Sent: <UP>");
    } else if (key.name === "down") {
      pty.write("\x1b[B");
      log("Sent: <DOWN>");
    } else if (key.name === "right") {
      pty.write("\x1b[C");
      log("Sent: <RIGHT>");
    } else if (key.name === "left") {
      pty.write("\x1b[D");
      log("Sent: <LEFT>");
    } else if (str) {
      pty.write(str);
      log(`Sent: ${str}`);
    }
  });

  log("Interactive session started");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
