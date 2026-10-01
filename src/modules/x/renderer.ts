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
 * 两个入口**各自独立**,共享的只有纯数据(如页面名常量)。
 */

import { registerView } from '@slot/view-type-registry/register-view';
import { XView } from './XView';

/** ⭐ view id —— 与 navSide tab、slot 绑定共用同一个常量,不各写一份 */
export const X_VIEW_ID = 'x-view';

registerView({
  id: X_VIEW_ID,
  /**
   * ⚠️ 暂不 install 任何 capability —— 本步零业务。
   * 真要用底座能力时走 IPC(`window.electronAPI.webDomRun`),
   * 不是 install 一个 capability。
   */
  install: [],
  component: XView,
  navSideTab: {
    label: 'X',
    icon: '𝕏',
    /** order 6 —— 实测 1/2/3/4/5/7/99 已被占用,6 是空位 */
    order: 6,
  },
});
