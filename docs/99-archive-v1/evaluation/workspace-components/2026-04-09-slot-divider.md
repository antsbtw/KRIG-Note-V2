# Slot & Divider（窗口侧）组件评估（2026-04-09）

## 范围
- 布局计算：`src/main/slot/layout.ts`
- 分割条控制：`src/main/slot/divider.ts`
- 分割条/Toggle/Resize 的 inline HTML（在 `src/main/window/shell.ts` 内联）
- 相关契约：`IPC.DIVIDER_*`、`IPC.SLOT_*`（`src/shared/types.ts`），`workspaceManager`。
- 参考原则：分层设计、模块自包含、UI 表现层配置化、Workspace 是核心调度单元。

## 发现（按严重度排序）
1) **NavSide/Slot 尺寸为全局状态，未随 Workspace 隔离（违背“Workspace 是核心调度单元”）**  
   - 位置：`layout.ts` 的模块级 `navSideWidth`；dividerRatio 在 Workspace，但 navSideWidth 仅单值，Session 也只保存单值。  
   - 影响：不同 Workspace 共享同一侧边栏宽度，切换/恢复时状态串扰。  

2) **Slot 绑定/右侧视图状态未纳入布局层接口**  
   - 位置：Slot 管理只看 `hasRightSlot()` 与 `dividerRatio`，未暴露 right slot 的 workMode/variant/instance 以便持久化或恢复；`slotBinding` 字段未使用。  
   - 影响：布局层无法表达“谁在右侧”，导致恢复和协议匹配需另行推断，违背层间契约清晰性。  

3) **视觉样式与交互内联硬编码（违反“UI 表现层配置化”）**  
   - 位置：`DIVIDER_HTML`、`NAV_RESIZE_HTML`、`TOGGLE_HTML` 字符串内的颜色、尺寸、hover/active 态全部硬编码。  
   - 影响：无法通过统一主题切换或配置化调整，修改需改内联字符串。  

4) **缺少错误与边界处理**  
   - Divider 拖拽：未对窗口最小宽度、slotAreaWidth<=DIVIDER_WIDTH 的情况进行保护；NavSide 收起时依然用 last width 计算 ratio 可能产生负值或溢出（虽有限制但无日志）。  

5) **事件路由与可访问性**  
   - Inline HTML 中的按钮/区域无 aria-label；Divider/Resize handle 仅鼠标事件，无键盘支持。  

## 改进建议
- 将 `navSideWidth` 纳入 WorkspaceState，并随 Session 保存/恢复；布局计算函数接收 width 参数而非读取全局。 
- 明确 Slot 状态结构（left/right workMode/variant/instanceId），在布局/IPC 中传递，用于持久化和恢复。 
- 抽离 Divider/Toggle/Resize 样式到共享主题变量或 CSS，避免内联硬编码。 
- 在拖拽计算中加入边界与异常日志；NavSide 收起时固定 dividerRatio 或暂存。 
- 增强可访问性：为按钮/handle 添加 aria-label，提供键盘调整 divider 的方案（如箭头键微调）。 

## 评估时间
- 2026-04-09  基于仓库当前代码快照。
