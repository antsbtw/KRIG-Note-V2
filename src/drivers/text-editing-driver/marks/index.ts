/**
 * driver 内建 marks
 *
 * L5-B2:bold / italic / strike / code(4 个)
 * L5-B3.3:+ underline / textStyle / highlight(7 个)
 * L5-B3.4(待):+ link
 */

import type { MarkSpec } from 'prosemirror-model';
import { boldMark } from './bold';
import { italicMark } from './italic';
import { strikeMark } from './strike';
import { codeMark } from './code';
import { underlineMark } from './underline';
import { textStyleMark } from './text-style';
import { highlightMark } from './highlight';

export const MARKS: Record<string, MarkSpec> = {
  bold: boldMark,
  italic: italicMark,
  underline: underlineMark,
  strike: strikeMark,
  code: codeMark,
  textStyle: textStyleMark,
  highlight: highlightMark,
};

/** schema 装载顺序(影响 toDOM 输出嵌套)— 由约定保证稳定 */
export const ENABLED_MARK_NAMES = [
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'textStyle',
  'highlight',
] as const;
