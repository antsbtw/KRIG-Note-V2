/**
 * drag-and-drop dropTarget 集成 — L5-B3.1 首次真协议消费
 *
 * Q5=A:driver 注册 doc 级 dropTarget,handle 拖拽 source 通过 capability 协议消费。
 *
 * 见 docs/RefactorV2/stages/L5B3.1-interactions-design.md § 3.4。
 */

import { dnd } from '@capabilities/drag-and-drop';
import { instanceRegistry } from '../instance-registry';
import { textEditingDriverApi } from '../api';

const DROP_MIME = 'application/krig-block-source';

export function registerDropTargets(instanceId: string): () => void {
  const targetId = `text-editing-driver:${instanceId}:doc`;

  // 计算 drop 位置:鼠标 y 决定插在哪个 block 之前/之后
  const computeDropPoint = (coords: { x: number; y: number }) => {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return null;
    const view = inst.view;
    if (view.isDestroyed) return null;

    const result = view.posAtCoords({ left: coords.x, top: coords.y });
    if (!result) return null;
    // 把 pos 落到最近的顶层 block 边界(根据鼠标在 block 的上半还是下半)
    const $pos = view.state.doc.resolve(result.pos);
    if ($pos.depth === 0) return null;
    const blockStart = $pos.before(1);
    const block = view.state.doc.nodeAt(blockStart);
    if (!block) return null;
    const blockEnd = blockStart + block.nodeSize;

    // 通过 block DOM rect 判断鼠标在 block 上半还是下半
    let nodeDom: HTMLElement | null = null;
    try {
      nodeDom = view.nodeDOM(blockStart) as HTMLElement | null;
    } catch {
      nodeDom = null;
    }
    if (nodeDom && typeof nodeDom.getBoundingClientRect === 'function') {
      const rect = nodeDom.getBoundingClientRect();
      const middle = rect.top + rect.height / 2;
      return {
        pos: coords.y < middle ? blockStart : blockEnd,
        valid: true,
      };
    }
    // 兜底:用 PM 解析的 pos 对齐 block 起点
    return { pos: blockStart, valid: true };
  };

  dnd.registerDropTarget({
    id: targetId,
    accepts: ['block'],
    computeDropPoint,
    onDrop({ source, target }) {
      const src = source as { type: string; data?: { fromPos: number; instanceId: string } } | null;
      if (!src || src.type !== 'block' || !src.data) return;
      // 只接受同实例 block 拖拽(跨实例留 L5-B3.3)
      if (src.data.instanceId !== instanceId) return;
      textEditingDriverApi.moveBlock(instanceId, src.data.fromPos, target.pos);
    },
  });

  // driver 内部 listener:监听 dnd.over 显示 drop hint(行间蓝线 — 简化版)
  // L5-B3.1 暂不渲染 hint;真有需求后用 widget decoration

  // 监听 native drop event(由 PM editor 内部 dispatchEvent 触发)
  const inst = instanceRegistry.get(instanceId);
  let nativeDropOff: (() => void) | null = null;
  if (inst) {
    const view = inst.view;
    const handleNativeDrop = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      const raw = e.dataTransfer.getData(DROP_MIME);
      if (!raw) return; // 不是我们的 block 拖拽
      try {
        const parsed = JSON.parse(raw) as { instanceId: string; fromPos: number };
        if (parsed.instanceId !== instanceId) return;
        e.preventDefault();
        e.stopPropagation();
        const dropPt = computeDropPoint({ x: e.clientX, y: e.clientY });
        if (!dropPt?.valid) return;
        // 通过 capability 协议路由
        dnd.emit('dnd.over', { target: { pos: dropPt.pos, valid: true } });
        // 真正的 drop:走 capability target.onDrop(已注册到 dropTargets,但这里只能由 capability hub
        // 对应于 source emit 路径触发 — 简化:直接调 onDrop)
        textEditingDriverApi.moveBlock(instanceId, parsed.fromPos, dropPt.pos);
        dnd.emit('dnd.completed', { source: null });
      } catch {
        // ignore
      }
    };
    const handleDragOver = (e: DragEvent) => {
      // 必须 preventDefault 才能 fire drop event
      if (e.dataTransfer?.types?.includes(DROP_MIME)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }
    };
    view.dom.addEventListener('drop', handleNativeDrop);
    view.dom.addEventListener('dragover', handleDragOver);
    nativeDropOff = () => {
      view.dom.removeEventListener('drop', handleNativeDrop);
      view.dom.removeEventListener('dragover', handleDragOver);
    };
  }

  return () => {
    dnd.unregisterDropTarget(targetId);
    nativeDropOff?.();
  };
}
