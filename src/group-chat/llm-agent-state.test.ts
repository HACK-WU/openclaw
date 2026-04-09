import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllLlmAgentStates,
  clearLlmAgentStates,
  getLlmAgentState,
  incrementLlmInteraction,
  resetLlmAgentState,
  updateLastRoleReminder,
} from "./llm-agent-state.js";

describe("llm-agent-state", () => {
  beforeEach(() => {
    clearAllLlmAgentStates();
  });

  it("getLlmAgentState returns undefined for uninitialized agent", () => {
    expect(getLlmAgentState("g1", "a1")).toBeUndefined();
  });

  it("incrementLlmInteraction creates state on first call", () => {
    const state = incrementLlmInteraction("g1", "a1");
    expect(state.interactionCount).toBe(1);
    expect(state.isFirstInteraction).toBe(false);
    expect(state.lastRoleReminderAt).toBe(0);
  });

  it("incrementLlmInteraction increments on subsequent calls", () => {
    incrementLlmInteraction("g1", "a1");
    incrementLlmInteraction("g1", "a1");
    const state = incrementLlmInteraction("g1", "a1");
    expect(state.interactionCount).toBe(3);
    expect(state.isFirstInteraction).toBe(false);
  });

  it("getLlmAgentState returns state after increment", () => {
    incrementLlmInteraction("g1", "a1");
    const state = getLlmAgentState("g1", "a1");
    expect(state).toBeDefined();
    expect(state!.interactionCount).toBe(1);
  });

  it("updateLastRoleReminder updates lastRoleReminderAt", () => {
    incrementLlmInteraction("g1", "a1");
    incrementLlmInteraction("g1", "a1");
    incrementLlmInteraction("g1", "a1");

    updateLastRoleReminder("g1", "a1");
    const state = getLlmAgentState("g1", "a1");
    expect(state!.lastRoleReminderAt).toBe(3);
  });

  it("updateLastRoleReminder is no-op for uninitialized agent", () => {
    // Should not throw
    updateLastRoleReminder("g1", "a1");
    expect(getLlmAgentState("g1", "a1")).toBeUndefined();
  });

  it("resetLlmAgentState deletes a single agent state", () => {
    incrementLlmInteraction("g1", "a1");
    incrementLlmInteraction("g1", "a2");

    resetLlmAgentState("g1", "a1");

    expect(getLlmAgentState("g1", "a1")).toBeUndefined();
    expect(getLlmAgentState("g1", "a2")).toBeDefined();
  });

  it("clearLlmAgentStates deletes all agents in a group", () => {
    incrementLlmInteraction("g1", "a1");
    incrementLlmInteraction("g1", "a2");
    incrementLlmInteraction("g2", "a1");

    clearLlmAgentStates("g1");

    expect(getLlmAgentState("g1", "a1")).toBeUndefined();
    expect(getLlmAgentState("g1", "a2")).toBeUndefined();
    // Other group untouched
    expect(getLlmAgentState("g2", "a1")).toBeDefined();
  });

  it("clearAllLlmAgentStates clears everything", () => {
    incrementLlmInteraction("g1", "a1");
    incrementLlmInteraction("g2", "a2");

    clearAllLlmAgentStates();

    expect(getLlmAgentState("g1", "a1")).toBeUndefined();
    expect(getLlmAgentState("g2", "a2")).toBeUndefined();
  });

  it("different groups have isolated state", () => {
    incrementLlmInteraction("g1", "a1");
    incrementLlmInteraction("g1", "a1");
    incrementLlmInteraction("g2", "a1");

    expect(getLlmAgentState("g1", "a1")!.interactionCount).toBe(2);
    expect(getLlmAgentState("g2", "a1")!.interactionCount).toBe(1);
  });
});
