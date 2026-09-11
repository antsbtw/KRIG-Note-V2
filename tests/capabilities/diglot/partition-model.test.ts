/**
 * ⭐⭐ 数据分区:交集 + 三份专用(用户 2026-09-10 拍板,规格 04 §0.6)
 *
 * > 「把数据分成几个部分:note / mermaid / graph 各自专用的部分 + 三部分的交集。」
 * > 「导出语法时,就使用**交集 + 专用部分**即成完整的数据了。」
 *
 * ⚠️ 断言**先于实现写**。三条规矩:
 *   ① 交集:谁都能读,谁都能写
 *   ② 专用:只有主人能写,别人看都不看
 *   ③ ⭐ 不认识的一律原样保留(别人的专用区 + 自己不认识的字段)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CORE_KEYS,
  GRAPH_KEYS,
  partitionOf,
  exportRegions,
} from '@capabilities/diglot-model/partition';

describe('分区归属', () => {
  it('⭐⭐ collapsed 属于**交集**,不属于 graph(note 也读它)', () => {
    // ⚠️ 放错格子踩过 split brain:三角切了、图收了,文字纹丝不动
    expect(partitionOf('collapsed')).toBe('core');
    expect(CORE_KEYS).toContain('collapsed');
    expect(GRAPH_KEYS).not.toContain('collapsed');
  });

  it('⭐ 结构字段属于交集(三个 view 各自解析同一份结构)', () => {
    for (const k of ['id', 'parent', 'order', 'content', 'role']) {
      expect(partitionOf(k), `${k} 应属交集`).toBe('core');
    }
  });

  it('⭐ 只有画布用得上的属于 graph 专用', () => {
    for (const k of ['pos', 'color', 'shape', 'structure', 'float', 'view']) {
      expect(partitionOf(k), `${k} 应属 graph 专用`).toBe('graph');
    }
  });

  it('⚠️ 不认识的字段归为 unknown —— **不报错、不丢弃**', () => {
    // 将来新增的图元特征(老版本读到)必须落在这里,而不是被当成非法
    expect(partitionOf('borderStyle')).toBe('unknown');
    expect(partitionOf('children')).toBe('unknown');
  });
});

describe('⭐⭐ 导出 = 交集 + 该 view 的专用区', () => {
  it('note 导出取 core + note', () => {
    expect(exportRegions('note')).toEqual(['core', 'note']);
  });

  it('mermaid 导出取 core + mermaid', () => {
    expect(exportRegions('mermaid')).toEqual(['core', 'mermaid']);
  });

  it('graph 导出取 core + graph', () => {
    expect(exportRegions('graph')).toEqual(['core', 'graph']);
  });

  it('⭐⭐ 任何单个 view 的导出都**不含别人的专用区**', () => {
    for (const v of ['note', 'mermaid', 'graph'] as const) {
      const regions = exportRegions(v);
      const others = (['note', 'mermaid', 'graph'] as const).filter((x) => x !== v);
      for (const o of others) {
        expect(regions, `${v} 的导出混进了 ${o} 的专用区`).not.toContain(o);
      }
    }
  });

  it('⭐ 存盘(全量)四区全取 —— 只有它是无损的', () => {
    expect(exportRegions('all')).toEqual(['core', 'note', 'mermaid', 'graph']);
  });
});

/**
 * ⭐⭐ 分区表不是孤立抽象 —— 必须与既有实现对得上
 *
 * ⚠️ 「抽象层被掏空」是踩过的反向攻击面:表写得漂亮,真实代码各走各的,
 * 测试全绿但零保障。这里把表与**实际字段定义**钉在一起。
 */
describe('分区表与实现一致', () => {
  const read = (p: string): string =>
    readFileSync(resolve(__dirname, '../../..', p), 'utf-8');

  it('⭐ GRAPH_KEYS 覆盖 GEntry 的全部图形字段(除 collapsed/unknown)', () => {
    const types = read('src/capabilities/diglot-model/types.ts');
    const block = types.slice(types.indexOf('export interface GEntry'));
    const body = block.slice(0, block.indexOf('\n}'));
    const fields = [...body.matchAll(/readonly (\w+)\??:/g)].map((m) => m[1]);

    for (const f of fields) {
      if (f === 'collapsed') {
        expect(partitionOf(f), 'collapsed 必须在 core(note 也读)').toBe('core');
        continue;
      }
      if (f === 'unknown') continue; // 未知记号的容器,不是具体字段
      expect(partitionOf(f), `GEntry.${f} 不在分区表里 —— 表被掏空了`).toBe('graph');
    }
  });

  it('⭐ CORE_KEYS 覆盖 SNode 的结构字段', () => {
    const types = read('src/capabilities/diglot-model/types.ts');
    const block = types.slice(types.indexOf('export interface SNode'));
    const body = block.slice(0, block.indexOf('\n}'));
    const fields = [...body.matchAll(/readonly (\w+)\??:/g)].map((m) => m[1]);

    for (const f of ['id', 'parent', 'order', 'content', 'role']) {
      expect(fields, `SNode 少了 ${f}`).toContain(f);
      expect(partitionOf(f)).toBe('core');
    }
  });
});
