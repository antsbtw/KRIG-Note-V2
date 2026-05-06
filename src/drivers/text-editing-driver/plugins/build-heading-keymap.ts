/**
 * heading keymap — Mod-Alt-0(paragraph)/ 1 / 2 / 3
 *
 * Q2=A h1/h2/h3 范围。键位 Mod-Alt-N 避免与浏览器/系统 Cmd+N 冲突。
 *
 * setBlockType 走 prosemirror-commands(标准用法)— textBlock 节点可改 attrs.level。
 */

import { keymap } from 'prosemirror-keymap';
import { setBlockType } from 'prosemirror-commands';
import type { Plugin, Command } from 'prosemirror-state';
import type { Schema } from 'prosemirror-model';

export function buildHeadingKeymap(schema: Schema): Plugin {
  const textBlock = schema.nodes['text-block'];
  if (!textBlock) return keymap({});

  const setLevel = (level: number | null): Command =>
    setBlockType(textBlock, { level });

  return keymap({
    'Mod-Alt-0': setLevel(null),
    'Mod-Alt-1': setLevel(1),
    'Mod-Alt-2': setLevel(2),
    'Mod-Alt-3': setLevel(3),
  });
}
