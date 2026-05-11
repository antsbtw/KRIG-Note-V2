# canvas-rendering capability

> v0.1 · 2026-05-10 · L5-G3
>
> 配套:
> - [../../../docs/RefactorV2/v1-graph-migration-plan.md](../../../docs/RefactorV2/v1-graph-migration-plan.md) v0.2 § 3.3
> - [../../../docs/RefactorV2/stages/L5G3-canvas-rendering-design.md](../../../docs/RefactorV2/stages/L5G3-canvas-rendering-design.md) v0.3
> - 业务规格:[../../../docs/10-business-design/graph/canvas/Canvas.md](../../../docs/10-business-design/graph/canvas/Canvas.md)

## P1-1 严格版屏障核心(本 capability 设计中心)

**本 capability 是 V2 唯一允许 import three 的位置**.

- ESLint config `src/capabilities/**` 默认禁 `'three' / 'three/*'`,
  `src/capabilities/canvas-rendering/**` 例外允许
- 其他位置(view / shape-library / 其他 capability / shell / workspace / slot)
  通过分层屏障规则,真代码 0 import three
- 验证命令(grep,exclude=canvas-rendering 之外应 0 命中):
  ```sh
  grep -rn "from 'three'" src/ --include="*.ts" --include="*.tsx" | grep -v canvas-rendering
  # 期望 0 命中
  ```

详见 docs/RefactorV2/v1-graph-migration-plan.md v0.2 § 0 第 3 条 + § 3.3.

## 职责

封装 Three.js 画板渲染(SceneManager / NodeRenderer / DotGrid + InteractionController)
+ path-to-three(EvaluatedPath → THREE.Shape 投影 — V2 接口对接 shape-library 的纯数据
输出);以 `<Host ref={hostRef} />` 单一面孔暴露给 view.

view 通过 ref 命令式调用 `loadDocument / serialize / setViewport / fitToContent /
zoomTo / deleteSelected / clearSelection / getInstance(s)`;不直 import three.

## 实现位置

| 层 | 路径 | LOC | 备注 |
|---|---|---|---|
| Renderer 入口 | `src/capabilities/canvas-rendering/index.ts` | ~80 | 双导出 + Registry 注册 + alive 行 |
| 类型 | `src/capabilities/canvas-rendering/types.ts` | ~180 | Host API + Instance/InstanceKind/InstanceEndpoint/TextNodeAtoms(V1 直迁) |
| Host 主组件 | `src/capabilities/canvas-rendering/Host.tsx` | ~200 | forwardRef + useImperativeHandle |
| scene/SceneManager.ts | | ~346 | V1 直迁(Three.js 底座 + 视口模型) |
| scene/NodeRenderer.ts | | ~390 | V1 818 砍 line/text/canvas-text-node 后;走 requireCapabilityApi('shape-library') 拿 evaluate(G3-2=A);path-to-three(EvaluatedPath, opts) 转 mesh |
| scene/DotGrid.ts | | ~132 | V1 直迁 |
| scene/path-to-three.ts | | ~370 | V1 395 直迁 + V2 接口改造接 EvaluatedPath(P1-1 屏障核心) |
| interaction/InteractionController.ts | | ~330 | G3 减量版(单选 / 拖动 / Delete / pan / zoom / 选中边框 overlay);砍 V1 1975 的 resize / rotate / marquee / line draw / rewire / addMode / HandlesOverlay / undo/redo / 右键 / link 路由 → 全部 G4 |
| styles.css | | ~25 | Host 容器 + canvas 子元素样式 |

## API 形状

详见 `types.ts` 的 `CanvasHostHandle / CanvasHostProps / CanvasRenderingApi`.

```ts
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { CanvasRenderingApi, CanvasHostHandle, CanvasDocument } from '@capabilities/canvas-rendering/types';

const { Host } = requireCapabilityApi<CanvasRenderingApi>('canvas-rendering');
const hostRef = useRef<CanvasHostHandle>(null);

// 加载画板
hostRef.current?.loadDocument(doc);
// 序列化(view 防抖保存用)
const doc = hostRef.current?.serialize();
// Fit-to-content / zoom / 删除选中 / 清选中
hostRef.current?.fitToContent();
hostRef.current?.zoomTo(100);
hostRef.current?.deleteSelected();
hostRef.current?.clearSelection();

<Host
  ref={hostRef}
  workspaceId={...}
  onViewportChange={(vp) => { /* 持久化 doc.view */ }}
  onSelectionChange={(ids) => { /* toolbar 状态 */ }}
  onInstancesChange={(instances) => { /* 防抖保存 */ }}
/>
```

## 数据流(P1-1 屏障落地)

```
view: hostRef.loadDocument(doc)
   ↓
Host.tsx (canvas-rendering 内部)
   ↓
SceneManager.setView(doc.view)
NodeRenderer.setInstances(doc.instances)
   ↓ (per instance)
NodeRenderer 通过 requireCapabilityApi('shape-library')
   ↓
shape-library.shapes.evaluate(id, props, ctx)
   ↓
EvaluatedPath { d, magnets, textBox, ... }  ← 纯数据,0 含 THREE.* 字面量
   ↓
canvas-rendering/scene/path-to-three.ts (本 capability 内部)
   ↓
THREE.Shape → ShapeGeometry → Mesh
   ↓
scene.add(group)
```

**关键点**:`three` 在 path-to-three 内消费 EvaluatedPath;shape-library 端 0 知道
three 存在,canvas-rendering 端是唯一拥有 three 的"渲染圈".

## W5 严格态边界(audit § 5.2 A)

- **View 侧(强制)**:走 `requireCapabilityApi('canvas-rendering').Host` 间接路由
- **本 capability 内部**:NodeRenderer 走 `requireCapabilityApi('shape-library')`
  拿 shape-library API(G3-2=A,对齐 ebook-rendering Host.tsx 模式)
- **Driver/slot 侧(允许)**:可直 import `CanvasHost` 单例(双导出兜底)

## 装配关系(charter § 1.3 表格)

- canvas-rendering 内部依赖:
  - **运行时**:`@slot/capability-registry/capability-registry`(自注册)+
    `@slot/capability-registry/get-capability-api`(拿 shape-library)
  - **类型 import**:`@capabilities/shape-library/types`(EvaluatedPath / FillStyle / LineStyle 等)
  - **业务 npm**:`three`(P1-1 严格版屏障核心唯一允许位置)
- canvas-rendering 不依赖 graph-library-store(IPC 边界与画板渲染解耦;view 负责
  Document ↔ Host 桥接)
- canvas-rendering 不依赖 canvas-text-node(G4 反向消费:canvas-text-node 通过
  Host 命令式接口挂文字编辑浮层)

## 不做的事(G3 范围外)

| 不做 | 说明 |
|---|---|
| line 渲染 / endpoints 驱动 / magnet 吸附 | V1 LineRenderer 181 + magnet-snap 182 → G4 |
| text label 渲染 + 编辑态浮层 | V1 TextRenderer 197 + edit/* 856 → G4(canvas-text-node) |
| HandlesOverlay + 8 resize handle + rotation handle | V1 278 + interaction resize/rotate 部分 → G4 |
| OBB hit-test(旋转后精确命中) | G3 简单 AABB;G4 引入 OBB |
| marquee 框选 / Shift-click 多选 | V1 InteractionController marquee + multi-select → G4 |
| 添加模式(Picker 触发后点击实例化) | G4 |
| Library Picker / Floating Inspector / Combine Dialog | G4 |
| Cmd+C/V 复制粘贴 / Cmd+Z 撤销 | D-14=B / D-13=B 留 V1 自管,G4 接 |
| 右键菜单 | G5 走 contextMenuRegistry |
| link 路由 / dispatchLinkHref | 独立阶段 |
| 完整 toolbar 注册 | G5 |
