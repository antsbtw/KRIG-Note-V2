/**
 * 连接点操作点(magnet actions)—— 纯逻辑层断言
 *
 * ⭐⭐ 守的是三件事:
 *  1. **声明才画** —— 没声明 action 的 magnet 依旧只是吸附目标,不能变成可点的圆
 *  2. **命中按屏幕像素** —— 圆是像素恒定画的,判定就必须是像素恒定的
 *     (按固定世界距离判 → 放大后点得中看不见的地方、缩小后点不中画出来的圆)
 *  3. **拖出落点分流** —— 落在 magnet 上给 target,落空白给 world 坐标
 *
 * ⚠️ 每条都注入验红,台账见文件末尾。
 *
 * ⚠️ 这里测不了 three(vitest 是 node 环境,无 DOM/WebGL)——
 * 这正是几何/命中/落点逻辑抽进 `interaction/magnet-actions.ts` 的原因:
 * overlay 那层只剩画 mesh,不含可测判定。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  resolveMagnetActions,
  hitTestMagnetAction,
  magnetActionHitRadiusWorld,
  radiusFor,
  labelFor,
  resolveMagnetDragOut,
  MAGNET_ACTION_RADIUS_PX,
  MAGNET_ACTION_HIT_SLOP_PX,
  type ResolvedMagnetAction,
} from '@capabilities/canvas-rendering/interaction/magnet-actions';
import type { WorldMagnet } from '@capabilities/canvas-rendering/interaction/magnet-snap';

/** 一个 4 磁点图元(rect 的 N/E/S/W),bbox 100×60 @ (0,0) */
function magnets(instanceId = 'n1'): WorldMagnet[] {
  return [
    { instanceId, magnetId: 'N', x: 50, y: 0 },
    { instanceId, magnetId: 'E', x: 100, y: 30 },
    { instanceId, magnetId: 'S', x: 50, y: 60 },
    { instanceId, magnetId: 'W', x: 0, y: 30 },
  ];
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('① 声明才画', () => {
  it('⭐⭐ 没声明 magnetActions → 一个操作点都不产出(magnet 本身还在,但不是操作点)', () => {
    const m = magnets();
    expect(m.length, '前提:图元确实有 4 个连接点').toBe(4);

    expect(resolveMagnetActions('n1', undefined, m)).toEqual([]);
    expect(resolveMagnetActions('n1', [], m)).toEqual([]);
  });

  it('⭐ 声明了哪个 magnet 就只画哪个,坐标取自该 magnet 的世界坐标', () => {
    const out = resolveMagnetActions('n1', [{ magnet: 'E', icon: 'minus' }], magnets());
    expect(out).toEqual([
      { instanceId: 'n1', magnetId: 'E', icon: 'minus', x: 100, y: 30 },
    ]);
  });

  it('⭐ 多条声明各自对齐到各自的 magnet(不串位)', () => {
    const out = resolveMagnetActions(
      'n1',
      [{ magnet: 'W', icon: 'plus' }, { magnet: 'S', icon: 'dot' }],
      magnets(),
    );
    expect(out.map((a) => [a.magnetId, a.icon, a.x, a.y])).toEqual([
      ['W', 'plus', 0, 30],
      ['S', 'dot', 50, 60],
    ]);
  });

  it('⚠️ 声明了图元没有的 magnet id → 丢弃 + warn,**不静默兜底到别的 magnet**', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = resolveMagnetActions('n1', [{ magnet: 'EAST', icon: 'minus' }], magnets());
    expect(out, '拼错的 id 不能悄悄落到 N/E/S/W 里的任何一个').toEqual([]);
    expect(warn, 'fail loud:必须报出来').toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('EAST');
  });

  it('⚠️ 一条拼错不牵连同批正确的那条', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = resolveMagnetActions(
      'n1',
      [{ magnet: 'EAST', icon: 'minus' }, { magnet: 'E', icon: 'plus' }],
      magnets(),
    );
    expect(out.map((a) => a.magnetId)).toEqual(['E']);
  });
});

describe('② 命中按屏幕像素恒定', () => {
  const resolved: ResolvedMagnetAction[] = [
    { instanceId: 'n1', magnetId: 'E', icon: 'minus', x: 100, y: 30 },
  ];

  it('⭐⭐ 同一个屏幕距离,在任何 zoom 下命中结果一致(像素恒定)', () => {
    // 屏幕上距圆心 10px 处 —— 圆半径 6 + slop 8 = 14px 以内,必中
    const screenDist = 10;
    for (const zoom of [0.25, 0.5, 1, 2, 4, 8]) {
      const worldDist = screenDist / zoom;
      const hit = hitTestMagnetAction({ x: 100 + worldDist, y: 30 }, resolved, zoom);
      expect(hit?.magnetId, `zoom=${zoom} 时 10 屏幕像素处应命中`).toBe('E');
    }
    // 屏幕上距圆心 20px 处 —— 超出 14px,任何 zoom 都不该中
    for (const zoom of [0.25, 0.5, 1, 2, 4, 8]) {
      const worldDist = 20 / zoom;
      const hit = hitTestMagnetAction({ x: 100 + worldDist, y: 30 }, resolved, zoom);
      expect(hit, `zoom=${zoom} 时 20 屏幕像素处不该命中`).toBeNull();
    }
  });

  it('⭐ 放大 4× 后,世界容忍距离必须缩小到 1/4(否则点得中看不见的地方)', () => {
    expect(magnetActionHitRadiusWorld(4)).toBeCloseTo(magnetActionHitRadiusWorld(1) / 4, 10);
    expect(magnetActionHitRadiusWorld(1)).toBe(
      MAGNET_ACTION_RADIUS_PX + MAGNET_ACTION_HIT_SLOP_PX,
    );
  });

  it('⚠️ zoom=0(容器隐藏 / 未布局)不炸也不除零 —— 兜到 0.01', () => {
    const r = magnetActionHitRadiusWorld(0);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBe((MAGNET_ACTION_RADIUS_PX + MAGNET_ACTION_HIT_SLOP_PX) / 0.01);
  });

  it('⭐ 多个操作点重叠时取最近的那个', () => {
    const two: ResolvedMagnetAction[] = [
      { instanceId: 'n1', magnetId: 'E', icon: 'minus', x: 100, y: 30 },
      { instanceId: 'n2', magnetId: 'W', icon: 'plus', x: 104, y: 30 },
    ];
    expect(hitTestMagnetAction({ x: 103.5, y: 30 }, two, 1)?.magnetId).toBe('W');
    expect(hitTestMagnetAction({ x: 100.5, y: 30 }, two, 1)?.magnetId).toBe('E');
  });

  it('没有操作点时命中恒为 null', () => {
    expect(hitTestMagnetAction({ x: 100, y: 30 }, [], 1)).toBeNull();
  });
});

describe('③ 拖出落点分流', () => {
  it('⭐⭐ 落在某 magnet 的吸附范围内 → 给 target(instanceId + magnet)', () => {
    const closest = {
      magnet: { instanceId: 'n2', magnetId: 'W', x: 200, y: 30 } as WorldMagnet,
    };
    expect(resolveMagnetDragOut(closest, { x: 203, y: 31 })).toEqual({
      kind: 'magnet',
      instanceId: 'n2',
      magnet: 'W',
    });
  });

  it('⭐⭐ 落在空白(附近无 magnet)→ 给 world 坐标,**不吞掉这次拖动**', () => {
    expect(resolveMagnetDragOut(null, { x: 777, y: 888 })).toEqual({
      kind: 'world',
      world: { x: 777, y: 888 },
    });
  });

  it('⚠️ target 的 magnet id 取自被吸附的那个点,不是拖出的那个', () => {
    const closest = {
      magnet: { instanceId: 'n2', magnetId: 'N', x: 200, y: 0 } as WorldMagnet,
    };
    const out = resolveMagnetDragOut(closest, { x: 200, y: 0 });
    expect(out).toEqual({ kind: 'magnet', instanceId: 'n2', magnet: 'N' });
  });
});

/**
 * ⚠️ 注入验红台账(每条都实跑过,确认「被测逻辑错了就会红」)
 *
 * | 断言 | 注入的违规 | 结果 |
 * |---|---|---|
 * | 没声明 → 不产出 | resolveMagnetActions 改成 actions 为空时返回全部 magnets | 红 |
 * | 声明哪个画哪个 | 改成永远取 magnets[0] | 红 |
 * | 拼错 id 丢弃+warn | 改成 `?? magnets[0]` 静默兜底 | 红(out 非空 + warn 没调) |
 * | 一条错不牵连正确的 | 改成 for 循环里遇错 `return []` | 红 |
 * | 命中像素恒定 | hitTest 改成固定世界距离 14(不除 zoom) | 红(zoom=4 时 10px 处漏判) |
 * | 放大 4× 容忍缩 1/4 | magnetActionHitRadiusWorld 改成不除 zoom | 红 |
 * | zoom=0 兜底 | 去掉 Math.max(zoom, 0.01) | 红(Infinity) |
 * | 重叠取最近 | 改成取第一个命中的 | 红 |
 * | 落空白给 world | 改成 closest 为 null 时返回 null | 红 |
 */

/**
 * 圆内数字(count)—— 几何与命中口径
 *
 * ⚠️ 这里**测不到 three**(vitest 是 node 环境,MagnetActionsOverlay 画笔部分不可测),
 * 所以只测纯函数层:半径推导 / 文字裁剪 / 命中半径跟随。
 * 画笔那半靠真机看。
 */
describe('操作点圆内数字', () => {
  it('⭐ 没 count 时半径不变(不影响既有操作点)', () => {
    expect(radiusFor({})).toBe(MAGNET_ACTION_RADIUS_PX);
    expect(labelFor({})).toBe('');
  });

  it('⭐⭐ 有 count 时圆必须变大 —— 否则数字溢出到圆外', () => {
    expect(radiusFor({ count: 3 })).toBeGreaterThan(MAGNET_ACTION_RADIUS_PX);
    // 位数越多圆越大
    expect(radiusFor({ count: 12 })).toBeGreaterThan(radiusFor({ count: 3 }));
    expect(radiusFor({ count: 123 })).toBeGreaterThan(radiusFor({ count: 12 }));
  });

  it('⚠️ 超过 99 收成 `99+`,圆不会被撑到无限大', () => {
    expect(labelFor({ count: 99 })).toBe('99');
    expect(labelFor({ count: 100 })).toBe('99+');
    expect(labelFor({ count: 9999 })).toBe('99+');
    // 三位以上都用同一个半径,不随数值继续涨
    expect(radiusFor({ count: 100 })).toBe(radiusFor({ count: 9999 }));
  });

  it('⭐⭐ 命中半径**跟随放大后的圆** —— 否则「画得大、点边缘点不中」', () => {
    const withCount = magnetActionHitRadiusWorld(1, { count: 12 });
    const plain = magnetActionHitRadiusWorld(1);
    expect(withCount).toBeGreaterThan(plain);
    // 与画出来的半径同口径(圆半径 + slop)
    expect(withCount).toBe(radiusFor({ count: 12 }) + MAGNET_ACTION_HIT_SLOP_PX);
  });

  it('⭐ count 经 resolve 透传给 overlay(漏传 = 圆里永远没数字)', () => {
    const resolved = resolveMagnetActions(
      'n1',
      [{ magnet: 'E', icon: 'plus', count: 7 }],
      [{ magnetId: 'E', x: 10, y: 20 }],
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0].count).toBe(7);
  });
});
