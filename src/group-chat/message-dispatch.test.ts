import { describe, expect, it } from "vitest";
import { resolveDispatchTargets } from "./message-dispatch.js";
import type { GroupChatMessage, GroupSessionEntry } from "./types.js";

function makeMeta(overrides?: Partial<GroupSessionEntry>): GroupSessionEntry {
  return {
    groupId: "g1",
    messageMode: "unicast",
    members: [
      { agentId: "assistant-1", role: "assistant", joinedAt: 0 },
      { agentId: "member-1", role: "member", joinedAt: 0 },
      { agentId: "member-2", role: "member", joinedAt: 0 },
    ],
    memberRolePrompts: [],
    groupSkills: [],
    maxRounds: 20,
    maxConsecutive: 3,
    historyLimit: 50,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeMsg(overrides?: Partial<GroupChatMessage>): GroupChatMessage {
  return {
    id: "msg-1",
    groupId: "g1",
    role: "user",
    content: "hello",
    sender: { type: "owner" },
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("message-dispatch", () => {
  describe("unicast mode (no mentions)", () => {
    it("routes to assistant only", () => {
      const result = resolveDispatchTargets(makeMeta(), makeMsg());
      expect(result.mode).toBe("unicast");
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].agentId).toBe("assistant-1");
    });

    it("returns empty when sender is the assistant", () => {
      const result = resolveDispatchTargets(
        makeMeta(),
        makeMsg({ sender: { type: "agent", agentId: "assistant-1" } }),
      );
      expect(result.targets).toHaveLength(0);
    });
  });

  describe("broadcast mode (no mentions)", () => {
    it("routes to all members", () => {
      const meta = makeMeta({ messageMode: "broadcast" });
      const result = resolveDispatchTargets(meta, makeMsg());
      expect(result.mode).toBe("broadcast");
      expect(result.targets).toHaveLength(3);
    });

    it("excludes sender agent", () => {
      const meta = makeMeta({ messageMode: "broadcast" });
      const result = resolveDispatchTargets(
        meta,
        makeMsg({ sender: { type: "agent", agentId: "member-1" } }),
      );
      expect(result.targets).toHaveLength(2);
      expect(result.targets.every((t) => t.agentId !== "member-1")).toBe(true);
    });
  });

  describe("mention mode", () => {
    it("routes to mentioned agents only (unicast keeps unicast mode)", () => {
      const result = resolveDispatchTargets(
        makeMeta(),
        makeMsg({ mentions: ["member-1", "member-2"] }),
      );
      // In unicast mode, mentions keep mode="unicast" for serial triggering
      expect(result.mode).toBe("unicast");
      expect(result.targets).toHaveLength(2);
      expect(result.targets.map((t) => t.agentId)).toEqual(["member-1", "member-2"]);
    });

    it("preserves @mention order in targets", () => {
      const result = resolveDispatchTargets(
        makeMeta(),
        makeMsg({ mentions: ["member-2", "member-1"] }),
      );
      expect(result.targets.map((t) => t.agentId)).toEqual(["member-2", "member-1"]);
    });

    it("excludes sender from mentions", () => {
      const result = resolveDispatchTargets(
        makeMeta(),
        makeMsg({
          sender: { type: "agent", agentId: "member-1" },
          mentions: ["member-1", "member-2"],
        }),
      );
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].agentId).toBe("member-2");
    });

    it("falls back to message mode when all mentions are non-members", () => {
      // When all mentioned agents are filtered out, mentions array becomes empty,
      // so dispatch falls back to the message mode (unicast → assistant)
      const result = resolveDispatchTargets(makeMeta(), makeMsg({ mentions: ["unknown-agent"] }));
      expect(result.mode).toBe("unicast");
      expect(result.targets).toHaveLength(1);
      expect(result.targets[0].agentId).toBe("assistant-1");
    });

    it("broadcast mode with mentions uses mention mode (parallel)", () => {
      const meta = makeMeta({ messageMode: "broadcast" });
      const result = resolveDispatchTargets(meta, makeMsg({ mentions: ["member-1"] }));
      expect(result.mode).toBe("mention");
      expect(result.targets).toHaveLength(1);
    });

    it("broadcast mode with mentions preserves @mention order", () => {
      const meta = makeMeta({ messageMode: "broadcast" });
      const result = resolveDispatchTargets(meta, makeMsg({ mentions: ["member-2", "member-1"] }));
      expect(result.mode).toBe("mention");
      expect(result.targets.map((t) => t.agentId)).toEqual(["member-2", "member-1"]);
    });
  });
});
