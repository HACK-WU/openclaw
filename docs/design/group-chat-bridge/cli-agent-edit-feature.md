# CLI Agent 编辑功能实现

本文档记录 CLI Agent 编辑功能的实现细节。

## 📋 需求背景

在 CLI Agent 管理页面中，用户创建 CLI Agent 后无法修改配置。需要添加编辑按钮，允许用户修改已创建的 CLI Agent 配置。

## 🎯 功能需求

1. ✅ 在 CLI Agent 详情页面添加 **Edit** 按钮
2. ✅ 点击 Edit 按钮后弹出编辑对话框
3. ✅ 编辑对话框与创建对话框结构相同
4. ✅ 自动填充当前配置到表单
5. ✅ 保存时调用 `cliAgents.update` API 更新配置
6. ✅ 更新成功后刷新 CLI Agent 列表

## 📁 修改的文件

### 1️⃣ `ui/src/ui/views/agents.ts`

**修改内容**:

#### 添加 Edit 按钮到 CLI Agent header

```typescript
// 第 617-621 行
<button
  class="btn btn--sm"
  ?disabled=${props.cliCreateBusy}
  @click=${() => props.onShowCliEditDialog(agent.id)}
>Edit</button>
```

#### 添加编辑弹框渲染

```typescript
// 第 593 行
${props.showCliEditDialog ? renderEditCliAgentDialog(props) : nothing}
```

#### 新增 renderEditCliAgentDialog 函数

```typescript
// 第 1610-1821 行
function renderEditCliAgentDialog(props: AgentsProps) {
  // 结构与 renderCreateCliAgentDialog 完全相同
  // 唯一区别：
  // - 标题："编辑 CLI Agent" vs "添加 CLI Agent"
  // - 按钮："保存修改" vs "创建"
  // - 回调：onUpdateCliAgent vs onCreateCliAgent
}
```

#### 扩展 AgentsProps 类型

```typescript
// 第 144-146 行
// CLI Agent edit state
showCliEditDialog: boolean;
cliEditAgentId: string | null;

// 第 203-206 行
// CLI Agent edit callbacks
onShowCliEditDialog: (agentId: string) => void;
onHideCliEditDialog: () => void;
onUpdateCliAgent: () => void;
```

---

### 2️⃣ `ui/src/ui/controllers/agents.ts`

**修改内容**:

#### 扩展 AgentsState 类型

```typescript
// 第 28-30 行
// CLI Agent edit state
agentCliEditBusy?: boolean;
agentCliEditError?: string | null;
cliEditAgentId?: string | null;
```

#### 添加 CliType 类型导入

```typescript
// 第 3 行
import type {
  CliAgentCreateForm,
  CliAgentsListResult,
  CliTestResult,
  CliType,
} from "../views/agents.ts";
```

#### 新增 showCliEditDialog 函数

```typescript
// 第 350-374 行
export function showCliEditDialog(state: AgentsState, agentId: string): void {
  const agent = state.cliAgentsList?.agents.find((a) => a.id === agentId);
  if (!agent) {
    state.agentCliEditError = `CLI Agent "${agentId}" not found`;
    return;
  }

  // Load current config into the create form (reuse the same form state)
  state.cliCreateForm = {
    name: agent.name,
    agentId: agent.id,
    workspace: agent.cwd || "",
    emoji: agent.emoji || "🔧",
    cliType: agent.type as CliType,
    command: agent.command,
    args: Array.isArray(agent.args) ? agent.args.join(" ") : "",
    env: agent.env ? Object.entries(agent.env).map(([key, value]) => ({ key, value })) : [],
    timeout: agent.timeout ? Math.round(agent.timeout / 1000) : 300,
    idleTimeout: 600, // Default value
  };

  state.cliEditAgentId = agentId;
  state.showCliEditDialog = true;
  state.agentCliEditError = null;
}
```

#### 新增 hideCliEditDialog 函数

```typescript
// 第 376-381 行
export function hideCliEditDialog(state: AgentsState): void {
  state.showCliEditDialog = false;
  state.cliEditAgentId = null;
  state.agentCliEditError = null;
}
```

#### 新增 updateCliAgent 函数

```typescript
// 第 383-420 行
export async function updateCliAgent(state: AgentsState): Promise<boolean> {
  if (!state.client || !state.connected || !state.cliEditAgentId) {
    return false;
  }

  state.agentCliCreateBusy = true; // Reuse create busy state
  state.agentCliEditError = null;

  try {
    const { cliCreateForm, cliEditAgentId } = state;

    // Build env object from the form's key-value array
    const envObj: Record<string, string> = {};
    for (const e of cliCreateForm.env) {
      if (e.key.trim()) {
        envObj[e.key.trim()] = e.value;
      }
    }

    await state.client.request("cliAgents.update", {
      agentId: cliEditAgentId,
      name: cliCreateForm.name,
      command: cliCreateForm.command,
      args: cliCreateForm.args.trim() ? cliCreateForm.args.trim().split(/\s+/) : undefined,
      cwd: cliCreateForm.workspace || undefined,
      env: Object.keys(envObj).length > 0 ? envObj : undefined,
      timeout: cliCreateForm.timeout * 1000,
      emoji: cliCreateForm.emoji || "🔧",
    });

    await loadCliAgents(state);
    return true;
  } catch (err) {
    state.agentCliEditError = String(err);
    return false;
  } finally {
    state.agentCliCreateBusy = false;
  }
}
```

---

### 3️⃣ `ui/src/ui/app-render.ts`

**修改内容**:

#### 导入编辑相关函数

```typescript
// 第 18-31 行
import {
  loadAgents,
  loadToolsCatalog,
  createAgent,
  createCliAgent,
  deleteAgent,
  deleteCliAgent,
  setDefaultAgent,
  saveAgentsConfig,
  loadCliAgents,
  testCliAgent,
  stopCliAgentTest,
  sendTestInput,
  showCliEditDialog,
  hideCliEditDialog,
  updateCliAgent,
} from "./controllers/agents.ts";
```

#### 添加编辑回调绑定

```typescript
// 第 1217-1226 行
// CLI Agent edit callbacks
onShowCliEditDialog: (agentId: string) => {
  showCliEditDialog(state, agentId);
},
onHideCliEditDialog: () => {
  hideCliEditDialog(state);
},
onUpdateCliAgent: async () => {
  const ok = await updateCliAgent(state);
  if (ok) {
    hideCliEditDialog(state);
  }
},
```

---

## 🔄 数据流

```
用户点击 Edit 按钮
    ↓
onShowCliEditDialog(agentId)
    ↓
showCliEditDialog(state, agentId)
    ├── 从 cliAgentsList 中找到对应 agent
    ├── 填充 cliCreateForm（复用创建表单）
    ├── 设置 cliEditAgentId
    └── 设置 showCliEditDialog = true
    ↓
renderEditCliAgentDialog(props)
    ↓
显示编辑弹框（已填充当前配置）
    ↓
用户修改配置 → 点击"保存修改"
    ↓
onUpdateCliAgent()
    ↓
updateCliAgent(state)
    ├── 构建更新参数
    ├── 调用 cliAgents.update RPC
    └── 刷新 CLI Agent 列表
    ↓
更新成功 → hideCliEditDialog()
    ↓
关闭弹框
```

---

## 🎨 UI 展示

### 编辑前（Overview 页面）

```
┌─────────────────────────────────────────────┐
│ 🛠️ codebuddy                      codebuddy [CLI] [Delete] │
├─────────────────────────────────────────────┤
│ [Overview] [Files] [Test]                   │
│                                             │
│ Identity                                    │
│ Agent 名称：codebuddy                       │
│ Agent ID:  codebuddy                        │
│ Emoji:     🛠️                               │
│                                             │
│ CLI Configuration                           │
│ CLI Type:   codebuddy                       │
│ Command:    codebuddy                       │
│ Arguments:  -y                              │
│ Working Dir: /Users/...                     │
└─────────────────────────────────────────────┘
```

### 点击 Edit 按钮后

```
┌─────────────────────────────────────────────┐
│ 编辑 CLI Agent                       [✕]    │
│ 修改 CLI Agent 配置。                        │
│                                             │
│ CLI 类型    [CodeBuddy ▾]                   │
│ Agent 名称  [codebuddy        ]             │
│ Agent ID    [codebuddy        ]             │
│ 图标        [🛠️]                            │
│ 启动命令    [codebuddy        ]             │
│ 启动参数    [-y              ]             │
│ 工作空间    [/Users/...      ]             │
│                                             │
│ 环境变量                                     │
│ [+ 添加环境变量]                            │
│                                             │
│ 单次回复超时  [300    ] 秒                   │
│ 空闲回收时间  [600    ] 秒                   │
│                                             │
│                  [取消]  [保存修改]          │
└─────────────────────────────────────────────┘
```

---

## ✅ 功能特点

### 1. 复用现有代码

- 复用 `cliCreateForm` 表单状态
- 复用 `renderCreateCliAgentDialog` 的渲染逻辑
- 复用 `cliAgents.list` 的数据结构

### 2. 数据自动填充

编辑弹框打开时自动填充：

- ✅ CLI Type
- ✅ Agent 名称
- ✅ Agent ID
- ✅ Emoji
- ✅ Command
- ✅ Arguments
- ✅ Working Directory
- ✅ Environment Variables
- ✅ Timeout

### 3. 表单验证

与创建时相同的验证规则：

- ✅ Agent 名称非空
- ✅ Agent ID 格式合法（`/^[a-zA-Z0-9_]+$/`）
- ✅ Command 非空
- ✅ Workspace 非空

### 4. 错误处理

- ✅ 找不到 Agent 时显示错误
- ✅ API 调用失败时显示错误
- ✅ 网络错误处理

---

## 🧪 测试建议

### 测试场景 1: 基本编辑功能

1. 打开 CLI Agent 详情页
2. 点击 Edit 按钮
3. 修改配置（如 Arguments）
4. 点击保存
5. 验证：配置已更新，弹框关闭

### 测试场景 2: 环境变量编辑

1. 点击 Edit 按钮
2. 添加新的环境变量
3. 删除已有环境变量
4. 修改环境变量 key/value
5. 点击保存
6. 验证：环境变量正确更新

### 测试场景 3: 取消编辑

1. 点击 Edit 按钮
2. 修改配置
3. 点击取消
4. 验证：弹框关闭，配置未保存

### 测试场景 4: 并发编辑

1. 打开两个浏览器标签
2. 同时编辑同一个 CLI Agent
3. 验证：后保存的覆盖先保存的（标准行为）

---

## 🔧 技术细节

### 为什么复用 cliCreateForm？

**优点**:

- ✅ 减少代码重复
- ✅ 保持表单逻辑一致
- ✅ 减少维护成本
- ✅ 自动继承所有验证规则

**缺点**:

- ⚠️ 编辑和创建共用同一个 form 状态
- ⚠️ 不能同时编辑和创建（但这是合理的限制）

### 为什么 Agent ID 不可修改？

**原因**:

- Agent ID 用作目录名（`cli-agents/{agentId}/`）
- 修改 ID 会导致目录不一致
- 修改 ID 需要迁移文件系统，复杂度高

**如果确实需要修改**:

1. 删除旧的 CLI Agent
2. 创建新的 CLI Agent
3. 手动迁移工作空间文件

---

## 📝 注意事项

### 1. 不支持修改的内容

- ❌ Agent ID（系统标识符）
- ❌ CLI Type（类型标识）

### 2. 默认值处理

- `idleTimeout` 固定为 600 秒（默认值）
- 后端 `cliAgents.update` 可能不支持更新所有字段

### 3. 环境变量格式转换

```typescript
// 后端格式：Record<string, string>
{ "KEY1": "value1", "KEY2": "value2" }

// 前端格式：Array<{ key, value }>
[
  { key: "KEY1", value: "value1" },
  { key: "KEY2", value: "value2" }
]
```

---

## 🚀 后续优化建议

### 1. 支持修改 Agent ID

```typescript
// 需要实现目录迁移逻辑
async function migrateCliAgentWorkspace(oldId: string, newId: string) {
  const oldDir = resolveCliAgentWorkspaceDir(oldId);
  const newDir = resolveCliAgentWorkspaceDir(newId);
  await fs.rename(oldDir, newDir);
}
```

### 2. 添加修改历史记录

```typescript
type CliAgentAuditLog = {
  timestamp: number;
  action: "create" | "update" | "delete";
  changes?: Record<string, { old: unknown; new: unknown }>;
  operator: string;
};
```

### 3. 批量编辑

```typescript
// 支持同时修改多个 CLI Agent 的配置
// 例如：批量更新 timeout、批量添加环境变量等
```

---

## 🐛 BUG 修复历史

### BUG #1: 点击 Edit 按钮后弹框显示缓慢或不显示

**发现时间**: 2026-03-14

**问题描述**:
用户点击 Edit 按钮后，编辑弹框出现缓慢或根本不显示。

**根本原因**:

1. `AgentsState` 类型缺少 `agentCliCreateForm` 字段定义
2. 函数中使用错误的字段名 `state.cliCreateForm`，应该是 `state.agentCliCreateForm`
3. 字段名在多个文件中不一致

**修复详情**: 参见 `cli-agent-edit-bug-fixes.md`

**修复文件**:

- ✅ `ui/src/ui/controllers/agents.ts` - 添加类型定义，修正字段名

**修复代码示例**:

```typescript
// ❌ 修复前
export type AgentsState = {
  agentCliCreateBusy?: boolean;
  agentCliCreateError?: string | null;
  // 缺少 agentCliCreateForm
};

export function showCliEditDialog(state: AgentsState, agentId: string): void {
  state.cliCreateForm = { ... };  // ❌ 字段不存在
  state.showCliEditDialog = true;  // ❌ 字段不存在
}

// ✅ 修复后
export type AgentsState = {
  agentCliCreateBusy?: boolean;
  agentCliCreateError?: string | null;
  agentCliCreateForm?: CliAgentCreateForm;  // ✅ 添加
  agentShowCliCreateDialog?: boolean;       // ✅ 添加
  agentShowAddMenu?: boolean;               // ✅ 添加
  agentShowCliEditDialog?: boolean;         // ✅ 添加
  agentCliEditAgentId?: string | null;      // ✅ 添加
};

export function showCliEditDialog(state: AgentsState, agentId: string): void {
  state.agentCliCreateForm = { ... };        // ✅ 正确
  state.agentShowCliEditDialog = true;       // ✅ 正确
}
```

**验证**: ✅ 通过 lint 检查

---

**实现完成时间**: 2026-03-14  
**实现者**: CodeBuddy AI  
**验证状态**: ✅ 通过 lint 检查，BUG 已修复，待功能测试
