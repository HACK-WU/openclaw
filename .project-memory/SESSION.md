# Session Notes

## 当前任务

- 修复 group chat CLI Agent 操作弹框延迟问题

## 进展

- [x] 定位根因：`bridgeAgentMenu` 非 Lit `@state()`，修改后不触发 re-render
- [x] 修复 `app.ts`：添加 `@state() bridgeAgentMenu`
- [x] 修复 `app-view-state.ts`：补充类型定义
- [x] 优化 CSS：缩短 `bridge-menu-in` 动画从 `0.15s` 到 `0.08s`
- [x] 记录踩坑到 `.project-memory/MEMORY.md`

## 待确认

## 未完成
