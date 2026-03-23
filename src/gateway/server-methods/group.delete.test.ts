/**
 * group.delete — session key 清理逻辑测试
 *
 * 核心验证：
 * 1. 不同默认 agentId 下，session key 的正确匹配与删除
 * 2. 磁盘存储格式（group:前缀）和规范化格式（agent:前缀）都能被正确清理
 * 3. 多 agent store 文件场景下的分组删除
 * 4. 运行时资源（队列、浏览器标签、chain state 等）的清理
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock 所有外部依赖 ───

vi.mock("../../group-chat/bridge-pty.js", () => ({
  cleanupGroupBridgeAgents: vi.fn().mockResolvedValue(undefined),
  getGroupActivePtys: vi.fn().mockReturnValue([]),
  getPtyReplayBuffer: vi.fn().mockReturnValue(null),
  killBridgePty: vi.fn(),
  recordFrontendExtractedText: vi.fn(),
  resizePty: vi.fn(),
}));

vi.mock("../../group-chat/chain-state-store.js", () => ({
  initChainState: vi.fn(),
  atomicCheckAndIncrement: vi.fn(),
  getDefaultChainTimeout: vi.fn().mockReturnValue(30000),
  startChainMonitor: vi.fn(),
  setChainMonitor: vi.fn(),
  removeChainMonitor: vi.fn(),
  incrementPendingAgents: vi.fn(),
  decrementPendingAgents: vi.fn(),
  getPendingAgentCount: vi.fn().mockReturnValue(0),
  atomicAgentForwardCheck: vi.fn(),
  getChainState: vi.fn().mockReturnValue(null),
  clearChainState: vi.fn(),
}));

vi.mock("../../group-chat/group-session-key.js", () => ({
  buildGroupSessionKey: vi.fn((groupId: string, agentId?: string) =>
    agentId ? `group:${groupId}:${agentId}` : `group:${groupId}`,
  ),
}));

vi.mock("../../group-chat/parallel-stream.js", () => ({
  broadcastGroupMessage: vi.fn(),
  broadcastGroupSystem: vi.fn(),
  registerGroupAbort: vi.fn(),
  unregisterGroupAbort: vi.fn(),
  abortGroupRun: vi.fn(),
}));

vi.mock("../../group-chat/transcript.js", () => ({
  appendGroupMessage: vi.fn(),
  appendSystemMessage: vi.fn(),
  readGroupMessages: vi.fn().mockReturnValue([]),
  getTranscriptSnapshot: vi.fn().mockReturnValue(null),
  clearGroupMessages: vi.fn(),
}));

vi.mock("../../group-chat/agent-trigger.js", () => ({
  triggerAgentReasoning: vi.fn(),
}));

vi.mock("../../group-chat/message-dispatch.js", () => ({
  resolveDispatchTargets: vi.fn().mockReturnValue([]),
}));

vi.mock("../../commands/cli-agents.config.js", () => ({
  findCliAgentEntry: vi.fn().mockReturnValue(null),
}));

vi.mock("../../logging.js", () => ({
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ─── 核心模块 Mock ───

// 可变的 store 数据，测试中动态设置
let mockGroupMeta: ReturnType<typeof import("../../group-chat/group-store.js").loadGroupMeta> =
  null;
let _mockDeleteGroupCalled = false;

vi.mock("../../group-chat/group-store.js", () => ({
  createGroup: vi.fn(),
  deleteGroup: vi.fn(async () => {
    _mockDeleteGroupCalled = true;
  }),
  loadGroupIndex: vi.fn().mockReturnValue([]),
  loadGroupMeta: vi.fn(() => mockGroupMeta),
  updateGroupMeta: vi.fn(),
}));

// Session store 数据 — 按 storePath 存储不同的 store 内容
let mockSessionStores: Record<
  string,
  Record<string, { sessionId: string; updatedAt: number; sessionFile?: string; acp?: unknown }>
> = {};
let deletedKeysPerStore: Record<string, string[]> = {};

vi.mock("../../config/sessions/store.js", () => ({
  updateSessionStore: vi.fn(
    async (storePath: string, mutator: (store: Record<string, unknown>) => void) => {
      const store = mockSessionStores[storePath] ? { ...mockSessionStores[storePath] } : {};
      // 记录删除前的 keys
      const keysBefore = new Set(Object.keys(store));
      mutator(store);
      const keysAfter = new Set(Object.keys(store));
      // 记录被删除的 keys
      const deleted: string[] = [];
      for (const k of keysBefore) {
        if (!keysAfter.has(k)) {
          deleted.push(k);
        }
      }
      if (!deletedKeysPerStore[storePath]) {
        deletedKeysPerStore[storePath] = [];
      }
      deletedKeysPerStore[storePath].push(...deleted);
      // 同步更新 mockSessionStores
      mockSessionStores[storePath] = store as (typeof mockSessionStores)[string];
    },
  ),
}));

// Mock 配置 — 可在每个测试中改变 defaultAgentId
let mockDefaultAgentId = "main";
let mockAgentsList: Array<{ id: string; default?: boolean }> = [];

vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({
    agents: { list: mockAgentsList },
    session: { store: undefined },
  })),
}));

vi.mock("../../agents/agent-scope.js", () => ({
  resolveDefaultAgentId: vi.fn(() => mockDefaultAgentId),
  resolveAgentWorkspaceDir: vi.fn((agentId: string) => `/tmp/agents/${agentId}`),
}));

vi.mock("../../routing/session-key.js", () => ({
  normalizeAgentId: vi.fn((id: string) => id.trim().toLowerCase()),
  parseAgentSessionKey: vi.fn((key: string) => {
    const lower = key.toLowerCase();
    if (!lower.startsWith("agent:")) {
      return null;
    }
    const parts = lower.split(":");
    if (parts.length < 2) {
      return null;
    }
    return { agentId: parts[1], rest: parts.slice(2).join(":") };
  }),
  normalizeMainKey: vi.fn((k?: string) => k?.trim().toLowerCase() ?? "main"),
  isSubagentSessionKey: vi.fn(() => false),
}));

// Session store path 解析
let mockStorePathTemplate: ((agentId: string) => string) | undefined;

vi.mock("../../config/sessions.js", () => ({
  loadSessionStore: vi.fn((storePath: string) => {
    return mockSessionStores[storePath] ? { ...mockSessionStores[storePath] } : {};
  }),
  resolveStorePath: vi.fn((_storeConfig: unknown, opts?: { agentId?: string }) => {
    if (mockStorePathTemplate && opts?.agentId) {
      return mockStorePathTemplate(opts.agentId);
    }
    const agentId = opts?.agentId ?? mockDefaultAgentId;
    return `/tmp/agents/${agentId}/sessions/sessions.json`;
  }),
  resolveMainSessionKey: vi.fn(() => `agent:${mockDefaultAgentId}:main`),
  resolveAgentMainSessionKey: vi.fn(
    (params: { cfg: unknown; agentId: string }) => `agent:${params.agentId}:main`,
  ),
  resolveFreshSessionTotalTokens: vi.fn(),
  buildGroupDisplayName: vi.fn(),
  canonicalizeMainSessionAlias: vi.fn(
    (params: { cfg: unknown; agentId: string; sessionKey: string }) => params.sessionKey,
  ),
  snapshotSessionOrigin: vi.fn(),
  updateSessionStore: vi.fn(),
}));

// Mock session-utils.js 模块 — 关键的合并和解析函数
let mockCombinedStore: Record<
  string,
  { sessionId: string; updatedAt: number; sessionFile?: string; acp?: unknown }
> = {};
let archivedTranscripts: Array<{ sessionId: string; storePath: string; agentId?: string }> = [];

vi.mock("../session-utils.js", () => ({
  loadCombinedSessionStoreForGateway: vi.fn(() => ({
    storePath: "(multiple)",
    store: mockCombinedStore,
  })),
  resolveGatewaySessionStoreTarget: vi.fn((params: { cfg: unknown; key: string }) => {
    const key = params.key.trim().toLowerCase();
    // 从 canonical key 中提取 agentId（第一个 agentId）
    let agentId = mockDefaultAgentId;
    if (key.startsWith("agent:")) {
      const parts = key.split(":");
      agentId = parts[1] ?? mockDefaultAgentId;
    }
    const storePath = `/tmp/agents/${agentId}/sessions/sessions.json`;
    return {
      agentId,
      storePath,
      canonicalKey: key,
      storeKeys: [key],
    };
  }),
  archiveSessionTranscripts: vi.fn(
    (opts: { sessionId: string; storePath: string; agentId?: string }) => {
      archivedTranscripts.push(opts);
      return [];
    },
  ),
}));

// Mock 运行时清理相关模块
const mockClearSessionQueues = vi.fn();
vi.mock("../../auto-reply/reply/queue.js", () => ({
  clearSessionQueues: mockClearSessionQueues,
}));

const mockStopSubagents = vi.fn();
vi.mock("../../auto-reply/reply/abort.js", () => ({
  stopSubagentsForRequester: mockStopSubagents,
}));

const mockAbortPiRun = vi.fn();
vi.mock("../../agents/pi-embedded.js", () => ({
  abortEmbeddedPiRun: mockAbortPiRun,
  waitForEmbeddedPiRunEnd: vi.fn().mockResolvedValue(true),
}));

const mockClearBootstrap = vi.fn();
vi.mock("../../agents/bootstrap-cache.js", () => ({
  clearBootstrapSnapshot: mockClearBootstrap,
}));

const mockCloseBrowserTabs = vi.fn().mockResolvedValue([]);
vi.mock("../../browser/session-tab-registry.js", () => ({
  closeTrackedBrowserTabsForSessions: mockCloseBrowserTabs,
}));

const mockUnbindThreadBindings = vi.fn();
vi.mock("../../discord/monitor/thread-bindings.js", () => ({
  unbindThreadBindingsBySessionKey: mockUnbindThreadBindings,
}));

const mockAcpCancelSession = vi.fn().mockResolvedValue(undefined);
const mockAcpCloseSession = vi.fn().mockResolvedValue(undefined);
vi.mock("../../acp/control-plane/manager.js", () => ({
  getAcpSessionManager: vi.fn(() => ({
    cancelSession: mockAcpCancelSession,
    closeSession: mockAcpCloseSession,
  })),
}));

// ─── 导入被测模块 ───

// 由于 group.ts 导出的是 handlers 对象而非 handleGroupDelete，
// 我们需要提取出 group.delete handler
import { cleanupGroupBridgeAgents } from "../../group-chat/bridge-pty.js";
import { clearChainState } from "../../group-chat/chain-state-store.js";
import { broadcastGroupSystem } from "../../group-chat/parallel-stream.js";
import { groupHandlers } from "./group.js";

// ─── 辅助函数 ───

function createMockHandlerArgs(params: Record<string, unknown>) {
  const respond = vi.fn();
  const broadcast = vi.fn();
  return {
    args: {
      params,
      respond,
      context: { broadcast },
      client: {} as unknown,
      isWebchatConnect: false,
    },
    respond,
    broadcast,
  };
}

function storePathForAgent(agentId: string) {
  return `/tmp/agents/${agentId}/sessions/sessions.json`;
}

// ─── 测试 ───

describe("group.delete — session key 清理", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGroupMeta = null;
    _mockDeleteGroupCalled = false;
    mockSessionStores = {};
    deletedKeysPerStore = {};
    mockCombinedStore = {};
    archivedTranscripts = [];
    mockDefaultAgentId = "main";
    mockAgentsList = [{ id: "main", default: true }];
    mockStorePathTemplate = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("默认 agent 为 main 时，正确删除群聊 session keys", async () => {
    const groupId = "aaa-bbb-ccc";
    mockDefaultAgentId = "main";
    mockAgentsList = [{ id: "main", default: true }];

    // 模拟 combined store 中的规范化 session keys
    mockCombinedStore = {
      [`agent:main:group:${groupId}:main`]: {
        sessionId: "session-1",
        updatedAt: Date.now(),
        sessionFile: "session-1.jsonl",
      },
      [`agent:main:group:${groupId}:test_2`]: {
        sessionId: "session-2",
        updatedAt: Date.now(),
        sessionFile: "session-2.jsonl",
      },
      // 不相关的 key，不应被删除
      "agent:main:main": {
        sessionId: "session-dm",
        updatedAt: Date.now(),
      },
    };

    // 模拟磁盘上的 store 文件（main agent 的 sessions.json）
    const mainStorePath = storePathForAgent("main");
    mockSessionStores[mainStorePath] = {
      [`group:${groupId}:main`]: {
        sessionId: "session-1",
        updatedAt: Date.now(),
        sessionFile: "session-1.jsonl",
      },
      [`group:${groupId}:test_2`]: {
        sessionId: "session-2",
        updatedAt: Date.now(),
        sessionFile: "session-2.jsonl",
      },
      "agent:main:main": {
        sessionId: "session-dm",
        updatedAt: Date.now(),
      },
    };

    const handler = groupHandlers["group.delete"];
    const { args, respond } = createMockHandlerArgs({ groupId });
    await handler(args as Parameters<typeof handler>[0]);

    // 验证响应成功
    expect(respond).toHaveBeenCalledWith(true, { ok: true });

    // 验证 chain state 被清理
    expect(clearChainState).toHaveBeenCalledWith(groupId);

    // 验证磁盘上的 group:前缀 key 被删除
    const remainingKeys = Object.keys(mockSessionStores[mainStorePath] ?? {});
    expect(remainingKeys).not.toContain(`group:${groupId}:main`);
    expect(remainingKeys).not.toContain(`group:${groupId}:test_2`);
    // 不相关的 key 应保留
    expect(remainingKeys).toContain("agent:main:main");

    // 验证 transcripts 被归档
    expect(archivedTranscripts).toHaveLength(2);
    expect(archivedTranscripts.map((t) => t.sessionId).toSorted()).toEqual(
      ["session-1", "session-2"].toSorted(),
    );
  });

  it("默认 agent 为 test_3 时，正确删除群聊 session keys", async () => {
    const groupId = "ddd-eee-fff";
    mockDefaultAgentId = "test_3";
    mockAgentsList = [{ id: "test_3", default: true }, { id: "main" }];

    // 当默认 agent 为 test_3 时，session keys 会存储在 test_3 的 store 文件中
    mockCombinedStore = {
      [`agent:test_3:group:${groupId}:main`]: {
        sessionId: "session-a",
        updatedAt: Date.now(),
        sessionFile: "session-a.jsonl",
      },
      [`agent:test_3:group:${groupId}:test_2`]: {
        sessionId: "session-b",
        updatedAt: Date.now(),
        sessionFile: "session-b.jsonl",
      },
    };

    // test_3 的磁盘 store
    const test3StorePath = storePathForAgent("test_3");
    mockSessionStores[test3StorePath] = {
      [`group:${groupId}:main`]: {
        sessionId: "session-a",
        updatedAt: Date.now(),
        sessionFile: "session-a.jsonl",
      },
      [`group:${groupId}:test_2`]: {
        sessionId: "session-b",
        updatedAt: Date.now(),
        sessionFile: "session-b.jsonl",
      },
    };

    const handler = groupHandlers["group.delete"];
    const { args, respond } = createMockHandlerArgs({ groupId });
    await handler(args as Parameters<typeof handler>[0]);

    expect(respond).toHaveBeenCalledWith(true, { ok: true });

    // 验证 test_3 store 中的 keys 被删除
    const remainingKeys = Object.keys(mockSessionStores[test3StorePath] ?? {});
    expect(remainingKeys).not.toContain(`group:${groupId}:main`);
    expect(remainingKeys).not.toContain(`group:${groupId}:test_2`);
    expect(remainingKeys).toHaveLength(0);
  });

  it("多个默认 agent 场景：不同群聊产生在不同默认 agent 下时，正确分组删除", async () => {
    const groupId = "ggg-hhh-iii";
    mockDefaultAgentId = "main";
    mockAgentsList = [{ id: "main", default: true }, { id: "test_3" }];

    // 假设同一个群聊的 session keys 跨越了两个 agent 的 store（虽然实际中不太常见，
    // 但在默认 agent 配置变更时可能出现）
    mockCombinedStore = {
      [`agent:main:group:${groupId}:main`]: {
        sessionId: "session-x",
        updatedAt: Date.now(),
        sessionFile: "session-x.jsonl",
      },
      [`agent:test_3:group:${groupId}:test_2`]: {
        sessionId: "session-y",
        updatedAt: Date.now(),
        sessionFile: "session-y.jsonl",
      },
    };

    const mainStorePath = storePathForAgent("main");
    const test3StorePath = storePathForAgent("test_3");

    mockSessionStores[mainStorePath] = {
      [`group:${groupId}:main`]: {
        sessionId: "session-x",
        updatedAt: Date.now(),
        sessionFile: "session-x.jsonl",
      },
      "agent:main:main": {
        sessionId: "session-dm",
        updatedAt: Date.now(),
      },
    };
    mockSessionStores[test3StorePath] = {
      [`group:${groupId}:test_2`]: {
        sessionId: "session-y",
        updatedAt: Date.now(),
        sessionFile: "session-y.jsonl",
      },
    };

    const handler = groupHandlers["group.delete"];
    const { args, respond } = createMockHandlerArgs({ groupId });
    await handler(args as Parameters<typeof handler>[0]);

    expect(respond).toHaveBeenCalledWith(true, { ok: true });

    // main store 中群聊 key 被删除，DM key 保留
    const mainRemaining = Object.keys(mockSessionStores[mainStorePath] ?? {});
    expect(mainRemaining).not.toContain(`group:${groupId}:main`);
    expect(mainRemaining).toContain("agent:main:main");

    // test_3 store 中群聊 key 被删除
    const test3Remaining = Object.keys(mockSessionStores[test3StorePath] ?? {});
    expect(test3Remaining).not.toContain(`group:${groupId}:test_2`);
    expect(test3Remaining).toHaveLength(0);
  });

  it("当 combined store 中没有匹配 key 时，使用 groupMeta 成员列表构建 keys", async () => {
    const groupId = "jjj-kkk-lll";
    mockDefaultAgentId = "main";
    mockAgentsList = [{ id: "main", default: true }];

    // combined store 中没有匹配的 keys
    mockCombinedStore = {};

    // 但 groupMeta 中有成员信息
    mockGroupMeta = {
      groupId,
      name: "Test Group",
      members: [
        { agentId: "main", role: "assistant" },
        { agentId: "test_2", role: "member" },
      ],
      createdAt: Date.now(),
    } as ReturnType<typeof import("../../group-chat/group-store.js").loadGroupMeta>;

    // 磁盘上有对应的 raw keys
    const mainStorePath = storePathForAgent("main");
    mockSessionStores[mainStorePath] = {
      [`group:${groupId}:main`]: {
        sessionId: "session-fallback-1",
        updatedAt: Date.now(),
      },
      [`group:${groupId}:test_2`]: {
        sessionId: "session-fallback-2",
        updatedAt: Date.now(),
      },
    };

    const handler = groupHandlers["group.delete"];
    const { args, respond } = createMockHandlerArgs({ groupId });
    await handler(args as Parameters<typeof handler>[0]);

    expect(respond).toHaveBeenCalledWith(true, { ok: true });

    // 验证通过 groupMeta 构建的 keys 也能删除磁盘上的 raw keys
    const remainingKeys = Object.keys(mockSessionStores[mainStorePath] ?? {});
    expect(remainingKeys).not.toContain(`group:${groupId}:main`);
    expect(remainingKeys).not.toContain(`group:${groupId}:test_2`);
  });

  it("groupMeta fallback 使用 test_3 作为默认 agent 时正确构建 keys", async () => {
    const groupId = "mmm-nnn-ooo";
    mockDefaultAgentId = "test_3";
    mockAgentsList = [{ id: "test_3", default: true }];

    mockCombinedStore = {};
    mockGroupMeta = {
      groupId,
      name: "Test Group 2",
      members: [
        { agentId: "agent_a", role: "assistant" },
        { agentId: "agent_b", role: "member" },
      ],
      createdAt: Date.now(),
    } as ReturnType<typeof import("../../group-chat/group-store.js").loadGroupMeta>;

    const test3StorePath = storePathForAgent("test_3");
    mockSessionStores[test3StorePath] = {
      [`group:${groupId}:agent_a`]: {
        sessionId: "session-fb-a",
        updatedAt: Date.now(),
      },
      [`group:${groupId}:agent_b`]: {
        sessionId: "session-fb-b",
        updatedAt: Date.now(),
      },
    };

    const handler = groupHandlers["group.delete"];
    const { args, respond } = createMockHandlerArgs({ groupId });
    await handler(args as Parameters<typeof handler>[0]);

    expect(respond).toHaveBeenCalledWith(true, { ok: true });

    // 验证：fallback 时使用 test_3（当前默认 agent）构建 keys
    const remainingKeys = Object.keys(mockSessionStores[test3StorePath] ?? {});
    expect(remainingKeys).not.toContain(`group:${groupId}:agent_a`);
    expect(remainingKeys).not.toContain(`group:${groupId}:agent_b`);
  });

  it("缺少 groupId 时返回错误", async () => {
    const handler = groupHandlers["group.delete"];
    const { args, respond } = createMockHandlerArgs({});
    await handler(args as Parameters<typeof handler>[0]);

    expect(respond).toHaveBeenCalledWith(false, undefined, {
      message: "groupId is required",
      code: 400,
    });
  });

  it("不会误删其他群聊的 session keys", async () => {
    const groupId = "target-group-id";
    const otherGroupId = "other-group-id";
    mockDefaultAgentId = "main";

    mockCombinedStore = {
      [`agent:main:group:${groupId}:main`]: {
        sessionId: "s-target",
        updatedAt: Date.now(),
      },
      [`agent:main:group:${otherGroupId}:main`]: {
        sessionId: "s-other",
        updatedAt: Date.now(),
      },
    };

    const mainStorePath = storePathForAgent("main");
    mockSessionStores[mainStorePath] = {
      [`group:${groupId}:main`]: {
        sessionId: "s-target",
        updatedAt: Date.now(),
      },
      [`group:${otherGroupId}:main`]: {
        sessionId: "s-other",
        updatedAt: Date.now(),
      },
    };

    const handler = groupHandlers["group.delete"];
    const { args, respond } = createMockHandlerArgs({ groupId });
    await handler(args as Parameters<typeof handler>[0]);

    expect(respond).toHaveBeenCalledWith(true, { ok: true });

    // 目标群聊的 key 被删除
    const remainingKeys = Object.keys(mockSessionStores[mainStorePath] ?? {});
    expect(remainingKeys).not.toContain(`group:${groupId}:main`);
    // 其他群聊的 key 保留
    expect(remainingKeys).toContain(`group:${otherGroupId}:main`);
  });

  describe("运行时清理", () => {
    it("删除群聊时清理 chain state", async () => {
      const groupId = "runtime-cleanup-1";
      mockDefaultAgentId = "main";
      mockCombinedStore = {};

      const handler = groupHandlers["group.delete"];
      const { args } = createMockHandlerArgs({ groupId });
      await handler(args as Parameters<typeof handler>[0]);

      expect(clearChainState).toHaveBeenCalledWith(groupId);
    });

    it("删除群聊时清理 Bridge Agent PTY 进程", async () => {
      const groupId = "runtime-cleanup-2";
      mockDefaultAgentId = "main";
      mockCombinedStore = {};

      const handler = groupHandlers["group.delete"];
      const { args, broadcast } = createMockHandlerArgs({ groupId });
      await handler(args as Parameters<typeof handler>[0]);

      expect(cleanupGroupBridgeAgents).toHaveBeenCalledWith(groupId, broadcast);
    });

    it("删除群聊时清理消息队列和子 agents", async () => {
      const groupId = "runtime-cleanup-3";
      mockDefaultAgentId = "main";

      mockCombinedStore = {
        [`agent:main:group:${groupId}:main`]: {
          sessionId: "s-rt",
          updatedAt: Date.now(),
        },
      };

      const mainStorePath = storePathForAgent("main");
      mockSessionStores[mainStorePath] = {
        [`group:${groupId}:main`]: {
          sessionId: "s-rt",
          updatedAt: Date.now(),
        },
      };

      const handler = groupHandlers["group.delete"];
      const { args } = createMockHandlerArgs({ groupId });
      await handler(args as Parameters<typeof handler>[0]);

      // 验证消息队列清理被调用
      expect(mockClearSessionQueues).toHaveBeenCalled();
      // 验证子 agents 停止被调用
      expect(mockStopSubagents).toHaveBeenCalled();
      // 验证 bootstrap 快照清理被调用
      expect(mockClearBootstrap).toHaveBeenCalled();
    });

    it("删除群聊时广播 deleted 事件", async () => {
      const groupId = "broadcast-test";
      mockDefaultAgentId = "main";
      mockCombinedStore = {};

      const handler = groupHandlers["group.delete"];
      const { args, broadcast } = createMockHandlerArgs({ groupId });
      await handler(args as Parameters<typeof handler>[0]);

      expect(broadcastGroupSystem).toHaveBeenCalledWith(broadcast, groupId, "deleted", {});
    });

    it("删除群聊时处理 ACP runtime", async () => {
      const groupId = "acp-cleanup";
      mockDefaultAgentId = "main";

      // 包含 ACP session 的 entry
      mockCombinedStore = {
        [`agent:main:group:${groupId}:main`]: {
          sessionId: "s-acp",
          updatedAt: Date.now(),
          acp: { some: "data" },
        },
      };

      const mainStorePath = storePathForAgent("main");
      mockSessionStores[mainStorePath] = {
        [`group:${groupId}:main`]: {
          sessionId: "s-acp",
          updatedAt: Date.now(),
          acp: { some: "data" },
        },
      };

      const handler = groupHandlers["group.delete"];
      const { args } = createMockHandlerArgs({ groupId });
      await handler(args as Parameters<typeof handler>[0]);

      // 验证 ACP cancel 和 close 被调用
      expect(mockAcpCancelSession).toHaveBeenCalled();
      expect(mockAcpCloseSession).toHaveBeenCalled();
    });

    it("删除群聊时解绑 thread bindings", async () => {
      const groupId = "thread-unbind";
      mockDefaultAgentId = "main";

      mockCombinedStore = {
        [`agent:main:group:${groupId}:main`]: {
          sessionId: "s-thread",
          updatedAt: Date.now(),
        },
      };

      const mainStorePath = storePathForAgent("main");
      mockSessionStores[mainStorePath] = {
        [`group:${groupId}:main`]: {
          sessionId: "s-thread",
          updatedAt: Date.now(),
        },
      };

      const handler = groupHandlers["group.delete"];
      const { args } = createMockHandlerArgs({ groupId });
      await handler(args as Parameters<typeof handler>[0]);

      expect(mockUnbindThreadBindings).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "session-delete",
          sendFarewell: true,
        }),
      );
    });
  });
});
