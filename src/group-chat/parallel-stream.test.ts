import { describe, expect, it, vi } from "vitest";
import {
  abortGroupRun,
  broadcastGroupMessage,
  broadcastGroupStream,
  broadcastGroupSystem,
  registerGroupAbort,
  unregisterGroupAbort,
} from "./parallel-stream.js";
import type { GroupChatMessage, GroupStreamPayload } from "./types.js";

describe("parallel-stream", () => {
  describe("broadcastGroupStream", () => {
    it("broadcasts a group.stream event", () => {
      const broadcast = vi.fn();
      const payload: GroupStreamPayload = {
        groupId: "g1",
        runId: "r1",
        agentId: "a1",
        agentName: "Agent 1",
        state: "delta",
        content: "hello",
      };
      broadcastGroupStream(broadcast, payload);
      expect(broadcast).toHaveBeenCalledWith("group.stream", payload);
    });
  });

  describe("broadcastGroupMessage", () => {
    it("broadcasts a group.message event", () => {
      const broadcast = vi.fn();
      const msg = {
        id: "m1",
        groupId: "g1",
        role: "assistant" as const,
        content: "response",
        sender: { type: "agent" as const, agentId: "a1" },
        timestamp: Date.now(),
      };
      broadcastGroupMessage(broadcast, "g1", msg as GroupChatMessage);
      expect(broadcast).toHaveBeenCalledWith("group.message", { groupId: "g1", message: msg });
    });
  });

  describe("broadcastGroupSystem", () => {
    it("broadcasts a group.system event", () => {
      const broadcast = vi.fn();
      broadcastGroupSystem(broadcast, "g1", "round_limit", { count: 10 });
      expect(broadcast).toHaveBeenCalledWith("group.system", {
        groupId: "g1",
        event: "round_limit",
        data: { count: 10 },
      });
    });
  });

  describe("abort management", () => {
    it("registers and triggers an abort controller", () => {
      const controller = new AbortController();
      registerGroupAbort("g1", "run-1", controller);
      expect(controller.signal.aborted).toBe(false);
      abortGroupRun("g1", "run-1");
      expect(controller.signal.aborted).toBe(true);
    });

    it("aborts all runs for a group when no runId", () => {
      const ctrl1 = new AbortController();
      const ctrl2 = new AbortController();
      registerGroupAbort("g2", "run-1", ctrl1);
      registerGroupAbort("g2", "run-2", ctrl2);
      abortGroupRun("g2");
      expect(ctrl1.signal.aborted).toBe(true);
      expect(ctrl2.signal.aborted).toBe(true);
    });

    it("unregisters an abort controller", () => {
      const controller = new AbortController();
      registerGroupAbort("g3", "run-1", controller);
      unregisterGroupAbort("g3", "run-1");
      abortGroupRun("g3", "run-1");
      expect(controller.signal.aborted).toBe(false);
    });

    it("handles abort for unknown group gracefully", () => {
      expect(() => abortGroupRun("nonexistent")).not.toThrow();
    });

    it("handles unregister for unknown group gracefully", () => {
      expect(() => unregisterGroupAbort("nonexistent", "r1")).not.toThrow();
    });
  });
});
