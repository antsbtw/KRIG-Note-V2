/**
 * XWorkbenchView —— ⭐ **右栏:X 的操作面板**(第一步仍是占位)
 *
 * ── 用户 2026-10-01 定的形态 ──
 *
 * 「x 的访问页面在左边;x 模块的操作作为一个单独的 view 在 right slot,
 * 　随时可以关闭。**也就是说,两个都是独立的 view**。」
 *
 * ⭐ 为什么这个分法是对的:
 * · **左栏是人在用的**(浏览 X、登录、右键提取)—— 它要全宽、长期开着
 * · **右栏是工具**(采集参数、结果列表、拟回复)—— 用完就关,不该占死一栏
 * · 两个独立 view ⇒ 可以**只开一个**:只想浏览就不开面板,
 *   只想看结果就不必开网页
 *
 * ⚠️ 本 view **不上 navSide 切换条**,走 `slotPickerEntry`
 * (与 `thought-view` 同款):navSide 那一栏留给「网页」,
 * 面板从 right slot 选择器召出。
 *
 * ## ⚠️ handleClose 用 slot prop,不推导
 *
 * 「我在哪一栏」必须由框架经 `ViewComponentProps.slot` 告知。
 * 靠 `slotBinding.right === VIEW_ID` 反推在左右双开同一 view 时
 * 对两个实例都成立 —— 点左栏的 ✕ 会把右栏关掉
 * (note / eBook / web 各踩过一次,见记忆「别猜自己在哪一栏」)。
 */

import type { ReactElement } from 'react';
import type { ViewComponentProps } from '@slot/view-type-registry/view-definition';

import { useSyncExternalStore } from 'react';
import { XConsole } from './XConsole';
import { getXHostWcId, subscribeXHost } from './x-host-registry';

export function XWorkbenchView({ workspaceId }: ViewComponentProps): ReactElement {
  /**
   * ⭐ 取左栏 webview 的 wcId —— Console 调 `goto` 要用它指认页面。
   * ⚠️ 订阅而不是读一次:左栏可能**后于**右栏挂载,
   * 读一次会永远是 null(现象是「Console 上按钮一直灰着」)。
   */
  const wcId = useSyncExternalStore(
    subscribeXHost,
    () => getXHostWcId(workspaceId),
  );

  return <XConsole wcId={wcId} />;
}
