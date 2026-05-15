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
    { id: 'note-view.cm.cut', label: '✂ Cut', command: 'text-editing.cm-cut',
      view: VIEW, enabledWhen: 'has-selection', group: 'clipboard', order: 10 },
    { id: 'note-view.cm.copy', label: '📋 Copy', command: 'text-editing.cm-copy',
      view: VIEW, enabledWhen: 'has-selection', group: 'clipboard', order: 11 },
    { id: 'note-view.cm.paste', label: '📄 Paste', command: 'text-editing.cm-paste',
      view: VIEW, enabledWhen: 'is-editable', group: 'clipboard', order: 12 },
    // ── group: selection ──
    { id: 'note-view.cm.select-all', label: '☐ Select All', command: 'text-editing.cm-select-all',
      view: VIEW, enabledWhen: 'is-editable', group: 'selection', order: 20 },
    // ── group: marks(占位 — 真实"按选区当前 marks 动态显示移除项"留 sub-stage)──
    { id: 'note-view.cm.remove-marks', label: '✖ 移除格式', command: 'text-editing.cm-remove-marks',
      view: VIEW, enabledWhen: 'has-selection', group: 'marks', order: 30 },
    // L5-B3.15:选区有 link mark 时显示"移除链接"(条件 has-link)
    { id: 'note-view.cm.remove-link', label: '🔗 移除链接', command: 'text-editing.cm-remove-link',
      view: VIEW, enabledWhen: 'has-link', group: 'marks', order: 31 },
    // L5-B3.20b:learning 查词 / 翻译(选区非空时显)— 用户单词查词 / 多词翻译,
    // 两项都显,内部各自走对应 mode(决策 Q5=A 简化)
    { id: 'note-view.cm.dictionary-lookup', label: '📖 查词',
      command: 'note-view.cm-dictionary-lookup',
      view: VIEW, enabledWhen: 'has-selection', group: 'learning', order: 40 },
    { id: 'note-view.cm.translate-text', label: '🌐 翻译',
      command: 'note-view.cm-translate-text',
      view: VIEW, enabledWhen: 'has-selection', group: 'learning', order: 41 },
    // ── group: destructive ──
    { id: 'note-view.cm.delete-block', label: '🗑 删除 Block', command: 'text-editing.cm-delete-block',
      view: VIEW, enabledWhen: 'is-editable', group: 'destructive', order: 90 },
  ]);
}
