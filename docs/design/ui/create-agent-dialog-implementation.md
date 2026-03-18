# 通用 Agent 创建对话框实现方案

## 概述

本文档基于 `create-agent-dialog-design.md` 设计文档，提供详细的实现方案。涉及 UI 层、后端 API、工具函数和国际化等多个模块的修改。

---

## 1. 代码架构概览

### 1.1 核心文件结构

```
ui/src/ui/
├── views/
│   └── agents.ts              # Agent 视图层（主要修改）
├── controllers/
│   └── agents.ts              # Agent 控制器
└── i18n/locales/
    ├── zh-CN.ts               # 简体中文
    ├── en.ts                  # 英文
    └── zh-TW.ts               # 繁体中文

src/
├── gateway/server-methods/
│   ├── agents.ts              # Agent Gateway RPC
│   └── cli-agents.ts          # CLI Agent Gateway RPC
├── agents/
│   ├── agent-id-validation.ts # Agent ID 验证（已存在）
│   └── workspace.ts           # 工作空间管理
├── infra/
│   ├── fs-safe.ts             # 安全文件操作
│   └── path-guards.ts         # 路径守卫
└── utils/
    └── path-validator.ts      # 新增：路径验证工具
```

### 1.2 数据流

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              UI Layer                                        │
│  agents.ts                                                                   │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │ Name Input      │───▶│ Agent ID Auto   │───▶│ Workspace Path  │         │
│  │                 │    │ Fill Logic      │    │ Validation      │         │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘         │
│           │                      │                      │                   │
│           ▼                      ▼                      ▼                   │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │                     agents.ts (Controller)                       │       │
│  │  - createAgent()                                                 │       │
│  │  - validatePath()                                                │       │
│  └─────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ RPC Call
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Backend Layer                                   │
│  agents.ts (Gateway)                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │  agents.create                                                   │       │
│  │  - 验证 Agent ID 唯一性                                          │       │
│  │  - 验证路径安全性                                                │       │
│  │  - 创建工作空间目录                                              │       │
│  │  - 保存 Agent 配置                                               │       │
│  └─────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 实施步骤

### 阶段一：基础设施（工具函数）

#### 2.1 新增路径验证工具

**文件**: `src/utils/path-validator.ts`

```typescript
/**
 * 路径验证工具
 * 用于验证用户输入的工作空间路径是否安全
 */

import { platform, homedir } from "os";
import { resolve, normalize, sep } from "path";
import { existsSync, statSync } from "fs";

// Linux/Unix 系统核心目录
const RESTRICTED_DIRECTORIES: string[] = [
  // 根目录
  "/",

  // 系统核心目录 (Linux)
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib32",
  "/lib64",
  "/libx32",
  "/proc",
  "/run",
  "/sbin",
  "/srv",
  "/sys",
  "/usr",
  "/var",

  // 系统核心目录 (macOS)
  "/System",
  "/Library",
  "/Users/Shared",
  "/private",
  "/.Spotlight-V100",
  "/.fseventsd",
  "/Volumes",
  "/Network",
];

// 谨慎处理的目录（允许但警告）
const CAUTION_DIRECTORIES: string[] = ["/opt", "/usr/local"];

// 仅完全匹配受限的目录（子目录允许）
const RESTRICTED_EXACT_MATCH: string[] = ["/root"];

// 用户敏感目录（仅匹配目录本身）
const USER_SENSITIVE_DIRECTORIES: string[] = ["~/.ssh", "~/.gnupg"];

export interface PathValidationResult {
  valid: boolean;
  exists: boolean;
  isDirectory: boolean;
  isRestricted: boolean;
  needsCreation: boolean;
  error?: string;
  warning?: string;
}

/**
 * 展开 ~ 为用户主目录
 */
export function expandTilde(inputPath: string): string {
  if (inputPath.startsWith("~/")) {
    return join(homedir(), inputPath.slice(2));
  }
  if (inputPath === "~") {
    return homedir();
  }
  return inputPath;
}

/**
 * 检查路径是否为受保护目录
 */
export function isRestrictedDirectory(inputPath: string): boolean {
  const expanded = expandTilde(inputPath);
  const resolved = resolve(normalize(expanded));
  const home = homedir();

  // 1. 检查完全匹配受限列表
  for (const restricted of RESTRICTED_EXACT_MATCH) {
    if (resolved === restricted) {
      return true;
    }
  }

  // 2. 检查普通受限目录（完全匹配或子目录）
  for (const restricted of RESTRICTED_DIRECTORIES) {
    if (resolved === restricted || resolved.startsWith(restricted + sep)) {
      return true;
    }
  }

  // 3. 检查用户敏感目录（展开 ~ 后比较）
  for (const sensitive of USER_SENSITIVE_DIRECTORIES) {
    const expandedSensitive = expandTilde(sensitive);
    const resolvedSensitive = resolve(expandedSensitive);
    if (resolved === resolvedSensitive || resolved.startsWith(resolvedSensitive + sep)) {
      return true;
    }
  }

  return false;
}

/**
 * 检查路径是否为警告目录
 */
export function isCautionDirectory(inputPath: string): boolean {
  const resolved = resolve(normalize(expandTilde(inputPath)));

  for (const caution of CAUTION_DIRECTORIES) {
    if (resolved === caution || resolved.startsWith(caution + sep)) {
      return true;
    }
  }

  return false;
}

/**
 * 验证工作空间路径
 */
export function validateWorkspacePath(inputPath: string): PathValidationResult {
  // 1. 空路径检查
  if (!inputPath || !inputPath.trim()) {
    return {
      valid: false,
      exists: false,
      isDirectory: false,
      isRestricted: false,
      needsCreation: false,
      error: "agent.create.workspace.error.required",
    };
  }

  // 2. 展开并规范化路径
  const expanded = expandTilde(inputPath);
  const resolved = resolve(normalize(expanded));

  // 3. 检查受保护目录
  if (isRestrictedDirectory(resolved)) {
    return {
      valid: false,
      exists: false,
      isDirectory: false,
      isRestricted: true,
      needsCreation: false,
      error: "agent.create.workspace.error.forbidden",
    };
  }

  // 4. 检查路径是否存在
  try {
    const stats = statSync(resolved);
    if (stats.isDirectory()) {
      // 路径存在且是目录
      const result: PathValidationResult = {
        valid: true,
        exists: true,
        isDirectory: true,
        isRestricted: false,
        needsCreation: false,
      };

      // 检查警告目录
      if (isCautionDirectory(resolved)) {
        result.warning = "agent.create.workspace.warning.caution";
      }

      return result;
    } else {
      // 路径存在但不是目录
      return {
        valid: false,
        exists: true,
        isDirectory: false,
        isRestricted: false,
        needsCreation: false,
        error: "agent.create.workspace.error.notDirectory",
      };
    }
  } catch {
    // 5. 路径不存在，检查父目录
    const parentDir = dirname(resolved);
    try {
      const parentStats = statSync(parentDir);
      if (parentStats.isDirectory()) {
        // 父目录存在，可以创建
        return {
          valid: true,
          exists: false,
          isDirectory: false,
          isRestricted: false,
          needsCreation: true,
          warning: "agent.create.workspace.autoCreate",
        };
      }
    } catch {
      // 父目录也不存在
      return {
        valid: false,
        exists: false,
        isDirectory: false,
        isRestricted: false,
        needsCreation: false,
        error: "agent.create.workspace.error.parentNotFound",
      };
    }
  }

  return {
    valid: true,
    exists: false,
    isDirectory: false,
    isRestricted: false,
    needsCreation: true,
    warning: "agent.create.workspace.autoCreate",
  };
}

/**
 * 获取安全的目录名
 * 将名称转换为可用于文件系统的安全目录名
 */
export function sanitizeDirName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, "_") // Windows 不允许的字符
    .replace(/\s+/g, "_") // 空格替换为下划线
    .replace(/\.+/g, "_") // 多个点替换为下划线
    .substring(0, 50); // 长度限制
}

// 辅助函数：避免顶层 import
function join(...paths: string[]): string {
  return paths.join(sep).replace(new RegExp(`\\${sep}+`, "g"), sep);
}

function dirname(p: string): string {
  const parts = p.split(sep);
  parts.pop();
  return parts.join(sep) || sep;
}
```

#### 2.2 扩展 Agent ID 验证工具

**文件**: `src/agents/agent-id-validation.ts` (已存在，需扩展)

```typescript
// 现有代码保持不变，新增以下函数：

/**
 * 检查名称是否可用作 Agent ID
 * 仅包含字母、数字、下划线时可自动填充
 */
export function canAutoGenerateAgentId(name: string): boolean {
  if (!name || name.trim() === "") return false;
  return AGENT_ID_PATTERN.test(name);
}

/**
 * 尝试从名称生成 Agent ID
 * 如果名称符合格式，返回名称本身
 * 否则返回 null，需要用户手动输入
 */
export function tryGenerateAgentIdFromName(name: string): string | null {
  if (canAutoGenerateAgentId(name)) {
    return name;
  }
  return null;
}
```

---

### 阶段二：后端 API 扩展

#### 2.3 新增路径检测 API

**文件**: `src/gateway/server-methods/agents.ts`

在现有文件中添加新的 RPC 方法：

```typescript
// 在文件末尾添加

/**
 * 检测工作空间路径
 */
server.method(
  "agents.checkWorkspacePath",
  async (ctx: GatewayContext, params: { path: string }) => {
    const { path } = params;

    if (!path || !path.trim()) {
      return {
        valid: false,
        error: "agent.create.workspace.error.required",
      };
    }

    return validateWorkspacePath(path);
  },
);

/**
 * 获取默认工作空间路径建议
 */
server.method(
  "agents.getDefaultWorkspacePath",
  async (ctx: GatewayContext, params: { name?: string }) => {
    const { name } = params;

    // 获取当前默认 Agent 的工作空间
    const defaultAgent = await agentStore.getDefaultAgent();
    const currentWorkspace = defaultAgent?.workspace || homedir();
    const parentDir = dirname(currentWorkspace);

    // 生成目录名
    const dirName = name ? sanitizeDirName(name) : "new-agent";

    return {
      path: join(parentDir, dirName),
    };
  },
);
```

#### 2.4 修改 Agent 创建 API

**文件**: `src/gateway/server-methods/agents.ts`

修改 `agents.create` 方法，添加 `name` 字段支持：

```typescript
server.method("agents.create", async (ctx: GatewayContext, params: CreateAgentParams) => {
  const { id, name, workspace, emoji } = params;

  // 1. 验证 Agent ID
  const idValidation = validateAgentId(id);
  if (!idValidation.valid) {
    throw new Error(idValidation.error);
  }

  // 2. 验证 Agent ID 唯一性
  const existing = await agentStore.getAgent(id);
  if (existing) {
    throw new Error(`Agent with ID "${id}" already exists`);
  }

  // 3. 验证工作空间路径
  const pathValidation = validateWorkspacePath(workspace);
  if (!pathValidation.valid) {
    throw new Error(pathValidation.error);
  }

  // 4. 创建工作空间目录（如果不存在）
  if (pathValidation.needsCreation) {
    await fs.ensureDir(expandTilde(workspace));
  }

  // 5. 创建 Agent 配置
  const agentConfig: AgentConfig = {
    id,
    name: name || id, // 使用 name，默认为 id
    workspace: resolve(expandTilde(workspace)),
    identity: {
      name: name || id, // Identity Name 使用 name 字段
      emoji: emoji,
    },
    // ... 其他默认配置
  };

  // 6. 保存 Agent
  await agentStore.saveAgent(agentConfig);

  return { success: true, agent: agentConfig };
});
```

---

### 阶段三：前端 UI 实现

#### 2.5 修改 Agent 控制器

**文件**: `ui/src/ui/controllers/agents.ts`

```typescript
// 扩展 createAgent 方法参数
export interface CreateAgentParams {
  id: string;
  name: string;      // 新增：用户显示名称
  workspace: string;
  emoji?: string;
}

// 新增：路径检测方法
async checkWorkspacePath(path: string): Promise<PathValidationResult> {
  const result = await this.gateway.call('agents.checkWorkspacePath', { path });
  return result;
}

// 新增：获取默认工作空间路径
async getDefaultWorkspacePath(name?: string): Promise<string> {
  const result = await this.gateway.call('agents.getDefaultWorkspacePath', { name });
  return result.path;
}

// 修改：创建 Agent
async createAgent(params: CreateAgentParams): Promise<AgentConfig> {
  const result = await this.gateway.call('agents.create', params);
  if (result.success) {
    await this.loadAgents();
    return result.agent;
  }
  throw new Error(result.error || 'Failed to create agent');
}
```

#### 2.6 修改 Agent 视图

**文件**: `ui/src/ui/views/agents.ts`

##### 2.6.1 新增类型定义

```typescript
// 在文件顶部添加

interface AgentCreateFormState {
  name: string;
  agentId: string;
  workspacePath: string;
  emoji: string;

  // 验证状态
  nameError?: string;
  agentIdError?: string;
  workspacePathError?: string;
  workspacePathWarning?: string;
  workspacePathStatus: "initial" | "valid" | "info" | "error";

  // UI 状态
  agentIdLocked: boolean; // Agent ID 是否被锁定（自动填充状态）
  isCheckingPath: boolean; // 是否正在检测路径
  canCreate: boolean; // 是否可以创建
}
```

##### 2.6.2 修改对话框渲染函数

```typescript
// renderCreateAgentDialog 函数重写

renderCreateAgentDialog(): TemplateResult {
  const t = this.t;
  const state = this.createFormState;

  return html`
    <div class="dialog-overlay" @click=${this.closeCreateDialog}>
      <div class="dialog create-agent-dialog" @click=${(e: Event) => e.stopPropagation()}>
        <div class="dialog-header">
          <h2>${t('agent.create.title')}</h2>
          <p class="dialog-subtitle">${t('agent.create.subtitle')}</p>
        </div>

        <div class="dialog-body">
          ${this.renderNameField()}
          ${this.renderAgentIdField()}
          ${this.renderWorkspacePathField()}
          ${this.renderEmojiField()}
        </div>

        <div class="dialog-footer">
          <button class="btn btn-secondary" @click=${this.closeCreateDialog}>
            ${t('agent.create.button.cancel')}
          </button>
          <button
            class="btn btn-primary"
            ?disabled=${!state.canCreate}
            @click=${this.handleCreateAgent}
          >
            ${t('agent.create.button.create')}
          </button>
        </div>
      </div>
    </div>
  `;
}
```

##### 2.6.3 实现 Name 字段

```typescript
renderNameField(): TemplateResult {
  const t = this.t;
  const state = this.createFormState;

  return html`
    <div class="form-field">
      <label class="form-label">${t('agent.create.name.label')}</label>
      <input
        type="text"
        class="form-input ${state.nameError ? 'error' : ''}"
        placeholder=${t('agent.create.name.placeholder')}
        .value=${state.name}
        @input=${this.handleNameInput}
        maxlength="50"
      />
      <div class="form-hint">${t('agent.create.name.hint')}</div>
      ${state.nameError ? html`
        <div class="form-error">${t(state.nameError)}</div>
      ` : ''}
    </div>
  `;
}

// Name 输入处理
private handleNameInput(e: InputEvent): void {
  const input = e.target as HTMLInputElement;
  const name = input.value;

  this.createFormState.name = name;

  // 清除错误
  this.createFormState.nameError = undefined;

  // 自动填充 Agent ID
  if (canAutoGenerateAgentId(name)) {
    this.createFormState.agentId = name;
    this.createFormState.agentIdLocked = true;
  } else if (name && !this.createFormState.agentIdLocked) {
    // 名称不符合格式，清空 Agent ID
    this.createFormState.agentId = '';
    this.createFormState.agentIdLocked = false;
  }

  // 更新工作空间路径建议
  this.updateWorkspacePathSuggestion(name);

  // 验证表单
  this.validateForm();
}
```

##### 2.6.4 实现 Agent ID 字段

```typescript
renderAgentIdField(): TemplateResult {
  const t = this.t;
  const state = this.createFormState;

  return html`
    <div class="form-field">
      <label class="form-label">${t('agent.create.agentId.label')}</label>
      <div class="input-with-action">
        <input
          type="text"
          class="form-input ${state.agentIdError ? 'error' : ''}"
          placeholder=${t('agent.create.agentId.placeholder')}
          .value=${state.agentId}
          ?readonly=${state.agentIdLocked}
          @input=${this.handleAgentIdInput}
          maxlength="50"
          pattern="[a-zA-Z0-9_]+"
        />
        ${state.agentIdLocked ? html`
          <button
            class="btn-icon"
            title="解锁编辑"
            @click=${this.unlockAgentId}
          >
            🔒
          </button>
        ` : ''}
      </div>
      <div class="form-hint">${t('agent.create.agentId.hint')}</div>
      ${state.agentIdError ? html`
        <div class="form-error">${t(state.agentIdError)}</div>
      ` : !state.agentIdLocked && state.name && !canAutoGenerateAgentId(state.name) ? html`
        <div class="form-warning">
          ⚠️ ${t('agent.create.agentId.warning.manual')}
        </div>
      ` : ''}
    </div>
  `;
}

// Agent ID 输入处理
private handleAgentIdInput(e: InputEvent): void {
  const input = e.target as HTMLInputElement;
  // 只允许输入字母、数字、下划线
  const value = input.value.replace(/[^a-zA-Z0-9_]/g, '');

  this.createFormState.agentId = value;
  this.createFormState.agentIdLocked = false;

  // 验证 Agent ID
  this.validateAgentId();
  this.validateForm();
}

// 解锁 Agent ID 编辑
private unlockAgentId(): void {
  this.createFormState.agentIdLocked = false;
  this.requestUpdate();
}
```

##### 2.6.5 实现 Workspace Path 字段

```typescript
renderWorkspacePathField(): TemplateResult {
  const t = this.t;
  const state = this.createFormState;

  const statusClass = {
    'initial': '',
    'valid': 'valid',
    'info': 'info',
    'error': 'error',
  }[state.workspacePathStatus];

  const statusIcon = {
    'initial': '',
    'valid': '✅',
    'info': 'ℹ️',
    'error': '❌',
  }[state.workspacePathStatus];

  return html`
    <div class="form-field">
      <label class="form-label">${t('agent.create.workspace.label')}</label>
      <div class="input-with-icon">
        <input
          type="text"
          class="form-input ${statusClass}"
          placeholder=${t('agent.create.workspace.placeholder')}
          .value=${state.workspacePath}
          @input=${this.handleWorkspacePathInput}
          @blur=${this.handleWorkspacePathBlur}
          @keydown=${this.handleWorkspacePathKeydown}
        />
        ${statusIcon ? html`
          <span class="input-icon ${statusClass}">${statusIcon}</span>
        ` : ''}
      </div>

      ${state.isCheckingPath ? html`
        <div class="form-hint loading">检测中...</div>
      ` : state.workspacePathError ? html`
        <div class="form-error">${t(state.workspacePathError)}</div>
      ` : state.workspacePathWarning ? html`
        <div class="form-hint info">${t(state.workspacePathWarning)}</div>
      ` : html`
        <div class="form-hint">${t('agent.create.workspace.hint')}</div>
      `}
    </div>
  `;
}

// 工作空间路径输入处理（防抖）
private workspacePathDebounceTimer?: number;

private handleWorkspacePathInput(e: InputEvent): void {
  const input = e.target as HTMLInputElement;
  this.createFormState.workspacePath = input.value;

  // 重置状态
  this.createFormState.workspacePathStatus = 'initial';
  this.createFormState.workspacePathError = undefined;
  this.createFormState.workspacePathWarning = undefined;

  // 防抖检测
  clearTimeout(this.workspacePathDebounceTimer);
  this.workspacePathDebounceTimer = window.setTimeout(() => {
    this.checkWorkspacePath();
  }, 500);

  this.validateForm();
}

// 失去焦点时立即检测
private handleWorkspacePathBlur(): void {
  clearTimeout(this.workspacePathDebounceTimer);
  this.checkWorkspacePath();
}

// 回车时立即检测
private handleWorkspacePathKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(this.workspacePathDebounceTimer);
    this.checkWorkspacePath();
  }
}

// 路径检测
private async checkWorkspacePath(): Promise<void> {
  const path = this.createFormState.workspacePath;

  if (!path || !path.trim()) {
    this.createFormState.workspacePathStatus = 'initial';
    this.createFormState.workspacePathError = undefined;
    this.createFormState.workspacePathWarning = undefined;
    this.validateForm();
    return;
  }

  this.createFormState.isCheckingPath = true;
  this.requestUpdate();

  try {
    const result = await this.agentsController.checkWorkspacePath(path);

    this.createFormState.isCheckingPath = false;

    if (result.isRestricted) {
      this.createFormState.workspacePathStatus = 'error';
      this.createFormState.workspacePathError = result.error;
    } else if (!result.valid) {
      this.createFormState.workspacePathStatus = 'error';
      this.createFormState.workspacePathError = result.error;
    } else if (result.needsCreation) {
      this.createFormState.workspacePathStatus = 'info';
      this.createFormState.workspacePathWarning = result.warning;
    } else {
      this.createFormState.workspacePathStatus = 'valid';
      this.createFormState.workspacePathWarning = result.warning;
    }

    this.validateForm();
  } catch (error) {
    this.createFormState.isCheckingPath = false;
    this.createFormState.workspacePathStatus = 'error';
    this.createFormState.workspacePathError = 'agent.create.workspace.error.checkFailed';
    this.validateForm();
  }
}

// 更新工作空间路径建议
private async updateWorkspacePathSuggestion(name: string): Promise<void> {
  if (!this.createFormState.workspacePath || this.createFormState.workspacePathStatus === 'initial') {
    const suggestedPath = await this.agentsController.getDefaultWorkspacePath(name);
    this.createFormState.workspacePath = suggestedPath;
    // 自动触发路径检测
    this.checkWorkspacePath();
  }
}
```

##### 2.6.6 表单验证逻辑

```typescript
// 验证 Agent ID
private validateAgentId(): void {
  const agentId = this.createFormState.agentId;

  if (!agentId || !agentId.trim()) {
    this.createFormState.agentIdError = 'agent.create.error.required';
    return;
  }

  if (!AGENT_ID_PATTERN.test(agentId)) {
    this.createFormState.agentIdError = 'agent.create.agentId.error.invalid';
    return;
  }

  if (agentId.length > 50) {
    this.createFormState.agentIdError = 'agent.create.error.tooLong';
    return;
  }

  // 检查是否已存在（异步）
  this.checkAgentIdUniqueness(agentId);
}

// 检查 Agent ID 唯一性
private async checkAgentIdUniqueness(agentId: string): Promise<void> {
  const existing = this.agents.find(a => a.id === agentId);
  if (existing) {
    this.createFormState.agentIdError = 'agent.create.agentId.error.alreadyExists';
    this.validateForm();
  } else {
    this.createFormState.agentIdError = undefined;
    this.validateForm();
  }
}

// 验证整个表单
private validateForm(): void {
  const state = this.createFormState;

  // 检查必填字段
  const hasName = state.name && state.name.trim().length > 0;
  const hasAgentId = state.agentId && state.agentId.trim().length > 0;
  const hasWorkspace = state.workspacePath && state.workspacePath.trim().length > 0;

  // 检查错误状态
  const hasErrors =
    state.nameError ||
    state.agentIdError ||
    state.workspacePathError;

  // 检查路径状态
  const pathValid =
    state.workspacePathStatus === 'valid' ||
    state.workspacePathStatus === 'info';

  state.canCreate = hasName && hasAgentId && hasWorkspace && !hasErrors && pathValid;

  this.requestUpdate();
}
```

##### 2.6.7 创建 Agent

```typescript
// 创建 Agent
private async handleCreateAgent(): Promise<void> {
  if (!this.createFormState.canCreate) return;

  try {
    const agent = await this.agentsController.createAgent({
      id: this.createFormState.agentId,
      name: this.createFormState.name,
      workspace: this.createFormState.workspacePath,
      emoji: this.createFormState.emoji || undefined,
    });

    // 关闭对话框
    this.closeCreateDialog();

    // 切换到新创建的 Agent
    this.selectAgent(agent.id);

    // 显示成功提示
    this.showSuccessToast(`Agent "${agent.name}" created successfully`);
  } catch (error) {
    this.showErrorToast(error.message);
  }
}
```

##### 2.6.8 初始化表单状态

```typescript
// 打开创建对话框时初始化
private async openCreateDialog(): Promise<void> {
  // 获取默认工作空间路径
  const defaultWorkspacePath = await this.agentsController.getDefaultWorkspacePath();

  this.createFormState = {
    name: '',
    agentId: '',
    workspacePath: defaultWorkspacePath,
    emoji: '',

    nameError: undefined,
    agentIdError: undefined,
    workspacePathError: undefined,
    workspacePathWarning: undefined,
    workspacePathStatus: 'initial',

    agentIdLocked: false,
    isCheckingPath: false,
    canCreate: false,
  };

  this.showCreateDialog = true;
  this.requestUpdate();
}
```

---

### 阶段四：国际化

#### 2.7 添加中文翻译

**文件**: `ui/src/ui/i18n/locales/zh-CN.ts`

```typescript
export const zhCN: TranslationStrings = {
  // ... 现有翻译

  // Agent 创建对话框
  "agent.create.title": "创建 Agent",
  "agent.create.subtitle": "添加一个具有独立工作空间和身份的新 Agent",

  "agent.create.name.label": "名称 *",
  "agent.create.name.placeholder": "例如：researcher",
  "agent.create.name.hint": "可以是中文或英文",

  "agent.create.agentId.label": "Agent ID *",
  "agent.create.agentId.placeholder": "例如：researcher",
  "agent.create.agentId.hint": "仅限字母、数字、下划线 [a-zA-Z0-9_]",
  "agent.create.agentId.warning.manual": "名称不符合 Agent ID 格式，请手动填写",
  "agent.create.agentId.error.invalid": "Agent ID 格式无效",
  "agent.create.agentId.error.alreadyExists": "Agent ID 已存在",

  "agent.create.workspace.label": "工作空间路径 *",
  "agent.create.workspace.placeholder": "例如：~/agents/researcher",
  "agent.create.workspace.hint": "按回车或离开输入框以检测路径",
  "agent.create.workspace.autoCreate": "路径不存在，将会自动创建该目录",
  "agent.create.workspace.warning.caution": "该目录通常用于系统软件，请谨慎操作",
  "agent.create.workspace.error.required": "请输入工作空间路径",
  "agent.create.workspace.error.forbidden": "不能选择系统核心目录",
  "agent.create.workspace.error.restricted": "该目录受保护，请选择其他位置",
  "agent.create.workspace.error.notDirectory": "该路径不是目录",
  "agent.create.workspace.error.parentNotFound": "父目录不存在",
  "agent.create.workspace.error.checkFailed": "路径检测失败",

  "agent.create.emoji.label": "头像（可选）",
  "agent.create.emoji.placeholder": "例如：🔬",

  "agent.create.button.cancel": "取消",
  "agent.create.button.create": "创建",

  "agent.create.error.required": "此字段为必填项",
  "agent.create.error.tooLong": "输入内容过长",
};
```

#### 2.8 添加英文翻译

**文件**: `ui/src/ui/i18n/locales/en.ts`

```typescript
export const en: TranslationStrings = {
  // ... existing translations

  // Agent Create Dialog
  "agent.create.title": "Create Agent",
  "agent.create.subtitle": "Add a new agent with its own workspace and identity.",

  "agent.create.name.label": "Name *",
  "agent.create.name.placeholder": "e.g. researcher",
  "agent.create.name.hint": "Can be Chinese or English",

  "agent.create.agentId.label": "Agent ID *",
  "agent.create.agentId.placeholder": "e.g. researcher",
  "agent.create.agentId.hint": "Only letters, numbers, underscores [a-zA-Z0-9_]",
  "agent.create.agentId.warning.manual":
    "Name does not match Agent ID format, please enter manually",
  "agent.create.agentId.error.invalid": "Invalid Agent ID format",
  "agent.create.agentId.error.alreadyExists": "Agent ID already exists",

  "agent.create.workspace.label": "Workspace Path *",
  "agent.create.workspace.placeholder": "e.g. ~/agents/researcher",
  "agent.create.workspace.hint": "Press Enter or leave input to detect path",
  "agent.create.workspace.autoCreate":
    "Path does not exist, directory will be created automatically",
  "agent.create.workspace.warning.caution":
    "This directory is typically used for system software, proceed with caution",
  "agent.create.workspace.error.required": "Please enter workspace path",
  "agent.create.workspace.error.forbidden": "Cannot select system core directory",
  "agent.create.workspace.error.restricted":
    "This directory is protected, please choose another location",
  "agent.create.workspace.error.notDirectory": "Path is not a directory",
  "agent.create.workspace.error.parentNotFound": "Parent directory does not exist",
  "agent.create.workspace.error.checkFailed": "Path check failed",

  "agent.create.emoji.label": "Emoji (optional)",
  "agent.create.emoji.placeholder": "e.g. 🔬",

  "agent.create.button.cancel": "Cancel",
  "agent.create.button.create": "Create",

  "agent.create.error.required": "This field is required",
  "agent.create.error.tooLong": "Input is too long",
};
```

---

### 阶段五：Overview 页面修复

#### 2.9 修复 Identity Name 显示

**文件**: `ui/src/ui/views/agents.ts`

修改 `renderAgentOverview()` 函数中的 Identity Name 显示：

```typescript
// 在 renderAgentOverview 函数中找到 Identity Name 相关代码

// 原代码可能类似于：
// const identityName = agentIdentity?.name || agent.id;

// 修改为：
const identityName = agent.name || agent.identity?.name || agent.id;

// 确保显示优先级：
// 1. agent.name (创建时指定的名称)
// 2. agent.identity?.name (身份配置中的名称)
// 3. agent.id (最后回退到 ID)
```

完整修改示例：

```typescript
renderAgentOverview(): TemplateResult {
  const agent = this.selectedAgent;
  if (!agent) return html``;

  const t = this.t;

  // Identity Name 优先级
  const identityName = agent.name || agent.identity?.name || agent.id;
  const identityEmoji = agent.emoji || agent.identity?.emoji || '🤖';

  return html`
    <div class="overview-section">
      <h3>${t('agents.overview')}</h3>
      <p class="section-description">
        ${t('agents.overview.description')}
      </p>

      <table class="overview-table">
        <tr>
          <th>Workspace</th>
          <td>${agent.workspace || '-'}</td>
        </tr>
        <tr>
          <th>Primary Model</th>
          <td>${this.renderPrimaryModel(agent)}</td>
        </tr>
        <tr>
          <th>Identity Name</th>
          <td>${identityName}</td>  <!-- 使用正确的 name 字段 -->
        </tr>
        <tr>
          <th>Default</th>
          <td>${agent.default ? 'yes' : 'no'}</td>
        </tr>
        <tr>
          <th>Identity Emoji</th>
          <td>${identityEmoji}</td>
        </tr>
      </table>

      <!-- Skills Filter -->
      <div class="skills-filter-section">
        <label>Skills Filter</label>
        <div class="skills-filter-value">
          ${agent.skills?.join(', ') || 'all skills'}
        </div>
      </div>

      <!-- Model Selection -->
      ${this.renderModelSelection(agent)}
    </div>
  `;
}
```

---

## 3. 测试计划

### 3.1 单元测试

**文件**: `src/utils/path-validator.test.ts`

```typescript
import { describe, it, expect } from "vitest";
import {
  isRestrictedDirectory,
  validateWorkspacePath,
  canAutoGenerateAgentId,
  sanitizeDirName,
} from "./path-validator";

describe("isRestrictedDirectory", () => {
  it("should block root directory", () => {
    expect(isRestrictedDirectory("/")).toBe(true);
  });

  it("should block /etc", () => {
    expect(isRestrictedDirectory("/etc")).toBe(true);
    expect(isRestrictedDirectory("/etc/custom")).toBe(true);
  });

  it("should block /root exactly", () => {
    expect(isRestrictedDirectory("/root")).toBe(true);
  });

  it("should allow /root subdirectories", () => {
    expect(isRestrictedDirectory("/root/my-agent")).toBe(false);
  });

  it("should block macOS system directories", () => {
    expect(isRestrictedDirectory("/System")).toBe(true);
    expect(isRestrictedDirectory("/Library")).toBe(true);
  });

  it("should allow user directories", () => {
    expect(isRestrictedDirectory("~/agents")).toBe(false);
    expect(isRestrictedDirectory("/home/user/workspace")).toBe(false);
  });
});

describe("canAutoGenerateAgentId", () => {
  it("should return true for valid IDs", () => {
    expect(canAutoGenerateAgentId("researcher")).toBe(true);
    expect(canAutoGenerateAgentId("my_agent")).toBe(true);
    expect(canAutoGenerateAgentId("agent123")).toBe(true);
  });

  it("should return false for invalid IDs", () => {
    expect(canAutoGenerateAgentId("研究员")).toBe(false);
    expect(canAutoGenerateAgentId("my-agent")).toBe(false);
    expect(canAutoGenerateAgentId("agent name")).toBe(false);
  });
});

describe("sanitizeDirName", () => {
  it("should replace special characters", () => {
    expect(sanitizeDirName("my agent")).toBe("my_agent");
    expect(sanitizeDirName("agent<test>")).toBe("agent_test_");
  });

  it("should limit length", () => {
    const longName = "a".repeat(100);
    expect(sanitizeDirName(longName).length).toBe(50);
  });
});
```

### 3.2 集成测试

```typescript
describe("Agent Create Dialog", () => {
  it("should auto-fill Agent ID when name is valid", async () => {
    // 测试自动填充逻辑
  });

  it("should clear Agent ID when name contains Chinese", async () => {
    // 测试中文名称处理
  });

  it("should validate workspace path on blur", async () => {
    // 测试路径验证
  });

  it("should show warning for non-existent path", async () => {
    // 测试路径不存在提示
  });

  it("should block restricted directories", async () => {
    // 测试受保护目录拦截
  });

  it("should create agent with correct name", async () => {
    // 测试创建后 Overview 显示
  });
});
```

---

## 4. 文件修改清单

| 文件路径                               | 修改类型     | 说明                 |
| -------------------------------------- | ------------ | -------------------- |
| `src/utils/path-validator.ts`          | **新增**     | 路径验证工具         |
| `src/agents/agent-id-validation.ts`    | 修改         | 扩展验证函数         |
| `src/gateway/server-methods/agents.ts` | 修改         | 新增路径检测 API     |
| `ui/src/ui/controllers/agents.ts`      | 修改         | 扩展控制器方法       |
| `ui/src/ui/views/agents.ts`            | **重点修改** | 对话框 UI 和验证逻辑 |
| `ui/src/ui/i18n/locales/zh-CN.ts`      | 修改         | 添加中文翻译         |
| `ui/src/ui/i18n/locales/en.ts`         | 修改         | 添加英文翻译         |
| `ui/src/ui/i18n/locales/zh-TW.ts`      | 修改         | 添加繁体中文翻译     |
| `src/utils/path-validator.test.ts`     | **新增**     | 单元测试             |

---

## 5. 兼容性考虑

### 5.1 平台兼容

- **Linux**: 所有受保护目录生效
- **macOS**: 额外包含 `/System`, `/Library` 等
- **Windows**: 需要额外定义 `C:\Windows`, `C:\Program Files` 等（当前未实现）

### 5.2 向后兼容

- 现有 Agent 配置中的 `name` 字段可能不存在，需要设置默认值
- `agent.identity.name` 优先级低于 `agent.name`
- 路径验证对现有 Agent 无影响

---

## 6. 注意事项

1. **路径展开**: 确保 `~` 正确展开为用户主目录
2. **权限检查**: 路径检测需要考虑文件系统权限
3. **竞态条件**: 防抖检测避免频繁请求
4. **错误处理**: 网络错误、权限错误等需要友好提示
5. **国际化**: 所有错误信息使用 i18n key
