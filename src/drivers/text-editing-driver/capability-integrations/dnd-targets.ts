/**
 * drag-and-drop dropTarget 集成 — L5-B3.1 首次真协议消费
 *
 * Q5=A:driver 注册 doc 级 dropTarget,handle 拖拽 source 通过 capability 协议消费。
 *
 * 实际 drop 处理:在 build-block-handle-plugin.ts 的 plugin.props.handleDrop 里
 * (PM 推荐做法 — handleDrop 在 PM 默认 drop 处理之前调用,返回 true 截获)。
 * 本文件只负责 capability 协议层的 dropTarget 注册(让 dnd capability 知道 driver
 * 是 block 拖拽的 target — 协议形态完整;真实业务在 plugin)。
 *
 * 之前用 view.dom.addEventListener('drop') 是冒泡阶段监听,PM 默认 drop handler
 * 在更早阶段已把 dataTransfer.text/plain 当文字插入 → 表现为"拖动变复制"。
 * 改用 plugin.props.handleDrop 可在 PM 处理前截获。
 *
 * 见 docs/RefactorV2/stages/L5B3.1-interactions-design.md § 3.4。
 */

import { dnd } from '@capabilities/drag-and-drop';
import { instanceRegistry } from '../instance-registry';

export function registerDropTargets(instanceId: string): () => void {
  const targetId = `text-editing-driver:${instanceId}:doc`;

  dnd.registerDropTarget({
    id: targetId,
    accepts: ['block'],
    computeDropPoint(coords) {
      // 协议层 — 真实 drop 由 plugin.handleDrop 处理,这里仅供其他订阅者查询
      const inst = instanceRegistry.get(instanceId);
      if (!inst) return null;
      const view = inst.view;
      if (view.isDestroyed) return null;
      const result = view.posAtCoords({ left: coords.x, top: coords.y });
      if (!result) return null;
      const $pos = view.state.doc.resolve(result.pos);
      if ($pos.depth === 0) return null;
      return { pos: $pos.before(1), valid: true };
    },
    onDrop() {
      // 协议层 — 实际处理在 plugin.handleDrop
    },
  });

  return () => {
    dnd.unregisterDropTarget(targetId);
  };
}
