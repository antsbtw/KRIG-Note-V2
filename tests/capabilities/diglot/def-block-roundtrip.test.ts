/**
 * M6 —— def 块往返收敛(规格 `00 §2.5` 记法 / `01 §7.7` mind 词表)
 *
 * ⚠️⚠️ **本文件存在的理由(离线探针实测,非推理)**:联系线**存盘即丢**。
 * ```
 * 连线后 edges = [{id:"rel_n2_n3_...", source:"n2", target:"n3", label:"支撑"}]
 * 存盘产物里有 edges 吗 = false      ⭐ 就没了
 * 读回后 edges = []
 * ```
 * 真因:`snapshotToFile` 的 semantic 存的是 `JSON.stringify(treeToNoteDoc(s))`,
 * 而 `treeToNoteDoc` **只吐 block 序列不碰 edges**;`noteDocToTree` 反向
 * **硬写 `edges: []`**。⭐ 与 `03 §5.6.1`「正文存盘即丢」**同一形态** ——
 * 不是某层代码错,**是存储格式装不下**。
 *
 * ── 本文件钉住什么 ─────────────────────────────────────
 * 1. ⭐⭐ **联系线存得住**:连线 → 存盘 → 读回,edges 不丢
 * 2. ⭐⭐ **往返逐字节收敛**:doc → 树 → doc 与原 doc 一致
 *    ⚠️ 样本**必须含注释行与不认识的行** —— 否则「原样保留」验不出来
 * 3. `role: floating` 显式优先,不写则回落隐式规则(§7.7.7)
 * 4. ⚠️ def 块**不许**被当成正文并进节点(否则画布主题框显示 `id: B`)
 *
 * ⚠️ 往返不收敛是前两个坑(正文存盘即丢 `03 §5.6.1`、节点增殖 `03 §5.5.3`)
 * 的**共同根因**,所以这里必须逐字节比,不能只比"看起来对"。
 */
import { describe, it, expect } from 'vitest';
import { noteDocToTree, treeToNoteDoc } from '@capabilities/diglot-model/note-projection';
import type { SLayer } from '@capabilities/diglot-model/types';

interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
}

function doc(content: PmNode[]) {
  return { format: 'pm-doc-json', version: '0.1', payload: { type: 'doc', content } };
}
function h(id: string, level: number, text: string): PmNode {
  return { type: 'heading', attrs: { id, level }, content: [{ type: 'text', text }] };
}
/** def 块 = 普通 paragraph,首尾 `+++`,行间用 hardBreak(§2.5.2:零新块类型) */
function def(lines: string[]): PmNode {
  const all = ['+++', ...lines, '+++'];
  const content: PmNode[] = [];
  all.forEach((l, i) => {
    if (i > 0) content.push({ type: 'hardBreak' });
    if (l) content.push({ type: 'text', text: l });
  });
  return { type: 'paragraph', content };
}
const edgesOf = (s: SLayer) => s.edges.map((e) => `${e.source}->${e.target}${e.label ? `:${e.label}` : ''}`);

describe('M6 def 块往返收敛', () => {
  it('⭐⭐ 联系线存得住 —— 存盘再读回,edges 不丢', () => {
    const d = doc([
      h('root', 1, '主题'),
      h('n2', 2, '分支A'),
      def(['id: A']),
      h('n3', 2, '分支B'),
      def(['id: C', 'A -.支撑.-> C']),
    ]);

    const tree = noteDocToTree(d);
    expect(
      edgesOf(tree),
      '⚠️ 联系线没解析出来 —— def 块里的关系行被忽略了',
    ).toEqual(['n2->n3:支撑']);

    // 存盘 → 读回(snapshotToFile 存的就是 treeToNoteDoc 的结果)
    const saved = treeToNoteDoc(tree);
    const reloaded = noteDocToTree(saved);
    expect(
      edgesOf(reloaded),
      '⚠️⚠️ **存盘即丢** —— 这正是本文件要修的那个 bug',
    ).toEqual(['n2->n3:支撑']);
  });

  it('⭐⭐ 往返逐字节收敛 —— 含注释行与不认识的行', () => {
    const d = doc([
      h('root', 1, '主题'),
      h('n2', 2, '分支A'),
      // ⚠️ 注释行(⑤)与不认识的行(⑥)必须原样活着(`04 §0.6.3`)
      def(['id: A', 'shape: 菱形', '# 这是注释', '随手写的一句话']),
      h('n3', 2, '分支B'),
    ]);

    const back = treeToNoteDoc(noteDocToTree(d));
    expect(
      JSON.stringify(back),
      '⚠️ 往返不收敛 —— 前两个坑(正文存盘即丢/节点增殖)都是这么来的',
    ).toBe(JSON.stringify(d));
  });

  it('⭐ def 块不许被当成正文并进节点', () => {
    const d = doc([h('root', 1, '主题'), h('n2', 2, '分支A'), def(['id: A'])]);
    const tree = noteDocToTree(d);
    const n2 = tree.nodes.find((n) => n.id === 'n2');
    const body = JSON.stringify((n2?.content as { payload?: { content?: unknown[] } })?.payload?.content ?? []);
    expect(
      body.includes('+++') || body.includes('id: A'),
      '⚠️ def 块并进了正文 —— 画布主题框会显示 `id: A` 这种东西',
    ).toBe(false);
  });

  /**
   * ⚠️⚠️ 这条必须让**隐式规则给出相反答案**,否则它是假绿。
   * 踩过:第一版样本是「第二个顶层 + role: floating」——
   * 隐式规则(首个顶层=root,其余=floating)本来就给 floating,
   * ⭐ **def 块压根没被读,测试照样通过**(探针实证:节点数=2,def 被并进正文)。
   * 现改为**首个顶层**写 `role: floating`:隐式规则说它是 root,
   * 只有真读了 def 块才会是 floating —— 这样它才有区分力。
   */
  it('⭐⭐ role: 显式优先 —— 与隐式规则相反时以 def 为准(§7.7.7)', () => {
    const d = doc([h('n1', 1, '我是首个顶层'), def(['role: floating']), h('n2', 1, '第二个顶层')]);
    const tree = noteDocToTree(d);
    expect(
      tree.nodes.find((n) => n.id === 'n1')?.role,
      '⚠️ 首个顶层写了 role: floating 却仍是 root —— def 块的 role: 没被读',
    ).toBe('floating');
  });

  it('⭐ 不写 role 时回落隐式规则(首个顶层=root,其余=floating)', () => {
    const d = doc([h('root', 1, '主题'), h('n9', 1, '另一个想法')]);
    const tree = noteDocToTree(d);
    expect(tree.nodes.find((n) => n.id === 'root')?.role).toBe('root');
    expect(tree.nodes.find((n) => n.id === 'n9')?.role).toBe('floating');
  });

  /**
   * ⚠️ 同上:只写一条悬空行的话,`edges === []` 在**解析器还不存在**时也成立(假绿)。
   * ⭐ 故样本里放**一真一悬空**:真的那条必须解析出来,悬空的必须被丢弃 ——
   * 两个条件同时满足,才证明「解析器在工作,且它认得悬空」。
   */
  it('⚠️ 悬空引用:真边留下、悬空丢弃,且原文不删不改(§7.7.4 丙)', () => {
    const d = doc([
      h('root', 1, '主题'),
      h('n2', 2, '分支A'),
      def(['id: A']),
      h('n3', 2, '分支B'),
      def(['id: C', 'A -.-> C', 'A -.-> 不存在的别名']),
    ]);
    const tree = noteDocToTree(d);
    expect(
      edgesOf(tree),
      '⚠️ 真边要在、悬空边不许造出来',
    ).toEqual(['n2->n3']);
    // ⭐ 悬空行的**原文必须活着**(丙:保留原文,不删不改)
    expect(
      JSON.stringify(treeToNoteDoc(tree)),
      '⚠️ 悬空行被吃掉了 —— 方案丙要求保留原文',
    ).toContain('不存在的别名');
  });
});
