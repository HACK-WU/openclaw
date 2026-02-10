/**
 * Chat message types for the UI layer.
 */

/** Union type for items in the chat thread */
export type ChatItem =
  | { kind: "message"; key: string; message: unknown }
  | { kind: "divider"; key: string; label: string; timestamp: number }
  | { kind: "stream"; key: string; text: string; startedAt: number }
  | { kind: "reading-indicator"; key: string };

/** A group of consecutive messages from the same role (Slack-style layout) */
export type MessageGroup = {
  kind: "group";
  key: string;
  role: string;
  messages: Array<{ message: unknown; key: string }>;
  timestamp: number;
  isStreaming: boolean;
};

/** Content item types in a normalized message */
export type MessageContentItem = {
  type: "text" | "tool_call" | "tool_result";
  text?: string;
  name?: string;
  args?: unknown;
};

/** Normalized message structure for rendering */
export type NormalizedMessage = {
  role: string;
  content: MessageContentItem[];
  timestamp: number;
  id?: string;
};

/** Tool card category for different rendering treatments */
export type ToolCardCategory = "general" | "bash" | "pty";

/** Tool card representation for tool calls and results */
export type ToolCard = {
  kind: "call" | "result";
  name: string;
  args?: unknown;
  text?: string;
  /** 标记该工具输出是否来自 PTY（伪终端），需要使用终端模拟器渲染 */
  isPty?: boolean;
  /** 卡片分类：general（合并卡片）、bash（独立命令卡片）、pty（实时终端卡片） */
  category?: ToolCardCategory;
};

/** Classified tool cards for grouped rendering */
export type ClassifiedToolCards = {
  /** Non-bash, non-PTY tool calls - merged into one collapsible card */
  generalTools: ToolCard[];
  /** Bash commands - each gets its own collapsible card */
  bashCommands: ToolCard[];
  /** PTY terminals - real-time terminal cards */
  ptyTerminals: ToolCard[];
};
