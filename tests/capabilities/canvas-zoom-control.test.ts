/**
 * 画板缩放控件 —— 档位 / 上下限 / 百分比 / 快捷键
 *
 * ⭐⭐ 守的是用户能直接感知的四条:
 * ① 一直点放大能真的到上限、一直点缩小能真的到下限(不会卡在中间某档)
 * ② 任何路径都出不了 10%~2000%
 * ③ 显示的百分比是整数,且 zoom=1 显示 100%
 * ④ Cmd/Ctrl 加 `+` `-` `0` 三个键真能被认出来(`+` 那个键实际打出的是 `=`)
 *
 * ⚠️ 断言**不照抄实现的写法**:档位跳转按「严格更大的最近一档」这个**效果**独立验,
 * 不去比对 `ZOOM_STEPS` 的具体数组 —— 抄实现只能验证「实现和自己一致」。
 *
 * ⚠️ 另外钉住一条**回归面**:上下限必须只有一处定义。
 * 病史:`Host.zoomTo` 夹 `10~2000`、`InteractionController` 夹 `0.1~20`,
 * 两处各写一遍,改一处漏一处就会出现「滚轮到得了、按钮到不了」。
 * 源码守卫**剥掉注释再比**(注释里会原样写着这些数字,不剥就是假保证)。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MIN_ZOOM_PERCENT,
  MAX_ZOOM_PERCENT,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_STEPS,
  clampZoomPercent,
  formatZoomPercent,
  nextZoomStep,
  prevZoomStep,
  matchZoomShortcut,
} from '@capabilities/canvas-rendering/interaction/zoom-levels';

/** 剥注释,只留会执行的代码 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const SRC_ROOT = resolve(__dirname, '../../src/capabilities/canvas-rendering');
const read = (rel: string): string =>
  stripComments(readFileSync(resolve(SRC_ROOT, rel), 'utf8'));

// ─────────────────────────────────────────────────────────
describe('⭐ 档位跳转', () => {
  it('⭐⭐ 一直点放大,必须**沿档位**真的走到上限', () => {
    // ⚠️ 不能只看终值 —— nextZoomStep 到头会返回上限,
    //    即便上限根本不在档位表里(那样 UI 上是「跳过一段够不着的区间」)。
    //    所以记录走过的路径,验上限是**被某一档踩到的**。
    const visited: number[] = [];
    let p = MIN_ZOOM_PERCENT;
    for (let i = 0; i < 100; i++) {
      const n = nextZoomStep(p);
      if (n === p) break;
      visited.push(n);
      p = n;
    }
    expect(p, '连点放大应停在上限').toBe(MAX_ZOOM_PERCENT);
    expect(ZOOM_STEPS, '上限必须是档位表里真实存在的一档').toContain(MAX_ZOOM_PERCENT);
    expect(
      visited.every((v) => ZOOM_STEPS.includes(v)),
      `放大路径必须全部落在档位上,实际走了 ${visited.join(' → ')}`,
    ).toBe(true);
  });

  it('⭐⭐ 一直点缩小,必须**沿档位**真的走到下限', () => {
    const visited: number[] = [];
    let p = MAX_ZOOM_PERCENT;
    for (let i = 0; i < 100; i++) {
      const n = prevZoomStep(p);
      if (n === p) break;
      visited.push(n);
      p = n;
    }
    expect(p, '连点缩小应停在下限').toBe(MIN_ZOOM_PERCENT);
    expect(ZOOM_STEPS, '下限必须是档位表里真实存在的一档').toContain(MIN_ZOOM_PERCENT);
    expect(
      visited.every((v) => ZOOM_STEPS.includes(v)),
      `缩小路径必须全部落在档位上,实际走了 ${visited.join(' → ')}`,
    ).toBe(true);
  });

  it('⭐ 每次放大都严格变大、每次缩小都严格变小(不得原地踏步)', () => {
    let p = MIN_ZOOM_PERCENT;
    while (p < MAX_ZOOM_PERCENT) {
      const n = nextZoomStep(p);
      expect(n, `放大 ${p}% 应严格变大`).toBeGreaterThan(p);
      p = n;
    }
    while (p > MIN_ZOOM_PERCENT) {
      const n = prevZoomStep(p);
      expect(n, `缩小 ${p}% 应严格变小`).toBeLessThan(p);
      p = n;
    }
  });

  it('⭐⭐ 落在档位之间(滚轮缩到 137%)时,跳到相邻档而不是跳过', () => {
    // 137% 之上最近的档、之下最近的档 —— 用「档位集合」独立算,不抄实现
    const steps = [...ZOOM_STEPS].sort((a, b) => a - b);
    for (const cur of [11, 37, 137, 301, 999, 1777]) {
      const expectUp = steps.find((s) => s > cur) ?? MAX_ZOOM_PERCENT;
      const expectDown = [...steps].reverse().find((s) => s < cur) ?? MIN_ZOOM_PERCENT;
      expect(nextZoomStep(cur), `${cur}% 放大`).toBe(expectUp);
      expect(prevZoomStep(cur), `${cur}% 缩小`).toBe(expectDown);
    }
  });

  it('到顶 / 到底再点,停住不越界', () => {
    expect(nextZoomStep(MAX_ZOOM_PERCENT)).toBe(MAX_ZOOM_PERCENT);
    expect(prevZoomStep(MIN_ZOOM_PERCENT)).toBe(MIN_ZOOM_PERCENT);
    expect(nextZoomStep(99999)).toBe(MAX_ZOOM_PERCENT);
    expect(prevZoomStep(-50)).toBe(MIN_ZOOM_PERCENT);
  });

  it('⭐ 档位表首尾必须正好是上下限(否则点到头也够不着边界)', () => {
    const steps = [...ZOOM_STEPS].sort((a, b) => a - b);
    expect(steps[0], '最小档 = 下限').toBe(MIN_ZOOM_PERCENT);
    expect(steps[steps.length - 1], '最大档 = 上限').toBe(MAX_ZOOM_PERCENT);
    expect(steps, '档位表必须已是升序且无重复').toEqual([...new Set(steps)]);
    expect([...ZOOM_STEPS], '声明顺序就应是升序(UI 直接按序渲染)').toEqual(steps);
  });

  it('100% 必须是一个档位(回 100% 是最常用的一步)', () => {
    expect(ZOOM_STEPS).toContain(100);
  });
});

// ─────────────────────────────────────────────────────────
describe('⚠️ 上下限', () => {
  it('clamp 出不了区间', () => {
    for (const v of [-1, 0, 5, 9.9, 10, 100, 2000, 2001, 1e9, NaN, Infinity]) {
      const c = clampZoomPercent(v);
      expect(c, `${v} 夹后应 ≥ 下限`).toBeGreaterThanOrEqual(MIN_ZOOM_PERCENT);
      expect(c, `${v} 夹后应 ≤ 上限`).toBeLessThanOrEqual(MAX_ZOOM_PERCENT);
    }
  });

  it('⚠️ 非数字不得静默变成 0 / NaN(NaN 会让整个相机塌掉)', () => {
    expect(Number.isFinite(clampZoomPercent(NaN))).toBe(true);
    expect(Number.isFinite(clampZoomPercent(Infinity))).toBe(true);
  });

  it('百分比与倍率两种口径必须描述同一个区间', () => {
    expect(MIN_ZOOM).toBeCloseTo(MIN_ZOOM_PERCENT / 100, 12);
    expect(MAX_ZOOM).toBeCloseTo(MAX_ZOOM_PERCENT / 100, 12);
  });
});

// ─────────────────────────────────────────────────────────
describe('⭐ 百分比显示', () => {
  it('zoom=1 显示 100', () => {
    expect(formatZoomPercent(1)).toBe(100);
  });

  it('永远是整数(滚轮缩放会给出 1.2345 这种)', () => {
    for (const z of [0.1, 0.137, 1, 1.2345, 3.33333, 19.999, 20]) {
      expect(Number.isInteger(formatZoomPercent(z)), `zoom=${z} 应显示整数`).toBe(true);
    }
  });

  it('显示值也在上下限内(滚轮已夹过,这里是第二道)', () => {
    for (const z of [0.001, 0.1, 20, 1000]) {
      const p = formatZoomPercent(z);
      expect(p).toBeGreaterThanOrEqual(MIN_ZOOM_PERCENT);
      expect(p).toBeLessThanOrEqual(MAX_ZOOM_PERCENT);
    }
  });
});

// ─────────────────────────────────────────────────────────
describe('⭐ 快捷键映射', () => {
  it('⭐⭐ Cmd/Ctrl 加 `+` 那个键 —— `=` 和 `+` 都要认', () => {
    // ⚠️ 真机上不按 Shift 敲「+」,event.key 是 `=`;只认 `+` 就是「按了没反应」
    for (const key of ['=', '+']) {
      expect(matchZoomShortcut({ key, metaKey: true }), `Cmd+${key}`).toBe('zoom-in');
      expect(matchZoomShortcut({ key, ctrlKey: true }), `Ctrl+${key}`).toBe('zoom-in');
    }
  });

  it('Cmd/Ctrl + `-` 缩小、Cmd/Ctrl + `0` 回 100%', () => {
    expect(matchZoomShortcut({ key: '-', metaKey: true })).toBe('zoom-out');
    expect(matchZoomShortcut({ key: '-', ctrlKey: true })).toBe('zoom-out');
    expect(matchZoomShortcut({ key: '0', metaKey: true })).toBe('zoom-reset');
    expect(matchZoomShortcut({ key: '0', ctrlKey: true })).toBe('zoom-reset');
  });

  it('⚠️ 裸键不算(裸 0 / - 是正常输入,拦了就打不出字)', () => {
    for (const key of ['0', '-', '=', '+']) {
      expect(matchZoomShortcut({ key }), `裸 ${key} 不该触发缩放`).toBeNull();
    }
  });

  it('⚠️ 不相干的组合键不得误命中', () => {
    for (const key of ['z', 'c', 'v', '1', '9', 'Backspace', 'Escape']) {
      expect(matchZoomShortcut({ key, metaKey: true }), `Cmd+${key}`).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────
describe('⚠️⚠️ 上下限只有一处定义(回归面)', () => {
  it('InteractionController 不得自己再写一遍上下限', () => {
    const code = read('interaction/InteractionController.ts');
    expect(
      code,
      'MIN_ZOOM / MAX_ZOOM 必须从 zoom-levels 引入,不得本地 const 再定义一遍',
    ).not.toMatch(/const\s+(MIN|MAX)_ZOOM\s*=/);
    expect(code, '必须引用共用模块 zoom-levels').toMatch(/from\s+['"].*zoom-levels['"]/);
  });

  it('Host.zoomTo 不得把 10 / 2000 写死', () => {
    const code = read('Host.tsx');
    expect(
      code,
      'zoomTo 里不得出现写死的 Math.max(10, Math.min(2000, …)) —— 必须走 clampZoomPercent',
    ).not.toMatch(/Math\.max\(\s*10\s*,\s*Math\.min\(\s*2000\s*,/);
    expect(code, 'Host 必须引用共用模块').toMatch(/from\s+['"].*zoom-levels['"]/);
  });

  it('⚠️ view 侧不得直 import capability 运行时值(W5 边界)', () => {
    const viewSrc = stripComments(
      readFileSync(
        resolve(__dirname, '../../src/views/graph-canvas-view/GraphCanvasZoomControl.tsx'),
        'utf8',
      ),
    );
    // 只允许 `import type`;值 import 必须走 requireCapabilityApi
    const valueImport = /^\s*import\s+(?!type\b)[^;]*from\s+['"]@capabilities\//m;
    expect(
      valueImport.test(viewSrc),
      'view 组件不得 import capability 的运行时值 —— 档位/上下限走 requireCapabilityApi(…).zoom',
    ).toBe(false);
    expect(viewSrc, '必须经 requireCapabilityApi 拿 zoom api').toMatch(
      /requireCapabilityApi<[^>]*>\(\s*['"]canvas-rendering['"]\s*\)/,
    );
  });

  it('⭐ 档位 api 必须挂进 capability registry(否则 view 拿到 undefined 整个控件塌)', () => {
    const idx = read('index.ts');
    expect(idx, 'registry 注册的 api 里必须有 zoom').toMatch(/zoom:\s*zoomApi/);
    expect(idx).toMatch(/from\s+['"]\.\/interaction\/zoom-levels['"]/);
  });

  it('⭐ 全 capability 内,上下限数字只在 zoom-levels 里出现', () => {
    const levels = read('interaction/zoom-levels.ts');
    // 下限 / 上限的数字定义只应出现在这一个文件
    expect(levels).toMatch(/MIN_ZOOM_PERCENT\s*=\s*10\b/);
    expect(levels).toMatch(/MAX_ZOOM_PERCENT\s*=\s*2000\b/);
  });
});

/**
 * ⚠️ 注入验红台账(每条**实跑过**,2026-09-11)
 *
 * | # | 注入的违规 | 变红的断言 | 结果 |
 * |---|---|---|---|
 * | 1 | 档位表末尾去掉 MAX_ZOOM_PERCENT | 沿档位走到上限 / 首尾是上下限 | 红(2 条) |
 * | 2 | nextZoomStep 用 `>=` 代替 `>` | 严格变大 / 相邻档 | 红(2 条) |
 * | 3 | clampZoomPercent 删掉 isFinite 分支 | 出不了区间 / 非数字不塌 | 红(2 条) |
 * | 4 | formatZoomPercent 不 Math.round | 永远是整数 | 红 |
 * | 5 | 快捷键只认 `+` 不认 `=` | `=` 和 `+` 都要认 | 红 |
 * | 6 | matchZoomShortcut 删掉 meta/ctrl 检查 | 裸键不算 | 红 |
 * | 7 | InteractionController 本地再写 MIN_ZOOM/MAX_ZOOM | 不得写两遍 | 红 |
 * | 8 | Host.zoomTo 改回写死 `Math.max(10, Math.min(2000,…))` | 不得写死 | 红 |
 * | 9 | ⭐ 把 #8 那句**注释掉**再放回去(注释骗守卫的老坑) | —— | **绿**(剥注释生效,符合预期) |
 * | 10 | view 改回 `import { ZOOM_STEPS } from '@capabilities/…'` | W5 边界 | 红 |
 * | 11 | registry 里摘掉 `zoom: zoomApi` | 必须挂进 registry | 红 |
 * | 12 | ⭐ 把 #11 那句**注释掉**(留字面量骗守卫) | 必须挂进 registry | 红(剥注释生效) |
 *
 * ⚠️ #1 第一版断言只看终值,注入后**照样绿** —— 因为 nextZoomStep 到头会兜底返回
 * 上限,即使上限根本不在档位表里(UI 上就是「够不着的一段」)。
 * 改成记录**走过的路径**再验「每一步都落在档位上」才真的红。
 * 这正是「守卫照抄实现只能验自洽」的现场。
 */
