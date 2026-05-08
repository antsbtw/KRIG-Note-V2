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
import { Fragment } from 'prosemirror-model';
import { instanceRegistry } from './instance-registry';
import { clearSlashTrigger } from './plugins/build-slash-plugin';
import { scrollToBlockAnchor } from './plugins/build-link-click-plugin';
import { insertTable as insertTableCommand } from './blocks/table';

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
   * 给选区设置文字颜色(textStyle mark);color 为空字符串时移除。
   * 对齐 V1 applyTextColor。
   */
  setTextColor(instanceId: string, color: string): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const markType = inst.view.state.schema.marks.textStyle;
    if (!markType) return;
    const { from, to } = inst.view.state.selection;
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
   * 给选区设置背景高亮色(highlight mark);color 为空字符串时移除。
   * 对齐 V1 applyHighlight。
   */
  setHighlight(instanceId: string, color: string): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const markType = inst.view.state.schema.marks.highlight;
    if (!markType) return;
    const { from, to } = inst.view.state.selection;
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
    const blockType = inst.view.state.schema.nodes['text-block'];
    if (!blockType) return;
    setBlockType(blockType, { level })(inst.view.state, inst.view.dispatch);
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
      level: (node.attrs.level as number | null) ?? null,
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
    if (!node || node.type.name !== 'text-block') return;
    const tr = inst.view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, level });
    inst.view.dispatch(tr);
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
   * 计算 block 的 anchor(给 Copy Link 命令构造 krig://block/<noteId>/<anchor>)— L5-B3.9
   *
   * 规则(对齐 V1):
   * - heading(text-block attrs.level !== null)→ 用标题文本前 60 字 encodeURIComponent
   * - 其他 block → `<idx>:<前 30 字 encodeURIComponent>`
   *   idx 是该 block 在 doc 中的顺序索引(0-based,只数顶层 block)
   */
  getBlockAnchorAt(instanceId: string, pos: number): string | null {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return null;
    const node = inst.view.state.doc.nodeAt(pos);
    if (!node) return null;
    const text = node.textContent.trim();
    if (node.type.name === 'text-block' && node.attrs.level != null) {
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
    // L5-B3.11:title 块(isTitle text-block)不删除,改成清空内容(保留空 title)
    if (node.type.name === 'text-block' && node.attrs.isTitle) {
      if (node.content.size === 0) return; // 已经空,不动
      const tr = inst.view.state.tr.delete(pos + 1, pos + node.nodeSize - 1);
      inst.view.dispatch(tr);
      return;
    }
    // doc 至少留一个 block(防 schema content: 'block+' 报错)
    if (inst.view.state.doc.childCount === 1) {
      // 改成空 paragraph 而非删除
      const empty = inst.view.state.schema.nodes['text-block']?.create();
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

  /** 解析屏幕坐标 → block pos + type(context-menu 鼠标位置用)*/
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
    const blockPos = $pos.before(1);
    const node = inst.view.state.doc.nodeAt(blockPos);
    if (!node) return null;
    return {
      pos: blockPos,
      type: node.type.name,
      level: (node.attrs.level as number | null) ?? null,
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
   * - 'paragraph' / 'h1' / 'h2' / 'h3' — text-block 改 attrs.level
   * - 'bullet-list' / 'ordered-list' / 'task-list' — 包成 list > list-item > text-block
   * - 'blockquote' — 包成 blockquote > 当前 block
   * - 'code-block' — 替换为 code-block(纯文本)
   * - 'horizontal-rule' — 替换为 hr + 新空 text-block
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

    // L5-B3.11:title 块(isTitle text-block)不允许 turn into 任何类型
    // 否则 title-guard appendTransaction 会自动补回 title,导致 doc 长出多余 block
    if (node.type.name === 'text-block' && node.attrs.isTitle) {
      console.warn('[text-editing-driver] turnIntoAt: 不能转换 note title 块');
      return;
    }

    // headings / paragraph — text-block attrs
    if (target === 'paragraph' || target === 'h1' || target === 'h2' || target === 'h3') {
      if (node.type.name !== 'text-block') return;
      const level = target === 'paragraph' ? null : parseInt(target.slice(1), 10);
      const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, level });
      view.dispatch(tr);
      view.focus();
      return;
    }

    // lists — wrap text-block into list > listItem(taskItem) > text-block
    // 注意:节点 id 是驼峰('bulletList' / 'orderedList' / 'taskList' / 'listItem' / 'taskItem')
    if (target === 'bullet-list' || target === 'ordered-list' || target === 'task-list') {
      const listNodeName =
        target === 'bullet-list' ? 'bulletList'
        : target === 'ordered-list' ? 'orderedList'
        : 'taskList';
      const itemNodeName = target === 'task-list' ? 'taskItem' : 'listItem';
      const listType = schema.nodes[listNodeName];
      const itemType = schema.nodes[itemNodeName];
      if (!listType || !itemType || node.type.name !== 'text-block') return;
      const item = itemType.create(
        target === 'task-list' ? { checked: false } : null,
        [node.copy(node.content)],
      );
      const list = listType.create(null, Fragment.from(item));
      const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, list);
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
      view.dispatch(tr);
      view.focus();
      return;
    }

    if (target === 'horizontal-rule') {
      const hr = schema.nodes.horizontalRule;
      const tb = schema.nodes['text-block'];
      if (!hr || !tb) return;
      const tr = view.state.tr.replaceWith(pos, pos + node.nodeSize, [hr.create(), tb.create()]);
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

  /** turnIntoSelection — slash menu 用:对光标当前 block 应用 Turn Into */
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
    const blockPos = $from.before(1);
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

  /**
   * 在光标当前 block 后插入空 image block(L5-B3.5)
   *
   * 行为:
   * - 当前 block 是空段落 → 替换它(避免遗留空行)
   * - 当前 block 非空 → 在其后插入 image block(用户后续编辑 caption 不影响原段落)
   * - image attrs.src=null,触发 placeholder 状态
   * - caption(`text-block`)填一个空段落满足 schema content='text-block'
   */
  insertImageAtSelection(instanceId: string): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    const { state, dispatch } = inst.view;
    const schema = state.schema;
    const imageType = schema.nodes.image;
    const textBlockType = schema.nodes['text-block'];
    if (!imageType || !textBlockType) return;

    const captionNode = textBlockType.create();
    const imageNode = imageType.create({}, captionNode);
    if (!imageNode) return;

    const $from = state.selection.$from;
    if ($from.depth === 0) {
      // 顶层:直接在选区前插入
      dispatch(state.tr.insert(state.selection.from, imageNode));
    } else {
      const blockNode = $from.node(1);
      const blockStart = $from.before(1);
      const blockEnd = $from.after(1);
      // 当前 block 为空段落 → 替换
      const isEmptyParagraph =
        blockNode.type.name === 'text-block' &&
        blockNode.content.size === 0 &&
        (blockNode.attrs.level == null);
      let tr = state.tr;
      if (isEmptyParagraph) {
        tr = tr.replaceWith(blockStart, blockEnd, imageNode);
      } else {
        // 在当前 block 之后插入
        tr = tr.insert(blockEnd, imageNode);
      }
      // 光标移到 image caption 内(让用户能直接写 caption 或继续编辑)
      const insertPos = isEmptyParagraph ? blockStart : blockEnd;
      // image 起点 + 1 进入 image,再 + 1 进入 caption text-block 内
      const captionPos = insertPos + 2;
      const sel = TextSelection.create(tr.doc, captionPos);
      tr = tr.setSelection(sel).scrollIntoView();
      dispatch(tr);
    }
    inst.view.focus();
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
      const blockNode = $from.node(1);
      const blockStart = $from.before(1);
      const blockEnd = $from.after(1);
      const isEmptyParagraph =
        blockNode.type.name === 'text-block' &&
        blockNode.content.size === 0 &&
        blockNode.attrs.level == null;
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
   * 插入 mathInline atom(L5-B3.6)
   *
   * 行为:
   * - 有选区 → 选中文本作 latex 源码,替换为 mathInline(floating toolbar 主入口语义)
   *   例:选 "x^2 + y^2" → 转成 mathInline latex="x^2 + y^2"
   * - 无选区 → 插入空 mathInline,用户单击触发编辑弹窗
   *
   * mathInline 是 inline atom,只能插在 text-block 等 inline 容器里。
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
   * 第一行 tableHeader,后续 tableCell;每 cell 含一个空 text-block 段落
   * 默认 3x3,可通过参数自定义
   */
  insertTableAtSelection(instanceId: string, rows = 3, cols = 3): void {
    const inst = instanceRegistry.get(instanceId);
    if (!inst) return;
    insertTableCommand(rows, cols)(inst.view.state, inst.view.dispatch);
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
};

/**
 * 通用 atom block 插入辅助(L5-B3.14)— 给 fileBlock / externalRef 等无内嵌 caption
 * 的 atom 节点用。
 *
 * - 空段落 → 替换;非空段落 → 当前 block 之后插入
 * - 不带任何 attrs(由 NodeView placeholder 引导用户填)
 */
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
    const blockNode = $from.node(1);
    const blockStart = $from.before(1);
    const blockEnd = $from.after(1);
    const isEmptyParagraph =
      blockNode.type.name === 'text-block' &&
      blockNode.content.size === 0 &&
      blockNode.attrs.level == null &&
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
