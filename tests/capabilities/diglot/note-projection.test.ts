/**
 * KRIG 投影断言:树 ⇄ note block 序列(01 §5 第二列)
 *
 * ⭐ 规格 §4 明写两种投影**同构**:
 * KRIG 是「带 h 级别的 block 序列」,平文本是「带缩进的行序列」,推导规则唯一。
 * 本文件验这条同构真的成立。
 */
import { describe, it, expect } from 'vitest';
import { treeToNoteDoc, noteDocToTree } from '@capabilities/diglot-model/note-projection';
import { emptyMindFile, fileToSnapshot } from '@capabilities/diglot-model/mind-file';
import { contentToText } from '@capabilities/diglot-model/mermaid-mindmap';
import type { SLayer, SNode } from '@capabilities/diglot-model/types';

function snap() {
  const r = fileToSnapshot(emptyMindFile());
  if (!r.ok) throw new Error('夹具失败');
  return r.value;
}

/** 树形状指纹:缩进大纲串(与 mermaid 侧同款判据)。 */
function outline(s: SLayer): string {
  const byParent = new Map<string, SNode[]>();
  for (const n of s.nodes) {
    const k = n.parent ?? ' root';
    const a = byParent.get(k);
    if (a) a.push(n);
    else byParent.set(k, [n]);
  }
  for (const a of byParent.values()) a.sort((x, y) => x.order.localeCompare(y.order));
  const out: string[] = [];
  const walk = (n: SNode, d: number): void => {
    out.push('  '.repeat(d) + contentToText(n.content));
    for (const c of byParent.get(n.id) ?? []) walk(c, d + 1);
  };
  for (const t of byParent.get(' root') ?? []) walk(t, 0);
  return out.join('\n');
}

describe('树 → note block 序列', () => {
  it('⭐ 层级用 h1~hn 表达(不是缩进)', () => {
    const s = snap();
    const doc = treeToNoteDoc(s.s);
    const blocks = doc.payload.content as { type: string; attrs?: { level?: number } }[];
    expect(blocks[0].type).toBe('heading');
    expect(blocks[0].attrs?.level, 'root = h1').toBe(1);
    expect(blocks[1].attrs?.level, '分支 = h2').toBe(2);
    expect(blocks[2].attrs?.level, '叶子 = h3').toBe(3);
  });

  it('⭐⭐ 每个 block 带稳定 id(债 6 的解)', () => {
    const s = snap();
    const doc = treeToNoteDoc(s.s);
    const blocks = doc.payload.content as { attrs?: { id?: string } }[];
    const ids = blocks.map((b) => b.attrs?.id);
    expect(ids.every((i) => typeof i === 'string' && i.length > 0)).toBe(true);
    expect(new Set(ids).size, 'id 不重复').toBe(ids.length);
    for (const n of s.s.nodes) expect(ids).toContain(n.id);
  });
});

describe('note block 序列 → 树', () => {
  it('⭐⭐ round-trip:树 → block → 树,形状一致', () => {
    const s = snap();
    const back = noteDocToTree(treeToNoteDoc(s.s));
    expect(outline(back)).toBe(outline(s.s));
  });

  it('⭐ id 原样保住(不重新分配)', () => {
    const s = snap();
    const back = noteDocToTree(treeToNoteDoc(s.s));
    const before = s.s.nodes.map((n) => n.id).sort();
    const after = back.nodes.map((n) => n.id).sort();
    expect(after).toEqual(before);
  });

  it('⭐⭐ 债 6 的解:中间插一块,其它块 id 不变', () => {
    const s = snap();
    const doc = treeToNoteDoc(s.s);
    const blocks = [...doc.payload.content] as {
      type: string;
      attrs?: Record<string, unknown>;
      content?: unknown[];
    }[];
    // 模拟用户在第 3 块后插了一块新的(没有 id —— 编辑器新建的块)
    blocks.splice(3, 0, {
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '插进来的' }],
    });
    const back = noteDocToTree({ format: 'pm-doc-json', payload: { type: 'doc', content: blocks } });

    // ⭐ 原有节点的 id 全部还在 —— 这正是 mermaid 侧做不到的
    for (const n of s.s.nodes) {
      expect(
        back.nodes.some((x) => x.id === n.id),
        `节点 ${n.id} 的 id 应保持不变`,
      ).toBe(true);
    }
    expect(back.nodes.length).toBe(s.s.nodes.length + 1);
  });

  it('⭐ 级别跳跃宽容解释(h1 下直接 h3 → 归就近父级)', () => {
    const doc = {
      format: 'pm-doc-json' as const,
      payload: {
        type: 'doc' as const,
        content: [
          { type: 'heading', attrs: { id: 'a', level: 1 }, content: [{ type: 'text', text: '顶' }] },
          {
            type: 'heading',
            attrs: { id: 'b', level: 3 },
            content: [{ type: 'text', text: '跳级' }],
          },
        ],
      },
    };
    const t = noteDocToTree(doc);
    expect(t.nodes.find((n) => n.id === 'b')!.parent, '归到就近父级 a').toBe('a');
  });

  it('⭐ 富内容原样保住(marks 不丢)', () => {
    const doc = {
      format: 'pm-doc-json' as const,
      payload: {
        type: 'doc' as const,
        content: [
          {
            type: 'heading',
            attrs: { id: 'a', level: 1 },
            content: [{ type: 'text', text: '粗', marks: [{ type: 'strong' }] }],
          },
        ],
      },
    };
    const t = noteDocToTree(doc);
    expect(JSON.stringify(t.nodes[0].content)).toContain('strong');
  });
});
