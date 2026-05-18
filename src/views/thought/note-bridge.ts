/**
 * Note ↔ Thought 跨槽桥(thought-view-port.md v0.5 §5.8/§5.9)
 *
 * 两个方向:
 * A) Note → Thought:用户点 Note 内 thought mark / image attr / block frame
 *    → text-editing ThoughtAnchorHandler.onAnchorClick(payload)
 *    → 本桥开右槽 ThoughtView + emit 'thought.activate'(payload)
 *    → ThoughtView 监听 channel → setActiveThought(payload.thoughtId)
 *
 * B) Thought → Note:用户点 ThoughtView 卡片"📝 Note xxx"anchor 链接
 *    → emit 'thought.scroll-to-anchor'(thoughtId, source/locator)
 *    → 本桥(NoteView 端订阅)调 text-editing.api.scrollToThoughtAnchor
 *
 * driver decoration 色解析:
 *   thought-anchor-plugin 渲染 block decoration 时按 frameThoughtId 查 thoughtType,
 *   本桥提供 resolveThoughtType(同步,从 useAllThoughts 的最近一次广播缓存读)。
 *
 * 注册时机:在 thought view self-register 时调,模块级 singleton(同 link-click handler 模式)。
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import type {
  ThoughtCapabilityApi,
  ThoughtInfo,
} from '@capabilities/thought/types';

/** 本地缓存:最近一次 thoughtCapability 广播 — driver decoration 色解析同步用 */
let thoughtCache = new Map<string, ThoughtInfo>();

function rebuildCache(list: ThoughtInfo[]): void {
  thoughtCache = new Map(list.map((t) => [t.id, t]));
}

export function registerNoteBridge(): void {
  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
  const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');

  // 初始拉 + 订阅广播(driver decoration 用 resolveThoughtType 时拿缓存)
  void thoughtApi.listThoughts().then(rebuildCache);
  thoughtApi.onListChanged(rebuildCache);

  // 注册 thought-anchor handler(driver 内点击 mark/node 时回调)
  textEditing.setThoughtAnchorHandler({
    onAnchorClick: ({ thoughtId }) => {
      const wsId = workspaceManager.getActiveId();
      if (!wsId) return;
      const bus = workspaceManager.getBus(wsId);
      if (!bus) return;
      // 开右槽 ThoughtView + 广播激活(ThoughtView 监听 channel 切 active)
      bus.slot.openRight('thought-view');
      bus.channels.emit('thought.activate', { thoughtId });
    },
    resolveThoughtType: (thoughtId) => thoughtCache.get(thoughtId)?.type ?? null,
  });
}
