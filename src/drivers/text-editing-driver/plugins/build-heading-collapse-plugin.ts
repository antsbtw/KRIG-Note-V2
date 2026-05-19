/**
 * heading-collapse — 标题折叠 plugin
 *
 * 折叠范围推导:
 *   H1: 到下一个 H1 或文档末尾
 *   H2: 到下一个 H2/H1 或文档末尾
 *   H3: 到下一个 H3/H2/H1 或文档末尾
 *
 * 折叠状态存哪:
 *   仅存活在 plugin state 里(Set<headingPos>),不写 heading.attrs,不持久化。
 *   切笔记 / 重启即重置(用户明确决议:不污染 schema)。
 *
 * 与 V1 (src/plugins/note/toc/) 的差异:
 *   V1 把 open 存 textBlock.attrs.open,doc 中持久化;V2 schema 是 `heading`
 *   独立节点且无 open attr,改走 plugin-internal state map。
 *   每次 docChanged 通过 stepMap 把 pos rebase 到新 doc 上。
 */

import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { Selection } from 'prosemirror-state';
import { instanceRegistry } from '../instance-registry';

interface HeadingCollapseState {
  /** 当前被折叠的 heading 顶层 pos 集合(空 = 全部展开) */
  collapsed: Set<number>;
  /** 缓存:hidden 区间(decoration 渲染用)*/
  hiddenRanges: [number, number][];
  /** 缓存:有效折叠的 heading pos(用于"…"虚线样式) */
  ellipsisPositions: number[];
}

export const headingCollapseKey = new PluginKey<HeadingCollapseState>('headingCollapse');

// ─── 工具:扫顶层 heading 信息 ─────────────────────────────

interface HeadingInfo {
  pos: number;
  level: number; // 1..6
  open: boolean; // 由 collapsed Set 决定
  endPos: number;
}

function collectTopHeadings(
  doc: import('prosemirror-model').Node,
  collapsed: Set<number>,
): HeadingInfo[] {
  const headings: HeadingInfo[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name !== 'heading') return;
    headings.push({
      pos: offset,
      level: node.attrs.level as number,
      open: !collapsed.has(offset),
      endPos: offset + node.nodeSize,
    });
  });
  return headings;
}

// ─── 计算 hidden ranges + ellipsis ────────────────────────

function computeRanges(
  doc: import('prosemirror-model').Node,
  collapsed: Set<number>,
): { hiddenRanges: [number, number][]; ellipsisPositions: number[] } {
  const headings = collectTopHeadings(doc, collapsed);
  const docSize = doc.content.size;

  interface Range { headingPos: number; rangeStart: number; rangeEnd: number; level: number }
  const ranges: Range[] = [];

  for (const h of headings) {
    if (h.open) continue;
    // 找折叠终点:第一个 level <= h.level 的同级或更高级 heading
    let rangeEnd = docSize;
    for (const other of headings) {
      if (other.pos <= h.pos) continue;
      if (other.level <= h.level) {
        rangeEnd = other.pos;
        break;
      }
    }
    const rangeStart = h.endPos;
    if (rangeStart < rangeEnd) {
      ranges.push({ headingPos: h.pos, rangeStart, rangeEnd, level: h.level });
    }
  }

  // 排除被上级折叠范围包含的 heading(它们已经被父隐藏,不再画虚线)
  const hiddenRanges: [number, number][] = [];
  const ellipsisPositions: number[] = [];
  for (const r of ranges) {
    hiddenRanges.push([r.rangeStart, r.rangeEnd]);
    const hiddenByParent = ranges.some(
      (o) => o !== r && o.rangeStart <= r.headingPos && r.headingPos < o.rangeEnd,
    );
    if (!hiddenByParent) ellipsisPositions.push(r.headingPos);
  }
  return { hiddenRanges, ellipsisPositions };
}

// ─── doc 变化时 rebase collapsed pos ──────────────────────

function rebaseCollapsed(tr: Transaction, oldCollapsed: Set<number>): Set<number> {
  if (!tr.docChanged) return oldCollapsed;
  const next = new Set<number>();
  for (const pos of oldCollapsed) {
    const mapped = tr.mapping.mapResult(pos);
    if (mapped.deleted) continue;
    // 验证 mapped 位置仍是 heading;若不是(被改成 paragraph 等)就丢弃
    const node = tr.doc.nodeAt(mapped.pos);
    if (node && node.type.name === 'heading') {
      next.add(mapped.pos);
    }
  }
  return next;
}

// ─── 公共 API(供 driver / TOC 用)────────────────────────

/** 查某 heading 当前是否折叠(handle dynamicLabel 用)*/
export function isHeadingCollapsed(state: EditorState, pos: number): boolean {
  const cur = headingCollapseKey.getState(state);
  return cur ? cur.collapsed.has(pos) : false;
}

/** 切换某 heading 的折叠状态 */
export function toggleHeadingCollapse(view: EditorView, pos: number): void {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'heading') return;
  const cur = headingCollapseKey.getState(view.state);
  if (!cur) return;
  const next = new Set(cur.collapsed);
  if (next.has(pos)) next.delete(pos);
  else next.add(pos);
  view.dispatch(view.state.tr.setMeta(headingCollapseKey, { collapsed: next }));
}

/**
 * 展开到指定级别。
 *   level=1: H1 折叠,后续全藏;level=Infinity: 全展开。
 */
export function expandToLevel(view: EditorView, level: number): void {
  const next = new Set<number>();
  view.state.doc.forEach((node, offset) => {
    if (node.type.name !== 'heading') return;
    const lv = node.attrs.level as number;
    // 当前 level >= 目标值的 heading 折叠;< 目标值的展开
    if (level !== Infinity && lv >= level) next.add(offset);
  });
  view.dispatch(view.state.tr.setMeta(headingCollapseKey, { collapsed: next }));
}

/**
 * 获取当前展开级别(给 TOC 按钮高亮用)
 *   返回 1/2/3/Infinity
 */
export function getCurrentExpandLevel(state: EditorState): number {
  const cur = headingCollapseKey.getState(state);
  if (!cur || cur.collapsed.size === 0) return Infinity;
  let minCollapsedLevel = Infinity;
  for (const pos of cur.collapsed) {
    const node = state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'heading') continue;
    const lv = node.attrs.level as number;
    if (lv < minCollapsedLevel) minCollapsedLevel = lv;
  }
  return minCollapsedLevel;
}

/**
 * 确保目标 heading 可见:展开它自身 + 所有隐藏它的更高级祖先 heading。
 */
export function ensureHeadingVisible(view: EditorView, pos: number): void {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== 'heading') return;
  const targetLevel = node.attrs.level as number;
  const cur = headingCollapseKey.getState(view.state);
  if (!cur) return;
  const next = new Set(cur.collapsed);
  let changed = false;
  // 自身展开
  if (next.has(pos)) { next.delete(pos); changed = true; }
  // 找所有 level < targetLevel 且折叠的祖先,检查折叠范围是否覆盖 pos
  const headings = collectTopHeadings(view.state.doc, cur.collapsed);
  for (const h of headings) {
    if (h.open) continue;
    if (h.level >= targetLevel) continue;
    if (h.pos >= pos) continue;
    // 找 h 的折叠终点
    let rangeEnd = view.state.doc.content.size;
    for (const o of headings) {
      if (o.pos <= h.pos) continue;
      if (o.level <= h.level) { rangeEnd = o.pos; break; }
    }
    if (pos >= h.endPos && pos < rangeEnd) {
      next.delete(h.pos);
      changed = true;
    }
  }
  if (changed) view.dispatch(view.state.tr.setMeta(headingCollapseKey, { collapsed: next }));
}

/** 收集 H1-H3 信息(给 TOC 列表用) */
export interface TocHeadingEntry {
  pos: number;
  level: 1 | 2 | 3;
  text: string;
}

export function extractTocHeadings(state: EditorState): TocHeadingEntry[] {
  const result: TocHeadingEntry[] = [];
  state.doc.forEach((node, offset) => {
    if (node.type.name !== 'heading') return;
    const lv = node.attrs.level as number;
    if (lv < 1 || lv > 3) return;
    result.push({
      pos: offset,
      level: lv as 1 | 2 | 3,
      text: node.textContent || `Heading ${lv}`,
    });
  });
  return result;
}

/** 滚动到 heading + 移动光标(给 TOC 点击用) */
export function scrollToHeadingPos(view: EditorView, pos: number): void {
  ensureHeadingVisible(view, pos);
  requestAnimationFrame(() => {
    if (view.isDestroyed) return;
    try {
      const domPos = view.domAtPos(pos + 1);
      const el = domPos.node instanceof HTMLElement
        ? domPos.node
        : (domPos.node.parentElement ?? null);
      const blockEl = el?.closest('h1, h2, h3, h4, h5, h6') as HTMLElement | null;
      if (blockEl) blockEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const tr = view.state.tr.setSelection(
        Selection.near(view.state.doc.resolve(pos + 1)),
      );
      view.dispatch(tr);
    } catch {
      const tr = view.state.tr.setSelection(
        Selection.near(view.state.doc.resolve(pos + 1)),
      );
      tr.scrollIntoView();
      view.dispatch(tr);
    }
  });
}

// ─── Subscribe bus(view 层 TOC 订阅 collapse/heading 变化用)──────

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

export function subscribeHeadingChange(instanceId: string, cb: Listener): () => void {
  let set = listeners.get(instanceId);
  if (!set) {
    set = new Set();
    listeners.set(instanceId, set);
  }
  set.add(cb);
  return () => {
    const s = listeners.get(instanceId);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) listeners.delete(instanceId);
  };
}

function emitForView(view: EditorView): void {
  const id = instanceRegistry.getInstanceIdByView(view);
  if (!id) return;
  const set = listeners.get(id);
  if (!set) return;
  for (const cb of set) cb();
}

// ─── Plugin ──────────────────────────────────────────────

export function buildHeadingCollapsePlugin(): Plugin<HeadingCollapseState> {
  return new Plugin<HeadingCollapseState>({
    key: headingCollapseKey,

    state: {
      init(_, state) {
        const empty = new Set<number>();
        const r = computeRanges(state.doc, empty);
        return { collapsed: empty, hiddenRanges: r.hiddenRanges, ellipsisPositions: r.ellipsisPositions };
      },
      apply(tr, value, _oldState, newState) {
        // meta 直接覆写 collapsed(toggle/expand/ensure 用)
        const meta = tr.getMeta(headingCollapseKey) as { collapsed: Set<number> } | undefined;
        let collapsed = value.collapsed;
        if (meta?.collapsed) {
          collapsed = meta.collapsed;
        } else if (tr.docChanged) {
          collapsed = rebaseCollapsed(tr, value.collapsed);
        }
        if (collapsed === value.collapsed && !tr.docChanged) return value;
        const r = computeRanges(newState.doc, collapsed);
        return { collapsed, hiddenRanges: r.hiddenRanges, ellipsisPositions: r.ellipsisPositions };
      },
    },

    props: {
      decorations(state) {
        const s = headingCollapseKey.getState(state);
        if (!s) return null;
        const decorations: Decoration[] = [];
        for (const [from, to] of s.hiddenRanges) {
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (pos >= from && pos < to) {
              const nodeEnd = pos + node.nodeSize;
              if (nodeEnd <= to) {
                decorations.push(Decoration.node(pos, nodeEnd, { class: 'heading-collapsed-hidden' }));
              }
              return false;
            }
            return true;
          });
        }
        for (const headingPos of s.ellipsisPositions) {
          const node = state.doc.nodeAt(headingPos);
          if (node) {
            decorations.push(Decoration.node(headingPos, headingPos + node.nodeSize, { class: 'heading-collapsed' }));
          }
        }
        return DecorationSet.create(state.doc, decorations);
      },
    },

    view(editorView) {
      // mount 时主动 emit 一次,让订阅方拿到首屏 heading 列表
      queueMicrotask(() => emitForView(editorView));
      return {
        update(view, prevState) {
          // doc 变 / collapsed 变 → emit
          const cur = headingCollapseKey.getState(view.state);
          const prev = headingCollapseKey.getState(prevState);
          const docChanged = view.state.doc !== prevState.doc;
          const collapsedChanged = cur?.collapsed !== prev?.collapsed;
          if (docChanged || collapsedChanged) emitForView(view);
        },
      };
    },
  });
}
