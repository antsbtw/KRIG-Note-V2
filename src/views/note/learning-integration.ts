/**
 * NoteView learning 桥接(S2 后:仅留 vocab → driver setVocabWords 桥接)
 *
 * 历史:本文件原含 vocab bridge + showDictionaryPanel/showTranslationPanel 两触发函数。
 * - S2 触发函数搬 capabilities/learning/ui/help-panel-integration.ts(D-3 决议)
 * - S4 vocab bridge 也搬 capability(D-4 决议)
 * - S5 本文件整体删除
 *
 * 当前 vocab bridge 职责(暂留):
 * 1. 启动取一次 vocab 全量 + 订阅 onVocabChanged → 调 text-editing.api.setVocabWords
 *    分发到所有 PM instance(供 vocab-highlight plugin 重建 decorations)
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { LearningApi } from '@capabilities/learning/types';
import type { TextEditingApi } from '@capabilities/text-editing/types';

export function registerLearningIntegration(): void {
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
