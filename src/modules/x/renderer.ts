/**
 * X 模块 —— ⭐ **渲染进程侧入口**
 * (`renderer/index.tsx` 只有一行 `import '@modules/x/renderer'`)
 *
 * ── ⚠️ 为什么 X 有两个入口 ──
 *
 * X 是第一个**主进程与渲染进程都要有入口**的模块:
 * · main 侧(`./main`)把语义页面表 / 锚点表 push 给底座
 * · renderer 侧(本文件)注册 view 与 navSide tab
 *
 * 别的 view 只有 renderer 一个入口,所以它们看起来是「一行」。
 * ⭐ 判据随之精确化:**每个进程 ≤ 1 处,且必须是自注册行**。
 * 删 X 仍是「删一个目录 + 删两行」。
 *
 * ⚠️ **本文件绝不 import `./main`** —— 那会把主进程的东西
 * (`web-capability/wiring`、Electron)拖进渲染进程。
 * 两个入口**各自独立**,共享的只有纯数据。
 *
 * ── ⭐⭐ 两个 view,各自独立(用户 2026-10-01 拍板)──
 *
 * 「x 的访问页面在左边;x 模块的操作作为一个单独的 view 在 right slot,
 * 　随时可以关闭。**也就是说,两个都是独立的 view**。」
 *
 * | view | 位置 | 入口 | 为什么 |
 * |---|---|---|---|
 * | `x-web-view` | 左栏 | navSide tab 𝕏 | 人在用的(浏览/登录/右键提取),要全宽、长期开 |
 * | `x-workbench-view` | 右栏 | SlotPicker | 工具(采集/结果/拟回复),用完就关,不该占死一栏 |
 *
 * ⭐ 两个独立 ⇒ 可以**只开一个**:只想浏览就不开面板,只看结果就不必开网页。
 * ⚠️ 面板走 `slotPickerEntry` 而非 `navSideTab`(与 `thought-view` 同款)——
 * navSide 那一栏留给「网页」,面板从 right slot 选择器召出。
 */

import { registerView } from '@slot/view-type-registry/register-view';
import { XWebView } from './XWebView';
import { XWorkbenchView } from './XWorkbenchView';

/** ⭐ view id —— 与 slot 绑定共用同一组常量,不各写一份 */
export const X_WEB_VIEW_ID = 'x-web-view';
export const X_WORKBENCH_VIEW_ID = 'x-workbench-view';

/** ① 左栏:X 的网页 */
registerView({
  id: X_WEB_VIEW_ID,
  /**
   * ⚠️ 暂不 install 任何 capability —— 本步零业务。
   * 接 webview 时才需要(参照 AI / Mail 的 `web-rendering`)。
   */
  install: [],
  component: XWebView,
  navSideTab: {
    label: 'X',
    icon: '𝕏',
    /** order 6 —— 实测 1/2/3/4/5/7/99 已被占用,6 是空位 */
    order: 6,
    /**
     * ⚠️ webview 类 view 要全宽 —— 切过来收起 navSide,
     * 且禁止点已激活 tab 展开空面板(与 AI / Mail 同款)。
     * ⭐ 接 webview 后这两条才真正生效;现在先按终态写,免得将来忘。
     */
    navSideOnSwitch: 'collapse',
    navSideDisabled: true,
  },
});

/** ② 右栏:X 的操作面板 —— ⭐ 不占 navSide,从 SlotPicker 召出、随时可关 */
registerView({
  id: X_WORKBENCH_VIEW_ID,
  install: [],
  component: XWorkbenchView,
  slotPickerEntry: { label: 'X 操作台', icon: '🛠', order: 6 },
});
