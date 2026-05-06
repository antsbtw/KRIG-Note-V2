/**
 * driver API — view command handler 通过此调 driver
 *
 * 见 L5B2 设计 § 3.4。
 *
 * 边界:view 不持有 EditorView,通过 instanceId 路由到具体实例。
 *       view 不接触 PM 内部对象 — driver api 是 driver 的对外契约。
 */

import { toggleMark, setBlockType } from 'prosemirror-commands';
import { undo, redo } from 'prosemirror-history';
import { instanceRegistry } from './instance-registry';

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
