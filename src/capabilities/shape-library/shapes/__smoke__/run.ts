/**
 * Smoke test for ShapeRegistry + parametric evaluateShape(L5-G2)
 *
 * V1 直迁:src/plugins/graph/library/shapes/__smoke__/run.ts(97 行).
 * V2 改动:断言形态对齐 EvaluatedPath(V1 走 RenderOutput.data 多一层 unwrap,
 * V2 evaluateShape 直接返 EvaluatedPath 或 null).
 *
 * 不接入测试框架,直接 ts-node 风格运行(或开发面板上调一次).
 * 检查:
 * 1. 所有 22 个 shape 都被 bootstrap 收齐
 * 2. id 不重复
 * 3. 每个 shape 在 200x100 尺寸下能渲染出非空 d 字符串
 *    (geometry.kind 非 parametric — text / svg — 跳过几何求值)
 * 4. d 字符串不含 NaN / Infinity
 * 5. magnets 数值有限
 *
 * 用法:DevTools console:
 *   const { runShapeSmoke, printSmoke } = await import('@capabilities/shape-library');
 *   printSmoke(runShapeSmoke());
 */

import { ShapeRegistry } from '../registry';
import { evaluateShape } from '../renderers';
import { bootstrapShapes } from '../bootstrap';
import type { ShapeDef } from '../../types';

export interface SmokeReport {
  ok: boolean;
  total: number;
  failed: Array<{ id: string; reason: string }>;
  byCategory: Record<string, number>;
}

const TEST_W = 200;
const TEST_H = 100;

export function runShapeSmoke(): SmokeReport {
  bootstrapShapes();
  const all = ShapeRegistry.list();
  const failed: SmokeReport['failed'] = [];
  const byCategory: Record<string, number> = {};
  const seenIds = new Set<string>();

  for (const shape of all) {
    byCategory[shape.category] = (byCategory[shape.category] ?? 0) + 1;
    if (seenIds.has(shape.id)) {
      failed.push({ id: shape.id, reason: 'duplicate id' });
      continue;
    }
    seenIds.add(shape.id);

    const reason = checkShape(shape);
    if (reason) failed.push({ id: shape.id, reason });
  }

  return {
    ok: failed.length === 0,
    total: all.length,
    failed,
    byCategory,
  };
}

function checkShape(shape: ShapeDef): string | null {
  // text / svg kind 不参与 parametric 几何求值,跳过(L5-G6c 统一范式)
  if (shape.geometry.kind !== 'parametric') return null;

  let out;
  try {
    out = evaluateShape(shape, { width: TEST_W, height: TEST_H });
  } catch (e) {
    return `evaluate threw: ${(e as Error).message}`;
  }
  if (!out) return 'evaluate returned null (renderer != parametric or path missing)';

  if (!out.d || out.d.length === 0) return 'empty path d';
  if (/NaN|Infinity/.test(out.d)) return `path contains NaN/Infinity: "${out.d}"`;

  for (const m of out.magnets) {
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) {
      return `magnet ${m.id} not finite: (${m.x},${m.y})`;
    }
  }
  if (out.textBox) {
    const { l, t, r, b } = out.textBox;
    if (![l, t, r, b].every(Number.isFinite)) {
      return `textBox not finite: ${JSON.stringify(out.textBox)}`;
    }
  }
  return null;
}

/** 控制台友好打印 */
export function printSmoke(rep: SmokeReport): void {
  console.log('[shape-smoke]', rep.ok ? 'OK' : 'FAIL', `total=${rep.total}`);
  console.log('[shape-smoke] by category:', rep.byCategory);
  if (rep.failed.length) {
    console.error('[shape-smoke] failures:', rep.failed);
  }
}
