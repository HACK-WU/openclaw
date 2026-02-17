import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { beforeEach, describe, expect, it } from "vitest";
import type { ProcessSession } from "./bash-process-registry.js";
import {
  addSession,
  appendOutput,
  countLines,
  drainSession,
  listFinishedSessions,
  markBackgrounded,
  markExited,
  resetProcessRegistryForTests,
  trimByLines,
} from "./bash-process-registry.js";

describe("bash process registry", () => {
  beforeEach(() => {
    resetProcessRegistryForTests();
  });

  it("captures output and truncates", () => {
    const session: ProcessSession = {
      id: "sess",
      command: "echo test",
      child: { pid: 123 } as ChildProcessWithoutNullStreams,
      startedAt: Date.now(),
      cwd: "/tmp",
      maxOutputChars: 10,
      pendingMaxOutputChars: 30_000,
      totalOutputChars: 0,
      pendingStdout: [],
      pendingStderr: [],
      pendingStdoutChars: 0,
      pendingStderrChars: 0,
      aggregated: "",
      tail: "",
      exited: false,
      exitCode: undefined,
      exitSignal: undefined,
      truncated: false,
      backgrounded: false,
    };

    addSession(session);
    appendOutput(session, "stdout", "0123456789");
    appendOutput(session, "stdout", "abcdef");

    expect(session.aggregated).toBe("6789abcdef");
    expect(session.truncated).toBe(true);
  });

  it("caps pending output to avoid runaway polls", () => {
    const session: ProcessSession = {
      id: "sess",
      command: "echo test",
      child: { pid: 123 } as ChildProcessWithoutNullStreams,
      startedAt: Date.now(),
      cwd: "/tmp",
      maxOutputChars: 100_000,
      pendingMaxOutputChars: 20_000,
      totalOutputChars: 0,
      pendingStdout: [],
      pendingStderr: [],
      pendingStdoutChars: 0,
      pendingStderrChars: 0,
      aggregated: "",
      tail: "",
      exited: false,
      exitCode: undefined,
      exitSignal: undefined,
      truncated: false,
      backgrounded: true,
    };

    addSession(session);
    const payload = `${"a".repeat(70_000)}${"b".repeat(20_000)}`;
    appendOutput(session, "stdout", payload);

    const drained = drainSession(session);
    expect(drained.stdout).toBe("b".repeat(20_000));
    expect(session.pendingStdout).toHaveLength(0);
    expect(session.pendingStdoutChars).toBe(0);
    expect(session.truncated).toBe(true);
  });

  it("respects max output cap when pending cap is larger", () => {
    const session: ProcessSession = {
      id: "sess",
      command: "echo test",
      child: { pid: 123 } as ChildProcessWithoutNullStreams,
      startedAt: Date.now(),
      cwd: "/tmp",
      maxOutputChars: 5_000,
      pendingMaxOutputChars: 30_000,
      totalOutputChars: 0,
      pendingStdout: [],
      pendingStderr: [],
      pendingStdoutChars: 0,
      pendingStderrChars: 0,
      aggregated: "",
      tail: "",
      exited: false,
      exitCode: undefined,
      exitSignal: undefined,
      truncated: false,
      backgrounded: true,
    };

    addSession(session);
    appendOutput(session, "stdout", "x".repeat(10_000));

    const drained = drainSession(session);
    expect(drained.stdout.length).toBe(5_000);
    expect(session.truncated).toBe(true);
  });

  it("caps stdout and stderr independently", () => {
    const session: ProcessSession = {
      id: "sess",
      command: "echo test",
      child: { pid: 123 } as ChildProcessWithoutNullStreams,
      startedAt: Date.now(),
      cwd: "/tmp",
      maxOutputChars: 100,
      pendingMaxOutputChars: 10,
      totalOutputChars: 0,
      pendingStdout: [],
      pendingStderr: [],
      pendingStdoutChars: 0,
      pendingStderrChars: 0,
      aggregated: "",
      tail: "",
      exited: false,
      exitCode: undefined,
      exitSignal: undefined,
      truncated: false,
      backgrounded: true,
    };

    addSession(session);
    appendOutput(session, "stdout", "a".repeat(6));
    appendOutput(session, "stdout", "b".repeat(6));
    appendOutput(session, "stderr", "c".repeat(12));

    const drained = drainSession(session);
    expect(drained.stdout).toBe("a".repeat(4) + "b".repeat(6));
    expect(drained.stderr).toBe("c".repeat(10));
    expect(session.truncated).toBe(true);
  });

  it("only persists finished sessions when backgrounded", () => {
    const session: ProcessSession = {
      id: "sess",
      command: "echo test",
      child: { pid: 123 } as ChildProcessWithoutNullStreams,
      startedAt: Date.now(),
      cwd: "/tmp",
      maxOutputChars: 100,
      pendingMaxOutputChars: 30_000,
      totalOutputChars: 0,
      pendingStdout: [],
      pendingStderr: [],
      pendingStdoutChars: 0,
      pendingStderrChars: 0,
      aggregated: "",
      tail: "",
      exited: false,
      exitCode: undefined,
      exitSignal: undefined,
      truncated: false,
      backgrounded: false,
    };

    addSession(session);
    markExited(session, 0, null, "completed");
    expect(listFinishedSessions()).toHaveLength(0);

    markBackgrounded(session);
    markExited(session, 0, null, "completed");
    expect(listFinishedSessions()).toHaveLength(1);
  });
});

describe("trimByLines", () => {
  it("returns text as-is when within line limit", () => {
    const text = "line1\nline2\nline3\n";
    expect(trimByLines(text, 5)).toBe(text);
  });

  it("returns empty text as-is", () => {
    expect(trimByLines("", 10)).toBe("");
  });

  it("trims to last N lines and adds banner", () => {
    const text = "line1\nline2\nline3\nline4\nline5\n";
    const result = trimByLines(text, 3);
    expect(result).toContain("truncated");
    expect(result).toContain("line3\nline4\nline5\n");
    expect(result).not.toContain("line1");
    expect(result).not.toContain("line2");
  });

  it("handles text without trailing newline", () => {
    const text = "line1\nline2\nline3\nline4\nline5";
    const result = trimByLines(text, 2);
    expect(result).toContain("line4\nline5");
  });
});

describe("countLines", () => {
  it("counts lines correctly", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("single")).toBe(0);
    expect(countLines("line1\n")).toBe(1);
    expect(countLines("line1\nline2\nline3\n")).toBe(3);
  });
});

describe("PTY line truncation", () => {
  beforeEach(() => {
    resetProcessRegistryForTests();
  });

  it("truncates PTY output by line count", () => {
    const session: ProcessSession = {
      id: "pty-sess",
      command: "long output",
      startedAt: Date.now(),
      cwd: "/tmp",
      maxOutputChars: 100_000,
      pendingMaxOutputChars: 30_000,
      maxLines: 5,
      totalOutputChars: 0,
      pendingStdout: [],
      pendingStderr: [],
      pendingStdoutChars: 0,
      pendingStderrChars: 0,
      aggregated: "",
      tail: "",
      exited: false,
      exitCode: undefined,
      exitSignal: undefined,
      truncated: false,
      backgrounded: false,
      isPty: true,
    };

    addSession(session);
    // Add 10 lines
    appendOutput(
      session,
      "stdout",
      "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    );

    expect(session.truncatedByLines).toBe(true);
    expect(session.aggregated).toContain("truncated");
    expect(session.aggregated).toContain("line6");
    expect(session.aggregated).not.toContain("line5");
  });

  it("does not truncate non-PTY sessions by lines", () => {
    const session: ProcessSession = {
      id: "non-pty-sess",
      command: "regular exec",
      startedAt: Date.now(),
      cwd: "/tmp",
      maxOutputChars: 100_000,
      pendingMaxOutputChars: 30_000,
      totalOutputChars: 0,
      pendingStdout: [],
      pendingStderr: [],
      pendingStdoutChars: 0,
      pendingStderrChars: 0,
      aggregated: "",
      tail: "",
      exited: false,
      exitCode: undefined,
      exitSignal: undefined,
      truncated: false,
      backgrounded: false,
      isPty: false,
    };

    addSession(session);
    appendOutput(
      session,
      "stdout",
      "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\n",
    );

    expect(session.truncatedByLines).toBeUndefined();
    expect(session.aggregated).toContain("line1");
    expect(session.aggregated).toContain("line10");
  });
});
