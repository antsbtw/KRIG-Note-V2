/**
 * slot-visibility — 「某个 view 实例此刻是否在台上」的**唯一**来源(per-workspace)
 *
 * ## 为什么需要它
 *
 * SlotArea 对未占槽的 view **不卸载**,而是 `display:none` 保活
 * (SlotArea.tsx:85「避免切 view 时实例重建丢状态」)。这个决策本身是对的,
 * 但它给所有**自己算布局**的 view 埋了一类 bug:
 *
 *   `display:none` 的元素 clientWidth/Height 恒为 0。于是
 *   `if (w <= 0) return` 这类零尺寸守卫会把隐藏期间的通知全吞掉,
 *   而 iframe / canvas / WebGL 这些**命令式渲染引擎**不像普通 DOM 会自愈 ——
 *   重新可见时没人推它一把,它就一直停在"尺寸为 0 时算出的那套布局"上。
 *
 * 实测症状:EPUB 切走再切回 → 正文空白(toolbar 和页码正常,因为那是 React 画的),
 * 翻一页就好了(翻页强制 foliate 重新布局)。PDF、Graph 画板同族,见下方消费方列表。
 *
 * ## 为什么不能让 view 自己判断
 *
 * **view 从自己的 props 根本看不出自己在不在台上**:隐藏单元的 `slot` prop
 * 恒为 `'left'`(SlotArea.tsx:94),`pos` 算出来了却从不下传。
 *
 * 让每个 view 各自去 `offsetParent`/`checkVisibility()` 猜,正是
 * memory「别猜自己在哪一栏」那条铁律禁止的事 —— 同一个病灶的第二种形态:
 * 不但不能猜在哪栏,连"在不在台上"也不许猜。**必须由框架告知。**
 *
 * ## 语义
 *
 * visible = 该 view 实例正占据某个可见槽(left / right)。
 * hidden  = 它仍挂在 DOM 里保活,但 `display:none`。
 *
 * 消费方关心的是 **false → true 的边沿**(重新上台),拿到后各自调用自己那个
 * 幂等的"重新布局"入口。注意:上台时容器尺寸可能尚未由浏览器结算完,
 * 消费方应在 rAF 里再读尺寸(见 useOnSlotVisible)。
 *
 * ## 存储策略:纯内存、会话级、per-(wsId, viewId)
 *
 * 同 active-slot —— 不落库。可见性是瞬时呈现状态,重启后由 SlotArea 重新播报。
 * key 用 viewId 而非 slot:同一个 view 在 left/right 间搬家时"在不在台上"没变,
 * 不该因此触发一次假的重新布局。
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';

type Listener = () => void;

/** key = `${wsId}::${viewId}`。缺省(未记录)= false(未上台) */
const visibleByKey = new Map<string, boolean>();
const listeners = new Map<string, Set<Listener>>();

function makeKey(wsId: string, viewId: string): string {
  return `${wsId}::${viewId}`;
}

function emit(key: string): void {
  listeners.get(key)?.forEach((l) => l());
}

/** 读某个 view 实例是否在台上。非组件路径用这个同步读。 */
export function getSlotVisible(wsId: string, viewId: string): boolean {
  return visibleByKey.get(makeKey(wsId, viewId)) ?? false;
}

/**
 * 播报可见性(**只该由 SlotArea 调用** —— 它是唯一知道 pos 的地方)。
 *
 * 幂等:值没变时不 emit。SlotArea 每次渲染都会播报,不去重会让消费方
 * 每帧都以为"刚上台"而反复重新布局。
 */
export function setSlotVisible(wsId: string, viewId: string, visible: boolean): void {
  if (!wsId || !viewId) {
    console.error(
      `[slot-visibility] 空 wsId/viewId(ws=${wsId} view=${viewId}),已忽略。`,
    );
    return;
  }
  const key = makeKey(wsId, viewId);
  if ((visibleByKey.get(key) ?? false) === visible) return;
  visibleByKey.set(key, visible);
  emit(key);
}

/** React 订阅(useSyncExternalStore 模式,同 active-slot)*/
export function subscribeSlotVisible(
  wsId: string,
  viewId: string,
  cb: Listener,
): () => void {
  const key = makeKey(wsId, viewId);
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
  };
}

/** React hook:订阅本 view 实例的可见性。与 getSlotVisible 同源。 */
export function useSlotVisible(wsId: string, viewId: string): boolean {
  return useSyncExternalStore(
    (cb) => subscribeSlotVisible(wsId, viewId, cb),
    () => getSlotVisible(wsId, viewId),
  );
}

/**
 * 「重新上台」回调 —— 消费方的主入口。
 *
 * 只在 **false → true 边沿**触发,不在挂载时首次触发(首次上台时 view 自己的
 * 加载流程已经会布局一次,再补一刀是多余的重绘)。
 *
 * 回调在 **rAF 之后**执行:`display` 从 none 变回 flex 的那一帧,容器尺寸
 * 尚未由浏览器结算,当场读 clientWidth 仍是 0 —— 那样这次修复自己就会被
 * 零尺寸守卫吞掉,和 bug 本身一模一样。
 *
 * @param wsId   workspace id
 * @param viewId 本 view 的注册 id(与 viewTypeRegistry 一致)
 * @param onShow 重新上台时调用;应当是**幂等的重新布局**入口
 */
export function useOnSlotVisible(
  wsId: string,
  viewId: string,
  onShow: () => void,
): void {
  const visible = useSlotVisible(wsId, viewId);
  const prevRef = useRef(visible);
  // 回调每次渲染都在变(调用方多为内联箭头),用 ref 持最新的,
  // 避免把它放进 deps 导致每次渲染都重跑 effect。
  const cbRef = useRef(onShow);
  cbRef.current = onShow;

  useEffect(() => {
    const was = prevRef.current;
    prevRef.current = visible;
    if (was || !visible) return; // 只认 false → true
    const raf = requestAnimationFrame(() => cbRef.current());
    return () => cancelAnimationFrame(raf);
  }, [visible]);
}

/** ws 被删除时清理(避免 Map 无限增长)*/
export function clearSlotVisibility(wsId: string): void {
  const prefix = `${wsId}::`;
  for (const key of [...visibleByKey.keys()]) {
    if (key.startsWith(prefix)) visibleByKey.delete(key);
  }
  for (const key of [...listeners.keys()]) {
    if (key.startsWith(prefix)) listeners.delete(key);
  }
}
