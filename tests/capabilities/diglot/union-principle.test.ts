/**
 * ⭐⭐ 「数据是三个 view 的并集」—— 用户 2026-09-10 定的原则
 *
 * > 「使用同一份数据,但是不同的 view 做不同的解析,数据是这三者的并集就可以了。」
 *
 * 三条推论,每条都对应一个真机踩过的坑:
 *  ① 数据不为任何单个 view 裁剪  → 违反:正文存盘即丢
 *  ② view 只读自己那部分        → 违反:mermaid tab 显示一坨 JSON
 *  ③ ⭐ view 写回只能改自己那部分 → 违反:mermaid 改一个字,全图正文删光
 *
 * ⚠️ ③ 最要命,因为它**看起来像正常保存**。
 */
import { describe, it, expect } from 'vitest';
import { noteDocToTree, treeToNoteDoc } from '@capabilities/diglot-model/note-projection';
import { toMermaidMindmap, parseMermaidMindmap } from '@capabilities/diglot-model/mermaid-mindmap';
import { mergeKeepingBodies } from '@capabilities/diglot-model/apply-action';
import { snapshotToFile, fileToSnapshot, detectMindFormat } from '@capabilities/diglot-model/mind-file';

/** 一份「三个 view 的需求全都用得上」的数据 */
const unionDoc = {
  format: 'pm-doc-json' as const,
  version: '0.1' as const,
  payload: { type: 'doc', content: [
    { type: 'heading', attrs: { level: 1, id: 'root' }, content: [{ type: 'text', text: '主题' }] },
    { type: 'heading', attrs: { level: 2, id: 'm002' }, content: [{ type: 'text', text: '分支' }] },
    // ⭐ 只有 note / 画布 用得上,mermaid 表达不了 —— 正是要保护的那部分
    { type: 'paragraph', attrs: { id: 'b1' }, content: [{ type: 'mathInline', attrs: { latex: 'x^2+1' } }] },
  ] },
};

const blocksOf = (n: { content: unknown }): unknown[] =>
  ((n.content as { payload: { content: unknown[] } }).payload.content ?? []);

const withG = (s: ReturnType<typeof noteDocToTree>) => ({
  s,
  g: new Map([['m002', { pos: { x: 42, y: 43 }, color: '#fff', collapsed: true }]]),
});

describe('推论①:数据不为任何单个 view 裁剪', () => {
  it('⭐⭐ 存盘保住 mermaid 表达不了的东西(正文块 / 行内公式)', () => {
    const snap = withG(noteDocToTree(unionDoc));
    const file = snapshotToFile(snap as never);
    const back = fileToSnapshot({
      format: detectMindFormat(file.semantic),
      semantic: file.semantic,
      graphic: file.graphic,
    });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(blocksOf(back.value.s.nodes[1]).length, '正文被裁掉了').toBe(2);
    expect(JSON.stringify(back.value.s.nodes[1].content)).toContain('mathInline');
  });

  it('⭐ 存盘也保住只有画布用得上的 G 字段', () => {
    const snap = withG(noteDocToTree(unionDoc));
    const file = snapshotToFile(snap as never);
    const back = fileToSnapshot({
      format: detectMindFormat(file.semantic),
      semantic: file.semantic,
      graphic: file.graphic,
    });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const e = back.value.g.get('m002');
    expect(e?.pos, 'note 用不上 pos,但不该因此丢掉').toEqual({ x: 42, y: 43 });
    expect(e?.collapsed).toBe(true);
  });
});

describe('推论②:view 只读自己那部分', () => {
  it('⭐ note 投影拿到全部块(它是无损那条路)', () => {
    const s = noteDocToTree(unionDoc);
    const doc = treeToNoteDoc(s) as { payload: { content: unknown[] } };
    expect(doc.payload.content.length).toBe(3);
  });

  it('⭐ mermaid 投影只拿层级 + 标题纯文本(拿不到的就是拿不到,不报错)', () => {
    const s = noteDocToTree(unionDoc);
    const mm = toMermaidMindmap(s);
    expect(mm).toContain('主题');
    expect(mm).toContain('分支');
    // ⚠️ 公式表达不了 —— 这是**预期**,不是 bug
    expect(mm).not.toContain('mathInline');
    expect(mm).not.toContain('x^2+1');
  });
});

describe('⭐⭐ 推论③:view 写回只能改自己那部分', () => {
  it('⭐⭐ mermaid 导入不许删它表达不了的东西(正文)', () => {
    const prev = withG(noteDocToTree(unionDoc));
    // 用户在 mermaid tab 把「分支」改成「分支改名」
    const r = parseMermaidMindmap(['mindmap', '  root((主题))', '    分支改名'].join('\n'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const incoming = {
      s: { ...r.value, nodes: r.value.nodes.map((n, i) => ({ ...n, id: prev.s.nodes[i]?.id ?? n.id })) },
      g: prev.g,
    };

    const merged = mergeKeepingBodies(prev as never, incoming as never);
    const target = merged.s.nodes.find((n) => n.id === 'm002')!;

    // 它能表达的:标签改了 ✅
    expect(JSON.stringify(blocksOf(target)[0])).toContain('分支改名');
    // ⭐ 它表达不了的:正文原样保住 ✅
    expect(blocksOf(target).length, 'mermaid 把正文删了 —— 改一个字毁全图').toBe(2);
    expect(JSON.stringify(target.content)).toContain('mathInline');
  });

  it('⭐ mermaid 导入也不许动 G 层(那不是它的部分)', () => {
    const prev = withG(noteDocToTree(unionDoc));
    const r = parseMermaidMindmap(['mindmap', '  root((主题))', '    分支'].join('\n'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const merged = mergeKeepingBodies(prev as never, { s: r.value, g: prev.g } as never);
    expect(merged.g.get('m002')?.pos, 'G 层被语义导入动了').toEqual({ x: 42, y: 43 });
  });

  it('⚠️ 但**能**表达的照改:删掉一行就是删节点', () => {
    const prev = withG(noteDocToTree(unionDoc));
    const r = parseMermaidMindmap(['mindmap', '  root((主题))'].join('\n'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const merged = mergeKeepingBodies(prev as never, { s: r.value, g: prev.g } as never);
    expect(merged.s.nodes.length, '删节点是 mermaid 能表达的语义,必须尊重').toBe(1);
  });
});

describe('⚠️ 反面:派生物不进数据', () => {
  it('⭐ 层级数字不落库(由 parent 深度推出)', () => {
    const s = noteDocToTree(unionDoc);
    const file = snapshotToFile({ s, g: new Map() } as never);
    // S 层节点本身不带 level 字段(level 只出现在投影出的 block attrs 里)
    for (const n of s.nodes) {
      expect(Object.keys(n)).not.toContain('level');
      expect(Object.keys(n)).not.toContain('depth');
    }
    expect(file.semantic.length).toBeGreaterThan(0);
  });

  it('⭐⭐ G 层是**稀疏**的:没碰过的节点没有条目(不是全量存档)', () => {
    const snap = withG(noteDocToTree(unionDoc));
    const file = snapshotToFile(snap as never);
    const back = fileToSnapshot({
      format: detectMindFormat(file.semantic),
      semantic: file.semantic,
      graphic: file.graphic,
    });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    // 3 个节点,只有 1 个有 G 条目 —— 其余走自动布局
    expect(back.value.s.nodes.length).toBe(2);
    expect(back.value.g.size, 'G 层变成全量存档 = C5/C7 全废').toBe(1);
  });
});
