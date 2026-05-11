/**
 * canvas-text-node capability(L5-G4.5)
 *
 * 画板文字节点的 PM 桥接 + 编辑浮层管理.
 *
 * 路径 A(G4-2=B):复用 text-editing.Host 作为 PM 实例,canvas-text-node 当
 * "popup 浮层 + atom 桥接"的薄壳,不自管 schema / plugins / floating-toolbar.
 *
 * 消费路径:
 * - canvas-rendering.NodeRenderer 展示态:textNode.atomBridge.atomsToSvgInput(inst.doc)
 *   → TextRenderer.render → mesh
 * - canvas-rendering.InteractionController 双击文字节点:textNode.enterEdit(opts)
 *   → popup 弹出 → 编辑结束写回 instance.doc(DriverSerialized 形态)
 * - view 端在画板顶层挂 textNode.EditOverlay(渲染 popup 的 React 组件)
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import type { CanvasTextNodeApi } from './types';
import { atomsToSvgInput, isTextNodeRef } from './atom-bridge';
import { EditOverlay } from './edit-overlay';
import { sessionStore } from './session-store';

export type {
  CanvasTextNodeApi,
  EnterEditOptions,
  EditSession,
  AtomBridgeApi,
} from './types';

const api: CanvasTextNodeApi = {
  enterEdit(opts) {
    return sessionStore.set(opts);
  },
  isEditing() {
    return sessionStore.isActive();
  },
  onEditingChange(cb) {
    return sessionStore.subscribe(() => cb(sessionStore.isActive()));
  },
  atomBridge: {
    atomsToSvgInput,
    isTextNodeRef,
  },
  EditOverlay,
};

console.info('[canvas-text-node] alive | text-editing.Host embed + atom-bridge ready');

capabilityRegistry.register({
  id: 'canvas-text-node',
  api,
});
