/**
 * 连接点操作点 —— 手势优先级链 & 生命周期守卫
 *
 * ⭐⭐ 守的是「**没破坏画板既有手势**」这件事。canvas-rendering 是共享底座
 * (画板 / family-tree / diglot mind 都用),操作点插错位置的后果是**静默**的:
 *  - 插得太早 → 抢了 resize / rotate / rewire,画板天天用的手势失灵
 *  - 插得太晚(在节点命中之后)→ 点连接点变成拖节点,操作点等于不存在
 * 两种都不会报错、不会红,只有真机点下去才发现 —— 所以钉在这里。
 *
 * ⚠️ 这几条是**源码结构断言**,不是行为断言。原因说清楚:
 * vitest 跑 node 环境(无 DOM / WebGL),InteractionController 里 `new THREE.*`
 * 与 container 事件绑定都跑不起来;行为那一半只能真机验。
 * 结构断言能守住的正是「顺序」与「必有停止调用」这两条会被改动悄悄破坏的不变量,
 * 判定逻辑本身则在 canvas-magnet-actions.test.ts 里做真行为断言。
 *
 * ⚠️ 每条都注入验红,台账见文件末尾。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC_ROOT = resolve(__dirname, '../../src/capabilities/canvas-rendering');
const controller = readFileSync(
  resolve(SRC_ROOT, 'interaction/InteractionController.ts'),
  'utf8',
);
const overlay = readFileSync(resolve(SRC_ROOT, 'scene/MagnetActionsOverlay.ts'), 'utf8');

/**
 * 剥掉注释,只留真代码。
 *
 * ⚠️ 存在的理由(踩过):这些守卫用文本匹配,而源码注释里往往**原样写着**
 * 被守的那个字符串(如 `depthTest:false` 的解释文字)。不剥注释的话,
 * 删掉真实现守卫依然绿 —— 等于「用注释骗过守卫」,是假保证。
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释(含 JSDoc)
    .replace(/\/\/[^\n]*/g, '');          // 行注释
}

/** 取 handleMouseDown 函数体(到下一个方法定义为止) */
function mouseDownBody(): string {
  const start = controller.indexOf('private handleMouseDown(');
  expect(start, '找不到 handleMouseDown —— 手势链改名了,这些守卫必须同步更新').toBeGreaterThan(0);
  const end = controller.indexOf('private startDragNodes(', start);
  expect(end).toBeGreaterThan(start);
  return controller.slice(start, end);
}

describe('手势优先级链:操作点插在 rewire 之后、节点拖动之前', () => {
  const body = mouseDownBody();

  it('⭐⭐ 操作点判定在「命中节点 → 拖动」之前(否则点连接点会变成拖节点)', () => {
    const magnet = body.indexOf('tryStartMagnetAction');
    const nodeHit = body.indexOf('this.hitTest(screen.x, screen.y)');
    expect(magnet, '手势链里必须有操作点这一条').toBeGreaterThan(0);
    expect(nodeHit, '手势链里必须有节点命中这一条').toBeGreaterThan(0);
    expect(magnet, '操作点必须先于节点命中').toBeLessThan(nodeHit);
  });

  it('⭐⭐ 操作点判定在 resize/rotate 与 rewire **之后**(不抢既有手势)', () => {
    const magnet = body.indexOf('tryStartMagnetAction');
    const param = body.indexOf('paramHitTest');
    const handles = body.indexOf('this.handlesOverlay.hitTest(');
    const rewire = body.indexOf('hitTestLineEndpointHandle');
    for (const [name, idx] of [
      ['param 拖点', param],
      ['resize/rotate handle', handles],
      ['line endpoint rewire', rewire],
    ] as const) {
      expect(idx, `手势链里必须仍有「${name}」这一条`).toBeGreaterThan(0);
      expect(idx, `操作点不该抢「${name}」的手势`).toBeLessThan(magnet);
    }
  });

  it('⭐ 命中操作点后必须 return —— 不能继续往下走到节点选中/拖动', () => {
    expect(body).toMatch(/if \(this\.tryStartMagnetAction\(world\)\) return;/);
  });
});

describe('取消与清理:不留残留', () => {
  it('⭐ Esc 分支里有操作点取消(与既有 rewire / drawingLine 同款逃生口)', () => {
    const escStart = controller.indexOf("e.key === 'Escape'");
    expect(escStart).toBeGreaterThan(0);
    const escBody = controller.slice(escStart, escStart + 1200);
    expect(escBody, 'Esc 必须能取消拖出,否则预览线会留在画布上').toContain(
      'cancelMagnetAction',
    );
  });

  it('⭐ dispose 里调了 cancelMagnetAction(unmount 时预览线要跟着走)', () => {
    const disp = controller.slice(
      controller.indexOf('  dispose(): void {'),
      controller.indexOf('  // ─────────────────────────────────────────────────────────\n  // 事件接线'),
    );
    expect(disp).toContain('cancelMagnetAction');
  });

  it('⚠️ 取消路径必须真的移除并 dispose 预览线(不是只把状态置 null)', () => {
    const fn = controller.slice(
      controller.indexOf('private clearMagnetActionPreview('),
      controller.indexOf('private clearMagnetActionPreview(') + 700,
    );
    expect(fn).toContain('scene.remove(press.previewGroup)');
    expect(fn).toContain('disposeLineGroup(press.previewGroup)');
  });

  it('⚠️⚠️ overlay 的常驻 RAF 必须在 dispose 里有停止调用(铁律)', () => {
    expect(overlay, 'overlay 起了常驻 RAF').toContain('requestAnimationFrame');
    const disp = overlay.slice(overlay.indexOf('dispose(): void {'));
    expect(disp, 'dispose 必须 cancelAnimationFrame,否则 unmount 后 RAF 常驻空转').toContain(
      'cancelAnimationFrame(this.rafTick)',
    );
  });
});

describe('层级:操作点必须画在连线之上', () => {
  const lineRenderer = readFileSync(resolve(SRC_ROOT, 'scene/LineRenderer.ts'), 'utf8');

  /**
   * ⚠️ 真机症状极具迷惑性:树连线在父节点的 E 点汇聚,把圆里的 `+`/`-` 糊掉
   * → 看起来像「折叠和展开长得一样」(图标逻辑其实是对的)。
   * 排到线之上是**视觉正确性**的一部分,不是美化。
   */
  it('⭐⭐ 每个 mesh 自己带 renderOrder,且高于连线的 renderOrder', () => {
    // 线的 renderOrder(从 LineRenderer 实读,别写死 —— 它变了这条要跟着变)
    const lineOrder = Number(/line\.renderOrder = (\d+)/.exec(lineRenderer)?.[1]);
    expect(Number.isFinite(lineOrder), '读不到线的 renderOrder').toBe(true);

    const actionOrder = Number(/const ACTION_RENDER_ORDER = (\d+)/.exec(overlay)?.[1]);
    expect(Number.isFinite(actionOrder), '操作点必须有自己的 renderOrder 常量').toBe(true);
    expect(actionOrder, '操作点必须排在连线之上,否则记号被糊掉').toBeGreaterThan(lineOrder);

    // ⚠️ 关键:设在**每个 mesh** 上,不是设在 Group 上(three 不继承)
    expect(overlay, 'renderOrder 必须逐 mesh 设置').toMatch(
      /mesh\.renderOrder = ACTION_RENDER_ORDER/,
    );
  });

  it('⭐⭐ 操作点的材质必须 depthTest:false —— 线本身就是,只调 Z 赢不了', () => {
    expect(
      stripComments(lineRenderer),
      '前提:连线是 depthTest:false(它不看 Z,纯按 renderOrder 排)',
    ).toMatch(/depthTest:\s*false/);
    // ⚠️⚠️ 必须剥注释再匹配 —— 本文件里到处写着「depthTest:false」的说明文字,
    //    不剥的话**删掉真代码这条守卫依然绿**(实测踩到:注入验红时它没红)。
    //    守卫要守的是代码,不是我自己写的注释。
    expect(
      stripComments(overlay),
      '操作点材质也必须 depthTest:false,否则与线不在同一套排序规则里',
    ).toMatch(/depthTest:\s*false/);
  });

  it('⚠️ 不把 renderOrder 设在 root Group 上(设了等于没设,不继承给子 mesh)', () => {
    expect(overlay).not.toMatch(/this\.root\.renderOrder\s*=/);
  });
});

describe('业务语义不下沉到共享底座', () => {
  it('⭐⭐ canvas-rendering 全层不出现「折叠」这类调用方语义', () => {
    // 底座只知道「连接点上有个可点的圆」;知道「折叠」= 语义漏下来了
    for (const [name, src] of [
      ['InteractionController', controller],
      ['MagnetActionsOverlay', overlay],
      [
        'magnet-actions',
        readFileSync(resolve(SRC_ROOT, 'interaction/magnet-actions.ts'), 'utf8'),
      ],
    ] as const) {
      expect(src, `${name} 不该认识 collapse/折叠`).not.toMatch(/toggleCollapsed|isCollapsed/);
    }
  });
});

/**
 * ⚠️ 注入验红台账(每条都实跑过)
 *
 * | 断言 | 注入的违规 | 结果 |
 * |---|---|---|
 * | 操作点先于节点命中 | 把 1.7 段整体挪到 `// ── 2.` 之后 | 红 |
 * | 不抢 resize/rewire | 把 1.7 段挪到 `// ── 1.` 之前 | 红(三条 sub-expect 全红) |
 * | 命中后 return | 去掉 `return`,改成裸调用 | 红 |
 * | Esc 有取消 | 删掉 Esc 分支里的 cancelMagnetAction | 红 |
 * | dispose 有取消 | 删掉 dispose 里的 cancelMagnetAction | 红 |
 * | 取消真 dispose 预览线 | clearMagnetActionPreview 改成只置 null | 红 |
 * | RAF 有停止调用 | 删掉 overlay dispose 的 cancelAnimationFrame | 红 |
 * | 语义不下沉 | 在 overlay 里写一句 isCollapsed 注释 | 红 |
 * | renderOrder 高于线 | ACTION_RENDER_ORDER 改成 1(= 线的值) | 红 |
 * | renderOrder 逐 mesh | 挪回 root Group 上、删掉 mesh.renderOrder | 红(2 条) |
 * | 材质 depthTest:false | 删掉真代码里的 depthTest:false | 红 |
 *
 * ⚠️⚠️ 最后一条**第一次注入时是绿的** —— 守卫在拿源码全文做匹配,而本文件注释里
 * 到处写着「depthTest:false」的解释文字,于是删掉真代码它照样匹配得上。
 * 这就是「用注释里的说明骗过守卫」,是假保证。修法 = `stripComments()` 先剥注释再匹配,
 * 重新注入确认变红。
 * ⭐ 教训:文本型守卫必须先问一句「被守的字符串会不会也出现在注释里」——
 *   本轮另外几条(cancelMagnetAction / cancelAnimationFrame / disposeLineGroup /
 *   tryStartMagnetAction)已逐个核过,注释里 0 次出现,红得是真的。
 */
