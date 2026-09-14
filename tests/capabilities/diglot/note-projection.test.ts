/**
 * KRIG 投影断言:树 ⇄ note block 序列(01 §5 第二列)
 *
 * ⭐ 规格 §4 明写两种投影**同构**:
 * KRIG 是「带 h 级别的 block 序列」,平文本是「带缩进的行序列」,推导规则唯一。
 * 本文件验这条同构真的成立。
 */
import { describe, it, expect } from 'vitest';
import {
  treeToNoteDoc,
  noteDocToTree,
  noteFormForDepth,
  depthForNoteForm,
  rootTitleOf,
} from '@capabilities/diglot-model/note-projection';
import { emptyMindFile, fileToSnapshot } from '@capabilities/diglot-model/mind-file';
import { contentToText } from '@capabilities/diglot-model/mermaid-mindmap';
import type { SLayer, SNode } from '@capabilities/diglot-model/types';

function asNode(form: { type: 'heading' | 'paragraph'; level?: number; indent?: number }) {
  return {
    type: form.type,
    attrs: {
      ...(form.level !== undefined ? { level: form.level } : {}),
      ...(form.indent !== undefined ? { indent: form.indent } : {}),
    },
  };
}

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

describe('⚠️ doc 信封必须带 version(真机踩过)', () => {
  it('⭐⭐ treeToNoteDoc 产出必须带 version:0.1', () => {
    // ⚠️ 真机实测:note tab **一片空白且不报错**。
    //   根因是 driver 的 deserializeDoc 对 `version !== '0.1'` **直接返 null**,
    //   编辑器拿到 null 就什么都不渲染 —— 典型的静默失败。
    //   ⭐ 这个字段在画布路径上不暴露(那条走 atomsToSvgInput 不经 deserialize),
    //   只有喂给 note 编辑器时才炸 ——「一条路没走过就没发现」。
    const s = snap();
    const doc = treeToNoteDoc(s.s);
    expect(doc.version, 'deserializeDoc 对 version !== 0.1 返 null(静默空白)').toBe('0.1');
    expect(doc.format).toBe('pm-doc-json');
  });

  it('⭐ 节点 content 信封也必须带 version(双击编辑要用)', () => {
    const s = snap();
    for (const n of s.s.nodes) {
      expect(n.content.version, `节点 ${n.id} 的 content 缺 version`).toBe('0.1');
    }
  });
});

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

describe('⭐⭐ 层级对应表(单一真源)', () => {
  it('深度 0~5 → h1~h6', () => {
    for (let d = 0; d < 6; d++) {
      expect(noteFormForDepth(d)).toEqual({ type: 'heading', level: d + 1 });
    }
  });

  it('⭐ h6 之后用 indent 递进(接上 note 既有缩进机制,不发明新东西)', () => {
    expect(noteFormForDepth(6)).toEqual({ type: 'paragraph', indent: 1 });
    expect(noteFormForDepth(7)).toEqual({ type: 'paragraph', indent: 2 });
    expect(noteFormForDepth(9)).toEqual({ type: 'paragraph', indent: 4 });
  });

  it('⭐⭐ 正逆向严格互逆 —— 「定义好对应关系,怎么变都对得上」', () => {
    for (let d = 0; d < 12; d++) {
      const form = noteFormForDepth(d);
      const back = depthForNoteForm({
        type: form.type,
        attrs: {
          ...(form.level !== undefined ? { level: form.level } : {}),
          ...(form.indent !== undefined ? { indent: form.indent } : {}),
        },
      });
      expect(back, `深度 ${d} 往返后应回到自己`).toBe(d);
    }
  });

  it('⭐ 层级越深级别数越大(不许倒挂)', () => {
    for (let d = 0; d < 11; d++) {
      expect(depthForNoteForm(asNode(noteFormForDepth(d)))).toBeLessThan(
        depthForNoteForm(asNode(noteFormForDepth(d + 1))),
      );
    }
  });
});

describe('⭐ 标题即 root(01 §3.4)', () => {
  it('root 的文字就是文档标题', () => {
    const s = snap();
    expect(rootTitleOf(s.s)).toBe('主题');
  });

  it('改 root 的文字 = 改标题(不是两份数据)', () => {
    const s = snap();
    const doc = treeToNoteDoc(s.s);
    const blocks = [...doc.payload.content] as Record<string, unknown>[];
    (blocks[0] as { content: unknown[] }).content = [{ type: 'text', text: '新标题' }];
    const t = noteDocToTree({ format: 'pm-doc-json', payload: { type: 'doc', content: blocks } });
    expect(rootTitleOf(t)).toBe('新标题');
  });

  it('⚠️ 没有 root / 标题为空 → null(调用侧据此保留原标题,不写空)', () => {
    expect(rootTitleOf({ nodes: [], edges: [], spans: [] })).toBeNull();
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

  it('⭐⭐ 拖块改顺序 → 树跟着变(note tab 的 ⋮⋮ handle 走这条路)', () => {
    const s = snap();
    const doc = treeToNoteDoc(s.s);
    const blocks = [...doc.payload.content] as Record<string, unknown>[];
    // 把最后一块(叶子3,h3)拖到第 2 位 —— 它的 h 级别没变,但前面的块变了
    const moved = blocks.splice(5, 1)[0];
    blocks.splice(1, 0, moved);

    const t = noteDocToTree({ format: 'pm-doc-json', payload: { type: 'doc', content: blocks } });
    const leaf3 = t.nodes.find((n) => contentToText(n.content) === '叶子3')!;
    const root = t.nodes.find((n) => n.role === 'root')!;
    // ⭐ 叶子3 现在紧跟 root(h1)之后,按 §4 规则 1 归到 root 之下
    expect(leaf3.parent, '拖块改变了父子关系').toBe(root.id);
    // 其余节点结构不受影响
    expect(t.nodes.find((n) => contentToText(n.content) === '叶子1')!.parent).toBe(
      t.nodes.find((n) => contentToText(n.content) === '分支A')!.id,
    );
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
