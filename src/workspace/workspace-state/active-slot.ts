/**
 * active-slot — 「当前活跃槽」的**唯一**来源(per-workspace)
 *
 * 语义:最后被用户点击 / 编辑的那个槽。navSide 呈现哪一栏的导航、树上点笔记开到
 * 哪一栏、工具栏哪一条高亮,全部从这里读。
 *
 * ## 为什么必须是单一来源
 *
 * 对称化之前,「当前是哪个槽」在各处各算各的 —— `slotBinding.left ?? right`(navSide)、
 * `getInvokingSlot() ?? 'left'`(toolbar 命令)、焦点实例反查(编辑命令)。三套推导在
 * 双开下会互相打架:navSide 恒显左栏,但命令落到右栏。
 *
 * 本模块是这轮抽象的**全部价值**:全仓只此一处判断「当前是哪个槽」。
 * 若出现第二处自行推导,即为实施失败(见 slot-navside-follow-active-design.md §4.1)。
 *
 * 注意:`toolbar-invocation.ts` 的 `getInvokingSlot()` **不是**第二个来源 —— 它回答的是
 * 「这条命令是被哪条 toolbar 触发的」(调用者身份),与「用户焦点在哪一栏」是两件事。
 * 点右栏工具栏时两者恰好一致,但快捷键 / 树点击路径下 invokingSlot 为 null,那时才轮到
 * activeSlot 作答。两者是**互补**而非重复:invokingSlot 优先(调用方显式携带,
 * 见 PROTOCOL.md §1.5 原则 1 的推论),它缺席时回落 activeSlot。
 *
 * ## 存储策略:纯内存、会话级、per-wsId
 *
 * **不进 pluginStates、不落库**。理由:重启后没有「编辑焦点」这回事,回落 left
 * 天经地义;把瞬时焦点持久化只会让下次冷启动带着上次的残留状态。
 */

import { useSyncExternalStore } from 'react';

export type ActiveSlot = 'left' | 'right';

type Listener = () => void;

/** per-wsId 活跃槽。缺省(未记录)= 'left' */
const activeSlotByWs = new Map<string, ActiveSlot>();
const listeners = new Map<string, Set<Listener>>();

function emit(wsId: string): void {
  listeners.get(wsId)?.forEach((l) => l());
}

/**
 * 读某个 ws 的活跃槽。
 *
 * 这是**唯一**允许回答「当前是哪个槽」的函数。调用方拿到值后不得再叠加自己的
 * 条件判断(如"但如果 right 是 xx view 就当 left")—— 那会重新引入本模块要消灭的
 * 分散推导。
 */
export function getActiveSlot(wsId: string): ActiveSlot {
  return activeSlotByWs.get(wsId) ?? 'left';
}

/**
 * 设活跃槽(用户点击 / 编辑触发)。
 *
 * 幂等:值没变时不 emit,避免 useSyncExternalStore 无谓重渲(点同一栏多次是常态)。
 */
export function setActiveSlot(wsId: string, slot: ActiveSlot): void {
  // fail loud:槽值只有 left / right 两种。传进别的东西说明调用方在瞎猜槽
  // (如把 'hidden' 单元或 viewId 当槽传),静默接受会让后续所有解析跟着错位。
  if (slot !== 'left' && slot !== 'right') {
    console.error(`[active-slot] 非法槽值 ${String(slot)}(ws=${wsId}),已忽略。`);
    return;
  }
  if (!wsId) {
    console.error('[active-slot] setActiveSlot 收到空 wsId,已忽略。');
    return;
  }
  if (getActiveSlot(wsId) === slot) return;
  activeSlotByWs.set(wsId, slot);
  emit(wsId);
}

/**
 * 回落保护:right 槽不存在时把焦点拉回 left。
 *
 * 为什么必须有:关右栏后 activeSlot 若仍停在 'right',会出现「焦点指向不存在的槽」——
 * navSide 解析不出 view、树上点笔记写进 rightActiveNoteId 却没有实例呈现 = 开到虚空。
 *
 * 由 WorkspaceInstance 在每次渲染时按 slotBinding 调用(渲染即对账),而不是在
 * closeRight 里补一刀 —— 关右栏的路径不止一条(toolbar ✕ / bus.closeRight /
 * closeLeft 升级),逐个补必漏。
 */
export function reconcileActiveSlot(wsId: string, hasRight: boolean): void {
  if (!hasRight && getActiveSlot(wsId) === 'right') {
    setActiveSlot(wsId, 'left');
  }
}

/** React 订阅(useSyncExternalStore 模式,同 toc-toggle-store)*/
export function subscribeActiveSlot(wsId: string, cb: Listener): () => void {
  let set = listeners.get(wsId);
  if (!set) {
    set = new Set();
    listeners.set(wsId, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
  };
}

/**
 * React hook:订阅本 ws 的活跃槽。
 *
 * 与 getActiveSlot 同源(hook 只是订阅包装),不构成第二处判断。
 * 命令 / 非组件路径用 getActiveSlot 同步读。
 */
export function useActiveSlot(wsId: string): ActiveSlot {
  return useSyncExternalStore(
    (cb) => subscribeActiveSlot(wsId, cb),
    () => getActiveSlot(wsId),
  );
}

/**
 * 「活跃槽装的是哪个 view」——**槽 → viewId 的唯一解析**。
 *
 * 抽出理由:回落链(本槽 → 另一槽)原先在 WorkspaceInstance 与 keymap-listener
 * 两处逐字重复。留着的话将来改回落规则必漏一处 —— 而回落规则正是那种「改一处
 * 忘一处就产生诡异不一致」的东西(例:某天决定"本槽为空就不回落、直接不匹配",
 * 只改了 navSide 那处,快捷键仍在回落,同一状态下两者认的 view 不同)。
 *
 * 顺带把「有效活跃槽」的校正也收进来:store 里可能仍是 'right' 而右栏已被关掉
 * (reconcileActiveSlot 走 useEffect,渲染后才跑),这里当场按 slotBinding 对齐。
 * 这**不是**第二处判断 —— 唯一来源仍是 activeSlot,此处只是把它与「槽是否存在」
 * 这个客观事实对齐。
 *
 * @param slotBinding 当前 ws 的槽绑定
 * @param slot        活跃槽(调用方从 getActiveSlot / useActiveSlot 取)
 * @returns 活跃槽的 view;该槽为空则回落另一槽;都为空返回 null
 */
export function resolveActiveViewId(
  slotBinding: { left: string | null; right: string | null },
  slot: ActiveSlot,
): string | null {
  // 有效活跃槽:指向一个空槽时当场回落 left(避免中间帧闪一下错栏的导航)
  const effective: ActiveSlot = slot === 'right' && !slotBinding.right ? 'left' : slot;
  const primary = effective === 'right' ? slotBinding.right : slotBinding.left;
  const secondary = effective === 'right' ? slotBinding.left : slotBinding.right;
  return primary ?? secondary ?? null;
}

/** ws 被删除时清理(避免 Map 无限增长)*/
export function clearActiveSlot(wsId: string): void {
  activeSlotByWs.delete(wsId);
  listeners.delete(wsId);
}
