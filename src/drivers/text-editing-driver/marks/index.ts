/**
 * driver 内建 marks — 4 个(L5-B2 范围)
 *
 * 见 docs/RefactorV2/stages/L5B2-marks-undo-design.md § 3.1。
 */

import type { MarkSpec } from 'prosemirror-model';
import { boldMark } from './bold';
import { italicMark } from './italic';
import { strikeMark } from './strike';
import { codeMark } from './code';

export const MARKS: Record<string, MarkSpec> = {
  bold: boldMark,
  italic: italicMark,
  strike: strikeMark,
  code: codeMark,
};

/** schema 装载顺序(影响 toDOM 输出嵌套)— 由约定保证稳定 */
export const ENABLED_MARK_NAMES = ['bold', 'italic', 'strike', 'code'] as const;
