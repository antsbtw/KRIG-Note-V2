/**
 * ⭐⭐ **把 X 的两张表推给底座** —— 依赖方向:业务 → 底座,**绝不反过来**。
 *
 * ── 为什么单独一个文件(2026-09-29 重建时抽出)──
 *
 * 这两行原本埋在 `x-timeline-handlers`(**1516 行、48 个 IPC**)的开头。
 * 于是「注册锚点表」这件小事被焊在整个业务 handler 上 ——
 * 推倒重建时不恢复那个 handler,控制台就报
 * 「语义页面表还没读到」「锚点表还没读到」,而真正缺的只是这两行。
 *
 * ⭐ **接线不该跟业务逻辑住在一起**。这是本次「底层混杂」的又一个样本。
 *
 * ── 没有这两行会怎样 ──
 *
 * ⚠️ `web.input` 的 tap/type、`web.page` 的 anchor 类判据全都解释不出 selector,
 * 表现为「未找到可点的 X」—— 与「元素真不在页面上」**长得一模一样**,
 * 排查方向完全相反。
 *
 * ⚠️ 底座**不 import X**(那是分层倒置),它只提供 register* 这两个入口。
 */

import { registerAnchorTable, registerPageTable } from '../web-capability/wiring/runtime';
import { XAnchorResolver } from './x-anchors';
import { XPageResolver } from './x-pages';

/** 在 app 启动时调一次。幂等 —— 同名覆盖。 */
export function registerXTables(): void {
  /** ⭐ 锚点表 —— `tap`/`type` 靠它把 `nav.profile` 翻成 selector */
  registerAnchorTable('x', new XAnchorResolver());
  /** ⭐ 语义页面表 —— `goto` 靠它把 `x.home` 翻成 URL */
  registerPageTable('x', new XPageResolver());
}
