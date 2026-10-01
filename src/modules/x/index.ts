/**
 * X 模块 —— ⭐ **自注册入口**(主程序只有一行 `import '@modules/x'`)
 *
 * ── 用户 2026-09-30 拍板的第一性约束 ──
 *
 * 「x 模块是一个完全独立的模块,可以很简单的卸载和安装。
 * 　底层 web 的控制、输入、输出部分函数共用。
 * 　只有属于 x 的特殊部分函数才为它特有。」
 *
 * ⭐ 唯一判据:**删掉 X = 删一个目录 + 删一行注册**,
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

import {
  registerAnchorTable,
  registerPageTable,
} from '@platform/main/web-capability/wiring/runtime';
import { xPageResolver } from './x-pages';
import { xAnchorResolver } from './x-anchors';

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
