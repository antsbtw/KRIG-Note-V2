/**
 * canvas-rendering capability — Three.js 画板渲染主能力(L5-G3)
 *
 * **P1-1 严格版屏障核心**:本 capability **是 V2 唯一允许 import three 的位置**.
 * 通过 ESLint config 例外允许 src/capabilities/canvas-rendering/** import three;
 * 其他位置(view / shape-library / 其他 capability / shell / workspace / slot)0 import.
 *
 * 详见 docs/RefactorV2/v1-graph-migration-plan.md v0.2 § 0 第 3 条 + § 3.3.
 *
 * ── 下游消费者(规划)──
 *
 * - L5-G3 views/graph-canvas-view/GraphCanvasView 接 Host ref(本段实现)
 * - L5-G4 canvas-text-node capability:用 Host 的命令式接口在文字节点上挂浮层
 * - 里程碑 H family-tree variant:通过 install 拿同一个 Host(渲染由 projection
 *   产生的 instance 数据)
 *
 * ── W5 严格态 A 边界(audit 2026-05-08 § 5.2)──
 *
 * - View 侧(强制):走 requireCapabilityApi('canvas-rendering').Host 间接路由
 *   (G3-13 view 主体 ≤200 行)
 * - capability 层间(本 capability 内 NodeRenderer):
 *   `requireCapabilityApi<ShapeLibraryApi>('shape-library')` 拿 shapes/substances
 *   API(G3-2=A,对齐 V2 既有 ebook-rendering Host.tsx 模式)
 *
 * 模块级 export 同时挂(双导出),对齐 V2 既有 capability 现行写法.
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import { REVISION as THREE_REVISION } from 'three';
import type { CanvasRenderingApi } from './types';
import { CanvasHost } from './Host';
import { LibraryPicker } from './ui/library-picker';
import { CreateSubstanceDialog } from './ui/create-substance-dialog';

// 类型 re-export(view 端走 `import type from '@capabilities/canvas-rendering/types'`
// 也可走 `from '@capabilities/canvas-rendering'`,两路径都可)
export type {
  CanvasRenderingApi,
  CanvasHostHandle,
  CanvasHostProps,
  CanvasDocument,
  Viewport,
  Instance,
  InstanceKind,
  InstanceEndpoint,
  TextNodeAtoms,
  AddModeSpec,
} from './types';

// 模块级 export(W5 边界 A 临时允许项 — driver/slot 内部可直 import;view 侧仍走 requireCapabilityApi)
export { CanvasHost };

// G4.4a UI 浮层(画板内浮层归 capability,charter § 1.4 + design G4-11=A)
// view 端直接 import 使用(open / anchorRect / onPick / onClose 全 view 控制)
export { LibraryPicker } from './ui/library-picker';
export type { LibraryPickerProps } from './ui/library-picker';
// FloatingInspector(右上角 Format Shape 浮窗)L5-G5 删除 — 被 node-toolbar
// (选中框跟随浮条)取代,view 早已不引用(GraphCanvasView.tsx commit 5833c17e)。
export { CreateSubstanceDialog } from './ui/create-substance-dialog';
export type {
  CreateSubstanceDialogProps,
  CreateSubstanceFormResult,
} from './ui/create-substance-dialog';

// ── 自我诊断(charter § 5)──
console.info(
  `[canvas-rendering] alive | three: ${THREE_REVISION}, scene/interaction ready`,
);

// ── W5 严格态 Registry 注册 ──

capabilityRegistry.register({
  id: 'canvas-rendering',
  api: {
    Host: CanvasHost,
    LibraryPicker,
    CreateSubstanceDialog,
  } satisfies CanvasRenderingApi,
});
