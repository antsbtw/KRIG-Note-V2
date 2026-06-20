/**
 * node-toolbar registry — sectionRegistry + nodeBindingRegistry(L5-G5)
 *
 * 注册式 section 组合的核心:
 * - sectionRegistry:id → SectionDef(一个 section 长什么样)
 * - nodeBindingRegistry:节点类型 → section id 列表(哪个节点显示哪几个 section,数量无上限)
 *
 * 容器(NodeToolbar)**零硬编码 section 清单**:有哪几个 button 完全由 nodeBindingRegistry
 * 按节点类型声明 + sectionRegistry 解析。新增一种节点 / 一种 section,**只注册不改容器**。
 *
 * 详见 docs/RefactorV2/stages/L5G5-node-floating-toolbar-design.md §4.2。
 */

import type { NodeBinding, NodeSnapshot, SectionDef } from './types';

// ── section 注册表 ──

const sections = new Map<string, SectionDef>();

export function registerSection(def: SectionDef): void {
  if (sections.has(def.id)) {
    console.warn(`[node-toolbar] section '${def.id}' already registered, overwriting`);
  }
  sections.set(def.id, def);
}

export function getSection(id: string): SectionDef | undefined {
  return sections.get(id);
}

// ── 节点类型 → section 绑定表 ──
// 先注册者优先(first-match-wins);插件可在内置绑定前 unshift 抢占(暂只 push)。

const bindings: NodeBinding[] = [];

export function registerNodeBinding(binding: NodeBinding): void {
  bindings.push(binding);
}

/**
 * 解析一个节点应展示的 SectionDef[]:
 * 1. 找首个 match 命中的 binding,取其 sections id 列表(顺序即排布顺序)
 * 2. id → SectionDef(查不到的 id 跳过 + warn,不让容器崩)
 *
 * 容器据此渲染 trigger,**自身零硬编码 section 清单**。
 */
export function resolveSections(node: NodeSnapshot): SectionDef[] {
  const binding = bindings.find((b) => b.match(node));
  if (!binding) return [];
  const out: SectionDef[] = [];
  for (const id of binding.sections) {
    const def = sections.get(id);
    if (!def) {
      console.warn(`[node-toolbar] node-binding 引用了未注册 section '${id}',已跳过`);
      continue;
    }
    out.push(def);
  }
  return out;
}
