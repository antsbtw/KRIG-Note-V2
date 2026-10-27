/**
 * X 模块 —— ⭐ **主进程侧入口**(`main/index.ts` 只有一行 `import '@modules/x/main'`)
 *
 * ── 用户 2026-09-30 拍板的第一性约束 ──
 *
 * 「x 模块是一个完全独立的模块,可以很简单的卸载和安装。
 * 　底层 web 的控制、输入、输出部分函数共用。
 * 　只有属于 x 的特殊部分函数才为它特有。」
 *
 * ── ⚠️ 为什么是「每进程一行」而不是「全仓一行」(2026-10-01 用户拍板)──
 *
 * X 是第一个**主进程与渲染进程都要有入口**的模块:
 * 语义页面表/锚点表要给 main 侧的底座,而 view 注册只能在 renderer 跑。
 * (别的 view 只有 renderer 一个入口,所以它们看起来是「一行」。)
 *
 * ⭐ 判据随之精确化:**每个进程 ≤ 1 处,且必须是自注册行**。
 * 删 X 仍是「删一个目录 + 删两行」—— 原则未破,只是说清了它在两个进程里各有一行。
 * ⚠️ 否决了「让 main 通过 IPC 通知 renderer 注册 view」:
 * 宿主确实只剩一行,但多一层间接、且与其它 view 的做法不一致,
 * 代价是多一条调试路径。
 *
 * ⭐ 原判据:**删掉 X = 删一个目录 + 删注册行**,
 * 然后 tsc 0 错 / 测试绿 / vite 起得来 / app 里没有残影。
 * 守卫:`tests/modules/x-module-detachable.test.ts`。
 *
 * ── 依赖方向 ──
 *
 * ```
 *   src/modules/x/           ← 只往下用,**不被任何人 import**
 *        │ push(注册表模式)
 *        ↓
 *   web-capability           ← 底座不认识 X
 * ```
 *
 * ⚠️ 这里**只做接线**。本步(2026-10-01)零业务代码:
 * 没有采集、没有库表、没有视图 —— 只证明「注册表模式走得通」。
 * 判据:能力控制台能跑 `goto x.home → ready → scrollUntil`。
 */

import { app } from 'electron';
import {
  registerAnchorTable,
  registerPageTable,
  scriptRegistry,
} from '@platform/main/web-capability/wiring/runtime';
import { xPageResolver } from './x-pages';
import { xAnchorResolver } from './x-anchors';
import { X_DOM_SCRIPTS } from './x-dom-scripts';
import { registerXDataIpc } from './x-data-ipc';
import { bgRunnerHealth, startBgRunner, stopBgRunner } from './x-bg-runner';
import { startDevInbox, stopDevInbox } from './x-dev-inbox';
import { startDailyUpkeep, stopDailyUpkeep } from './x-daily-upkeep';
import { registerSpotCheckMenu } from './x-spot-check';
import { startFollowQueue, stopFollowQueue } from './x-follow-queue';
import { registerHealthProbe } from '@platform/main/diagnostics/health/health-monitor';
import { listLocks } from '@platform/main/flow/resource-lock';
import { registerXCapabilities } from './x-capabilities';
import { stopPostDraftTimers } from './x-post-draft';

/** ⭐ owner 名 —— 底座按 owner 分派,两张表用同一个名字 */
const OWNER = 'x';

/**
 * 把 X 的两张表推给底座。
 *
 * ⚠️ **幂等** —— 多窗口/热重载下可能被调多次,
 * 底座的 register 是同名覆盖,但这里也挡一道,免得日志刷屏。
 */
let registered = false;

export function registerXModule(): void {
  if (registered) return;
  registered = true;
  registerPageTable(OWNER, xPageResolver);
  registerAnchorTable(OWNER, xAnchorResolver);
  /**
   * ⭐⭐ 注册 X 的 DOM 补全脚本(「Show more」展开)。
   *
   * ⚠️ 走 `scriptRegistry` 而不是让调用方拼脚本 ——
   * `project-x-inject-template-escape`:拼串时 `\/` 被模板字面量吃掉 →
   * 浏览器收到非法正则 → **采集恒 0,而 tsc 与单测全绿**。
   *
   * ⚠️ 底座在 `runtime.ts` 里写死注册了三组自己的脚本,
   * 业务的脚本**由业务 push** —— 底座不认识 X,这条不能破。
   */
  for (const sc of X_DOM_SCRIPTS) scriptRegistry.register(sc);

  /**
   * ⭐⭐ 配方 CRUD 的 IPC —— **X 自带**(通道名也在 X 这边)。
   *
   * ⚠️ 不挂到 `web-dom.invoke` 上:那是 web 能力层的通道,
   * 而配方是库里的业务数据 —— 挂上去就要在能力层 import 业务 repo,
   * 撞「能力层不许 import 业务层」那道守卫。
   * ⚠️ 也不进 `channel-names.ts`:删 X 时会留下孤儿
   * (守卫 `x-module-detachable` 的改法原话:「X 自带视图/IPC/repo/schema」)。
   */
  registerXDataIpc();

  /**
   * ⭐⭐ 后台采集节奏控制器(「他的朋友圈」第二步,3b)。
   *
   * ⚠️ **X 自己启动、X 自己在 before-quit 停** —— 不劳宿主。
   * 宿主 index.ts 一行不加:startBgRunner 写进 index.ts 会让宿主认识 X 内部,
   * 删 X 时成孤儿、撞 x-module-detachable 守卫(拦「宿主→X」)。
   * ⭐ X 依赖 electron(app.on)是正当的(x-data-ipc 已 import ipcMain 同理),
   * 这是「X 依赖平台」不是「宿主依赖 X」。
   * ⚠️ 常驻 timer 必须在 before-quit 停(记忆 project-graceful-shutdown):
   * 这里挂自己的 before-quit 监听(Electron 允许多个),timer 本身也 unref()。
   * ⚠️ 幂等(registered 挡在前面):多窗口/热重载不会挂两个监听、起两个 timer。
   */
  startBgRunner();
  app.on('before-quit', stopBgRunner);
  /** ⭐ 开发测试收件箱(只在未打包时启用;2026-10-16 用户授权我自己跑测试)—— 同样自启、before-quit 自停 */
  startDevInbox();
  app.on('before-quit', stopDevInbox);
  /** ⭐ 每天自动:查回关(用户 10-19 选)+ 我自己的关系采集(10-21)—— 自启、before-quit 自停,timer unref */
  startDailyUpkeep();
  app.on('before-quit', stopDailyUpkeep);
  /** ⭐ 右键「查库」抽查(2026-10-16)—— 经平台的网页右键扩展口,删 X 目录这一项就没了 */
  registerSpotCheckMenu();
  /** ⭐ 关注队列(2026-10-16,蓝V互关 M4)—— 自启、before-quit 自停,timer unref */
  startFollowQueue();
  app.on('before-quit', stopFollowQueue);
  /** ⭐ 发推待发草稿的「10 分钟没确认自动撤回」定时器(发推第②期,2026-10-27)—— before-quit 停 */
  app.on('before-quit', stopPostDraftTimers);
  /** ⭐ 后台采集状态进运行体检(黑匣子)—— X 自己登记,宿主不认识 X 内部 */
  registerHealthProbe('x.bg', bgRunnerHealth);
  /** ⭐⭐ X 的能力登记进平台能力目录(Module5-04 第 2 步)—— 删 X 目录这一行就没了 */
  registerXCapabilities();
  /** ⭐ 此刻谁占着哪个 X 网页(x-page-lock)—— 卡住复盘时看「是不是有人占着不放」 */
  registerHealthProbe('x.page-lock', () => ({
    held: listLocks().map((h) => ({ resource: h.resource, purpose: h.purpose, caller: h.caller, sinceSec: Math.round((Date.now() - h.since) / 1000) })),
  }));
}


/**
 * ⭐ 模块被 import 即自注册 —— 主程序那一行 `import '@modules/x'` 就够了。
 *
 * ⚠️⚠️ **日志刻意不在这里打** —— 2026-10-01 实测踩到:
 *
 * 模块加载期(`import` 求值时)比 `app.whenReady()` **早得多**,
 * 那一行会被埋在启动最开头、`[storage] initialized` **之前** ——
 * 用户贴日志时自然从 storage 连接开始截,于是「看不到」。
 * ⭐ 而 `[web.dom ipc] 已就绪` 看得到,正因为它在 `whenReady` 里打。
 *
 * ⭐⭐ 这是 feedback-log-where-the-human-looks 的**第二种形态**:
 * 上次是「打错了进程」,这次是「**打早了时机**」——
 * 判据同一条:**这行会出现在人看的那块屏幕上吗?**
 * 位置对了还不够,**时机也要对**。
 *
 * → 注册照旧在模块加载期(越早越好,免得有人先 goto 再注册);
 *   **报告由底座在 `whenReady` 里统一打** —— 它本来就知道哪些 owner 注册了表,
 *   ⭐ 这样 X 不必为了「被看见」而让宿主多调一个函数
 *   (那会破坏「宿主只有一行 import」的原则,守卫当场会红 —— 实测过)。
 */
registerXModule();
