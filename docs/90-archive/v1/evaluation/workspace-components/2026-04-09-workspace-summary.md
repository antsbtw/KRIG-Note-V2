# Workspace 层与相关组件评估汇总（2026-04-09）

## 覆盖范围
- 框架层：`src/main/workspace/manager.ts`、Session 恢复/持久化（`src/main/app.ts`、`src/main/storage/session-store.ts`）
- Renderer 组件：WorkspaceBar、NavSide
- Slot & Divider（窗口侧布局/拖拽/样式）
- Slot 间通信机制（协议匹配、消息路由、preload 接口）

## 主要问题（按优先级）
1) **插件化与契约缺失**  
   - NavSide 硬编码插件组件；View 创建/Slot 加载在 shell 层按 viewType switch。  
   - 协议匹配仅基于 WorkMode，不区分实例/variant；消息无 schema 校验。  

2) **Workspace 状态不完整 / 侵入式全局状态**  
   - NavSide 宽度全局共享；Right slot 绑定未持久化；Session 恢复重建 Workspace ID，引用不稳定。  
   - Workspace 切换恢复字段缺失（activeBookId、ebookExpandedFolders、right slot 等）。  

3) **UI 表现未配置化**  
   - WorkspaceBar、NavSide、Toggle/Divider/Resize 等大量 inline style，缺少统一主题源，无法快速换肤或统一视觉。  

4) **职责过载与耦合**  
   - NavSide 单文件集成数据获取、状态、渲染、上下文菜单、拖放；Slot 逻辑夹杂业务（Extraction 导入）。  

5) **可访问性与鲁棒性不足**  
   - 按钮/handle 缺 aria/tooltip，IPC 调用无错误态，消息丢弃无反馈。  

## 推荐整改路线（分阶段）
- **阶段 1：契约/状态补齐**  
  - 将 navSideWidth、right slot 绑定（workMode/variant/instanceId）纳入 WorkspaceState 并持久化；Session 恢复复用 ID。  
  - 完善 RESTORE/BROADCAST 字段（activeBookId、ebookExpandedFolders、right slot）。  
  - 在消息路由层引入基础 schema 校验与路由结果回执。  

- **阶段 2：插件化/注册制**  
  - View 创建与 NavSide 面板改用注册表/工厂，Shell/NavSide 不再 import 具体插件。  
  - 协议注册支持实例级/variant 维度与优先级。  

- **阶段 3：UI 主题化与解耦**  
  - 建立共享主题（CSS 变量或 `theme.ts`），迁移 WorkspaceBar/NavSide/Divider 内联样式。  
  - 拆分 NavSide：数据适配层 + 交互状态 + 纯渲染组件。  

- **阶段 4：体验与可访问性**  
  - 增加 aria-label/tooltip、键盘支持；IPC/网络错误态与 loading/empty 态。  

## 参考明细
- `docs/evaluation/2026-04-09-workspace.md` — Workspace 管理/Session
- `docs/evaluation/workspace-components/2026-04-09-workspacebar.md`
- `docs/evaluation/workspace-components/2026-04-09-navside.md`
- `docs/evaluation/workspace-components/2026-04-09-slot-divider.md`
- `docs/evaluation/workspace-components/2026-04-09-slot-communication.md`

## 评估时间
- 2026-04-09  基于仓库当前代码快照。
