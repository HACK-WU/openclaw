# 通用 Agent 创建对话框实现方案（修订版）

## 概述

本文档基于 `create-agent-dialog-design.md` 设计文档，提供详细的实现方案。
**修订说明**：经过代码库兼容性评估，移除了已存在的功能和不需要的新增 API，专注于 UI 层增强。

---

## 1. 代码架构概览

### 1.1 核心文件结构

```
ui/src/ui/
├── views/
│   └── agents.ts              # Agent 视图层（主要修改）
├── controllers/
│   └── agents.ts              # Agent 控制器（已存在，无需修改）
└── i18n/locales/
    ├── zh-CN.ts               # 简体中文
    ├── en.ts                  # 英文
    └── zh-TW.ts               # 繁体中文

src/
├── gateway/server-methods/
│   └── agents.ts              # Agent Gateway RPC（已存在，无需修改）
├── agents/
│   └── agent-id-validation.ts # Agent ID 验证（已存在 canAutoGenerateAgentId）
└── infra/
    ├── home-dir.ts            # 路径展开（已存在 expandHomePrefix）
    └── path-alias-guards.ts   # 路径守卫（已存在）
```

### 1.2 现有功能（无需修改）

| 功能 | 文件位置 | 状态 |
|------|---------|------|
| `canAutoGenerateAgentId()` | `src/agents/agent-id-validation.ts:38-43` | ✅ 已存在 |
| `agents.create` RPC | `src/gateway/server-methods/agents.ts:503-564` | ✅ 已支持 name 字段 |
| Identity Name 显示 | `ui/src/ui/views/agents.ts:1112-1117` | ✅ 已正确处理优先级 |
| `expandHomePrefix()` | `src/infra/home-dir.ts:60-77` | ✅ 已存在 |
| `resolveUserPath()` | `src/utils.ts` | ✅ 已存在 |

### 1.3 数据流

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              UI Layer                                        │
│  agents.ts (views)                                                           │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │ Name Input      │───▶│ Agent ID Auto   │───▶│ Workspace Path  │         │
│  │                 │    │ Fill Logic      │    │ Validation      │         │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘         │
│           │                      │                      │                   │
│           └──────────────────────┴──────────────────────┘                   │
│                                  │                                          │
│                                  ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │  Existing: createAgent() in controllers/agents.ts               │       │
│  └─────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ RPC Call (agents.create)
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Backend Layer                                   │
│  agents.ts (Gateway) - 已存在                                                │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │  agents.create                                                   │       │
│  │  - 验证 Agent ID 唯一性 ✅                                        │       │
│  │  - 验证路径安全性 ✅                                              │       │
│  │  - 创建工作空间目录 ✅                                            │       │
│  │  - 保存 Agent 配置 ✅                                             │       │
│  └─────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 实施步骤

### 阶段一：UI 视图层增强

**文件**: `ui/src/ui/views/agents.ts`

#### 2.1 增强 AgentCreateForm 类型

现有类型（第 61-67 行）已包含基本字段，需要扩展以支持验证状态：

```typescript
// 现有类型保持不变，在组件内部状态中添加验证状态
export type AgentCreateForm = {
  name: string;
  agentId: string;
  workspace: string;
  emoji: string;
};
```

#### 2.2 增强 renderCreateAgentDialog 函数

在现有函数（第 1345-1431 行）基础上添加：
1. Agent ID 锁定/解锁功能
2. 工作空间路径状态反馈
3. 更清晰的错误提示

```typescript
function renderCreateAgentDialog(props: AgentsProps) {
  const { createForm, createBusy, createError } = props;
  const nameIsValidId = AGENT_ID_PATTERN.test(createForm.name);
  
  // 计算有效的 Agent ID 值
  const agentIdValue = createForm.agentId || (nameIsValidId ? createForm.name : "");
  
  // 判断 Agent ID 是否被锁定（自动填充状态）
  const agentIdLocked = nameIsValidId && !createForm.agentId;
  
  // 计算路径状态
  const workspacePath = createForm.workspace.trim();
  const pathStatus = getWorkspacePathStatus(workspacePath);
  
  const canSubmit =
    createForm.name.trim().length > 0 &&
    createForm.workspace.trim().length > 0 &&
    agentIdValue.trim().length > 0 &&
    AGENT_ID_PATTERN.test(agentIdValue.trim());

  return html`
    <div class="dialog-overlay" @click=${(e: Event) => {
      e.stopPropagation();
      props.onHideCreateDialog();
    }}>
      <div class="dialog-card" @click=${(e: Event) => e.stopPropagation()}>
        <div class="card-title">Create Agent</div>
        <div class="card-sub">Add a new agent with its own workspace and identity.</div>
        ${createError ? html`<div class="callout danger" style="margin-top: 8px;">${createError}</div>` : nothing}
        <div class="dialog-form">
          <!-- Name 字段 -->
          <label class="field">
            <span>Name <span class="required">*</span></span>
            <input
              type="text"
              .value=${createForm.name}
              placeholder="e.g. researcher"
              ?disabled=${createBusy}
              @input=${(e: Event) => props.onCreateFormChange("name", (e.target as HTMLInputElement).value)}
            />
            <span class="field-hint">可以是中文或英文，将用于 Agent 的显示名称</span>
          </label>
          
          <!-- Agent ID 字段 -->
          <label class="field">
            <span>Agent ID <span class="required">*</span></span>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input
                type="text"
                style="flex: 1;"
                .value=${agentIdValue}
                placeholder="e.g. researcher"
                ?disabled=${createBusy || agentIdLocked}
                @input=${(e: Event) => props.onCreateFormChange("agentId", (e.target as HTMLInputElement).value)}
              />
              ${agentIdLocked ? html`
                <button
                  class="btn btn--sm"
                  title="解锁编辑"
                  @click=${() => props.onCreateFormChange("agentId", "")}
                >🔒</button>
              ` : nothing}
            </div>
            ${
              !nameIsValidId && createForm.name.trim().length > 0
                ? html`
                    <span class="field-hint" style="color: var(--warning)"
                      >⚠️ 名称包含特殊字符，请手动指定 Agent ID（仅限字母、数字、下划线）</span
                    >
                  `
                : html`
                    <span class="field-hint">仅限字母、数字、下划线 [a-zA-Z0-9_]</span>
                  `
            }
          </label>
          
          <!-- Workspace Path 字段 -->
          <label class="field">
            <span>Workspace Path <span class="required">*</span></span>
            <input
              type="text"
              .value=${createForm.workspace}
              placeholder="e.g. ~/agents/researcher"
              ?disabled=${createBusy}
              @input=${(e: Event) => props.onCreateFormChange("workspace", (e.target as HTMLInputElement).value)}
            />
            <span class="field-hint">
              ${pathStatus === 'will-create' 
                ? 'ℹ️ 路径不存在，将会自动创建该目录'
                : '工作空间目录，支持 ~ 展开为用户主目录'}
            </span>
          </label>
          
          <!-- Emoji 字段 -->
          <label class="field">
            <span>Emoji (optional)</span>
            <input
              type="text"
              .value=${createForm.emoji}
              placeholder="e.g. 🔬"
              ?disabled=${createBusy}
              @input=${(e: Event) => props.onCreateFormChange("emoji", (e.target as HTMLInputElement).value)}
            />
          </label>
        </div>
        <div class="row" style="justify-content: flex-end; gap: 8px; margin-top: 16px;">
          <button class="btn btn--sm" ?disabled=${createBusy} @click=${props.onHideCreateDialog}>
            Cancel
          </button>
          <button
            class="btn btn--sm primary"
            ?disabled=${!canSubmit || createBusy}
            @click=${props.onCreateAgent}
          >
            ${createBusy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  `;
}

// 辅助函数：判断工作空间路径状态（UI 层简单判断）
function getWorkspacePathStatus(path: string): 'empty' | 'valid' | 'will-create' {
  if (!path || !path.trim()) {
    return 'empty';
  }
  // 实际路径验证在后端 agents.create 中进行
  // UI 层只做简单的存在性提示
  return 'will-create';
}
```

---

### 阶段二：国际化

#### 2.3 添加中文翻译

**文件**: `ui/src/ui/i18n/locales/zh-CN.ts`

在现有翻译对象末尾添加：

```typescript
  // Agent 创建对话框
  "agent.create.name.hint": "可以是中文或英文，将用于 Agent 的显示名称",
  "agent.create.agentId.locked": "已锁定（自动填充）",
  "agent.create.agentId.unlock": "点击解锁手动编辑",
  "agent.create.workspace.willCreate": "路径不存在，将会自动创建该目录",
```

#### 2.4 添加英文翻译

**文件**: `ui/src/ui/i18n/locales/en.ts`

在现有翻译对象末尾添加：

```typescript
  // Agent Create Dialog
  "agent.create.name.hint": "Can be Chinese or English, used as the agent's display name",
  "agent.create.agentId.locked": "Locked (auto-filled)",
  "agent.create.agentId.unlock": "Click to unlock for manual editing",
  "agent.create.workspace.willCreate": "Path does not exist, directory will be created automatically",
```

#### 2.5 添加繁体中文翻译

**文件**: `ui/src/ui/i18n/locales/zh-TW.ts`

在现有翻译对象末尾添加：

```typescript
  // Agent 建立對話框
  "agent.create.name.hint": "可以是中文或英文，將用於 Agent 的顯示名稱",
  "agent.create.agentId.locked": "已鎖定（自動填入）",
  "agent.create.agentId.unlock": "點擊解鎖手動編輯",
  "agent.create.workspace.willCreate": "路徑不存在，將會自動建立該目錄",
```

---

## 3. 文件修改清单

| 文件路径 | 修改类型 | 说明 |
|---------|---------|------|
| `ui/src/ui/views/agents.ts` | **修改** | 增强 renderCreateAgentDialog 函数 |
| `ui/src/ui/i18n/locales/zh-CN.ts` | 修改 | 添加中文翻译 |
| `ui/src/ui/i18n/locales/en.ts` | 修改 | 添加英文翻译 |
| `ui/src/ui/i18n/locales/zh-TW.ts` | 修改 | 添加繁体中文翻译 |

**已移除的修改项（已存在或不需要）**:
- ~~`src/utils/path-validator.ts`~~ - 复用现有基础设施
- ~~`src/agents/agent-id-validation.ts`~~ - canAutoGenerateAgentId 已存在
- ~~`src/gateway/server-methods/agents.ts` 新增 API~~ - agents.create 已支持
- ~~`ui/src/ui/controllers/agents.ts`~~ - 无需修改
- ~~Overview 页面修复~~ - Identity Name 显示已正确

---

## 4. 兼容性考虑

### 4.1 向后兼容

- 现有 Agent 配置中的 `name` 字段可能不存在，后端已处理默认值
- `agent.identity.name` 优先级在后端已正确处理
- 路径验证在后端 `agents.create` 中进行，对现有 Agent 无影响

### 4.2 平台兼容

- 路径验证在后端使用 `resolveUserPath()` 和 `expandHomePrefix()`
- 支持所有平台（Linux、macOS、Windows）

---

## 5. 注意事项

1. **路径展开**: 使用后端已有的 `resolveUserPath()` 函数处理 `~` 展开
2. **Agent ID 验证**: 使用已有的 `AGENT_ID_PATTERN` 正则表达式
3. **错误处理**: 后端 `agents.create` 返回详细错误信息，UI 直接显示
4. **国际化**: 新增翻译 key 需要添加到所有语言文件

---

## 6. 测试计划

### 6.1 手动测试用例

| 场景 | 操作 | 预期结果 |
|------|------|---------|
| 英文名称 | 输入 "researcher" | Agent ID 自动填充为 "researcher"，显示锁定图标 |
| 中文名称 | 输入 "研究员" | Agent ID 不自动填充，显示警告提示 |
| 特殊字符名称 | 输入 "my-agent" | Agent ID 不自动填充，显示警告提示 |
| 解锁编辑 | 点击锁定图标 | Agent ID 字段变为可编辑 |
| 创建 Agent | 填写所有必填字段后点击创建 | 成功创建，跳转到新 Agent |

### 6.2 后端验证测试

后端 `agents.create` 已包含以下验证（无需额外测试）：
- Agent ID 格式验证
- Agent ID 唯一性验证
- 路径安全性验证
- 工作空间创建