# KRIG-Note Workspace 层评估（2026-04-09）

## 评估范围
- Workspace 管理与生命周期：`src/main/workspace/manager.ts`
- Workspace 状态持久化与恢复：`src/main/app.ts` Session 处理、`src/main/storage/session-store.ts`
- 状态同步/IPC：`src/main/ipc/handlers.ts`（与 Workspace 相关部分）
- 参考原则：`principles.md`（分层设计、模块自包含、Workspace 是核心调度单元、可替换性、命名/可描述性）、`design-philosophy.md`

## 发现（按严重度排序）
1) **Workspace 状态持久化“重建式”恢复，ID 重新生成，导致引用不稳定（违反“命名与可描述性”“层间契约”）**  
   - 位置：`app.ts` 恢复 Session 时逐个 `workspaceManager.create()` 生成新 ID，再按索引选活跃 Workspace；`session-store` 仅保存原 ID 但不重用。  
   - 影响：与 Workspace ID 绑定的状态或外部引用（如持久化 slot 绑定、协同记录）无法复现，Session 只保证顺序不保证身份，破坏“命名即设计”。应在恢复时复用原 ID，或引入稳定 UUID。  

2) **Right Slot/Slot 绑定未纳入 WorkspaceState，跨会话无法恢复布局（违背“Workspace 是核心调度单元”）**  
   - 位置：`WorkspaceState.slotBinding` 只定义未使用；Session 构建与恢复未保存 right slot 的 workModeId/instance。  
   - 影响：右侧面板开启状态、内容在切换 Workspace 或重启后丢失，不能兑现“Workspace 驱动 NavSide + Slot 的内容”。应将 right slot 的 view/workMode/variant 写入 WorkspaceState 并随 Session 持久化/恢复。  

3) **NavSide 宽度仍为进程全局状态，未随 Workspace 隔离（已在窗口层提过，这里影响 Workspace 设计）**  
   - 位置：`layout.ts` 全局 `navSideWidth`；Session 存 `navSideWidth` 单值。  
   - 影响：不同 Workspace 的侧边栏宽度共享，违背“Workspace 是核心调度单元”的独立性；切换/恢复会出现样式串扰。应将宽度放入 WorkspaceState。  

4) **Workspace 状态广播/恢复字段不完整，NavSide/EBook 状态缺失**  
   - 位置：`ipc/handlers.ts` 在 `WORKSPACE_SWITCH` 时只向 renderer 发送 `activeNoteId`、`expandedFolders`；未包含 `activeBookId`、`ebookExpandedFolders`、右侧 slot 信息等。  
   - 影响：切换 Workspace 时电子书/右侧视图状态无法恢复，体验与“Workspace 驱动 NavSide 和 Slot 内容”不符。应统一 WorkspaceState -> Renderer 恢复的字段。  

5) **Workspace default/workMode 校验缺失**  
   - 位置：`workspaceManager.create` 直接使用 `workModeRegistry.getDefault()`；恢复 Session 未校验存档中的 workModeId 是否仍存在。  
   - 影响：注册表变化或插件缺失时可能生成空 `workModeId`（已在代码注释“Session 恢复时可能丢失”），导致后续 View 创建兜底逻辑介入。应在恢复/切换时做校验与降级策略。  

## 建议（方向性）
- 恢复 Session 时复用存档 Workspace ID，或使用稳定 UUID；持久化 slotBinding/right slot 信息。 
- 将 NavSideWidth、RightSlot 状态（workMode/variant）纳入 WorkspaceState，并随 Session 保存/恢复；IPC 同步应覆盖全部字段。 
- 在 `WORKSPACE_SWITCH/RESTORE` 消息中补全 `activeBookId`、`ebookExpandedFolders`、right slot 等，保持 renderer 与 main 的状态对齐。 
- 对存档的 `workModeId` 进行注册校验，缺失时降级到默认 WorkMode，并记录告警日志。 

## 评估时间
- 2026-04-09  基于仓库当前代码快照。
