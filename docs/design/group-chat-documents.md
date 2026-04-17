# 项目文档导出功能设计稿

## 背景

OpenClaw 的项目管理功能已支持创建和管理文档（Documents）。用户希望增加文档导出功能，便于备份、迁移和离线查看。

## 目标

- 支持将项目中的所有文档批量导出为可下载的文件
- 导出格式应便于用户阅读和编辑（Markdown 优先）
- 支持导入功能（后续迭代），实现跨项目文档迁移

## 现状分析

### 文档数据模型

```typescript
// src/projects/types.ts
export type ProjectDoc = {
  id: string; // UUID
  projectId: string;
  name: string; // 文档名称
  content: string; // Markdown 格式内容
  createdAt: number;
  updatedAt: number;
};
```

### 存储结构

```
~/.openclaw/projects/
├── index.json                    # 项目索引
├── {projectId}/
│   ├── meta.json                 # 项目元信息
│   ├── rules/                    # 规则目录
│   ├── skills/                   # 技能目录
│   └── docs/                     # ★ 文档目录
│       ├── {docId}.json          # 每个文档一个 JSON 文件
```

### 已有 RPC 接口

| 方法名                 | 功能         |
| ---------------------- | ------------ |
| `projects.docs.list`   | 列出所有文档 |
| `projects.docs.get`    | 获取单个文档 |
| `projects.docs.create` | 创建文档     |
| `projects.docs.update` | 更新文档     |
| `projects.docs.delete` | 删除文档     |

## 设计方案

### 总体架构

```
前端（UI 按钮）
    ↓ WebSocket RPC
Gateway
    ↓ 调用
project-store.ts (loadProjectDocs)
    ↓ 生成 ZIP
返回 base64 ZIP → 前端触发下载
```

### 新增 RPC 接口

#### 1. 文档导出

```typescript
// 请求
{
  projectId: string;
  docIds?: string[];         // 指定要导出的文档ID列表，不传则导出全部
  format?: "zip" | "json";  // 默认 zip
}

// 响应
{
  filename: string;          // 建议文件名
  contentType: string;       // MIME 类型
  data: string;              // Base64 编码的文件内容
  docCount: number;          // 导出的文档数量
  docIds: string[];          // 实际导出的文档ID列表
}
```

**方法名**: `projects.docs.export`

#### 2. 文档导入（Phase 2）

```typescript
// 请求
{
  projectId: string;
  data: string;              // Base64 编码的 ZIP/JSON
  format: "zip" | "json";
  conflictStrategy?: "skip" | "overwrite" | "rename";  // 冲突处理策略
}

// 响应
{
  imported: number;          // 成功导入数量
  skipped: number;           // 跳过数量
  errors: Array<{ name: string; reason: string }>;
}
```

**方法名**: `projects.docs.import`

### ZIP 文件结构

```
{project-name}-docs-{YYYY-MM-DD}/
├── README.md                  # 导出说明文件
├── docs.json                  # 完整数据备份（可选）
└── markdown/
    ├── {doc-name-1}.md
    ├── {doc-name-2}.md
    └── ...
```

#### README.md 模板

```markdown
# 项目文档导出

- 项目名称: {projectName}
- 导出时间: {timestamp}
- 文档数量: {count}

## 文档列表

| 名称   | 最后更新    |
| ------ | ----------- |
| {name} | {updatedAt} |

## 导入说明

在 OpenClaw 项目管理页面使用"导入文档"功能上传此 ZIP 文件。
```

### 文件名处理

- 清理特殊字符：`/` → `-`，`\` → `-`，`:` → `-`
- 重复名称处理：添加数字后缀 `{name}-1.md`
- 保留原始名称映射关系在 `docs.json` 中

## 代码实现

### 文件结构

```
src/
├── projects/
│   ├── doc-export.ts          # 导出核心逻辑
│   ├── doc-import.ts          # 导入核心逻辑（Phase 2）
│   └── doc-export.test.ts     # 单元测试
└── gateway/server-methods/
    └── projects.ts            # 新增 handler
```

### 核心实现代码

```typescript
// src/projects/doc-export.ts
import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { loadProjectDocs, loadProjectMeta } from "./project-store.js";

export interface DocExportOptions {
  projectId: string;
  format: "zip" | "json";
}

export interface DocExportResult {
  filename: string;
  contentType: string;
  data: string; // base64
  docCount: number;
}

export async function exportProjectDocs(options: DocExportOptions): Promise<DocExportResult> {
  const { projectId, format } = options;

  // 1. 加载项目信息和所有文档
  const meta = loadProjectMeta(projectId);
  if (!meta) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const docs = loadProjectDocs(projectId);
  if (docs.length === 0) {
    throw new Error("No documents to export");
  }

  // 2. 生成 ZIP 内容
  const JSZip = await import("jszip").then((m) => m.default);
  const zip = new JSZip();

  // 添加 README
  const readme = generateReadme(meta.name, docs);
  zip.file("README.md", readme);

  // 添加 docs.json（完整备份）
  zip.file("docs.json", JSON.stringify(docs, null, 2));

  // 添加 Markdown 文件
  const mdFolder = zip.folder("markdown")!;
  const usedNames = new Set<string>();

  for (const doc of docs) {
    const safeName = sanitizeFileName(doc.name, usedNames);
    usedNames.add(safeName);
    mdFolder.file(`${safeName}.md`, doc.content);
  }

  // 3. 生成 ZIP buffer
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `${sanitizeFileName(meta.name)}-docs-${timestamp}.zip`;

  return {
    filename,
    contentType: "application/zip",
    data: zipBuffer.toString("base64"),
    docCount: docs.length,
  };
}

function sanitizeFileName(name: string, existingNames?: Set<string>): string {
  // 替换非法字符
  let safe = name
    .replace(/[\\/:*?"<>|]/g, "-")
    .trim()
    .replace(/^\.+/, "")
    .replace(/\.+$/, "");

  if (!safe) {
    safe = "untitled";
  }

  // 处理重名
  if (existingNames) {
    let unique = safe;
    let counter = 1;
    while (existingNames.has(unique)) {
      unique = `${safe}-${counter}`;
      counter++;
    }
    safe = unique;
  }

  return safe;
}

function generateReadme(projectName: string, docs: ProjectDoc[]): string {
  const timestamp = new Date().toISOString();
  const rows = docs
    .map((d) => `| ${d.name} | ${new Date(d.updatedAt).toLocaleString()} |`)
    .join("\n");

  return `# 项目文档导出

- 项目名称: ${projectName}
- 导出时间: ${timestamp}
- 文档数量: ${docs.length}

## 文档列表

| 名称 | 最后更新 |
|------|----------|
${rows}

## 导入说明

在 OpenClaw 项目管理页面使用"导入文档"功能上传此 ZIP 文件。
`;
}
```

### Gateway Handler

```typescript
// src/gateway/server-methods/projects.ts
import { exportProjectDocs } from "../../projects/doc-export.js";

const handleProjectsDocsExport: GatewayRequestHandler = async ({ params, respond }) => {
  const projectId = params.projectId as string;
  const format = (params.format as "zip" | "json") ?? "zip";

  if (!projectId) {
    respond(false, undefined, { message: "projectId is required", code: 400 });
    return;
  }

  try {
    const result = await exportProjectDocs({ projectId, format });
    log.info(`Docs exported: ${result.docCount} docs from project ${projectId}`);
    respond(true, result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Failed to export docs: ${msg}`);
    respond(false, undefined, {
      message: `Export failed: ${msg}`,
      code: 500,
    });
  }
};

// 注册到 handlers
export const projectsHandlers: GatewayRequestHandlers = {
  // ... 已有方法
  "projects.docs.export": handleProjectsDocsExport,
};
```

## 界面操作设计

### 1. 文档 Tab 页布局（参照截图）

```
┌─────────────────────────────────────────────────────────────┐
│ 项目管理 - bkmonitor                                          │
├─────────────────────────────────────────────────────────────┤
│  概览    规则    技能   【文档】← 当前 Tab                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  项目文档                                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  + 创建文档   [导出]  [导入]                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │  📄  API 文档.md              编辑  删除           │   │
│  │     更新于 2025-04-10                               │   │
│  │                                                     │   │
│  │  📄  部署指南.md              编辑  删除           │   │
│  │     更新于 2025-04-09                               │   │
│  │                                                     │   │
│  │  📄  架构设计.md              编辑  删除           │   │
│  │     更新于 2025-04-08                               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│                                          [关闭]              │
└─────────────────────────────────────────────────────────────┘
```

### 2. 空状态界面

```
┌─────────────────────────────────────────────────────────────┐
│  项目文档                                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  + 创建规则   [导出]  [导入]                          │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │                    📁                               │   │
│  │                                                     │   │
│  │               暂无项目文档                           │   │
│  │                                                     │   │
│  │  创建文档来记录项目知识、规范或接口说明               │   │
│  │                                                     │   │
│  │            [创建第一篇文档]  [导入文档]              │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 3. 组件设计

#### 3.1 主按钮组（Header Actions）

```typescript
// 文档 Tab 页顶部操作栏
interface DocHeaderActionsProps {
  docCount: number;           // 当前文档数量
  onCreate: () => void;       // 创建新文档
  onExport: () => void;       // 导出（打开选择弹窗）
  onImport: () => void;       // 导入（Phase 2）
}

// 按钮状态
- "创建文档" - 始终可用
- "导出" - docCount > 0 时可用，否则禁用
- "导入" - 始终可用（Phase 2）
```

#### 3.2 文档列表项

```typescript
interface DocListItemProps {
  doc: {
    id: string;
    name: string;
    updatedAt: number;
  };
  onEdit: (docId: string) => void;
  onDelete: (docId: string) => void;
  onExportSingle?: (docId: string) => void; // Phase 3
}
```

#### 3.3 导出流程

```
用户点击 [导出]
        ↓
显示导出选择弹窗
        ↓
┌──────────────────────────────────────┐
│  导出项目文档                          │
│                                       │
│  选择要导出的文档（已选择 3/3）         │
│                                       │
│  ☑ 全选                               │
│                                       │
│  ☑ API 文档.md                        │
│  ☑ 部署指南.md                        │
│  ☑ 架构设计.md                        │
│                                       │
│  [取消]              [确认导出]        │
└──────────────────────────────────────┘
        ↓
调用 RPC: projects.docs.export（传入选中的 docIds）
        ↓
显示加载状态
        ↓
成功后触发浏览器下载 ZIP 文件
显示 Toast: "✅ 成功导出 3 篇文档"
```

#### 3.4 导入流程（Phase 2）

```
用户点击 [导入]
        ↓
打开文件选择器 (.zip, .json)
        ↓
解析文件，显示预览
┌──────────────────────────────────────┐
│  导入文档                              │
│                                       │
│  文件: bkmonitor-docs-2025-04-17.zip  │
│                                       │
│  包含 3 篇文档：                        │
│  ☐ API 文档.md   (与现有文档重名)      │
│  ☐ 部署指南.md   (新文档)              │
│  ☐ 架构设计.md   (新文档)              │
│                                       │
│  重名处理方式：                        │
│  (•) 重命名导入   ( ) 覆盖   ( ) 跳过  │
│                                       │
│  [取消]              [确认导入]        │
└──────────────────────────────────────┘
        ↓
调用 RPC: projects.docs.import
        ↓
显示导入结果
"✅ 导入完成：2 篇成功，1 篇重命名，0 篇跳过"
```

#### 3.5 错误处理

| 错误场景   | 处理方式                                         |
| ---------- | ------------------------------------------------ |
| 项目无文档 | 导出按钮禁用，Tooltip 提示"暂无文档可导出"       |
| 未选择文档 | 导出弹窗中确认按钮禁用，提示"请选择至少一篇文档" |
| 导出超时   | Toast 提示"导出超时，请稍后重试"                 |
| 文件过大   | Modal 提示"文档总大小超过 100MB，无法导出"       |
| 网络中断   | 重试机制，最多 3 次                              |

### 4. 状态管理

```typescript
// 前端 Store 扩展
interface ProjectDocsState {
  docs: ProjectDoc[];
  isLoading: boolean;
  exportState: {
    isExporting: boolean;
    progress?: number;  // 进度百分比（大文档导出时）
    error?: string;
  };
  importState: {
    isImporting: boolean;
    previewDocs?: ImportPreviewDoc[];
    conflictStrategy: 'rename' | 'overwrite' | 'skip';
  };
}

// Actions
- exportDocs(projectId: string, docIds?: string[]): Promise<void>  // docIds 不传则导出全部
- exportSingleDoc(projectId: string, docId: string): Promise<void>
- importDocs(projectId: string, file: File, strategy: ConflictStrategy): Promise<ImportResult>
- showExportDialog(): void
- showImportPreview(file: File): void
```

### 5. 响应式适配

```
桌面端 (>768px):
┌─────────────────────────────────────────────────────┐
│ + 创建文档  [导出]  [导入]                          │
│                                                     │
│ ☑ 📄 文档名称            编辑  删除  [导出]         │
└─────────────────────────────────────────────────────┘

移动端 (<768px):
┌─────────────────────────┐
│ + 创建                  │
│ [导出] [导入]            │
│                         │
│ ☑ 📄 文档名称    ⋮      │
└─────────────────────────┘
- 更多操作折叠在菜单中
- 支持行内单篇导出按钮
```

### 6. 快捷键

| 快捷键               | 功能                         |
| -------------------- | ---------------------------- |
| Ctrl/Cmd + E         | 快速导出（打开导出选择弹窗） |
| Ctrl/Cmd + Shift + E | 导出当前编辑的文档（单篇）   |

### 前端集成（概念）

````typescript
// 前端组件调用示例
async function handleExportDocs() {
  const result = await gateway.rpc("projects.docs.export", {
    projectId: currentProject.id,
    format: "zip",
  });

  if (result.success) {
    const { filename, data } = result.data;
    // 触发浏览器下载
    const blob = base64ToBlob(data, "application/zip");
    downloadBlob(blob, filename);
    showToast(`成功导出 ${result.data.docCount} 篇文档`);
  } else {
    showError(result.error.message);
  }
}

## 测试计划

### 单元测试

```typescript
// src/projects/doc-export.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { exportProjectDocs } from "./doc-export.js";

describe("exportProjectDocs", () => {
  it("should export empty docs list", async () => {
    // 验证空列表抛出正确错误
  });

  it("should sanitize file names", async () => {
    // 验证特殊字符处理
    // 验证重名处理
  });

  it("should generate valid ZIP structure", async () => {
    // 验证 ZIP 包含 README.md、docs.json、markdown/*.md
  });

  it("should return base64 encoded data", async () => {
    // 验证数据格式
  });
});
````

### 集成测试

- RPC 端点参数校验测试
- 大文档量导出性能测试
- 并发导出测试

## 安全考虑

1. **权限校验**: 复用现有 Gateway 鉴权机制
2. **文件大小限制**: ZIP 生成时检查总大小，超过阈值（如 100MB）返回错误
3. **文件名安全**: 严格清理特殊字符，防止路径遍历
4. **资源清理**: 使用流式生成避免内存泄漏

## 依赖项

- `jszip`: ZIP 文件生成（开发依赖已存在）

## 里程碑

| 阶段    | 功能                            | 预估工时 |
| ------- | ------------------------------- | -------- |
| MVP     | ZIP 导出功能（后端 + 基础测试） | 4h       |
| Phase 2 | 导入功能 + 冲突处理             | 4h       |
| Phase 3 | 前端 UI 集成 + 下载体验优化     | 4h       |

## 后续扩展

1. ~~PDF/HTML 导出格式~~（已取消）
2. **单文档导出**: 支持导出单个文档为 `.md` 文件
3. **自动备份**: 定时自动导出项目文档到指定目录
