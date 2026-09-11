/**
 * ⭐⭐ S 层改存 note doc(diglot-mind/v1),mermaid 降为导入/导出
 *
 * 规格 03 §5.6(用户 2026-09-10 拍板)。
 *
 * ⚠️ 起因是实测出来的**存盘即丢**:mermaid 的 mindmap 语法一个节点只有
 * 一行纯文本标签,装不下「节点 = 标题 + 正文」。内存里 2 块,存一次变 1 块。
 *
 * ⚠️ 这些断言**先于实现写**。
 */
import { describe, it, expect } from 'vitest';
import { fileToSnapshot, snapshotToFile, detectMindFormat, MIND_FILE_FORMAT } from '@capabilities/diglot-model/mind-file';
import { noteDocToTree } from '@capabilities/diglot-model/note-projection';

const richDoc = {
  format: 'pm-doc-json' as const,
  version: '0.1' as const,
  payload: {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1, id: 'h1' }, content: [{ type: 'text', text: '主题' }] },
      { type: 'heading', attrs: { level: 2, id: 'h2' }, content: [{ type: 'text', text: '主题2' }] },
      { type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'mathInline', attrs: { latex: 'x^2+1' } }] },
      { type: 'paragraph', attrs: { id: 'p2' }, content: [{ type: 'text', text: '正常了' }] },
    ],
  },
};

const blocksOf = (n: { content: unknown }): unknown[] =>
  ((n.content as { payload: { content: unknown[] } }).payload.content ?? []);

describe('mind 文件 v1:S 层存 note doc', () => {
  it('⭐⭐ 存盘再读回,节点正文**一块不少**(v0 的致命缺陷)', () => {
    const s = noteDocToTree(richDoc);
    const before = blocksOf(s.nodes[1]).length;
    expect(before, '夹具本身就该有正文,否则这条断言测了个寂寞').toBe(3);

    const file = snapshotToFile({ s, g: new Map() });
    const back = fileToSnapshot(file);
    expect(back.ok).toBe(true);
    if (!back.ok) return;

    const after = blocksOf(back.value.s.nodes[1]).length;
    expect(after, `存盘丢了内容:存前 ${before} 块 → 存后 ${after} 块`).toBe(before);
  });

  it('⭐⭐ 行内公式存盘后仍是 mathInline(不被拍平成文本/空串)', () => {
    const s = noteDocToTree(richDoc);
    const back = fileToSnapshot(snapshotToFile({ s, g: new Map() }));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const json = JSON.stringify(back.value.s.nodes[1].content);
    expect(json).toContain('mathInline');
    expect(json).toContain('x^2+1');
  });

  it('⭐ 标题层级(heading/level)存盘后还在 —— 字号靠它', () => {
    const s = noteDocToTree(richDoc);
    const back = fileToSnapshot(snapshotToFile({ s, g: new Map() }));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const head = blocksOf(back.value.s.nodes[1])[0] as { type: string; attrs?: { level?: number } };
    expect(head.type).toBe('heading');
    expect(head.attrs?.level).toBe(2);
  });

  it('⭐ 幂等:同一快照存两次字节相同(C1)', () => {
    const s = noteDocToTree(richDoc);
    const a = JSON.stringify(snapshotToFile({ s, g: new Map() }));
    const b = JSON.stringify(snapshotToFile({ s, g: new Map() }));
    expect(a).toBe(b);
  });

  it('⭐⭐ 旧档(v0,mermaid)仍能打开 —— 不能让既有导图打不开', () => {
    const v0 = {
      format: 'diglot-mind/v0',
      semantic: ['mindmap', '  root((主题))', '    分支A', '      叶子1'].join('\n'),
      graphic: '',
    };
    const r = fileToSnapshot(v0);
    expect(r.ok, 'v0 旧档必须还能读(用户已有文件)').toBe(true);
    if (!r.ok) return;
    expect(r.value.s.nodes.map((n) => n.id).length).toBe(3);
  });

  it('⚠️ 未知格式仍然 fail loud(不静默兜底)', () => {
    const r = fileToSnapshot({ format: 'diglot-mind/v99', semantic: '{}' });
    expect(r.ok).toBe(false);
  });

  it('⭐ 新文件写出来的是 v1', () => {
    const s = noteDocToTree(richDoc);
    expect(snapshotToFile({ s, g: new Map() }).format).toBe(MIND_FILE_FORMAT);
    expect(MIND_FILE_FORMAT).toBe('diglot-mind/v1');
  });
});

/**
 * ⭐⭐ 加载时的版本判定
 *
 * ⚠️ `mind_doc` 表**不存 format**(只有 semantic/graphic 两段文本,
 * mind-store 实测:存了读回来是 undefined)。加载时写死任一版本,
 * 另一版本的文件就打不开 —— v1 上线后若还写死 v0,**所有新存的图都加载失败**。
 */
describe('加载:从内容判断格式版本', () => {
  it('⭐⭐ note doc JSON 判为 v1', () => {
    const s = noteDocToTree(richDoc);
    const file = snapshotToFile({ s, g: new Map() });
    expect(detectMindFormat(file.semantic)).toBe('diglot-mind/v1');
  });

  it('⭐⭐ mermaid 文本判为 v0(旧档)', () => {
    expect(detectMindFormat('mindmap\n  root((主题))')).toBe('diglot-mind/v0');
  });

  it('⚠️ 前导空白不影响判定', () => {
    expect(detectMindFormat('\n  {"format":"pm-doc-json"}')).toBe('diglot-mind/v1');
    expect(detectMindFormat('\n\nmindmap\n  root((x))')).toBe('diglot-mind/v0');
  });

  it('⭐⭐ 端到端:存 v1 → 按判定结果读回 → 正文还在', () => {
    const s = noteDocToTree(richDoc);
    const file = snapshotToFile({ s, g: new Map() });
    // 模拟 mind_doc:只留两段文本,format 丢掉
    const back = fileToSnapshot({
      format: detectMindFormat(file.semantic),
      semantic: file.semantic,
      graphic: file.graphic,
    });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(JSON.stringify(back.value.s.nodes[1].content)).toContain('mathInline');
  });
});
