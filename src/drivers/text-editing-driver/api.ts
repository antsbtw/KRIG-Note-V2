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
import { instanceRegistry } from './instance-registry';
import { clearSlashTrigger } from './plugins/build-slash-plugin';

export type MarkName = 'bold' | 'italic' | 'strike' | 'code';

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
};

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
