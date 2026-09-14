/**
 * ⭐⭐ hn 一致性校验(用户 2026-09-10 提出:「应该有一个校验方法,
 * 确保两个地方 hn 一致吗?」)
 *
 * 「两个地方」= 同一个 hn 有**两个独立来源**:
 *   ① note 里**写的** `heading.level`     —— noteDocToTree 据此建树
 *   ② 树里**算的** depth → noteFormForDepth —— treeToNoteDoc 据此回写
 *
 * ⚠️ 二者脱节时会**静默改写用户的字**:
 *   用户写 h1 → h3(跳级,note 里完全合法),回写变成 h1 → h2。
 *
 * ⭐ 本文件把「两个来源必须互逆」钉死,并覆盖跳级这种真实写法。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  noteDocToTree,
  treeToNoteDoc,
  noteFormForDepth,
  depthForNoteForm,
} from '@capabilities/diglot-model/note-projection';

const doc = (blocks: unknown[]): unknown => ({
  format: 'pm-doc-json', version: '0.1', payload: { type: 'doc', content: blocks },
});
const h = (level: number, id: string, text: string): unknown => ({
  type: 'heading', attrs: { level, id }, content: [{ type: 'text', text }],
});

/** 每个节点到 root 的深度 */
function depths(s: { nodes: { id: string; parent: string | null }[] }): Map<string, number> {
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  const out = new Map<string, number>();
  for (const n of s.nodes) {
    let d = 0;
    let c = n;
    while (c.parent) { d++; c = byId.get(c.parent)!; }
    out.set(n.id, d);
  }
  return out;
}

describe('hn 两个来源必须一致', () => {
  it('⭐⭐ 对照表严格互逆:noteFormForDepth ↔ depthForNoteForm', () => {
    for (let d = 0; d < 12; d++) {
      const form = noteFormForDepth(d);
      const back = depthForNoteForm({
        type: form.type,
        attrs: {
          ...(form.level !== undefined ? { level: form.level } : {}),
          ...(form.indent !== undefined ? { indent: form.indent } : {}),
        },
      });
      expect(back, `深度 ${d} 往返不互逆:${JSON.stringify(form)} → ${back}`).toBe(d);
    }
  });

  it('⭐⭐ 正常层级(不跳级):写的 level == 回写的 level', () => {
    const d0 = doc([h(1, 'a', '主题'), h(2, 'b', '分支'), h(3, 'c', '叶子')]);
    const s = noteDocToTree(d0);
    const back = treeToNoteDoc(s) as { payload: { content: { attrs?: { id?: string; level?: number } }[] } };
    expect(back.payload.content.map((x) => `${x.attrs?.id}:h${x.attrs?.level}`))
      .toEqual(['a:h1', 'b:h2', 'c:h3']);
  });

  it('⭐⭐ 每个节点的 level 必须 == 它的树深度推出来的 level', () => {
    const d0 = doc([h(1, 'a', '主题'), h(2, 'b', '分支'), h(3, 'c', '叶子'), h(2, 'd', '分支2')]);
    const s = noteDocToTree(d0);
    const dep = depths(s);
    const back = treeToNoteDoc(s) as { payload: { content: { attrs?: { id?: string; level?: number } }[] } };

    for (const b of back.payload.content) {
      const id = b.attrs?.id;
      if (!id) continue;
      const expected = noteFormForDepth(dep.get(id)!);
      expect(b.attrs?.level, `节点 ${id}:level 与树深度不一致`).toBe(expected.level);
    }
  });

  it('⚠️⚠️ 跳级(h1 → h3)会被规整成连续层级 —— 这是**已知且有意**的行为', () => {
    // note 里跳级完全合法,但导图的树没有"空层":h3 挂在 h1 下面,深度就是 1。
    // ⭐ 钉住它是为了**别让它悄悄变来变去** —— 现在的约定是「树深度说了算」。
    const s = noteDocToTree(doc([h(1, 'a', '主题'), h(3, 'b', '跳级')]));
    expect(depths(s).get('b'), '跳级节点的深度应为 1(直接挂在 root 下)').toBe(1);
    const back = treeToNoteDoc(s) as { payload: { content: { attrs?: { level?: number } }[] } };
    expect(back.payload.content[1].attrs?.level, '回写按深度 → h2').toBe(2);
  });

  it('⭐⭐ 规整是**幂等**的:再走一轮不会继续漂移', () => {
    const s1 = noteDocToTree(doc([h(1, 'a', '主题'), h(3, 'b', '跳级'), h(5, 'c', '再跳')]));
    const once = treeToNoteDoc(s1);
    const twice = treeToNoteDoc(noteDocToTree(once));
    expect(JSON.stringify(twice), '第二轮又变了 → 每次打开都在改用户的字').toBe(
      JSON.stringify(once),
    );
  });

  it('⭐ h6 之后走 paragraph+indent,深度仍然对得上', () => {
    const blocks = [h(1, 'n0', 'L0'), h(2, 'n1', 'L1'), h(3, 'n2', 'L2'),
                    h(4, 'n3', 'L3'), h(5, 'n4', 'L4'), h(6, 'n5', 'L5')];
    const s = noteDocToTree(doc(blocks));
    const dep = depths(s);
    expect(dep.get('n5')).toBe(5);
    // 深度 6 起是 paragraph + indent
    expect(noteFormForDepth(6)).toEqual({ type: 'paragraph', indent: 1 });
  });
});

/**
 * ⭐⭐ mermaid tab 显示的必须是 **mermaid**,不是 v1 的 JSON
 *
 * ⚠️ 真机踩过(用户:「这是乱码呀」):v1 把 semantic 改成 note doc JSON 之后,
 * mermaid tab 仍然直接显示 `snapshotToFile().semantic` → 满屏
 * `{"format":"pm-doc-json","version":"0.1",...}`。
 * **改了存法没改显示** —— 同一份数据两个消费者,只验了一个。
 */
describe('mermaid tab 显示', () => {
  const read = (p: string): string =>
    readFileSync(resolve(__dirname, '../../..', p), 'utf-8');

  it('⭐⭐ 语义面取 mermaid 投影,不直接用 semantic 字段', () => {
    const code = read('src/views/graph-canvas-view/MindSemanticPane.tsx')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');

    expect(code, 'mermaid tab 必须显示 mermaid 投影').toContain('diglot.toMermaidMindmap(snap.s)');
    expect(
      /semanticOf[\s\S]{0,200}snapshotToFile\(snap\)[\s\S]{0,40}semantic/.test(code),
      'semanticOf 又回到直接读 semantic → v1 下是 JSON 串,用户看到乱码',
    ).toBe(false);
  });
});
