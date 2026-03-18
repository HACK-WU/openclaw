# 群聊创建对话框 - 实现方案

## 概述

本文档描述群聊创建对话框的设计实现方案，包含数据模型、UI 组件、国际化和路径验证的具体实现步骤。

---

## 1. 数据模型变更

### 1.1 扩展 GroupCreateDialogState

**文件**: `ui/src/ui/controllers/group-chat.ts`

需要扩展 `GroupCreateDialogState` 类型，添加以下字段：

- `pendingRoles`: 记录未勾选智能体的角色选择意向
- `directoryError`: 项目目录验证错误信息
- `docsError`: 项目文档验证错误信息

### 1.2 角色类型常量

定义角色类型常量，便于统一管理和国际化：

```typescript
// 角色类型（保持现有值不变，仅作为文档说明）
type AgentRole = "assistant" | "member" | "cli-assistant";
```

> 注意：当前代码中使用的是 `bridge-assistant`，需要全局替换为 `cli-assistant`

---

## 2. 国际化文案

### 2.1 新增 Key 列表

| Key                                  | 中文                                         | 英文                                                            |
| ------------------------------------ | -------------------------------------------- | --------------------------------------------------------------- |
| `chat.group.projectDirectory`        | 项目目录（可选）                             | Project Directory (optional)                                    |
| `chat.group.projectDirectoryHint`    | CLI 智能体将在此目录下启动。创建后不可更改。 | CLI Agents will start in this directory. Locked after creation. |
| `chat.group.projectDocs`             | 项目文档（可选）                             | Project Docs (optional)                                         |
| `chat.group.projectDocsHint`         | 注入到智能体上下文的文件路径，逗号分隔。     | Comma-separated file paths injected into agent context.         |
| `chat.group.error.directoryNotFound` | 目录不存在                                   | Directory does not exist                                        |
| `chat.group.error.fileNotFound`      | 文件不存在：{files}                          | File(s) not found: {files}                                      |
| `chat.group.role.assistant`          | 助手                                         | Assistant                                                       |
| `chat.group.role.member`             | 成员                                         | Member                                                          |
| `chat.group.role.cliAssistant`       | CLI 助手                                     | CLI Assistant                                                   |

### 2.2 需要修改的文件

1. `ui/src/ui/i18n/locales/zh-CN.ts`
2. `ui/src/ui/i18n/locales/en.ts`
3. `ui/src/ui/i18n/locales/zh-TW.ts`

---

## 3. UI 组件变更

### 3.1 渲染逻辑修改

**文件**: `ui/src/ui/views/group-chat.ts`

修改 `renderCreateGroupDialog` 函数中的智能体列表渲染逻辑：

#### 核心变更点

1. **类型下拉始终显示**
   - 移除 `selected` 条件判断
   - 所有智能体行都显示角色下拉框

2. **未勾选行的样式区分**
   - 添加 CSS class `group-create__role-select--unselected`
   - 设置透明度为 0.6

3. **角色切换行为**
   - 已勾选：直接更新 `selectedAgents`
   - 未勾选：记录到 `pendingRoles`

4. **默认角色逻辑**
   - 第一个勾选的智能体默认 `assistant`
   - 其他智能体默认 `member`

### 3.2 路径验证 UI

#### 输入框状态

- 正常状态：默认边框样式
- 错误状态：红色边框 + 右侧错误图标 + 下方错误文字

#### 创建按钮状态

- 正常状态：可点击
- 验证失败状态：禁用（disabled）

---

## 4. 路径验证逻辑

### 4.1 验证函数

需要在控制器中新增以下验证函数：

1. **validateProjectDirectory(path: string): Promise<{ valid: boolean; error?: string }>**
   - 检查目录是否存在
   - 通过后端 RPC 调用进行验证（需要后端支持）

2. **validateProjectDocs(paths: string): Promise<{ valid: boolean; error?: string; invalidFiles?: string[] }>**
   - 解析逗号分隔的文件路径
   - 逐个检查文件是否存在
   - 返回无效文件列表

### 4.2 验证触发时机

| 事件                   | 处理                  |
| ---------------------- | --------------------- |
| 输入框 keydown (Enter) | 触发验证              |
| 输入框 blur            | 触发验证              |
| 验证中                 | 显示 loading 状态     |
| 验证完成               | 更新错误状态，刷新 UI |

### 4.3 后端 API 需求

需要后端提供以下 RPC 方法（如果不存在）：

- `fs.exists` 或类似方法：检查路径是否存在

---

## 5. 样式更新

### 5.1 新增 CSS 规则

**文件**: `ui/src/styles/chat/group-chat.css` 或相关样式文件

```css
/* 未勾选时的角色下拉框 */
.group-create__role-select--unselected {
  opacity: 0.6;
  cursor: pointer;
}

.group-create__role-select--unselected:hover {
  opacity: 0.8;
}

/* 路径验证错误状态 */
.group-create__field--error .field {
  border-color: var(--color-error, #f38ba8);
}

.group-create__error-text {
  color: var(--color-error, #f38ba8);
  font-size: 12px;
  margin-top: 4px;
}
```

---

## 6. 实现步骤

### 阶段一：国际化（低风险）

1. 在 3 个国际化文件中添加新的 key
2. 确认现有文案使用 `t()` 函数包裹

### 阶段二：角色下拉始终显示

1. 修改 `renderCreateGroupDialog` 渲染逻辑
2. 添加 `pendingRoles` 状态管理
3. 添加样式区分未勾选状态

### 阶段三：路径验证

1. 确认后端 API 支持
2. 实现验证函数
3. 添加验证 UI 状态
4. 添加创建按钮禁用逻辑

### 阶段四：角色类型重命名

1. 全局替换 `bridge-assistant` 为 `cli-assistant`
2. 更新类型定义
3. 确认后端兼容性

---

## 7. 测试要点

### 功能测试

- [ ] 智能体列表每行都显示角色下拉
- [ ] 未勾选行下拉框透明度为 0.6
- [ ] 勾选第一个智能体默认角色为 assistant
- [ ] 勾选其他智能体默认角色为 member
- [ ] 切换已勾选行角色立即生效
- [ ] 切换未勾选行角色记录到 pendingRoles
- [ ] 取消勾选后角色保存到 pendingRoles

### 路径验证测试

- [ ] 输入不存在的目录，显示错误提示
- [ ] 输入不存在的文件，显示错误提示（包含文件名）
- [ ] 输入存在的路径，无错误提示
- [ ] 验证失败时创建按钮禁用
- [ ] 验证成功后创建按钮可用
- [ ] 空值不触发验证

### 国际化测试

- [ ] 切换语言后，所有新增文案正确显示
- [ ] 角色下拉选项显示翻译后的文字

---

## 8. 风险评估

| 风险                              | 影响                 | 缓解措施                         |
| --------------------------------- | -------------------- | -------------------------------- |
| 后端不支持路径验证 API            | 路径验证功能无法实现 | 前端仅做格式验证，跳过存在性检查 |
| `bridge-assistant` 重命名影响后端 | 角色类型不匹配       | 与后端确认兼容性，考虑过渡期     |
| 验证请求频繁                      | 性能影响             | 添加防抖，避免每次输入都验证     |

---

## 9. 相关文件清单

### 需要修改

| 文件                                  | 修改内容                   |
| ------------------------------------- | -------------------------- |
| `ui/src/ui/controllers/group-chat.ts` | 扩展状态类型、添加验证函数 |
| `ui/src/ui/views/group-chat.ts`       | 修改渲染逻辑               |
| `ui/src/ui/i18n/locales/zh-CN.ts`     | 添加中文文案               |
| `ui/src/ui/i18n/locales/en.ts`        | 添加英文文案               |
| `ui/src/ui/i18n/locales/zh-TW.ts`     | 添加繁体中文文案           |
| `ui/src/styles/chat/group-chat.css`   | 添加新样式                 |

### 可能需要新增

| 文件                                | 用途                     |
| ----------------------------------- | ------------------------ |
| `ui/src/ui/utils/path-validator.ts` | 路径验证工具函数（可选） |
