import { describe, expect, it } from "vitest";
import {
  DEFAULT_ASSISTANT_ROLE_PROMPT,
  DEFAULT_MEMBER_ROLE_PROMPT,
  resolveRolePrompt,
} from "./role-prompt.js";

describe("role-prompt", () => {
  it("returns default assistant prompt for assistant role", () => {
    const result = resolveRolePrompt("a1", "assistant", []);
    expect(result).toBe(DEFAULT_ASSISTANT_ROLE_PROMPT);
  });

  it("returns default member prompt for member role", () => {
    const result = resolveRolePrompt("a1", "member", []);
    expect(result).toBe(DEFAULT_MEMBER_ROLE_PROMPT);
  });

  it("returns custom prompt when configured for agent", () => {
    const prompts = [{ agentId: "a1", rolePrompt: "Custom instructions here." }];
    const result = resolveRolePrompt("a1", "assistant", prompts);
    expect(result).toBe("Custom instructions here.");
  });

  it("falls back to default when agent has no custom prompt", () => {
    const prompts = [{ agentId: "other", rolePrompt: "Not for a1." }];
    const result = resolveRolePrompt("a1", "member", prompts);
    expect(result).toBe(DEFAULT_MEMBER_ROLE_PROMPT);
  });

  it("falls back to default when custom prompt is empty string", () => {
    const prompts = [{ agentId: "a1", rolePrompt: "" }];
    const result = resolveRolePrompt("a1", "assistant", prompts);
    expect(result).toBe(DEFAULT_ASSISTANT_ROLE_PROMPT);
  });

  it("default prompts contain meaningful content", () => {
    expect(DEFAULT_ASSISTANT_ROLE_PROMPT).toContain("coordinator");
    expect(DEFAULT_MEMBER_ROLE_PROMPT).toContain("member");
  });
});
