/**
 * vocab → text-editing driver 桥接(S4 上提,D-4 决议)
 *
 * 职责:学习模块持有 vocab 数据;text-editing driver 的 vocab-highlight plugin
 * 在 PM 文档中高亮已收藏单词。本桥接把 vocab 列表推给 driver,driver 内部遍历
 * instanceRegistry 给每个 PM 实例 dispatch decoration 更新 — 所有 PM-using
 * view 自动受益。
 *
 * 装配:capability/learning/index.ts 加载副作用末尾调
 *      bridgeVocabToTextEditing({ vocabList, onVocabChanged })
 *      传 capability 自己的 vocab API 进来 — 依赖注入避免循环 import 自身。
 *
 * **加载顺序前提**(platform/renderer/index.tsx 字面):
 *   line 32  import '@capabilities/text-editing'  ← 先注册
 *   line 33  import '@capabilities/learning'      ← learning 加载时 text-editing 已就绪
 * 所以 bridge 内 requireCapabilityApi<TextEditingApi>('text-editing') 必能拿到 api。
 *
 * 历史(S4 前):本桥接在 views/note/learning-integration.ts;NoteView init 时调。
 * S4 后归 learning capability 自管 — 所有 view 自动受益,view 不必各自集成。
 *
 * 跨 view 平等消费:driver.setVocabWords 遍历 instanceRegistry,
 * NoteView / ThoughtView / canvas-text-node popup 等任何 PM 实例都自动拿到 vocab 高亮。
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import type { VocabEntry } from '../types';

interface VocabSourceDeps {
  vocabList(): Promise<VocabEntry[]>;
  onVocabChanged(cb: (entries: VocabEntry[]) => void): () => void;
}

export function bridgeVocabToTextEditing(deps: VocabSourceDeps): void {
  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');

  // 1. 启动取一次全量 → 分发到 PM
  //    (冷启动时 instance 可能还没 mount,落在空的 instanceRegistry 无害;
  //     后续 onVocabChanged 总会再推一次)
  void deps.vocabList().then((entries) => {
    textEditing.api.setVocabWords(entries);
  });

  // 2. 订阅变化(任何 add/remove 都推全量 list)
  deps.onVocabChanged((entries) => {
    textEditing.api.setVocabWords(entries);
  });
}
