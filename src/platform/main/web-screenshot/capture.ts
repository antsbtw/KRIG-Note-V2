/**
 * 网页正文截图 —— 按文档坐标截一块区域成**一张长图**(2026-11-05)
 *
 * ── 为什么是「滚一屏截一屏」──
 * 第一版用 CDP `Page.captureScreenshot` + `captureBeyondViewport` 一次截屏外区域:
 * **在 <webview> 里它不生效** —— 只拿到当前可见那块画面,再平铺填满要求的尺寸
 * (2026-11-05 真机:笔记里的长图「两份并排、上下重复」;离线 Electron 复现:独立窗口正常,webview 平铺)。
 * → 改用 `webContents.capturePage(视口内矩形)`:每次把页面滚到下一段,截视口里属于选区的部分,再竖着拼。
 *   capturePage 回的是实际像素(Retina 下 696×600 区域 → 1392×1200,位图长度对得上,已实测)。
 */

import { nativeImage, type WebContents } from 'electron';
import type { ShotSelection } from './select-script';

/** 整张最高(设备像素):再高图片太大,让用户缩小框 */
export const MAX_TOTAL_PX = 40_000;
/** 媒体库单张图上限 20MB;PNG 超过这个就转 JPEG */
const PNG_MAX_BYTES = 18 * 1024 * 1024;
/** 滚到位后再等一点,给懒加载/动画收尾 */
const SETTLE_MS = 100;
/** 等页面滚到位最多多久(平滑滚动的站点) */
const SCROLL_WAIT_MS = 1500;

export interface ShotImage {
  dataUrl: string;
  width: number;
  height: number;
  format: 'png' | 'jpeg';
}

/**
 * 纯函数:滚到 target 后,这一段截视口里的哪一块(CSS px,视口坐标)。
 * 页面滚到底时 actualScrollY < target → 偏移 = target - actualScrollY;这一段最多截到视口底。
 * 返 null = 视口里已经没有选区的内容了(不该发生,调用方报错而不是死循环)。
 */
export function tileRect(
  sel: Pick<ShotSelection, 'x' | 'width'>,
  target: number,
  remaining: number,
  scroll: { x: number; y: number },
  viewport: { w: number; h: number },
): { x: number; y: number; width: number; height: number } | null {
  // 滚动位置是整数/半像素,目标可能带小数(165.79 vs 166)→ 两像素内的负偏移当 0(真机复现)
  let offY = target - scroll.y;
  if (offY < 0 && offY > -2) offY = 0;
  const height = Math.min(remaining, viewport.h - offY);
  if (offY < 0 || height <= 0) return null;
  const x = Math.max(0, sel.x - scroll.x);
  const width = Math.min(sel.width, viewport.w - x);
  if (width <= 0) return null;
  return { x: Math.round(x), y: Math.round(offY), width: Math.round(width), height: Math.round(height) };
}

/** 纯函数:同宽(取最窄)的 BGRA 位图竖着拼起来 */
export function stackBitmaps(parts: ReadonlyArray<{ buf: Buffer; width: number; height: number }>): { buf: Buffer; width: number; height: number } {
  const width = Math.min(...parts.map((p) => p.width));
  const height = parts.reduce((n, p) => n + p.height, 0);
  const out = Buffer.alloc(width * height * 4);
  let row = 0;
  for (const p of parts) {
    for (let y = 0; y < p.height; y++) {
      p.buf.copy(out, (row + y) * width * 4, y * p.width * 4, y * p.width * 4 + width * 4);
    }
    row += p.height;
  }
  return { buf: out, width, height };
}

/**
 * 滚到 (x, y) 并等它**真的停住**,返实际位置(页面到底时 y 会比目标小)。
 * ⚠️ 2026-11-05 真机:bufanche 开着 `scroll-behavior: smooth`,scrollTo 变成慢慢滑,
 *    等两帧就量 → 还停在原处(「目标 166,实际滚到 6557」)。→ behavior:'instant' 强制跳到位,
 *    再轮询到「到达目标(或到底)且连续两帧不变」,最多 SCROLL_WAIT_MS。
 */
async function scrollTo(wc: WebContents, x: number, y: number): Promise<{ x: number; y: number }> {
  const js = `new Promise(function (r) {
    var X = ${JSON.stringify(x)}, Y = ${JSON.stringify(y)}, WAIT = ${JSON.stringify(SCROLL_WAIT_MS)}, SETTLE = ${JSON.stringify(SETTLE_MS)};
    var de = document.documentElement;
    window.scrollTo({ left: X, top: Y, behavior: 'instant' });
    var t0 = Date.now(), last = -1, same = 0;
    (function tick() {
      var maxY = Math.max(0, de.scrollHeight - window.innerHeight);
      var want = Math.min(Y, maxY);
      var y = window.scrollY;
      same = Math.abs(y - last) < 0.5 ? same + 1 : 0;
      last = y;
      if ((Math.abs(y - want) < 1 && same >= 2) || Date.now() - t0 > WAIT) {
        setTimeout(function () { r([window.scrollX, window.scrollY]); }, SETTLE);
        return;
      }
      requestAnimationFrame(tick);
    })();
  })`;
  const [ax, ay] = (await wc.executeJavaScript(js, true)) as [number, number];
  return { x: ax, y: ay };
}

export async function captureSelection(wc: WebContents, raw: ShotSelection): Promise<ShotImage> {
  // 选区取整到 CSS 像素(框选带小数,滚动位置是整数):起点向下取整、终点向上取整,不丢边
  const x0 = Math.floor(raw.x), y0 = Math.floor(raw.y);
  const sel: ShotSelection = { ...raw, x: x0, y: y0, width: Math.ceil(raw.x + raw.width) - x0, height: Math.ceil(raw.y + raw.height) - y0 };
  if (sel.height * (sel.dpr || 1) > MAX_TOTAL_PX) {
    throw new Error(`框选太长(约 ${Math.round(sel.height)}px),超出一张图的上限,请把框缩短一些分两次截`);
  }
  const [vw, vh, ox, oy] = (await wc.executeJavaScript(
    '[window.innerWidth, window.innerHeight, window.scrollX, window.scrollY]', true,
  )) as [number, number, number, number];
  // 横向:让选区左边进视口(选区比视口还宽时只截得到视口那么宽)
  const sx = Math.max(0, Math.min(sel.x, sel.x + sel.width - vw));
  const parts: Array<{ buf: Buffer; width: number; height: number }> = [];
  try {
    let done = 0;
    let guard = 0;
    while (done < sel.height - 0.5) {
      if (++guard > 400) throw new Error('截图段数异常(页面一直滚不到位)');
      const target = sel.y + done;
      const scroll = await scrollTo(wc, sx, target);
      const rect = tileRect(sel, target, sel.height - done, scroll, { w: vw, h: vh });
      if (!rect) throw new Error(`第 ${parts.length + 1} 段算不出截图位置(目标 ${Math.round(target)},实际滚到 ${Math.round(scroll.y)})`);
      const img = await wc.capturePage(rect);
      const size = img.getSize();
      if (!size.width || !size.height) throw new Error('截到的图片是空的');
      parts.push({ buf: img.toBitmap(), width: size.width, height: size.height });
      done += rect.height;
    }
  } finally {
    await scrollTo(wc, ox, oy).catch(() => { /* 页面已走 */ });
  }
  const stacked = stackBitmaps(parts);
  const full = nativeImage.createFromBitmap(stacked.buf, { width: stacked.width, height: stacked.height });
  const png = full.toPNG();
  if (png.length <= PNG_MAX_BYTES) {
    return { dataUrl: `data:image/png;base64,${png.toString('base64')}`, width: stacked.width, height: stacked.height, format: 'png' };
  }
  const jpg = full.toJPEG(88);
  return { dataUrl: `data:image/jpeg;base64,${jpg.toString('base64')}`, width: stacked.width, height: stacked.height, format: 'jpeg' };
}
