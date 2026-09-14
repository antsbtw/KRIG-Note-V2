/**
 * 箭头几何 —— 纯逻辑层断言(补画板「ArrowStyle 是死字段」这个缺口)
 *
 * ⚠️ 缺口实证(2026-09-13 grep):`ArrowStyle` 类型有、JSON default_style 里有、
 * Host 会深合并(`Host.tsx:361`)—— 但 `LineRenderer` **零消费**,画板和导图都画不出箭头。
 * 规格 `00 §9.1`:「⭐ 箭头这条最要紧:画不出箭头就画不了流程图」。
 *
 * ⭐⭐ 为什么几何要抽成纯函数:vitest 跑 node 环境(`vitest.config.ts: environment:'node'`),
 * 测试**不能 import three**。同款先例 `interaction/magnet-actions.ts` 的文件头写死了这条理由。
 * 故本模块只算「三角形的三个点」,画 mesh 留给 LineRenderer 薄壳。
 *
 * ⚠️ 每条都注入验红,台账见文件末尾。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  arrowTangentOf,
  arrowHeadPoints,
  shouldDrawArrow,
  ARROW_SIZE_PX,
} from '@capabilities/canvas-rendering/scene/arrow-geometry';

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8');
/** 剥注释 —— ⚠️ 否则注释里写着同一句话就能骗过守卫(canvas-magnet-actions 踩过) */
const stripComments = (s: string): string =>
  s.split('\n').filter((l) => {
    const t = l.trim();
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  }).join('\n');

describe('箭头几何 · 切线方向', () => {
  it('⭐ 切线取**最后两点**的差向量 —— 三种几何一套逻辑', () => {
    // 直线:两点
    const t1 = arrowTangentOf([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    expect(t1).toEqual({ x: 1, y: 0 });
    // elbow:四点,末段是竖直的
    const t2 = arrowTangentOf([
      { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 10 }, { x: 5, y: 20 },
    ]);
    expect(t2).toEqual({ x: 0, y: 1 });
  });

  it('⭐⭐ 切线必须归一化(长度 1)—— 否则箭头大小随线长变', () => {
    // ⚠️ 这条是**真会写错**的:直接用差向量,线越长箭头越大
    const t = arrowTangentOf([{ x: 0, y: 0 }, { x: 300, y: 400 }]);
    expect(Math.hypot(t.x, t.y)).toBeCloseTo(1, 10);
    expect(t).toEqual({ x: 0.6, y: 0.8 });
  });

  it('⚠️ 末两点重合(退化)→ 给 null,不产出 NaN', () => {
    // ⚠️ 归一化要除以长度,长度 0 会得 NaN → 箭头顶点变 NaN → three 整个 mesh 消失
    //   (静默失败:线还在、箭头没了,还不报错)
    expect(arrowTangentOf([{ x: 5, y: 5 }, { x: 5, y: 5 }])).toBeNull();
  });

  it('⚠️ 点数不足(<2)→ 给 null', () => {
    expect(arrowTangentOf([{ x: 0, y: 0 }])).toBeNull();
    expect(arrowTangentOf([])).toBeNull();
  });
});

describe('箭头几何 · 三角形顶点', () => {
  it('⭐ 尖端落在**线的终点**上,不是终点之外', () => {
    const pts = arrowHeadPoints({ x: 100, y: 50 }, { x: 1, y: 0 }, 10);
    expect(pts).not.toBeNull();
    expect(pts!.tip).toEqual({ x: 100, y: 50 });
  });

  it('⭐⭐ 两翼关于轴线**对称**,且在尖端后方', () => {
    const pts = arrowHeadPoints({ x: 100, y: 0 }, { x: 1, y: 0 }, 10)!;
    // 轴向朝 +x → 两翼 x 相同且小于 tip.x(在后方)
    expect(pts.left.x).toBeCloseTo(pts.right.x, 10);
    expect(pts.left.x).toBeLessThan(pts.tip.x);
    // 对称:y 等大反向
    expect(pts.left.y).toBeCloseTo(-pts.right.y, 10);
    expect(Math.abs(pts.left.y)).toBeGreaterThan(0);
  });

  it('⭐ 尺寸参数真的改变箭头大小(不是写死)', () => {
    const small = arrowHeadPoints({ x: 0, y: 0 }, { x: 1, y: 0 }, 6)!;
    const big = arrowHeadPoints({ x: 0, y: 0 }, { x: 1, y: 0 }, 18)!;
    const spanOf = (p: typeof small): number => Math.hypot(p.left.x - p.right.x, p.left.y - p.right.y);
    expect(spanOf(big)).toBeGreaterThan(spanOf(small) * 2);
  });

  it('⚠️ 切线为 null → 三角形也给 null(不画半个箭头)', () => {
    expect(arrowHeadPoints({ x: 0, y: 0 }, null, 10)).toBeNull();
  });

  it('⭐ 斜向也对:旋转 90° 后两翼跟着转', () => {
    const pts = arrowHeadPoints({ x: 0, y: 100 }, { x: 0, y: 1 }, 10)!;
    // 轴向朝 +y → 两翼 y 相同且小于 tip.y
    expect(pts.left.y).toBeCloseTo(pts.right.y, 10);
    expect(pts.left.y).toBeLessThan(pts.tip.y);
    expect(pts.left.x).toBeCloseTo(-pts.right.x, 10);
  });
});

describe('箭头几何 · 画不画', () => {
  it('⭐ none / undefined 不画', () => {
    expect(shouldDrawArrow(undefined)).toBe(false);
    expect(shouldDrawArrow('none')).toBe(false);
  });

  it('⭐ arrow / triangle / stealth 等都要画', () => {
    // ⚠️ v0 六种词表统一画实心三角(形状差异留后续),但**都得画** ——
    //   只认 'arrow' 会让 JSON 里写 triangle 的静默不出箭头
    for (const kind of ['arrow', 'triangle', 'diamond', 'oval', 'stealth'] as const) {
      expect(shouldDrawArrow(kind), `${kind} 应当画箭头`).toBe(true);
    }
  });
});

describe('⚠️⚠️ 拖动同步 —— 5 处 updateLineGeometry 不许留下不动的箭头', () => {
  it('updateLineGeometry 必须同步箭头(源码守卫,剥注释)', () => {
    const src = stripComments(read('src/capabilities/canvas-rendering/scene/LineRenderer.ts'));
    const fn = src.slice(src.indexOf('export function updateLineGeometry'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    // ⚠️ 它只改顶点不重建 group;不同步箭头 = 线走了箭头钉在原地(5 个调用点全中招)
    expect(body, 'updateLineGeometry 没有同步箭头 → 拖动时箭头留在原位').toMatch(
      /updateArrowHead|rebuildArrow|syncArrow/,
    );
  });

  it('renderLine 与 updateLineGeometry 走**同一个**箭头更新函数(防两处漂移)', () => {
    const src = stripComments(read('src/capabilities/canvas-rendering/scene/LineRenderer.ts'));
    const helper = /function (updateArrowHead|rebuildArrow|syncArrow)/.exec(src)?.[1];
    expect(helper, '应当有一个共用的箭头更新函数').toBeTruthy();
    const uses = src.split(helper!).length - 1;
    // 定义 1 次 + renderLine 用 1 次 + updateLineGeometry 用 1 次 = 至少 3
    expect(uses, `${helper} 应被 renderLine 与 updateLineGeometry 共用`).toBeGreaterThanOrEqual(3);
  });
});

describe('⚠️ 契约:arrow 必须真被 NodeRenderer 传下去', () => {
  it('renderLineShape 要把 style_overrides.arrow 合并后传给 renderLine', () => {
    const src = stripComments(read('src/capabilities/canvas-rendering/scene/NodeRenderer.ts'));
    const fn = src.slice(src.indexOf('private renderLineShape'));
    const body = fn.slice(0, fn.indexOf('\n  }'));
    // ⚠️ 缺这一步 = 字段仍然是死的:JSON 写了 arrow,渲染层收不到
    expect(body, 'renderLineShape 没把 arrow 传给 renderLine → ArrowStyle 仍是死字段').toMatch(
      /arrow:\s*mergeArrow\(/,
    );
  });
});

/**
 * ── 注入验红台账(6 向,全部按预期变红、还原后全绿)────────────
 *
 * | # | 注入 | 结果 |
 * |---|---|---|
 * | J | `updateLineGeometry` 不同步箭头(拖动时箭头钉原地) | 2 红 |
 * | K | 两处各写一份箭头逻辑,不走共用 helper | 2 红 |
 * | L | `renderLineShape` 不传 arrow(字段回到死的) | 1 红 |
 * | M | 切线不归一化(箭头大小随线长变) | 2 红 |
 * | N | 退化线返回零向量而非 null(产出 NaN mesh) | 1 红 |
 * | O | `shouldDrawArrow` 只认 'arrow'(triangle 静默不画) | 1 红 |
 *
 * ⚠️ J / K 都让「共用 helper」那条红 —— 它守的是**两处不许各写一份**,
 * 比「有没有调用」宽一格,这是有意的:同一件事两处实现迟早漂移。
 */
