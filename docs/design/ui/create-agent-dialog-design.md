# 通用 Agent 创建对话框设计

## 背景

当前创建 Agent 的对话框需要用户手动填写多个字段，包括 Name、Agent ID 和 Workspace Path。为了提升用户体验，需要优化字段的默认值填充逻辑和增加路径验证功能。

## 设计目标

1. 简化用户操作流程，智能填充 Agent ID 和 Workspace Path
2. 增加路径检测和验证，防止误操作
3. 支持中文和英文 Name，提高本地化体验
4. 保护工作空间目录，防止选择系统核心目录

---

## 国际化文案

### 新增 i18n Key

| Key                                       | 中文                                     | 英文                                                         |
| ----------------------------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| `agent.create.title`                      | 创建 Agent                               | Create Agent                                                 |
| `agent.create.subtitle`                   | 添加一个具有独立工作空间和身份的新 Agent | Add a new agent with its own workspace and identity.         |
| `agent.create.name.label`                 | 名称 \*                                  | Name \*                                                      |
| `agent.create.name.placeholder`           | 例如：researcher                         | e.g. researcher                                              |
| `agent.create.name.hint`                  | 可以是中文或英文                         | Can be Chinese or English                                    |
| `agent.create.agentId.label`              | Agent ID \*                              | Agent ID \*                                                  |
| `agent.create.agentId.placeholder`        | 例如：researcher                         | e.g. researcher                                              |
| `agent.create.agentId.hint`               | 仅限字母、数字、下划线 [a-zA-Z0-9_]      | Only letters, numbers, underscores [a-zA-Z0-9_]              |
| `agent.create.workspace.label`            | 工作空间路径 \*                          | Workspace Path \*                                            |
| `agent.create.workspace.placeholder`      | 例如：~/agents/researcher                | e.g. ~/agents/researcher                                     |
| `agent.create.workspace.hint`             | 按回车或离开输入框以检测路径             | Press Enter or leave input to detect path                    |
| `agent.create.workspace.autoCreate`       | 路径不存在，将会自动创建该目录           | Path does not exist, directory will be created automatically |
| `agent.create.workspace.error.forbidden`  | 不能选择系统核心目录                     | Cannot select system core directory                          |
| `agent.create.workspace.error.restricted` | 该目录受保护，请选择其他位置             | This directory is protected, please choose another location  |
| `agent.create.emoji.label`                | 头像（可选）                             | Emoji (optional)                                             |
| `agent.create.emoji.placeholder`          | 例如：🔬                                 | e.g. 🔬                                                      |
| `agent.create.button.cancel`              | 取消                                     | Cancel                                                       |
| `agent.create.button.create`              | 创建                                     | Create                                                       |

---

## 设计稿

### 初始状态

```
┌─────────────────────────────────────────┐
│  创建 Agent                              │
│  添加一个具有独立工作空间和身份的新 Agent      │
├─────────────────────────────────────────┤
│                                         │
│  名称 *                                  │
│  ┌─────────────────────────────────┐   │
│  │ researcher                      │   │  ← 用户输入
│  └─────────────────────────────────┘   │
│  可以是中文或英文                          │
│                                         │
│  Agent ID *                              │
│  ┌─────────────────────────────────┐   │
│  │ researcher                      │   │  ← 自动填充（与 Name 一致）
│  └─────────────────────────────────┘   │
│  仅限字母、数字、下划线 [a-zA-Z0-9_]        │
│                                         │
│  工作空间路径 *                           │
│  ┌─────────────────────────────────┐   │
│  │ ~/agents/researcher             │   │  ← 自动填充（默认 Agent 的工作空间）
│  └─────────────────────────────────┘   │
│  按回车或离开输入框以检测路径               │
│                                         │
│  头像（可选）                             │
│  ┌─────────────────────────────────┐   │
│  │ 🔬                              │   │
│  └─────────────────────────────────┘   │
│                                         │
│         [取消]      [创建]              │
└─────────────────────────────────────────┘
```

### 中文 Name 示例

```
┌─────────────────────────────────────────┐
│  ...                                    │
│  名称 *                                  │
│  ┌─────────────────────────────────┐   │
│  │ 研究员                          │   │  ← 中文名称
│  └─────────────────────────────────┘   │
│                                         │
│  Agent ID *                              │
│  ┌─────────────────────────────────┐   │
│  │                                 │   │  ← 为空，需要用户手动填写
│  └─────────────────────────────────┘   │
│  仅限字母、数字、下划线 [a-zA-Z0-9_]        │
│  ⚠️ 名称不符合 Agent ID 格式，请手动填写    │
│  ...                                    │
└─────────────────────────────────────────┘
```

### 路径检测 - 不存在（提示自动创建）

```
┌─────────────────────────────────────────┐
│  ...                                    │
│  工作空间路径 *                           │
│  ┌─────────────────────────────────┐   │
│  │ ~/agents/new-agent              │   │
│  └─────────────────────────────────┘   │
│  ℹ️ 路径不存在，将会自动创建该目录          │  ← 蓝色/灰色信息提示
│                                         │
│         [取消]      [创建]              │
└─────────────────────────────────────────┘
```

### 路径检测 - 系统核心目录（错误状态）

```
┌─────────────────────────────────────────┐
│  ...                                    │
│  工作空间路径 *                           │
│  ┌─────────────────────────────────┐   │
│  │ /etc                            │   │  ← 红色边框 + 图标
│  └─────────────────────────────────┘   │
│  ❌ 不能选择系统核心目录                   │  ← 红色错误提示
│                                         │
│         [取消]      [创建] [禁用]        │  ← 创建按钮禁用
└─────────────────────────────────────────┘
```

### 路径检测 - macOS 系统目录（错误状态）

```
┌─────────────────────────────────────────┐
│  ...                                    │
│  工作空间路径 *                           │
│  ┌─────────────────────────────────┐   │
│  │ /System                         │   │  ← 红色边框 + 图标
│  └─────────────────────────────────┘   │
│  ❌ 该目录受保护，请选择其他位置            │  ← 红色错误提示
│                                         │
│         [取消]      [创建] [禁用]        │
└─────────────────────────────────────────┘
```

---

## 行为规则

### 1. Name 字段

#### 输入规则

- 接受任意字符，包括中文、英文、数字、特殊字符等
- 长度限制：1-50 个字符
- 不允许为空

#### Agent ID 自动填充逻辑

```typescript
// Agent ID 格式：仅允许字母、数字、下划线
const AGENT_ID_PATTERN = /^[a-zA-Z0-9_]+$/;

function shouldAutoFillAgentId(name: string): boolean {
  return AGENT_ID_PATTERN.test(name);
}

// 当 Name 变化时
onNameChange(name: string) {
  if (shouldAutoFillAgentId(name)) {
    // Name 符合 Agent ID 格式，自动填充
    agentId.value = name;
    agentId.disabled = true; // 锁定，但可点击解锁编辑
  } else {
    // Name 不符合格式（如包含中文），清空 Agent ID，需要用户手动填写
    agentId.value = '';
    agentId.disabled = false;
  }
}
```

#### 视觉提示

- 当 Agent ID 被自动填充时：
  - 输入框显示预填充值
  - 右侧显示小锁图标或编辑图标
  - 点击编辑图标可手动修改

- 当需要用户手动填写时：
  - 输入框显示占位符
  - 下方显示提示："⚠️ 名称不符合 Agent ID 格式，请手动填写"

---

### 2. Agent ID 字段

#### 输入规则

- 格式：仅限字母、数字、下划线 `[a-zA-Z0-9_]`
- 长度限制：1-50 个字符
- 不允许为空
- 必须以字母或下划线开头（不能以数字开头）

#### 验证规则

```typescript
const AGENT_ID_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function validateAgentId(agentId: string): ValidationResult {
  if (!agentId) {
    return { valid: false, error: "agent.create.error.required" };
  }
  if (!AGENT_ID_REGEX.test(agentId)) {
    return { valid: false, error: "agent.create.error.invalidAgentId" };
  }
  if (agentId.length > 50) {
    return { valid: false, error: "agent.create.error.tooLong" };
  }
  // 检查是否已存在
  if (existingAgentIds.includes(agentId)) {
    return { valid: false, error: "agent.create.error.alreadyExists" };
  }
  return { valid: true };
}
```

---

### 3. Workspace Path 字段

#### 默认值逻辑

```typescript
function getDefaultWorkspacePath(currentAgent: Agent, name: string): string {
  // 获取当前默认 Agent 的工作空间父目录
  const currentWorkspace = currentAgent.workspacePath;
  const parentDir = path.dirname(currentWorkspace);

  // 使用 name 生成目录名（如果 name 包含特殊字符，进行 safe 转换）
  const safeDirName = sanitizeDirName(name) || "new-agent";

  return path.join(parentDir, safeDirName);
}

// 将名称转换为安全的目录名
function sanitizeDirName(name: string): string {
  // 移除或替换不安全的文件系统字符
  return name
    .replace(/[<>:"/\\|?*]/g, "_") // Windows 不允许的字符
    .replace(/\s+/g, "_") // 空格替换为下划线
    .substring(0, 50); // 长度限制
}
```

#### 路径检测触发时机

- 用户按回车键（Enter）时触发
- 输入框失去焦点（blur）时触发
- 路径内容发生变化且停止输入 500ms 后（防抖）

#### 路径检测逻辑

```typescript
interface PathCheckResult {
  exists: boolean;
  isRestricted: boolean;
  canCreate: boolean;
  message?: string;
}

async function checkWorkspacePath(inputPath: string): Promise<PathCheckResult> {
  // 展开 ~ 为 home 目录
  const expandedPath = expandTilde(inputPath);

  // 1. 检查是否为受保护目录
  if (isRestrictedDirectory(expandedPath)) {
    return {
      exists: false,
      isRestricted: true,
      canCreate: false,
      message: "agent.create.workspace.error.forbidden",
    };
  }

  // 2. 检查路径是否存在
  try {
    const stats = await fs.stat(expandedPath);
    if (stats.isDirectory()) {
      return {
        exists: true,
        isRestricted: false,
        canCreate: true,
      };
    } else {
      return {
        exists: true,
        isRestricted: false,
        canCreate: false,
        message: "agent.create.workspace.error.notDirectory",
      };
    }
  } catch (error) {
    // 路径不存在
    return {
      exists: false,
      isRestricted: false,
      canCreate: true,
      message: "agent.create.workspace.autoCreate",
    };
  }
}
```

#### 受保护目录列表

```typescript
// Linux/Unix 系统核心目录
const RESTRICTED_DIRECTORIES = [
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
  "/opt", // 谨慎处理
  "/usr/local", // 谨慎处理

  // 用户敏感目录
  "~/.ssh",
  "~/.gnupg",
  "~/.config", // 谨慎处理
  "~/.local", // 谨慎处理
];

// 仅允许完全匹配、不允许子目录的受保护目录
const RESTRICTED_EXACT_MATCH = [
  "/root", // /root 本身受保护，但 /root/xxx 允许
];

// 检查路径是否为受保护目录或其子目录
function isRestrictedDirectory(inputPath: string): boolean {
  const normalizedPath = path.normalize(inputPath);
  const expandedPath = expandTilde(normalizedPath);
  const resolvedPath = path.resolve(expandedPath);

  // 1. 检查完全匹配受限列表
  const isExactMatchRestricted = RESTRICTED_EXACT_MATCH.some((restricted) => {
    const expandedRestricted = expandTilde(restricted);
    const resolvedRestricted = path.resolve(expandedRestricted);
    return resolvedPath === resolvedRestricted;
  });

  if (isExactMatchRestricted) {
    return true;
  }

  // 2. 检查普通受限目录（完全匹配或子目录）
  return RESTRICTED_DIRECTORIES.some((restricted) => {
    const expandedRestricted = expandTilde(restricted);
    const resolvedRestricted = path.resolve(expandedRestricted);

    // 检查是否完全匹配或是子目录
    return (
      resolvedPath === resolvedRestricted || resolvedPath.startsWith(resolvedRestricted + path.sep)
    );
  });
}
```

#### 路径验证状态显示

| 状态                 | 边框颜色 | 图标 | 提示信息                       |
| -------------------- | -------- | ---- | ------------------------------ |
| 初始/未验证          | 默认     | 无   | 按回车或离开输入框以检测路径   |
| 路径存在             | 绿色     | ✅   | 路径有效                       |
| 路径不存在（可创建） | 默认     | ℹ️   | 路径不存在，将会自动创建该目录 |
| 路径存在但不是目录   | 红色     | ❌   | 该路径不是目录                 |
| 受保护目录           | 红色     | ❌   | 不能选择系统核心目录           |

---

### 4. 创建按钮状态

创建按钮的启用/禁用状态取决于以下验证：

```typescript
function canCreateAgent(): boolean {
  // 1. Name 不能为空
  if (!name.value.trim()) return false;

  // 2. Agent ID 必须有效
  if (!validateAgentId(agentId.value).valid) return false;

  // 3. Workspace Path 必须有效
  const pathCheck = checkWorkspacePath(workspacePath.value);
  if (pathCheck.isRestricted) return false;
  if (pathCheck.exists && !pathCheck.canCreate) return false;
  // 注意：路径不存在但可以创建时，允许创建

  return true;
}
```

---

## 交互流程图

```
┌─────────────────────────────────────────────────────────┐
│                    打开创建对话框                         │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  填充默认值：                                             │
│  - Name: 空                                              │
│  - Agent ID: 空（等待 Name 输入）                          │
│  - Workspace: 当前默认 Agent 的工作空间路径                 │
│  - Emoji: 空或随机默认                                     │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  用户输入 Name                                           │
└─────────────────────────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
┌─────────────────┐ ┌──────────────┐ ┌─────────────────┐
│ 符合 Agent ID   │ │ 不符合格式   │ │ 为空            │
│ 格式            │ │ （如中文）   │ │                 │
└────────┬────────┘ └──────┬───────┘ └────────┬────────┘
         │                 │                  │
         ▼                 ▼                  ▼
┌─────────────────┐ ┌──────────────┐ ┌─────────────────┐
│ 自动填充        │ │ Agent ID     │ │ 保持原样        │
│ Agent ID        │ │ 清空，等待   │ │                 │
│ 并锁定          │ │ 手动输入     │ │                 │
└─────────────────┘ └──────────────┘ └─────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│  Workspace Path 失去焦点或按回车                         │
└─────────────────────────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
┌─────────────────┐ ┌──────────────┐ ┌─────────────────┐
│ 受保护目录      │ │ 路径存在     │ │ 路径不存在      │
└────────┬────────┘ └──────┬───────┘ └────────┬────────┘
         │                 │                  │
         ▼                 ▼                  ▼
┌─────────────────┐ ┌──────────────┐ ┌─────────────────┐
│ 显示错误        │ │ 显示成功状态 │ │ 显示信息提示    │
│ 禁用创建按钮    │ │              │ │ 允许创建        │
└─────────────────┘ └──────────────┘ └─────────────────┘
```

---

## 样式建议

### 输入框状态样式

```css
/* 默认状态 */
.workspace-input {
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  padding: 8px 12px;
}

/* 验证成功 */
.workspace-input.valid {
  border-color: #52c41a;
}

/* 信息提示（路径不存在但可创建） */
.workspace-input.info {
  border-color: #1890ff;
}

/* 错误状态 */
.workspace-input.error {
  border-color: #ff4d4f;
}

/* 提示信息 */
.hint-text {
  font-size: 12px;
  color: #8c8c8c;
  margin-top: 4px;
}

.hint-text.info {
  color: #1890ff;
}

.hint-text.error {
  color: #ff4d4f;
}

.hint-text.success {
  color: #52c41a;
}
```

### 图标样式

```css
/* 输入框内图标 */
.input-icon {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
}

.input-icon.success {
  color: #52c41a;
}
.input-icon.info {
  color: #1890ff;
}
.input-icon.error {
  color: #ff4d4f;
}
```

---

## 相关文件

- `ui/src/ui/views/agent-create.ts` - Agent 创建对话框视图
- `ui/src/ui/components/agent-form.ts` - Agent 表单组件
- `ui/src/styles/agent/create-dialog.css` - 创建对话框样式
- `ui/src/ui/i18n/locales/zh-CN.ts` - 中文国际化
- `ui/src/ui/i18n/locales/en.ts` - 英文国际化
- `src/agent/store.ts` - Agent 存储，获取默认 Agent 信息
- `src/utils/path-validator.ts` - 路径验证工具（新增）

---

## API 接口

### 路径检测接口

```typescript
// 请求
interface CheckPathRequest {
  path: string;
}

// 响应
interface CheckPathResponse {
  exists: boolean;
  isDirectory: boolean;
  isRestricted: boolean;
  canCreate: boolean;
  parentExists: boolean;
  message?: string;
}
```

### 创建 Agent 接口

```typescript
interface CreateAgentRequest {
  name: string;
  agentId: string;
  workspacePath: string;
  emoji?: string;
}

interface CreateAgentResponse {
  success: boolean;
  agent: Agent;
  error?: string;
}
```

---

## Overview 页面设计

### 需求说明

Agent 创建完成后，Overview 页面需要正确显示用户创建时指定的信息，特别是 **Identity Name** 字段。

### 字段映射

| Overview 字段  | 数据来源              | 说明                      |
| -------------- | --------------------- | ------------------------- |
| Workspace      | `agent.workspacePath` | Agent 的工作空间绝对路径  |
| Primary Model  | `agent.config.model`  | 主模型配置                |
| Identity Name  | `agent.name`          | 创建时用户输入的 **Name** |
| Default        | `agent.isDefault`     | 是否为默认 Agent          |
| Identity Emoji | `agent.emoji`         | 创建时选择的 Emoji        |
| Skills Filter  | `agent.skillsFilter`  | 技能过滤配置              |

### 设计稿

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Overview                                                                   │
│  Workspace paths and identity metadata.                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┬───────────────────┬───────────────┬─────────┬─────────────┐
│  │ Workspace    │ Primary Model     │ Identity Name │ Default │ Identity    │
│  │              │                   │               │         │ Emoji       │
│  ├──────────────┼───────────────────┼───────────────┼─────────┼─────────────┤
│  │ /root/.open- │ bailian/kimi-k2.5 │ researcher    │ yes     │ 🔬          │  ← Identity Name 显示创建时的 name
│  │ claw-dev/    │ (+3 fallback)     │               │         │             │
│  │ workspace    │                   │               │         │             │
│  └──────────────┴───────────────────┴───────────────┴─────────┴─────────────┘
│                                                                             │
│  ┌──────────────┬───────────────────────────────────────────────────────────┐
│  │ Skills Filter│ all skills                                                │
│  └──────────────┴───────────────────────────────────────────────────────────┘
│                                                                             │
│  Model Selection                                                            │
│  ┌──────────────────────────┐  ┌──────────────────────────────────────────┐ │
│  │ Primary model (default)  │  │ Fallbacks (3)                            │ │
│  │                          │  │                                          │ │
│  │ bailian/qwen3.5-plus     │  │ bailian/qwen3.5-plus +2 more        [▼]  │ │
│  └──────────────────────────┘  └──────────────────────────────────────────┘ │
│                                                                             │
│                                                     [Reload Config] [Save]  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 示例对比

#### 创建时输入

| 字段      | 用户输入值            |
| --------- | --------------------- |
| Name      | `researcher`          |
| Agent ID  | `researcher`          |
| Workspace | `~/agents/researcher` |
| Emoji     | `🔬`                  |

#### Overview 页面应显示

| 字段              | 显示值            |
| ----------------- | ----------------- |
| Identity Name     | `researcher` ✓    |
| ~~Identity Name~~ | ~~`Assistant`~~ ✗ |

### 注意事项

- Identity Name 必须显示用户创建时输入的 `name`，而不是固定值 "Assistant" 或 Agent ID
- 如果用户输入的是中文名称（如 `研究员`），Overview 页面也应正确显示中文
- Identity Name 支持编辑，修改后应同步更新 Agent 配置

---

## 兼容性说明

- 支持 macOS、Linux 系统
- Windows 系统的受保护目录需要额外定义
- 路径验证需要后端支持，前端可做初步验证
