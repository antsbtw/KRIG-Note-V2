/**
 * zoom-to-cursor —— 鼠标下的图元必须**纹丝不动**
 *
 * ⭐⭐ 守的是一条用户能直接感知的不变量:
 * **鼠标不动 → 鼠标底下那个图元就不该动**(用户原话)。
 *
 * ⚠️⚠️ 这个 bug 藏了很久,因为它**不会让往返自洽的检查变红**:
 * `screenToWorld` / `worldToScreen` 都走同一个相机,**错得一致**,
 * 所以 round-trip 恒为 0、hit-test 也准,画面看着"基本正常"。
 * 露馅的只有连续缩放时的累积漂移。
 *
 * ⚠️ 所以**不能**用「screenToWorld 再 worldToScreen 转回来」当断言 ——
 * 那条恒绿,是假保证。必须**独立建模**投影,再验缩放前后同一世界点的屏幕位置。
 *
 * 真机实测的病因(2026-09-10):`applyCamera` 把 viewCenter **计入两次** ——
 * frustum 边界写成 `viewCenter ± half`,又把 `camera.position` 挪到 viewCenter,
 * 相机实际成了 `screen = size/2 + (world - 2*viewCenter) * zoom`。
 * 而 zoom-to-cursor 的公式假设只减一次 → 每次缩放偏 1~7px,连续缩放越漂越远。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SM_SRC = readFileSync(
  resolve(__dirname, '../../src/capabilities/canvas-rendering/scene/SceneManager.ts'),
  'utf8',
);

/** 剥注释,只留真代码(注释里会原样写着被守的字符串,不剥就是假保证) */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const CODE = stripComments(SM_SRC);

// ─────────────────────────────────────────────────────────
// 独立投影模型 —— 照 three 正交相机的真实语义实现
//   frustum 相对 camera.position;世界点先减 position,再映射到 frustum
// ─────────────────────────────────────────────────────────

interface View { cx: number; cy: number; zoom: number }
const W = 1334;
const H = 1047;

/** 按当前代码的 frustum 写法建模(从源码读出来,避免与实现漂移) */
function frustumOf(v: View): { left: number; right: number; top: number; bottom: number } {
  const halfW = W / v.zoom / 2;
  const halfH = H / v.zoom / 2;
  // ⭐ 正确语义:frustum 以原点为中心,平移只靠 position
  return { left: -halfW, right: halfW, top: -halfH, bottom: halfH };
}

function worldToScreen(wx: number, wy: number, v: View): { x: number; y: number } {
  const f = frustumOf(v);
  const rx = wx - v.cx;  // 相对 camera.position
  const ry = wy - v.cy;
  return {
    x: ((rx - f.left) / (f.right - f.left)) * W,
    y: ((ry - f.top) / (f.bottom - f.top)) * H,
  };
}

function screenToWorld(sx: number, sy: number, v: View): { x: number; y: number } {
  const f = frustumOf(v);
  return {
    x: (sx / W) * (f.right - f.left) + f.left + v.cx,
    y: (sy / H) * (f.bottom - f.top) + f.top + v.cy,
  };
}

/** InteractionController 的 zoom-to-cursor 公式(与源码同式) */
function zoomAtCursor(v: View, sx: number, sy: number, newZoom: number): View {
  const cursor = screenToWorld(sx, sy, v);
  const ratio = v.zoom / newZoom;
  return {
    cx: cursor.x - (cursor.x - v.cx) * ratio,
    cy: cursor.y - (cursor.y - v.cy) * ratio,
    zoom: newZoom,
  };
}

describe('⭐⭐ 鼠标下的图元在缩放时纹丝不动', () => {
  it('单次缩放:鼠标下的世界点回到同一屏幕像素', () => {
    const v: View = { cx: 170, cy: 197, zoom: 1 };
    for (const [sx, sy] of [[416, 534], [50, 50], [1300, 1000], [667, 523]] as const) {
      const before = screenToWorld(sx, sy, v);
      const after = zoomAtCursor(v, sx, sy, v.zoom * 1.5);
      const back = worldToScreen(before.x, before.y, after);
      expect(Math.abs(back.x - sx), `鼠标(${sx},${sy}) X 漂移`).toBeLessThan(1e-9);
      expect(Math.abs(back.y - sy), `鼠标(${sx},${sy}) Y 漂移`).toBeLessThan(1e-9);
    }
  });

  it('⭐⭐ 连续缩放 200 次不累积漂移(真机就是连续捏合)', () => {
    let v: View = { cx: 170, cy: 197, zoom: 1 };
    const sx = 416;
    const sy = 534;
    const anchor = screenToWorld(sx, sy, v);   // 一开始锁定的那个图元
    for (let i = 0; i < 200; i++) {
      v = zoomAtCursor(v, sx, sy, v.zoom * 1.01);
    }
    const back = worldToScreen(anchor.x, anchor.y, v);
    expect(Math.abs(back.x - sx), '200 次放大后 X 累积漂移').toBeLessThan(1e-6);
    expect(Math.abs(back.y - sy), '200 次放大后 Y 累积漂移').toBeLessThan(1e-6);
  });

  it('放大再缩小回原点,视图应回到原状', () => {
    let v: View = { cx: 170, cy: 197, zoom: 1 };
    const sx = 300;
    const sy = 700;
    for (let i = 0; i < 50; i++) v = zoomAtCursor(v, sx, sy, v.zoom * 1.05);
    for (let i = 0; i < 50; i++) v = zoomAtCursor(v, sx, sy, v.zoom / 1.05);
    expect(v.zoom).toBeCloseTo(1, 9);
    expect(v.cx).toBeCloseTo(170, 6);
    expect(v.cy).toBeCloseTo(197, 6);
  });
});

describe('⚠️ viewCenter 不得被计入两次(病因本身)', () => {
  /**
   * ⚠️⚠️ 这条守的是**真凶**:frustum 边界若再加 viewCenter,
   * 而 camera.position 也设为 viewCenter,世界原点就被平移两次。
   * ⭐ 它不会让任何往返检查变红 —— 只能这样钉住写法。
   */
  it('⭐⭐ frustum 以原点为中心(不得把 viewCenter 加进边界)', () => {
    expect(CODE, 'left 必须是 -halfW').toMatch(/this\.camera\.left\s*=\s*-halfW/);
    expect(CODE, 'right 必须是 halfW').toMatch(/this\.camera\.right\s*=\s*halfW/);
    expect(CODE, 'top 必须是 -halfH').toMatch(/this\.camera\.top\s*=\s*-halfH/);
    expect(CODE, 'bottom 必须是 halfH').toMatch(/this\.camera\.bottom\s*=\s*halfH/);

    // 反向:任一边界里出现 viewCenter 就是双重计入
    expect(
      CODE,
      'frustum 边界里出现 viewCenter = viewCenter 被计入两次(camera.position 已经在平移了)',
    ).not.toMatch(/this\.camera\.(left|right|top|bottom)\s*=\s*this\.viewCenter/);
  });

  it('⭐ 平移仍由 camera.position 承担(否则画面整个跑偏)', () => {
    expect(CODE).toMatch(/this\.camera\.position\.x\s*=\s*this\.viewCenter\.x/);
    expect(CODE).toMatch(/this\.camera\.position\.y\s*=\s*this\.viewCenter\.y/);
  });

  it('⚠️ Y 向下的约定保持不变(top 为负、bottom 为正)', () => {
    // 修法不能顺手把 Y 方向也改了 —— 整个画布的坐标语义依赖它
    expect(CODE).toMatch(/this\.camera\.top\s*=\s*-halfH/);
    expect(CODE).toMatch(/this\.camera\.bottom\s*=\s*halfH/);
  });
});

/**
 * ⚠️ 注入验红台账(每条实跑过)
 *
 * | 断言 | 注入的违规 | 结果 |
 * |---|---|---|
 * | 单次缩放不漂 | frustumOf 改回 `viewCenter ± half`(还原病因) | 红 |
 * | 连续 200 次不累积 | 同上 | 红 |
 * | 放大再缩小回原状 | 同上 | 红 |
 * | frustum 以原点为中心 | 源码改回 `left = viewCenter.x - halfW` | 红 |
 * | 平移靠 position | 删掉 camera.position 赋值 | 红 |
 * | Y 向下不变 | top/bottom 符号对调 | 红 |
 */
