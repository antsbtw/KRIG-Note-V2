# KRIG-Note 设计原则符合性评估（2026-04-09）

## 评估范围
- 渲染层：`src/renderer/shell/WorkspaceBar.tsx`、`src/renderer/navside/NavSide.tsx`
- 插件：`src/plugins/note/components/NoteView.tsx`
- 主进程注册：`src/main/app.ts`、`src/main/navside/registry.ts`、`src/main/workmode/registry.ts`
- 参考原则：`principles.md`、`design-philosophy.md`

## 发现与代码证据（按严重度排序）
1) **框架依赖插件实现（违反“框架与插件分离 / 单向依赖”）**  
   - 位置：`src/renderer/navside/NavSide.tsx` **第4行**直接 `import { WebPanel } from '../../plugins/web/navside/WebPanel';`，并且在**第798行**写死了 `<WebPanel />` 组件挂载。  
   - 问题：NavSide（框架层）硬编码具体插件组件，破坏单向依赖和可替换性。按原则应通过注册表/契约让插件自注册面板入口，NavSide 仅按 `contentType` 动态路由。  

2) **视觉属性散落内联，缺少统一主题（违反“UI 表现层配置化”）**  
   - 位置：`NavSide.tsx`、`WorkspaceBar.tsx`、`NoteView.tsx` 大量 inline style（颜色、间距、圆角、字号）。  
   - 问题：视觉未集中配置，无法实现“单一视觉源头 / 主题可切换”，修改风格需改多处代码。  

3) **NavSide 职责过载（上帝类），缺少分层与模块自包含**  
   - 位置：`NavSide.tsx`（代码总长达 1038 行）内部集成了数据拉取、状态恢复、以及复杂的拖放和多选业务逻辑。  
   - 问题：视图层严重耦合业务逻辑与数据适配，违背“分层设计”“模块自包含”“层间契约”。

## 改进建议（重构路径）
- **剥离硬编码的主组件依赖**：为 NavSide 引入基于 React Context 或自定义事件的 Registry Hook，框架侧只按 `contentType` 调取对应面板工厂。
- **NavSide 拆分降级**：将长达千行的文件拆分为数据层 `NavDataAdapter`，状态机 `NavSelectionMachine` 等独立 hook 或 service，让 NavSide 本身回归纯渲染壳的功能。
- **建立全局 CSS/主题系统**：建立统一的主题源，废弃内联样式，统一导出 css variables 或 className 给 Renderer 使用。

## 评估时间
- 2026-04-09  基于仓库当前代码快照。
