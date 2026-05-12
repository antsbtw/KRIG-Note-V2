/**
 * heading keymap — Mod-Alt-0(paragraph)/ 1 / 2 / 3
 *
 * Q2=A h1/h2/h3 范围。键位 Mod-Alt-N 避免与浏览器/系统 Cmd+N 冲突。
 *
 * setBlockType 走 prosemirror-commands(标准用法):
 * - Mod-Alt-0 → 切到 paragraph 节点
 * - Mod-Alt-1/2/3 → 切到 heading 节点 (level=1/2/3)
 *
 * D2 决议: heading.level schema 支持 1-6,但 keymap 只绑 1-3
 * (与 V1 当前 UX 一致;4-6 由 schema 支持,UI 入口可后续扩展)
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
  });
}
