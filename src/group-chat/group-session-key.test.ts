import { describe, expect, it } from "vitest";
import {
  GROUP_SESSION_KEY_PREFIX,
  buildGroupSessionKey,
  isGroupSessionKey,
  parseGroupSessionKey,
} from "./group-session-key.js";

describe("group-session-key", () => {
  it("builds a session key with the group: prefix", () => {
    expect(buildGroupSessionKey("abc-123")).toBe("group:abc-123");
  });

  it("detects group session keys", () => {
    expect(isGroupSessionKey("group:abc")).toBe(true);
    expect(isGroupSessionKey("group:")).toBe(true);
    expect(isGroupSessionKey("agent:x:y")).toBe(false);
    expect(isGroupSessionKey("")).toBe(false);
  });

  it("parses a valid group session key", () => {
    expect(parseGroupSessionKey("group:my-id")).toEqual({ groupId: "my-id" });
  });

  it("returns null for non-group keys", () => {
    expect(parseGroupSessionKey("agent:x")).toBeNull();
    expect(parseGroupSessionKey("")).toBeNull();
  });

  it("returns null when groupId portion is empty", () => {
    expect(parseGroupSessionKey("group:")).toBeNull();
  });

  it("exports the prefix constant", () => {
    expect(GROUP_SESSION_KEY_PREFIX).toBe("group:");
  });
});
