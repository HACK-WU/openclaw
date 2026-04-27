# Project Memory

## 架构决策

## 代码结构

## 编码约定

## 踩坑记录

- **Lit `@state()` 遗漏导致 UI 延迟**：`ui/src/ui/views/group-chat.ts` 中的 CLI Agent 操作弹框 (`bridgeAgentMenu`) 出现明显延迟，因为 `app.ts` 中未将其声明为 `@state()` reactive property。修改该字段后 Lit 不会触发重新渲染，必须等待其他 state 变化或下一轮更新周期。修复方式：在 `app.ts` 中添加 `@state() bridgeAgentMenu`，并在 `ui/src/ui/app-view-state.ts` 的 `AppViewState` 中补充类型定义。

- **群聊文档弹框渲染延迟问题**：群聊文档的创建/编辑弹框 (`groupDocDialog`) 存在点击加号弹框延迟、弹框内操作延迟的问题。**根因**：`groupDocsList`、`groupDocsLoading`、`groupDocDialog`、`groupDocDeleteDialog`、`groupDocRenameDialog` 这些状态在 `ui/src/ui/app.ts` 中没有声明为 `@state()` 属性，导致 controller 修改属性后 Lit 无法检测变化并触发重新渲染。**修复**：在 `app.ts` 中添加这些状态的 `@state()` 声明（位于 `bridgeAgentMenu` 之后）。此外，编辑模式下缺少预览按钮，需添加 `openGroupDocPreviewMode()` 函数和预览按钮。

## 项目知识

## 用户偏好
