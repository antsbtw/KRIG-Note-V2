/**
 * mathVisual — 交互式函数图形 Block(V1 → V2 迁移 Phase 1B)
 *
 * 设计:
 * - 画布部分是 atom(用户不可直接编辑数据,通过 React UI 改 attrs)
 * - 但**包一个 PM caption**(content: 'block') — 对齐 V2 image/html-block 模式,
 *   PM 原生 keymap 处理 caption 内编辑,figcaption 显示在画布下方
 *
 * attrs:
 * - functions / domain / range / parameters / annotations / canvas
 *   全部走 attrs(JSON-stringified attrs)
 * - tangentLines / normalLines / integralRegions / featurePoints —
 *   Phase 2 全屏工具数据,字段先占位,Phase 1B UI 不创造它们(默认 [])
 * - **title 字段去除**(决议:caption 是唯一标题,放 figcaption)
 *
 * NodeView:React createRoot 桥接,MathVisualComponent 消费 math-rendering
 * capability 的 MathHost 渲染画布(prop-driven 黑盒)。
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';
import { mathVisualNodeView } from './node-view';
import { DEFAULT_CANVAS_CONFIG } from './types';

const mathVisualNodeSpec: NodeSpec = {
  group: 'block',
  content: 'block',         // caption(单段)
  draggable: true,
  selectable: true,
  attrs: {
    functions: {
      default: [{
        id: '1', expression: 'x^2', label: 'f(x)',
        color: '#2D7FF9', style: 'solid', lineWidth: 2.5,
        visible: true, showDerivative: false,
      }],
    },
    domain: { default: [-5, 5] },
    range: { default: [-5, 5] },
    parameters: { default: [] },
    annotations: { default: [] },
    canvas: { default: DEFAULT_CANVAS_CONFIG },
    // 全屏工具(Phase 2 启用)
    tangentLines: { default: [] },
    normalLines: { default: [] },
    integralRegions: { default: [] },
    featurePoints: { default: [] },
    // KRIG 知识图谱挂钩(占位,对齐 image/html-block)
    atomId: { default: null },
  },
  parseDOM: [{
    tag: 'div.krig-math-visual',
    getAttrs(dom) {
      const el = dom as HTMLElement;
      const safeJson = <T,>(key: string, fallback: T): T => {
        try {
          const raw = el.getAttribute(key);
          return raw ? (JSON.parse(raw) as T) : fallback;
        } catch {
          return fallback;
        }
      };
      return {
        functions: safeJson('data-functions', []),
        domain: safeJson('data-domain', [-5, 5]),
        range: safeJson('data-range', [-5, 5]),
        parameters: safeJson('data-parameters', []),
        annotations: safeJson('data-annotations', []),
        canvas: safeJson('data-canvas', DEFAULT_CANVAS_CONFIG),
        tangentLines: safeJson('data-tangent-lines', []),
        normalLines: safeJson('data-normal-lines', []),
        integralRegions: safeJson('data-integral-regions', []),
        featurePoints: safeJson('data-feature-points', []),
      };
    },
  }],
  toDOM(node) {
    const attrs: Record<string, string> = { class: 'krig-math-visual' };
    attrs['data-functions'] = JSON.stringify(node.attrs.functions);
    attrs['data-domain'] = JSON.stringify(node.attrs.domain);
    attrs['data-range'] = JSON.stringify(node.attrs.range);
    attrs['data-parameters'] = JSON.stringify(node.attrs.parameters);
    attrs['data-annotations'] = JSON.stringify(node.attrs.annotations);
    attrs['data-canvas'] = JSON.stringify(node.attrs.canvas);
    if ((node.attrs.tangentLines as unknown[])?.length) attrs['data-tangent-lines'] = JSON.stringify(node.attrs.tangentLines);
    if ((node.attrs.normalLines as unknown[])?.length) attrs['data-normal-lines'] = JSON.stringify(node.attrs.normalLines);
    if ((node.attrs.integralRegions as unknown[])?.length) attrs['data-integral-regions'] = JSON.stringify(node.attrs.integralRegions);
    if ((node.attrs.featurePoints as unknown[])?.length) attrs['data-feature-points'] = JSON.stringify(node.attrs.featurePoints);
    return [
      'div', attrs,
      ['figcaption', { class: 'krig-math-visual__caption' }, 0],
    ];
  },
};

export const mathVisualSpec: BlockSpec = {
  id: 'mathVisual',
  displayName: 'Function Graph',
  spec: mathVisualNodeSpec,
  nodeView: mathVisualNodeView,
  containerRule: 'inline-only',  // caption 只能含 inline 内容
  cascadeBoundary: true,         // atom 视为整体,不可拆
};
