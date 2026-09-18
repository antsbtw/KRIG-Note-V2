/**
 * ⭐⭐ 控制台留痕归类 —— **真调函数、断言返回值**(不是 grep 源码)
 *
 * ── 为什么这个文件必须存在 ──
 *
 * 这段逻辑是本会话出 bug 最多的地方,三次都是我写的:
 *  ① 耗时传字面量 `0` —— 假事实,查「tap 要多久」会读到 0ms
 *  ② 层归属一律 `web.page` —— `tap`/`type` 其实是 `web.input`,按层查询会说谎
 *  ③ 「等不到」记成 `unexpected-format` —— 那是**站点改版探测器**,被正常否定结果污染
 *
 * 而当时它埋在 handler 里**没导出**,40 条守卫只能 grep 源码文本,
 * 于是**两次假绿**(见 [[feedback-guard-scope-to-the-branch]])。
 *
 * ⭐ 抽成纯函数后本文件直接调它 —— 源码怎么写无所谓,**返回值必须对**。
 * 这是用户 2026-09-15 定的分工:AI 做完回归,人只验 AI 够不着的事实。
 */
import { describe, it, expect } from 'vitest';
import { planTrace, describeWhy, LAYER_OF } from '@platform/main/ipc/web-console-classify';

/** 底座失败原文(`ControlEngine` / `InputEngine` 里的字面量,改了这里要跟着改) */
const ANCHOR_MISS = '锚点 tweet.article 无法解释成 selector(adapter 没登记?)';
const TIMEOUT_PLAIN = '等待判据 anchorGone:tweet.article 超时(6000ms)';
const TIMEOUT_WITH_INJECTION =
  '等待判据 anchorAppears:x 超时(6000ms);最后一次注入异常: Script failed to execute';

describe('⭐⭐ 成功也要记 —— 否则算不出成功率', () => {
  it('ok → recovery(recovered),带耗时与入参', () => {
    const plan = planTrace('ready', { kind: 'urlIncludes', fragment: '/home' },
      { status: 'ok' }, 42);

    expect(plan.kind).toBe('recovery');
    if (plan.kind !== 'recovery') return;
    expect(plan.outcome).toBe('recovered');
    expect(plan.what).toBe('console:ready');
    // ⭐ 耗时必须透传 —— 写死 0 是假事实
    expect(plan.detail).toContain('42ms');
    expect(plan.detail).toContain('urlIncludes');
  });
});

describe('⭐⭐ 「等不到」不是降级 —— 不许污染站点改版探测器', () => {
  /**
   * `countByCapability('unexpected-format')` 是改版探测器:
   * 某 adapter 的格式外计数突然上升 = 那个站改版了。
   * 拿「推文没消失」这种正常否定结果喂它,X 真改版时指标早被顶高。
   */
  it('⭐⭐ 纯粹超时 → recovery(failed),**不进 degradation**', () => {
    const plan = planTrace('ready', { kind: 'anchorGone', anchor: 'tweet.article' },
      { status: 'failed', reason: TIMEOUT_PLAIN }, 6135);

    expect(plan.kind, '纯超时被记成降级了 —— 会污染改版探测器').toBe('recovery');
    if (plan.kind !== 'recovery') return;
    expect(plan.outcome, '否定结果被说成成功').toBe('failed');
    expect(plan.detail).toContain('6135ms');
    expect(plan.detail).toContain(TIMEOUT_PLAIN);
  });

  it('⭐⭐ 锚点没登记 → degradation(契约违反)—— 那是真缺陷,锚点表该改', () => {
    const plan = planTrace('tap', { anchor: 'tweet.article' },
      { status: 'failed', reason: ANCHOR_MISS }, 3);

    expect(plan.kind).toBe('degradation');
    if (plan.kind !== 'degradation') return;
    expect(plan.category).toBe('contract-violation');
  });

  it('⭐⭐ 注入一直抛到超时 → degradation(资源失败)—— 页面/通道有问题', () => {
    const plan = planTrace('ready', { kind: 'anchorAppears', anchor: 'x' },
      { status: 'failed', reason: TIMEOUT_WITH_INJECTION }, 6002);

    expect(plan.kind).toBe('degradation');
    if (plan.kind !== 'degradation') return;
    expect(plan.category, '注入异常被当成了站点改版').toBe('resource-failure');
  });

  it('⭐ degraded → degradation(格式外),且 missing 写进 reason', () => {
    const plan = planTrace('scrollUntil', { kind: 'atBottom' },
      { status: 'degraded', missing: ['滚动没有发生', '未到底'] }, 900);

    expect(plan.kind).toBe('degradation');
    if (plan.kind !== 'degradation') return;
    expect(plan.category).toBe('unexpected-format');
    expect(plan.reason).toContain('滚动没有发生');
    expect(plan.reason).toContain('未到底');
  });

  it('⭐ 三种失败**互不串味**(同一组输入只落一种归类)', () => {
    const plain = planTrace('ready', {}, { status: 'failed', reason: TIMEOUT_PLAIN }, 1);
    const anchor = planTrace('ready', {}, { status: 'failed', reason: ANCHOR_MISS }, 1);
    const inject = planTrace('ready', {}, { status: 'failed', reason: TIMEOUT_WITH_INJECTION }, 1);

    expect(plain.kind).toBe('recovery');
    expect(anchor.kind === 'degradation' && anchor.category).toBe('contract-violation');
    expect(inject.kind === 'degradation' && inject.category).toBe('resource-failure');
  });
});

describe('⭐⭐ 层归属按能力真正所属,不一律 web.page', () => {
  it('⭐⭐ 控制类归 web.page,输入类归 web.input', () => {
    expect(LAYER_OF.ready).toBe('web.page');
    expect(LAYER_OF.scrollUntil).toBe('web.page');
    expect(LAYER_OF.tap).toBe('web.input');
    expect(LAYER_OF.press).toBe('web.input');
    expect(LAYER_OF.hover).toBe('web.input');
    expect(LAYER_OF.type).toBe('web.input');
  });

  it('⭐⭐ 归类结果里的 layer 跟着走(不是摆设)', () => {
    const tap = planTrace('tap', {}, { status: 'ok' }, 1);
    const ready = planTrace('ready', {}, { status: 'ok' }, 1);
    expect(tap.layer, 'tap 归错层 —— 按层查询会说谎').toBe('web.input');
    expect(ready.layer).toBe('web.page');
  });

  it('⭐ goto 归 web.page(它是控制动作,与 ready/scrollUntil 同层)', () => {
    expect(LAYER_OF.goto).toBe('web.page');
    // ⚠️ pageNames 读的是注册表不是页面 —— 与 anchors 同类,别因为名字带 page 就归 web.page
    expect(LAYER_OF.pageNames).toBe('web.trace');
  });

  it('⭐ 输出类能力也要归对层(pages/anchors 归 trace,readTabBar 归 dom)', () => {
    // 它们读的是「我们这一层看到了什么」,不是页面控制动作
    expect(LAYER_OF.pages).toBe('web.trace');
    expect(LAYER_OF.anchors).toBe('web.trace');
    // readTabBar 真的在页面上跑脚本读 DOM
    expect(LAYER_OF.readTabBar).toBe('web.dom');
  });

  it('⭐ 没登记的能力名有确定回落(不抛、不 undefined)', () => {
    const plan = planTrace('somethingNew', {}, { status: 'ok' }, 1);
    expect(plan.layer).toBe('web.page');
  });
});

describe('⭐ 日志后缀要带得出「为什么」', () => {
  it('failed 带 reason —— 两种成因排查方向相反,只打 status 分不开', () => {
    expect(describeWhy({ status: 'failed', reason: TIMEOUT_PLAIN })).toContain(TIMEOUT_PLAIN);
  });

  it('degraded 带 missing —— 不打等于没报', () => {
    expect(describeWhy({ status: 'degraded', missing: ['a', 'b'] })).toContain('a, b');
  });

  it('ok 不带噪音', () => {
    expect(describeWhy({ status: 'ok' })).toBe('');
  });

  it('⭐ failed 却没给 reason —— 如实说「这本身是 bug」,不糊弄过去', () => {
    expect(describeWhy({ status: 'failed' })).toContain('bug');
  });
});

describe('⭐ 入参摘要有上限(留痕不许把页面正文灌进去)', () => {
  /**
   * ⚠️ 上限从 200 放宽到 2000(2026-09-18)。
   *
   * 原因:autoCollect 的参数越加越多(page/tweets/saved/coverageGaps/
   * longText…),200 字符**正好把末尾几项切掉** —— 新加的 longText 统计
   * 在留痕里根本看不到,而且**不报错**:看起来像「没生成」,实际是「被截了」。
   *
   * ⭐ 但**上限本身必须留着**,守卫原来的理由完全成立:
   * 「留痕不许把页面正文灌进去」—— 某天有人把推文全文当参数传进来,
   * 留痕会被正文撑爆。2000 字既容得下结构化统计,也挡得住正文。
   *
   * ⭐ 而且截断现在**是显式的**(带「已截断,原长 N」),
   * 不再让人误以为数据没生成 —— 静默截断正是这次栽的坑。
   */
  it('⭐ 超长入参仍被截断(挡住把正文灌进留痕)', () => {
    const huge = { text: 'x'.repeat(50_000) };
    const plan = planTrace('type', huge, { status: 'ok' }, 1);
    if (plan.kind !== 'recovery') throw new Error('应为 recovery');
    expect(plan.detail.length, '没截断 —— 页面正文会把留痕撑爆').toBeLessThan(2100);
  });

  it('⭐⭐ 截断要**明说**,不许静默', () => {
    // 静默截断会让人以为「这个字段没生成」,而实际是「被切掉了」——
    // 两者的排查方向完全相反,这次就栽在这上面
    const huge = { text: 'x'.repeat(50_000) };
    const plan = planTrace('type', huge, { status: 'ok' }, 1);
    if (plan.kind !== 'recovery') throw new Error('应为 recovery');
    expect(plan.detail, '截断了却不说 —— 会被误读成「数据没生成」')
      .toMatch(/已截断|原长/);
  });

  it('⭐ 正常大小的结构化入参**不该**被截', () => {
    // autoCollect 那种十几个字段的报告必须完整留下来
    const report = {
      page: 'x.home', tweets: 84, fromPayload: 84, saved: 84,
      authorsWithRelation: 72, authorsWithBio: 80,
      longText: { count: 3, maxChars: 1847, avgChars: 156 },
      payloads: 9, coverageGaps: ['authorBio 80/84(95%)'],
      sampleIncomplete: '2/40', rounds: 30, dateDays: 684, dateGaps: 7,
    };
    const plan = planTrace('autoCollect', report, { status: 'ok' }, 1);
    if (plan.kind !== 'recovery') throw new Error('应为 recovery');
    expect(plan.detail, 'longText 被截掉了 —— 那正是要看的数字').toContain('longText');
    expect(plan.detail, '末尾字段被切').toContain('dateGaps');
    expect(plan.detail).not.toMatch(/已截断/);
  });
});
