/**
 * ⭐⭐⭐ 站点说明书引擎(设计 `04-site-manual-self-repair.md`,P2 2026-10-19)
 *
 * 站点知识 = 数据(说明书),不是代码;引擎照说明书清点 / 判方向。
 * ⚠️ 纯函数,不碰 Electron / Node —— renderer(操作台)与 main(人卡 / 后台)都直接用。
 */
export * from './types';
export { census } from './census';
export { checkManual, loadManual } from './check';
export { orderedByTime, directionWrong } from './order';
export * from './changelog';
