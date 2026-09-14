/**
 * heading keymap — Mod-Alt-0(paragraph)/ 1..6
 *
 * 键位 Mod-Alt-N 避免与浏览器/系统 Cmd+N 冲突。
 *
 * setBlockType 走 prosemirror-commands(标准用法):
 * - Mod-Alt-0 → 切到 paragraph 节点
 * - Mod-Alt-1..6 → 切到 heading 节点 (level=1..6)
 *
 * D2 决议: heading.level schema 支持 1-6。keymap 原只绑 1-3,
 * 后与 slash / turn-into 菜单一并补齐到 1-6(h4~h6 此前只能靠 `#### ` 输入规则打出,
 * 菜单里完全不可见)。
 */

import { keymap } from 'prosemirror-keymap';
import { setBlockType } from 'prosemirror-commands';
import type { Plugin, Command } from 'prosemirror-state';
import type { Schema } from 'prosemirror-model';

export function buildHeadingKeymap(schema: Schema): Plugin {
  const paragraph = schema.nodes.paragraph;
  const heading = schema.nodes.heading;
  if (!paragraph || !heading) return keymap({});

  const setParagraph: Command = setBlockType(paragraph);
  const setHeading = (level: number): Command => setBlockType(heading, { level });

  return keymap({
    'Mod-Alt-0': setParagraph,
    'Mod-Alt-1': setHeading(1),
    'Mod-Alt-2': setHeading(2),
    'Mod-Alt-3': setHeading(3),
    'Mod-Alt-4': setHeading(4),
    'Mod-Alt-5': setHeading(5),
    'Mod-Alt-6': setHeading(6),
  });
}
