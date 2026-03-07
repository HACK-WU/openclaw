import { describe, expect, it } from "vitest";
import { formatMentionsForDisplay } from "./group-chat.ts";

describe("formatMentionsForDisplay", () => {
  describe("dedicated line highlighting", () => {
    it("highlights mentions on dedicated line (line with only mentions)", () => {
      const content = `Please answer.
<<@dev>>`;
      const result = formatMentionsForDisplay(content);
      expect(result).toBe(`Please answer.
**@dev**`);
    });

    it("highlights mentions on dedicated line at the beginning", () => {
      const content = `<<@dev>> <<@test>>
各位请分享一下你们使用的模型配置。`;
      const result = formatMentionsForDisplay(content);
      expect(result).toBe(`**@dev** **@test**
各位请分享一下你们使用的模型配置。`);
    });

    it("highlights multiple mentions on dedicated line", () => {
      const content = `请各位分享一下本周的工作进展。
<<@dev>> <<@test>> <<@backend>>`;
      const result = formatMentionsForDisplay(content);
      expect(result).toBe(`请各位分享一下本周的工作进展。
**@dev** **@test** **@backend**`);
    });
  });

  describe("inline mention handling", () => {
    it("converts inline mentions to plain @ without highlighting", () => {
      const content = "这个问题请 <<@dev>> 帮忙看看。";
      const result = formatMentionsForDisplay(content);
      expect(result).toBe("这个问题请 @dev 帮忙看看。");
    });

    it("handles multiline with mixed dedicated and inline mentions", () => {
      // Note: `<<@test>> 请你也分享一下你的配置。` has other content on the same line,
      // so it's NOT a dedicated mention line and should be converted to plain @
      const content = `我刚才检查了 <<@dev>> 的配置，发现它使用的是 GPT-4。
<<@test>> 请你也分享一下你的配置。`;
      const result = formatMentionsForDisplay(content);
      // Both lines have other content, so both are converted to plain @
      expect(result).toBe(`我刚才检查了 @dev 的配置，发现它使用的是 GPT-4。
@test 请你也分享一下你的配置。`);
    });
  });

  describe("mixed scenarios", () => {
    it("handles multiple dedicated lines", () => {
      const content = `<<@dev>>
Some text here
<<@test>>`;
      const result = formatMentionsForDisplay(content);
      expect(result).toBe(`**@dev**
Some text here
**@test**`);
    });

    it("handles empty content", () => {
      const result = formatMentionsForDisplay("");
      expect(result).toBe("");
    });

    it("handles single line with no mentions", () => {
      const content = "Just a regular message";
      const result = formatMentionsForDisplay(content);
      expect(result).toBe("Just a regular message");
    });

    it("handles multiline with no mentions", () => {
      const content = `Line 1
Line 2
Line 3`;
      const result = formatMentionsForDisplay(content);
      expect(result).toBe(content);
    });
  });

  describe("edge cases", () => {
    it("handles plain @ mentions (not in <<>> format) - no transformation", () => {
      const content = "Hey @dev and @test";
      const result = formatMentionsForDisplay(content);
      expect(result).toBe("Hey @dev and @test");
    });

    it("handles mixed <<@>> and plain @ on same line with other content", () => {
      const content = "Plain @dev vs <<@real>> here";
      const result = formatMentionsForDisplay(content);
      expect(result).toBe("Plain @dev vs @real here");
    });

    it("handles dedicated line with whitespace", () => {
      const content = `  <<@dev>>  `;
      const result = formatMentionsForDisplay(content);
      expect(result).toBe("  **@dev**  ");
    });

    it("handles multiple identical mentions on dedicated line", () => {
      const content = `<<@dev>> <<@dev>>`;
      const result = formatMentionsForDisplay(content);
      expect(result).toBe("**@dev** **@dev**");
    });

    it("preserves line breaks exactly", () => {
      const content = `Line 1

<<@dev>>`;
      const result = formatMentionsForDisplay(content);
      expect(result).toBe(`Line 1

**@dev**`);
    });
  });

  describe("real-world scenarios", () => {
    it("formats agent asking another agent at end", () => {
      const content = `I need to check with the backend team.
<<@backend>>`;
      const result = formatMentionsForDisplay(content);
      expect(result).toBe(`I need to check with the backend team.
**@backend**`);
    });

    it("formats agent asking multiple agents at beginning", () => {
      const content = `<<@frontend>> <<@backend>>
Please coordinate on this feature.`;
      const result = formatMentionsForDisplay(content);
      expect(result).toBe(`**@frontend** **@backend**
Please coordinate on this feature.`);
    });

    it("formats agent telling owner about another agent (no routing)", () => {
      const content = `I checked with <<@dev>> and they confirmed the issue.
No further action needed.`;
      const result = formatMentionsForDisplay(content);
      // Inline mention is converted to plain @
      expect(result).toBe(`I checked with @dev and they confirmed the issue.
No further action needed.`);
    });

    it("formats dedicated line with only one mention", () => {
      const content = `The issue involves multiple components.
<<@frontend>>`;
      const result = formatMentionsForDisplay(content);
      expect(result).toBe(`The issue involves multiple components.
**@frontend**`);
    });
  });
});
