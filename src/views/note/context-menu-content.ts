/**
 * NoteView ContextMenu 注册(L5-B3.9 重组,对齐 V1)
 *
 * V1 右键菜单层级(参考 src/plugins/note/components/ContextMenu.tsx):
 *   Cut / Copy / Paste(剪贴板组)
 *   ─── 分隔
 *   Select All
 *   Indent / Outdent(只在缩进可用时;V2 indent 留 Phase B)
 *   ─── 分隔
 *   移除 Bold / Italic / Underline / Strike / Code / Link / 文字色 / 高亮
 *     (只对当前选区激活的 marks 显示)
 *   ─── 分隔
 *   Frame / 删除框定(V2 暂无 frame block,留 Phase D)
 *   查词 / 翻译(选区为单词时,留 Phase D)
 *   添加标注 / 删除标注(thought,V2 暂无,留 Phase D)
 *   问 AI(留 Phase D)
 *   ─── 分隔
 *   Delete block
 *
 * V2 当前(L5-B3.9):
 * - 已支持 group 分组渲染(分隔符)
 * - **Turn Into 已从 context menu 移除**(归 handle 菜单 — 设计上 cm = "改文字 / 操作选区",
 *   "改 block 类型"应该走 handle ⠿ 菜单)
 * - 高级项(移除 marks 真实实现 / 查词 / 翻译 / Ask AI / Frame / Thought)留 sub-stage
 * - 本阶段:基础 5 项 + 占位
 */

import { contextMenuRegistry } from '@slot/interaction-registries/context-menu-registry/context-menu-registry';

const VIEW = 'note-view';

export function registerContextMenu(): void {
  contextMenuRegistry.register([
    // ── group: clipboard ──
    { id: 'note-view.cm.cut', label: '✂ Cut', command: 'note-view.cm-cut',
      view: VIEW, enabledWhen: 'has-selection', group: 'clipboard', order: 10 },
    { id: 'note-view.cm.copy', label: '📋 Copy', command: 'note-view.cm-copy',
      view: VIEW, enabledWhen: 'has-selection', group: 'clipboard', order: 11 },
    { id: 'note-view.cm.paste', label: '📄 Paste', command: 'note-view.cm-paste',
      view: VIEW, enabledWhen: 'is-editable', group: 'clipboard', order: 12 },
    // ── group: selection ──
    { id: 'note-view.cm.select-all', label: '☐ Select All', command: 'note-view.cm-select-all',
      view: VIEW, enabledWhen: 'is-editable', group: 'selection', order: 20 },
    // ── group: marks(占位 — 真实"按选区当前 marks 动态显示移除项"留 sub-stage)──
    { id: 'note-view.cm.remove-marks', label: '✖ 移除格式', command: 'note-view.cm-remove-marks',
      view: VIEW, enabledWhen: 'has-selection', group: 'marks', order: 30 },
    // ── group: destructive ──
    { id: 'note-view.cm.delete-block', label: '🗑 删除 Block', command: 'note-view.cm-delete-block',
      view: VIEW, enabledWhen: 'is-editable', group: 'destructive', order: 90 },
  ]);
}
