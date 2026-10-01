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
  console.log(
    `[modules/x] 已注册 —— 语义页面 ${xPageResolver.names?.().length ?? 0} 个: `
    + `${xPageResolver.names?.().join(', ')};锚点 ${xAnchorResolver.names().length} 个`,
  );
}

// ⭐ 模块被 import 即自注册 —— 主程序那一行 `import '@modules/x'` 就够了
registerXModule();
