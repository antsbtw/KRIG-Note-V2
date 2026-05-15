/**
 * learning help-panel 触发入口(S2 上提,D-3 决议)
 *
 * 任何 view 想触发查词 / 翻译面板,通过 LearningUiApi.dictionaryPanel.* 调用:
 *
 *   const ui = requireCapabilityApi<LearningApi>('learning').ui.dictionaryPanel;
 *   ui.showLookup(word, context?);
 *   ui.showTranslate(text);
 *
 * 内部实现:
 * - 写模块级 pending 状态(setPanelInitial)
 * - 调 helpPanelController.show(LEARNING_HELP_PANEL_ID) 弹起 DictionaryPanel
 * - 跟 stage 04 popup-link / note-link-search 同款"capability 自管 lifecycle"模式
 *
 * 历史(stage 04 前):本两函数在 views/note/learning-integration.ts;view 各自
 * import 调用。S5 删 view 端文件后,所有 view 走 capability 路径。
 */

import { helpPanelController } from '@slot/triggers/help-panel-controller';
import { setPanelInitial } from './dictionary-panel/DictionaryPanel';

/** help-panel id(D-2 改名:note-view.help.dictionary → learning.help.dictionary) */
export const LEARNING_HELP_PANEL_ID = 'learning.help.dictionary';

/** 弹查词面板(lookup 模式) — word 必填,context 可选(单词所在句子上下文) */
export function showLookup(word: string, context?: string): void {
  setPanelInitial('lookup', word, context);
  helpPanelController.show(LEARNING_HELP_PANEL_ID);
}

/** 弹翻译面板(translate 模式) — text 必填(句子/段落整段翻译) */
export function showTranslate(text: string): void {
  setPanelInitial('translate', text);
  helpPanelController.show(LEARNING_HELP_PANEL_ID);
}
