/**
 * layered preset — sugiyama 风格分层布局
 *
 * 适用:流程图 / BPMN / mermaid flowchart / 知识图谱(有向)。
 * 默认 RIGHT 方向(自左向右),节点间距 50,层间距 60(对齐 mermaid 默认体验)。
 */

import type { LayoutOptions } from '../types';

export const layeredPreset: LayoutOptions = {
  algorithm: 'layered',
  direction: 'RIGHT',
  spacing: { node: 50, layer: 60, edge: 10 },
};
