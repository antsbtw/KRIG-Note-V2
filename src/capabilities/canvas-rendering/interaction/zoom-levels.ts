/**
 * zoom-levels — 画板缩放的**单一真源**(上下限 + 档位 + 快捷键映射)
 *
 * ⭐ 为什么单独一个文件:上下限此前写了两遍 —— `Host.zoomTo` 内夹 `10~2000`,
 * `InteractionController` 的滚轮夹 `MIN_ZOOM=0.1 / MAX_ZOOM=20`。口径碰巧一致,
 * 但改一处漏一处就会出现「滚轮能到的比按钮能到的远」这种说不清的错位。
 * 本文件是**纯逻辑、零依赖**(不 import three / react),故可被 Host / 控制器 /
 * toolbar 三方共同引用,也能被离线断言直接跑。
 *
 * ⚠️ 档位是**跳档**不是线性加减:`+10%` 在低倍下太慢、高倍下太粗。
 */

/** 缩放下限(百分比)—— 与上限一起,是全仓唯一定义处 */
export const MIN_ZOOM_PERCENT = 10;
/** 缩放上限(百分比) */
export const MAX_ZOOM_PERCENT = 2000;

/** 同一上下限的 zoom 倍率表达(scene / 滚轮用的是倍率不是百分比) */
export const MIN_ZOOM = MIN_ZOOM_PERCENT / 100;
export const MAX_ZOOM = MAX_ZOOM_PERCENT / 100;

/**
 * 下拉菜单 / 按钮跳档用的档位表(百分比,升序)。
 * ⚠️ 首尾必须正好等于上下限 —— 否则「一直点放大」会停在够不着上限的地方。
 */
export const ZOOM_STEPS: readonly number[] = [
  MIN_ZOOM_PERCENT, 25, 50, 75, 100, 150, 200, 400, 800, 1600, MAX_ZOOM_PERCENT,
];

/** 夹到合法区间(百分比) */
export function clampZoomPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 100;
  return Math.max(MIN_ZOOM_PERCENT, Math.min(MAX_ZOOM_PERCENT, percent));
}

/** 显示用:zoom 倍率 → 取整百分比(1 → 100) */
export function formatZoomPercent(zoom: number): number {
  return Math.round(clampZoomPercent(zoom * 100));
}

/**
 * 下一档(放大)。已在上限或超过上限 → 返回上限(不动)。
 * ⚠️ 当前值落在档位之间(滚轮缩到 137%)时,跳到**严格大于它**的最近一档。
 */
export function nextZoomStep(percent: number): number {
  const cur = clampZoomPercent(percent);
  for (const step of ZOOM_STEPS) {
    if (step > cur + 1e-9) return step;
  }
  return MAX_ZOOM_PERCENT;
}

/** 上一档(缩小)。已在下限 → 返回下限。 */
export function prevZoomStep(percent: number): number {
  const cur = clampZoomPercent(percent);
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    const step = ZOOM_STEPS[i]!;
    if (step < cur - 1e-9) return step;
  }
  return MIN_ZOOM_PERCENT;
}

/** 快捷键语义 —— 控制器与断言共用同一张表,避免「测的和接的不是一回事」 */
export type { CanvasZoomShortcut as ZoomShortcut } from '../types';
import type { CanvasZoomApi, CanvasZoomShortcut as ZoomShortcut } from '../types';

/**
 * Cmd/Ctrl + `+` / `-` / `0` → 缩放意图;不匹配给 null。
 *
 * ⚠️ `+` 在多数键盘上不按 Shift 打出来的是 `=`,`-` 在小键盘上 key 是 `-`
 * 但部分布局下 Shift+`=` 才是 `+` —— 三个都收,否则「按了没反应」。
 * ⚠️ 只认带 meta/ctrl 的组合:裸 `-` / `0` 是正常输入。
 */
export function matchZoomShortcut(e: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
}): ZoomShortcut | null {
  if (!(e.metaKey || e.ctrlKey)) return null;
  switch (e.key) {
    case '+':
    case '=':
      return 'zoom-in';
    case '-':
    case '_':
      return 'zoom-out';
    case '0':
      return 'zoom-reset';
    default:
      return null;
  }
}

/**
 * 对外 api 形态(挂在 CanvasRenderingApi.zoom).
 * ⭐ view 侧走 `requireCapabilityApi('canvas-rendering').zoom` 拿,
 * 不直 import 本文件(W5 边界:view 不 import capability 运行时值).
 */
export const zoomApi: CanvasZoomApi = {
  MIN_PERCENT: MIN_ZOOM_PERCENT,
  MAX_PERCENT: MAX_ZOOM_PERCENT,
  STEPS: ZOOM_STEPS,
  clamp: clampZoomPercent,
  format: formatZoomPercent,
  next: nextZoomStep,
  prev: prevZoomStep,
};
