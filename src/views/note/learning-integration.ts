/**
 * note view learning 集成(L5-B3.20b)
 *
 * 职责:
 * 1. 启动取一次 vocab 全量 + 订阅 onVocabChanged → 调 driver setVocabWords
 *    分发到所有 PM instance(供 vocab-highlight plugin 重建 decorations)
 * 2. 暴露 showDictionaryPanel(word, ctx?, anchorRect?) /
 *           showTranslationPanel(text, anchorRect?)
 *    给 contextMenu cm-dictionary-lookup / cm-translate-text 命令调
 *
 * W5-A View 边界:走 requireCapabilityApi<LearningApi>('learning'),
 * 不直 import @capabilities/learning 运行时函数(types 是类型 only,纯擦除可 import)。
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { LearningApi } from '@capabilities/learning/types';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import { popupController } from '@slot/triggers/popup-controller';
import { setPanelInitial } from './dictionary-panel/DictionaryPanel';

const POPUP_ID = 'note-view.popup.dictionary';

export function registerLearningIntegration(): void {
  // W5-A View 边界:走 capability 间接路由(text-editing capability 把
  // driverApi 整包暴露在 .api 字段,setVocabWords 通过它访问)
  const learning = requireCapabilityApi<LearningApi>('learning');
  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');

  // 1. 启动取一次全量 → 分发到 PM(冷启动时 instance 可能还没 mount,
  //    此时分发会落在空的 instanceRegistry — 后续 onVocabChanged 总会再推一次)
  void learning.vocabList().then((entries) => {
    textEditing.api.setVocabWords(entries);
  });

  // 2. 订阅变化(任何 add/remove 都推全量 list)
  learning.onVocabChanged((entries) => {
    textEditing.api.setVocabWords(entries);
  });
}

/**
 * 给 cm-dictionary-lookup / cm-translate-text 命令调用 — 弹 dictionary popup
 *
 * @param word 要查的词
 * @param context 单词所在句子上下文(B3.20b 暂不传,留 Phase D 增强)
 * @param anchorRect 锚点位置(选区 BoundingClientRect),无则屏幕中心
 */
export function showDictionaryPanel(
  word: string,
  context?: string,
  anchorRect?: DOMRect,
): void {
  setPanelInitial('lookup', word, context);
  showAtAnchor(anchorRect);
}

/**
 * 翻译模式弹出 dictionary popup(选了句子 / 段落时)
 */
export function showTranslationPanel(text: string, anchorRect?: DOMRect): void {
  setPanelInitial('translate', text);
  showAtAnchor(anchorRect);
}

/** 用临时 fake div 作 anchor — popupController 拿 anchor.getBoundingClientRect 就行 */
function showAtAnchor(rect?: DOMRect): void {
  const fake = document.createElement('div');
  fake.style.position = 'fixed';
  if (rect) {
    fake.style.left = `${rect.left}px`;
    fake.style.top = `${rect.bottom}px`;
  } else {
    // fallback:屏幕中心
    fake.style.left = `${window.innerWidth / 2}px`;
    fake.style.top = `${window.innerHeight / 2}px`;
  }
  fake.style.width = '1px';
  fake.style.height = '1px';
  fake.style.pointerEvents = 'none';
  document.body.appendChild(fake);
  popupController.show(POPUP_ID, fake);
  window.setTimeout(() => fake.remove(), 0);
}
