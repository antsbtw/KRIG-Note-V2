/**
 * ⭐⭐ mermaid 导入不许删正文(规格 03 §5.6 硬约束)
 *
 * ⚠️ 用户口径:「大概率不会导出 mermaid 的代码,应该是 **mermaid 导入**的情况居多。」
 * 所以导入这条路必须扎实。
 *
 * ⚠️ 危险在于:mermaid 一个节点只有一行标签,解析结果**天然没有正文块**。
 * 若整份替换 S 层,用户「点进 mermaid tab 改一个字」就会把全图正文删光 ——
 * 静默毁数据,与 §7.3 variant 闸门同族。
 */
import { describe, it, expect } from 'vitest';
import { mergeKeepingBodies } from '@capabilities/diglot-model/apply-action';
import { noteDocToTree } from '@capabilities/diglot-model/note-projection';
import { parseMermaidMindmap } from '@capabilities/diglot-model/mermaid-mindmap';

const blocksOf = (n: { content: unknown }): unknown[] =>
  ((n.content as { payload: { content: unknown[] } }).payload.content ?? []);

/** 带正文的旧快照:root「主题」+ 子节点「分支A」(含公式正文) */
function richSnap() {
  const s = noteDocToTree({
    format: 'pm-doc-json', version: '0.1',
    payload: { type: 'doc', content: [
      { type: 'heading', attrs: { level: 1, id: 'n1' }, content: [{ type: 'text', text: '主题' }] },
      { type: 'heading', attrs: { level: 2, id: 'n2' }, content: [{ type: 'text', text: '分支A' }] },
      { type: 'paragraph', attrs: { id: 'b1' }, content: [{ type: 'mathInline', attrs: { latex: 'x^2+1' } }] },
    ] },
  });
  return { s, g: new Map() };
}

function fromMermaid(text: string) {
  const r = parseMermaidMindmap(text);
  if (!r.ok) throw new Error('夹具 mermaid 解析失败');
  return { s: r.value, g: new Map() };
}

describe('mermaid 导入保住正文', () => {
  it('⭐⭐ 同 id 节点的正文**接回来**(mermaid 没有正文 ≠ 用户要删正文)', () => {
    const old = richSnap();
    expect(blocksOf(old.s.nodes[1]).length, '夹具得真有正文').toBe(2);

    // mermaid 解析出的同结构(标签改了),但**没有正文块**
    const incoming = fromMermaid(['mindmap', '  root((主题))', '    分支A改名'].join('\n'));
    // 让 id 对齐(实际链路里 id 来自解析器按行序分配,这里手工对齐以隔离被测逻辑)
    const aligned = {
      ...incoming,
      s: { ...incoming.s, nodes: incoming.s.nodes.map((n, i) => ({ ...n, id: old.s.nodes[i]?.id ?? n.id })) },
    };

    const merged = mergeKeepingBodies(old, aligned);
    const target = merged.s.nodes.find((n) => n.id === 'n2')!;
    expect(blocksOf(target).length, 'mermaid 导入把正文删掉了').toBe(2);
    expect(JSON.stringify(target.content)).toContain('mathInline');
  });

  it('⭐ 标签仍以 mermaid 为准(导入的意义就是改结构/改标签)', () => {
    const old = richSnap();
    const incoming = fromMermaid(['mindmap', '  root((主题))', '    分支A改名'].join('\n'));
    const aligned = {
      ...incoming,
      s: { ...incoming.s, nodes: incoming.s.nodes.map((n, i) => ({ ...n, id: old.s.nodes[i]?.id ?? n.id })) },
    };
    const merged = mergeKeepingBodies(old, aligned);
    const target = merged.s.nodes.find((n) => n.id === 'n2')!;
    expect(JSON.stringify(blocksOf(target)[0])).toContain('分支A改名');
  });

  it('⚠️ 新增的节点没有旧正文可接 —— 不报错,就是没有', () => {
    const old = richSnap();
    const incoming = fromMermaid(['mindmap', '  root((主题))', '    分支A', '    全新节点'].join('\n'));
    const merged = mergeKeepingBodies(old, incoming);
    expect(merged.s.nodes.length).toBe(3);
  });

  it('⚠️ 删掉的节点**确实删掉**(合并不是"只增不减")', () => {
    const old = richSnap();
    const incoming = fromMermaid(['mindmap', '  root((主题))'].join('\n'));
    const merged = mergeKeepingBodies(old, incoming);
    expect(merged.s.nodes.length).toBe(1);
  });

  it('⭐ G 层原样带过去(导入语义不该动布局)', () => {
    const old = { ...richSnap(), g: new Map([['n2', { pos: { x: 42, y: 43 } }]]) };
    const incoming = fromMermaid(['mindmap', '  root((主题))', '    分支A'].join('\n'));
    const merged = mergeKeepingBodies(old as never, incoming);
    expect(merged.g.get('n2')).toEqual({ pos: { x: 42, y: 43 } });
  });
});
