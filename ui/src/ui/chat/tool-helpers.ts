/**
 * Helper functions for tool card rendering.
 */

import { PREVIEW_MAX_CHARS, PREVIEW_MAX_LINES } from "./constants.ts";

/**
 * 匹配 ANSI 转义序列的正则表达式。
 * - 这里分离了 test 与 replace 两种正则：
 *   - test 用无 /g 的正则，避免 lastIndex 导致的偶发误判
 *   - replace 用 /g 的正则，用于批量移除
 */
const ANSI_ESCAPE_RE_TEST =
  // oxlint-disable-next-line no-control-regex
  /[\x1b\x9b][\[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/;

const ANSI_ESCAPE_RE_REPLACE =
  // oxlint-disable-next-line no-control-regex
  /[\x1b\x9b][\[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;

/**
 * 检测文本中是否包含 ANSI 转义序列。
 * 用于启发式判断输出是否来自 PTY 终端（当 args.pty 标记不可用时作为回退）。
 */
export function containsAnsiEscapes(text: string): boolean {
  return ANSI_ESCAPE_RE_TEST.test(text);
}

/**
 * 一些工具（尤其是交互式 CLI）可能会输出类似 CSI 序列，但在某些链路上 ESC 字符丢失，
 * 最终表现为："[38;5;79m"、"[2K"、"[1A" 等“看起来像终端控制码”的文本。
 *
 * 这类内容不适合当 JSON/Markdown 渲染，UI 应优先当作终端输出展示。
 */
const ANSI_LIKE_NO_ESC_RE = /\[(?:\?25[lh]|(?:\d{1,4}(?:;\d{0,4})*)?)(?:m|K|A|B|C|D|H|J|f|s|u)/;

export function isTerminalLikeOutput(text: string): boolean {
  return containsAnsiEscapes(text) || ANSI_LIKE_NO_ESC_RE.test(text);
}

/**
 * 从文本中移除 ANSI 转义序列，返回纯文本。
 */
export function stripAnsiEscapes(text: string): string {
  return text.replace(ANSI_ESCAPE_RE_REPLACE, "");
}

function looksLikeCompleteJson(trimmed: string): boolean {
  if (trimmed.startsWith("{")) {
    return trimmed.endsWith("}");
  }
  if (trimmed.startsWith("[")) {
    return trimmed.endsWith("]");
  }
  return false;
}

/**
 * Format tool output content for display in the sidebar.
 * Detects JSON and wraps it in a code block with formatting.
 */
export function formatToolOutputForSidebar(text: string): string {
  const trimmed = text.trim();

  // Try to detect and format JSON.
  // 注意：某些终端控制序列在链路中会变成以 "[" 开头的文本（例如 "[38;5;79m"），
  // 这里必须收紧判断，避免误判后触发 JSON.parse 异常。
  if (looksLikeCompleteJson(trimmed)) {
    try {
      const parsed = JSON.parse(trimmed);
      return "```json\n" + JSON.stringify(parsed, null, 2) + "\n```";
    } catch {
      // Not valid JSON, return as-is
    }
  }

  return text;
}

/**
 * Get a truncated preview of tool output text.
 * Truncates to first N lines or first N characters, whichever is shorter.
 */
export function getTruncatedPreview(text: string): string {
  const allLines = text.split("\n");
  const lines = allLines.slice(0, PREVIEW_MAX_LINES);
  const preview = lines.join("\n");
  if (preview.length > PREVIEW_MAX_CHARS) {
    return preview.slice(0, PREVIEW_MAX_CHARS) + "…";
  }
  return lines.length < allLines.length ? preview + "…" : preview;
}
