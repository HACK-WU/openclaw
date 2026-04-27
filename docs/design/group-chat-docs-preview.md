# 群聊文档在线预览功能设计

> **关联文档**:
>
> - [群聊后端设计](./group-chat-backend.md)
> - [群聊前端设计](./group-chat-frontend.md)
> - [群聊集成设计](./group-chat-integration.md)
>
> **版本**: v1.0  
> **日期**: 2026-04-24

---

## 1. 背景与需求

### 1.1 问题场景

在群聊协作中，Agent 经常需要生成文档：

- 记录会议讨论内容
- 输出代码审查结果
- 保存 API 设计文档
- 整理项目需求文档

**当前痛点**：

- 生成的文档无法直接在群聊中查看和编辑
- 文档分散存储在 Agent 各自的工作目录
- 缺乏统一的文档管理入口

### 1.2 设计目标

1. **共享存储**: 群聊级别统一文档目录
2. **在线预览**: 无需下载即可查看文档内容
3. **实时编辑**: 支持在线修改文档
4. **Agent 上下文感知**: Agent 自动识别文档存储位置

---

## 2. 总体架构

### 2.1 存储架构

```
~/.openclaw/group-chats/{groupId}/
├── meta.json              # 群聊元数据（已有）
├── transcript.jsonl       # 聊天记录（已有）
├── memory/                # 群聊记忆（已有）
└── docs/                  # ★ 新增：群聊文档目录
    ├── index.json         # 文档索引
    ├── {docId}.md         # Markdown 文档文件
    └── {docId}.json       # 文档元数据（可选）
```

### 2.2 交互架构

```
┌─────────────────────────────────────────────────────────────┐
│                          前端 UI                             │
│  ┌─────────────┐  ┌─────────────────────────────────────┐ │
│  │ 群聊消息    │  │ 群聊信息面板（右侧）               │ │
│  │             │  │  ───────────────────────────────── │ │
│  │ 消息内容    │  │  [成员] [文档列表] [群 Skill]     │ │
│  │             │  │  ───────────────────────────────── │ │
│  │             │  │  📄 API设计.md  [预览] [编辑]     │ │
│  │             │  │  📄 部署流程.md  [预览] [编辑]    │ │
│  │             │  │  📄 会议纪要.md  [预览] [编辑]    │ │
│  └─────────────┘  └─────────────────────────────────────┘ │
│                        │                                    │
│  ┌─────────────────────────────────────────────────────┐ │
│  │               文档预览/编辑模态框                    │ │
│  │                                                     │ │
│  │  ┌─────────────────────────────────────────────┐   │ │
│  │  │                                             │   │ │
│  │  │  # API 设计文档                              │   │ │
│  │  │                                             │   │ │
│  │  │  ## 接口列表                                 │   │ │
│  │  │  ...                                        │   │ │
│  │  │                                             │   │ │
│  │  └─────────────────────────────────────────────┘   │ │
│  │                                                     │ │
│  │  [关闭] [编辑] [导出]                              │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            │
                    WebSocket RPC
                            │
┌─────────────────────────────────────────────────────────────┐
│                         后端 Gateway                        │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  group.docs.* 方法处理器                           │    │
│  │  ├── group.docs.list                               │    │
│  │  ├── group.docs.get                                │    │
│  │  ├── group.docs.create                             │    │
│  │  ├── group.docs.update                             │    │
│  │  ├── group.docs.delete                             │    │
│  │  └── group.docs.refresh                            │    │
│  └─────────────────────────────────────────────────────┘    │
│                        │                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              group-chat/group-doc-store.ts          │    │
│  │  ├─ loadGroupDocsIndex()                          │    │
│  │  ├─ loadGroupDoc(groupId, docId)                  │    │
│  │  ├─ createGroupDoc(params)                         │    │
│  │  ├─ updateGroupDoc(groupId, docId, content)        │    │
│  │  └─ deleteGroupDoc(groupId, docId)                │    │
│  └─────────────────────────────────────────────────────┘    │
│                        │                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │         ~/.openclaw/group-chats/{groupId}/docs/      │    │
│  │  ├─ index.json                                      │    │
│  │  ├─ {docId}.md                                      │    │
│  │  └─ {docId}.json                                    │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 数据模型

### 3.1 文档类型定义

```typescript
// src/group-chat/types.ts

export type GroupDoc = {
  /** 文档唯一标识 (UUID) */
  id: string;
  /** 所属群聊 ID */
  groupId: string;
  /** 文档名称（不含扩展名） */
  name: string;
  /** 文档内容（Markdown 格式） */
  content: string;
  /** 创建者：'owner' 或 agentId */
  createdBy: string;
  /** 创建时间戳 (epoch ms) */
  createdAt: number;
  /** 更新时间戳 (epoch ms) */
  updatedAt: number;
};

export type GroupDocIndexEntry = {
  /** 文档 ID */
  id: string;
  /** 文档名称 */
  name: string;
  /** 创建者 */
  createdBy: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 更新时间戳 */
  updatedAt: number;
  /** 文件大小（字节） */
  size: number;
};
```

### 3.2 索引文件格式

```json
// ~/.openclaw/group-chats/{groupId}/docs/index.json

[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "API设计文档",
    "createdBy": "main",
    "createdAt": 1714041600000,
    "updatedAt": 1714041600000,
    "size": 12500
  },
  {
    "id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "name": "部署流程",
    "createdBy": "codebuddy",
    "createdAt": 1713955200000,
    "updatedAt": 1713955200000,
    "size": 8600
  }
]
```

---

## 4. 后端设计

### 4.1 文件结构

```
src/group-chat/
├── types.ts                  # 已有：扩展 GroupDoc 类型
├── group-doc-store.ts        # ★ 新增：文档存储操作
└── index.ts                  # 已有：导出新增模块

src/gateway/server-methods/
├── group.ts                  # 已有：扩展文档相关 RPC 方法
└── types.ts                  # 已有
```

### 4.2 存储层实现

详见代码实现：`src/group-chat/group-doc-store.ts`

主要方法：

- `getGroupDocsPath(groupId)` - 获取文档目录路径
- `loadGroupDocsIndex(groupId)` - 加载文档索引
- `loadGroupDoc(groupId, docId)` - 加载单个文档
- `createGroupDoc(params)` - 创建文档
- `updateGroupDoc(groupId, docId, content)` - 更新文档内容
- `renameGroupDoc(groupId, docId, name)` - 重命名文档
- `deleteGroupDoc(groupId, docId)` - 删除文档
- `refreshGroupDocsIndex(groupId)` - 刷新索引

### 4.3 RPC 方法

| 方法名               | 功能         | 请求参数                                | 响应数据                         |
| -------------------- | ------------ | --------------------------------------- | -------------------------------- |
| `group.docs.list`    | 获取文档列表 | `{ groupId }`                           | `{ docs: GroupDocIndexEntry[] }` |
| `group.docs.get`     | 获取单个文档 | `{ groupId, docId }`                    | `{ doc: GroupDoc }`              |
| `group.docs.create`  | 创建文档     | `{ groupId, name, content, createdBy }` | `{ doc: GroupDoc }`              |
| `group.docs.update`  | 更新文档内容 | `{ groupId, docId, content }`           | `{ doc: GroupDoc }`              |
| `group.docs.rename`  | 重命名文档   | `{ groupId, docId, name }`              | `{ doc: GroupDoc }`              |
| `group.docs.delete`  | 删除文档     | `{ groupId, docId }`                    | `{ deleted: true }`              |
| `group.docs.refresh` | 刷新索引     | `{ groupId }`                           | `{ docs: GroupDocIndexEntry[] }` |

### 4.4 Agent 上下文注入

**注入位置**: 在每次群聊对话的 System Prompt 中自动注入，作为上下文的一部分。

**注入时机**:

- 每次调用 `buildGroupSystemPrompt()` 构建上下文时
- 每个 Agent 的每次推理都会收到此指令

```typescript
// src/group-chat/context-builder.ts

/**
 * 构建群聊文档管理指令
 * 在每次对话时注入到 Agent 上下文中
 */
function buildGroupDocInstructions(groupId: string): string {
  const docsPath = getGroupDocsPath(groupId);

  return `
## 群聊文档管理

本群聊有一个共享的文档存储区域：${docsPath}

### 创建文档约定
1. **默认位置**: 所有文档都应存储在上述目录中
2. **命名规范**: 使用有意义的文件名，如 "api-design.md"
3. **内容格式**: 使用 Markdown 格式，第一行使用一级标题作为文档名称

### 创建示例
当用户要求创建文档时：
\`\`\`typescript
write_file({
  path: "${docsPath}/api-design.md",
  content: "# API 设计文档\\n\\n## 概述\\n..."
})
\`\`\`

用户可以在群聊信息面板的"文档列表"中查看、预览和编辑文档。
`;
}

/**
 * 在 System Prompt 中的位置
 *
 * 完整的 System Prompt 结构：
 * 1. 基础系统指令 (base system prompt)
 * 2. ★ 群聊文档管理指令 (buildGroupDocInstructions) ★  ← 插入位置
 * 3. 群聊角色职责指令
 * 4. 群公告
 * 5. 历史消息上下文
 */
export function buildGroupSystemPrompt(
  groupId: string,
  meta: GroupSessionEntry,
  options: ContextBuildOptions,
): string {
  const parts: string[] = [];

  // 1. 基础系统指令
  parts.push(buildBaseSystemPrompt());

  // 2. ★ 群聊文档管理指令（每次对话都注入）
  parts.push(buildGroupDocInstructions(groupId));

  // 3. 群聊角色职责
  parts.push(buildRolePrompt(meta));

  // 4. 群公告
  if (meta.announcement) {
    parts.push(`## 群公告\n\n${meta.announcement}`);
  }

  // 5. 上下文约束
  parts.push(buildContextConstraints(options));

  return parts.join("\n\n");
}
```

**为什么是每次对话都注入**：

- Agent 需要始终知道文档存储位置
- 避免因遗漏导致的文档散落问题
- 强化 Agent 使用共享目录的习惯
- 指令简洁，不会显著增加 Token 消耗

---

## 5. 前端设计

### 5.1 文件结构

```
ui/src/ui/
├── components/
│   ├── group-info-panel.ts       # 已有：扩展 Tab 切换
│   ├── group-docs-list.ts          # ★ 新增：文档列表组件
│   └── group-doc-modal.ts          # ★ 新增：文档预览/编辑模态框
├── controllers/
│   └── group-chat.ts               # 已有：扩展文档 RPC 方法
├── app-view-state.ts               # 已有：扩展文档相关状态
└── i18n/
    ├── en.ts                       # 已有：扩展文档相关文案
    └── zh.ts                       # 已有：扩展文档相关文案
```

### 5.2 状态管理

```typescript
// ui/src/ui/app-view-state.ts

type AppViewState = {
  // ... existing fields ...

  // 群聊信息面板
  groupInfoPanelOpen: boolean;
  groupInfoTab: "members" | "docs" | "skills";

  // 群聊文档列表
  groupDocsList: GroupDocIndexEntry[];
  groupDocsLoading: boolean;

  // 文档模态框
  docModalOpen: boolean;
  docModalMode: "preview" | "edit" | "create";
  currentDoc: GroupDoc | null;
  docEditContent: string;
  docEditName: string;
};
```

### 5.3 界面设计

#### 群聊信息面板 - 文档列表 Tab

```
┌─────────────────────────────────────────┐
│ 群聊信息                      [×]       │
├─────────────────────────────────────────┤
│                                          │
│ [成员列表] [文档列表] [群 Skill]        │
│ ───────────────────────────────────────│
│                                          │
│ 📄 文档列表 (3)              [刷新] [+] │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                          │
│ 📄 API设计文档.md                        │
│    创建于 2026-04-24 · Claude            │
│    [预览] [编辑] [删除]                  │
│ ───────────────────────────────────────  │
│ 📄 部署流程.md                           │
│    创建于 2026-04-23 · CodeBuddy         │
│    [预览] [编辑] [删除]                  │
│ ───────────────────────────────────────  │
│ 📄 会议纪要.md                           │
│    创建于 2026-04-22 · Owner             │
│    [预览] [编辑] [删除]                  │
│                                          │
└─────────────────────────────────────────┘
```

#### 空状态

```
┌─────────────────────────────────────────┐
│ 群聊信息                      [×]       │
├─────────────────────────────────────────┤
│                                          │
│ [成员列表] [文档列表] [群 Skill]        │
│ ───────────────────────────────────────│
│                                          │
│ 📄 文档列表 (0)              [刷新] [+] │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                          │
│                    📄                   │
│               暂无群聊文档              │
│                                          │
│     Agent 创建的文档将自动显示在这里    │
│                                          │
│         [+ 创建第一篇文档]              │
│                                          │
└─────────────────────────────────────────┘
```

#### 文档预览模态框

```
┌──────────────────────────────────────────────────────┐
│ 预览文档 - API设计文档.md                  [编辑] [×]│
├──────────────────────────────────────────────────────┤
│                                                      │
│ ┌────────────────────────────────────────────────┐  │
│ │                                                 │  │
│ │  # API 设计文档                                 │  │
│ │                                                 │  │
│ │  ## 概述                                        │  │
│ │                                                 │  │
│ │  本文档描述了系统的 API 接口设计...              │  │
│ │                                                 │  │
│ │  ## 接口列表                                    │  │
│ │  - POST /api/auth/login                        │  │
│ │  - POST /api/auth/logout                       │  │
│ │                                                 │  │
│ └────────────────────────────────────────────────┘  │
│                                                      │
│ ──────────────────────────────────────────────────── │
│                                                      │
│ 创建于: 2026-04-24 15:34  ·  Claude                │
│ 最后更新: 2026-04-24 15:34                         │
│ 文档大小: 12.5 KB                                   │
│                                                      │
│ [导出 Markdown] [复制内容] [删除文档]               │
│                                                      │
└──────────────────────────────────────────────────────┘
```

#### 文档编辑模态框

```
┌──────────────────────────────────────────────────────┐
│ 编辑文档 - API设计文档.md                            │
├──────────────────────────────────────────────────────┤
│                                                      │
│ 文档名称                                             │
│ ┌────────────────────────────────────────────────┐ │
│ │ API设计文档                                     │ │
│ └────────────────────────────────────────────────┘ │
│                                                      │
│ 文档内容                                             │
│ ┌────────────────────────────────────────────────┐ │
│ │ # API 设计文档                                 │ │
│ │                                                │ │
│ │ ## 概述                                        │ │
│ │                                                │ │
│ │ 本文档描述了系统的 API 接口设计...              │ │
│ │ ...                                            │ │
│ │                                                │ │
│ └────────────────────────────────────────────────┘ │
│                                                      │
│ 支持 Markdown 格式                                  │
│                                                      │
│              [取消]           [保存修改]            │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## 6. 国际化文案

### 6.1 中文 (zh.ts)

```typescript
export const zh = {
  // ... existing translations ...

  "group.info.tab.docs": "文档列表",

  "group.docs.count": "文档 ({count})",
  "group.docs.refresh": "刷新",
  "group.docs.create": "新建",

  "group.docs.empty.title": "暂无群聊文档",
  "group.docs.empty.hint": "Agent 创建的文档将自动显示在这里",
  "group.docs.empty.button": "创建第一篇文档",

  "group.docs.action.preview": "预览",
  "group.docs.action.edit": "编辑",
  "group.docs.action.delete": "删除",
  "group.docs.action.rename": "重命名",
  "group.docs.action.export": "导出",
  "group.docs.action.copy": "复制内容",

  "group.docs.author.owner": "用户",
  "group.docs.author.agent": "{name}",

  "group.docs.modal.preview": "预览文档",
  "group.docs.modal.edit": "编辑文档",
  "group.docs.modal.create": "新建文档",

  "group.docs.label.name": "文档名称",
  "group.docs.label.content": "文档内容",
  "group.docs.label.createdAt": "创建于",
  "group.docs.label.updatedAt": "最后更新",
  "group.docs.label.size": "文档大小",

  "group.docs.error.loadFailed": "加载文档失败",
  "group.docs.error.saveFailed": "保存文档失败",
  "group.docs.error.deleteFailed": "删除文档失败",
  "group.docs.error.nameRequired": "文档名称不能为空",

  "group.docs.confirm.delete": "确定要删除文档 "{name}" 吗？此操作不可撤销。",

  "group.docs.toast.created": "文档创建成功",
  "group.docs.toast.updated": "文档更新成功",
  "group.docs.toast.deleted": "文档已删除",
  "group.docs.toast.exported": "文档已导出",
  "group.docs.toast.copied": "内容已复制到剪贴板",
};
```

### 6.2 英文 (en.ts)

```typescript
export const en = {
  // ... existing translations ...

  "group.info.tab.docs": "Documents",

  "group.docs.count": "Documents ({count})",
  "group.docs.refresh": "Refresh",
  "group.docs.create": "New",

  "group.docs.empty.title": "No group documents",
  "group.docs.empty.hint": "Documents created by Agents will appear here automatically",
  "group.docs.empty.button": "Create first document",

  "group.docs.action.preview": "Preview",
  "group.docs.action.edit": "Edit",
  "group.docs.action.delete": "Delete",
  "group.docs.action.rename": "Rename",
  "group.docs.action.export": "Export",
  "group.docs.action.copy": "Copy content",

  "group.docs.author.owner": "User",
  "group.docs.author.agent": "{name}",

  "group.docs.modal.preview": "Preview Document",
  "group.docs.modal.edit": "Edit Document",
  "group.docs.modal.create": "New Document",

  "group.docs.label.name": "Document Name",
  "group.docs.label.content": "Content",
  "group.docs.label.createdAt": "Created",
  "group.docs.label.updatedAt": "Last Updated",
  "group.docs.label.size": "Size",

  "group.docs.error.loadFailed": "Failed to load document",
  "group.docs.error.saveFailed": "Failed to save document",
  "group.docs.error.deleteFailed": "Failed to delete document",
  "group.docs.error.nameRequired": "Document name is required",

  "group.docs.confirm.delete": "Are you sure you want to delete "{name}"? This action cannot be undone.",

  "group.docs.toast.created": "Document created",
  "group.docs.toast.updated": "Document updated",
  "group.docs.toast.deleted": "Document deleted",
  "group.docs.toast.exported": "Document exported",
  "group.docs.toast.copied": "Content copied to clipboard",
};
```

---

## 7. 实施计划

### Phase 1: 后端基础 (2天)

- [ ] 创建 `src/group-chat/group-doc-store.ts`
  - [ ] 实现文档 CRUD 操作
  - [ ] 实现索引管理
  - [ ] 实现刷新功能
- [ ] 扩展 `src/group-chat/types.ts`
  - [ ] 添加 GroupDoc 类型
  - [ ] 添加 GroupDocIndexEntry 类型
- [ ] 扩展 `src/gateway/server-methods/group.ts`
  - [ ] 实现 7 个 RPC 方法
  - [ ] 注册到 handlers
- [ ] 扩展 `src/group-chat/context-builder.ts`
  - [ ] 添加文档管理指令注入
- [ ] 编写单元测试

### Phase 2: 前端基础 (2天)

- [ ] 扩展 `ui/src/ui/app-view-state.ts`
  - [ ] 添加文档相关状态字段
- [ ] 创建 `ui/src/ui/components/group-docs-list.ts`
  - [ ] 实现文档列表渲染
  - [ ] 实现刷新功能
  - [ ] 实现空状态
- [ ] 创建 `ui/src/ui/components/group-doc-modal.ts`
  - [ ] 实现预览模式
  - [ ] 实现编辑模式
  - [ ] 实现创建模式
- [ ] 扩展 `ui/src/ui/components/group-info-panel.ts`
  - [ ] 添加 Tab 切换
  - [ ] 集成文档列表
- [ ] 扩展 `ui/src/ui/controllers/group-chat.ts`
  - [ ] 添加文档 RPC 调用封装

### Phase 3: 体验优化 (1天)

- [ ] 扩展国际化文案
  - [ ] `ui/src/ui/i18n/zh.ts`
  - [ ] `ui/src/ui/i18n/en.ts`
- [ ] 添加样式
  - [ ] 文档列表样式
  - [ ] 文档预览样式
  - [ ] 文档编辑样式
- [ ] 添加交互细节
  - [ ] 确认对话框
  - [ ] Toast 提示
  - [ ] 加载状态
  - [ ] 错误处理
- [ ] 添加导出功能
  - [ ] 导出 Markdown
  - [ ] 复制内容到剪贴板

### Phase 4: 测试与优化 (1天)

- [ ] 编写集成测试
- [ ] 测试多种文档大小
- [ ] 测试并发操作
- [ ] 性能优化
- [ ] 代码审查

---

## 8. 依赖项

| 依赖             | 用途          | 版本 |
| ---------------- | ------------- | ---- |
| `uuid`           | 生成文档 ID   | ^9.x |
| 现有 `marked`    | Markdown 渲染 | 已有 |
| 现有 `dompurify` | HTML 净化     | 已有 |

---

## 9. 风险与缓解

| 风险           | 等级 | 缓解措施                                   |
| -------------- | ---- | ------------------------------------------ |
| 大文档加载性能 | 中   | 限制单文档大小（如 1MB），超长文档截断显示 |
| 索引文件损坏   | 低   | 提供 refresh 接口重建索引，定期备份        |
| 并发写入冲突   | 低   | 使用文件锁或基于 gateway 单线程处理        |
| 文档命名冲突   | 低   | 使用 UUID 作为文件名，索引中存储显示名称   |
| 存储空间增长   | 中   | 未来添加文档大小限制和自动清理策略         |

---

## 10. 后续扩展

### Phase 2 功能

1. **文档版本历史**
   - 记录每次修改的 diff
   - 支持回滚到历史版本

2. **文档搜索**
   - 全文搜索文档内容
   - 按名称、作者、时间过滤

3. **文档模板**
   - 预设常用文档模板
   - 快速创建标准格式文档

4. **文档导出增强**
   - 导出为 PDF
   - 批量导出 ZIP

5. **文档协作**
   - 显示当前编辑者
   - 冲突检测与合并

---

## 11. 验收标准

- [ ] 用户可以在群聊信息面板的"文档列表" Tab 中查看所有文档
- [ ] 文档列表显示名称、创建时间、作者、大小
- [ ] 点击"刷新"按钮可以重新扫描并重建索引
- [ ] 点击"预览"可以在线查看文档内容（Markdown 渲染）
- [ ] 点击"编辑"可以在线修改文档内容
- [ ] 点击"新建"可以创建新文档
- [ ] 点击"删除"可以删除文档（带确认对话框）
- [ ] Agent 在群聊上下文中可以获取文档存储路径
- [ ] Agent 创建的文档自动出现在文档列表中
- [ ] 所有操作有适当的错误处理和提示
