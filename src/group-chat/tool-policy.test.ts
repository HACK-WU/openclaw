import { describe, expect, it } from "vitest";
import { buildGroupChatToolPolicy } from "./tool-policy.js";

describe("tool-policy", () => {
  it("returns a policy with a deny list", () => {
    const policy = buildGroupChatToolPolicy();
    expect(policy.deny).toBeDefined();
    expect(Array.isArray(policy.deny)).toBe(true);
  });

  it("denies mutating tools", () => {
    const policy = buildGroupChatToolPolicy();
    const denied = policy.deny!;
    expect(denied).toContain("write");
    expect(denied).toContain("edit");
    expect(denied).toContain("exec");
    expect(denied).toContain("bash");
    expect(denied).toContain("apply_patch");
  });

  it("does not deny group_reply", () => {
    const policy = buildGroupChatToolPolicy();
    expect(policy.deny).not.toContain("group_reply");
  });

  it("does not deny read-only tools", () => {
    const policy = buildGroupChatToolPolicy();
    expect(policy.deny).not.toContain("read");
    expect(policy.deny).not.toContain("search");
    expect(policy.deny).not.toContain("list");
  });
});
