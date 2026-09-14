/**
 * Diglot 不变量断言 —— C1–C9(通用)+ M1–M5(mind 专属)
 *
 * ⭐ 规格原话:「**九条断言即九个 CI 测试用例,先于任何交互代码存在**」
 * (00-diglot-core.md §8)。本文件即此。
 *
 * ⚠️⚠️ **本文件当前大面积为红,这是设计使然,不是坏了。**
 * 引擎(`DiglotEngine`)尚未实现,`notImplementedEngine` 每个方法 fail loud,
 * 撞上即红。**红是步骤③-⑤的验收闸门** —— 实现落地后自动转绿,**不需要改测试**。
 * ⭐ 改测试让它绿 = 违规(HANDOFF §4)。
 *
 * ⭐⭐ **本文件的核心纪律(HANDOFF §5)**:
 * > 双向同步的测试极易自证。「拖动后 G 层多了一条」——
 * > 如果同步引擎根本没跑,而测试自己写了那条,**也会绿**。
 *
 * 因此:**测试只发 `DiglotAction`,绝不自己写模型。**
 * 每条断言的期望值一律引用 `LANDING_MATRIX`(规格同源),
 * 不在测试里另抄一份 —— 抄一份就会漂移,漂移了就守不住。
 *
 * 自检问句:**「如果被测逻辑是错的,这条断言还会成立吗?」**
 */
import { describe, it, expect } from 'vitest';
import {
  notImplementedEngine as engine,
  type DiglotSnapshot,
  type DiglotAction,
} from '@capabilities/diglot-model/engine-contract';
import { wrapGLayer } from '@capabilities/diglot-model/g-layer';
import {
  LANDING_MATRIX,
  type GEntry,
  type NodeId,
  type SLayer,
} from '@capabilities/diglot-model/types';

// ─────────────────────────────────────────────────────────
// 夹具 —— ⚠️ 只造**输入**,绝不造**期望的输出**
// ─────────────────────────────────────────────────────────

/** 最小 mermaid mindmap 样本(仓库既有模板,mermaid-renderer.ts MERMAID_TEMPLATES)。 */
const MERMAID_SAMPLE = [
  'mindmap',
  '  root((主题))',
  '    分支A',
  '      叶子1',
  '      叶子2',
  '    分支B',
  '      叶子3',
].join('\n');

/**
 * ⚠️ 夹具经**引擎**产出,不是手写的模型。
 * 手写模型 = 测试自己布置条件,对缺陷零区分力。
 */
function freshSnapshot(): DiglotSnapshot {
  const parsed = engine.parseMermaidMindmap(MERMAID_SAMPLE);
  if (!parsed.ok) throw new Error(`夹具解析失败:${JSON.stringify(parsed.errors)}`);
  // ⭐ 新解析出的图:G 层必须为空(C5 稀疏纪律的起点)
  return { s: parsed.value, g: new Map() };
}

/** 取一个非根节点 id(供拖动/改名等动作用)。 */
function someBranchId(s: SLayer): NodeId {
  const n = s.nodes.find((x) => x.role === 'branch' && x.parent !== null);
  if (!n) throw new Error('夹具里没有可用的 branch 节点');
  return n.id;
}

/** S 层内容指纹 —— 用于断言「S 层零变更」。 */
function sFingerprint(s: SLayer): string {
  return JSON.stringify({
    nodes: [...s.nodes]
      .map((n) => ({ id: n.id, parent: n.parent, order: n.order, role: n.role, content: n.content, labels: n.labels, markers: n.markers }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...s.edges].map((e) => ({ ...e })).sort((a, b) => a.id.localeCompare(b.id)),
    spans: [...s.spans].map((p) => ({ ...p })).sort((a, b) => a.id.localeCompare(b.id)),
  });
}

/**
 * ⭐⭐ 树形状指纹 —— **把父子嵌套与标签一起编码成缩进大纲串**。
 *
 * ⚠️ 为什么必须这样比:初版几条断言比的是
 * `nodes.map(n => n.order).sort()`(order 的多重集合)、
 * `{parentIsNull, role}`(布尔+角色)—— **都与 parent 指向谁无关**,
 * 把树推导彻底改坏(每个节点都挂到前一个)后**照样全绿**(实测)。
 * 形态 = HANDOFF §5「断言成立的原因不是被测逻辑对」。
 */
function treeOutline(s: SLayer, labelOf: (n: SLayer['nodes'][number]) => string): string {
  const byParent = new Map<string, SLayer['nodes'][number][]>();
  for (const n of s.nodes) {
    const k = n.parent ?? '\u0000root';
    const arr = byParent.get(k);
    if (arr) arr.push(n); else byParent.set(k, [n]);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.order.localeCompare(b.order));
  const out: string[] = [];
  const walk = (n: SLayer['nodes'][number], depth: number): void => {
    out.push(`${'  '.repeat(depth)}${labelOf(n)}`);
    for (const c of byParent.get(n.id) ?? []) walk(c, depth + 1);
  };
  for (const top of byParent.get('\u0000root') ?? []) walk(top, 0);
  return out.join('\n');
}

/** 从内容信封取首段文本(与解析器同一形态,测试侧只读不写)。 */
function labelText(n: SLayer['nodes'][number]): string {
  const payload = n.content.payload as { content?: { content?: { text?: string }[] }[] } | undefined;
  return (payload?.content?.[0]?.content ?? []).map((r) => r.text ?? '').join('');
}

/** G 层指纹。 */
function gFingerprint(g: ReadonlyMap<string, GEntry>): string {
  return JSON.stringify([...g.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

/** 发一个动作,回报三面各变了多少 —— ⭐ 变更量由**比对前后快照**得出,不是测试声称的。 */
function landingOf(before: DiglotSnapshot, action: DiglotAction) {
  const after = engine.applyAction(before, action);
  const sChanged = sFingerprint(before.s) !== sFingerprint(after.s);
  const gKeysBefore = new Set(before.g.keys());
  const gKeysAfter = new Set(after.g.keys());
  let gTouched = 0;
  for (const k of new Set([...gKeysBefore, ...gKeysAfter])) {
    const b = before.g.get(k);
    const a = after.g.get(k);
    if (JSON.stringify(b ?? null) !== JSON.stringify(a ?? null)) gTouched++;
  }
  return { after, sChanged, gTouched };
}

// ═════════════════════════════════════════════════════════
// C 类:通用不变量(00 §8)—— 两个图种都要验
// ═════════════════════════════════════════════════════════

describe('C1 规范化幂等 —— G 层规范形二次序列化字节级不变', () => {
  it('对规范形再序列化,字节完全相同', () => {
    const g = new Map<string, GEntry>([
      ['arch', { pos: { x: 420, y: 180 } }],
      ['root', { structure: 'logic' }],
    ]);
    const once = engine.serializeGLayer(g);
    const reparsed = engine.parseGLayer(once);
    expect(reparsed.ok, 'G 层规范形必须能被自己解析回来').toBe(true);
    if (!reparsed.ok) return;
    const twice = engine.serializeGLayer(reparsed.value);
    // ⭐ 字节级 —— 不是「结构相等」,是同一个字符串
    expect(twice).toBe(once);
  });

  it('乱序 / 多余空白的输入 → 规范化后与整齐输入产出同一字节', () => {
    // ⭐ 体验类比 terraform fmt:随手写,松手变整齐(00 §3)
    const messy = '^root   structure=logic\n^arch pos=420,180\n';
    const tidy = '^arch pos=420,180\n^root structure=logic\n';
    const a = engine.parseGLayer(messy);
    const b = engine.parseGLayer(tidy);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(engine.serializeGLayer(a.value)).toBe(engine.serializeGLayer(b.value));
  });

  it('⭐ 不写缺省值(稀疏纪律:缺席即 auto)', () => {
    const empty = engine.serializeGLayer(new Map());
    // 空 G 层不得产出任何条目行(可以有包裹/空串,但不得凭空写 auto 值)
    expect(empty.includes('auto')).toBe(false);
    expect(empty.trim().split('\n').filter((l) => l.trim().startsWith('^')).length).toBe(0);
  });

  it('⭐⭐ 有条目时也不得补写未触碰的属性', () => {
    // ⚠️ 上一条只喂**空 map**,根本走不到「逐条属性」那段代码 ——
    //   注入「color 缺省写成 auto」后它照样绿(实测),因为空 map 没有条目。
    //   形态 = HANDOFF §5「样本里根本没有该现象」。
    //   故必须喂**只碰了一个属性**的条目,验其余属性一个都不冒出来。
    const g = new Map<string, GEntry>([['solo', { pos: { x: 1, y: 2 } }]]);
    const out = engine.serializeGLayer(g);
    expect(out).toContain('pos=1,2');
    // 只碰了 pos,其余键一个都不许出现
    for (const absent of ['color', 'shape', 'structure', 'collapsed', 'float']) {
      expect(out, `未触碰的 ${absent} 不得被写出(稀疏纪律)`).not.toContain(absent);
    }
    // ⚠️ 且不许出现 auto 这类缺省占位
    expect(out).not.toContain('auto');
  });

  it('⭐ 条目内属性键按固定序输出(00 §4:canonical 键名固定序)', () => {
    // ⚠️ 规范形要求「条目内属性键按固定序」,但前几条断言**都没验键序** ——
    //   把键序改成跟着对象自身键序走(不稳定),它们照样全绿(实测)。
    //   两个属性集相同、插入顺序不同的条目,必须序列化成**同一字节**。
    const a = new Map<string, GEntry>([
      ['x', { collapsed: true, color: 'red', pos: { x: 1, y: 2 } }],
    ]);
    const b = new Map<string, GEntry>([
      ['x', { pos: { x: 1, y: 2 }, color: 'red', collapsed: true }],
    ]);
    expect(engine.serializeGLayer(b), '键的书写顺序不得影响规范形').toBe(
      engine.serializeGLayer(a),
    );
    // 且顺序必须是规格定的那个(pos 在 color 前,collapsed 在最后)
    const out = engine.serializeGLayer(a);
    expect(out.indexOf('pos=')).toBeLessThan(out.indexOf('color='));
    expect(out.indexOf('color=')).toBeLessThan(out.indexOf('collapsed'));
  });

  it('⭐ 零属性的条目整条不输出', () => {
    // 一个 id 若没有任何被触碰的属性,它根本不该存在于 G 层(C5 的地基)
    const g = new Map<string, GEntry>([['ghost', {}]]);
    expect(engine.serializeGLayer(g).trim()).toBe('');
  });

  it('⭐ HTML 注释包裹:Markdown 环境渲染为干净大纲(00 §4)', () => {
    const g = new Map<string, GEntry>([['arch', { pos: { x: 420, y: 180 } }]]);
    const wrapped = wrapGLayer(engine.serializeGLayer(g));
    expect(wrapped.startsWith('<!-- diglot')).toBe(true);
    expect(wrapped.trimEnd().endsWith('-->')).toBe(true);
    // ⭐ 包裹后仍能解回来,且幂等
    const back = engine.parseGLayer(wrapped);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(engine.serializeGLayer(back.value)).toBe(engine.serializeGLayer(g));
  });

  it('⭐ 空 G 层不写空壳注释(稀疏纪律)', () => {
    // 没条目就是没内容 —— 不许留一个空的 <!-- diglot --> 壳子
    expect(wrapGLayer(engine.serializeGLayer(new Map()))).toBe('');
  });

  it('⭐ 中英别名在输入层互通,序列化一律写 canonical(00 §4)', () => {
    const r = engine.parseGLayer('^a structure=逻辑图\n^b structure=LOGIC\n');
    expect(r.ok, '别名不是坏行').toBe(true);
    if (!r.ok) return;
    const out = engine.serializeGLayer(r.value);
    // ⚠️ 若序列化把别名原样吐回,C1 幂等就不成立(同一语义两种字节)
    expect(out).toBe('^a structure=logic\n^b structure=logic\n');
    expect(out).not.toContain('逻辑图');
  });
});

describe('C2 双射 —— 同一张图经任何编辑路径到达,序列化结果一致', () => {
  it('两条不同编辑路径抵达同一状态 → G 层字节相同', () => {
    const base = freshSnapshot();
    const id = someBranchId(base.s);
    // 路径 1:先拖到 (100,200),再改色
    const p1a = engine.applyAction(base, { kind: 'canvas.dragNode', id, x: 100, y: 200 });
    const p1 = engine.applyAction(p1a, { kind: 'graphic.editColor', id, color: 'red' });
    // 路径 2:先改色,再拖到同一坐标
    const p2a = engine.applyAction(base, { kind: 'graphic.editColor', id, color: 'red' });
    const p2 = engine.applyAction(p2a, { kind: 'canvas.dragNode', id, x: 100, y: 200 });
    expect(engine.serializeGLayer(p1.g)).toBe(engine.serializeGLayer(p2.g));
    expect(sFingerprint(p1.s)).toBe(sFingerprint(p2.s));
  });
});

describe('C3 语义编辑最小性 —— 改一个标签仅一处 update,且全部 pos 存活', () => {
  it('改标签 → S 一处变更、G 零变更', () => {
    const base = freshSnapshot();
    const id = someBranchId(base.s);
    const { sChanged, gTouched } = landingOf(base, { kind: 'semantic.editLabel', id, text: '新标签' });
    expect(sChanged).toBe(true);
    // ⭐ 期望值引用规格表,不在测试里另抄
    expect(gTouched, `LANDING_MATRIX 承诺 g=${LANDING_MATRIX['semantic.editLabel'].g}`).toBe(0);
  });

  it('⭐ 改标签后,已存在的 pos 条目全部存活(id 配对,绝不删旧建新)', () => {
    const base = freshSnapshot();
    const id = someBranchId(base.s);
    // 先钉住坐标(经引擎,不是手写 G 层)
    const pinned = engine.applyAction(base, { kind: 'canvas.dragNode', id, x: 42, y: 43 });
    const before = gFingerprint(pinned.g);
    const after = engine.applyAction(pinned, { kind: 'semantic.editLabel', id, text: '改名了' });
    expect(gFingerprint(after.g), 'pos 必须原样存活').toBe(before);

    // ⚠️⚠️ 只验 G 层不变**不够** —— 「删旧建新」换的是 **S 层的 id**,
    //   G 层原样躺着反而更像没事,实则那条 pos 成了**指向不存在节点的孤儿**。
    //   注入「改名时换 id」后本条曾照样绿(实测)。
    //   ⭐ id 是四面唯一 join 键,C3 要求的是**id 配对**,故必须验:
    //   (1) 该 id 仍在 S 层;(2) G 层每个 key 都能在 S 层找到对应节点。
    expect(after.s.nodes.some((n) => n.id === id), '改名不得换 id(绝不删旧建新)').toBe(true);
    const liveIds = new Set(after.s.nodes.map((n) => n.id));
    for (const key of after.g.keys()) {
      expect(liveIds.has(key), `G 条目 ${key} 成了孤儿 —— 没有对应的 S 层节点`).toBe(true);
    }
  });
});

describe('C4 图形编辑分层落笔 —— 画布拖动仅 G 层一条,S 层零变更', () => {
  it('拖动节点 → S 零变更、G 恰好一条', () => {
    const base = freshSnapshot();
    const id = someBranchId(base.s);
    const { sChanged, gTouched } = landingOf(base, { kind: 'canvas.dragNode', id, x: 300, y: 400 });
    // ⚠️ 这是本轮最易自证的一条 —— 变更量由前后快照比对得出,
    //    测试自己没有写过任何 G 条目。
    expect(sChanged, `LANDING_MATRIX 承诺 s=${LANDING_MATRIX['canvas.dragNode'].s}`).toBe(false);
    expect(gTouched, `LANDING_MATRIX 承诺 g=${LANDING_MATRIX['canvas.dragNode'].g}`).toBe(1);
  });

  it('拖动写入的坐标必须量化为整数(00 §4 杜绝浮点噪声)', () => {
    const base = freshSnapshot();
    const id = someBranchId(base.s);
    const after = engine.applyAction(base, { kind: 'canvas.dragNode', id, x: 12.7, y: -3.2 });
    const entry = after.g.get(id);
    expect(entry?.pos).toBeDefined();
    expect(Number.isInteger(entry!.pos!.x), `x=${entry!.pos!.x} 必须是整数`).toBe(true);
    expect(Number.isInteger(entry!.pos!.y), `y=${entry!.pos!.y} 必须是整数`).toBe(true);
  });
});

describe('C5 缺省即自动 —— 画布新建节点:S 一处插入,G 零条目', () => {
  it('新建节点 → G 层不得凭空多出该 id 的条目', () => {
    const base = freshSnapshot();
    const rootId = base.s.nodes.find((n) => n.role === 'root')?.id ?? null;
    const before = base.g.size;
    const after = engine.applyAction(base, { kind: 'canvas.createNode', parent: rootId, text: '新节点' });
    expect(after.s.nodes.length).toBe(base.s.nodes.length + 1);
    // ⭐ 这条是「G 层是稀疏覆盖层,不是画布状态存档」的试金石:
    //    若把 G 层当画布存档,新建必然要写一条 pos → 此处红。
    expect(after.g.size, `LANDING_MATRIX 承诺 g=${LANDING_MATRIX['canvas.createNode'].g}`).toBe(before);
  });
});

describe('C6 错误隔离 —— 坏语法/坏行不污染模型,错误定位到行', () => {
  it('G 层坏行 → ok:false 且不返回半个模型', () => {
    const r = engine.parseGLayer('^good pos=1,2\n这行不是合法条目\n^also pos=3,4\n');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBeGreaterThan(0);
    // ⚠️ 必须定位到**行**,不是笼统报错
    expect(r.errors[0].line).toBe(2);
    // ⚠️ fail loud:不许返回「解析了一半」的模型让调用侧误用
    expect('value' in r).toBe(false);
  });

  it('mermaid 坏语法 → ok:false,不产出半棵树', () => {
    const r = engine.parseMermaidMindmap('这根本不是 mindmap\n  ???');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // ⚠️ 只验 ok:false **不够** —— 注入「坏语法照收」后,
    //   仍可能因为另一条守卫(空输入)而返回 false,**对的结果、错的原因**(实测)。
    //   故必须验错误**定位到出问题的那一行**且说明是「不是 mindmap」。
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0].line, '应定位到第 1 行(第一个非空行就不对)').toBe(1);
    expect(r.errors[0].message).toContain('mindmap');
    // ⚠️ fail loud:不许返回「解析了一半」的模型
    expect('value' in r).toBe(false);
  });

  it('⭐ 坏语法不得被静默兜底成一棵树', () => {
    // 守「把不是 mindmap 的东西也照收」这条分支:
    // 若实现遇到坏头不报错而是硬解析,这里会拿到 ok:true。
    const r = engine.parseMermaidMindmap('flowchart TD\n  A --> B');
    expect(r.ok, 'flowchart 不是 mindmap,不许照收').toBe(false);
  });
});

describe('C7 释放语义 —— 删一条 G 条目,该元素回自动,其余一切不变', () => {
  it('删 pos → 该 id 条目消失,其它条目分毫不动', () => {
    const base = freshSnapshot();
    const ids = base.s.nodes.filter((n) => n.parent !== null).map((n) => n.id);
    expect(ids.length, '夹具需要至少两个非根节点').toBeGreaterThanOrEqual(2);
    const [a, b] = ids;
    let snap = engine.applyAction(base, { kind: 'canvas.dragNode', id: a, x: 1, y: 2 });
    snap = engine.applyAction(snap, { kind: 'canvas.dragNode', id: b, x: 3, y: 4 });
    const otherBefore = JSON.stringify(snap.g.get(b) ?? null);

    const after = engine.applyAction(snap, { kind: 'graphic.deletePos', id: a });
    // ⚠️ 初版写「要么整条没了,要么至少 pos 字段没了」—— **放行了空壳**,
    //   注入「deletePos 留下 {} 空条目」后照样绿(实测)。
    //   但空壳会架空稀疏纪律:G 层里躺着一个没有任何属性的条目,
    //   序列化虽不输出,`g.size` 却变了 —— C5「新建节点 G 层零条目」
    //   这类按 size 计数的断言就被污染。故要求**整条移除**。
    expect(after.g.get(a)?.pos).toBeUndefined();
    expect(after.g.has(a), 'pos 删空后该条目必须整条移除,不留空壳(稀疏纪律)').toBe(false);
    // ⭐ 「其余一切不变」
    expect(JSON.stringify(after.g.get(b) ?? null)).toBe(otherBefore);
    expect(sFingerprint(after.s)).toBe(sFingerprint(snap.s));
  });
});

describe('⭐ 恢复自动布局(整图释放 pos)—— C7 的整图版', () => {
  it('清空全部 pos → 所有节点回自动布局', () => {
    const base = freshSnapshot();
    const ids = base.s.nodes.filter((n) => n.parent !== null).map((n) => n.id);
    let snap = base;
    ids.forEach((id, i) => {
      snap = engine.applyAction(snap, { kind: 'canvas.dragNode', id, x: i * 10, y: i * 20 });
    });
    expect(snap.g.size).toBe(ids.length);

    const after = engine.applyAction(snap, { kind: 'graphic.releaseAllPos' });
    for (const e of after.g.values()) {
      expect(e.pos, '释放后不该还有 pos').toBeUndefined();
    }
    // ⭐ S 层零变更 —— 恢复布局是纯 G 层操作
    expect(sFingerprint(after.s)).toBe(sFingerprint(snap.s));
  });

  it('⚠️ 只删 pos,不碰 color/shape/collapsed(那是用户另外表达的意图)', () => {
    const base = freshSnapshot();
    const id = someBranchId(base.s);
    let snap = engine.applyAction(base, { kind: 'canvas.dragNode', id, x: 5, y: 6 });
    snap = engine.applyAction(snap, { kind: 'graphic.editColor', id, color: 'red' });
    snap = engine.applyAction(snap, { kind: 'semantic.slashShape', id, shape: 'ellipse' });

    const after = engine.applyAction(snap, { kind: 'graphic.releaseAllPos' });
    expect(after.g.get(id)?.pos, 'pos 该没了').toBeUndefined();
    expect(after.g.get(id)?.color, 'color 必须留着').toBe('red');
    expect(after.g.get(id)?.shape, 'shape 必须留着').toBe('ellipse');
  });

  it('⭐ 只有 pos 的条目整条移除(稀疏纪律,不留空壳)', () => {
    const base = freshSnapshot();
    const id = someBranchId(base.s);
    const snap = engine.applyAction(base, { kind: 'canvas.dragNode', id, x: 1, y: 2 });
    const after = engine.applyAction(snap, { kind: 'graphic.releaseAllPos' });
    expect(after.g.has(id), '零属性条目必须整条移除').toBe(false);
    expect(after.g.size).toBe(0);
  });

  it('没有被钉住的节点时,释放是无操作(不报错)', () => {
    const base = freshSnapshot();
    const after = engine.applyAction(base, { kind: 'graphic.releaseAllPos' });
    expect(after.g.size).toBe(0);
    expect(sFingerprint(after.s)).toBe(sFingerprint(base.s));
  });
});

describe('⭐ 折叠(G 层持久,与 note 三角同源)', () => {
  it('toggle → G 层写 collapsed;再 toggle → 整条移除(稀疏)', () => {
    const base = freshSnapshot();
    const id = someBranchId(base.s);

    const on = engine.applyAction(base, { kind: 'graphic.toggleCollapsed', id });
    expect(on.g.get(id)?.collapsed).toBe(true);

    const off = engine.applyAction(on, { kind: 'graphic.toggleCollapsed', id });
    // ⭐ 展开 = 删字段;条目空了整条移除(false 是缺省,不写缺省值)
    expect(off.g.get(id)?.collapsed).toBeUndefined();
    expect(off.g.has(id), '零属性条目必须整条移除').toBe(false);
  });

  it('⭐ 折叠是纯 G 层操作 —— S 层零变更', () => {
    const base = freshSnapshot();
    const id = someBranchId(base.s);
    const after = engine.applyAction(base, { kind: 'graphic.toggleCollapsed', id });
    expect(sFingerprint(after.s)).toBe(sFingerprint(base.s));
  });

  it('⚠️ 折叠不碰同节点的其它 G 属性(pos/color 要留着)', () => {
    const base = freshSnapshot();
    const id = someBranchId(base.s);
    let snap = engine.applyAction(base, { kind: 'canvas.dragNode', id, x: 5, y: 6 });
    snap = engine.applyAction(snap, { kind: 'graphic.editColor', id, color: 'red' });

    const on = engine.applyAction(snap, { kind: 'graphic.toggleCollapsed', id });
    expect(on.g.get(id)?.pos).toEqual({ x: 5, y: 6 });
    expect(on.g.get(id)?.color).toBe('red');
    // 展开后其它属性仍在(条目不该被整条删)
    const off = engine.applyAction(on, { kind: 'graphic.toggleCollapsed', id });
    expect(off.g.get(id)?.pos).toEqual({ x: 5, y: 6 });
    expect(off.g.get(id)?.color).toBe('red');
  });
});

describe('C8 手势消解 —— 语义面斜杠属性词:S 零残留,G 恰好一条', () => {
  it('键入 /三角形 → S 层不留任何属性 token,G 层多一条 shape', () => {
    const base = freshSnapshot();
    const id = someBranchId(base.s);
    const { after, sChanged, gTouched } = landingOf(base, {
      kind: 'semantic.slashShape', id, shape: 'triangle',
    });
    // ⭐ 语义面百分之百为语义服务(00 §3)
    expect(sChanged, `LANDING_MATRIX 承诺 s=${LANDING_MATRIX['semantic.slashShape'].s}`).toBe(false);
    expect(gTouched, `LANDING_MATRIX 承诺 g=${LANDING_MATRIX['semantic.slashShape'].g}`).toBe(1);
    expect(after.g.get(id)?.shape).toBe('triangle');
    // ⚠️ 并且 S 层内容里不许残留 '/三角形' 这类 token
    expect(JSON.stringify(after.s)).not.toContain('三角形');
  });
});

describe('C9 round-trip 不破坏 —— 导入→编辑→导出→再导入,图一致', () => {
  it('mermaid → S → mermaid → S:两次解析结果等价', () => {
    const first = engine.parseMermaidMindmap(MERMAID_SAMPLE);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const back = engine.toMermaidMindmap(first.value);
    const second = engine.parseMermaidMindmap(back);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    // 比结构而非比 id(id 可能是新分配的);比「树形状 + 标签序列」
    // ⚠️ 初版比的是 {parentIsNull, role} —— 布尔+角色,树形状信息几乎全丢。
    expect(treeOutline(second.value, labelText)).toBe(treeOutline(first.value, labelText));

    // ⚠️⚠️ round-trip **自洽**:坏解析器导出坏文本、再用同一坏解析器读回来
    //   仍然一致(实测)。所以 round-trip 一致是**必要不充分**条件,
    //   必须同时钉住预期的具体树,否则「一致地错」照样绿。
    expect(treeOutline(first.value, labelText)).toBe(
      ['主题', '  分支A', '    叶子1', '    叶子2', '  分支B', '    叶子3'].join('\n'),
    );
  });

  it('⭐ 未知记号原样透传,round-trip 不丢失(00 §2.3)', () => {
    const withUnknown = '^arch pos=420,180 futureKey=someValue\n';
    const parsed = engine.parseGLayer(withUnknown);
    expect(parsed.ok, '未知记号不是坏行,不许拒绝').toBe(true);
    if (!parsed.ok) return;
    const out = engine.serializeGLayer(parsed.value);
    // ⚠️ 即便将来加了自己的语法,读到不认识的东西也**不许丢**
    expect(out).toContain('futureKey');
    expect(out).toContain('someValue');
  });
});

// ═════════════════════════════════════════════════════════
// M 类:mind 专属(01 §8 + 本轮新增 M5)
// ═════════════════════════════════════════════════════════

describe('M1 推导确定性 —— 同一书写序列必得同一棵树', () => {
  it('同一输入解析两次,树完全一致', () => {
    const a = engine.parseMermaidMindmap(MERMAID_SAMPLE);
    const b = engine.parseMermaidMindmap(MERMAID_SAMPLE);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // ⚠️ 初版比的是 `nodes.map(n=>n.order).sort()` —— order 的多重集合,
    //   与 parent 指向谁**完全无关**,树推导改坏后照样绿(实测)。
    expect(treeOutline(b.value, labelText)).toBe(treeOutline(a.value, labelText));

    // ⚠️⚠️ 但「两次解析互相一致」**也抓不到「一致地错」** ——
    //   把树推导改坏成「每个节点都挂到前一个」,两次解析仍然一致(实测)。
    //   自比只能证明**确定性**,证明不了**正确性**。
    //   故必须钉住 MERMAID_SAMPLE 的**预期具体树**(缩进即父子):
    expect(treeOutline(a.value, labelText)).toBe(
      ['主题', '  分支A', '    叶子1', '    叶子2', '  分支B', '    叶子3'].join('\n'),
    );
  });

  it('⭐ 级别跳跃宽容解释:h1 下直接出现 h3,按就近父级归属,不报错', () => {
    // 01 §4 规则 2:不报错、不改写用户书写
    const skipped = ['mindmap', '  root((主题))', '        深缩进直接来', '  第二个顶层'].join('\n');
    const r = engine.parseMermaidMindmap(skipped);
    expect(r.ok, '级别跳跃不是错误').toBe(true);
    if (!r.ok) return;
    // 「深缩进直接来」的父应是 root(序列中之前、级别小于它的最近节点)
    const deep = r.value.nodes.find((n) => labelText(n) === '深缩进直接来');
    expect(deep, '节点应被解析出来').toBeDefined();
    // ⚠️ 不能只验 not null —— 要验**归到了哪个**父(就近父级 = root)
    const root = r.value.nodes.find((n) => n.role === 'root');
    expect(root).toBeDefined();
    expect(deep!.parent, '应归到就近父级 root').toBe(root!.id);
    // 第二个顶层(缩进回到与 root 同级)应是自由主题,而非 root 的孩子
    const second = r.value.nodes.find((n) => labelText(n) === '第二个顶层');
    expect(second!.parent, '同级顶层不该挂到 root 下').toBeNull();
  });
});

describe('⭐⭐ M2 拖动三义 —— 三种落点各自只落该落的层,不许串', () => {
  it('落点①空白处 = 钉住坐标:S 零、G 一条', () => {
    const base = freshSnapshot();
    const id = someBranchId(base.s);
    const { sChanged, gTouched } = landingOf(base, { kind: 'canvas.dragNode', id, x: 10, y: 20 });
    expect(sChanged).toBe(false);
    expect(gTouched).toBe(1);
  });

  it('落点②另一节点上 = 改父改序:S 变、G 零', () => {
    const base = freshSnapshot();
    const nodes = base.s.nodes.filter((n) => n.parent !== null);
    const moving = nodes[0].id;
    const newParent = nodes.find((n) => n.id !== moving && n.parent !== moving)!.id;
    const { sChanged, gTouched } = landingOf(base, {
      kind: 'canvas.dragReparent', id: moving, newParent,
    });
    // ⭐ 结构操作落 S,**不许顺手写 pos**(串了就是 M2 失败)
    expect(sChanged).toBe(true);
    expect(gTouched, '改父不得触碰 G 层').toBe(0);
  });

  it('落点③Shift+空白 = 转自由主题:S 变(role→floating)且 G 有 pos', () => {
    const base = freshSnapshot();
    const id = someBranchId(base.s);
    const { after, sChanged, gTouched } = landingOf(base, {
      kind: 'canvas.dragToFloat', id, x: -200, y: 60,
    });
    expect(sChanged).toBe(true);
    expect(gTouched).toBe(1);
    expect(after.s.nodes.find((n) => n.id === id)?.role).toBe('floating');
    expect(after.g.get(id)?.pos).toBeDefined();
  });

  it('⭐ 三义互斥:同一次拖动不得既改父又钉坐标', () => {
    const base = freshSnapshot();
    const nodes = base.s.nodes.filter((n) => n.parent !== null);
    const moving = nodes[0].id;
    const newParent = nodes.find((n) => n.id !== moving && n.parent !== moving)!.id;
    const after = engine.applyAction(base, { kind: 'canvas.dragReparent', id: moving, newParent });
    // 改父的那一次,该节点不得凭空获得 pos
    expect(after.g.get(moving)?.pos, '改父不得顺手钉坐标(三义串了)').toBeUndefined();
  });
});

describe('⭐ M3 子树移动 pos 存活 —— 升降级后全部 pos 条目存活', () => {
  it('移动子树 → 所有已钉住的坐标一条不少', () => {
    const base = freshSnapshot();
    const nodes = base.s.nodes.filter((n) => n.parent !== null);
    expect(nodes.length).toBeGreaterThanOrEqual(2);
    // 给全部非根节点钉坐标(经引擎)
    let snap: DiglotSnapshot = base;
    nodes.forEach((n, i) => {
      snap = engine.applyAction(snap, { kind: 'canvas.dragNode', id: n.id, x: i * 10, y: i * 20 });
    });
    const before = gFingerprint(snap.g);

    const moving = nodes[0].id;
    const newParent = nodes.find((n) => n.id !== moving && n.parent !== moving)!.id;
    const after = engine.applyAction(snap, {
      kind: 'semantic.moveIndent', id: moving, newParent,
    });

    // ⭐ id 配对,绝不删旧建新 —— 属性化模型下根本没有删旧建新的机会(03 §3.2)
    expect(gFingerprint(after.g), '移动子树后 pos 必须全部存活').toBe(before);
  });
});

describe('M4 Span 锚点稳固 —— 节点移动/更名后 from/to 仍指向正确区间', () => {
  it('更名后 Span 锚点不漂移', () => {
    const base = freshSnapshot();
    expect(base.s.spans.length >= 0).toBe(true);
    const id = someBranchId(base.s);
    const after = engine.applyAction(base, { kind: 'semantic.editLabel', id, text: '换个名字' });
    // 锚在 id 上,更名不该动 span
    expect(JSON.stringify(after.s.spans)).toBe(JSON.stringify(base.s.spans));
  });
});

describe('⭐⭐ M5 边坏树不坏 —— 用户 2026-09-09 拍板的硬约束', () => {
  it('⭐ 重复连同一对端点 → 覆盖而非新增(债 3:确定性 id)', () => {
    // ⚠️ Decision 028 §1.2:putEdge 无 id 时每次 CREATE 新行 → 重复边累积。
    //   联系线走确定性 id 才能「拖一下不多一条边」。
    //   注入「connect 用随机 id」后,之前没有任何断言会红(实测)。
    const base = freshSnapshot();
    const ns = base.s.nodes.filter((n) => n.parent !== null);
    const a1 = engine.applyAction(base, { kind: 'canvas.connect', source: ns[0].id, target: ns[1].id });
    const a2 = engine.applyAction(a1, { kind: 'canvas.connect', source: ns[0].id, target: ns[1].id });
    expect(a1.s.edges.length).toBe(1);
    expect(a2.s.edges.length, '同一对端点连两次不得变成两条边').toBe(1);
    // ⭐ 方向敏感:反向是**另一条**边,不是覆盖
    const a3 = engine.applyAction(a2, { kind: 'canvas.connect', source: ns[1].id, target: ns[0].id });
    expect(a3.s.edges.length, 'A→B 与 B→A 是两条不同的边').toBe(2);
  });

  it('全部 Edge 整批删除 → 树结构 / content / G 条目逐项一致', () => {
    // 用户原话:「边的错误不会影响文档的完整性、正确性。」
    const base = freshSnapshot();
    const nodes = base.s.nodes.filter((n) => n.parent !== null);
    // ⚠️ 先自证夹具健全:若实现把树塞进 edges(每个 parent 都是 null),
    //   这里会直接暴露成「没有带 parent 的节点」,而不是后面 nodes[1] 撞 TypeError
    //   —— 崩溃式的红看不出是哪条不变量破了,必须让断言自己说话。
    expect(
      nodes.length,
      '夹具里应有带 parent 的节点;若为 0,多半是树被塞进了 edges(M5 违规)',
    ).toBeGreaterThanOrEqual(2);
    const snap = engine.applyAction(base, {
      kind: 'canvas.connect', source: nodes[0].id, target: nodes[1].id, label: '联系',
    });
    expect(snap.s.edges.length, '应当真的连上了一条边').toBeGreaterThan(0);

    // ⚠️ 模拟「边整批丢失/损坏」——**只动 edges,不动别的**
    const edgeless: DiglotSnapshot = {
      s: { nodes: snap.s.nodes, edges: [], spans: snap.s.spans },
      g: snap.g,
    };

    // 树与内容必须分毫不差
    const treeOf = (s: SLayer) =>
      JSON.stringify(
        [...s.nodes]
          .map((n) => ({ id: n.id, parent: n.parent, order: n.order, content: n.content }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      );
    // ⚠️⚠️ 与 `snap` 比是**不够**的:`edgeless` 正是从 `snap.s.nodes` 造的,
    //   若 connect 本身就把树压平了(parent 全置 null、结构塞进 edges),
    //   两边**一样地坏**,照样相等(实测:注入后本条曾全绿)。
    //   ⭐ 必须与**连线之前的 base** 比,并钉住预期具体树。
    expect(treeOf(edgeless.s)).toBe(treeOf(snap.s));
    expect(treeOf(edgeless.s), '连线不得改动树本身').toBe(treeOf(base.s));
    expect(treeOutline(edgeless.s, labelText)).toBe(
      ['主题', '  分支A', '    叶子1', '    叶子2', '  分支B', '    叶子3'].join('\n'),
    );
    expect(gFingerprint(edgeless.g)).toBe(gFingerprint(snap.g));

    // ⭐ 这条能真失败:谁把树也存成边(如用 edges 表达 parent),
    //    清空 edges 后树就散了 → 红。它守的正是 Decision 028 那个事故不重演。
  });

  it('⭐ 树的父子关系不得依赖 edges 表达', () => {
    const base = freshSnapshot();
    // ⚠️ 初版写的是 `n.parent !== undefined` —— **null 也满足**,
    // 而「树靠边表达」的实现恰恰把每个 parent 都置成 null,照样绿(实测)。
    // 零区分力,形态 = HANDOFF §5「断言成立的原因不是被测逻辑对」。
    // 改为:非根非自由节点**必须有一个非 null 的 parent**,且该 parent 真实存在。
    const edgeless: SLayer = { nodes: base.s.nodes, edges: [], spans: base.s.spans };
    const ids = new Set(edgeless.nodes.map((n) => n.id));
    const shouldHaveParent = edgeless.nodes.filter(
      (n) => n.role !== 'root' && n.role !== 'floating',
    );
    expect(shouldHaveParent.length, '夹具需要至少一个非根节点').toBeGreaterThan(0);
    for (const n of shouldHaveParent) {
      // ⭐ parent 是节点自身的属性(03 §3.2 parentId),不是查边查出来的。
      //   清空 edges 后它必须仍然指向一个真实存在的节点。
      expect(n.parent, `节点 ${n.id} 的 parent 不得为 null —— 树不许靠 edges 表达`).not.toBeNull();
      expect(ids.has(n.parent!), `节点 ${n.id} 的 parent=${n.parent} 不存在`).toBe(true);
    }
    // ⚠️ 「每个 parent 都非 null 且存在」还不够 —— 把树推导改坏成
    //   「每个节点都挂到前一个」时,这些条件**仍然全部满足**(实测)。
    //   故再验:清空 edges 后树形状与原图**逐字一致**,且确有多层嵌套。
    expect(treeOutline(edgeless, labelText)).toBe(treeOutline(base.s, labelText));
    // ⚠️ 同上:与自身比抓不到「一致地错」,钉住预期具体树
    expect(treeOutline(edgeless, labelText)).toBe(
      ['主题', '  分支A', '    叶子1', '    叶子2', '  分支B', '    叶子3'].join('\n'),
    );
  });
});

/**
 * §闸门说明 + 注入验证台账
 *
 * | 步骤 | 实现 | 状态 |
 * |---|---|---|
 * | ③ | `parseMermaidMindmap` / `toMermaidMindmap` | ✅ |
 * | ④ | `parseGLayer` / `serializeGLayer` | ✅ |
 * | ⑤ | `applyAction`（双向同步） | ✅ |
 *
 * ⭐ 三步落地**没有改动任何断言的判据**，只在注入暴露守卫失效时**加固**。
 * 改测试让它绿 = 违规（HANDOFF §4）。
 *
 * ────────────────────────────────────────────────
 * ⭐⭐ §注入台账 —— 全部真跑，累计 22 次注入，抓到 10 个真缺口
 *
 * **步骤③ mermaid 解析**
 * | # | 注入 | 实测 |
 * |---|---|---|
 * | E | 不按 indent 弹栈 | ⚠️ 5 条全绿 → 缺口 3、4 |
 * | F | 弹栈 `>=` 改 `>` | ✅ 4 红 |
 * | G2 | 坏头照收 | ✅ 2 红 |
 *
 * **步骤④ G 层**
 * | # | 注入 | 实测 |
 * |---|---|---|
 * | H | color 缺省写成 auto | ⚠️ 全绿 → 缺口 5 |
 * | I | id 不排序 | ✅ 红 |
 * | J | 未知记号丢弃 | ✅ 红 |
 * | K | 坏行静默跳过 | ✅ 红 |
 * | L | 键序跟对象自身键序 | ⚠️ 全绿 → 缺口 6 |
 * | M | 空 G 层写空壳注释 | ✅ 红 |
 * | N | 别名不转 canonical | ✅ 红 |
 *
 * **步骤⑤ 双向同步**
 * | # | 注入 | 实测 |
 * |---|---|---|
 * | O | 拖动时 `role:'branch'`（原值） | ⚪ **注入无效**（改了等于没改）→ 见下 |
 * | O2 | 拖动时真改 order | ✅ C4 + M2 红 |
 * | P | 新建节点顺手写 pos | ✅ C5 红 |
 * | Q | 改父顺手钉坐标 | ✅ M2 两条红 |
 * | R | deletePos 留 `{}` 空壳 | ⚠️ 全绿 → 缺口 7 |
 * | S | 斜杠手势在 S 层留残留 | ✅ C8 红 |
 * | T | 坐标不量化 | ✅ 红 |
 * | U | 改名时删旧建新（换 id） | ⚠️ 全绿 → 缺口 8 |
 * | V | 移动子树时清 G 条目 | ✅ M3 红 |
 * | W | connect 把树塞进 edges | ⚠️ 全绿 → 缺口 9 |
 * | X | connect 用随机 id | ⚠️ 全绿 → 缺口 10 |
 *
 * ⚠️ **缺口 7：C7 明文放行空壳**
 * 原注释写「要么整条没了，**要么至少 pos 字段没了**」——
 * 注入「deletePos 留 `{}`」照样绿。空壳会架空稀疏纪律：
 * G 层躺着零属性条目，序列化虽不输出但 `g.size` 变了，
 * C5 这类按 size 计数的断言就被污染。已要求**整条移除**。
 *
 * ⚠️ **缺口 8：只验 G 层不变，看不见 S 层换了 id**
 * 「删旧建新」换的是 **S 层的 id**，G 层原样躺着反而更像没事，
 * 实则那条 pos 成了**指向不存在节点的孤儿**。
 * ⭐ id 是四面唯一 join 键，C3 要的是**id 配对**。
 * 已补：该 id 仍在 S 层 + G 层每个 key 都能在 S 层找到对应节点。
 *
 * ⚠️ **缺口 9：拿被污染的快照跟它自己比**
 * M5 的 `edgeless` 正是从 `snap.s.nodes` 造的 —— 若 connect 本身就把树
 * 压平了，两边**一样地坏**，照样相等。已改为与**连线之前的 base** 比，
 * 并钉住预期具体树。
 * ⭐ 同族教训：缺口 4「自比只证确定性」，这里是「自比连确定性都不证」。
 *
 * ⚠️ **缺口 10：债 3 有单元测试，却没有集成断言**
 * `edge-id.test.ts` 验了 `deterministicEdgeId` 本身，但**没人验
 * `applyAction` 真的用了它** —— 注入「connect 用随机 id」全绿。
 * 形态 = HANDOFF §5「只验了标记串，没验引擎在不在听」。
 * 已补「同一对端点连两次仍是一条边 + 反向是另一条边」。
 *
 * ⚪ **注入 O 的教训（不是缺口）**：给已是 `branch` 的节点再设
 * `role:'branch'` —— 改了等于没改，快照当然相等。
 * ⭐ **注入没造出目标场景 ≠ 守卫失效**（同 G→G2）。
 * 注入本身必须先自证「确实改变了行为」。
 *
 * ⚠️ 未覆盖（诚实记账，留给接线阶段）：
 * - **落库幂等**：`putEdgeViaTx` 带 id 走 `UPDATE`，边不存在时抛
 *   `Edge <id> not found` → 写联系线**必须走 UPSERT**，否则第一次连线就失败。
 *   本文件全在内存态，碰不到这条。
 * - `semantic.moveIndent` / `dragReparent` 的 `beforeSibling`（插到指定兄弟前）
 *   契约里有、实现只做了「追加到末位」，未验。
 * - Span 的实际生成（`Cmd+J`/`Cmd+B`）未实现，M4 只验了「更名不动 span」。
 * - `contentToText` fail loud 分支、mermaid icon/class 装饰 round-trip。
 */
