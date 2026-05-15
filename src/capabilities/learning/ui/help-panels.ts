/**
 * learning help-panel 注册(S2 上提,D-2 决议)
 *
 * help-panel-registry 是 L4 框架(src/slot/interaction-registries/),内部
 * Map<id, item> 按 id 全局唯一,HelpPanelFrame 只按 id 取 Component 渲染,
 * **view 字段不参与渲染过滤**(grep 实证;同 stage 04 popup C4 诊断)。
 *
 * 因此 help-panel 注册由 capability 自管 — capability 加载时一次性注册,
 * view 不主动注册;view 通过 helpPanelController.show(id) 触发,或更高层走
 * LearningUiApi.dictionaryPanel.showLookup() 间接触发。
 *
 * view 字段:undefined(对齐 popup-types.ts:25 "全 view 可用" 约定 —
 * 学习模块底层公共,所有 view 共用)。
 */

import { helpPanelRegistry } from '@slot/interaction-registries/help-panel-registry/help-panel-registry';
import { DictionaryPanel } from './dictionary-panel/DictionaryPanel';
import { LEARNING_HELP_PANEL_ID } from './help-panel-integration';

/** capability 加载时一次性注册 learning 全部 help-panel */
export function registerLearningHelpPanels(): void {
  helpPanelRegistry.register({
    id: LEARNING_HELP_PANEL_ID,
    title: '📖 词典',
    Component: DictionaryPanel,
  });
}
