import { completeSimple } from "@mariozechner/pi-ai";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { getApiKeyForModel, requireApiKey } from "../agents/model-auth.js";
import { resolveDefaultModelForAgent } from "../agents/model-selection.js";
import { resolveModel } from "../agents/pi-embedded-runner/model.js";
import type { OpenClawConfig } from "../config/config.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { readSessionMessages } from "./session-utils.fs.js";

const DEFAULT_TITLE_MAX_LENGTH = 10;
const DEFAULT_TITLE_TIMEOUT_MS = 30_000; // 30 seconds timeout

export type GenerateSessionTitleResult = { ok: true; title: string } | { ok: false; error: string };

export type GenerateSessionTitleParams = {
  sessionId: string;
  storePath: string;
  sessionFile?: string;
  agentId?: string;
  maxLength?: number;
  cfg: OpenClawConfig;
};

/**
 * Resolves the model to use for title generation.
 * Uses the default model for the agent.
 */
function resolveTitleModelRef(cfg: OpenClawConfig, agentId: string) {
  const defaultRef = resolveDefaultModelForAgent({ cfg, agentId });
  return { ref: defaultRef, source: "default" as const };
}

/**
 * Extracts the last user message from session messages for title generation.
 * Uses only the most recent user message to keep context focused.
 */
function extractLastUserMessage(messages: unknown[]): string | null {
  // Iterate from the end to find the last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown> | undefined;
    if (!msg || msg.role !== "user") {
      continue;
    }

    const content = extractTextContent(msg.content);
    if (content && content.length >= 2) {
      return content.slice(0, 300); // Limit to 300 chars
    }
  }

  return null;
}

/**
 * Extracts text content from message content (string or array of parts).
 */
function extractTextContent(content: unknown): string | null {
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed || null;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const texts: string[] = [];
  for (const part of content) {
    if (
      part &&
      typeof part === "object" &&
      "type" in part &&
      part.type === "text" &&
      "text" in part
    ) {
      const text = String(part.text ?? "").trim();
      if (text) {
        texts.push(text);
      }
    }
  }

  return texts.length > 0 ? texts.join(" ") : null;
}

/**
 * Builds the prompt for title generation.
 */
function buildTitlePrompt(userMessage: string): string {
  return `根据用户的提问，生成一个简洁的会话标题：

用户提问：
${userMessage}

要求：
1. 标题不超过10个字
2. 概括问题核心主题
3. 不要包含标点符号
4. 直接输出标题，不要任何解释`;
}

/**
 * Sanitizes the generated title to ensure it meets requirements.
 */
function sanitizeTitle(title: string, maxLength: number): string {
  // Remove punctuation and special characters
  let cleaned = title.replace(/[，。！？、；：""''（）【】.,!?;:"'()[\]{}]/g, "");

  // Remove extra whitespace
  cleaned = cleaned.replace(/\s+/g, "").trim();

  // Truncate if needed
  if (cleaned.length > maxLength) {
    cleaned = cleaned.slice(0, maxLength);
  }

  return cleaned;
}

/**
 * Generates a session title using AI based on conversation content.
 */
export async function generateSessionTitle(
  params: GenerateSessionTitleParams,
): Promise<GenerateSessionTitleResult> {
  const {
    sessionId,
    storePath,
    sessionFile,
    agentId: providedAgentId,
    maxLength = DEFAULT_TITLE_MAX_LENGTH,
    cfg,
  } = params;

  // Resolve agent ID
  const agentId = providedAgentId ? normalizeAgentId(providedAgentId) : resolveDefaultAgentId(cfg);

  // Read session messages
  const messages = readSessionMessages(sessionId, storePath, sessionFile);

  if (messages.length === 0) {
    return { ok: false, error: "No messages found in session" };
  }

  // Extract last user message
  const lastUserMessage = extractLastUserMessage(messages);

  if (!lastUserMessage) {
    return { ok: false, error: "No valid user message found for title generation" };
  }

  // Resolve model
  const { ref } = resolveTitleModelRef(cfg, agentId);
  const resolved = resolveModel(ref.provider, ref.model, undefined, cfg);

  if (!resolved.model) {
    return { ok: false, error: resolved.error ?? `Unknown model: ${ref.provider}/${ref.model}` };
  }

  // Get API key
  let apiKey: string;
  try {
    apiKey = requireApiKey(await getApiKeyForModel({ model: resolved.model, cfg }), ref.provider);
  } catch (err) {
    return { ok: false, error: `Failed to get API key for ${ref.provider}: ${String(err)}` };
  }

  // Build prompt
  const prompt = buildTitlePrompt(lastUserMessage);

  // Log for debugging
  console.log(
    `[sessions.title] Generating title using ${ref.provider}/${ref.model} for message: ${lastUserMessage.slice(0, 50)}...`,
  );

  // Call AI
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TITLE_TIMEOUT_MS);

    try {
      const res = await completeSimple(
        resolved.model,
        {
          messages: [
            {
              role: "user",
              content: prompt,
              timestamp: Date.now(),
            },
          ],
        },
        {
          apiKey,
          maxTokens: 50, // Allow slightly more tokens for title generation
          temperature: 0.3,
          signal: controller.signal,
        },
      );

      // Extract title from response - handle both text and thinking blocks
      // Some models (like qwen) return thinking blocks instead of text
      let title = "";
      for (const block of res.content) {
        if (block.type === "text" && "text" in block) {
          title = String(block.text).trim();
          break;
        }
      }

      // If no text block found, try to extract from thinking blocks
      if (!title) {
        for (const block of res.content) {
          if (block.type === "thinking" && "thinking" in block) {
            const thinking = String(block.thinking);
            // Try to find the final output in thinking - look for the last line or a pattern
            const lines = thinking
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean);
            // Look for a short line (likely the title) at the end of thinking
            for (let i = lines.length - 1; i >= 0; i--) {
              const line = lines[i];
              if (line.length <= 20 && line.length >= 2 && !line.includes(":")) {
                title = line;
                break;
              }
            }
            if (title) {
              break;
            }
          }
        }
      }

      if (!title) {
        return {
          ok: false,
          error: `No title generated - AI returned empty response. Content: ${JSON.stringify(res.content)}`,
        };
      }

      // Sanitize title
      const sanitizedTitle = sanitizeTitle(title, maxLength);

      if (!sanitizedTitle) {
        return { ok: false, error: `Generated title "${title}" is empty after sanitization` };
      }

      console.log(`[sessions.title] Generated title: "${sanitizedTitle}"`);
      return { ok: true, title: sanitizedTitle };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const error = err as Error;
    if (error.name === "AbortError") {
      return { ok: false, error: `Title generation timed out after ${DEFAULT_TITLE_TIMEOUT_MS}ms` };
    }
    return { ok: false, error: `Title generation failed: ${error.message}` };
  }
}
