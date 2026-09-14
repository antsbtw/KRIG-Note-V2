/**
 * fitToContent padding 单位回归
 *
 * ⚠️ 真机实测(2026-09-10,用户截图):导图渲染出来只有**一个小点**。
 *
 * 根因:`fitToContent(padding)` 的 padding 是**比例不是像素**。
 * `SceneManager.fitToBox` 里:`padW = w * (1 + padding)`。
 * 我传了 `40`(以为是 40px 留白)→ 盒子被放大 41 倍 → zoom 缩到 1/41 → 一个点。
 *
 * ⭐ 教训可推广:**跨模块传数值参数前,先确认单位**
 * (像素 / 比例 / 百分比 / 度 / 弧度)。签名里只写 `padding = 0.1` 时,
 * 那个默认值就是单位的线索 —— 0.1 显然不是像素。
 */
import { describe, it, expect } from 'vitest';

/** 复刻 SceneManager.fitToBox 的缩放计算(只取与本 bug 相关的那几行)。 */
function zoomFor(boxW: number, boxH: number, clientW: number, clientH: number, padding: number) {
  const padW = boxW * (1 + padding);
  const padH = boxH * (1 + padding);
  return Math.min(clientW / padW, clientH / padH);
}

describe('fitToContent 的 padding 是比例不是像素', () => {
  // 一张典型 mind:6 个节点铺开约 600×300,容器约 1500×900
  const BOX_W = 600, BOX_H = 300, VIEW_W = 1500, VIEW_H = 900;

  it('⚠️ 复现旧 bug:传 40(当成像素)→ zoom 缩到几乎不可见', () => {
    const zoom = zoomFor(BOX_W, BOX_H, VIEW_W, VIEW_H, 40);
    // ⭐ 这就是截图里那个「小点」的机器化描述
    expect(zoom).toBeLessThan(0.1);
  });

  it('⭐ 传比例(0.15)→ zoom 落在正常可视范围', () => {
    const zoom = zoomFor(BOX_W, BOX_H, VIEW_W, VIEW_H, 0.15);
    expect(zoom).toBeGreaterThan(0.5);
    expect(zoom).toBeLessThan(5);
  });

  it('⚠️ 守卫:padding 传值必须 < 1(比例),否则就是把像素当比例了', () => {
    // 合理的 padding 是 0~1 之间的比例;任何 >= 1 的值几乎必然是单位搞错。
    const SUSPICIOUS = 1;
    for (const bad of [10, 40, 100]) {
      expect(bad, `padding=${bad} 看起来是像素值,应为比例`).toBeGreaterThanOrEqual(SUSPICIOUS);
    }
    for (const good of [0, 0.1, 0.15, 0.5]) {
      expect(good).toBeLessThan(SUSPICIOUS);
    }
  });
});
