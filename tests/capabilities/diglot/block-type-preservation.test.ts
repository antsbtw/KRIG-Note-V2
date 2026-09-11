/**
 * ⭐⭐ 非 heading/paragraph 的块**不许被吞掉**(真机踩过:公式一变成块级就没了)
 *
 * ⚠️ 真机日志铁证:
 *   treeCommit 收到 heading,heading,**paragraph**,... → 存盘 含 paragraph= true (693)
 *   treeCommit 收到 heading,heading,**mathBlock**,... → 存盘 含 paragraph= false(628,退回模板)
 * 用户把正文变成块级公式,`noteDocToTree` 的 filter 只认 heading/paragraph,
 * **mathBlock 被静默丢弃** —— 用户的内容当场消失。
 *
 * ⭐ 这正违反分区原则推论③:「不认识的一律原样保留」。
 * 渲染层 RENDERABLE_ATOM_TYPES 有 13 种块,投影只认 2 种 —— 其余全会丢。
 */
import { describe, it, expect } from 'vitest';
import { noteDocToTree, treeToNoteDoc } from '@capabilities/diglot-model/note-projection';

const doc = (blocks: unknown[]): unknown => ({
  format: 'pm-doc-json', version: '0.1', payload: { type: 'doc', content: blocks },
});
const h = (level: number, id: string, text: string): unknown => ({
  type: 'heading', attrs: { level, id }, content: [{ type: 'text', text }],
});
const blocksOf = (n: { content: unknown }): unknown[] =>
  ((n.content as { payload: { content: unknown[] } }).payload.content ?? []);

describe('块类型保全', () => {
  it('⭐⭐ mathBlock 并入上一个节点,不被丢弃(真机丢数据的那一条)', () => {
    const s = noteDocToTree(doc([
      h(1, 'root', '主题'),
      h(2, 'm002', '分支A'),
      { type: 'mathBlock', attrs: { id: 'b1' }, content: [{ type: 'text', text: 'x^2+1' }] },
    ]));
    const target = s.nodes.find((n) => n.id === 'm002')!;
    expect(blocksOf(target).length, 'mathBlock 被吞了 —— 用户内容消失').toBe(2);
    expect(JSON.stringify(target.content)).toContain('mathBlock');
  });

  it('⭐ 其它渲染得出来的块同样不许丢(codeBlock / 列表 / 引用 / callout)', () => {
    for (const type of ['codeBlock', 'bulletList', 'orderedList', 'blockquote', 'callout']) {
      const s = noteDocToTree(doc([
        h(1, 'root', '主题'),
        { type, attrs: { id: 'b1' }, content: [{ type: 'text', text: '内容' }] },
      ]));
      const root = s.nodes.find((n) => n.id === 'root')!;
      expect(blocksOf(root).length, `${type} 被吞了`).toBe(2);
    }
  });

  it('⭐⭐ 往返后块类型**原样保住**(不能被改写成 paragraph)', () => {
    const s = noteDocToTree(doc([
      h(1, 'root', '主题'),
      { type: 'mathBlock', attrs: { id: 'b1' }, content: [{ type: 'text', text: 'x^2+1' }] },
    ]));
    const back = treeToNoteDoc(s) as { payload: { content: { type: string }[] } };
    expect(back.payload.content.map((b) => b.type)).toEqual(['heading', 'mathBlock']);
  });

  it('⚠️ 带 indent 的 paragraph 仍是层级(不被当正文吞掉)', () => {
    const s = noteDocToTree(doc([
      h(1, 'root', '主题'),
      { type: 'paragraph', attrs: { id: 'p1', indent: 1 }, content: [{ type: 'text', text: '第七层' }] },
    ]));
    expect(s.nodes.map((n) => n.id)).toEqual(['root', 'p1']);
  });

  it('⭐ 文档以非 heading 块开头 → 自成节点(内容不许凭空消失)', () => {
    const s = noteDocToTree(doc([
      { type: 'mathBlock', attrs: { id: 'b1' }, content: [{ type: 'text', text: 'x^2' }] },
    ]));
    expect(s.nodes.length).toBe(1);
    expect(JSON.stringify(s.nodes[0].content)).toContain('mathBlock');
  });
});

/**
 * ⚠️⚠️ 正文块携带 indent 的情形 —— 往返收敛的最后一道缝
 *
 * ⭐ 注意:**普通 paragraph 带 indent 会开新节点**(那是 h6 之后的层级表达),
 * 所以它走不到「正文 emit」那条路。真正能走到的是**非 paragraph 的块**
 * (mathBlock/codeBlock…)—— 它们无论带不带 indent 都并入上一个节点。
 *
 * ⚠️ 若反向 emit 时把 indent 原样带出去,正向就会把它读成层级 →
 * 节点一轮轮增殖、往返不收敛。
 */
describe('正文块的 indent 不许外泄', () => {
  it('⭐⭐ 带 indent 的 mathBlock:回写时 indent 必须被剥掉', () => {
    const s = noteDocToTree(doc([
      h(1, 'root', '主题'),
      { type: 'mathBlock', attrs: { id: 'b1', indent: 2 }, content: [{ type: 'text', text: 'x^2' }] },
    ]));
    // 它是正文(并入 root),不是层级
    expect(s.nodes.map((n) => n.id)).toEqual(['root']);

    const out = treeToNoteDoc(s) as {
      payload: { content: { type: string; attrs?: { indent?: number } }[] };
    };
    const body = out.payload.content[1];
    expect(body.type).toBe('mathBlock');
    expect(body.attrs?.indent, 'indent 外泄 → 正向会读成层级 → 往返不收敛').toBeUndefined();
  });

  it('⭐⭐ 走两轮仍不增殖(彻底收敛)', () => {
    const d0 = doc([
      h(1, 'root', '主题'),
      { type: 'mathBlock', attrs: { id: 'b1', indent: 2 }, content: [{ type: 'text', text: 'x^2' }] },
      h(2, 'm2', '分支'),
    ]);
    const s1 = noteDocToTree(d0);
    const s2 = noteDocToTree(treeToNoteDoc(s1));
    const s3 = noteDocToTree(treeToNoteDoc(s2));
    expect(s2.nodes.map((n) => n.id)).toEqual(s1.nodes.map((n) => n.id));
    expect(s3.nodes.map((n) => n.id)).toEqual(s1.nodes.map((n) => n.id));
  });
});
