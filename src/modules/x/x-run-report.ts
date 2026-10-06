/**
 * ⭐⭐⭐ **一跑的判断依据,落成一个文件** —— 2026-10-06
 *
 * 用户原话:「这两个你没有办法自行读取吗?」
 * ⚠️ 不能 —— 因为滚动停因与每轮游标**只渲染在面板上**,关掉就没了,
 * 于是我每次都得回头问人要截图。
 *
 * ⭐⭐ 这正是 `feedback-maintainability-over-feature-completion` 的原病:
 * 「X 采集面板一屏判断依据(接口名/深度/解析率/停止原因)**只渲染一次
 * 　关掉就没**,我核对只能反过来要用户截图」——
 * 用户当时点破的是「**你不记录如何做验证**」。
 * ⚠️⚠️ 我把它记成了「落原始载荷」,却没把**结论性的那几行**也落下来:
 * 真载荷解决的是「字段在哪」,而「为什么停在 200 人」要的是这份账。
 *
 * ⭐ 判据(用户定的):**下次验证能不能不靠人、只靠留下的东西说清楚**。
 * ⚠️ 所以**成功路径也要写** —— 不只失败时写;这次采集完全成功的依据,
 * 照样要留得下来。
 *
 * ⚠️ 本模块是**纯函数**:只把已有的事实排成字,不采集、不判断、不落盘。
 * 落盘由调用方做(它才有 `writeAudit` 这条通道)。
 */

import type { RunResult } from './x-collect-run';
import { buildStamp, buildAgeMinutes } from './x-build-stamp';

/** ⭐ 一跑里**人能据以判断**的事实 —— 全部来自 `RunResult`,不另算 */
export type RunReportInput = {
  readonly run: RunResult;
  /** ⭐ 人选的页(采集层不知道自己在哪一页) */
  readonly page: string;
  /** ⭐ 人填的页数 —— 「翻够了」还是「X 没了」要靠它分 */
  readonly wantPages: number;
  readonly at: string;
};

/**
 * ⭐⭐ **「撞上限」要单独认出来** —— 它与「滚到底」是完全不同的结论。
 * ⚠️ 2026-10-05 真机:面板一直写着「达到轮次上限 60」,
 * 而我盯着**翻页**那个停因,把它漏了两跑(following 卡在 150 人)。
 */
export function hitRoundCap(stopReason: string | undefined): boolean {
  return typeof stopReason === 'string' && stopReason.includes('轮次上限');
}

/**
 * ⭐⭐⭐ 排成人能读、也能 grep 的一页账。
 *
 * ⚠️ 每一行都要**自带判据**,不能只给数字 ——
 * 「翻页 16 轮」说明不了问题,「16 轮里 15 轮零新增、游标每轮都变」才说明。
 */
export function buildRunReport(input: RunReportInput): string {
  const { run, page, wantPages, at } = input;
  const L: string[] = [];
  const h = run.harvest;

  L.push(`X 采集留痕　${at}`);
  /**
   * ⭐⭐⭐ **这份代码什么时候构建的** —— 2026-10-06 真机逼出来的。
   * ⚠️⚠️ 改完代码让用户再采一次,数据纹丝不动、停因里连「抢救」都没有,
   * 两个人对着同一份输出纳闷 —— 真因是 **app 还跑着旧构建**。
   * ⭐ 印出来,「是不是旧构建」就从猜变成看一眼。
   */
  const age = buildAgeMinutes();
  L.push(`构建：${buildStamp()}`
    + (age === undefined ? '' : `（${age} 分钟前）`)
    + (age !== undefined && age > 30
      ? '　⚠️ 构建已超过 30 分钟 —— 如果刚改过代码,**这一跑可能跑的是旧版**,先重启 app'
      : ''));
  L.push(`页面：${page || '(认不出)'}　·　人填页数：${wantPages}`);
  L.push(`采到：${run.kind}　·　推文 ${run.summary?.items.length ?? 0}`
    + `　·　人 ${run.users.reduce((n, a) => n + a.items.length, 0)}`
    + `　·　响应 ${run.totalResponses}`);
  L.push('');

  /**
   * ⭐⭐⭐ **限流放在最前面** —— 2026-10-06 真机教训。
   * ⚠️⚠️ 被限流时下面所有的「滚到底/没有更多了」**全是假的**,
   * 先看到这一行,才不会去查滚动逻辑(我已经白查了七八轮)。
   */
  if (run.rateLimit !== undefined) {
    L.push('── ⚠️ 被限流 ──');
    L.push(run.rateLimit);
    L.push('');
  }

  // ── ① 滚动 ──
  L.push('── 滚动 ──');
  if (h) {
    L.push(`停因：${h.stopReason ?? '(没给)'}`);
    L.push(`轮数：${h.rounds ?? '?'}　·　滚动距离：${h.scrolledPx ?? '?'}px`
      + `　·　到底了：${h.reachedBottom === true ? '是' : '否'}`);
    /**
     * ⭐⭐ **结论写出来**,别让读的人自己推 ——
     * 「到上限」和「到底」差一个字,后果差一整个名单。
     */
    if (hitRoundCap(h.stopReason)) {
      L.push('⚠️⚠️ 是**撞到轮次上限**停的,不是滚到底 —— 名单多半还有，这个数不是全部');
    } else if (h.reachedBottom === true) {
      L.push('✓ 滚到底了 —— 这一页能滚出来的都在这儿了');
    }
  } else {
    L.push('(没有 harvest 报告)');
  }
  L.push('');

  // ── ② 翻页 ──
  L.push('── 翻页 ──');
  if (run.paging === null) {
    L.push('(这一跑没有主动翻页)');
  } else {
    const p = run.paging;
    L.push(`停因：${p.stopReason}`);
    L.push(`轮数：${p.rounds}　·　翻页新增：${p.freshTotal}`);
    const zero = p.rounds_detail.filter((d) => d.fresh === 0);
    const cursors = new Set(p.rounds_detail.map((d) => d.cursor));
    L.push(`零新增轮次：${zero.length}/${p.rounds_detail.length}`
      + `　·　不同游标：${cursors.size}/${p.rounds_detail.length}`);
    /**
     * ⭐⭐⭐ **这一句就是我每次要问人的那个问题的答案**:
     * 「游标没变」(我的 bug)和「游标变了 X 还回同一批」(请求形状的问题,
     * 跟『Followers 必须 POST』同族)是**完全不同的两个毛病**,
     * 光看总数分不出来 —— 所以这里直接把结论写死。
     */
    /**
     * ⭐⭐⭐ **样本太薄就别下结论** —— 2026-10-06 自己栽的。
     *
     * ⚠️⚠️ 第一版只要有一轮零新增就开口断言「多半是请求形状问题，去社区查」。
     * 真机第一跑:**总共 2 轮、1 轮零新增**,它就把人指向了社区 ——
     * 而「最后一轮零新增」恰恰是**翻到底的正常现象**(X 没有更多了)。
     * ⭐ 正是 `feedback-check-sample-contains-phenomenon` 的同一种病:
     * 拿一个撑不住结论的样本下结论,**制造假线索引人改没坏的代码**。
     *
     * ⚠️ 判据:至少 `MIN_ROUNDS_TO_JUDGE` 轮、且零新增**不止最后一轮**,
     * 才谈得上「翻不动」。够不着就如实说「样本太薄」——
     * 说不知道,比说一个错方向有用。
     */
    const MIN_ROUNDS_TO_JUDGE = 5;
    /**
     * ⭐⭐⭐ **零新增要占多数才值得怀疑** —— 2026-10-06 真机(成功那一跑)。
     *
     * ⚠️⚠️ 原先判据是「**有没有**零新增轮次」(`length > 0`):
     * 翻 100 轮采到 5050 人、99 轮都有新增,报告照样印着
     * 「多半是请求形状/端点的问题,去社区查」—— **一切正常时的误报**。
     * ⭐ 而第 1 轮零新增恰恰是**正常现象**:种子已经把头一页收了。
     * ⚠️ 误报比不报更坏:它在没问题时把人指向错方向,
     * 我今天已经为这类假线索浪费过好几轮(那条 429 也是)。
     *
     * ⭐ 取一半:真「翻不动」时是**连片**的零新增,不是零星一两轮。
     */
    const ZERO_RATIO_TO_WARN = 0.5;
    const lastRound = p.rounds_detail[p.rounds_detail.length - 1]?.round;
    const zeroBeforeEnd = zero.filter((d) => d.round !== lastRound);
    if (p.rounds_detail.length < MIN_ROUNDS_TO_JUDGE) {
      L.push(`（只翻了 ${p.rounds_detail.length} 轮，`
        + `不足 ${MIN_ROUNDS_TO_JUDGE} 轮——样本太薄，不下结论）`);
      if (zero.length > 0 && zeroBeforeEnd.length === 0) {
        L.push('　· 零新增只出现在**最后一轮**，那多半就是翻到底了，正常');
      }
    } else if (zeroBeforeEnd.length > p.rounds_detail.length * ZERO_RATIO_TO_WARN) {
      const allDistinct = cursors.size === p.rounds_detail.length;
      L.push(allDistinct
        ? '⚠️ 游标**每轮都在变**,人却不新增 → 不是游标 bug，'
          + '多半是请求形状/端点的问题（参考「Followers 必须 POST」那一族，去社区查）'
        : '⚠️ 有**重复的游标** → 是我们这边的 bug（取错了游标 / 没往前走）');
    }
    L.push('');
    /**
     * ⭐⭐ `取` 这一列:`body` = 脚本当场回的正文(主路),
     * `收` = 走 harvest 兜底收的。
     * ⚠️ 两条路混在一起的话,「主路坏了、兜底顶着」会被悄悄盖住 ——
     * 而那正是本仓反复出现的形态(载荷断了 DOM 顶着)。
     */
    const viaBodyN = p.rounds_detail.filter((d) => d.viaBody === true).length;
    L.push(`取数:主路(脚本回 body)${viaBodyN} 轮 / 兜底(harvest)`
      + `${p.rounds_detail.length - viaBodyN} 轮`);
    L.push('');
    L.push('轮次  新增  响应  取    游标');
    for (const d of p.rounds_detail) {
      L.push(`${String(d.round).padStart(4)}  ${String(d.fresh).padStart(4)}`
        + `  ${String(d.responses).padStart(4)}  ${d.viaBody === true ? 'body' : '收  '}`
        + `  ${d.cursor}`);
    }
  }
  L.push('');

  // ── ③ 解析出的问题 ──
  const problems = run.users.flatMap((a) => a.problems);
  L.push('── 解析问题 ──');
  L.push(problems.length === 0 ? '(无)' : problems.map((x) => `· ${x}`).join('\n'));
  L.push('');

  // ── ④ 字段覆盖率 ──
  /**
   * ⭐ 「不量的字段永远 100%」—— 覆盖率要**连同样本量**一起写,
   * 不然 100% 可能是「1 个人里 1 个有」。
   */
  L.push('── 字段覆盖率（人）──');
  const first = run.users.find((a) => a.items.length > 0);
  if (first === undefined) {
    L.push('(这一跑没解出人)');
  } else {
    for (const [k, v] of Object.entries(first.coverage)) {
      L.push(`${k.padEnd(10)} ${String(v).padStart(3)}%`);
    }
    L.push(`（样本：第一份账 ${first.items.length} 人）`);
  }

  return L.join('\n');
}
