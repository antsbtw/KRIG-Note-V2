/**
 * build-keyboard-keymap — 集中键盘 keymap(keyboard-system.md §5.2)
 *
 * 装一组 { Enter, Backspace }(Shift-Enter 软换行后续并入),内部走决策链。
 * 目标:替代现状散落的多个 Enter/Backspace keymap(toggle/column/image/html/math/list/
 * code/split-indent/hardBreak + baseKeymap 兜底),收敛到单点。
 *
 * Phase 0(脚手架):构建 + 元数据查表就绪,但决策命令返回 false(不接管)。
 * **本 keymap Phase 0 不挂载到 editor-view-builder**——纯新增,零行为变化。
 * Phase 1 挂 Enter、Phase 2 挂 Backspace,逐步从旧 keymap 接管。
 */

import { keymap } from 'prosemirror-keymap';
import type { Plugin } from 'prosemirror-state';
import type { BlockSpec, KeyboardMeta } from '../types';
import type { KeyboardMetaLookup } from './resolve-context';
import { buildEnterCommand } from './enter-decision';
import { buildBackspaceCommand } from './backspace-decision';
import { DEFAULT_KEYBOARD_META } from './default-keyboard-meta';

/**
 * 从 BlockSpec 列表建「块类型名 → keyboard 元数据」查表。
 *
 * 来源合并:DEFAULT_KEYBOARD_META(内置表)为底,BlockSpec.keyboard(单块覆盖)叠加在上。
 */
export function buildKeyboardMetaLookup(blocks: BlockSpec[]): KeyboardMetaLookup {
  const map = new Map<string, KeyboardMeta>();
  for (const [id, meta] of Object.entries(DEFAULT_KEYBOARD_META)) {
    map.set(id, meta);
  }
  for (const b of blocks) {
    if (b.keyboard) map.set(b.id, { ...map.get(b.id), ...b.keyboard });
  }
  return (typeName: string) => map.get(typeName);
}

/**
 * 装配集中键盘 keymap。
 *
 * @param blocks 启用的 BlockSpec(取 keyboard 元数据)
 */
export function buildKeyboardKeymap(blocks: BlockSpec[]): Plugin {
  const metaLookup = buildKeyboardMetaLookup(blocks);
  return keymap({
    Enter: buildEnterCommand(metaLookup),
    Backspace: buildBackspaceCommand(metaLookup),
  });
}
