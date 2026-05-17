# shell/fullscreen-overlay — L2 全屏覆盖层

> **架构定位**:L2 Shell 内,与 WorkspaceContainer 并列的"app-scoped 全屏视图槽"。
> **第七类交互系统**:与 5 大 view-scoped 浮层(context-menu / handle-menu / slash-menu / popup / floating-toolbar)和 L3 generic overlay 并列。

---

## 该模块做什么

提供一个**全屏专注式编辑视图**的公共槽位。任何 KRIG 业务模块(text-editing / canvas / ebook / web 等)可通过 `fullscreenOverlayRegistry.register({ id, Component })` 贡献自己的全屏视图,在需要时由 controller 显示。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `FullscreenOverlayContainer.tsx` | L2 Shell sibling 容器(与 WorkspaceContainer 并列),App 入口挂载点 |
| `FullscreenOverlayBinding.tsx` | 订阅 controller + registry,active 时渲染 Component,管 Esc 关闭 |
| `fullscreen-overlay.css` | 基础样式(position:fixed inset:0,黑底,flex column);Component 内部 layout 自治 |

---

## 与 Workspace 的关系

active 时,L2 Shell 的另外两个 sibling(WorkspaceBar + WorkspaceContainer)由 App 入口 `display:none`,**用户视觉上离开 Workspace**,进入专注模式。Esc 关闭后回到原 Workspace,状态原样保留。

---

## 注册 / 调用 API

```ts
import { fullscreenOverlayRegistry }
  from '@slot/interaction-registries/fullscreen-overlay-registry/registry';
import { fullscreenOverlayController }
  from '@slot/triggers/fullscreen-overlay-controller';

// 1. 启动时注册(命名约定:<feature>.fullscreen.<name>)
fullscreenOverlayRegistry.register({
  id: 'text-editing.fullscreen.mermaid',
  Component: MermaidFullscreenPanel,
});

// 2. 业务方触发(payload 通过模块级 SSOT 传,对齐 table-menu-context 模式)
setMermaidFullscreenContext({ instanceId, nodePos });
fullscreenOverlayController.show('text-editing.fullscreen.mermaid');

// 3. Component 接 onClose,内部可调用关闭
function MermaidFullscreenPanel({ onClose }: FullscreenOverlayCloseProps) {
  return (
    <>
      ...
      <button onClick={onClose}>×</button>
    </>
  );
}
```

---

## 设计契约(本目录承诺)

- **单例语义**:`fullscreenOverlayController.show(id)` 同一时刻只一个 overlay 活跃,新 show 自动覆盖旧的
- **Overlay 内部自治**:Component 内部可任意管理 state / tab / 嵌套 view / 自定义小弹层。controller 不约束内部结构
- **Esc 关闭**:Binding 自管 document keydown listener,直接调 `controller.hide()`
- **不点外关闭**:全屏无外
- **WorkspaceContainer 不可达**:active 时整个 Workspace 隐藏。Workspace 内的 5 大交互浮层即使触发也看不到 — overlay 内如需小弹层,Component 自己渲染

---

## 不在范围内

- ❌ 内部 layout 约束(不提供 toolbar / content 分区契约,完全自由)
- ❌ multi-overlay 同时显示(controller 单例,设计上互斥)
- ❌ Workspace 切换感知(active 时 WorkspaceBar 已隐藏,用户无法切 workspace)
- ❌ payload 传递(走模块级 SSOT,registry 只存 Component)

---

## 与其他文档的关系

| 文档 | 关系 |
|---|---|
| `src/shell/DESIGN.md` | L2 Shell 整体设计,fullscreen-overlay 为 sibling |
| `docs/00-architecture/view-hierarchy.md` | 视图层级总图,L2.4 槽位 |
| `src/slot/interaction-registries/fullscreen-overlay-registry/` | registry 实现 |
| `src/slot/triggers/fullscreen-overlay-controller.ts` | controller 实现 |
