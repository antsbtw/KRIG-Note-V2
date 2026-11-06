/**
 * note-card capability —— 「在别的画面上放一小段 note」的公共组件
 *
 * 设计稿:docs/10-business-design/note/note-card-公共组件设计.md
 *
 * 四层:① 内容(doc 信封 / 纯文字互转)② 显示(doc → SVG + 尺寸)
 *       ③ 编辑(= 画板编辑浮层,受控组件,使用方自己挂;块手柄是开关)④ 框(第 2 步做)
 *
 * 使用方:math-visual 说明卡片(第 1 步);画板 / 导图文字节点(第 3 步迁入)。
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import type { NoteCardApi } from './types';
import { emptyDoc, fromPlainText, toPlainText, contentOf } from './doc';
import { renderSvg } from './render';
import { NoteCardEditor } from './Editor';
import { menuItems } from './menu-items';

export type {
  NoteCardApi,
  NoteDoc,
  NoteNode,
  NoteCardEditorProps,
  NoteCardRect,
  NoteCardMenuItems,
} from './types';

const api: NoteCardApi = {
  emptyDoc,
  fromPlainText,
  toPlainText,
  contentOf,
  renderSvg,
  Editor: NoteCardEditor,
  menuItems,
};

console.info('[note-card] alive | 编辑 = 画板编辑浮层(受控) + atomsToSvg 显示');

capabilityRegistry.register({ id: 'note-card', api });
