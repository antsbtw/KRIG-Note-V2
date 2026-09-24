/**
 * ⭐⭐ 工作台的「编排执行与观察」pane —— 用户 2026-09-24 定的分层:
 *
 * > 「我建议编排和工作台是并列的……编排完毕,交给工作台执行和观察」
 *
 * | | 编排(将来独立视图) | 工作台(这里) |
 * |---|---|---|
 * | 时刻 | **设计时** | **运行时** |
 * | 做什么 | 定义步骤/顺序/参数 | 跑 + 看进度 + 看结果 |
 *
 * ⭐ 分开的好处:将来编排视图升级成画布,这里**完全不用动** ——
 *   它只消费 FlowProgress,不关心档是怎么画出来的。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const view = strip(readFileSync(
  join(process.cwd(), 'src/views/x-workbench/XWorkbenchView.tsx'), 'utf-8'));
const css = readFileSync(
  join(process.cwd(), 'src/views/x-workbench/x-workbench.css'), 'utf-8');

describe('⚠️⚠️ 多窗口:必须核对 wsId(不核对会串台)', () => {
  it('⭐⭐ 进度回调里要丢掉别的 ws 的事件', () => {
    /**
     * ⚠️ 广播是发给**所有 renderer** 的(main 侧 getAllWebContents 逐个 send)。
     * 不核对的话,多窗口下「别的窗口的进度显示在这里」——
     * 而且现象是「进度乱跳」,极难定位(记忆:宿主广播×多ws扇出)。
     */
    const i = view.indexOf('onFlowProgress');
    expect(i, '面板没订阅编排进度 —— 长任务仍是黑箱').toBeGreaterThan(0);
    const blk = view.slice(i, i + 600);
    expect(blk, '进度回调没核对 wsId —— 多窗口下会显示别的窗口的进度')
      .toMatch(/p\.wsId !== workspaceId/);
  });
});

describe('⭐⭐ 长步骤要有「已跑了多久」', () => {
  it('⚠️ 正在跑的那步必须显示已用时(判断那步 5.5 分钟)', () => {
    /**
     * ── 实测 ──
     * 四步耗时 0.1s / 30.8s / **330.8s** / 0.5s。
     * 没有「已跑 N 秒」的话,判断那步就是 5 分钟不动 ——
     * 用户上次就是因此说「没有任何反应」。
     */
    expect(view, '没有 running 态的已用时 —— 长步骤看着像卡死')
      .toMatch(/已跑 \{live\}s|已跑 \$\{live\}s/);
  });

  it('⚠️⚠️ 计时器只在有步骤在跑时开(不许常驻)', () => {
    /** ⚠️ 常驻 timer 是本仓已知坑(必须在 before-quit 有停止调用) */
    /**
     * ⚠️⚠️ 2026-09-24 这条**自己假绿过一次**:原来往前切 300 字,
     * 把**上一个 effect** 里的 `p.status === 'running'` 带了进来 ——
     * 删掉真正的守卫条件后它仍然命中。
     * ⭐ 改成钉**这个 effect 自己的那行**:`flowSteps.some(... 'running')`。
     */
    const i = view.indexOf('setInterval');
    expect(i, '没有计时器 —— 已用时不会动').toBeGreaterThan(0);
    /** ⚠️ 只往前切到 effect 开头,不跨到上一个 effect */
    const start = view.lastIndexOf('useEffect', i);
    expect(start, '找不到计时器所在的 effect').toBeGreaterThan(0);
    const blk = view.slice(start, i + 200);
    expect(blk, '计时器常驻了 —— 没在跑也每秒刷新')
      .toMatch(/flowSteps\.some\([\s\S]*?'running'/);
    expect(blk, '没有清理 —— 会泄漏').toMatch(/clearInterval/);
  });
});

describe('⭐ 「为什么」比数字要紧', () => {
  it('⚠️⚠️ 每步要显示 note/error,不能只显示产出数', () => {
    /**
     * ⚠️ 实测教训:编排报「跳过 10 条」而不说为什么,
     * 用户第一反应就是要去查 —— **编排的价值正是消灭这个「再去查一次」**。
     */
    expect(view, '没显示 error —— 失败了看不出原因').toMatch(/st\.error/);
    expect(view, '没显示 note —— 跳过原因/停止原因都在里面').toMatch(/st\.note/);
  });

  it('⭐ 断在哪一步要说出来', () => {
    expect(view, '没报「断在哪一步」—— 人还得自己去找')
      .toMatch(/failedAt/);
  });

  it('⚠️ 跳过/未开始的步骤也要显示(否则以为没这一步)', () => {
    expect(view, "没有 skipped 的显示").toMatch(/'skipped'/);
    expect(view, '没有 idle(未开始)的显示').toMatch(/'idle'/);
  });
});

describe('⚠️ 接线与样式', () => {
  it('⭐ 用的 CSS class 必须真的存在(否则样式静默失效)', () => {
    /** ⚠️ 2026-09-24 实测:我用了 krig-xwb__hint 而 CSS 里没有,样式会静默没有 */
    const used = [...view.matchAll(/className="(krig-xwb__[a-z-]+)"/g)].map((m) => m[1]);
    const missing = [...new Set(used)].filter((c) => !css.includes(`.${c}`));
    expect(missing, `这些 class 用了但 CSS 里没有:${missing.join(', ')}`).toEqual([]);
  });

  it('⭐ 停止按钮只在跑的时候出现', () => {
    /**
     * ⚠️⚠️ 锚点不能用 `stopFlow` —— **第一处是函数定义**(209 行),
     * 真正的按钮在 306 行,切出来的是无关代码。
     * ⭐ 用 `onClick={stopFlow}` —— 它只在按钮那一处出现。
     * (本会话第四次栽在 indexOf 命中错位置,见 feedback-guard-scope-to-the-branch)
     */
    const i = view.indexOf('onClick={stopFlow}');
    expect(i, '没有停止按钮 —— 长任务停不下来').toBeGreaterThan(0);
    const blk = view.slice(Math.max(0, i - 400), i + 100);
    expect(blk, '停止按钮没有「跑着才显示」的门控 —— 不跑时按不动的按钮是噪音')
      .toMatch(/flowRunning \?/);
  });

  it('⚠️ 工作台**不编辑**编排档(那是编排视图的事)', () => {
    /**
     * ⭐ 用户定的分层:编排=设计时,工作台=运行时。
     * 工作台里出现步骤编辑,两个视图就又混成一个了。
     */
    for (const forbidden of ['setFlowRecipe', 'addStep', 'moveStep', 'reorderSteps']) {
      expect(view, `工作台里出现了 ${forbidden} —— 编辑档是编排视图的事`)
        .not.toMatch(new RegExp(forbidden));
    }
  });
});
