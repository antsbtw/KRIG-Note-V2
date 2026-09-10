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
    // a 回自动:要么整条没了,要么至少 pos 字段没了
    expect(after.g.get(a)?.pos).toBeUndefined();
    // ⭐ 「其余一切不变」
    expect(JSON.stringify(after.g.get(b) ?? null)).toBe(otherBefore);
    expect(sFingerprint(after.s)).toBe(sFingerprint(snap.s));
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
    expect(treeOf(edgeless.s)).toBe(treeOf(snap.s));
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
 * | 步骤 | 实现什么 | 状态 |
 * |---|---|---|
 * | ③ mermaid 解析 | `parseMermaidMindmap` / `toMermaidMindmap` | ✅ 已落地 → M1×2 / C6-mermaid×2 / C9 前半 转绿 |
 * | ④ G 层 | `parseGLayer` / `serializeGLayer` | ⏳ 未做 → C1×3 / C6-G层 / C9 后半 仍红 |
 * | ⑤ 双向同步 | `applyAction` | ⏳ 未做 → C2/C3/C4/C5/C7/C8、M2/M3/M4/M5 仍红 |
 *
 * ⚠️ **步骤③落地时没有改动任何断言的判据** —— 只是把加固后的判据补强。
 * 改测试让它绿 = 违规（HANDOFF §4）。
 *
 * ────────────────────────────────────────────────
 * ⭐⭐ §注入台账（步骤③）—— 抓到本轮第 3、4 个真缺口
 *
 * | # | 注入 | 期望 | 实测 |
 * |---|---|---|---|
 * | E | 不按 indent 弹栈（每节点挂前一个） | M1/C9/M5 红 | ⚠️ **初次 5 条全绿 → 见下** |
 * | F | 弹栈 `>=` 改 `>`（兄弟被当成子） | 同上 | ✅ 4 红（加固后） |
 * | G2 | 坏头照收（真静默兜底） | C6 红 | ✅ 2 红（加固后） |
 *
 * ⚠️⚠️ **缺口 3：断言比的东西不含树结构**
 * 注入 E 把树推导彻底改坏，**5 条断言全绿**。逐条查明：
 * - M1 第一条比 `nodes.map(n=>n.order).sort()` —— order 的**多重集合**，
 *   与 parent 指向谁完全无关
 * - C9 比 `{parentIsNull, role}` —— 布尔+角色，树形状信息几乎全丢
 * - M5 第二条只验 parent「非 null 且存在」—— 挂错父仍满足
 * 已加 `treeOutline()`：把父子嵌套与标签编码成缩进大纲串再比。
 *
 * ⚠️⚠️ **缺口 4：自比只证确定性，证不了正确性**
 * 加固后注入 E **仍有 3 条绿**。根因更隐蔽：
 * - M1「解析两次结果一致」——**坏解析器两次也一致**
 * - C9「round-trip 一致」——坏解析器导出坏文本、再用**同一个**坏解析器
 *   读回来，**当然一致**（实测：注入后 round-trip 仍 true）
 * ⭐ 即 round-trip 一致是**必要不充分**条件。
 * 已改为**同时钉住 MERMAID_SAMPLE 的预期具体树**，才抓得到「一致地错」。
 *
 * ⚠️ 另记：注入 G（`start = i - 1`）曾以为是 C6 的缺口，查明是
 * **注入本身太弱** —— 它让 start=-1，撞上另一条「空输入」守卫，
 * 仍返回 ok:false（对的结果、错的原因）。改用 G2（start=i，真照收）后
 * C6 两条正常变红。⭐ **注入没造出目标场景 ≠ 守卫失效**，
 * 形态同 HANDOFF §5「假环境不像真环境」。
 *
 * ⚠️ 未覆盖（诚实记账）：
 * - C1/C9 后半（G 层部分）注入未做 —— 步骤④落地后必须补。
 * - `contentToText` 的 fail loud 分支未测。
 * - mermaid 的 icon/class 装饰语法 v0 当纯文本收，未验 round-trip 是否丢。
 */
