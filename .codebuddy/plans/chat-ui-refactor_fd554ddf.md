---
name: chat-ui-refactor
overview: 根据设计文档 `docs/refactor/chat-ui-refactor-design.md` 实施 Chat UI 重构，将工具调用结果从侧边栏移至主对话流内联显示，支持流式 Markdown 渲染、可折叠工具卡片、PTY 终端增量写入。
todos:
  - id: phase1-markdown-uncached
    content: 在 markdown.ts 中新增 renderMarkdownUncached() 函数和 patchIncompleteMarkdown() 未闭合标记修补函数
    status: completed
  - id: phase1-typewriter
    content: 重构 typewriter-directive.ts，将 _flush() 改为调用 renderMarkdownUncached()，注入光标 span 替代 CSS ::after
    status: completed
    dependencies:
      - phase1-markdown-uncached
  - id: phase1-cursor-css
    content: 修改 grouped.css 将 .chat-text-streaming::after 样式迁移到 .streaming-cursor 类
    status: completed
    dependencies:
      - phase1-typewriter
  - id: phase2-types
    content: 在 chat-types.ts 中扩展 ToolCard 类型，新增 category 分类字段
    status: completed
  - id: phase2-classify
    content: 在 tool-cards.ts 中实现 classifyToolCards() 分类函数和 renderToolGroupCard()、renderBashCommandCard() 渲染函数
    status: completed
    dependencies:
      - phase2-types
  - id: phase2-css
    content: 重构 tool-cards.css，移除 max-height 限制，添加 grid-template-rows 折叠/展开动画和三种卡片样式
    status: completed
  - id: phase2-integrate
    content: 修改 grouped-render.ts 的 renderGroupedMessage() 使用新的工具卡片分类渲染
    status: completed
    dependencies:
      - phase2-classify
      - phase2-css
  - id: phase3-terminal
    content: 在 terminal-viewer.ts 中新增 live 属性支持增量写入，实现 _writtenLength + _lastContent 双重守卫
    status: completed
  - id: phase3-pty-card
    content: 在 tool-cards.ts 中实现 renderPtyTerminalCard()，嵌入 terminal-viewer live 组件
    status: completed
    dependencies:
      - phase3-terminal
      - phase2-classify
  - id: phase4-test
    content: 测试验证：流式 Markdown 渲染、工具卡片折叠展开、PTY 实时更新等场景
    status: completed
    dependencies:
      - phase1-typewriter
      - phase2-integrate
      - phase3-pty-card
---

## 产品概述

对 Web 端对话窗口进行重构，实现类似 Claude 风格的现代化 UI 交互体验，核心改进包括流式 Markdown 实时渲染、工具调用可折叠卡片、命令执行独立卡片和 PTY 终端实时卡片。

## 核心功能

1. **流式 Markdown 实时渲染** — 流式输出时打字机效果直接展示渲染好的 Markdown 格式，而非等待全部加载完成后才渲染
2. **工具调用合并卡片** — 同一批非 bash、非 PTY 的工具调用收纳到一张可折叠卡片中，点击展开查看详情
3. **命令执行独立卡片** — 每个 bash 命令占一张独立可折叠卡片，默认关闭状态，点击原地展开显示命令和输出
4. **PTY/Terminal 实时卡片** — Process Terminal 独立卡片，内容实时自动刷新，嵌入 xterm.js 活终端
5. **统一折叠/展开机制** — 三种卡片共用 CSS `grid-template-rows` 过渡动画，原地展开而非跳转侧边栏

## 技术栈

- 前端框架：Lit Web Components（现有项目）
- Markdown 渲染：marked + DOMPurify（现有项目）
- 终端渲染：xterm.js（现有项目）
- 样式：CSS（现有项目）
- 构建：TypeScript + ESM

## 实现方案

本次重构基于现有代码架构，采用渐进式改造策略，分为 4 个阶段实施：

### Phase 1：流式 Markdown 渲染

- 在 `markdown.ts` 中新增 `renderMarkdownUncached()` 函数，绕过 LRU 缓存直接调用 `marked.parse()` + `DOMPurify.sanitize()`
- 重构 `typewriter-directive.ts` 的 `_flush()` 方法，将 `escapeHtml() + replace(\n, <br>)` 替换为 `renderMarkdownUncached()`
- 新增 `patchIncompleteMarkdown()` 函数处理未闭合的代码块、行内代码、粗体、斜体
- 将 CSS `::after` 伪元素光标改为在 HTML 末尾注入 `<span class="streaming-cursor">`

### Phase 2：工具卡片分类与折叠

- 在 `chat-types.ts` 中扩展 `ToolCard` 类型，新增 `category` 分类字段
- 在 `tool-cards.ts` 中实现 `classifyToolCards()` 分类函数，区分 generalTools/bashCommands/ptyTerminals
- 新增 `renderToolGroupCard()` 渲染合并工具卡片、`renderBashCommandCard()` 渲染命令卡片
- 在 `tool-cards.css` 中添加 `grid-template-rows` 折叠/展开动画，移除现有 `max-height: 120px` 硬限制

### Phase 3：PTY 实时终端卡片

- 在 `terminal-viewer.ts` 中新增 `live` 属性支持增量写入模式
- 使用 `_writtenLength` + `_lastContent` 双重守卫，确保截断场景自动降级为全量重写
- 在 `tool-cards.ts` 中实现 `renderPtyTerminalCard()`，嵌入 `<terminal-viewer live>`

### Phase 4：集成与清理

- 修改 `grouped-render.ts` 中的 `renderGroupedMessage()` 使用新的分类渲染流程
- 保留侧边栏作为后备查看方式，添加"在侧边栏查看"按钮

## 实现要点

### 流式 Markdown 性能保障

- 上游 `controllers/chat.ts` 已有 50ms 节流（`CHAT_STREAM_THROTTLE_MS`），不需要额外字符阈值节流
- `marked.parse()` 是同步调用，对 <5K 文本处理时间 <1ms，远低于 16ms 帧预算
- 每帧直接调用 `renderMarkdownUncached()` 不会成为性能瓶颈

### 未闭合 Markdown 修补策略

````typescript
function patchIncompleteMarkdown(text: string): string {
  let result = text;
  // 代码块：计算 ``` 出现次数，奇数则追加闭合
  const codeBlockCount = (result.match(/```/g) || []).length;
  if (codeBlockCount % 2 !== 0) result += "\n```";
  // 行内代码：计算反引号出现次数（排除代码块内的）
  // 粗体/斜体：计算 ** 和 * 出现次数
  return result;
}
````

### PTY 增量写入守卫

```typescript
if (
  this.live &&
  this.content.length > this._writtenLength &&
  this.content.startsWith(this._lastContent)
) {
  // 增量模式：只写入新增部分
  const delta = this.content.slice(this._writtenLength);
  if (delta) this.term.write(delta);
} else {
  // 全量模式：内容被截断/替换/首次写入
  this.term.reset();
  if (this.content) this.term.write(this.content);
}
this._writtenLength = this.content.length;
this._lastContent = this.content;
```

### 折叠/展开动画（`grid-template-rows` 方案）

```css
.chat-tool-card__body {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 250ms ease-out;
}
.chat-tool-card--expanded .chat-tool-card__body {
  grid-template-rows: 1fr;
}
.chat-tool-card__body > .inner {
  overflow: hidden;
}
```

## 目录结构

```
ui/src/
├── ui/
│   ├── markdown.ts              # [MODIFY] 新增 renderMarkdownUncached() 函数，绕过缓存直接渲染 Markdown
│   ├── chat/
│   │   ├── typewriter-directive.ts  # [MODIFY] 重构 _flush() 方法，使用 renderMarkdownUncached() 替代 escapeHtml()，新增 patchIncompleteMarkdown() 处理未闭合标记，注入光标 span
│   │   ├── tool-cards.ts        # [MODIFY] 新增 classifyToolCards()、renderToolGroupCard()、renderBashCommandCard()、renderPtyTerminalCard() 函数，实现三种卡片分类渲染
│   │   ├── grouped-render.ts    # [MODIFY] 调整 renderGroupedMessage() 使用新的工具卡片分类渲染流程
│   │   ├── constants.ts         # [MODIFY] 新增折叠/展开相关常量 CARD_DEFAULT_EXPANDED
│   │   └── ...
│   ├── components/
│   │   └── terminal-viewer.ts   # [MODIFY] 新增 live 属性支持增量写入模式，添加 _writtenLength + _lastContent 双重守卫
│   └── types/
│       └── chat-types.ts        # [MODIFY] 扩展 ToolCard 类型，新增 category 字段用于分类
├── styles/chat/
│   ├── tool-cards.css           # [MODIFY] 移除 max-height: 120px 硬限制，新增 grid-template-rows 折叠/展开动画、箭头旋转、三种卡片样式变体
│   └── grouped.css              # [MODIFY] 修改 .chat-text-streaming::after 为 .streaming-cursor 类，确保光标在 Markdown 渲染后位置正确
└── ...
```

## Agent Extensions

### SubAgent

- **code-explorer**
- Purpose: 在实施过程中验证代码依赖关系和调用链，确保改动不破坏现有功能
- Expected outcome: 准确定位所有需要修改的代码位置和潜在影响范围
