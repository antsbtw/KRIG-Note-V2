/**
 * node-toolbar capability — Graph 节点浮条(L5-G5)
 *
 * 选中画板节点 → 选中框正下方居中浮出 Freeform 风格 pill 工具条 → 按节点类型注册声明
 * 哪几个属性面板(Fill / Line / Text / Type)→ 改属性节点实时更新。
 *
 * ★ view-agnostic 共享 capability:任何 Graph view(canvas / family-tree / …)都能复用。
 * 容器零硬编码 section 清单 —— 有哪几个 button 完全由 nodeBindingRegistry 声明(数量无上限)。
 *
 * ── W5 严格态 A 边界 ──
 * 0 直接 import three / prosemirror / @drivers 运行时;改属性走 view 注入回调
 * (落地到 canvas-rendering host.updateInstance / text-editing.runNodeStyleCommand)。
 *
 * 双导出 + capabilityRegistry.register 范式对齐 graph-library-store / shape-library。
 *
 * 详见 docs/RefactorV2/stages/L5G5-node-floating-toolbar-design.md v0.3。
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';

import { NodeToolbar } from './NodeToolbar';
import {
  registerSection,
  registerNodeBinding,
  resolveSections,
} from './registry';
import { fillSection } from './sections/fill';
import { lineSection } from './sections/line';
import { textSection } from './sections/text';
import { typeSection } from './sections/type';
import type { NodeToolbarApi } from './types';

export type {
  NodeToolbarApi,
  NodeToolbarProps,
  NodeSnapshot,
  NodeSemanticKind,
  NodeStyleOverrides,
  SectionDef,
  SectionContext,
  NodeBinding,
  ToolbarAnchor,
  TextNodeStyleCommand,
} from './types';

export { NodeToolbar } from './NodeToolbar';
export { registerSection, registerNodeBinding, resolveSections } from './registry';

// ── 内置 4 section 注册 ──
registerSection(fillSection);
registerSection(lineSection);
registerSection(textSection);
registerSection(typeSection);

// ── 内置 canvas 节点类型 → section 绑定(其它 view 可继续 registerNodeBinding 扩展)──
// 容器零硬编码:浮条上有哪几个 button 完全由这些声明决定。
registerNodeBinding({
  // 普通几何形:Fill + Line
  match: (node) => node.kind === 'shape',
  sections: ['fill', 'line'],
});
registerNodeBinding({
  // 线条:Line + Arrow(无 Fill);arrow section 待后续,先只 line
  match: (node) => node.kind === 'line',
  sections: ['line'],
});
registerNodeBinding({
  // 文字节点:Fill(底色)+ Text(复用 note)+ Type(画板字体字号)
  match: (node) => node.kind === 'text',
  sections: ['fill', 'text', 'type'],
});

// ── W5 严格态:Registry 注册 + api 字段(view 通过 requireCapabilityApi 间接路由)──
capabilityRegistry.register({
  id: 'node-toolbar',
  api: {
    NodeToolbar,
    registerSection,
    registerNodeBinding,
    resolveSections,
  } satisfies NodeToolbarApi,
});

console.info('[node-toolbar] alive | sections: fill/line/text/type, registry ready');
