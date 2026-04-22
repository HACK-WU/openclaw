# Project Memory

## 架构决策

## 代码结构

## 编码约定

## 踩坑记录

- **Lit `@state()` 遗漏导致 UI 延迟**：`ui/src/ui/views/group-chat.ts` 中的 CLI Agent 操作弹框 (`bridgeAgentMenu`) 出现明显延迟，因为 `app.ts` 中未将其声明为 `@state()` reactive property。修改该字段后 Lit 不会触发重新渲染，必须等待其他 state 变化或下一轮更新周期。修复方式：在 `app.ts` 中添加 `@state() bridgeAgentMenu`，并在 `ui/src/ui/app-view-state.ts` 的 `AppViewState` 中补充类型定义。

## 项目知识

## 用户偏好
