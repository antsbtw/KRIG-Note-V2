/**
 * learning capability — 命令注册(S3 上提,D-5 决议)
 *
 * 把原 NoteView 注册的 2 个学习命令迁到 capability,
 * 任何 view install 'learning' capability 都自带这 2 个命令(view 不需重复注册)。
 *
 * 命令 id:'note-view.cm-*' → 'learning.cm-*'(决议 D-5)
 * 适用 view:NoteView / ThoughtView / canvas-text-node popup / ebook / web 等
 *           任何想"选区查词/翻译"的 view 都可绑到右键菜单 / keymap / 浮条按钮
 *
 * 入口:capability/learning/index.ts 加载时调 registerLearningCommands()
 *
 * 实现 — 选区取词共用 window.getSelection() PM 通用路径:
 * - 选区为空 / 全 collapsed → no-op(必须 has-selection)
 * - 选区文本 → trim → 走 LearningUiApi.dictionaryPanel.showLookup/showTranslate
 * - 关 context-menu(若 caller 是右键路径触发,关菜单是合理副作用)
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import { contextMenuController } from '@slot/triggers/context-menu-controller';
import { showLookup, showTranslate } from '../ui/help-panel-integration';

export function registerLearningCommands(): void {
  /** 选区单词查词 → 弹 dictionary help-panel(lookup 模式) */
  commandRegistry.register('learning.cm-dictionary-lookup', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (!text) return;
    showLookup(text);
    contextMenuController.hide();
  });

  /** 选区句子 / 段落 → 弹 dictionary help-panel(translate 模式) */
  commandRegistry.register('learning.cm-translate-text', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (!text) return;
    showTranslate(text);
    contextMenuController.hide();
  });
}
