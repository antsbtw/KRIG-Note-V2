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

/**
 * 广播 callback:diff 检测 thought 变化 → 同步 Note PM 内的 mark/frame/node attr。
 *
 * thought 与 Note anchor 1:1 同生同死 + 状态同步:
 *   - 删 thought atom → 清 Note mark(removeThoughtAnchor 扫 doc 清 mark +
 *     frameThoughtId + image.thoughtId)
 *   - 改 thought.type → 改 Note inline mark 的 attrs.thoughtType(让
 *     `krig-thought-mark--{type}` CSS class 生效,颜色同步)
 *   - block frame / image 三态 anchor 的颜色由 thought-anchor-plugin
 *     decoration 走 resolveThoughtType callback 渲染,thoughtCache 更新后下次
 *     doc transaction 触发 decoration 重算自动跟上
 */
function buildDiffHandler(textEditing: TextEditingApi) {
  return (list: ThoughtInfo[]): void => {
    const oldCache = thoughtCache;
    const newCache = new Map(list.map((t) => [t.id, t]));
    const newIds = new Set(newCache.keys());

    // diff 1:删除(oldCache 有但 newCache 没)
    const deletedIds: string[] = [];
    for (const oldId of oldCache.keys()) {
      if (!newIds.has(oldId)) deletedIds.push(oldId);
    }
    // diff 2:type 变化(两边都有且 type 不同)
    const typeChanges: Array<{ id: string; newType: string }> = [];
    for (const [id, newT] of newCache) {
      const oldT = oldCache.get(id);
      if (oldT && oldT.type !== newT.type) {
        typeChanges.push({ id, newType: newT.type });
      }
    }

    // 更新缓存(decoration 色解析用,thought-anchor-plugin resolveThoughtType 会读)
    thoughtCache = newCache;

    if (deletedIds.length === 0 && typeChanges.length === 0) return;

    const instanceId =
      textEditing.instanceRegistry.getFocusedInstanceId() ??
      workspaceManager.getActiveId();
    if (!instanceId) return;

    for (const id of deletedIds) {
      textEditing.api.removeThoughtAnchor(instanceId, id);
    }
    for (const { id, newType } of typeChanges) {
      textEditing.api.updateThoughtMarkType(instanceId, id, newType);
    }
  };
}

export function registerNoteBridge(): void {
  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
  const thoughtApi = requireCapabilityApi<ThoughtCapabilityApi>('thought');

  const onListChanged = buildDiffHandler(textEditing);

  // 初始拉 + 订阅广播(初次 init 时 thoughtCache 是空,无 deletedIds,纯填缓存)
  void thoughtApi.listThoughts().then(onListChanged);
  thoughtApi.onListChanged(onListChanged);

  // 注册 thought-anchor handler(driver 内点击 mark/node 时回调)
  textEditing.setThoughtAnchorHandler({
    onAnchorClick: ({ thoughtId }) => {
      const wsId = workspaceManager.getActiveId();
      if (!wsId) return;
      const bus = workspaceManager.getBus(wsId);
      if (!bus) return;
      // 开右槽 ThoughtView + 广播激活(ThoughtView 监听 channel 切 active)
      bus.slot.openRight('thought-view');
      bus.channels.emit('thought.activate', { thoughtId, emittedAt: Date.now() });
    },
    resolveThoughtType: (thoughtId) => thoughtCache.get(thoughtId)?.type ?? null,
  });
}
