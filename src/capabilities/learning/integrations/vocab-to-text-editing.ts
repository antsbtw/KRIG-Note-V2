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
 * **加载时机**:本函数立即返回,内部用 queueMicrotask 把首次推送 + 订阅 defer 到
 * 下一个 microtask。原因:capability 注册是 ES module 副作用 import 顺序触发的,
 * platform/renderer/index.tsx line 32 text-editing 早于 line 33 learning 加载,
 * **module-top 时刻 text-editing 应该已 register**。但实际启动报错说
 * `text-editing has no api` — 可能 Vite dev 的 ESM HMR / dep pre-bundle 在某些
 * 条件下让 sibling module load 顺序非线性。defer 到 microtask 让本 module load
 * 完 + 后续 capability 也 load 完(同事件循环 tick 内)再调,稳。
 *
 * 副作用:首次 vocab 推送从 sync 变 async 微小延后 — 对 vocab 高亮无感(PM
 * 实例 mount 还要走 React render → 必然在 microtask 后,顺序保留)。
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
  // defer 到下一个 microtask — 等 capability load 完成,避开 text-editing 还没
  // register 的窗口期(具体根因见上文注释)
  queueMicrotask(() => {
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
  });
}
