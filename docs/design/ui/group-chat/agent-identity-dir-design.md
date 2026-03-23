# 通用 Agent 核心文件独立存储设计

## 背景

当前通用 Agent（非 CLI Agent）的核心文件（IDENTITY.md、SOUL.md、AGENTS.md、TOOLS.md 等）存储在 **workspace 目录**下。workspace 目录同时承担两个职责：

1. **存储 Agent 身份/核心文件**（IDENTITY.md、SOUL.md 等）
2. **作为 Agent 执行任务的工作目录**（cwd）

这导致了以下问题：

- 所有未配置独立 workspace 的 Agent 共享同一套核心文件（`~/.openclaw/workspace/`）
- 身份文件和项目工作文件混在同一个目录，职责不清晰
- CLI Agent 已经实现了身份文件和工作目录的分离（`{stateDir}/cli-agents/{agentId}/`），通用 Agent 的设计与其不一致

### 目标

参照 CLI Agent 的设计，将通用 Agent 的**核心文件存储**与**工作目录**分离，使每个 Agent 拥有独立的核心文件目录。

---

## 1. 核心概念区分

| 概念               | CLI Agent                          | 通用 Agent（当前）             | 通用 Agent（调整后）                        |
| ------------------ | ---------------------------------- | ------------------------------ | ------------------------------------------- |
| **身份文件目录**   | `{stateDir}/cli-agents/{agentId}/` | `{workspace}`（混合）          | `{stateDir}/agents/{agentId}/`              |
| **工作目录**       | 用户配置的 `cwd`                   | `{workspace}`                  | `{workspace}`（不变）                       |
| **Agent 数据目录** | N/A                                | `{stateDir}/agents/{id}/agent` | `{stateDir}/agents/{agentId}/agent`（不变） |

### 文件归属

身份文件目录下存储的文件：

| 文件                      | 用途                        |
| ------------------------- | --------------------------- |
| `IDENTITY.md`             | 身份定义                    |
| `PERSONALITY.md`          | 性格定义                    |
| `SOUL.md`                 | 行为准则与核心价值观        |
| `AGENTS.md`               | 项目规范与开发指南          |
| `TOOLS.md`                | 环境配置与设备信息          |
| `HEARTBEAT.md`            | 心跳提示                    |
| `BOOTSTRAP.md`            | 引导文件（onboarding 阶段） |
| `MEMORY.md` / `memory.md` | 记忆文件                    |

工作目录仅用于 Agent 执行任务的 cwd，不存放核心文件。

---

## 2. 路径解析规则

### 2.1 身份文件目录（新增）

```
resolveAgentIdentityDir(cfg, agentId)
```

优先级：

1. 如果 agent 配置了 `identityDir` 字段 → 使用配置值
2. 否则 → `{stateDir}/agents/{agentId}/`

**default agent** 的身份文件目录：

- `{stateDir}/agents/default/`
- 如果该目录下无文件，向后兼容回退到 `~/.openclaw/workspace/`

### 2.2 工作目录（不变）

```
resolveAgentWorkspaceDir(cfg, agentId)
```

保持现有逻辑不变，仅作为 CLI 工作目录。

### 2.3 Agent 数据目录（不变）

```
resolveAgentDir(cfg, agentId)
```

保持 `{stateDir}/agents/{id}/agent` 不变。

---

## 3. 后端改动

### 3.1 `src/agents/agent-scope.ts`

新增 `resolveAgentIdentityDir()` 函数：

```typescript
export function resolveAgentIdentityDir(cfg: OpenClawConfig, agentId: string): string {
  const id = normalizeAgentId(agentId);
  const configured = resolveAgentConfig(cfg, id)?.identityDir?.trim();
  if (configured) {
    return stripNullBytes(resolveUserPath(configured));
  }
  const stateDir = resolveStateDir(process.env);
  return stripNullBytes(path.join(stateDir, "agents", id));
}
```

### 3.2 `src/agents/workspace.ts`

修改 `loadWorkspaceBootstrapFiles(dir)` 的调用方，改为从 identityDir 加载：

- `resolveBootstrapFilesForRun()` 增加 `identityDir` 参数
- 当 identityDir 下文件不存在时，回退到 workspaceDir 查找（向后兼容）

修改 `ensureAgentWorkspace()`：

- 接受 `identityDir` 参数
- 在 identityDir 下初始化核心文件模板（而非 workspaceDir）
- workspaceDir 仅创建目录，不初始化文件

### 3.3 `src/gateway/server-methods/agents.ts`

修改以下 API，使用 identityDir 代替 workspaceDir 进行核心文件操作：

| API                 | 改动                                |
| ------------------- | ----------------------------------- |
| `agents.create`     | 在 identityDir 下初始化核心文件模板 |
| `agents.files.list` | 从 identityDir 列出文件             |
| `agents.files.get`  | 从 identityDir 读取文件             |
| `agents.files.set`  | 写入到 identityDir                  |
| `agents.delete`     | 删除 identityDir 下的文件           |

响应中同时返回 `identityDir` 和 `workspaceDir` 两个字段，方便前端展示。

### 3.4 `src/agents/agent-paths.ts`

`resolveOpenClawAgentDir()` 无需改动，它返回的是 Agent 数据目录，与身份文件目录不同。

### 3.5 配置类型

在 `openclaw.json` 的 agent 配置中新增可选字段：

```json
{
  "agents": {
    "list": [
      {
        "id": "researcher",
        "name": "Researcher",
        "workspace": "~/projects/research",
        "identityDir": "~/.openclaw/agents/researcher"
      }
    ]
  }
}
```

- `identityDir`：可选，身份文件目录。不配置时自动使用 `{stateDir}/agents/{id}/`

---

## 4. 前端改动

### 4.1 Agent Overview 面板

在 `agents.ts` 的 Overview 区域增加 "Identity Directory" 显示：

```
┌───────────────────────────────────────┐
│  Overview                              │
├───────────────────────────────────────┤
│  Identity Directory: ~/.openclaw/agents/researcher/  │
│  Workspace:          ~/projects/research           │
│  Primary Model:      gpt-4o                        │
│  ...                                   │
└───────────────────────────────────────┘
```

### 4.2 Core Files 面板

- 文件路径显示使用 identityDir
- 顶部显示 "Identity Directory: {path}"（替换当前的 "Workspace: {path}"）

### 4.3 Create Agent 对话框

- 移除 Workspace Path 的必填标记
- Workspace Path 变为可选字段（默认留空，使用用户 home 目录）
- 新增 Identity Directory 字段（可选，默认自动生成）
- 帮助文本说明两者的区别

### 4.4 API 响应适配

`agents.files.list` 响应新增 `identityDir` 字段，前端从该字段读取路径。

---

## 5. 向后兼容策略

为了不破坏现有用户的文件和配置，采用以下兼容策略：

### 5.1 文件查找回退

核心文件加载时按以下顺序查找：

```
1. identityDir/{filename}     ← 新位置（优先）
2. workspaceDir/{filename}    ← 旧位置（回退）
```

如果 identityDir 下文件不存在但 workspaceDir 下存在，使用 workspaceDir 的文件。
不自动迁移文件，仅做读取回退。

### 5.2 default Agent 兼容

对于 default agent（id = "default"）：

- identityDir = `{stateDir}/agents/default/`
- 如果该目录为空，回退到 `~/.openclaw/workspace/`
- 用户下次通过 UI 保存文件时，文件写入 identityDir

### 5.3 配置兼容

- `identityDir` 为可选字段，不影响现有配置
- 不配置 `identityDir` 时，自动使用默认路径 `{stateDir}/agents/{agentId}/`
- 新创建的 Agent 自动在 identityDir 下初始化核心文件

---

## 6. CLI Agent 对比

| 方面         | CLI Agent                          | 通用 Agent（调整后）                |
| ------------ | ---------------------------------- | ----------------------------------- |
| 身份文件目录 | `{stateDir}/cli-agents/{agentId}/` | `{stateDir}/agents/{agentId}/`      |
| 存储位置     | `cli-agents/bridge.json`           | `openclaw.json`                     |
| 工作目录     | 配置中的 `cwd`                     | 配置中的 `workspace`                |
| 核心文件列表 | 5 个（含 PERSONALITY.md）          | 7+ 个（含 HEARTBEAT.md、MEMORY.md） |

两者路径结构对称，便于统一理解和维护。

---

## 7. 关联文档

- [CLI Agent Core Files 扩展设计](./core-files-extension-design.md) — Core Files 页面 UI 设计
- [CLI Agent 性格系统设计](./cli-agent-personality-system.md) — PERSONALITY.md 详细设计
- [CLI Agent 上下文管理](../group-chat-bridge/cli-agent-context.md) — CLI Agent 核心文件路径说明
- [CLI Agent 管理](../group-chat-bridge/cli-agent-management.md) — CLI Agent 存储与配置
