/**
 * NoteView help-panel 注册(L4.1)
 *
 * 注册:
 * - note-view.help.dictionary  — DictionaryPanel(查词 / 翻译 / 生词本)
 *   触发:右键菜单 cm-dictionary-lookup / cm-translate-text(见 note-commands.ts)
 *
 * 形态:右栏定宽长侧栏(对比 popup 是 anchor-positioned 小卡)。
 * 互斥:跟其他 help-panel 互斥(目前只有 dictionary 一个;未来 latex/mermaid 等加入)。
 */

import { helpPanelRegistry } from '@slot/interaction-registries/help-panel-registry/help-panel-registry';
import { DictionaryPanel } from './dictionary-panel/DictionaryPanel';

export function registerNoteHelpPanels(): void {
  helpPanelRegistry.register({
    id: 'note-view.help.dictionary',
    view: 'note-view',
    title: '📖 词典',
    Component: DictionaryPanel,
  });
}
