import DOMPurify from "dompurify";
import { marked } from "marked";
import { truncateText } from "./format.ts";

marked.setOptions({
  gfm: true,
  breaks: true,
});

const allowedTags = [
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "hr",
  "i",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
  "span", // Added for streaming cursor
];

const allowedAttrs = ["class", "href", "rel", "target", "title", "start"];

let hooksInstalled = false;
const MARKDOWN_CHAR_LIMIT = 140_000;
const MARKDOWN_PARSE_LIMIT = 40_000;
const MARKDOWN_CACHE_LIMIT = 200;
const MARKDOWN_CACHE_MAX_CHARS = 50_000;
const markdownCache = new Map<string, string>();

function getCachedMarkdown(key: string): string | null {
  const cached = markdownCache.get(key);
  if (cached === undefined) {
    return null;
  }
  markdownCache.delete(key);
  markdownCache.set(key, cached);
  return cached;
}

function setCachedMarkdown(key: string, value: string) {
  markdownCache.set(key, value);
  if (markdownCache.size <= MARKDOWN_CACHE_LIMIT) {
    return;
  }
  const oldest = markdownCache.keys().next().value;
  if (oldest) {
    markdownCache.delete(oldest);
  }
}

function installHooks() {
  if (hooksInstalled) {
    return;
  }
  hooksInstalled = true;

  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (!(node instanceof HTMLAnchorElement)) {
      return;
    }
    const href = node.getAttribute("href");
    if (!href) {
      return;
    }
    node.setAttribute("rel", "noreferrer noopener");
    node.setAttribute("target", "_blank");
  });
}

export function toSanitizedMarkdownHtml(markdown: string): string {
  const input = markdown.trim();
  if (!input) {
    return "";
  }
  installHooks();
  if (input.length <= MARKDOWN_CACHE_MAX_CHARS) {
    const cached = getCachedMarkdown(input);
    if (cached !== null) {
      return cached;
    }
  }
  const truncated = truncateText(input, MARKDOWN_CHAR_LIMIT);
  const suffix = truncated.truncated
    ? `\n\n… truncated (${truncated.total} chars, showing first ${truncated.text.length}).`
    : "";
  if (truncated.text.length > MARKDOWN_PARSE_LIMIT) {
    const escaped = escapeHtml(`${truncated.text}${suffix}`);
    const html = `<pre class="code-block">${escaped}</pre>`;
    const sanitized = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: allowedTags,
      ALLOWED_ATTR: allowedAttrs,
    });
    if (input.length <= MARKDOWN_CACHE_MAX_CHARS) {
      setCachedMarkdown(input, sanitized);
    }
    return sanitized;
  }
  const rendered = marked.parse(`${truncated.text}${suffix}`, {
    renderer: htmlEscapeRenderer,
  }) as string;
  const sanitized = DOMPurify.sanitize(rendered, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: allowedAttrs,
  });
  if (input.length <= MARKDOWN_CACHE_MAX_CHARS) {
    setCachedMarkdown(input, sanitized);
  }
  return sanitized;
}

// Prevent raw HTML in chat messages from being rendered as formatted HTML.
// Display it as escaped text so users see the literal markup.
// Security is handled by DOMPurify, but rendering pasted HTML (e.g. error
// pages) as formatted output is confusing UX (#13937).
const htmlEscapeRenderer = new marked.Renderer();
htmlEscapeRenderer.html = ({ text }: { text: string }) => escapeHtml(text);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Patch incomplete Markdown to prevent rendering artifacts during streaming.
 * Handles unclosed code blocks, inline code, bold, and italic markers.
 */
export function patchIncompleteMarkdown(text: string): string {
  let result = text;

  // Count ``` occurrences for code blocks (odd = unclosed)
  const codeBlockCount = (result.match(/```/g) || []).length;
  if (codeBlockCount % 2 !== 0) {
    result += "\n```";
  }

  // For inline markers, we need to be more careful:
  // Only patch if the marker is in the last line (likely still being typed)
  const lines = result.split("\n");
  const lastLine = lines[lines.length - 1] || "";

  // Inline code: count backticks in last line (excluding code block markers)
  // Skip if we just closed a code block above
  if (codeBlockCount % 2 === 0) {
    const inlineBackticks = (lastLine.match(/`/g) || []).length;
    if (inlineBackticks % 2 !== 0) {
      result += "`";
    }
  }

  // Bold **: count in last line
  const boldCount = (lastLine.match(/\*\*/g) || []).length;
  if (boldCount % 2 !== 0) {
    result += "**";
  }

  // Italic * (single asterisk, not part of **): more complex
  // Count single asterisks that are not part of ** pairs
  const singleAsterisks = lastLine.replace(/\*\*/g, "").match(/\*/g) || [];
  if (singleAsterisks.length % 2 !== 0) {
    result += "*";
  }

  return result;
}

/**
 * Render Markdown to sanitized HTML without caching.
 * Designed for streaming content that changes frequently.
 * Optionally appends a streaming cursor element.
 */
export function renderMarkdownUncached(markdown: string, withCursor = false): string {
  const input = markdown.trim();
  if (!input) {
    return withCursor ? '<span class="streaming-cursor"></span>' : "";
  }

  installHooks();

  // Patch incomplete markdown to prevent rendering artifacts
  const patched = patchIncompleteMarkdown(input);

  // Parse and sanitize (no caching for streaming content)
  const rendered = marked.parse(patched) as string;
  let sanitized = DOMPurify.sanitize(rendered, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: allowedAttrs,
  });

  // Inject streaming cursor at the end if requested
  if (withCursor) {
    // Find the last text-containing element and append cursor there
    // For simplicity, we append to the end of the HTML string
    // The CSS will position it correctly as an inline element
    sanitized = sanitized.replace(/<\/p>\s*$/, '<span class="streaming-cursor"></span></p>');
    // If no closing </p>, just append
    if (!sanitized.includes("streaming-cursor")) {
      sanitized += '<span class="streaming-cursor"></span>';
    }
  }

  return sanitized;
}
