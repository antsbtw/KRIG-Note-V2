/**
 * backspace-decision — Backspace 优先级链(keyboard-system.md §4.2 = backspace-system §2.0)
 *
 * 块首/空块时从高到低每次只走一步:isTitle 保护 → caption 不删块 → 减缩进 →
 * 标题降级 → 列表退出 → 容器顶级退出(cell 硬墙 noop)→ 顶级合并。
 *
 * Phase 0(脚手架):返回 false(不接管 → 放行现有 keymap + baseKeymap)。Phase 2 按 §4.2 实现。
 */

import type { Command } from 'prosemirror-state';
import type { KeyboardMetaLookup } from './resolve-context';

/**
 * @param _metaLookup 块键盘元数据查表(Phase 2 用)
 */
export function buildBackspaceCommand(_metaLookup: KeyboardMetaLookup): Command {
  return (_state, _dispatch, _view) => {
    // Phase 0:未接管。Phase 2 实现 §4.2 优先级链。
    return false;
  };
}
