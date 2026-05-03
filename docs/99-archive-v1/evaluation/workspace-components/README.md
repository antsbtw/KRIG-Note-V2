# Workspace 相关组件独立评估计划（2026-04-09）

## 范围（建议）
- WorkspaceBar（renderer）：`src/renderer/shell/WorkspaceBar.tsx`
- NavSide 与 Workspace 状态交互部分：`src/renderer/navside/NavSide.tsx`
- Slot/Divider UI（renderer 端有的话）
- Workspace 状态在 renderer 的恢复/绑定逻辑

## 评估输出形式
- 每个组件一份独立报告：`YYYY-MM-DD-<component>.md`
- 保持与主评估同样的结构：范围、发现（按严重度）、建议、时间

## 建议步骤
1. 逐文件检查是否遵守原则：分层、模块自包含、UI 配置化、命名可描述性。 
2. 记录跨层依赖（renderer → preload → main）的契约是否清晰。 
3. 标出与 WorkspaceState 同步/恢复相关的缺口。 

> 如需我直接开始撰写各组件评估，请指明优先顺序（如先 WorkspaceBar，再 NavSide）。
