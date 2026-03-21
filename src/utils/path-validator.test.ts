import { describe, it, expect } from "vitest";
import { sanitizeDirName } from "./path-validator.js";

describe("sanitizeDirName", () => {
  it("should replace special characters", () => {
    expect(sanitizeDirName("my agent")).toBe("my_agent");
    expect(sanitizeDirName("agent<test>")).toBe("agent_test_");
    expect(sanitizeDirName("agent:test")).toBe("agent_test");
    expect(sanitizeDirName('agent"test"')).toBe("agent_test_");
    expect(sanitizeDirName("agent/test")).toBe("agent_test");
  });

  it("should replace multiple spaces with single underscore", () => {
    expect(sanitizeDirName("my   agent")).toBe("my_agent");
  });

  it("should replace multiple dots with underscore", () => {
    expect(sanitizeDirName("agent...test")).toBe("agent_test");
  });

  it("should limit length to 50 characters", () => {
    const longName = "a".repeat(100);
    expect(sanitizeDirName(longName).length).toBe(50);
  });

  it("should handle empty string", () => {
    expect(sanitizeDirName("")).toBe("");
  });

  it("should preserve valid characters", () => {
    expect(sanitizeDirName("my_agent_123")).toBe("my_agent_123");
    expect(sanitizeDirName("researcher")).toBe("researcher");
  });
});

describe("validateWorkspacePath - restricted directories", () => {
  // These tests don't require filesystem access and verify the core security logic
  it("should reject empty path", async () => {
    const { validateWorkspacePath } = await import("./path-validator.js");
    const result = validateWorkspacePath("");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("agent.create.workspace.error.required");
  });

  it("should reject /etc", async () => {
    const { validateWorkspacePath } = await import("./path-validator.js");
    const result = validateWorkspacePath("/etc");
    expect(result.valid).toBe(false);
    expect(result.isRestricted).toBe(true);
    expect(result.error).toBe("agent.create.workspace.error.forbidden");
  });

  it("should reject /usr", async () => {
    const { validateWorkspacePath } = await import("./path-validator.js");
    const result = validateWorkspacePath("/usr");
    expect(result.valid).toBe(false);
    expect(result.isRestricted).toBe(true);
  });

  it("should reject /System (macOS)", async () => {
    const { validateWorkspacePath } = await import("./path-validator.js");
    const result = validateWorkspacePath("/System");
    expect(result.valid).toBe(false);
    expect(result.isRestricted).toBe(true);
  });

  it("should reject /Library (macOS)", async () => {
    const { validateWorkspacePath } = await import("./path-validator.js");
    const result = validateWorkspacePath("/Library");
    expect(result.valid).toBe(false);
    expect(result.isRestricted).toBe(true);
  });

  it("should reject ~/.ssh", async () => {
    const { validateWorkspacePath } = await import("./path-validator.js");
    const result = validateWorkspacePath("~/.ssh");
    expect(result.valid).toBe(false);
    expect(result.isRestricted).toBe(true);
  });

  it("should reject ~/.gnupg", async () => {
    const { validateWorkspacePath } = await import("./path-validator.js");
    const result = validateWorkspacePath("~/.gnupg");
    expect(result.valid).toBe(false);
    expect(result.isRestricted).toBe(true);
  });

  it("should reject /root exactly", async () => {
    const { validateWorkspacePath } = await import("./path-validator.js");
    const result = validateWorkspacePath("/root");
    expect(result.valid).toBe(false);
    expect(result.isRestricted).toBe(true);
  });

  it("should accept /root subdirectories", async () => {
    const { validateWorkspacePath } = await import("./path-validator.js");
    const result = validateWorkspacePath("/root/my-agent");
    // May fail due to parent not existing, but should not be restricted
    expect(result.isRestricted).toBe(false);
  });
});
