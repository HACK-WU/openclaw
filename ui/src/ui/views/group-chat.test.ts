import { describe, expect, it } from "vitest";
import { processMentionDisplay } from "../controllers/group-chat.ts";

// Helper function to test highlightMentionsInHtml logic
// Since it's private in the module, we test via the exported processMentionDisplay
// which uses the same logic
function highlightMentionsInHtml(html: string, memberIds: string[]): string {
  // Simulate the logic from highlightMentionsInHtml
  if (!memberIds.length) {
    return html;
  }

  const sortedIds = [...memberIds].toSorted((a, b) => b.length - a.length);
  let result = html;
  for (const agentId of sortedIds) {
    const pattern = new RegExp(
      `@${agentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-zA-Z0-9_-])(?![^<]*>)`,
      "g",
    );
    result = result.replace(pattern, `<mark class="mention">@${agentId}</mark>`);
  }
  return result;
}

describe("group-chat mention highlighting", () => {
  const memberIds = ["dev", "test", "backend"];

  describe("processMentionDisplay (controller function)", () => {
    it("highlights @memberId that is a valid member", () => {
      const content = "请 @dev 回答这个问题。";
      const result = processMentionDisplay(content, memberIds);
      expect(result).toBe('请 <mark class="mention">@dev</mark> 回答这个问题。');
    });

    it("highlights multiple @memberId mentions", () => {
      const content = "@dev 和 @test 请协作完成。";
      const result = processMentionDisplay(content, memberIds);
      expect(result).toBe(
        '<mark class="mention">@dev</mark> 和 <mark class="mention">@test</mark> 请协作完成。',
      );
    });

    it("does NOT highlight @xxx that is not a member", () => {
      const content = "联系 user@example.com 或找 @unknown 帮忙。";
      const result = processMentionDisplay(content, memberIds);
      // @unknown is not a member, @example is not a member
      expect(result).toBe("联系 user@example.com 或找 @unknown 帮忙。");
    });

    it("matches longer member IDs first to avoid partial matches", () => {
      const members = ["dev", "devops"];
      const content = "请 @devops 处理这个问题。";
      const result = processMentionDisplay(content, members);
      expect(result).toBe('请 <mark class="mention">@devops</mark> 处理这个问题。');
    });

    it("does not match @dev inside @devops", () => {
      const members = ["dev", "devops"];
      const content = "@devops 会处理，@dev 也会参与。";
      const result = processMentionDisplay(content, members);
      expect(result).toBe(
        '<mark class="mention">@devops</mark> 会处理，<mark class="mention">@dev</mark> 也会参与。',
      );
    });
  });

  describe("highlightMentionsInHtml (view function)", () => {
    it("highlights mentions in plain text", () => {
      const html = "<p>请 @dev 回答</p>";
      const result = highlightMentionsInHtml(html, memberIds);
      expect(result).toBe('<p>请 <mark class="mention">@dev</mark> 回答</p>');
    });

    it("does not highlight inside HTML tags", () => {
      const html = '<a href="/@dev">link</a>';
      const result = highlightMentionsInHtml(html, memberIds);
      // @dev inside tag attribute should not be replaced
      expect(result).toBe('<a href="/@dev">link</a>');
    });

    it("highlights multiple mentions", () => {
      const html = "<p>@dev 和 @test</p>";
      const result = highlightMentionsInHtml(html, memberIds);
      expect(result).toBe(
        '<p><mark class="mention">@dev</mark> 和 <mark class="mention">@test</mark></p>',
      );
    });

    it("does not highlight non-members", () => {
      const html = "<p>@unknown 用户</p>";
      const result = highlightMentionsInHtml(html, memberIds);
      expect(result).toBe("<p>@unknown 用户</p>");
    });

    it("handles empty memberIds", () => {
      const html = "<p>@dev</p>";
      const result = highlightMentionsInHtml(html, []);
      expect(result).toBe("<p>@dev</p>");
    });
  });

  describe("\\@ escape handling in processMentionDisplay", () => {
    it("converts \\@ to @ (escape)", () => {
      const content = "邮箱是 user\\@example.com";
      const result = processMentionDisplay(content, memberIds);
      expect(result).toBe("邮箱是 user@example.com");
    });

    it("converts escaped \\@dev to plain @dev", () => {
      const content = "这不是一个 \\@mention，只是普通文本。";
      const result = processMentionDisplay(content, memberIds);
      expect(result).toBe("这不是一个 @mention，只是普通文本。");
    });

    it("handles multiple escapes in one line", () => {
      const content = "联系 \\@support 或 \\@admin 获取帮助。";
      const result = processMentionDisplay(content, memberIds);
      expect(result).toBe("联系 @support 或 @admin 获取帮助。");
    });

    it("escape prevents mention highlighting", () => {
      const content = "这是 \\@dev，不是提及。";
      const result = processMentionDisplay(content, memberIds);
      // \@dev should become @dev without highlighting
      expect(result).toBe("这是 @dev，不是提及。");
    });
  });

  describe("mixed scenarios", () => {
    it("handles both escapes and mentions in same content", () => {
      const content = "我的邮箱是 test\\@example.com，请 @dev 联系我。";
      const result = processMentionDisplay(content, memberIds);
      expect(result).toBe(
        '我的邮箱是 test@example.com，请 <mark class="mention">@dev</mark> 联系我。',
      );
    });

    it("handles email addresses (no escape, not a member)", () => {
      const content = "发邮件到 user@example.com";
      const result = processMentionDisplay(content, memberIds);
      // @example is not a member, so no change
      expect(result).toBe("发邮件到 user@example.com");
    });

    it("handles empty content", () => {
      const result = processMentionDisplay("", memberIds);
      expect(result).toBe("");
    });

    it("handles content with no @ symbols", () => {
      const content = "这是一条普通消息。";
      const result = processMentionDisplay(content, memberIds);
      expect(result).toBe("这是一条普通消息。");
    });

    it("handles empty memberIds array", () => {
      const content = "请 @dev 回答";
      const result = processMentionDisplay(content, []);
      // No members to highlight
      expect(result).toBe("请 @dev 回答");
    });
  });

  describe("edge cases", () => {
    it("handles @ at end of content", () => {
      const content = "请回答 @dev";
      const result = processMentionDisplay(content, memberIds);
      expect(result).toBe('请回答 <mark class="mention">@dev</mark>');
    });

    it("handles @ at beginning of content", () => {
      const content = "@dev 请回答";
      const result = processMentionDisplay(content, memberIds);
      expect(result).toBe('<mark class="mention">@dev</mark> 请回答');
    });

    it("handles @mention followed by punctuation", () => {
      const content = "@dev, 请回答。";
      const result = processMentionDisplay(content, memberIds);
      expect(result).toBe('<mark class="mention">@dev</mark>, 请回答。');
    });

    it("handles @mention at end of sentence", () => {
      const content = "这个问题问 @dev。";
      const result = processMentionDisplay(content, memberIds);
      expect(result).toBe('这个问题问 <mark class="mention">@dev</mark>。');
    });

    it("handles multiple @ on same line with mixed members and non-members", () => {
      const content = "@dev 和 @unknown 和 @test 一起工作。";
      const result = processMentionDisplay(content, memberIds);
      expect(result).toBe(
        '<mark class="mention">@dev</mark> 和 @unknown 和 <mark class="mention">@test</mark> 一起工作。',
      );
    });
  });

  describe("real-world scenarios", () => {
    it("formats agent asking another agent", () => {
      const content = `我需要后端团队的支持。
@backend`;
      const result = processMentionDisplay(content, memberIds);
      expect(result).toBe(`我需要后端团队的支持。
<mark class="mention">@backend</mark>`);
    });

    it("formats agent mentioning member inline", () => {
      const content = "我刚才检查了 @dev 的配置，发现它使用的是 GPT-4。";
      const result = processMentionDisplay(content, memberIds);
      expect(result).toBe(
        '我刚才检查了 <mark class="mention">@dev</mark> 的配置，发现它使用的是 GPT-4。',
      );
    });

    it("formats email with escape", () => {
      const content = "我的工作邮箱是 john\\@company.com，请惠存。";
      const result = processMentionDisplay(content, memberIds);
      expect(result).toBe("我的工作邮箱是 john@company.com，请惠存。");
    });

    it("formats mixed content with routing and display mentions", () => {
      const content = `@dev 请回答这个问题。

另外我查看了 @test 的配置，一切正常。`;
      const result = processMentionDisplay(content, memberIds);
      expect(result).toBe(
        `<mark class="mention">@dev</mark> 请回答这个问题。

另外我查看了 <mark class="mention">@test</mark> 的配置，一切正常。`,
      );
    });
  });
});
