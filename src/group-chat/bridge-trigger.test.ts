import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TriggerAgentParams } from "./agent-trigger.js";
import type { BridgeConfig, BridgePtyState } from "./bridge-types.js";
import type { GroupSessionEntry } from "./types.js";

const waitForFrontendExtractedText = vi.fn();
const isPtyRunning = vi.fn();
const createBridgePty = vi.fn();
const writeToPty = vi.fn();
const clearFrontendExtractedText = vi.fn();
const updateLastTranscriptIndex = vi.fn();
const appendGroupMessage = vi.fn();
const broadcastGroupStream = vi.fn();
const broadcastGroupMessage = vi.fn();
const broadcastTerminalData = vi.fn();
const broadcastTerminalStatus = vi.fn();
const buildCoreFilesContentSection = vi.fn();
const buildCoreFilesPathSection = vi.fn();
const getPtyState = vi.fn();
const setInputPhase = vi.fn();
const killBridgePty = vi.fn();

vi.mock("./bridge-pty.js", () => ({
  clearFrontendExtractedText,
  createBridgePty,
  getPtyState,
  isPtyRunning,
  killBridgePty,
  setInputPhase,
  updateLastTranscriptIndex,
  waitForFrontendExtractedText,
  writeToPty,
}));

vi.mock("./transcript.js", () => ({
  appendGroupMessage,
}));

vi.mock("./parallel-stream.js", () => ({
  broadcastGroupMessage,
  broadcastGroupStream,
}));

vi.mock("./terminal-events.js", () => ({
  broadcastTerminalData,
  broadcastTerminalStatus,
}));

vi.mock("./bridge-context.js", () => ({
  buildCoreFilesContentSection,
  buildCoreFilesPathSection,
}));

vi.mock("./anti-loop.js", () => ({
  updateChainState: vi.fn((state) => state),
}));

const { triggerBridgeAgent, _test } = await import("./bridge-trigger.js");

function makeMeta(): GroupSessionEntry {
  return {
    groupId: "g1",
    groupName: "Test Group",
    messageMode: "unicast",
    members: [
      {
        agentId: "cli",
        role: "assistant",
        joinedAt: 1,
        bridge: { type: "custom", command: "cli" },
      },
    ],
    memberRolePrompts: [],
    announcement: "",
    groupSkills: [],
    maxRounds: 20,
    maxConsecutive: 3,
    historyLimit: 50,
    createdAt: 1,
    updatedAt: 1,
    cliTimeout: 30_000,
  };
}

function makePtyState(overrides?: Partial<BridgePtyState>): BridgePtyState {
  return {
    status: "running",
    initialised: true,
    lastOutputAt: 0,
    lastInputAt: 0,
    restartCount: 0,
    maxRestarts: 3,
    idleTimeoutMs: 600_000,
    lastTranscriptIndex: 0,
    isFirstInteraction: false,
    interactionCount: 1,
    lastRoleReminderAt: 1,
    ...overrides,
  };
}

function makeParams(content: string): TriggerAgentParams {
  const meta = makeMeta();
  const now = Date.now();
  return {
    groupId: "g1",
    agentId: "cli",
    meta,
    transcriptSnapshot: [
      {
        id: `msg-${content}`,
        groupId: "g1",
        role: "user",
        content,
        sender: { type: "owner" },
        timestamp: now,
      },
    ],
    triggerMessage: {
      id: `msg-${content}`,
      groupId: "g1",
      role: "user",
      content,
      sender: { type: "owner" },
      timestamp: now,
    },
    chainState: {
      originMessageId: "origin-1",
      roundCount: 1,
      startedAt: now,
      triggeredAgents: ["cli"],
    },
    broadcast: vi.fn(),
    signal: new AbortController().signal,
  };
}

describe("bridge-trigger queueing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _test.resetBridgeAgentQueues();

    buildCoreFilesContentSection.mockResolvedValue("# core content");
    buildCoreFilesPathSection.mockReturnValue("# core paths");
    createBridgePty.mockResolvedValue(makePtyState());
    getPtyState.mockReturnValue(makePtyState());
    setInputPhase.mockImplementation(() => {});
    clearFrontendExtractedText.mockImplementation(() => {});
    updateLastTranscriptIndex.mockImplementation(() => {});
    appendGroupMessage.mockImplementation(
      async (groupId: string, msg: Record<string, unknown>) => ({
        ...msg,
        groupId,
        serverSeq: 1,
      }),
    );
    writeToPty.mockReturnValue(true);
    isPtyRunning.mockReturnValue(true);
    killBridgePty.mockResolvedValue(undefined);
  });

  afterEach(() => {
    _test.resetBridgeAgentQueues();
  });

  it("waits for the previous trigger to finish before writing the next request to PTY", async () => {
    vi.useFakeTimers();
    try {
      let firstResolve!: (text: string | null) => void;
      let secondResolve!: (text: string | null) => void;

      waitForFrontendExtractedText
        .mockImplementationOnce(
          () =>
            new Promise<string | null>((resolve) => {
              firstResolve = resolve;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<string | null>((resolve) => {
              secondResolve = resolve;
            }),
        );

      const firstRun = triggerBridgeAgent(makeParams("first request"), {
        type: "custom",
        command: "cli",
      } as BridgeConfig);

      await vi.advanceTimersByTimeAsync(250);

      expect(writeToPty).toHaveBeenCalledTimes(3);
      expect(writeToPty).toHaveBeenNthCalledWith(
        2,
        "g1",
        "cli",
        expect.stringContaining("first request"),
      );

      const secondRun = triggerBridgeAgent(makeParams("second request"), {
        type: "custom",
        command: "cli",
      } as BridgeConfig);

      await vi.advanceTimersByTimeAsync(250);

      expect(writeToPty).toHaveBeenCalledTimes(3);

      firstResolve("first reply");
      await firstRun;
      await vi.advanceTimersByTimeAsync(250);

      expect(writeToPty).toHaveBeenCalledTimes(6);
      expect(writeToPty).toHaveBeenNthCalledWith(
        5,
        "g1",
        "cli",
        expect.stringContaining("second request"),
      );

      secondResolve("second reply");
      await secondRun;

      expect(waitForFrontendExtractedText).toHaveBeenCalledTimes(2);
      expect(appendGroupMessage).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
