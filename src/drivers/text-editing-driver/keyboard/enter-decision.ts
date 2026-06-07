/**
 * enter-decision — Enter 决策链(keyboard-system.md §4.1)
 *
 * 向后展开:代码块 softBreak / caption 跳出 / toggle 插同级 / 容器顶级跳出 /
 * 列表拆项 / 普通 textblock splitBlock(继承格式;标题块尾→正文段)。
 *
 * Phase 0(脚手架):返回 false(不接管 → 放行现有 keymap)。Phase 1 按 §4.1 实现。
 */

import type { Command } from 'prosemirror-state';
import type { KeyboardMetaLookup } from './resolve-context';

/**
 * @param _metaLookup 块键盘元数据查表(Phase 1 用)
 */
export function buildEnterCommand(_metaLookup: KeyboardMetaLookup): Command {
  return (_state, _dispatch, _view) => {
    // Phase 0:未接管。Phase 1 实现 §4.1 决策链。
    return false;
  };
}
