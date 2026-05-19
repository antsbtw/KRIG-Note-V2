/**
 * AskAIPanel 模块出口
 *
 * 在 src/views/note/index.ts 中 import 调 registerAskAIPopup():
 * 1. 注册 popup 到 popupRegistry
 * 2. 注册 'note-view.open-ask-ai-popup' 命令(供跨 view 调用,避免 view 间直 import)
 *
 * 跨 view 调用方式(thought-view 等):
 *   commandRegistry.execute('note-view.open-ask-ai-popup', {
 *     selectionMarkdown, selectionDocJSON, defaultServiceId, anchorX, anchorY,
 *   });
 */

import { popupRegistry } from '@slot/interaction-registries/popup-registry/popup-registry';
import { commandRegistry } from '@slot/command-registry/command-registry';
import { popupController } from '@slot/triggers/popup-controller';
import { AskAIPanel } from './AskAIPanel';
import { ASK_AI_POPUP_ID, setPendingAskAIContext, type AskAIContext } from './panel-context';

interface OpenAskAIPopupArg extends AskAIContext {
  /** anchor 视口坐标(右键点击位置)— fake div 模式给 popupController 用 */
  anchorX: number;
  anchorY: number;
}

function isOpenAskAIPopupArg(v: unknown): v is OpenAskAIPopupArg {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.selectionMarkdown === 'string' &&
    typeof o.anchorX === 'number' &&
    typeof o.anchorY === 'number' &&
    typeof o.defaultServiceId === 'string' &&
    typeof o.thoughtId === 'string' &&
    typeof o.instanceId === 'string'
  );
}

export function registerAskAIPopup(): void {
  popupRegistry.register({
    id: ASK_AI_POPUP_ID,
    view: 'note-view',
    Component: AskAIPanel,
    estimatedSize: { width: 320, height: 280 },
  });

  // 跨 view 入口命令(thought-view.ask-ai-from-note 等通过 commandRegistry.execute 调)
  commandRegistry.register('note-view.open-ask-ai-popup', (arg: unknown) => {
    if (!isOpenAskAIPopupArg(arg)) {
      console.warn('[note-view.open-ask-ai-popup] invalid arg', arg);
      return;
    }
    setPendingAskAIContext({
      selectionMarkdown: arg.selectionMarkdown,
      defaultServiceId: arg.defaultServiceId,
      thoughtId: arg.thoughtId,
      instanceId: arg.instanceId,
    });
    // fake anchor:1x1 透明 div(同 note-link-search/integration.ts 模式)
    const fake = document.createElement('div');
    fake.style.position = 'fixed';
    fake.style.left = `${arg.anchorX}px`;
    fake.style.top = `${arg.anchorY}px`;
    fake.style.width = '1px';
    fake.style.height = '1px';
    fake.style.pointerEvents = 'none';
    document.body.appendChild(fake);
    popupController.show(ASK_AI_POPUP_ID, fake);
    window.setTimeout(() => fake.remove(), 0);
  });
}
