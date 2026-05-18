/**
 * host/mafs-style — Mafs 样式入口
 *
 * 全 V2 中**唯一** import `mafs/core.css` 的位置。其他 view / driver / capability
 * 0 import,样式通过本 capability 一次性引入(MathHost 的副作用 import)。
 *
 * Phase 1A:仅 import core.css,不做主题覆盖。后续需要 light/dark 主题切换时,
 * 在本文件加 CSS-in-JS 覆盖或额外 import。
 */

import 'mafs/core.css';

// 占位:让 TS 把本文件当模块编译(避免 isolatedModules 报错)
export const __MAFS_STYLE_LOADED__ = true;
