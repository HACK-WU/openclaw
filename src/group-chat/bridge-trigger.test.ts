import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TriggerAgentParams } from "./agent-trigger.js";
import type { BridgeConfig, BridgePtyState } from "./bridge-types.js";
import type { GroupSessionEntry } from "./types.js";

const waitForFrontendExtractedText = vi.fn();
const isPtyRunning = vi.fn();
const createBridgePty = vi.fn();
const writeToPty = vi.fn();
const writeToPtyWithEnter = vi.fn();
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
  writeToPtyWithEnter,
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

vi.mock("./bridge-memory.js", () => ({
  sanitizeGroupDirName: vi.fn((name: string) => name),
  resolveProjectMemoryPaths: vi.fn(() => ({
    dir: "/tmp/test/.openclaw/test",
    projectLevelMemoryFile: "/tmp/test/.openclaw/MEMORY.md",
    sharedMemoryFile: "/tmp/test/.openclaw/test/MEMORY.md",
    sharedSessionFile: "/tmp/test/.openclaw/test/SESSION.md",
    agentMemoryFile: "/tmp/test/.openclaw/test/cli.md",
  })),
  resolveTempMemoryPaths: vi.fn(() => ({
    dir: "/tmp/test/group-memory/g1",
    agentMemoryFile: "/tmp/test/group-memory/g1/cli.md",
  })),
  ensureProjectMemoryFiles: vi.fn().mockResolvedValue(undefined),
  ensureTempMemoryFiles: vi.fn().mockResolvedValue(undefined),
  shouldInjectAnnouncement: vi.fn(() => true),
  shouldInjectMemoryContent: vi.fn(() => false),
  shouldInjectMemoryPrompt: vi.fn(() => false),
  buildMemoryPathSection: vi.fn(() => []),
  buildMemoryContentSection: vi.fn().mockResolvedValue([]),
  buildMemoryManagementPrompt: vi.fn(() => []),
  buildTempMemoryPathSection: vi.fn(() => []),
  buildTempMemoryContentSection: vi.fn().mockResolvedValue([]),
  buildTempMemoryManagementPrompt: vi.fn(() => []),
  DEFAULT_MEMORY_CONTENT_INTERVAL: 6,
  DEFAULT_MEMORY_PROMPT_INTERVAL: 5,
}));

vi.mock("../config/paths.js", () => ({
  resolveStateDir: vi.fn(() => "/tmp/test-state"),
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
    project: { directory: "/tmp/test-project" },
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

function makeParams(
  content: string,
  signal: AbortSignal = new AbortController().signal,
): TriggerAgentParams {
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
    signal,
  };
}

describe("buildCliContextMessage — always-injected sections", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
    writeToPtyWithEnter.mockResolvedValue(true);
    // PTY already running → subsequent (non-first) interaction
    isPtyRunning.mockReturnValue(true);
    killBridgePty.mockResolvedValue(undefined);
  });

  afterEach(() => {
    _test.resetBridgeAgentQueues();
  });

  it("includes member list with Owner in subsequent interactions", async () => {
    vi.useFakeTimers();
    try {
      let resolveExtract!: (text: string | null) => void;
      waitForFrontendExtractedText.mockImplementationOnce(
        () =>
          new Promise<string | null>((resolve) => {
            resolveExtract = resolve;
          }),
      );

      const params = makeParams("hello");
      // Add a second member so we can verify it appears
      params.meta.members.push({
        agentId: "bob",
        role: "member",
        joinedAt: 2,
      });

      const run = triggerBridgeAgent(params, {
        type: "custom",
        command: "cli",
      } as BridgeConfig);

      await vi.advanceTimersByTimeAsync(1_000);

      // writeToPty is called with the hidden context
      expect(writeToPty).toHaveBeenCalledTimes(1);
      const contextWritten = writeToPty.mock.calls[0][2] as string;
      expect(contextWritten).toContain("Owner（群主/用户）");
      expect(contextWritten).toContain("cli（你）");
      expect(contextWritten).toContain("bob（成员）");

      resolveExtract("reply");
      await run;
    } finally {
      vi.useRealTimers();
    }
  });

  it("includes announcement in subsequent interactions", async () => {
    vi.useFakeTimers();
    try {
      let resolveExtract!: (text: string | null) => void;
      waitForFrontendExtractedText.mockImplementationOnce(
        () =>
          new Promise<string | null>((resolve) => {
            resolveExtract = resolve;
          }),
      );

      const params = makeParams("hello");
      params.meta.announcement = "测试公告";

      const run = triggerBridgeAgent(params, {
        type: "custom",
        command: "cli",
      } as BridgeConfig);

      await vi.advanceTimersByTimeAsync(1_000);

      expect(writeToPty).toHaveBeenCalledTimes(1);
      const contextWritten = writeToPty.mock.calls[0][2] as string;
      expect(contextWritten).toContain("# 群公告：测试公告");

      resolveExtract("reply");
      await run;
    } finally {
      vi.useRealTimers();
    }
  });

  it("includes constraint block in subsequent interactions", async () => {
    vi.useFakeTimers();
    try {
      let resolveExtract!: (text: string | null) => void;
      waitForFrontendExtractedText.mockImplementationOnce(
        () =>
          new Promise<string | null>((resolve) => {
            resolveExtract = resolve;
          }),
      );

      const run = triggerBridgeAgent(makeParams("hello"), {
        type: "custom",
        command: "cli",
      } as BridgeConfig);

      await vi.advanceTimersByTimeAsync(1_000);

      expect(writeToPty).toHaveBeenCalledTimes(1);
      const contextWritten = writeToPty.mock.calls[0][2] as string;
      expect(contextWritten).toContain("# 重要约束：");
      expect(contextWritten).toContain("Bridge Agent（CLI）");
      expect(contextWritten).toContain("被 @提及 时必须回复");
      expect(contextWritten).toContain("绝不输出敏感信息");

      resolveExtract("reply");
      await run;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("bridge-trigger queueing", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
    writeToPtyWithEnter.mockResolvedValue(true);
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

      await vi.advanceTimersByTimeAsync(1_000);

      // writeToPty called once (hidden context), writeToPtyWithEnter once (visible request)
      expect(writeToPty).toHaveBeenCalledTimes(1);
      expect(writeToPtyWithEnter).toHaveBeenCalledTimes(1);
      expect(writeToPtyWithEnter).toHaveBeenNthCalledWith(
        1,
        "g1",
        "cli",
        expect.stringContaining("first request"),
      );

      const secondRun = triggerBridgeAgent(makeParams("second request"), {
        type: "custom",
        command: "cli",
      } as BridgeConfig);

      await vi.advanceTimersByTimeAsync(1_000);

      // Still only 1 call each — second trigger is queued
      expect(writeToPty).toHaveBeenCalledTimes(1);
      expect(writeToPtyWithEnter).toHaveBeenCalledTimes(1);

      firstResolve("first reply");
      await firstRun;
      await vi.advanceTimersByTimeAsync(1_000);

      // Now second trigger has run: 2 calls each
      expect(writeToPty).toHaveBeenCalledTimes(2);
      expect(writeToPtyWithEnter).toHaveBeenCalledTimes(2);
      expect(writeToPtyWithEnter).toHaveBeenNthCalledWith(
        2,
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

describe("bridge-trigger abort handling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
    writeToPtyWithEnter.mockResolvedValue(true);
    isPtyRunning.mockReturnValue(true);
    killBridgePty.mockResolvedValue(undefined);
  });

  afterEach(() => {
    _test.resetBridgeAgentQueues();
  });

  it("handles signals that are already aborted before waitForCompletion finishes wiring listeners", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      clearFrontendExtractedText.mockImplementationOnce(() => {
        controller.abort();
      });

      const run = triggerBridgeAgent(
        makeParams("abort before completion wait", controller.signal),
        {
          type: "custom",
          command: "cli",
        } as BridgeConfig,
      );

      await vi.advanceTimersByTimeAsync(1_000);
      await run;

      expect(killBridgePty).toHaveBeenCalledTimes(1);
      expect(killBridgePty).toHaveBeenCalledWith("g1", "cli", "user_abort");
      expect(appendGroupMessage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps later triggers queued until abort PTY cleanup fully finishes", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      let resolveKill!: () => void;
      let firstSettled = false;

      clearFrontendExtractedText.mockImplementationOnce(() => {
        controller.abort();
      });
      waitForFrontendExtractedText.mockResolvedValueOnce("second reply");
      killBridgePty.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveKill = resolve;
          }),
      );

      const firstRun = triggerBridgeAgent(makeParams("first request", controller.signal), {
        type: "custom",
        command: "cli",
      } as BridgeConfig);
      void firstRun.then(() => {
        firstSettled = true;
      });

      await vi.advanceTimersByTimeAsync(1_000);

      expect(killBridgePty).toHaveBeenCalledTimes(1);
      expect(firstSettled).toBe(false);

      const secondRun = triggerBridgeAgent(makeParams("second request"), {
        type: "custom",
        command: "cli",
      } as BridgeConfig);

      await vi.advanceTimersByTimeAsync(1_000);

      expect(firstSettled).toBe(false);
      expect(writeToPtyWithEnter).toHaveBeenCalledTimes(1);

      resolveKill();
      await firstRun;
      await vi.advanceTimersByTimeAsync(1_000);
      await secondRun;

      expect(writeToPtyWithEnter).toHaveBeenCalledTimes(2);
      expect(writeToPtyWithEnter).toHaveBeenNthCalledWith(
        2,
        "g1",
        "cli",
        expect.stringContaining("second request"),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("summarizeOwnReply", () => {
  const { summarizeOwnReply, extractFirstSentence, extractLastTwoSentences } = _test;

  it("returns full content when length <= 200 chars", () => {
    const shortContent = "这是一段短文本，不需要摘要处理。";
    expect(summarizeOwnReply(shortContent)).toBe(shortContent);
  });

  it("summarizes long Chinese content with sentence separators", () => {
    const longContent =
      "收到，我来分析一下当前的路由结构。首先查看现有代码，发现路由层存在以下问题：缺少统一错误处理、中间件顺序不合理、缺少请求日志记录、缺少请求验证、缺少性能监控。我会重构路由层，添加统一的错误处理中间件，调整中间件顺序，添加请求日志记录功能，添加请求验证中间件，添加性能监控中间件。好的，开始重构路由层，预计需要修改5个文件，这是一个比较复杂的重构任务，需要仔细处理每个中间件的依赖关系，确保不会破坏现有的功能。";

    const result = summarizeOwnReply(longContent);

    // Should contain first sentence
    expect(result).toContain("收到，我来分析一下当前的路由结构。");
    // Should contain omission marker
    expect(result).toContain("[已省略");
    // Should contain last sentences
    expect(result).toContain("确保不会破坏现有的功能。");
    // Should not contain middle content
    expect(result).not.toContain("缺少统一错误处理");
  });

  it("summarizes long English content with sentence separators", () => {
    const longContent =
      "I will analyze the current routing structure. First, I check the existing code and find several issues: missing unified error handling, middleware order is unreasonable, missing request logging. I will refactor the routing layer, add unified error handling middleware, adjust middleware order, and add request logging. Okay, starting the refactoring, expecting to modify 5 files.";

    const result = summarizeOwnReply(longContent);

    // Should contain first sentence
    expect(result).toContain("I will analyze the current routing structure.");
    // Should contain omission marker
    expect(result).toContain("[已省略");
    // Should contain last sentences
    expect(result).toContain("Okay, starting the refactoring");
  });

  it("handles content with newline separators", () => {
    const longContent =
      "收到，开始分析。\n首先查看代码结构。\n发现几个问题。\n需要重构路由层。\n添加错误处理。\n好的，开始实现。\n这是第七行内容。\n这是第八行内容。\n这是第九行内容。\n这是第十行内容。\n这是第十一行内容。\n这是第十二行内容。\n这是第十三行内容。\n这是第十四行内容。\n这是第十五行内容。\n这是第十六行内容。\n这是第十七行内容。\n这是第十八行内容。\n这是第十九行内容。\n这是第二十行内容。\n这是第二十一行内容。\n这是第二十二行内容。\n这是第二十三行内容。\n这是第二十四行内容。\n这是第二十五行内容。\n这是最后一行内容。";

    const result = summarizeOwnReply(longContent);

    expect(result).toContain("收到，开始分析。");
    expect(result).toContain("[已省略");
    expect(result).toContain("这是最后一行内容。");
  });

  it("extracts first sentence correctly for Chinese", () => {
    const content = "这是第一句话。这是第二句话。这是第三句话。";
    const result = extractFirstSentence(content, 50);
    expect(result).toBe("这是第一句话。");
  });

  it("extracts first sentence correctly for English", () => {
    const content =
      "This is the first sentence. This is the second sentence. This is the third sentence.";
    const result = extractFirstSentence(content, 50);
    expect(result).toBe("This is the first sentence. ");
  });

  it("extracts first sentence with max length limit", () => {
    const content = "这是一段很长很长很长很长很长很长很长很长的文本没有句号分隔";
    const result = extractFirstSentence(content, 20);
    expect(result.length).toBe(20);
    expect(result).toBe(content.slice(0, 20));
  });

  it("extracts last two sentences correctly for Chinese", () => {
    const content = "这是第一句话。这是第二句话。这是第三句话。这是第四句话。";
    const result = extractLastTwoSentences(content, 100);
    expect(result).toBe("这是第三句话。这是第四句话。");
  });

  it("extracts last two sentences correctly for English", () => {
    const content =
      "This is the first sentence. This is the second sentence. This is the third sentence. This is the fourth sentence.";
    const result = extractLastTwoSentences(content, 100);
    expect(result).toBe("This is the third sentence. This is the fourth sentence.");
  });

  it("extracts last two sentences with max length limit", () => {
    const content =
      "这是第一句话。这是第二句话。这是第三句话。这是第四句话这是第五句话这是第六句话这是第七句话这是第八句话";
    const result = extractLastTwoSentences(content, 20);
    expect(result.length).toBeLessThanOrEqual(20);
  });

  it("handles content without sentence separators", () => {
    const longContent =
      "这是一段很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长的文本";
    const result = summarizeOwnReply(longContent);

    // Should still create summary with head and tail
    expect(result).toContain("[已省略");
    expect(result.length).toBeLessThan(longContent.length);
  });

  it("handles mixed Chinese and English content", () => {
    const longContent =
      "收到，开始分析。First, I check the code structure. 发现几个问题。I will refactor the routing layer. 好的，开始实现。This is line seven. 这是第八行。This is line nine. 这是第十行。This is line eleven. 这是第十二行。This is line thirteen. 这是第十四行。This is line fifteen. 这是第十六行。This is line seventeen. 这是第十八行。This is line nineteen. 这是最后一行。";

    const result = summarizeOwnReply(longContent);

    expect(result).toContain("收到，开始分析。");
    expect(result).toContain("[已省略");
    expect(result).toContain("这是最后一行。");
  });
});
