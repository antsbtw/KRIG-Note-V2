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
 * | ~~`x-workbench-view`~~ | — | — | 操作台,2026-10-26 已拆(见下方 ②) |
 *
 * ⭐ 两个独立 ⇒ 可以**只开一个**:只想浏览就不开面板,只看结果就不必开网页。
 * ⚠️ 面板走 `slotPickerEntry` 而非 `navSideTab`(与 `thought-view` 同款)——
 * navSide 那一栏留给「网页」,面板从 right slot 选择器召出。
 */

import { registerView } from '@slot/view-type-registry/register-view';
import { XWebView } from './XWebView';
import { XOpsView } from './XOpsView';
import { XTaskView } from './XTaskView';
import { registerXCommands } from './x-commands';
import { startXHostSync } from './x-host-sync';
import { registerXNoteContextMenu } from './x-note-context-menu';

/** ⭐ view id —— 与 slot 绑定共用同一组常量,不各写一份 */
export const X_WEB_VIEW_ID = 'x-web-view';
export const X_OPS_VIEW_ID = 'x-ops-view';
export const X_TASK_VIEW_ID = 'x-task-view';

/** ① 左栏:X 的网页 */
registerView({
  /**
   * ⭐ 命令注册(registry 收着,等本窗口 wsId 就绪后跑)。
   * ⚠️ 必须走这个字段而不是直接调 —— 命令注册要本窗口真 wsId,
   * 多窗口下用 snapshot.activeId 会注册到别人头上
   * (见 project-module-self-register-commands)。
   */
  commands: registerXCommands,
  id: X_WEB_VIEW_ID,
  /**
   * ⚠️ 暂不 install 任何 capability —— 本步零业务。
   * 接 webview 时才需要(参照 AI / Mail 的 `web-rendering`)。
   */
  install: ['web-rendering'],
  component: XWebView,
  navSideTab: {
    /**
     * ⚠️ label 是 **SlotPicker 里也要显示的那个名字** —— 2026-10-01 实测踩到:
     * 原来左栏叫「X」、右栏叫「X 操作台」,用户在 picker 里点了「X」,
     * 结果右栏开出**第二个网页 view**(两栏都是「𝕏 网页」)。
     * ⭐ 两项都以 X 开头、一眼分不出谁是谁 —— 名字没把用途说清楚。
     * → 改成「X 网页」,与右栏的「X 操作台」并列时一眼可辨。
     * 守卫钉住「两个 label 互不为前缀」。
     */
    label: 'X 网页',
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

/**
 * ② (已拆)X 操作台 x-workbench-view —— 2026-10-26 Module5-04 收尾:它在界面里直接驱动网页、在界面进程跑整套采集,
 * 绕过执行器;配方搬到「任务」,调试改走开发收件箱。存着这个绑定的 ws 由 SlotArea 自愈清掉。
 */

/**
 * ③ 运营 —— ⭐ X 的**业务平台**(2026-10-07)
 *
 * 用户原话:「这个view，是一个和x view是同级别的，也可以放大做到全屏，可以放在左边右边的。」
 * ⭐ 所以与 X 网页一样上 navSide(能开在左栏),也自动进 SlotPicker(能开在右栏);
 * 最常用的入口是 X 网页顶条上的「📊 运营」按钮(开/关右栏)。
 * ⚠️ 与操作台区分:操作台是测试后台、将来隐藏;业务功能只进运营。
 */
registerView({
  id: X_OPS_VIEW_ID,
  install: [],
  component: XOpsView,
  navSideTab: {
    label: '运营',
    icon: '📊',
    /** ⭐ 6.5 —— 紧挨 X 网页(6);1–7 与 99 已被占用 */
    order: 6.5,
    /**
     * ⚠️ 运营没有自己的 navSide 面板内容 —— 切过来收起 navSide,
     * 且禁止点已激活 tab 展开一栏空的(与 X 网页同款)。
     */
    navSideOnSwitch: 'collapse',
    navSideDisabled: true,
  },
});

/**
 * ④ 任务 —— 编排好的业务流程(2026-10-16),与运营同级
 * 用户:「操作台是后台,应该把编排好的流程放在主页面了。是否增加一个和运营同级的task(任务),这个任务就是蓝V互关」
 * ⭐ 同运营:上 navSide(能开左栏)+ 自动进 SlotPicker(能开右栏);X 网页顶条「📋 任务」开/关右栏。
 */
registerView({
  id: X_TASK_VIEW_ID,
  install: [],
  component: XTaskView,
  navSideTab: {
    label: '任务',
    icon: '📋',
    /** ⭐ 6.6 —— 紧挨运营(6.5) */
    order: 6.6,
    navSideOnSwitch: 'collapse',
    navSideDisabled: true,
  },
});

/**
 * ⭐⭐ X 网页登记同步给主进程 —— 后台采集 runner 在主进程,靠它才知道哪个 ws 开着 X 网页、谁在忙。
 * ⚠️ 登记表每进程一份;去掉这行 runner 恒「没开 X 网页」静默空转(2026-10-14 发现)。
 */
startXHostSync();

/** note 右键菜单里 X 的两项 —— X 自己挂,删 X 跟着走 */
registerXNoteContextMenu();
