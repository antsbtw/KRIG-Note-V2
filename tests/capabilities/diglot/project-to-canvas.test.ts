/**
 * S + G → Instance[] 投影断言
 *
 * ⭐⭐ 守的是 03 §1.1 的核心关系:**稀疏覆盖全量**。
 * 写错这里,C5(新建 G 层零条目)与 C7(删条目回自动)在画面上就没了意义 ——
 * 模型层再对,用户看到的还是错的。
 *
 * ⚠️ 每条都注入验红,台账见文件末尾。
 */
import { describe, it, expect } from 'vitest';
import {
  buildLayoutRequest,
  projectToInstances,
  isTreeLineId,
  fontSizeForDepth,
  type LayoutAnswer,
} from '@capabilities/diglot-model/project-to-canvas';
import { BLOCK_VISUAL_SPEC } from '../../../src/lib/visual-spec/block-visual-spec';
import { fileToSnapshot, emptyMindFile } from '@capabilities/diglot-model/mind-file';
import { notImplementedEngine as engine } from '@capabilities/diglot-model/engine-contract';
import type { DiglotSnapshot } from '@capabilities/diglot-model/engine-contract';

function snap(): DiglotSnapshot {
  const r = fileToSnapshot(emptyMindFile());
  if (!r.ok) throw new Error('夹具解析失败');
  return r.value;
}

/**
 * 只取节点实例,滤掉树连线。
 * ⚠️ 加了树连线之后,`projectToInstances` 返回的是**节点 + 连线**两类;
 * 断言「每个实例都有坐标」这类话时必须先滤,否则会把连线也算进去
 * (连线走 magnet,本就没有 position —— 这是对的,不是缺陷)。
 */
function nodesOnly(inst: ReturnType<typeof projectToInstances>) {
  return inst.filter((i) => !isTreeLineId(i.id));
}

/** 假布局:给每个请求节点一个可辨认的坐标(x=序号*1000),便于区分「自动」与「G 层」。 */
function fakeLayout(req: ReturnType<typeof buildLayoutRequest>): LayoutAnswer {
  return { nodes: req.nodes.map((n, i) => ({ id: n.id, x: i * 1000, y: i * 100 })) };
}

describe('投影:稀疏覆盖全量', () => {
  it('⭐⭐ 没有 G 条目的节点,坐标全部来自自动布局', () => {
    const s = snap();
    expect(s.g.size, '前提:新建的图 G 层为空').toBe(0);
    const req = buildLayoutRequest(s.s, s.g);
    const inst = nodesOnly(projectToInstances(s.s, s.g, fakeLayout(req)));

    expect(inst.length).toBe(s.s.nodes.length);
    // 每个节点都拿到了坐标,且正是假布局给的那个
    inst.forEach((it, i) => {
      expect(it.position).toEqual({ x: i * 1000, y: i * 100 });
    });
  });

  it('⭐⭐ 有 G 条目的节点,pos 覆盖自动布局(pinned)', () => {
    const s0 = snap();
    const id = s0.s.nodes.find((n) => n.parent !== null)!.id;
    // 经引擎钉住(不手写 G 层)
    const s = engine.applyAction(s0, { kind: 'canvas.dragNode', id, x: 42, y: 43 });

    const req = buildLayoutRequest(s.s, s.g);
    const inst = projectToInstances(s.s, s.g, fakeLayout(req));

    const pinned = inst.find((i) => i.id === id)!;
    expect(pinned.position, 'G 层的 pos 必须赢过自动布局').toEqual({ x: 42, y: 43 });

    // ⭐ 其余节点仍走自动布局 —— 「只有被碰过的才被钉住」
    const others = inst.filter((i) => i.id !== id);
    expect(others.length).toBeGreaterThan(0);
    for (const o of others) {
      expect(o.position).not.toEqual({ x: 42, y: 43 });
    }
  });

  it('⭐ 删掉 pos 条目 → 该节点回自动布局(C7 在画面上的体现)', () => {
    const s0 = snap();
    const id = s0.s.nodes.find((n) => n.parent !== null)!.id;
    const pinned = engine.applyAction(s0, { kind: 'canvas.dragNode', id, x: 42, y: 43 });
    const released = engine.applyAction(pinned, { kind: 'graphic.deletePos', id });

    const req = buildLayoutRequest(released.s, released.g);
    const inst = projectToInstances(released.s, released.g, fakeLayout(req));
    const it = inst.find((i) => i.id === id)!;
    expect(it.position, '删条目后必须回到自动布局给的位置').not.toEqual({ x: 42, y: 43 });
  });

  it('⭐ 折叠:collapsed 节点的整棵子树不出现在 instances 里', () => {
    const s = snap();
    // 「分支A」有两个叶子
    const branch = s.s.nodes.find((n) => {
      const kids = s.s.nodes.filter((k) => k.parent === n.id);
      return kids.length >= 2;
    })!;
    const before = nodesOnly(projectToInstances(s.s, s.g, fakeLayout(buildLayoutRequest(s.s, s.g))));

    const g = new Map(s.g);
    g.set(branch.id, { collapsed: true });
    const after = nodesOnly(projectToInstances(s.s, g, fakeLayout(buildLayoutRequest(s.s, g))));

    expect(after.length).toBeLessThan(before.length);
    // 折叠的节点**自身仍可见**
    expect(after.some((i) => i.id === branch.id), '折叠的节点自己还在').toBe(true);
    // 它的孩子全部消失
    for (const kid of s.s.nodes.filter((k) => k.parent === branch.id)) {
      expect(after.some((i) => i.id === kid.id), `子节点 ${kid.id} 应被裁掉`).toBe(false);
    }
  });

  it('⭐ 布局请求里的 edges 只是算法输入,不代表数据模型有边', () => {
    const s = snap();
    const req = buildLayoutRequest(s.s, s.g);
    // 树有父子 → 布局输入有 edges
    expect(req.edges.length).toBeGreaterThan(0);
    // ⚠️ 但 S 层的 edges(联系线)仍然是空的 —— 两者是两回事(03 §3)
    expect(s.s.edges.length, '布局用的 edge 不得污染数据模型').toBe(0);
  });

  it('⭐⭐ 节点尺寸跟着文字走,不是一刀切', () => {
    // ⚠️ 真机实测(用户指出):六个短标签节点全部同宽同高 ——
    //   因为 estimateWidth 的下限(120)把它们**全部吞掉**了。
    //   一刀切既难看,也让树的层次感消失:长标题和短叶子该一眼看出差别。
    const src = [
      'mindmap',
      '  root((知识管理))',
      '    很长的一个分支标题',
      '      短',
      '    B',
    ].join('\n');
    const parsed = engine.parseMermaidMindmap(src);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const req = buildLayoutRequest(parsed.value, new Map());
    const byId = new Map(req.nodes.map((n) => [n.id, n]));
    const widthOf = (label: string): number => {
      const node = parsed.value.nodes.find(
        (n) => JSON.stringify(n.content).includes(label),
      );
      return byId.get(node!.id)!.width;
    };

    // ⭐ 长标签必须比短标签宽 —— 这是「跟着内容走」的最小判据
    expect(widthOf('很长的一个分支标题')).toBeGreaterThan(widthOf('知识管理'));
    expect(widthOf('知识管理')).toBeGreaterThan(widthOf('短'));
    // ⚠️ 且不许所有节点同宽(一刀切的机器化描述)
    const widths = new Set(req.nodes.map((n) => n.width));
    expect(widths.size, '不同长度的标签不该产出同一个宽度').toBeGreaterThan(1);
  });

  it('CJK 比同数量 ASCII 宽(全宽 vs 窄字)', () => {
    const src = ['mindmap', '  root((中中中中))', '    aaaa'].join('\n');
    const parsed = engine.parseMermaidMindmap(src);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const req = buildLayoutRequest(parsed.value, new Map());
    const [cjk, ascii] = req.nodes;
    expect(cjk.width).toBeGreaterThan(ascii.width);
  });

  it('⭐⭐ 树连线:每个非顶层节点恰好一条,父 E → 子 W', () => {
    const s = snap();
    const inst = projectToInstances(s.s, s.g, fakeLayout(buildLayoutRequest(s.s, s.g)));
    const lines = inst.filter((i) => isTreeLineId(i.id));
    const nonTop = s.s.nodes.filter((n) => n.parent !== null);

    expect(lines.length, '每个有父的节点恰好一条连线').toBe(nonTop.length);
    for (const n of nonTop) {
      const line = lines.find((l) => l.endpoints?.[1].instance === n.id);
      expect(line, `节点 ${n.id} 缺连线`).toBeDefined();
      // ⭐ 左→右布局:父接右侧(E),子接左侧(W)
      expect(line!.endpoints![0]).toEqual({ instance: n.parent, magnet: 'E' });
      expect(line!.endpoints![1]).toEqual({ instance: n.id, magnet: 'W' });
    }
  });

  it('⭐ 连线走 magnet 而非固定坐标(拖动时才会自动跟随)', () => {
    const s = snap();
    const inst = projectToInstances(s.s, s.g, fakeLayout(buildLayoutRequest(s.s, s.g)));
    for (const l of inst.filter((i) => isTreeLineId(i.id))) {
      expect(l.endpoints, '连线必须有 endpoints').toBeDefined();
      // ⚠️ 有 position 的话画布会用固定坐标,拖动节点线就不跟了
      expect(l.position, '连线不得带 position').toBeUndefined();
      expect(l.doc, '连线没有文字').toBeUndefined();
    }
  });

  it('⭐⭐ 连线是纯派生物 —— 不进 S 层 edges,也不进 G 层', () => {
    const s = snap();
    const inst = projectToInstances(s.s, s.g, fakeLayout(buildLayoutRequest(s.s, s.g)));
    expect(inst.some((i) => isTreeLineId(i.id))).toBe(true);
    // ⚠️ S 层的 edges 是**联系线**(树之外的附加关系),与树连线是两回事
    expect(s.s.edges.length, '树连线不得污染 S 层 edges').toBe(0);
    // ⚠️ G 层不为连线存条目(它们没有"被用户触碰过"这回事)
    expect(s.g.size, '树连线不得在 G 层留条目').toBe(0);
  });

  it('⭐ 折叠时,被裁掉的子树连线一并消失(不留悬空线)', () => {
    const s = snap();
    const branch = s.s.nodes.find(
      (n) => s.s.nodes.filter((k) => k.parent === n.id).length >= 2,
    )!;
    const g = new Map(s.g);
    g.set(branch.id, { collapsed: true });
    const inst = projectToInstances(s.s, g, fakeLayout(buildLayoutRequest(s.s, g)));
    const visibleIds = new Set(inst.filter((i) => !isTreeLineId(i.id)).map((i) => i.id));

    for (const l of inst.filter((i) => isTreeLineId(i.id))) {
      // ⚠️ 两端都必须是**可见**节点,否则就是指向不存在 instance 的悬空线
      expect(visibleIds.has(l.endpoints![0].instance), '连线起点必须可见').toBe(true);
      expect(visibleIds.has(l.endpoints![1].instance), '连线终点必须可见').toBe(true);
    }
  });

  it('顶层节点(root / 自由主题)不画线', () => {
    const s = snap();
    const inst = projectToInstances(s.s, s.g, fakeLayout(buildLayoutRequest(s.s, s.g)));
    const tops = s.s.nodes.filter((n) => n.parent === null).map((n) => n.id);
    for (const l of inst.filter((i) => isTreeLineId(i.id))) {
      expect(tops.includes(l.endpoints![1].instance), '顶层节点不该是连线终点').toBe(false);
    }
  });

  it('⭐⭐ 字号按树深度取 h1~hn,与 note 标题层级同一套', () => {
    const s = snap();
    const inst = nodesOnly(projectToInstances(s.s, s.g, fakeLayout(buildLayoutRequest(s.s, s.g))));
    const byId = new Map(inst.map((i) => [i.id, i]));

    const root = s.s.nodes.find((n) => n.role === 'root')!;
    const branch = s.s.nodes.find((n) => n.parent === root.id)!;
    const leaf = s.s.nodes.find((n) => n.parent === branch.id)!;

    // ⭐ 数值必须来自 BLOCK_VISUAL_SPEC,不另立一套 —— 否则导图和 note 会视觉分叉
    expect(byId.get(root.id)!.text_size).toBe(BLOCK_VISUAL_SPEC.headings.h1.fontSize);
    expect(byId.get(branch.id)!.text_size).toBe(BLOCK_VISUAL_SPEC.headings.h2.fontSize);
    expect(byId.get(leaf.id)!.text_size).toBe(BLOCK_VISUAL_SPEC.headings.h3.fontSize);
  });

  it('⚠️ 超过 h3 的深度用正文号,不继续缩(无限缩小会不可读)', () => {
    expect(fontSizeForDepth(3)).toBe(BLOCK_VISUAL_SPEC.body.fontSize);
    expect(fontSizeForDepth(10)).toBe(BLOCK_VISUAL_SPEC.body.fontSize);
  });

  it('⭐ 层级越深字号越小(不许倒挂)', () => {
    expect(fontSizeForDepth(0)).toBeGreaterThan(fontSizeForDepth(1));
    expect(fontSizeForDepth(1)).toBeGreaterThan(fontSizeForDepth(2));
    expect(fontSizeForDepth(2)).toBeGreaterThan(fontSizeForDepth(3));
  });

  it('⭐ 节点尺寸随字号缩放(大字号配大盒子)', () => {
    const s = snap();
    const inst = nodesOnly(projectToInstances(s.s, s.g, fakeLayout(buildLayoutRequest(s.s, s.g))));
    const byId = new Map(inst.map((i) => [i.id, i]));
    const root = s.s.nodes.find((n) => n.role === 'root')!;
    const leaf = s.s.nodes.find((n) => {
      const p = s.s.nodes.find((x) => x.id === n.parent);
      return p && p.parent !== null;
    })!;
    // 「主题」两字 vs 「叶子1」三字:字号差 38 vs 22,盒子高度必须体现出来
    expect(byId.get(root.id)!.size!.h).toBeGreaterThan(byId.get(leaf.id)!.size!.h);
  });

  it('⚠️ 布局结果缺节点 → fail loud,不静默给 (0,0)', () => {
    const s = snap();
    // 故意给一个空布局
    expect(() => projectToInstances(s.s, s.g, { nodes: [] })).toThrow(/布局/);
  });

  it('坐标量化为整数(自动布局可能带小数)', () => {
    const s = snap();
    const req = buildLayoutRequest(s.s, s.g);
    const noisy: LayoutAnswer = { nodes: req.nodes.map((n) => ({ id: n.id, x: 1.7, y: -2.3 })) };
    const inst = nodesOnly(projectToInstances(s.s, s.g, noisy));
    expect(inst.length).toBeGreaterThan(0);
    for (const it of inst) {
      expect(Number.isInteger(it.position!.x)).toBe(true);
      expect(Number.isInteger(it.position!.y)).toBe(true);
    }
  });

  it('G 层 color 落到 style_overrides;没设的不带该字段(稀疏)', () => {
    const s0 = snap();
    const id = s0.s.nodes.find((n) => n.parent !== null)!.id;
    const s = engine.applyAction(s0, { kind: 'graphic.editColor', id, color: 'red' });
    const inst = nodesOnly(projectToInstances(s.s, s.g, fakeLayout(buildLayoutRequest(s.s, s.g))));

    expect(inst.find((i) => i.id === id)!.style_overrides?.fill?.color).toBe('red');
    // ⭐ 没碰过的节点不许凭空多出样式字段
    const untouched = inst.find((i) => i.id !== id)!;
    expect(untouched.style_overrides).toBeUndefined();
  });

  it('节点 doc 就是 S 层 content(与 note block 同一形态)', () => {
    const s = snap();
    const inst = nodesOnly(projectToInstances(s.s, s.g, fakeLayout(buildLayoutRequest(s.s, s.g))));
    const first = inst[0];
    const node = s.s.nodes.find((n) => n.id === first.id)!;
    // ⭐ 直接透传,不做转换 —— 富文本/公式/图片将来天然可承载
    expect(first.doc).toBe(node.content);
  });
});

/**
 * §注入台账 —— 真跑，见提交说明
 *
 * | 注入 | 期望 | 实测 |
 * |---|---|---|
 * | 覆盖顺序反过来（自动布局赢过 G 层） | 「pos 覆盖自动布局」红 | ✅ |
 * | 无 G 条目时也补一条 pos | 「回自动布局」红 | ✅ |
 * | collapsed 不裁子树 | 「折叠」红 | ✅ |
 * | 布局缺节点时兜底给 (0,0) | 「fail loud」红 | ✅ |
 *
 * ⚠️ 未覆盖（诚实记账）：
 * - **真 ELK**：本文件用假布局，只验「覆盖逻辑」，不验 mrtree 排得好不好看。
 *   真布局质量要接线后肉眼看。
 * - 尺寸估算 `estimateWidth` 是近似值，精确尺寸需文字层 measure 后回填。
 * - `Instance` 的字段是结构性对齐（刻意不 import canvas-rendering 的类型，
 *   那会把 three 拖进 diglot-model），若渲染层改字段名这里不会自动红。
 */
