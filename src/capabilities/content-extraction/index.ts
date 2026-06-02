/**
 * content-extraction capability — 门面(renderer 侧)
 *
 * charter §3.2 既定互操作能力("任意来源 → atom")的首个实现 = 网页剪藏(Defuddle → Note)。
 * 结构对齐 tweet-fetcher 先例(门面 + platform/main 实现半)。
 *
 * 触发链路:web view 右键「📥 提取到笔记」(main web-context-menu)→ captureFullPage →
 * WEB_CLIP_RESULT 推回 → 本门面订阅后跑 import-pipeline 建 note + 打开。
 *
 * 注册纪律(§4.5):
 *  1. capabilityRegistry.register({ id:'content-extraction', api })。
 *  2. Web View 通过 install 'content-extraction' 声明依赖(requireCapabilityApi 间接路由)。
 *  3. 模块 load 即 init()(订阅 WEB_CLIP_RESULT);幂等。
 *  4. 单向消费下游能力(content-ingest / media-storage / note),不互相 install。
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import type { ContentExtractionApi, WebClipPayload } from './types';
import { runImportPipeline } from './internal/import-pipeline';

export type { ContentExtractionApi, WebClipPayload } from './types';

let unsubscribe: (() => void) | null = null;

/**
 * 订阅 WEB_CLIP_RESULT,收到 payload 跑 import-pipeline。幂等(重复调只订阅一次)。
 * 返回 unsubscribe。
 */
function init(): () => void {
  if (unsubscribe) return unsubscribe;
  if (!window.electronAPI?.onWebClipResult) {
    console.warn('[content-extraction] electronAPI.onWebClipResult 不可用,剪藏订阅未挂');
    return () => {};
  }
  unsubscribe = window.electronAPI.onWebClipResult((payload) => {
    void runImportPipeline(payload as WebClipPayload | null);
  });
  return unsubscribe;
}

const api: ContentExtractionApi = { init };

capabilityRegistry.register({
  id: 'content-extraction',
  api,
});

// 模块 load 即订阅(renderer bootstrap import 本模块触发)— 触发由右键菜单走通,
// 不需 view 显式调 init,但 init 幂等可重入。
init();
