/**
 * L5-G6c 阶段 C3 — substance 重建(ref 指向新 shape,不再悬空 null-skip)
 *
 * 验收(phaseC-prompt §6 / §2.3 ref 表):
 *  5 个 substance 的每个 shape 子组件 ref 都解析到已注册的 def(C2 最小集),
 *  展开渲染不再全 null-skip(NodeRenderer.renderSubstanceInstance / estimateSubstanceBbox
 *  靠 api.shapes.get(ref) 拿到非 null)。
 *
 * 数据层验:扫 definitions/ 真 def + svg 文件名约定建可用 shape-id 集,
 * 断言每个 substance.components[].ref ∈ 该集(等价 render 时 get 不返 null)。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const SHAPES_DIR = path.resolve(__dirname, '../../src/capabilities/shape-library/shapes/definitions');
const SUBS_DIR = path.resolve(__dirname, '../../src/capabilities/shape-library/substances/definitions');

/** 递归收集目录下文件(rel 路径) */
function walk(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

let shapeIds: Set<string>;
let substances: Array<{ id: string; components: Array<{ type: string; ref: string }> }>;

beforeAll(() => {
  shapeIds = new Set();
  for (const rel of walk(SHAPES_DIR)) {
    if (rel.endsWith('.json')) {
      const def = JSON.parse(readFileSync(path.join(SHAPES_DIR, rel), 'utf-8'));
      if (def.id) shapeIds.add(def.id);
    } else if (rel.endsWith('.svg')) {
      // bootstrap 文件名约定:<category>/<name>.svg → krig.{category}.{name}
      const m = /([^/]+)[\\/]([^/]+)\.svg$/.exec(rel);
      if (m) shapeIds.add(`krig.${m[1]}.${m[2]}`);
    }
  }
  substances = walk(SUBS_DIR)
    .filter((r) => r.endsWith('.json'))
    .map((r) => JSON.parse(readFileSync(path.join(SUBS_DIR, r), 'utf-8')));
});

describe('L5-G6c C3 — substance ref 重建', () => {
  it('C2 最小集已注册 7 shape id(rect/roundRect/ellipse/text/arrow/line×2)+ svg star', () => {
    for (const id of [
      'krig.basic.rect', 'krig.basic.roundRect', 'krig.basic.ellipse', 'krig.basic.text',
      'krig.arrow.right', 'krig.line.straight', 'krig.line.elbow', 'krig.geometry.star',
    ]) {
      expect(shapeIds.has(id)).toBe(true);
    }
  });

  it('5 个 substance 都在', () => {
    const ids = substances.map((s) => s.id).sort();
    expect(ids.length).toBe(5);
  });

  it('每个 substance 的 shape 子组件 ref 都解析到已注册 def(不再 null-skip)', () => {
    for (const sub of substances) {
      for (const comp of sub.components) {
        if (comp.type !== 'shape') continue;
        expect(
          shapeIds.has(comp.ref),
          `${sub.id} 子组件 ref ${comp.ref} 未解析(会 null-skip)`,
        ).toBe(true);
      }
    }
  });

  it('label/dates 子组件已从 krig.text.label 改指 krig.basic.text(R8:不复活旧特殊类)', () => {
    const allRefs = substances.flatMap((s) => s.components.map((c) => c.ref));
    expect(allRefs).not.toContain('krig.text.label');
    expect(allRefs).toContain('krig.basic.text');
  });
});
