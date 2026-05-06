/**
 * marks keymap — Mod-b / Mod-i / Mod-Shift-x / Mod-e
 *
 * Q1=A 4 marks。Q-key:Cmd+Shift+X 切 strike(VS Code 风格,避歧义)。
 */

import { keymap } from 'prosemirror-keymap';
import { toggleMark } from 'prosemirror-commands';
import type { Plugin, Command } from 'prosemirror-state';
import type { Schema } from 'prosemirror-model';

export function buildMarkKeymap(schema: Schema): Plugin {
  const km: Record<string, Command> = {};
  if (schema.marks.bold) km['Mod-b'] = toggleMark(schema.marks.bold);
  if (schema.marks.italic) km['Mod-i'] = toggleMark(schema.marks.italic);
  if (schema.marks.strike) km['Mod-Shift-x'] = toggleMark(schema.marks.strike);
  if (schema.marks.code) km['Mod-e'] = toggleMark(schema.marks.code);
  return keymap(km);
}
