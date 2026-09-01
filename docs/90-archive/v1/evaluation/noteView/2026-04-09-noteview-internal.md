# NoteView 内部组件（Slash / Handle / Floating / Context）评估（2026-04-09）

## 范围
- Slash/Handle/Floating/Context 菜单注册与分离：`src/plugins/note/registry.ts`、`src/plugins/note/types.ts`
- 依赖说明：NoteView 自述“Overlays 由 NoteEditor 内部管理（SlashMenu、FloatingToolbar 等）”。NoteEditor 代码未展开，但注册机制集中在 registry/types。
- 参考原则：框架与插件分离、模块自包含、注册制、命名/可描述性、UI 配置化。

## 发现（按严重度排序）
1) **Slash/Handle/Context 仅在 BlockDef 注册层声明，缺少运行时隔离/懒加载描述**  
   - Registry 负责收集 `slashItems` 与 `customActions`，但未看到对菜单组件的分层实现/注入（NoteEditor 内部未在本次范围）。框架层文档化不足，缺少“菜单渲染层”与“注册数据层”的明确分离说明。  

2) **注册表与渲染耦合入口不清晰**  
   - `BlockRegistry` 通过 `slashMenu` 自动推导 `SlashItemDef`，但未提供对 Handle/Floating/Context 的显式注册接口或约束；`ActionDef` 仅包含 handler，没有 UI 配置（排序、分组、可见条件），可能导致菜单展现层硬编码。  

3) **命名与可描述性不足**  
   - `ActionDef.showIn?: ('handleMenu' | 'contextMenu')[]` 仅列出两个位置，缺少 FloatingToolbar/Shortcut 等通道；未定义标准分组/优先级字段。  

4) **缺少主题/样式配置承载**  
   - 菜单体系未暴露视觉/布局配置位（例如 icon 尺寸、圆角、间距），可能仍在 NoteEditor 内联样式实现，难以满足“UI 表现层配置化”。  

## 改进建议
- 在注册层补充菜单渲染契约：定义 Slash/Handle/Floating/Context 的 schema（字段：id、label、icon、group、priority、visibleWhen、role、shortcut、placement 等），并提供懒加载组件注入点。 
- 为 ActionDef/SlashItemDef 增加分组/排序/可见条件字段，避免渲染层硬编码；将 FloatingToolbar/ContextMenu 也纳入统一注册模型。 
- 文档化注册→渲染链路：BlockRegistry 暴露只读注册数据；NoteEditor 负责渲染，二者通过接口而非直接依赖组件。 
- 引入主题钩子/样式变量，让菜单视觉可配置（CSS 变量或 theme tokens）。 

## 评估时间
- 2026-04-09  基于仓库当前代码快照；NoteEditor 渲染细节未展开，结论基于 Registry/类型定义与 NoteView 描述。
