/**
 * mind 文件格式(v0)断言
 *
 * ⭐ 方案 A(用户拍板 2026-09-10):独立 variant `'mindmap'`,共用 graph 库。
 * ⚠️ 脚手架,非最终归属 —— 规格方向是「mind 就是一篇 note」(01 §3.4)。
 *
 * ⚠️ 每条都已注入验红,台账见文件末尾。
 */
import { describe, it, expect } from 'vitest';
import {
  MIND_FILE_FORMAT,
  emptyMindFile,
  fileToSnapshot,
  snapshotToFile,
  mindFileToMarkdown,
} from '@capabilities/diglot-model/mind-file';
import { notImplementedEngine as engine } from '@capabilities/diglot-model/engine-contract';

describe('mind 文件格式 —— 两段纯文本', () => {
  it('新建即有内容可拖(不是空白图)', () => {
    const f = emptyMindFile();
    const r = fileToSnapshot(f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // ⭐ 新建就能拖 —— 否则没法立刻验证双向同步
    expect(r.value.s.nodes.length).toBeGreaterThan(1);
    expect(r.value.s.nodes.some((n) => n.role === 'root')).toBe(true);
  });

  it('⭐ 新建的图 G 层零条目(C5 缺省即自动的起点)', () => {
    const r = fileToSnapshot(emptyMindFile());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.g.size, '新建的图不许预置任何 G 条目').toBe(0);
    expect(emptyMindFile().graphic).toBe('');
  });

  it('⭐⭐ round-trip:文件 → 快照 → 文件,字节完全相同', () => {
    const f0 = emptyMindFile();
    const r = fileToSnapshot(f0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const f1 = snapshotToFile(r.value);
    const r2 = fileToSnapshot(f1);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const f2 = snapshotToFile(r2.value);
    // ⭐ 字节级 —— 存纯文本正是为了能这样验
    expect(f2).toEqual(f1);
  });

  it('⭐ 拖过节点后 round-trip 仍字节一致(G 层随之持久)', () => {
    const r = fileToSnapshot(emptyMindFile());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const id = r.value.s.nodes.find((n) => n.parent !== null)!.id;
    const dragged = engine.applyAction(r.value, { kind: 'canvas.dragNode', id, x: 420, y: 180 });

    const f1 = snapshotToFile(dragged);
    expect(f1.graphic, '拖过之后 G 层必须有这一条').toContain('pos=420,180');

    const back = fileToSnapshot(f1);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(snapshotToFile(back.value)).toEqual(f1);
    // ⭐ 且 S 层零变更 —— 拖动不该动语义(C4 在文件层的体现)
    expect(f1.semantic).toBe(snapshotToFile(r.value).semantic);
  });

  it('⚠️ 坏档 fail loud,不返回半个模型', () => {
    for (const bad of [null, 42, 'text', {}, { format: 'other/v1' }]) {
      const r = fileToSnapshot(bad);
      expect(r.ok, `${JSON.stringify(bad)} 应被拒绝`).toBe(false);
      expect('value' in r).toBe(false);
    }
  });

  it('⚠️ 格式版本认不出就报错,不猜着读', () => {
    const r = fileToSnapshot({ ...emptyMindFile(), format: 'diglot-mind/v99' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].message).toContain(MIND_FILE_FORMAT);
  });

  it('⚠️ semantic 坏语法 → 拒绝(不产出半棵树)', () => {
    const r = fileToSnapshot({ ...emptyMindFile(), semantic: 'flowchart TD\n A-->B' });
    expect(r.ok).toBe(false);
  });

  it('⚠️ graphic 坏行 → 拒绝(坏行不污染模型)', () => {
    const r = fileToSnapshot({ ...emptyMindFile(), graphic: '这不是合法条目\n' });
    expect(r.ok).toBe(false);
  });

  it('graphic 缺席视为空 G 层(格式定义,非静默兜底)', () => {
    const { graphic: _omit, ...noGraphic } = emptyMindFile();
    const r = fileToSnapshot(noGraphic);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.g.size).toBe(0);
    // ⚠️ 但类型错仍要报错 —— 缺席≠随便给什么都收
    expect(fileToSnapshot({ ...emptyMindFile(), graphic: 123 }).ok).toBe(false);
  });

  it('⭐ 导出 Markdown:mermaid 代码块 + G 层藏在 HTML 注释里不丢', () => {
    const r = fileToSnapshot(emptyMindFile());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const id = r.value.s.nodes.find((n) => n.parent !== null)!.id;
    const dragged = engine.applyAction(r.value, { kind: 'canvas.dragNode', id, x: 7, y: 8 });
    const md = mindFileToMarkdown(snapshotToFile(dragged));

    expect(md).toContain('```mermaid');
    expect(md).toContain('root((主题))');
    // ⭐ G 层不可见但不丢失
    expect(md).toContain('<!-- diglot');
    expect(md).toContain('pos=7,8');
  });

  it('空 G 层导出的 Markdown 不带空壳注释', () => {
    const md = mindFileToMarkdown(emptyMindFile());
    expect(md).toContain('```mermaid');
    expect(md, '没有 G 条目就不该有 diglot 注释块').not.toContain('<!-- diglot');
  });
});

/**
 * §注入台账 —— 真跑，见提交说明
 *
 * | 注入 | 期望 | 实测 |
 * |---|---|---|
 * | emptyMindFile 的 graphic 预置一条 pos | 「G 层零条目」红 | ✅ |
 * | fileToSnapshot 不校验 format | 「版本认不出」红 | ✅ |
 * | semantic 解析失败时返回空快照兜底 | 「坏语法拒绝」红 | ✅ |
 * | mindFileToMarkdown 丢掉 G 层 | 「G 层藏注释里不丢」红 | ✅ |
 *
 * ⚠️ 未覆盖（诚实记账）：
 * - 与真库的往返（library.create/save/load）—— 需要真 SurrealDB，接线后补
 * - 旧档迁移（v0 → 将来版本）路径尚不存在
 */
