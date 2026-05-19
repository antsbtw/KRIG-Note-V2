/**
 * driver API — view command handler 通过此调 driver
 *
 * 见 L5B2 设计 § 3.4 + L5B3.1 设计 § 3.5。
 *
 * 边界:view 不持有 EditorView,通过 instanceId 路由到具体实例。
 *       view 不接触 PM 内部对象 — driver api 是 driver 的对外契约。
 */

import { toggleMark, setBlockType } from 'prosemirror-commands';
import { undo, redo } from 'prosemirror-history';
import { TextSelection } from 'prosemirror-state';
import { wrapInList } from 'prosemirror-schema-list';
import { DOMSerializer, Fragment, Node as PMNode } from 'prosemirror-model';
import { sliceToMarkdown, type SerializeResult } from './serializers/pm-to-markdown';
import { instanceRegistry } from './instance-registry';
import { clearSlashTrigger } from './plugins/build-slash-plugin';
import { scrollToBlockAnchor } from './plugins/build-link-click-plugin';
import {
  scrollToThoughtAnchor as scrollToThoughtAnchorImpl,
  thoughtAnchorKey,
} from './plugins/build-thought-anchor-plugin';
import {
  vocabHighlightPluginKey,
  updateVocabDefs,
} from './plugins/build-vocab-highlight-plugin';
import { insertTable as insertTableCommand } from './blocks/table';
import { insertColumnList as insertColumnListCommand } from './blocks/column-list';

export type MarkName = 'bold' | 'italic' | 'underline' | 'strike' | 'code';

export interface ActiveBlockType {
  name: string;
  level: number | null;
}

export const textEditingDriverApi = {
  /** toggle mark on current selection */
  toggleMark(instanceId: string, markName: MarkName): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const markType = inst.view.state.schema.marks[markName];
    if (!markType) return;
    toggleMark(markType)(inst.view.state, inst.view.dispatch);
    inst.view.focus();
  },

  /**
   * 给指定 range 设置文字颜色(textStyle mark);color 为空字符串时移除。
   * range 缺省时取当前 selection(对齐 V1 applyTextColor / floating toolbar 用法)。
   * 显式传 range:handle 菜单 / 程序化批量改色等场景用。
   */
  setTextColor(instanceId: string, color: string, range?: { from: number; to: number }): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const markType = inst.view.state.schema.marks.textStyle;
    if (!markType) return;
    const { from, to } = range ?? inst.view.state.selection;
    if (from >= to) return;
    const tr = inst.view.state.tr;
    if (!color) {
      tr.removeMark(from, to, markType);
    } else {
      tr.removeMark(from, to, markType); // 先清旧色,避免叠加
      tr.addMark(from, to, markType.create({ color }));
    }
    inst.view.dispatch(tr);
    inst.view.focus();
  },

  /**
   * 给指定 range 设置背景高亮色(highlight mark);color 为空字符串时移除。
   * range 缺省时取当前 selection(对齐 V1 applyHighlight / floating toolbar 用法)。
   * 显式传 range:handle 菜单 / 程序化批量改色等场景用。
   */
  setHighlight(instanceId: string, color: string, range?: { from: number; to: number }): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const markType = inst.view.state.schema.marks.highlight;
    if (!markType) return;
    const { from, to } = range ?? inst.view.state.selection;
    if (from >= to) return;
    const tr = inst.view.state.tr;
    if (!color) {
      tr.removeMark(from, to, markType);
    } else {
      tr.removeMark(from, to, markType);
      tr.addMark(from, to, markType.create({ color }));
    }
    inst.view.dispatch(tr);
    inst.view.focus();
  },

  /**
   * 给整个 block 设文字色(handle 菜单 Color panel 用)。
   *
   * 分流:
   * - mathBlock(marks:'',禁用 inline marks)→ 走 node attr `color` 路径
   * - 其他 block → 把整块内部 range 一起加 textStyle mark
   *
   * color 为空字符串时移除(mathBlock 设 null,其他清 mark)。
   */
  applyBlockTextColor(instanceId: string, blockPos: number, color: string): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const node = inst.view.state.doc.nodeAt(blockPos);
    if (!node) return;
    if (node.type.name === 'mathBlock') {
      const tr = inst.view.state.tr.setNodeMarkup(blockPos, null, {
        ...node.attrs,
        color: color || null,
      });
      inst.view.dispatch(tr);
      inst.view.focus();
      return;
    }
    // 普通 block:把内部 range 喂给 setTextColor(复用同一算子)
    this.setTextColor(instanceId, color, {
      from: blockPos + 1,
      to: blockPos + node.nodeSize - 1,
    });
  },

  /**
   * 给整个 block 设背景色(handle 菜单 Color panel 用)。
   *
   * 分流同 applyBlockTextColor:mathBlock 走 node attr `bgColor`,
   * 其他 block 把整块 range 喂给 setHighlight。
   */
  applyBlockBgColor(instanceId: string, blockPos: number, color: string): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const node = inst.view.state.doc.nodeAt(blockPos);
    if (!node) return;
    if (node.type.name === 'mathBlock') {
      const tr = inst.view.state.tr.setNodeMarkup(blockPos, null, {
        ...node.attrs,
        bgColor: color || null,
      });
      inst.view.dispatch(tr);
      inst.view.focus();
      return;
    }
    this.setHighlight(instanceId, color, {
      from: blockPos + 1,
      to: blockPos + node.nodeSize - 1,
    });
  },

  /**
   * 给 callout block 设 emoji attr(emoji picker popup 用)。
   *
   * 仅作用于 callout block;其他 block 类型静默忽略(防误用)。
   *
   * D023 / D024 §4.4 字面互斥副作用:同步清 iconName + imageSrc(切回 emoji 模式),
   * 单 API 调用一次完成"切回 emoji 且清掉其他态"语义,view caller
   * 不必字面记得三 API 配对。
   */
  setCalloutEmoji(instanceId: string, blockPos: number, emoji: string): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const node = inst.view.state.doc.nodeAt(blockPos);
    if (!node || node.type.name !== 'callout') return;
    const tr = inst.view.state.tr.setNodeMarkup(blockPos, null, {
      ...node.attrs,
      emoji,
      iconName: null,
      imageSrc: null,
    });
    inst.view.dispatch(tr);
  },

  /**
   * 给 callout block 设 iconName attr(D023 Icons tab 用)。
   *
   * iconName 非 null 时 NodeView 字面渲 lucide `<svg>` 取代 emoji;
   * iconName === null 字面表示"取消 icon",回退到 emoji 渲染(emoji 字段保留)。
   *
   * 仅作用于 callout block;其他 block 类型静默忽略(防误用)。
   * emoji 字段字面不动(D023 §4.4 — iconName 优先单点判定,emoji 是 fallback)。
   *
   * D024 §4.4 互斥副作用:同步清 imageSrc(切回 icon 模式,emoji 保留作 fallback)。
   */
  setCalloutIcon(instanceId: string, blockPos: number, iconName: string | null): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const node = inst.view.state.doc.nodeAt(blockPos);
    if (!node || node.type.name !== 'callout') return;
    const tr = inst.view.state.tr.setNodeMarkup(blockPos, null, {
      ...node.attrs,
      iconName,
      imageSrc: null,
    });
    inst.view.dispatch(tr);
  },

  /**
   * 给 callout block 设 imageSrc attr(D024 Upload tab 用)。
   *
   * imageSrc 非 null 时 NodeView 字面渲 `<img>` 取代 emoji / icon;
   * imageSrc === null 字面表示"取消 image",回退到 emoji / iconName 渲染(字段保留)。
   *
   * 仅作用于 callout block;其他 block 类型静默忽略(防误用)。
   * D024 §4.4 互斥副作用:同步清 iconName(切回 image 模式,emoji 保留作 fallback)。
   * emoji 字段字面不动(NodeView 渲染优先级 imageSrc > iconName > emoji)。
   */
  setCalloutImage(instanceId: string, blockPos: number, imageSrc: string | null): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const node = inst.view.state.doc.nodeAt(blockPos);
    if (!node || node.type.name !== 'callout') return;
    const tr = inst.view.state.tr.setNodeMarkup(blockPos, null, {
      ...node.attrs,
      imageSrc,
      iconName: null,
    });
    inst.view.dispatch(tr);
  },

  // ── Block 框定(frame) ── L5-Frame

  /**
   * 给一组 block 设框定(对齐 V1 addBlockFrameGroup)。
   *
   * - positions.length === 1:不设 groupId(单块 only 渲染)
   * - positions.length > 1:生成 groupId,多块共享(首/中/尾连成整体)
   *
   * 任一 position 无对应 node 时跳过该 position(不抛错)。
   */
  setBlockFrame(
    instanceId: string,
    positions: number[],
    color: string,
    style: 'solid' | 'double' = 'solid',
  ): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst || positions.length === 0) return;
    const groupId =
      positions.length > 1
        ? `frame-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        : null;
    let tr = inst.view.state.tr;
    let changed = false;
    for (const pos of positions) {
      const node = tr.doc.nodeAt(pos);
      if (!node || !node.isBlock) continue;
      tr = tr.setNodeMarkup(pos, null, {
        ...node.attrs,
        frameColor: color,
        frameStyle: style,
        frameGroupId: groupId,
      });
      changed = true;
    }
    if (changed) inst.view.dispatch(tr);
  },

  /**
   * 修改框定颜色(已有框定才生效)。
   *
   * 若 block 有 frameGroupId,同步更新同组所有 block 的颜色(group 必须色一致)。
   */
  updateBlockFrameColor(instanceId: string, blockPos: number, color: string): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const node = inst.view.state.doc.nodeAt(blockPos);
    if (!node || !node.attrs.frameColor) return;
    const groupId = node.attrs.frameGroupId as string | null;
    let tr = inst.view.state.tr;
    if (groupId) {
      inst.view.state.doc.forEach((child, offset) => {
        if (child.attrs.frameGroupId === groupId) {
          tr = tr.setNodeMarkup(offset, null, { ...child.attrs, frameColor: color });
        }
      });
    } else {
      tr = tr.setNodeMarkup(blockPos, null, { ...node.attrs, frameColor: color });
    }
    inst.view.dispatch(tr);
  },

  /**
   * 修改框定线型(对齐 updateBlockFrameColor 的 group 行为)。
   */
  updateBlockFrameStyle(
    instanceId: string,
    blockPos: number,
    style: 'solid' | 'double',
  ): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const node = inst.view.state.doc.nodeAt(blockPos);
    if (!node || !node.attrs.frameColor) return;
    const groupId = node.attrs.frameGroupId as string | null;
    let tr = inst.view.state.tr;
    if (groupId) {
      inst.view.state.doc.forEach((child, offset) => {
        if (child.attrs.frameGroupId === groupId) {
          tr = tr.setNodeMarkup(offset, null, { ...child.attrs, frameStyle: style });
        }
      });
    } else {
      tr = tr.setNodeMarkup(blockPos, null, { ...node.attrs, frameStyle: style });
    }
    inst.view.dispatch(tr);
  },

  /**
   * 删除框定(对齐 V1 removeBlockFrame,group 同步清)。
   */
  removeBlockFrame(instanceId: string, blockPos: number): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const node = inst.view.state.doc.nodeAt(blockPos);
    if (!node) return;
    const groupId = node.attrs.frameGroupId as string | null;
    let tr = inst.view.state.tr;
    if (groupId) {
      inst.view.state.doc.forEach((child, offset) => {
        if (child.attrs.frameGroupId === groupId) {
          tr = tr.setNodeMarkup(offset, null, {
            ...child.attrs,
            frameColor: null,
            frameStyle: null,
            frameGroupId: null,
          });
        }
      });
    } else {
      tr = tr.setNodeMarkup(blockPos, null, {
        ...node.attrs,
        frameColor: null,
        frameStyle: null,
        frameGroupId: null,
      });
    }
    inst.view.dispatch(tr);
  },

  /**
   * 取 block 的 frame 信息(submenu active 状态用)。
   */
  getBlockFrame(
    instanceId: string,
    blockPos: number,
  ): { color: string; style: string; groupId: string | null } | null {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return null;
    const node = inst.view.state.doc.nodeAt(blockPos);
    if (!node) return null;
    const color = node.attrs.frameColor as string | null;
    if (!color) return null;
    return {
      color,
      style: (node.attrs.frameStyle as string | null) ?? 'solid',
      groupId: (node.attrs.frameGroupId as string | null) ?? null,
    };
  },

  /**
   * 取当前选区覆盖的顶层 block 位置(context menu 多选场景)。
   *
   * 走 MultipleNodeSelection 优先 / fallback 文本选区交集。
   */
  getSelectedTopLevelBlockPositions(instanceId: string): number[] {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return [];
    const { from, to } = inst.view.state.selection;
    const positions: number[] = [];
    inst.view.state.doc.forEach((node, offset) => {
      if (!node.isBlock) return;
      const nodeEnd = offset + node.nodeSize;
      if (offset < to && nodeEnd > from) {
        positions.push(offset);
      }
    });
    return positions;
  },

  // ── Block 排版(align / textIndent / indent) ── L5-Frame

  /**
   * 设 block 对齐(仅 paragraph / heading 有 align attr,其他静默)。
   */
  setBlockAlign(
    instanceId: string,
    blockPos: number,
    align: 'left' | 'center' | 'right',
  ): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const node = inst.view.state.doc.nodeAt(blockPos);
    if (!node) return;
    if (node.attrs.align === undefined) return;
    inst.view.dispatch(
      inst.view.state.tr.setNodeMarkup(blockPos, null, { ...node.attrs, align }),
    );
  },

  /**
   * 切换 block 首行缩进(仅 paragraph / heading 有 textIndent attr)。
   */
  toggleBlockTextIndent(instanceId: string, blockPos: number): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const node = inst.view.state.doc.nodeAt(blockPos);
    if (!node) return;
    if (node.attrs.textIndent === undefined) return;
    inst.view.dispatch(
      inst.view.state.tr.setNodeMarkup(blockPos, null, {
        ...node.attrs,
        textIndent: !node.attrs.textIndent,
      }),
    );
  },

  /**
   * 调整 block 布局缩进(indent attr,范围 0-8)。
   *
   * delta = ±1;边界外不动(0 不能再 outdent,8 不能再 indent)。
   * indent attr 通过 schema-builder injectFrameworkAttrs 给所有 group:'block' 注入,
   * 所以这里不需要 attrs?.indent 防御性 undefined 检查 — schema 已保证有该 attr。
   */
  adjustBlockIndent(instanceId: string, blockPos: number, delta: 1 | -1): boolean {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return false;
    const node = inst.view.state.doc.nodeAt(blockPos);
    if (!node) return false;
    const current = (node.attrs.indent as number | undefined) ?? 0;
    const MAX_INDENT = 8;
    const next = Math.max(0, Math.min(MAX_INDENT, current + delta));
    if (next === current) return false;
    inst.view.dispatch(
      inst.view.state.tr.setNodeMarkup(blockPos, null, { ...node.attrs, indent: next }),
    );
    return true;
  },

  /**
   * 取 block 排版 attrs(submenu active 状态用)。
   *
   * align / textIndent 可能为 undefined(非 paragraph/heading);indent 一定有(框架注入)。
   */
  getBlockFormat(
    instanceId: string,
    blockPos: number,
  ): { align: 'left' | 'center' | 'right' | null; textIndent: boolean | null; indent: number } | null {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return null;
    const node = inst.view.state.doc.nodeAt(blockPos);
    if (!node) return null;
    return {
      align: (node.attrs.align as 'left' | 'center' | 'right' | undefined) ?? null,
      textIndent: (node.attrs.textIndent as boolean | undefined) ?? null,
      indent: (node.attrs.indent as number | undefined) ?? 0,
    };
  },

  /**
   * 取 block 的文字色(handle Color panel active swatch 高亮用)。
   *
   * mathBlock 读 node.attrs.color;其他 block 取**第一个**带 textStyle 的子节点 color。
   * 子节点无 textStyle 或整块未着色 → null。
   */
  getBlockTextColor(instanceId: string, blockPos: number): string | null {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return null;
    const node = inst.view.state.doc.nodeAt(blockPos);
    if (!node) return null;
    if (node.type.name === 'mathBlock') {
      return (node.attrs.color as string | null) ?? null;
    }
    const markType = inst.view.state.schema.marks.textStyle;
    if (!markType) return null;
    let found: string | null = null;
    node.descendants((child) => {
      if (found) return false;
      const m = markType.isInSet(child.marks);
      if (m) found = (m.attrs.color as string | null) ?? null;
      return true;
    });
    return found;
  },

  /**
   * 取 block 的背景色(handle Color panel active swatch 高亮用)。
   * 语义同 getBlockTextColor,mark 换成 highlight。
   */
  getBlockBgColor(instanceId: string, blockPos: number): string | null {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return null;
    const node = inst.view.state.doc.nodeAt(blockPos);
    if (!node) return null;
    if (node.type.name === 'mathBlock') {
      return (node.attrs.bgColor as string | null) ?? null;
    }
    const markType = inst.view.state.schema.marks.highlight;
    if (!markType) return null;
    let found: string | null = null;
    node.descendants((child) => {
      if (found) return false;
      const m = markType.isInSet(child.marks);
      if (m) found = (m.attrs.color as string | null) ?? null;
      return true;
    });
    return found;
  },

  /** 取选区第一个 textStyle mark 的 color attr(无则 null)*/
  getActiveTextColor(instanceId: string): string | null {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return null;
    const markType = inst.view.state.schema.marks.textStyle;
    if (!markType) return null;
    const { from, to, $from } = inst.view.state.selection;
    if (from >= to) {
      const m = markType.isInSet($from.marks());
      return (m?.attrs.color as string | null) ?? null;
    }
    let found: string | null = null;
    inst.view.state.doc.nodesBetween(from, to, (node) => {
      if (found) return false;
      const m = markType.isInSet(node.marks);
      if (m) found = (m.attrs.color as string | null) ?? null;
      return true;
    });
    return found;
  },

  /**
   * 给选区添加 link mark(对齐 V1 applyLink)
   * - href 为空字符串:no-op(不允许空 link)
   * - selection 为光标(from === to):no-op(必须有选区,对齐 V1 + 简单)
   * - 已有 link 时先移除再加(避免叠加 / attr 失效)
   */
  setLink(instanceId: string, href: string, title?: string): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    if (!href) return;
    const markType = inst.view.state.schema.marks.link;
    if (!markType) return;
    const { from, to } = inst.view.state.selection;
    if (from >= to) return;
    const tr = inst.view.state.tr;
    tr.removeMark(from, to, markType);
    tr.addMark(from, to, markType.create({ href, title: title ?? null }));
    inst.view.dispatch(tr);
    inst.view.focus();
  },

  /**
   * 移除选区 link mark(对齐 V1 removeLink)
   * - 选区非空:移除选区范围内的 link
   * - 光标态:找到光标所在 link 的完整范围 + 移除
   */
  removeLink(instanceId: string): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const markType = inst.view.state.schema.marks.link;
    if (!markType) return;
    const { from, to } = inst.view.state.selection;
    if (from < to) {
      inst.view.dispatch(inst.view.state.tr.removeMark(from, to, markType));
      inst.view.focus();
      return;
    }
    // 光标态:扩展到 link 范围
    const $pos = inst.view.state.doc.resolve(from);
    const parent = $pos.parent;
    const parentStart = $pos.start();
    let linkFrom = from;
    let linkTo = from;
    parent.forEach((node, offset) => {
      const nodeStart = parentStart + offset;
      const nodeEnd = nodeStart + node.nodeSize;
      if (nodeStart <= from && from <= nodeEnd && markType.isInSet(node.marks)) {
        linkFrom = nodeStart;
        linkTo = nodeEnd;
      }
    });
    if (linkFrom < linkTo) {
      inst.view.dispatch(inst.view.state.tr.removeMark(linkFrom, linkTo, markType));
      inst.view.focus();
    }
  },

  /**
   * 移除指定 viewport 坐标处的 link mark(L5-B3.15)
   *
   * 用于右键移除链接 — 不要求用户先选中 link 文字,光标落在 link 内或没光标都能用。
   * 流程:posAtCoords 把鼠标点 (x, y) 转 PM pos → 跳到该位置 → 走 removeLink
   * 同款"扩展到完整 link 范围"逻辑。
   *
   * 失败(坐标不在编辑器内 / 没 link)— 静默 noop
   */
  removeLinkAtClientPoint(instanceId: string, x: number, y: number): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const view = inst.view;
    const markType = view.state.schema.marks.link;
    if (!markType) return;

    // 把鼠标坐标转 PM 位置
    const posResult = view.posAtCoords({ left: x, top: y });
    if (!posResult) return;
    const pos = posResult.pos;

    // 找该位置所在的 link 范围(含完整 link mark 的所有连续字符)
    const $pos = view.state.doc.resolve(pos);
    const parent = $pos.parent;
    const parentStart = $pos.start();
    let linkFrom = -1;
    let linkTo = -1;
    parent.forEach((node, offset) => {
      const nodeStart = parentStart + offset;
      const nodeEnd = nodeStart + node.nodeSize;
      if (nodeStart <= pos && pos <= nodeEnd && markType.isInSet(node.marks)) {
        linkFrom = nodeStart;
        linkTo = nodeEnd;
      }
    });
    if (linkFrom < 0 || linkTo <= linkFrom) return;
    view.dispatch(view.state.tr.removeMark(linkFrom, linkTo, markType));
    view.focus();
  },

  /** 取选区/光标处 link mark 的 href(无则 null)*/
  getActiveLinkHref(instanceId: string): string | null {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return null;
    const markType = inst.view.state.schema.marks.link;
    if (!markType) return null;
    const { from, to, $from } = inst.view.state.selection;
    if (from >= to) {
      const m = markType.isInSet($from.marks());
      return (m?.attrs.href as string | null) ?? null;
    }
    let found: string | null = null;
    inst.view.state.doc.nodesBetween(from, to, (node) => {
      if (found) return false;
      const m = markType.isInSet(node.marks);
      if (m) found = (m.attrs.href as string | null) ?? null;
      return true;
    });
    return found;
  },

  /** 取选区第一个 highlight mark 的 color attr(无则 null)*/
  getActiveHighlight(instanceId: string): string | null {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return null;
    const markType = inst.view.state.schema.marks.highlight;
    if (!markType) return null;
    const { from, to, $from } = inst.view.state.selection;
    if (from >= to) {
      const m = markType.isInSet($from.marks());
      return (m?.attrs.color as string | null) ?? null;
    }
    let found: string | null = null;
    inst.view.state.doc.nodesBetween(from, to, (node) => {
      if (found) return false;
      const m = markType.isInSet(node.marks);
      if (m) found = (m.attrs.color as string | null) ?? null;
      return true;
    });
    return found;
  },

  /** set current block to heading level (or null = paragraph) */
  setHeading(instanceId: string, level: number | null): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const schema = inst.view.state.schema;
    if (level === null) {
      const paragraphType = schema.nodes.paragraph;
      if (!paragraphType) return;
      setBlockType(paragraphType)(inst.view.state, inst.view.dispatch);
    } else {
      const headingType = schema.nodes.heading;
      if (!headingType) return;
      setBlockType(headingType, { level })(inst.view.state, inst.view.dispatch);
    }
    inst.view.focus();
  },

  undo(instanceId: string): boolean {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return false;
    const ok = undo(inst.view.state, inst.view.dispatch);
    if (ok) inst.view.focus();
    return ok;
  },

  redo(instanceId: string): boolean {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return false;
    const ok = redo(inst.view.state, inst.view.dispatch);
    if (ok) inst.view.focus();
    return ok;
  },

  /** 当前 selection 上激活的 mark 名称列表(给 Toolbar / 菜单 active 状态用)*/
  getActiveMarks(instanceId: string): string[] {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return [];
    return computeActiveMarks(inst.view.state);
  },

  /** 当前 selection 所在 block 的类型 + heading level */
  getActiveBlockType(instanceId: string): ActiveBlockType {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return { name: '', level: null };
    const $from = inst.view.state.selection.$from;
    const node = $from.node($from.depth);
    return {
      name: node.type.name,
      level: node.type.name === 'heading' ? (node.attrs.level as number) : null,
    };
  },

  // ── L5-B3.1:handle / context-menu / slash 用 ──

  /** 清除 slash menu 触发的 / 跟 query(slash 命令调用前)*/
  clearSlashTrigger(instanceId: string): boolean {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return false;
    return clearSlashTrigger(inst.view);
  },

  /** 改特定 block 的 heading level(handle / context-menu Turn Into 用)*/
  setHeadingAt(instanceId: string, pos: number, level: number | null): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const node = inst.view.state.doc.nodeAt(pos);
    if (!node) return;
    // 仅 paragraph / heading 可转换
    if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return;
    // title paragraph 不可转
    if (node.type.name === 'paragraph' && node.attrs.isTitle) return;

    const schema = inst.view.state.schema;
    if (level === null) {
      const paragraphType = schema.nodes.paragraph;
      if (!paragraphType) return;
      const tr = inst.view.state.tr.setNodeMarkup(pos, paragraphType, { isTitle: false });
      inst.view.dispatch(tr);
    } else {
      const headingType = schema.nodes.heading;
      if (!headingType) return;
      const tr = inst.view.state.tr.setNodeMarkup(pos, headingType, { level });
      inst.view.dispatch(tr);
    }
    inst.view.focus();
  },

  /**
   * 拿 block 的 textContent(给 Copy 命令写剪贴板用)— L5-B3.9
   */
  getBlockTextAt(instanceId: string, pos: number): string | null {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return null;
    const node = inst.view.state.doc.nodeAt(pos);
    if (!node) return null;
    return node.textContent;
  },

  /**
   * 拿 block 的剪贴板 envelope(html + plain),给 Copy 命令写双格式剪贴板用 — C7 (D-5)
   *
   * 修 V1/V2 历史 bug:handle Copy 之前只走 navigator.clipboard.writeText(textContent),
   * 粘贴回 KRIG 内部时 mathBlock / image / table / callout 等富 block 降级成裸文字。
   * 改成:用 PM DOMSerializer 把 node 序列化成 DOM,outerHTML 作为 text/html;
   * textContent 作为 text/plain 兜底。粘到 KRIG 内 PM smart-paste 能识别 HTML 还原 block;
   * 粘到外部应用降级到 plain text。
   *
   * 注:本 API 仅拿单 block;多选/选区拷贝走 PM 原生 cm-copy(document.execCommand('copy'))。
   */
  getBlockClipboardAt(
    instanceId: string,
    pos: number,
  ): { html: string; text: string } | null {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return null;
    const node = inst.view.state.doc.nodeAt(pos);
    if (!node) return null;
    const serializer = DOMSerializer.fromSchema(inst.view.state.schema);
    const domFragment = serializer.serializeNode(node);
    const container = document.createElement('div');
    container.appendChild(domFragment);
    return {
      html: container.innerHTML,
      text: node.textContent,
    };
  },

  /**
   * 计算 block 的 anchor(给 Copy Link 命令构造 krig://block/<noteId>/<anchor>)— L5-B3.9
   *
   * 规则(对齐 V1):
   * - heading 节点 → 用标题文本前 60 字 encodeURIComponent
   * - 其他 block → `<idx>:<前 30 字 encodeURIComponent>`
   *   idx 是该 block 在 doc 中的顺序索引(0-based,只数顶层 block)
   */
  getBlockAnchorAt(instanceId: string, pos: number): string | null {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return null;
    const node = inst.view.state.doc.nodeAt(pos);
    if (!node) return null;
    const text = node.textContent.trim();
    if (node.type.name === 'heading') {
      return encodeURIComponent(text.slice(0, 60));
    }
    let idx = 0;
    inst.view.state.doc.forEach((_n, offset, i) => {
      if (offset === pos) idx = i;
    });
    const preview = text.slice(0, 30);
    return `${idx}:${encodeURIComponent(preview)}`;
  },

  /** 复制 block(在原 block 之后插入复本)*/
  copyBlockAt(instanceId: string, pos: number): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const node = inst.view.state.doc.nodeAt(pos);
    if (!node) return;
    const insertPos = pos + node.nodeSize;
    const tr = inst.view.state.tr.insert(insertPos, node.copy(node.content));
    inst.view.dispatch(tr);
    inst.view.focus();
  },

  /** 删除 block */
  deleteBlockAt(instanceId: string, pos: number): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const node = inst.view.state.doc.nodeAt(pos);
    if (!node) return;
    // L5-B3.11:title 块(isTitle paragraph)不删除,改成清空内容(保留空 title)
    if (node.type.name === 'paragraph' && node.attrs.isTitle) {
      if (node.content.size === 0) return; // 已经空,不动
      const tr = inst.view.state.tr.delete(pos + 1, pos + node.nodeSize - 1);
      inst.view.dispatch(tr);
      return;
    }
    // doc 至少留一个 block(防 schema content: 'block+' 报错)
    if (inst.view.state.doc.childCount === 1) {
      // 改成空 paragraph 而非删除
      const empty = inst.view.state.schema.nodes.paragraph?.create();
      if (!empty) return;
      const tr = inst.view.state.tr.replaceWith(pos, pos + node.nodeSize, empty);
      inst.view.dispatch(tr);
      return;
    }
    const tr = inst.view.state.tr.delete(pos, pos + node.nodeSize);
    inst.view.dispatch(tr);
    inst.view.focus();
  },

  /** 移动 block(dnd 拖拽完成时调)*/
  moveBlock(instanceId: string, fromPos: number, toPos: number): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    if (fromPos === toPos) return;
    const node = inst.view.state.doc.nodeAt(fromPos);
    if (!node) return;
    const tr = inst.view.state.tr;
    // 先记下要插入的目标 pos(删除后位置可能变)
    let actualToPos = toPos;
    if (toPos > fromPos) {
      actualToPos = toPos - node.nodeSize;
    }
    tr.delete(fromPos, fromPos + node.nodeSize);
    tr.insert(actualToPos, node.copy(node.content));
    inst.view.dispatch(tr);
    inst.view.focus();
  },

  /** 解析屏幕坐标 → block pos + type(context-menu 鼠标位置用)
   *
   * 深层寻址:callout/blockquote/toggle/listItem 内的 paragraph 上右键时,
   * 返回最深的 textblock(group='block')而非顶层容器。
   */
  resolveBlockAt(
    instanceId: string,
    coords: { x: number; y: number },
  ): { pos: number; type: string; level: number | null } | null {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return null;
    const result = inst.view.posAtCoords({ left: coords.x, top: coords.y });
    if (!result) return null;
    const $pos = inst.view.state.doc.resolve(result.pos);
    if ($pos.depth === 0) return null;
    // 从最深向外找 group='block' 的祖先(paragraph/heading/codeBlock/
    // callout/blockquote/toggle/list 等都符合);兜底 depth=1
    let targetDepth = 1;
    for (let d = $pos.depth; d >= 1; d--) {
      if ($pos.node(d).type.spec.group === 'block') {
        targetDepth = d;
        break;
      }
    }
    const blockPos = $pos.before(targetDepth);
    const node = inst.view.state.doc.nodeAt(blockPos);
    if (!node) return null;
    return {
      pos: blockPos,
      type: node.type.name,
      level: node.type.name === 'heading' ? (node.attrs.level as number) : null,
    };
  },

  /** 把光标设到 pos(需要时使用,如 setHeading 后 ContextMenu 期望保持光标)*/
  setSelectionAt(instanceId: string, pos: number): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const tr = inst.view.state.tr.setSelection(TextSelection.near(inst.view.state.doc.resolve(pos)));
    inst.view.dispatch(tr);
  },

  // ── L5-B3.2:Turn Into 新 block 类型 ──

  /**
   * 把当前光标所在 block(或指定 pos block)Turn Into 指定类型
   *
   * 支持:
   * - 'paragraph' / 'h1' / 'h2' / 'h3' — 切换到 paragraph / heading{level} 节点类型
   * - 'bullet-list' / 'ordered-list' / 'task-list' — 包成 list > list-item > paragraph(或 heading)
   * - 'blockquote' — 包成 blockquote > 当前 block
   * - 'code-block' — 替换为 code-block(纯文本)
   * - 'horizontal-rule' — 替换为 hr + 新空 paragraph
   */
  turnIntoAt(
    instanceId: string,
    pos: number,
    target:
      | 'paragraph'
      | 'h1'
      | 'h2'
      | 'h3'
      | 'bullet-list'
      | 'ordered-list'
      | 'task-list'
      | 'blockquote'
      | 'code-block'
      | 'horizontal-rule'
      | 'callout'
      | 'toggle-list',
  ): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const view = inst.view;
    const schema = view.state.schema;
    const node = view.state.doc.nodeAt(pos);
    if (!node) return;

    // L5-B3.11:title 块(isTitle paragraph)不允许 turn into 任何类型
    // 否则 title-guard appendTransaction 会自动补回 title,导致 doc 长出多余 block
    if (node.type.name === 'paragraph' && node.attrs.isTitle) {
      console.warn('[text-editing-driver] turnIntoAt: 不能转换 note title 块');
      return;
    }

    // 容器节点(callout / toggleList)turn into:
    // 这两个节点 content='block+',无法直接 setNodeMarkup 改成非容器类型
    // (schema 冲突 — paragraph/heading content=inline,list 的 itemType 也不接 block+)。
    // 语义:**解包**容器,把全部子 block 提到容器位置(unwrap);
    //   - target='callout'/'toggle-list' → 等于"换壳",把容器换成对应类型;
    //   - 其他 target → 先 unwrap,再对**第一个子 block**应用 turn into。
    if (node.type.name === 'callout' || node.type.name === 'toggleList') {
      // 换壳:callout ↔ toggle-list
      if (target === 'callout' || target === 'toggle-list') {
        const newType = target === 'callout' ? schema.nodes.callout : schema.nodes.toggleList;
        if (!newType) return;
        const tr = view.state.tr.setNodeMarkup(pos, newType, target === 'toggle-list' ? { open: true } : null);
        view.dispatch(tr);
        view.focus();
        return;
      }
      // 其他 target:解包 container,把子内容替换 container,然后递归 turnInto 第一个子 block
      const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, node.content);
      view.dispatch(tr);
      // 第一个子 block 现在落在 pos 位置(去掉 container 的开标 1 个 token 后)
      this.turnIntoAt(instanceId, pos, target);
      return;
    }

    // paragraph 切换 — 切到 paragraph 节点类型
    if (target === 'paragraph') {
      const paragraphType = schema.nodes.paragraph;
      if (!paragraphType) return;
      // 已经是 paragraph(非 title)→ 无需操作
      if (node.type.name === 'paragraph') {
        view.focus();
        return;
      }
      const tr = view.state.tr.setNodeMarkup(pos, paragraphType, { isTitle: false });
      view.dispatch(tr);
      view.focus();
      return;
    }

    // heading 切换 — 切到 heading 节点类型 + level
    if (target === 'h1' || target === 'h2' || target === 'h3') {
      const headingType = schema.nodes.heading;
      if (!headingType) return;
      const level = parseInt(target.slice(1), 10);
      const tr = view.state.tr.setNodeMarkup(pos, headingType, { level });
      view.dispatch(tr);
      view.focus();
      return;
    }

    // lists — wrap paragraph / heading into list > listItem(taskItem) > 原节点
    // 注意:节点 id 是驼峰('bulletList' / 'orderedList' / 'taskList' / 'listItem' / 'taskItem')
    if (target === 'bullet-list' || target === 'ordered-list' || target === 'task-list') {
      const listNodeName =
        target === 'bullet-list' ? 'bulletList'
        : target === 'ordered-list' ? 'orderedList'
        : 'taskList';
      const itemNodeName = target === 'task-list' ? 'taskItem' : 'listItem';
      const listType = schema.nodes[listNodeName];
      const itemType = schema.nodes[itemNodeName];
      if (!listType || !itemType) return;
      if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return;
      const item = itemType.create(
        target === 'task-list' ? { checked: false } : null,
        [node.copy(node.content)],
      );
      const list = listType.create(null, Fragment.from(item));
      const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, list);
      // 光标落进新 list 内的第一个 item 的 paragraph(pos + list开1 + item开1 + p开1 = pos+3)
      tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 3)));
      view.dispatch(tr);
      view.focus();
      return;
    }

    if (target === 'blockquote') {
      const bq = schema.nodes.blockquote;
      if (!bq) return;
      const tr = view.state.tr.replaceWith(
        pos,
        pos + node.nodeSize,
        bq.create(null, [node.copy(node.content)]),
      );
      // replaceWith 默认 mapping 把 cursor 丢到替换区末(blockquote 闭合外),
      // 显式将 cursor 落进新 blockquote 内的 paragraph(pos + bq开1 + p开1 = pos+2)
      tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 2)));
      view.dispatch(tr);
      view.focus();
      return;
    }

    if (target === 'code-block') {
      const cb = schema.nodes.codeBlock;
      if (!cb) return;
      const text = node.textContent;
      const newNode = text ? cb.create(null, schema.text(text)) : cb.create();
      const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, newNode);
      // 光标进新 codeBlock 内部(pos + cb开1 = pos+1)
      tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
      view.dispatch(tr);
      view.focus();
      return;
    }

    if (target === 'horizontal-rule') {
      const hr = schema.nodes.horizontalRule;
      const paragraphType = schema.nodes.paragraph;
      if (!hr || !paragraphType) return;
      const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, [hr.create(), paragraphType.create()]);
      view.dispatch(tr);
      view.focus();
      return;
    }

    if (target === 'callout') {
      const co = schema.nodes.callout;
      if (!co) return;
      // callout content: 'block+',把当前 block 整体包进去(保留所有 marks/attrs)
      const tr = view.state.tr.replaceWith(
        pos,
        pos + node.nodeSize,
        co.create(null, [node.copy(node.content)]),
      );
      // 光标落进新 callout 内的 paragraph(pos + 容器开1 + p开1 = pos+2)
      tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 2)));
      view.dispatch(tr);
      view.focus();
      return;
    }

    if (target === 'toggle-list') {
      const tl = schema.nodes.toggleList;
      if (!tl) return;
      // toggleList content: 'block+',首行作为折叠标题(默认 open=true)
      const tr = view.state.tr.replaceWith(
        pos,
        pos + node.nodeSize,
        tl.create(null, [node.copy(node.content)]),
      );
      // 光标落进新 toggleList 内的 paragraph(pos + 容器开1 + p开1 = pos+2)
      tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 2)));
      view.dispatch(tr);
      view.focus();
      return;
    }
  },

  /** wrapInList — 当前 selection block 包成 list(slash 或 keymap 用)*/
  wrapCurrentInList(instanceId: string, kind: 'bullet-list' | 'ordered-list' | 'task-list'): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const schema = inst.view.state.schema;
    const nodeName =
      kind === 'bullet-list' ? 'bulletList'
      : kind === 'ordered-list' ? 'orderedList'
      : 'taskList';
    const listType = schema.nodes[nodeName];
    if (!listType) return;
    wrapInList(listType)(inst.view.state, inst.view.dispatch);
    inst.view.focus();
  },

  /**
   * turnIntoSelection — slash menu 用:对光标"最深 textblock"应用 Turn Into
   *
   * 寻址深层(callout / blockquote / toggle / listItem 等容器内的 paragraph
   * 都能命中自身,而非顶层容器),让"任意 block 都能在 callout 内创建/转换"。
   */
  turnIntoSelection(
    instanceId: string,
    target:
      | 'paragraph'
      | 'h1'
      | 'h2'
      | 'h3'
      | 'bullet-list'
      | 'ordered-list'
      | 'task-list'
      | 'blockquote'
      | 'code-block'
      | 'horizontal-rule'
      | 'callout'
      | 'toggle-list',
  ): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const $from = inst.view.state.selection.$from;
    if ($from.depth === 0) return;
    const blockPos = $from.before($from.depth);
    this.turnIntoAt(instanceId, blockPos, target);
  },

  /**
   * 滚动到 block anchor(L5-B3.4)
   *
   * 笔记加载完成后,view 调本方法把 pendingAnchor 滚到位。
   * anchor 格式见 build-link-click-plugin 的 scrollToBlockAnchor。
   */
  scrollToAnchor(instanceId: string, anchor: string): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    scrollToBlockAnchor(inst.view, anchor);
  },

  // ── thought-view Phase 3:横切思考层 anchor 操作 ──

  /**
   * inline mark anchor:在选区加 thoughtMark(attrs.thoughtId + thoughtType)。
   * 选区为空时不操作(view 侧应先 checkInlineSelection)。
   *
   * 返 pos = selection.from(view 用此存 anchor.locator.pmPos)。
   */
  addThoughtMark(
    instanceId: string,
    thoughtId: string,
    thoughtType: string,
  ): { pos: number; text: string } | null {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return null;
    const { state } = inst.view;
    const markType = state.schema.marks.thought;
    if (!markType) return null;
    const { from, to } = state.selection;
    if (from >= to) return null;
    const mark = markType.create({ thoughtId, thoughtType });
    const tr = state.tr.addMark(from, to, mark);
    inst.view.dispatch(tr);
    const text = state.doc.textBetween(from, to, ' ').slice(0, 100);
    return { pos: from, text };
  },

  /**
   * block frame anchor:给指定 block(blockPos)设 frameThoughtId attr,
   * thought-anchor-plugin 自动按 frameThoughtId + resolveThoughtType 画外框。
   *
   * 返 pos + 该 block 文本前 100 字(用作 locator.text)。
   */
  addThoughtBlockFrame(
    instanceId: string,
    blockPos: number,
    thoughtId: string,
  ): { pos: number; text: string } | null {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return null;
    const { state } = inst.view;
    const node = state.doc.nodeAt(blockPos);
    if (!node) return null;
    const tr = state.tr.setNodeMarkup(blockPos, undefined, {
      ...node.attrs,
      frameThoughtId: thoughtId,
    });
    inst.view.dispatch(tr);
    const text = node.textContent.slice(0, 100);
    return { pos: blockPos, text };
  },

  /**
   * node attr anchor:给指定 node(image / future audio / video)设 thoughtId attr。
   * 仅 image 在本期支持(其它节点 spec 暂无 thoughtId attr)。
   */
  addThoughtNodeAttr(
    instanceId: string,
    nodePos: number,
    thoughtId: string,
  ): { pos: number; text: string } | null {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return null;
    const { state } = inst.view;
    const node = state.doc.nodeAt(nodePos);
    if (!node) return null;
    if (node.type.spec.attrs?.thoughtId === undefined) return null;
    const tr = state.tr.setNodeMarkup(nodePos, undefined, {
      ...node.attrs,
      thoughtId,
    });
    inst.view.dispatch(tr);
    // image 用 alt 兜底
    const text =
      node.type.name === 'image'
        ? `[图片] ${(node.attrs.alt as string) || ''}`.trim()
        : `[${node.type.name}]`;
    return { pos: nodePos, text };
  },

  /**
   * 清除 thought anchor — 三种形态自动识别(走找 mark/frame/node attr,擦掉对应 thoughtId)。
   * Note ⌘Z 撤销 mark 之外的"主动解除"路径(thought atom 仍在,仅清 anchor)。
   */
  removeThoughtAnchor(instanceId: string, thoughtId: string): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const { state } = inst.view;
    let tr = state.tr;
    let changed = false;

    // 1) inline mark
    const markType = state.schema.marks.thought;
    if (markType) {
      state.doc.descendants((node, pos) => {
        node.marks.forEach((m) => {
          if (m.type === markType && m.attrs.thoughtId === thoughtId) {
            tr = tr.removeMark(pos, pos + node.nodeSize, m);
            changed = true;
          }
        });
      });
    }

    // 2) block frame + 3) node attr(thoughtId 字段)
    state.doc.descendants((node, pos) => {
      const ft = node.attrs.frameThoughtId as string | null | undefined;
      if (ft === thoughtId) {
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, frameThoughtId: null });
        changed = true;
      }
      const ti = node.attrs.thoughtId as string | null | undefined;
      if (ti === thoughtId) {
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, thoughtId: null });
        changed = true;
      }
    });

    if (changed) inst.view.dispatch(tr);
  },

  /**
   * 改 thought anchor 在 Note PM 内的 type 缓存(mark.attrs.thoughtType /
   * thought-anchor-plugin decoration data-thought-type)。
   *
   * thoughtMark.attrs.thoughtType 是冗余缓存(thought atom payload 才是 SSOT),
   * 用于 CSS class `krig-thought-mark--{type}` 着色。atom type 变化时 mark attrs
   * 不会自动同步 → 颜色不变。本 API 扫整 doc 找该 thoughtId 的 mark + frame
   * + node attr(后两者通过 plugin decoration `resolveThoughtType` callback
   * 渲染色,不需要改 PM doc,只需触发 plugin re-render → note-bridge 的 thoughtCache
   * 已先更新)。
   *
   * 实际只需更新 inline mark 的 attrs.thoughtType。block frame / image attr
   * 的颜色由 thought-anchor-plugin decoration 走 resolveThoughtType callback 渲染,
   * thoughtCache 更新后下一次 doc transaction 会触发 decoration 重算。
   */
  updateThoughtMarkType(instanceId: string, thoughtId: string, newType: string): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const { state } = inst.view;
    const markType = state.schema.marks.thought;
    if (!markType) return;
    let tr = state.tr;
    let changed = false;
    state.doc.descendants((node, pos) => {
      node.marks.forEach((m) => {
        if (
          m.type === markType &&
          m.attrs.thoughtId === thoughtId &&
          m.attrs.thoughtType !== newType
        ) {
          // PM mark 不支持直接改 attr — 必须 removeMark 旧的 + addMark 新的
          const end = pos + node.nodeSize;
          tr = tr.removeMark(pos, end, m);
          tr = tr.addMark(pos, end, markType.create({ thoughtId, thoughtType: newType }));
          changed = true;
        }
      });
    });
    // 即使 inline mark 路径没找到匹配(用户改的是 block frame / image anchor),
    // 也需要触发 thought-anchor-plugin decoration 重算 — 它读 activeHandler
    // .resolveThoughtType(刚由 note-bridge 更新 thoughtCache),但只在 docChanged
    // 或 thoughtAnchorKey meta='refresh' 时重算。这里恒发 meta 让 plugin 重算
    // block/image 颜色,与 mark 路径效果一致。
    tr = tr.setMeta(thoughtAnchorKey, 'refresh');
    inst.view.dispatch(tr);
    void changed; // mark 路径变化记录(留 hook),目前只需 plugin refresh
  },

  /** 滚动到 thought anchor 在 PM 内的位置(跨槽通信 → ThoughtView 点卡片 → Note 跳转) */
  scrollToThoughtAnchor(instanceId: string, pos: number): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    scrollToThoughtAnchorImpl(inst.view, pos);
  },

  /**
   * 在光标当前 block 后插入空 image block(L5-B3.5)
   *
   * 行为:
   * - 当前 block 是空段落 → 替换它(避免遗留空行)
   * - 当前 block 非空 → 在其后插入 image block(用户后续编辑 caption 不影响原段落)
   * - image attrs.src=null,触发 placeholder 状态
   * - caption(`paragraph`)填一个空段落满足 schema content
   */
  insertImageAtSelection(instanceId: string): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    insertWithCaptionBlock(inst.view, 'image');
  },

  /**
   * 在光标位置插入空 audioBlock placeholder(L5-B3.16)
   *
   * 行为同 insertImageAtSelection:空段落替换 / 否则段后插入,光标进 caption。
   * audioBlock attrs.src=null 触发 placeholder(🎵 + Choose file + URL embed)。
   */
  insertAudioBlockAtSelection(instanceId: string): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    insertWithCaptionBlock(inst.view, 'audioBlock');
  },

  /**
   * 在光标位置插入空 videoBlock placeholder(L5-B3.16)
   *
   * 行为同 insertImageAtSelection。videoBlock attrs.src=null 触发 placeholder
   * (🎞 + Choose file + URL embed,URL 支持 mp4 / YouTube)。
   */
  insertVideoBlockAtSelection(instanceId: string): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    insertWithCaptionBlock(inst.view, 'videoBlock');
  },

  /**
   * 在光标位置插入空 tweetBlock placeholder(L5-B3.18)
   *
   * 行为同 image / audio / video。tweetBlock attrs.tweetUrl=null 触发 placeholder
   * (𝕏 + URL 输入框,Enter 后切到 Browse Tab iframe)。
   */
  insertTweetBlockAtSelection(instanceId: string): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    insertWithCaptionBlock(inst.view, 'tweetBlock');
  },

  /**
   * 在光标当前 block 位置插入空 mathBlock(L5-B3.6)
   *
   * - 空段落 → 替换;非空段落 → 之后插入
   * - mathBlock content='text*',无文本时 NodeView 自动进入 edit 态(用户直接写 LaTeX)
   * - 光标进 mathBlock 内(LaTeX 源码区)
   */
  insertMathBlockAtSelection(instanceId: string): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const { state, dispatch } = inst.view;
    const schema = state.schema;
    const mathType = schema.nodes.mathBlock;
    if (!mathType) return;

    const mathNode = mathType.create();
    if (!mathNode) return;

    const $from = state.selection.$from;
    if ($from.depth === 0) {
      dispatch(state.tr.insert(state.selection.from, mathNode));
    } else {
      // 深层寻址:光标所在 textblock 那层(callout/blockquote/toggle/list 内的
      // paragraph 都命中自身,而非顶层容器)
      const depth = $from.depth;
      const blockNode = $from.node(depth);
      const blockStart = $from.before(depth);
      const blockEnd = $from.after(depth);
      const isEmptyParagraph =
        blockNode.type.name === 'paragraph' &&
        blockNode.content.size === 0 &&
        !blockNode.attrs.isTitle;
      let tr = state.tr;
      const insertPos = isEmptyParagraph ? blockStart : blockEnd;
      if (isEmptyParagraph) {
        tr = tr.replaceWith(blockStart, blockEnd, mathNode);
      } else {
        tr = tr.insert(blockEnd, mathNode);
      }
      // 光标进 mathBlock 内(insertPos + 1 = mathBlock 内 text 位置)
      const sel = TextSelection.create(tr.doc, insertPos + 1);
      tr = tr.setSelection(sel).scrollIntoView();
      dispatch(tr);
    }
    inst.view.focus();
  },

  /**
   * 在光标当前 block 位置插入 mermaid codeBlock(language='mermaid' + 起步模板)
   *
   * 行为参照 insertMathBlockAtSelection:
   * - 空段落 → 替换;非空段落 → 之后插入
   * - 插入的 codeBlock 带默认 `graph TD\n  A --> B` 起步内容,NodeView 即时渲染预览
   * - 光标进 codeBlock 内(光标在起步代码末尾)
   */
  insertMermaidBlockAtSelection(instanceId: string): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const { state, dispatch } = inst.view;
    const schema = state.schema;
    const cb = schema.nodes.codeBlock;
    if (!cb) return;

    const starter = 'graph TD\n  A[开始] --> B[结束]';
    const mermaidNode = cb.create({ language: 'mermaid' }, schema.text(starter));
    if (!mermaidNode) return;

    const $from = state.selection.$from;
    if ($from.depth === 0) {
      dispatch(state.tr.insert(state.selection.from, mermaidNode));
    } else {
      const depth = $from.depth;
      const blockNode = $from.node(depth);
      const blockStart = $from.before(depth);
      const blockEnd = $from.after(depth);
      const isEmptyParagraph =
        blockNode.type.name === 'paragraph' &&
        blockNode.content.size === 0 &&
        !blockNode.attrs.isTitle;
      let tr = state.tr;
      const insertPos = isEmptyParagraph ? blockStart : blockEnd;
      if (isEmptyParagraph) {
        tr = tr.replaceWith(blockStart, blockEnd, mermaidNode);
      } else {
        tr = tr.insert(blockEnd, mermaidNode);
      }
      // 光标进 codeBlock 内文本末尾(insertPos + 1 起点 + starter.length)
      const sel = TextSelection.create(tr.doc, insertPos + 1 + starter.length);
      tr = tr.setSelection(sel).scrollIntoView();
      dispatch(tr);
    }
    inst.view.focus();
  },

  /**
   * 在光标当前 block 位置插入空 htmlBlock(placeholder 态)
   *
   * 行为参照 insertMermaidBlockAtSelection:
   * - 空段落 → 替换;非空段落 → 之后插入
   * - 插入的 htmlBlock 无 src(走 placeholder UI,用户用 Upload / Embed 上传源码)
   * - caption(figcaption)用空 paragraph 填(满足 content:'block')
   * - 光标进 caption 内(insertPos + 2 = 进入 figcaption 内的 paragraph)
   */
  insertHtmlBlockAtSelection(instanceId: string): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const { state, dispatch } = inst.view;
    const schema = state.schema;
    const htmlType = schema.nodes.htmlBlock;
    const paraType = schema.nodes.paragraph;
    if (!htmlType || !paraType) return;

    const captionPara = paraType.create();
    const htmlNode = htmlType.create({}, captionPara);
    if (!htmlNode) return;

    const $from = state.selection.$from;
    if ($from.depth === 0) {
      dispatch(state.tr.insert(state.selection.from, htmlNode));
    } else {
      const depth = $from.depth;
      const blockNode = $from.node(depth);
      const blockStart = $from.before(depth);
      const blockEnd = $from.after(depth);
      const isEmptyParagraph =
        blockNode.type.name === 'paragraph' &&
        blockNode.content.size === 0 &&
        !blockNode.attrs.isTitle;
      let tr = state.tr;
      const insertPos = isEmptyParagraph ? blockStart : blockEnd;
      if (isEmptyParagraph) {
        tr = tr.replaceWith(blockStart, blockEnd, htmlNode);
      } else {
        tr = tr.insert(blockEnd, htmlNode);
      }
      // 光标进 caption 内(insertPos + 2 = htmlBlock 内 paragraph 起点)
      const sel = TextSelection.create(tr.doc, insertPos + 2);
      tr = tr.setSelection(sel).scrollIntoView();
      dispatch(tr);
    }
    inst.view.focus();
  },

  /**
   * 在光标当前 block 位置插入空 mathVisual(V1 → V2 迁移 Phase 1B)
   *
   * 行为参照 insertHtmlBlockAtSelection:
   * - 空段落 → 替换;非空段落 → 之后插入
   * - 插入的 mathVisual 走 spec.ts 内 attrs default(默认 `f(x) = x^2` 一条曲线)
   * - caption(figcaption)用空 paragraph 填(满足 content:'block')
   * - 光标进 caption 内(insertPos + 2 = mathVisual 内 paragraph 起点)
   */
  insertMathVisualAtSelection(instanceId: string): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const { state, dispatch } = inst.view;
    const schema = state.schema;
    const mvType = schema.nodes.mathVisual;
    const paraType = schema.nodes.paragraph;
    if (!mvType || !paraType) return;

    const captionPara = paraType.create();
    const mvNode = mvType.create({}, captionPara);
    if (!mvNode) return;

    const $from = state.selection.$from;
    if ($from.depth === 0) {
      dispatch(state.tr.insert(state.selection.from, mvNode));
    } else {
      const depth = $from.depth;
      const blockNode = $from.node(depth);
      const blockStart = $from.before(depth);
      const blockEnd = $from.after(depth);
      const isEmptyParagraph =
        blockNode.type.name === 'paragraph' &&
        blockNode.content.size === 0 &&
        !blockNode.attrs.isTitle;
      let tr = state.tr;
      const insertPos = isEmptyParagraph ? blockStart : blockEnd;
      if (isEmptyParagraph) {
        tr = tr.replaceWith(blockStart, blockEnd, mvNode);
      } else {
        tr = tr.insert(blockEnd, mvNode);
      }
      // 光标进 caption 内(insertPos + 2 = mathVisual 内 paragraph 起点)
      const sel = TextSelection.create(tr.doc, insertPos + 2);
      tr = tr.setSelection(sel).scrollIntoView();
      dispatch(tr);
    }
    inst.view.focus();
  },

  /**
   * 插入 mathInline atom(L5-B3.6)
   *
   * 行为:
   * - 有选区 → 选中文本作 latex 源码,替换为 mathInline(floating toolbar 主入口语义)
   *   例:选 "x^2 + y^2" → 转成 mathInline latex="x^2 + y^2"
   * - 无选区 → 插入空 mathInline,用户单击触发编辑弹窗
   *
   * mathInline 是 inline atom,只能插在 paragraph / heading 等 inline 容器里。
   */
  insertMathInlineAtSelection(instanceId: string): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const { state, dispatch } = inst.view;
    const schema = state.schema;
    const mathType = schema.nodes.mathInline;
    if (!mathType) return;

    const { from, to, empty } = state.selection;
    let latex = '';
    if (!empty) {
      // 选中文本作 LaTeX 源码
      latex = state.doc.textBetween(from, to, ' ', ' ');
    }
    const mathNode = mathType.create({ latex });
    if (!mathNode) return;

    const tr = state.tr.replaceSelectionWith(mathNode, false).scrollIntoView();
    dispatch(tr);
    inst.view.focus();
  },

  /**
   * 在光标处插入 table(L5-B3.7)
   *
   * 行为:替换当前 block(空段落直接换;非空段落也换 — V1 行为)
   * 第一行 tableHeader,后续 tableCell;每 cell 含一个空 paragraph
   * 默认 3x3,可通过参数自定义
   */
  insertTableAtSelection(instanceId: string, rows = 3, cols = 3): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    insertTableCommand(rows, cols)(inst.view.state, inst.view.dispatch);
    inst.view.focus();
  },

  /**
   * 在光标处插入 columnList(2 或 3 列)
   *
   * - 替换当前 block(对齐 V1 SlashMenu 行为);第一列继承当前 paragraph 内容
   * - 嵌套防护:光标已在 columnList 内 → no-op(insertColumnListCommand 自检)
   * - cols 默认 2(slash menu 仅暴露 2 Columns 入口)
   */
  insertColumnListAtSelection(instanceId: string, cols: 2 | 3 = 2): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    insertColumnListCommand(cols)(inst.view.state, inst.view.dispatch);
    inst.view.focus();
  },

  /**
   * 在光标位置插入空 fileBlock placeholder(L5-B3.14)
   *
   * - 空段落 → 替换;非空段落 → 当前 block 之后插入
   * - fileBlock 是 atom 节点,placeholder 状态(无 src)显示 file picker + URL embed
   */
  insertFileBlockAtSelection(instanceId: string): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    insertAtomBlock(inst.view, 'fileBlock');
  },

  /**
   * 在光标位置插入空 externalRef placeholder(L5-B3.14)
   *
   * - 同 insertFileBlockAtSelection 行为,placeholder 显示 pick file + URL embed
   */
  insertExternalRefAtSelection(instanceId: string): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    insertAtomBlock(inst.view, 'externalRef');
  },

  /**
   * 设置全局 vocab 词表(L5-B3.20b — vocab highlight 数据流)
   *
   * view 层 learning-integration 订阅 capability.onVocabChanged → 收到全量 list →
   * 调本 API → 分发到所有 PM instance dispatch vocabHighlightPluginKey meta →
   * plugin 重建 decorations。同时更新模块级 vocabDefs(给 hover tooltip 显释义)。
   *
   * driver 不直接 import learning capability — 是 view 层协调。
   */
  /**
   * 取当前 selection 的 Markdown 序列化结果 + 图片清单。
   *
   * 用于"问 AI"等场景把选区无损发给 AI。
   * 选区为空时返回 { markdown:'', images:[] }。
   *
   * V2 简化:只走 state.selection.content();V1 走 computeSliceForClipboard(含
   * blockSelection plugin)— V2 选区机制不同,后续 V2 上 block-selection 时再适配。
   */
  getSelectionMarkdown(instanceId: string): SerializeResult {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return { markdown: '', images: [] };
    const { state } = inst.view;
    if (state.selection.empty) return { markdown: '', images: [] };
    const slice = state.selection.content();
    return sliceToMarkdown(slice);
  },

  setVocabWords(entries: Array<{ word: string; definition: string }>): void {
    // 1. 更新模块级 vocabDefs(供 tooltip 显释义)
    updateVocabDefs(entries);
    // 2. 分发到所有 PM instance,触发 plugin 重建 decorations
    const wordSet = new Set(entries.map((e) => e.word.toLowerCase()));
    for (const inst of instanceRegistry.getAll()) {
      if (inst.view.isDestroyed) continue;
      const tr = inst.view.state.tr.setMeta(vocabHighlightPluginKey, wordSet);
      tr.setMeta('addToHistory', false); // vocab 更新不进 undo 栈
      inst.view.dispatch(tr);
    }
  },

  /**
   * 在 doc 末尾追加一组 PM nodes(ai-sync feature 用)。
   *
   * 行为:
   * - 末尾若是"空 paragraph 且非 isTitle"(用户刚换行留下的空段),先替换它避免多余间距
   * - 用 schema.nodeFromJSON 还原 PMNode,过滤掉 schema 不识别的节点(防御)
   * - scrollIntoView 让用户视觉跟随
   * - 返 true 表示插入成功;false = instance 不存在 / 全部节点都无效
   *
   * 不动 selection(避免抢用户光标);若调用方需要把光标挪到末尾,自行 setSelectionAt。
   */
  insertNodesAtEnd(instanceId: string, nodesJson: unknown[]): boolean {
    const inst = instanceRegistry.get(instanceId);
    if (!inst || inst.view.isDestroyed) return false;
    const { state } = inst.view;
    const { schema } = state;

    const nodes: PMNode[] = [];
    for (const raw of nodesJson) {
      try {
        const node = PMNode.fromJSON(schema, raw as Parameters<typeof PMNode.fromJSON>[1]);
        nodes.push(node);
      } catch (err) {
        // 单节点解析失败不阻断其他节点(防御 schema 漂移 / parser 输出异常)
        console.warn('[insertNodesAtEnd] node parse failed, skipping:', err);
      }
    }
    if (nodes.length === 0) return false;

    let tr = state.tr;

    // 末尾空 paragraph 检测:doc.lastChild 是 paragraph + content.size===0 + 非 isTitle
    const lastChild = state.doc.lastChild;
    const lastChildIsEmptyPara =
      lastChild != null &&
      lastChild.type.name === 'paragraph' &&
      lastChild.content.size === 0 &&
      lastChild.attrs.isTitle !== true;

    if (lastChildIsEmptyPara) {
      const lastChildStart = state.doc.content.size - lastChild.nodeSize;
      tr = tr.replaceWith(lastChildStart, state.doc.content.size, nodes);
    } else {
      tr = tr.insert(state.doc.content.size, nodes);
    }

    tr.setMeta('addToHistory', true);
    tr = tr.scrollIntoView();
    inst.view.dispatch(tr);
    return true;
  },

  /**
   * 在"PM 光标处或末尾"插入一组 PM nodes(ai-sync 模式下"提取整页对话"用)。
   *
   * 行为:
   * - PM hasFocus()=true → 在 selection.from 当前 block 之后插(safe replace 当前 block
   *   或 split,语义对齐用户"在光标位置插块")
   * - hasFocus()=false → fallback 到 insertNodesAtEnd 同款"末尾插+空段替换"
   *
   * 为啥用 hasFocus 而不是单看 selection.from:刚打开 note 时 selection 默认在
   * 标题后(非 0)— hasFocus=false 时还是该判"用户没碰过 Note 编辑器"→ 走末尾。
   *
   * 返 true=插入成功;false=instance 不存在 / 全节点无效。
   */
  insertNodesAtCursorOrEnd(instanceId: string, nodesJson: unknown[]): boolean {
    const inst = instanceRegistry.get(instanceId);
    if (!inst || inst.view.isDestroyed) return false;
    const { state } = inst.view;
    const { schema } = state;

    const nodes: PMNode[] = [];
    for (const raw of nodesJson) {
      try {
        nodes.push(PMNode.fromJSON(schema, raw as Parameters<typeof PMNode.fromJSON>[1]));
      } catch (err) {
        console.warn('[insertNodesAtCursorOrEnd] node parse failed, skipping:', err);
      }
    }
    if (nodes.length === 0) return false;

    const hasFocus = inst.view.hasFocus();
    let tr = state.tr;

    if (!hasFocus) {
      // ── fallback 末尾插(逻辑同 insertNodesAtEnd)──
      const lastChild = state.doc.lastChild;
      const lastChildIsEmptyPara =
        lastChild != null &&
        lastChild.type.name === 'paragraph' &&
        lastChild.content.size === 0 &&
        lastChild.attrs.isTitle !== true;
      if (lastChildIsEmptyPara) {
        const lastChildStart = state.doc.content.size - lastChild.nodeSize;
        tr = tr.replaceWith(lastChildStart, state.doc.content.size, nodes);
      } else {
        tr = tr.insert(state.doc.content.size, nodes);
      }
    } else {
      // ── 光标位置插(在 selection.from 所在 top-level block 之后)──
      const $from = state.selection.$from;
      if ($from.depth === 0) {
        tr = tr.insert(state.selection.from, nodes);
      } else {
        const depth = 1; // top-level block boundary
        const blockNode = $from.node(depth);
        const blockStart = $from.before(depth);
        const blockEnd = $from.after(depth);
        const isEmptyParagraph =
          blockNode.type.name === 'paragraph' &&
          blockNode.content.size === 0 &&
          !blockNode.attrs.isTitle;
        if (isEmptyParagraph) {
          // 光标停在空段(典型:用户按 Enter 留下的空行)→ 替换避免多余间距
          tr = tr.replaceWith(blockStart, blockEnd, nodes);
        } else {
          tr = tr.insert(blockEnd, nodes);
        }
      }
    }

    tr.setMeta('addToHistory', true);
    tr = tr.scrollIntoView();
    inst.view.dispatch(tr);
    return true;
  },
};

/**
 * 通用 atom block 插入辅助(L5-B3.14)— 给 fileBlock / externalRef 等无内嵌 caption
 * 的 atom 节点用。
 *
 * - 空段落 → 替换;非空段落 → 当前 block 之后插入
 * - 不带任何 attrs(由 NodeView placeholder 引导用户填)
 */
/**
 * 通用"含 caption 的 block"插入辅助(L5-B3.16)— 给 image / audioBlock / videoBlock 共用
 *
 * 这三个 block 都是 content='block'(单段 caption,V2 PM 不允许节点名含短横线,
 * 用 'block' group 通配 — 实际用户写段落 paragraph);NodeView 内嵌 captionDOM。
 *
 * 行为:
 * - 空段落 → 替换它(避免遗留空行)
 * - 非空段落 → 当前 block 之后插入(保留原段)
 * - 顶层选区 → 选区前直接插
 * - 光标进 caption 内(用户能立即写说明)
 *
 * 不带任何 attrs(由 NodeView placeholder 引导用户填 src)
 */
function insertWithCaptionBlock(
  view: import('prosemirror-view').EditorView,
  nodeName: string,
): void {
  const { state, dispatch } = view;
  const schema = state.schema;
  const nodeType = schema.nodes[nodeName];
  const paragraphType = schema.nodes.paragraph;
  if (!nodeType || !paragraphType) return;

  const captionNode = paragraphType.create();
  const node = nodeType.create({}, captionNode);
  if (!node) return;

  const $from = state.selection.$from;
  if ($from.depth === 0) {
    // 顶层:直接在选区前插入(无需光标 reposition,大概率走不到)
    dispatch(state.tr.insert(state.selection.from, node));
  } else {
    // 深层寻址:在光标所在 textblock 那层就近插入(callout/blockquote/toggle 内)
    const depth = $from.depth;
    const blockNode = $from.node(depth);
    const blockStart = $from.before(depth);
    const blockEnd = $from.after(depth);
    const isEmptyParagraph =
      blockNode.type.name === 'paragraph' &&
      blockNode.content.size === 0 &&
      !blockNode.attrs.isTitle;
    let tr = state.tr;
    if (isEmptyParagraph) {
      tr = tr.replaceWith(blockStart, blockEnd, node);
    } else {
      tr = tr.insert(blockEnd, node);
    }
    // 光标移进 caption 内 — 节点起点 + 1 进入 node,再 + 1 进入 caption paragraph 内
    const insertPos = isEmptyParagraph ? blockStart : blockEnd;
    const captionPos = insertPos + 2;
    tr = tr.setSelection(TextSelection.create(tr.doc, captionPos)).scrollIntoView();
    dispatch(tr);
  }
  view.focus();
}

function insertAtomBlock(
  view: import('prosemirror-view').EditorView,
  nodeName: string,
): void {
  const { state, dispatch } = view;
  const nodeType = state.schema.nodes[nodeName];
  if (!nodeType) return;
  const node = nodeType.create();
  if (!node) return;

  const $from = state.selection.$from;
  if ($from.depth === 0) {
    dispatch(state.tr.insert(state.selection.from, node));
  } else {
    // 深层寻址(同 insertWithCaptionBlock)
    const depth = $from.depth;
    const blockNode = $from.node(depth);
    const blockStart = $from.before(depth);
    const blockEnd = $from.after(depth);
    const isEmptyParagraph =
      blockNode.type.name === 'paragraph' &&
      blockNode.content.size === 0 &&
      !blockNode.attrs.isTitle;
    let tr = state.tr;
    if (isEmptyParagraph) {
      tr = tr.replaceWith(blockStart, blockEnd, node);
    } else {
      tr = tr.insert(blockEnd, node);
    }
    tr = tr.scrollIntoView();
    dispatch(tr);
  }
  view.focus();
}

/**
 * 计算 selection 内激活的 marks
 *
 * 规则:
 * - 选区为空(光标):取 storedMarks(用户按了 Cmd+B 但还没输入字符 — 待生效的 mark)
 *   + $from.marks()(光标处实际 marks)
 * - 选区非空:取**全选区内每个位置都激活**的 marks(rangeHasMark 必须全程为 true)
 */
function computeActiveMarks(
  state: import('prosemirror-state').EditorState,
): string[] {
  const { from, to, empty, $from } = state.selection;
  const result = new Set<string>();

  if (empty) {
    // storedMarks 优先,否则光标处实际 marks
    const marks = state.storedMarks ?? $from.marks();
    for (const m of marks) result.add(m.type.name);
    return Array.from(result);
  }

  // 非空选区:遍历 schema marks,逐个判定 rangeHasMark
  for (const name of Object.keys(state.schema.marks)) {
    const markType = state.schema.marks[name];
    if (state.doc.rangeHasMark(from, to, markType)) {
      // rangeHasMark 是"至少一个位置激活";要"全程激活"得手动算
      // 简化:V1 同款用 rangeHasMark(用户体验:选区有任何 bold 就显示 bold 高亮)
      result.add(name);
    }
  }
  return Array.from(result);
}
