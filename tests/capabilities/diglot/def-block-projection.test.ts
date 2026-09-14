/**
 * M6 — def 块接进 mind:联系线存得住(步骤 4)
 *
 * ⭐⭐ 本轮的**全部意义**:`00 §2.5.1` 记的原始动因是「连线一存盘就没了」——
 * `treeToNoteDoc` 只吐 block 序列不碰 edges,`noteDocToTree` 反向硬写 `edges: []`。
 * ⭐ 与「正文存盘即丢」(`03 §5.6.1`)同一形态:**不是某层代码错,是存储格式装不下**。
 * 步骤 1 已把格式(def 块)造出来,本轮把它接上。
 *
 * ⚠️ **断言先于实现写**(写完看着它红,再动 note-projection)。
 *
 * ⚠️⚠️ 两条**已知会假绿**的样本设计(上一轮 6 条里有 2 条中招,探针实证):
 *  1. `role: floating` 若用「第二个顶层」当样本 —— 隐式规则本来就给 floating,
 *     def 块压根没被读也过。⭐ 故本文件让**首个顶层**写 `role: floating`
 *     (隐式说它是 root),**与隐式相反**才有区分力。
 *  2. 悬空引用若样本只有一条悬空行 —— `edges === []` 在解析器不存在时也成立。
 *     ⭐ 故本文件用**一真一悬空**:真边必须在、悬空必须丢,两个条件同时满足。
 */
import { describe, it, expect } from 'vitest';
import { noteDocToTree, treeToNoteDoc } from '@capabilities/diglot-model/note-projection';
import { snapshotToFile, fileToSnapshot } from '@capabilities/diglot-model/mind-file';
import { deterministicEdgeId } from '@capabilities/diglot-model/edge-id';
import type { SLayer } from '@capabilities/diglot-model/types';

const doc = (blocks: unknown[]): unknown => ({
  format: 'pm-doc-json',
  version: '0.1',
  payload: { type: 'doc', content: blocks },
});
const h = (level: number, id: string, text: string): unknown => ({
  type: 'heading',
  attrs: { level, id },
  content: [{ type: 'text', text }],
});
const p = (id: string, text: string): unknown => ({
  type: 'paragraph',
  attrs: { id },
  content: [{ type: 'text', text }],
});
/** def 块:`for` 默认 null(甲 —— 定义上一个块);传 for 走乙(定向绑定)。 */
const def = (id: string, text: string, forId: string | null = null): unknown => ({
  type: 'defBlock',
  attrs: { id, for: forId, open: false },
  content: text === '' ? undefined : [{ type: 'text', text }],
});

/** 某节点 content 信封里的块类型序列 */
const blockTypesOf = (n: { content: unknown }): string[] =>
  ((n.content as { payload: { content: { type: string }[] } }).payload.content ?? []).map(
    (b) => b.type,
  );
/** 某节点 content 的全部文本 */
const textOf = (n: { content: unknown }): string =>
  ((n.content as { payload: { content: { content?: { text?: string }[] }[] } }).payload.content ?? [])
    .map((b) => (b.content ?? []).map((c) => c.text ?? '').join(''))
    .join('\n');

// ────────────────────────────────────────────────────────────
// 1. ⭐⭐ 联系线存得住(本轮的全部意义)
// ────────────────────────────────────────────────────────────

describe('M6 · 联系线存得住', () => {
  const withEdge = doc([
    h(1, 'n1', '需求分析'),
    def('d1', 'id: A'),
    h(1, 'n2', '排期'),
    def('d2', 'id: C\nA -.支撑.-> C'),
  ]);

  it('⭐ 关系行 → s.edges(别名解析成真 NodeId)', () => {
    const s = noteDocToTree(withEdge);
    expect(s.edges).toHaveLength(1);
    expect(s.edges[0]).toMatchObject({ source: 'n1', target: 'n2', label: '支撑' });
  });

  it('⭐ 无标签写法 `A -.-> C` 同样造边(上一轮踩过的正则坑)', () => {
    const s = noteDocToTree(
      doc([h(1, 'n1', 'A 节点'), def('d1', 'id: A'), h(1, 'n2', 'C 节点'), def('d2', 'id: C\nA -.-> C')]),
    );
    expect(s.edges).toHaveLength(1);
    expect(s.edges[0].label).toBeUndefined();
  });

  it('⭐ 确定性 id:重复连同一对 = 覆盖非新增', () => {
    const s = noteDocToTree(
      doc([
        h(1, 'n1', 'A'),
        def('d1', 'id: A'),
        h(1, 'n2', 'C'),
        // ⚠️ 同一对端点写两次(用户手滑复制)—— 必须塌成一条,不是两条
        def('d2', 'id: C\nA -.支撑.-> C\nA -.支撑.-> C'),
      ]),
    );
    expect(s.edges).toHaveLength(1);
    expect(s.edges[0].id).toBe(deterministicEdgeId('n1', 'n2'));
  });

  it('⭐⭐ 存盘 → 读回,edges 不丢(这就是「存盘即丢」那个 bug 的正面断言)', () => {
    const s = noteDocToTree(withEdge);
    const file = snapshotToFile({ s, g: new Map() } as never);
    const parsed = fileToSnapshot(file);
    expect(parsed.ok).toBe(true);
    const back = (parsed as { value: { s: SLayer } }).value.s;
    expect(back.edges).toHaveLength(1);
    expect(back.edges[0]).toMatchObject({ source: 'n1', target: 'n2', label: '支撑' });
  });

  it('⭐ 二次存盘字节相同 + 关系仍在(幂等,不累积)', () => {
    // ⚠️ 探针实跑过再固化:「存一次能读回」不等于「反复存不出事」——
    //   边累积、字节漂移都要多存一轮才看得见。
    const s = noteDocToTree(withEdge);
    const f1 = snapshotToFile({ s, g: new Map() } as never);
    const r1 = fileToSnapshot(f1) as { ok: boolean; value: { s: SLayer } };
    const f2 = snapshotToFile({ s: r1.value.s, g: new Map() } as never);
    expect(f2.semantic).toBe(f1.semantic);
    const r2 = fileToSnapshot(f2) as { ok: boolean; value: { s: SLayer } };
    expect(r2.value.s.edges).toHaveLength(1);
  });

  it('⭐⭐ 画布主题框文字里**没有** def 内容(§1 那个显示错位的正面断言)', () => {
    const s = noteDocToTree(withEdge);
    const parsed = fileToSnapshot(snapshotToFile({ s, g: new Map() } as never));
    const back = (parsed as { value: { s: SLayer } }).value.s;
    const canvasText = back.nodes.map((n) => textOf(n)).join(' | ');
    expect(canvasText).toBe('需求分析 | 排期');
  });

  it('⭐ 关系可写在**任意**一个 def 块里(不必写在源节点下)', () => {
    // 00 §2.5.3「在任意一个 +++ 之内都可以做复杂的连线操作」——
    // 这条边写在 A 自己的块里,指向后面才出现的 C(前向引用)
    const s = noteDocToTree(
      doc([h(1, 'n1', 'A'), def('d1', 'id: A\nA -.-> C'), h(1, 'n2', 'C'), def('d2', 'id: C')]),
    );
    expect(s.edges).toHaveLength(1);
    expect(s.edges[0]).toMatchObject({ source: 'n1', target: 'n2' });
  });
});

// ────────────────────────────────────────────────────────────
// 2. ⭐ def 块不进正文(§1 那个显示错位)
// ────────────────────────────────────────────────────────────

describe('M6 · def 块摘出正文', () => {
  it('⭐⭐ def 块**不在**节点 content 里 —— 否则画布主题框会显示 `id: A`', () => {
    const s = noteDocToTree(doc([h(1, 'n1', '需求分析'), def('d1', 'id: A\nshape: 菱形')]));
    expect(s.nodes).toHaveLength(1);
    expect(blockTypesOf(s.nodes[0])).toEqual(['heading']);
    expect(textOf(s.nodes[0])).not.toContain('id: A');
    expect(textOf(s.nodes[0])).not.toContain('菱形');
  });

  it('⚠️ def 块**不自成节点**(它是定义,不是主题)', () => {
    const s = noteDocToTree(doc([h(1, 'n1', '甲'), def('d1', 'id: A'), h(1, 'n2', '乙')]));
    expect(s.nodes.map((n) => n.id)).toEqual(['n1', 'n2']);
  });

  it('⚠️ 真正的正文仍要并进来(别把 def 的处理误伤成「什么都不并」)', () => {
    const s = noteDocToTree(doc([h(1, 'n1', '主题'), def('d1', 'id: A'), p('p1', '这是正文')]));
    expect(blockTypesOf(s.nodes[0])).toEqual(['heading', 'paragraph']);
    expect(textOf(s.nodes[0])).toContain('这是正文');
    expect(textOf(s.nodes[0])).not.toContain('id: A');
  });
});

// ────────────────────────────────────────────────────────────
// 3. ⭐⭐ 往返逐字节收敛(01 §7.7.3)
// ────────────────────────────────────────────────────────────

describe('M6 · 往返逐字节收敛', () => {
  // ⚠️ 样本**必须含注释行 + 不认识的行**,否则「原样保留」验不出来
  const rich = doc([
    h(1, 'n1', '需求分析'),
    def('d1', 'id: A\n# 这行是注释\n随手写的一句话'),
    h(1, 'n2', '排期'),
    def('d2', 'id: C\nshape:菱形\nA -.支撑.-> C'), // ⚠️ 故意不加空格,不许顺手规范化
    p('p1', '正文一段'),
  ]);

  it('⭐⭐ doc → 树 → doc 逐字节一致(含注释行 / 不认识的行 / 非规范空格)', () => {
    const back = treeToNoteDoc(noteDocToTree(rich));
    expect(back.payload).toEqual((rich as { payload: unknown }).payload);
  });

  it('二次往返仍一致(幂等,不增殖)', () => {
    const once = treeToNoteDoc(noteDocToTree(rich));
    const twice = treeToNoteDoc(noteDocToTree(once));
    expect(twice.payload).toEqual(once.payload);
  });

  it('⚠️ 没有 def 块的老文档:行为**完全不变**(只增不改)', () => {
    const plain = doc([h(1, 'n1', '主题'), p('p1', '正文'), h(2, 'n2', '子题')]);
    const s = noteDocToTree(plain);
    expect(s.edges).toEqual([]);
    expect(s.nodes.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(treeToNoteDoc(s).payload).toEqual((plain as { payload: unknown }).payload);
  });

  it('⚠️ 无内容的节点**不 emit 空 def 块**(否则往返多出一段)', () => {
    const plain = doc([h(1, 'n1', '主题')]);
    const back = treeToNoteDoc(noteDocToTree(plain));
    const types = (back.payload.content as { type: string }[]).map((b) => b.type);
    expect(types).not.toContain('defBlock');
  });
});

// ────────────────────────────────────────────────────────────
// 4. ⭐ role: 显式优先(⚠️ 样本刻意与隐式相反)
// ────────────────────────────────────────────────────────────

describe('M6 · role: 显式优先', () => {
  it('⭐⭐ **首个顶层**写 `role: floating` → 真的是 floating(与隐式规则相反)', () => {
    // ⚠️⚠️ 假绿陷阱:若拿「第二个顶层」当样本,隐式规则本来就给 floating,
    //    def 块压根没被读也能过。这里用首个顶层 —— 隐式说它是 root。
    const s = noteDocToTree(doc([h(1, 'n1', '甲'), def('d1', 'id: A\nrole: floating'), h(1, 'n2', '乙')]));
    expect(s.nodes[0].role).toBe('floating');
  });

  it('⭐ 反向对照:同样位置**不写** role → 隐式规则给 root(证明上一条测的是 def 生效)', () => {
    const s = noteDocToTree(doc([h(1, 'n1', '甲'), def('d1', 'id: A'), h(1, 'n2', '乙')]));
    expect(s.nodes[0].role).toBe('root');
  });

  it('⚠️ 不写 role 的节点落隐式规则(向后兼容,老文档不受影响)', () => {
    const s = noteDocToTree(doc([h(1, 'n1', '甲'), h(1, 'n2', '乙')]));
    expect(s.nodes.map((n) => n.role)).toEqual(['root', 'floating']);
  });
});

// ────────────────────────────────────────────────────────────
// 5. ⭐ 悬空与冲突:方案丙(⚠️ 一真一悬空)
// ────────────────────────────────────────────────────────────

describe('M6 · 悬空引用(方案丙:保留原文 + 不造边)', () => {
  it('⭐⭐ 一真一悬空:真边必须在、悬空必须丢(两条同时成立才证明解析器在工作)', () => {
    // ⚠️⚠️ 假绿陷阱:若样本只有悬空行,`edges===[]` 在解析器不存在时也成立。
    const s = noteDocToTree(
      doc([
        h(1, 'n1', 'A'),
        def('d1', 'id: A'),
        h(1, 'n2', 'C'),
        def('d2', 'id: C\nA -.-> C\nA -.-> ZZZ'), // ZZZ 不存在
      ]),
    );
    expect(s.edges).toHaveLength(1); // 真边在
    expect(s.edges[0].target).toBe('n2'); // 且是那条真的
    expect(s.edges.some((e) => e.target === 'ZZZ')).toBe(false); // 悬空没造边
  });

  it('⚠️ 悬空行的**原文不删不改**(方案丙:保留原文,写回时还在)', () => {
    const src = doc([h(1, 'n1', 'A'), def('d1', 'id: A\nA -.-> ZZZ')]);
    const back = treeToNoteDoc(noteDocToTree(src));
    expect(JSON.stringify(back.payload)).toContain('A -.-> ZZZ');
  });

  it('⭐ 别名撞车自动加序号,不报错拒绝(00 §2.5.4)', () => {
    const s = noteDocToTree(
      doc([h(1, 'n1', '甲'), def('d1', 'id: A'), h(1, 'n2', '乙'), def('d2', 'id: A')]),
    );
    // 两个节点都在(不因撞车丢节点),且撞车那个拿到了区分后的别名
    expect(s.nodes).toHaveLength(2);
    // 撞车后 A 仍指向第一个;第二个别名变成 A2 —— 用它连线应指向 n2
    const s2 = noteDocToTree(
      doc([
        h(1, 'n1', '甲'),
        def('d1', 'id: A'),
        h(1, 'n2', '乙'),
        def('d2', 'id: A\nA -.-> A2'),
      ]),
    );
    expect(s2.edges).toHaveLength(1);
    expect(s2.edges[0]).toMatchObject({ source: 'n1', target: 'n2' });
  });
});

// ────────────────────────────────────────────────────────────
// 6. ⭐ attrs.for 定向绑定(乙)
// ────────────────────────────────────────────────────────────

describe('M6 · attrs.for(甲为主 + 乙可选)', () => {
  it('⭐ 甲:for=null → 定义**紧挨它前面那个块**', () => {
    const s = noteDocToTree(
      doc([h(1, 'n1', '甲'), h(1, 'n2', '乙'), def('d1', 'id: X'), h(1, 'n3', '丙'), def('d2', 'id: Y\nX -.-> Y')]),
    );
    // X 应绑到 n2(它前面那个),不是 n1
    expect(s.edges).toHaveLength(1);
    expect(s.edges[0]).toMatchObject({ source: 'n2', target: 'n3' });
  });

  it('⭐ 乙:for=<blockId> → 定向绑定到那个块,**不受位置影响**', () => {
    const s = noteDocToTree(
      doc([
        h(1, 'n1', '甲'),
        h(1, 'n2', '乙'),
        // ⚠️ 物理上跟在 n2 后面,但 for 指向 n1 —— 必须听 for 的
        def('d1', 'id: X', 'n1'),
        h(1, 'n3', '丙'),
        def('d2', 'id: Y\nX -.-> Y'),
      ]),
    );
    expect(s.edges).toHaveLength(1);
    expect(s.edges[0].source).toBe('n1');
  });

  it('⚠️ for 指向不存在的块 → 悬空处置(不造边、不报错、原文保留)', () => {
    const src = doc([h(1, 'n1', '甲'), def('d1', 'id: X\nX -.-> X', 'NOPE')]);
    const s = noteDocToTree(src);
    expect(s.nodes).toHaveLength(1); // 节点没丢
    expect(s.edges).toEqual([]); // 别名没绑上 → 不造边
    expect(JSON.stringify(treeToNoteDoc(s).payload)).toContain('X -.-> X'); // 原文还在
  });
});

// ────────────────────────────────────────────────────────────
// 5. ⭐ 别名可以用什么字符(用户 2026-09-13 问「任意字符和文字,对吗?」)
// ────────────────────────────────────────────────────────────

describe('M8 · 别名字符范围', () => {
  it('⭐ 中文别名可用 —— 关系行真造得出边', () => {
    const src = doc([
      h(1, 'n1', '需求'), def('d1', 'id: 需求分析'),
      h(1, 'n2', '排期'), def('d2', 'id: 排期\n需求分析 -.支撑.-> 排期'),
    ]);
    const s = noteDocToTree(src);
    expect(s.edges).toHaveLength(1);
    expect(s.edges[0]).toMatchObject({ source: 'n1', target: 'n2', label: '支撑' });
    // ⚠️ 中文别名也要逐字节往返(别被"顺手规范化")
    expect(treeToNoteDoc(s).payload).toEqual((src as { payload: unknown }).payload);
  });

  it('⭐ emoji / 连字符 / 点 / 冒号都能当别名', () => {
    for (const alias of ['🔥', 'node-1', 'a.b', 'x:y']) {
      const s = noteDocToTree(
        doc([
          h(1, 'n1', '甲'), def('d1', `id: ${alias}`),
          h(1, 'n2', '乙'), def('d2', `id: B\n${alias} -.-> B`),
        ]),
      );
      expect(s.edges, `别名 ${alias} 应能造边`).toHaveLength(1);
    }
  });

  it('⚠️⚠️ 别名带空格 → 关系行**静默不生效**(硬边界,记账用)', () => {
    // ⚠️ 这条**钉的是现状不是理想**:REL_RE 用 (\S+) 取端点,空格处断开。
    //   方案丙不报错 → 用户只看到「线没出来」。将来加引号语法时,这条要一并改。
    const src = doc([
      h(1, 'n1', '甲'), def('d1', 'id: 我的 节点'),
      h(1, 'n2', '乙'), def('d2', 'id: B\n我的 节点 -.-> B'),
    ]);
    const s = noteDocToTree(src);
    expect(s.edges).toEqual([]); // 不造边
    // ⭐ 但原文必须原样保留(方案丙:不删不改)
    expect(treeToNoteDoc(s).payload).toEqual((src as { payload: unknown }).payload);
  });

  it('⚠️ 带空格的别名在 `id:` 行**仍然认**(只是关系行用不了)', () => {
    const s = noteDocToTree(doc([h(1, 'n1', '甲'), def('d1', 'id: 我的 节点')]));
    // 节点还在、def 还在 —— 不是"整块作废"
    expect(s.nodes).toHaveLength(1);
    expect(s.nodes[0].defs).toBeDefined();
  });
});
