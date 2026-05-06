/**
 * driver 内建 marks
 *
 * L5-B2:bold / italic / strike / code(4 个)
 * L5-B3.3:+ underline(5 个)
 */

import type { MarkSpec } from 'prosemirror-model';
import { boldMark } from './bold';
import { italicMark } from './italic';
import { strikeMark } from './strike';
import { codeMark } from './code';
import { underlineMark } from './underline';

export const MARKS: Record<string, MarkSpec> = {
  bold: boldMark,
  italic: italicMark,
  underline: underlineMark,
  strike: strikeMark,
  code: codeMark,
};

/** schema 装载顺序(影响 toDOM 输出嵌套)— 由约定保证稳定 */
export const ENABLED_MARK_NAMES = ['bold', 'italic', 'underline', 'strike', 'code'] as const;
