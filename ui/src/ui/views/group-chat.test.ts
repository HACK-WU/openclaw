import { describe, expect, it } from "vitest";
import { formatMentionsForDisplay } from "./group-chat.ts";

describe("formatMentionsForDisplay", () => {
  describe("last line highlighting", () => {
    it("highlights mention on last line with markdown bold", () => {
      const content = "Hello <<@dev>>";
      const result = formatMentionsForDisplay(content);
      expect(result).toBe("Hello **@dev**");
    });

    it("highlights multiple mentions on last line", () => {
      const content = "Question. <<@dev>> <<@test>>";
      const result = formatMentionsForDisplay(content);
      expect(result).toBe("Question. **@dev** **@test**");
    });
  });

  describe("middle line handling", () => {
    it("converts middle line mentions to plain @ without highlighting", () => {
      const content = `First line <<@dev>>
Second line`;
      const result = formatMentionsForDisplay(content);
      expect(result).toBe(`First line @dev
Second line`);
    });

    it("handles multiline with mentions in middle and end", () => {
      const content = `<<@first>> is on line 1
<<@second>> is on line 2
<<@third>> is on line 3`;
      const result = formatMentionsForDisplay(content);
      expect(result).toBe(`@first is on line 1
@second is on line 2
**@third** is on line 3`);
    });
  });

  describe("mixed scenarios", () => {
    it("handles mentions only in middle lines (no highlight)", () => {
      const content = `<<@dev>> on first line
No mentions here`;
      const result = formatMentionsForDisplay(content);
      expect(result).toBe(`@dev on first line
No mentions here`);
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

    it("handles mixed <<@>> and plain @ on same line", () => {
      const content = "Plain @dev vs <<@real>>";
      const result = formatMentionsForDisplay(content);
      expect(result).toBe("Plain @dev vs **@real**");
    });

    it("handles mention at very start of last line", () => {
      const content = `Some context
<<@dev>>`;
      const result = formatMentionsForDisplay(content);
      expect(result).toBe(`Some context
**@dev**`);
    });

    it("handles mention at very end of last line", () => {
      const content = `Context before
Please respond <<@dev>>`;
      const result = formatMentionsForDisplay(content);
      expect(result).toBe(`Context before
Please respond **@dev**`);
    });

    it("handles multiple identical mentions on last line", () => {
      const content = "<<@dev>> and <<@dev>> again";
      const result = formatMentionsForDisplay(content);
      expect(result).toBe("**@dev** and **@dev** again");
    });

    it("preserves line breaks exactly", () => {
      const content = `Line 1

Line 3 with <<@dev>>`;
      const result = formatMentionsForDisplay(content);
      expect(result).toBe(`Line 1

Line 3 with **@dev**`);
    });
  });

  describe("real-world scenarios", () => {
    it("formats agent asking another agent", () => {
      const content = `I need to check with the backend team.
<<@backend>> can you verify the API status?`;
      const result = formatMentionsForDisplay(content);
      expect(result).toBe(`I need to check with the backend team.
**@backend** can you verify the API status?`);
    });

    it("formats agent telling owner about another agent (no routing)", () => {
      const content = `I checked with @dev and they confirmed the issue.
No further action needed.`;
      const result = formatMentionsForDisplay(content);
      // Both lines have no <<@>> mentions, so no transformation
      expect(result).toBe(content);
    });

    it("formats agent mentioning multiple agents at end", () => {
      const content = `The issue involves multiple components.
Please coordinate.
<<@frontend>> <<@backend>> <<@devops>>`;
      const result = formatMentionsForDisplay(content);
      expect(result).toBe(`The issue involves multiple components.
Please coordinate.
**@frontend** **@backend** **@devops**`);
    });
  });
});
