# WorkspaceBar 组件评估（2026-04-09）

## 范围
- 文件：`src/renderer/shell/WorkspaceBar.tsx`
- 相关契约：`src/main/preload/shell.ts` 暴露的 `shellAPI`；`WorkspaceState` 定义（`src/shared/types.ts`）。
- 参考原则：分层设计、模块自包含、UI 表现层配置化、Workspace 是核心调度单元、命名/可描述性。

## 发现（按严重度排序）
1) **视觉样式大量内联硬编码，未使用主题/配置（违反“UI 表现层配置化”）**  
   - 位置：文件底部 `styles` 对象（颜色、间距、圆角、字体全部内联）。  
   - 影响：无法通过主题切换或集中配置调整 WorkspaceBar 外观，修改需改代码。  

2) **缺少错误/空态处理，API 失败时无降级**  
   - 位置：初次加载 `shellAPI.listWorkspaces()`、`onStateChanged` 回调未捕获异常或超时。  
   - 影响：若 IPC 失败，组件静默失效，不符合可描述性和鲁棒性要求。  

3) **拖拽排序逻辑未与 WorkspaceState/持久化联动**  
   - 位置：拖拽后调用 `shellAPI.reorderWorkspaces(ids)` 但本地 state 立即重排；如果 main 层失败或未持久化，前端状态与实际不一致。  
   - 影响：状态一致性风险；建议等待 IPC 结果或由 main 广播权威顺序。  

4) **交互可访问性与命名不清**  
   - 位置：按钮无 aria/标题仅部分提供；tab 文本截断缺 tooltip；关闭按钮 `×` 无可访问名称。  
   - 影响：可描述性不足，且在多 Workspace 情况下易混淆。  

5) **状态恢复/同步字段缺失**  
   - 组件假设 `shellAPI.onStateChanged` 提供完整 `workspaces/activeId`，但不验证数据结构与版本；`WorkspaceState` 中的 `slotBinding`、NavSide 宽度等字段未透传到 UI，未来扩展需对齐。  

## 改进建议
- 抽离样式至共享主题（CSS 变量或 `theme.ts`），WorkspaceBar 只引用变量/类。 
- 对 IPC 调用加异常处理与加载/错误态；主进程广播为单一真相，前端仅渲染。 
- 拖拽排序后以主进程回传顺序为准（或显示“保存中/失败”反馈）。 
- 补充 aria-label/tooltip，关闭按钮用 `<button aria-label="Close workspace">×</button>`。 
- 为未来扩展预留数据验证：在 onStateChanged 中校验必需字段，忽略/告警未知字段。 

## 评估时间
- 2026-04-09  基于仓库当前代码快照。
