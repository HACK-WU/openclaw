#!/usr/bin/env node
/**
 * PTY Interactive Test Script for codebuddy -y
 *
 * This script spawns codebuddy in PTY mode and outputs content
 * when changes are detected (with throttling).
 */

import fs from "node:fs";
import readline from "node:readline";
import { stripDsrRequests, buildCursorPositionResponse } from "../src/agents/pty-dsr.js";

const LOG_FILE = "/tmp/test-pty-codebuddy.log";
const PTY_OUTPUT_FILE = "/tmp/test-pty-codebuddy-output.txt";
const PTY_RAW_FILE = "/tmp/test-pty-codebuddy-raw.txt";

const THROTTLE_MS = 200;

// Global state
let aggregated = "";
let lastPushedContent = "";
let throttleTimer = null;

function log(message, toConsole = true) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  if (toConsole) {
    console.log(line);
  }
  fs.appendFileSync(LOG_FILE, line + "\n", "utf-8");
}

function writeOutput(content) {
  fs.appendFileSync(PTY_OUTPUT_FILE, content + "\n--- UPDATE ---\n", "utf-8");
}

function writePtyRawOutput(data) {
  fs.appendFileSync(PTY_RAW_FILE, data, "utf-8");
}

function emitUpdate() {
  if (aggregated === lastPushedContent) {
    return;
  }

  if (throttleTimer) {
    return;
  }

  throttleTimer = setTimeout(() => {
    throttleTimer = null;
    if (aggregated !== lastPushedContent) {
      lastPushedContent = aggregated;
      writeOutput(aggregated);
      log(`Update pushed: ${aggregated.length} chars`, false);
    }
  }, THROTTLE_MS);
}

async function main() {
  console.log("=".repeat(80));
  console.log("PTY Interactive Test - codebuddy -y");
  console.log("=".repeat(80));
  console.log(`Log file: ${LOG_FILE}`);
  console.log(`PTY output file: ${PTY_OUTPUT_FILE}`);
  console.log(`PTY raw output: ${PTY_RAW_FILE}`);
  console.log("Commands:");
  console.log("  Type normally to send to codebuddy");
  console.log("  Ctrl+C to exit");
  console.log("-".repeat(80));
  console.log();

  // Clear log files
  fs.writeFileSync(LOG_FILE, "", "utf-8");
  fs.writeFileSync(PTY_OUTPUT_FILE, "", "utf-8");
  fs.writeFileSync(PTY_RAW_FILE, "", "utf-8");

  // Dynamically import node-pty
  const ptyModule = await import("@lydell/node-pty");
  const spawn = ptyModule.spawn || ptyModule.default?.spawn;
  if (!spawn) {
    throw new Error("PTY spawn not found in @lydell/node-pty module");
  }

  const shell = process.platform === "win32" ? "powershell.exe" : "bash";
  const args = ["-c", "codebuddy -y"];

  log(`Spawning PTY: ${shell} ${args.join(" ")}`);

  const pty = spawn(shell, args, {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: process.cwd(),
    env: process.env,
  });

  log(`PTY spawned with PID: ${pty.pid}`);

  // Handle PTY output
  const cursorResponse = buildCursorPositionResponse();
  const ptyInstance = pty;

  ptyInstance.onData((data) => {
    const raw = data.toString();
    writePtyRawOutput(raw);

    const { cleaned, requests } = stripDsrRequests(raw);
    if (requests > 0) {
      for (let i = 0; i < requests; i += 1) {
        ptyInstance.write(cursorResponse);
      }
    }

    aggregated += cleaned;
    emitUpdate();
  });

  // Handle PTY exit
  pty.onExit((event) => {
    log(`PTY exited with code: ${event.exitCode}, signal: ${event.signal}`);
    console.log("\n");
    console.log("=".repeat(80));
    console.log("PTY session ended");
    console.log("=".repeat(80));
    console.log(`\nOutput files:`);
    console.log(`  Log: ${LOG_FILE}`);
    console.log(`  Output: ${PTY_OUTPUT_FILE}`);
    console.log(`  Raw: ${PTY_RAW_FILE}`);
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

  process.stdin.on("data", (data) => {
    if (!process.stdin.isTTY) {
      const str = data.toString();
      pty.write(str);
      log(`Sent (pipe): ${str.replace(/\n/g, "\\n")}`);
    }
  });

  log("Interactive session started. Waiting for input...");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
