/**
 * mathVisual NodeView — ProseMirror ↔ React 桥接(V2)
 *
 * V2 模式(atom + caption,对齐 html-block / image):
 * - DOM 包含两个区域:`renderWrap`(NodeView 全权控制,contentEditable=false)+
 *   `captionDOM`(PM contentDOM,figcaption)
 * - React createRoot 挂载 `renderWrap`,渲染 MathVisualComponent(消费 math-rendering
 *   capability 的 MathHost)
 * - PM attrs 变化(update 回调)→ rerender React;React `onChange` → `tr.setNodeAttribute`
 *
 * 防御:
 * - `stopEvent` 拦截画布内键盘事件,只放行 ArrowUp/ArrowDown(防 atom 误删);
 *   caption 内编辑由 PM 处理(stopEvent 检查 target 是否在 caption 内)
 * - `ignoreMutation` 忽略 renderWrap 内的 DOM 变化(React 接管,PM 不重渲)
 * - `destroy` cleanup React root + 清引用,memory:react-unmount-cleanup-order
 */

import type { NodeViewConstructor, EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { createRoot, type Root } from 'react-dom/client';
import React from 'react';
import { fullscreenOverlayController } from '@slot/triggers/fullscreen-overlay-controller';
import { helpPanelController } from '@slot/triggers/help-panel-controller';
import { MathVisualComponent } from './MathVisualComponent';
import { setMathVisualFullscreenContext } from './fullscreen/menu-context';
import { setMathVisualHelpContext, MATH_VISUAL_HELP_PANEL_ID } from './help-panel';
import type { MathVisualData } from './types';
import { DEFAULT_CANVAS_CONFIG, DEFAULT_AXIS_CONFIG } from './types';

const FULLSCREEN_OVERLAY_ID = 'text-editing.fullscreen.math-visual';

function findInstanceId(view: EditorView): string | null {
  const el = view.dom.closest('[data-instance-id]') as HTMLElement | null;
  return el?.getAttribute('data-instance-id') ?? null;
}

function getDataFromNode(n: PMNode): MathVisualData {
  return {
    functions: n.attrs.functions || [],
    domain: n.attrs.domain || [-5, 5],
    range: n.attrs.range || [-5, 5],
    parameters: n.attrs.parameters || [],
    annotations: n.attrs.annotations || [],
    canvas: {
      ...DEFAULT_CANVAS_CONFIG,
      ...(n.attrs.canvas || {}),
      axis: { ...DEFAULT_AXIS_CONFIG, ...((n.attrs.canvas || {}).axis || {}) },
    },
    tangentLines: n.attrs.tangentLines || [],
    normalLines: n.attrs.normalLines || [],
    integralRegions: n.attrs.integralRegions || [],
    featurePoints: n.attrs.featurePoints || [],
    toolMode: n.attrs.toolMode || 'move',
  };
}

export const mathVisualNodeView: NodeViewConstructor = (initialNode, view, getPos) => {
  let node = initialNode;

  const dom = document.createElement('div');
  dom.className = 'krig-math-visual';
  dom.setAttribute('data-math-visual', '');

  // render 区(NodeView 全权 — React 挂载)
  const renderWrap = document.createElement('div');
  renderWrap.className = 'krig-math-visual__render';
  renderWrap.contentEditable = 'false';
  dom.appendChild(renderWrap);

  // caption 区(PM contentDOM)
  const captionDOM = document.createElement('figcaption');
  captionDOM.className = 'krig-math-visual__caption';
  dom.appendChild(captionDOM);

  let root: Root | null = null;

  function updateAttrs(newData: MathVisualData): void {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (pos == null) return;
    let tr = view.state.tr;
    tr = tr.setNodeAttribute(pos, 'functions', newData.functions);
    tr = tr.setNodeAttribute(pos, 'domain', newData.domain);
    tr = tr.setNodeAttribute(pos, 'range', newData.range);
    tr = tr.setNodeAttribute(pos, 'parameters', newData.parameters);
    tr = tr.setNodeAttribute(pos, 'annotations', newData.annotations);
    tr = tr.setNodeAttribute(pos, 'canvas', newData.canvas);
    if (newData.tangentLines !== undefined) tr = tr.setNodeAttribute(pos, 'tangentLines', newData.tangentLines);
    if (newData.normalLines !== undefined) tr = tr.setNodeAttribute(pos, 'normalLines', newData.normalLines);
    if (newData.integralRegions !== undefined) tr = tr.setNodeAttribute(pos, 'integralRegions', newData.integralRegions);
    if (newData.featurePoints !== undefined) tr = tr.setNodeAttribute(pos, 'featurePoints', newData.featurePoints);
    if (newData.toolMode !== undefined) tr = tr.setNodeAttribute(pos, 'toolMode', newData.toolMode);
    // React 内部 attr 同步不进 undo 历史 — 否则 cmd+Z 会把这批 AttrStep 倒回去,
    // 且 history 记的 selection 会让光标跳 doc 末尾(2026-05-20 排查)
    tr.setMeta('addToHistory', false);
    view.dispatch(tr);
  }

  function onFullscreen(): void {
    const instanceId = findInstanceId(view);
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (!instanceId || pos == null) return;
    setMathVisualFullscreenContext({ instanceId, nodePos: pos });
    fullscreenOverlayController.show(FULLSCREEN_OVERLAY_ID);
  }

  function onShowHelp(insertFn: (expr: string) => void): void {
    setMathVisualHelpContext({ insertFn });
    helpPanelController.show(MATH_VISUAL_HELP_PANEL_ID);
  }

  function render(): void {
    const data = getDataFromNode(node);
    // widthMode 写到外层 NodeView dom 上,CSS 用 .krig-math-visual.mv-width-* 控宽
    // 只 toggle 自己加的 mv-width-* 类,保留 PM 加的 ProseMirror-selectednode 等类
    const widthMode = data.canvas?.widthMode ?? 'md';
    dom.classList.remove('mv-width-sm', 'mv-width-md', 'mv-width-lg', 'mv-width-full');
    dom.classList.add(`mv-width-${widthMode}`);
    const element = React.createElement(MathVisualComponent, {
      data,
      onChange: updateAttrs,
      onFullscreen,
      onShowHelp,
    });
    if (!root) {
      root = createRoot(renderWrap);
    }
    root.render(element);
  }

  render();

  // 阻止 dom 的原生 dragstart(Mafs pan 需要 pointer events;dragging 由 PM
  // handle/block-handle 控,不走原生 HTML5 drag)
  dom.addEventListener('dragstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
  }, true);

  return {
    dom,
    contentDOM: captionDOM,

    update(updatedNode: PMNode): boolean {
      if (updatedNode.type.name !== 'mathVisual') return false;
      node = updatedNode;
      render();
      return true;
    },

    destroy() {
      if (root) {
        // memory feedback_react_unmount_child_cleanup_order:
        // 父 cleanup 不通过 React handle 取数据(此刻已 unmounting)。
        // 本 NodeView 的"数据写回"路径是 onChange 实时通过 setNodeAttribute,
        // unmount 时 PM doc 已是最新,无需在此再次写。
        root.unmount();
        root = null;
      }
    },

    stopEvent(event: Event): boolean {
      // caption 内的事件让 PM 处理
      const target = event.target as Node | null;
      if (target && captionDOM.contains(target)) {
        return false;
      }

      // 画布区域:键盘事件除 ArrowUp/Down 外全吃,防 Backspace/Delete 误删 atom
      if (event.type === 'keydown') {
        const key = (event as KeyboardEvent).key;
        if (key === 'ArrowUp' || key === 'ArrowDown') {
          return false;
        }
      }

      // 鼠标/拖拽/滚轮事件让 React 处理(MathHost 内 Mafs pan/zoom)
      return true;
    },

    ignoreMutation(mutation): boolean {
      // renderWrap 内是 React 控制区,PM 不应重渲
      return (
        mutation.target === renderWrap ||
        renderWrap.contains(mutation.target as Node)
      );
    },

    selectNode() {
      dom.classList.add('ProseMirror-selectednode');
    },
    deselectNode() {
      dom.classList.remove('ProseMirror-selectednode');
    },
  };
};
