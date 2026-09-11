/**
 * diglot-model capability — 「语义描述 ⇄ 图形描述」双向同步内核
 *
 * ⭐ 本 capability 是纯逻辑层:**零 UI、零渲染、零 IPC**,可完全离线测试
 * (43 条不变量断言见 tests/capabilities/diglot/)。
 *
 * ── 消费者 ──
 * - views/graph-canvas-view/MindCanvas.tsx —— mind 渲染器
 *   (走 requireCapabilityApi,不直接 import 本目录运行时值)
 *
 * ── 设计文档 ──
 * docs/10-business-design/diglot/00-diglot-core.md(内核)
 * docs/10-business-design/diglot/01-mind-spec.md(mind 图种)
 * docs/10-business-design/diglot/03-projection-map.md(四面投影 + 落地形态)
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import type { DiglotModelApi } from './types';
import { applyAction, pinnedCount, isCollapsed, mergeKeepingBodies } from './apply-action';
import { detectMindFormat } from './mind-file';
import { toMermaidMindmap } from './mermaid-mindmap';
import { treeToNoteDoc, noteDocToTree, rootTitleOf } from './note-projection';
import { emptyMindFile, fileToSnapshot, snapshotToFile } from './mind-file';
import {
  buildLayoutRequest,
  projectToInstances,
  isTreeLineId,
  resolveDropTarget,
} from './project-to-canvas';

export type { DiglotModelApi } from './types';

const api: DiglotModelApi = {
  fileToSnapshot,
  snapshotToFile,
  emptyMindFile,
  applyAction,
  pinnedCount,
  isCollapsed,
  mergeKeepingBodies,
  detectMindFormat,
  toMermaidMindmap,
  buildLayoutRequest,
  projectToInstances,
  isTreeLineId,
  resolveDropTarget,
  treeToNoteDoc,
  noteDocToTree,
  rootTitleOf,
};

console.info('[diglot-model] alive | S⇄G 双向同步内核(mind v0)');

capabilityRegistry.register({ id: 'diglot-model', api });
