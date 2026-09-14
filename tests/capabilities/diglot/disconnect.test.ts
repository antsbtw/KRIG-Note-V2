/**
 * `canvas.disconnect` —— 删一条联系线(用户 2026-09-14 拍板「甲」)
 *
 * ⚠️⚠️ **为什么需要新 action**(实测,非推理):模型里原先**只有 `canvas.connect`,
 * 没有任何删边入口**(`grep disconnect|deleteEdge|removeEdge` 在 engine-contract 零命中)。
 * 边只能靠 `canvas.deleteSubtree` **连坐**清掉(删端点时 `edges.filter` 掉两端)——
 * 而「选中联系线 → 删除」要的是**单独删一条**,连坐做不到。
 *
 * ⭐ **形态选甲**(与 connect 对称,`{source,target}`)而非乙(`{id}`):
 * 两者都要推出边 id,甲让 id 推导**只有 `deterministicEdgeId` 一处**;
 * 乙则 view 侧要从 `rel:<edgeId>` instance id 剥前缀再传,
 * ⚠️ **id 在两侧各拼一次 = 迟早漂移**(本仓库已有同形教训)。
 *
 * ── 本文件钉住什么 ────────────────────────────────────
 * 1. ⭐⭐ 删掉的**正是那一条**,其它边不动
 * 2. ⭐ 与 connect **严格对称**:connect 后 disconnect,回到原状
 * 3. ⚠️ 删不存在的边 = **无变更**,不报错也不造边(幂等)
 * 4. ⭐⭐ **只动 S 层 edges** —— 节点、G 层一律不碰(C3)
 * 5. ⚠️ **方向敏感**:A→B 与 B→A 是两条边,删一条不影响另一条
 */
import { describe, it, expect } from 'vitest';
import { notImplementedEngine as engine } from '@capabilities/diglot-model/engine-contract';
import { emptyMindFile, fileToSnapshot } from '@capabilities/diglot-model/mind-file';
import { contentToText } from '@capabilities/diglot-model/mermaid-mindmap';
import { deterministicEdgeId } from '@capabilities/diglot-model/edge-id';
import type { DiglotSnapshot } from '@capabilities/diglot-model/engine-contract';

function snap(): DiglotSnapshot {
  const r = fileToSnapshot(emptyMindFile());
  if (!r.ok) throw new Error('夹具失败');
  return r.value;
}
const idOf = (s: DiglotSnapshot['s'], label: string): string =>
  s.nodes.find((n) => contentToText(n.content) === label)!.id;

/** 连一条线,返回 {快照, 两端 id} */
function withEdge(base: DiglotSnapshot, from: string, to: string) {
  const source = idOf(base.s, from);
  const target = idOf(base.s, to);
  const next = engine.applyAction(base, { kind: 'canvas.connect', source, target, label: '支撑' });
  return { next, source, target };
}

describe('canvas.disconnect —— 单独删一条联系线', () => {
  /**
   * ⚠️⚠️ **样本设计**:要删的必须是**第二条**,不能是第一条。
   * 踩过(探针实证):第一版删第一条,于是把实现换成 `s.edges.slice(1)`
   * (「无脑删第一条」)**照样全绿** —— 断言与 bug 给出同一个答案 = 假绿。
   * ⭐ 删第二条后,「按 id 删」与「删第一条」的结果才分道扬镳。
   */
  it('⭐⭐ 删掉的正是那一条,其它边原封不动', () => {
    const base = snap();
    const a = withEdge(base, '叶子1', '叶子3');
    const b = withEdge(a.next, '分支A', '分支B');
    expect(b.next.s.edges).toHaveLength(2);

    // ⭐ 删**第二条**(b),留下第一条(a)
    const after = engine.applyAction(b.next, {
      kind: 'canvas.disconnect',
      source: b.source,
      target: b.target,
    });

    expect(after.s.edges, '⚠️ 该删的没删 / 删多了').toHaveLength(1);
    expect(
      after.s.edges[0].id,
      '⚠️ 删错了边 —— 留下的应该是第一条(叶子1→叶子3)',
    ).toBe(deterministicEdgeId(a.source, a.target));
  });

  it('⭐ 与 connect 严格对称:连了再断 = 回到原状', () => {
    const base = snap();
    const { next, source, target } = withEdge(base, '叶子1', '叶子3');
    expect(next.s.edges).toHaveLength(1);

    const after = engine.applyAction(next, { kind: 'canvas.disconnect', source, target });
    expect(after.s.edges, '⚠️ connect/disconnect 不对称').toHaveLength(0);
  });

  /**
   * ⚠️⚠️ **样本设计**:要删的必须是**「排序后会变样」的那个方向**。
   * 踩过(探针实证):第一版删 `叶子1→叶子3`,而两端排序后恰好还是
   * `叶子1,叶子3` —— 于是把实现换成「先 sort 两端再推 id」(方向不敏感的经典 bug)
   * **照样全绿**。⭐ 改删**反向** `叶子3→叶子1`:它排序后会塌成正向,
   * 一旦实现排序就会**删错那条**,断言才咬得住。
   */
  it('⚠️ 方向敏感:A→B 与 B→A 是两条,删一条不影响另一条', () => {
    const base = snap();
    const x = idOf(base.s, '叶子1');
    const y = idOf(base.s, '叶子3');
    let s2 = engine.applyAction(base, { kind: 'canvas.connect', source: x, target: y });
    s2 = engine.applyAction(s2, { kind: 'canvas.connect', source: y, target: x });
    expect(s2.s.edges, '两个方向应是两条边').toHaveLength(2);

    // ⭐ 删**反向**那条(y→x);排序实现会把它算成正向 → 删错
    const after = engine.applyAction(s2, { kind: 'canvas.disconnect', source: y, target: x });
    expect(after.s.edges, '⚠️ 另一条被误删').toHaveLength(1);
    expect(
      after.s.edges[0].id,
      '⚠️ 删错方向了 —— 留下的应该是正向 x→y(实现多半把两端排序了)',
    ).toBe(deterministicEdgeId(x, y));
  });

  /**
   * ⚠️⚠️ **样本设计**:只断言 `edges.length === 0` 是**假绿**(探针实证)。
   * 幂等路径下边本来就是 0 条,于是把该分支换成「清空 edges」甚至「清空 nodes」
   * **照样全绿** —— 0 还是 0。
   * ⭐ 「无变更」的真正判据是**快照原样返回**:正确实现走 `return snapshot`,
   * 引用不变(探针:`a === base` / `d2 === d1` 均为 true)。
   * 故这里钉**同一引用 + 节点未被动**,任何「造了个新对象」的实现都会红。
   */
  it('⚠️ 删不存在的边 —— 无变更,不报错也不凭空造边(幂等)', () => {
    const base = snap();
    const x = idOf(base.s, '叶子1');
    const y = idOf(base.s, '叶子3');

    // ⭐ 一条边都没有时就删 —— 必须**原样返回同一个快照**
    const after = engine.applyAction(base, { kind: 'canvas.disconnect', source: x, target: y });
    expect(after.s.edges).toHaveLength(0);
    expect(after, '⚠️ 无变更时该原样返回快照(引用都不该变)').toBe(base);
    expect(after.s.nodes, '⚠️ 节点被动了').toEqual(base.s.nodes);

    // ⭐ 删两遍也该幂等:第二遍同样原样返回
    const one = engine.applyAction(base, { kind: 'canvas.connect', source: x, target: y });
    const d1 = engine.applyAction(one, { kind: 'canvas.disconnect', source: x, target: y });
    const d2 = engine.applyAction(d1, { kind: 'canvas.disconnect', source: x, target: y });
    expect(d2.s.edges, '⚠️ 重复删应幂等').toHaveLength(0);
    expect(d2, '⚠️ 第二遍删该原样返回(引用不变)').toBe(d1);
    expect(d2.s.nodes, '⚠️ 节点被动了').toEqual(d1.s.nodes);
  });

  /**
   * ⚠️⚠️ **这条钉的是 `applyAction` 的 `default:` 兜底**。
   *
   * 实测两件事:
   * 1. `tsc` **拦不住**未知 kind(加 union 成员前 tsc 报 0 错);
   * 2. 没有 `default:` 时 switch 落空 → 函数返回 `undefined` →
   *    调用侧才炸,报错点离真因十万八千里
   *    (真实报错长这样:`Cannot read properties of undefined (reading 's')`)。
   *
   * ⚠️ 而全仓测试恰好覆盖了**全部 17 个** 已声明 kind(census 实证),
   * 所以**没有任何现有断言能走到 `default:`** —— 拿掉它 diglot 照样 306 全绿。
   * ⭐ 故必须由本条**显式喂一个未知 kind**,否则那道兜底等于没验。
   */
  it('⚠️⚠️ 未知 action kind → fail loud(不许静默返回 undefined)', () => {
    const base = snap();
    expect(
      () => engine.applyAction(base, { kind: 'canvas.__nope__' } as never),
      '⚠️ 未知 kind 没抛错 —— switch 落空会返回 undefined,真因被掩埋',
    ).toThrow(/未处理的 action kind/);
  });

  it('⭐⭐ 只动 edges —— 节点与 G 层一律不碰(C3)', () => {
    const base = snap();
    const { next, source, target } = withEdge(base, '叶子1', '叶子3');
    // 先钉一个坐标,确保 G 层非空(否则「G 不变」在空集上恒真 = 假绿)
    const pinned = engine.applyAction(next, {
      kind: 'canvas.dragNode', id: source, x: 120, y: 240,
    });
    expect(pinned.g.size, '前置:G 层必须非空,否则下面那条验不出东西').toBeGreaterThan(0);

    const after = engine.applyAction(pinned, { kind: 'canvas.disconnect', source, target });

    expect(after.s.nodes, '⚠️ 节点被动了').toEqual(pinned.s.nodes);
    expect(
      JSON.stringify([...after.g.entries()]),
      '⚠️ G 层被动了 —— 删边不该碰布局(C3)',
    ).toBe(JSON.stringify([...pinned.g.entries()]));
  });
});
