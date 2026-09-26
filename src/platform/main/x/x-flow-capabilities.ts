/**
 * ⭐⭐ **X 业务的能力适配器** —— 把编排器的四个槽接到现成的 X 能力上。
 *
 * ── 这里**只做两件事** ──
 * ① 参数转换(编排档里的 params → 能力的入参)
 * ② 结果归一(能力各自的返回形状 → `FlowStepOutcome`)
 *
 * ⚠️ **绝不写业务逻辑**。一旦这里开始「先查候选、再判断要不要跑」,
 * 就成了第二份实现 —— 两份必漂,而漂的表现是
 * 「手点能跑、编排跑出来的不一样」,极难查。
 *
 * ⚠️ 拟回复那步的准备工作(候选池/已回记录/指纹计数/账号)**没有抄过来**,
 * 而是调 `planReplyBatch`(2026-09-23 从 handler 里抽出来的共用函数)——
 * 那几样缺一个,拟出来的回复就会重复打扰人,而且**在结果里看不出来**。
 */

import type { FlowCapabilities } from '../flow/flow-runner';
import type { FlowStepOutcome } from '@shared/types/flow-recipe-types';
import { autoCollect } from './x-auto-collect';
import { runJudgeBatch, getJudgeConfig } from './x-ai-judge';
import { planReplyBatch } from './x-timeline-handlers';
import { prefetchReplyContext } from './x-prefetch-context';
import { XPageResolver } from './x-pages';
import { resolveXWebContents } from './x-webcontents';

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** 参数里的 wcId —— 编排档可以指定,不指定就让能力自己找 */
const wcOf = (p: Record<string, unknown>): number | undefined => num(p.wcId);

export function makeXFlowCapabilities(): FlowCapabilities {
  const resolver = new XPageResolver();

  return {
    /**
     * ① 导航到语义页面。
     * ⚠️ 收**语义页面名 + 参数**,不收 URL —— URL 是 adapter 的知识
     * (面板那条守卫「不许构造 x.com URL」同一道理)。
     */
    async goto(params, _wsId): Promise<FlowStepOutcome> {
      const t0 = Date.now();
      const page = str(params.page);
      if (!page) {
        return { ok: false, produced: 0, error: 'goto 缺 page(语义页面名)', elapsedMs: Date.now() - t0 };
      }
      const resolved = resolver.resolve(page, (params.params ?? {}) as Record<string, string>);
      if (!resolved) {
        /** ⚠️ fail loud:参数不全时说清楚是哪一页,别让人去猜 */
        return {
          ok: false, produced: 0,
          error: `页面「${page}」的参数解析不出 URL(参数不全?)`,
          elapsedMs: Date.now() - t0,
        };
      }
      const wc = resolveXWebContents(wcOf(params));
      if ('error' in wc) {
        return { ok: false, produced: 0, error: wc.error, elapsedMs: Date.now() - t0 };
      }
      await wc.wc.loadURL(resolved.url);
      return {
        ok: true, produced: 1, note: `已到 ${resolved.describe}`, elapsedMs: Date.now() - t0,
      };
    },

    /**
     * ② 采集(滚动 + 展开 + 解析 + 入库 + 补长文正文)。
     * ⭐ 一步就是一整个 `autoCollect` —— **不拆更细**:
     *   内部那几件事必须一起发生才有意义(2026-09-23 定的颗粒度)。
     */
    async collect(params, wsId): Promise<FlowStepOutcome> {
      const t0 = Date.now();
      const page = str(params.page);
      if (!page) {
        return { ok: false, produced: 0, error: 'collect 缺 page(语义页面名)', elapsedMs: Date.now() - t0 };
      }
      const resolved = resolver.resolve(page, (params.params ?? {}) as Record<string, string>);
      if (!resolved) {
        return {
          ok: false, produced: 0,
          error: `页面「${page}」的参数解析不出 URL(参数不全?)`,
          elapsedMs: Date.now() - t0,
        };
      }
      const r = await autoCollect(resolved.url, wcOf(params), {
        wsId,
        maxRounds: num(params.maxRounds),
        budgetMs: num(params.budgetMs),
        pageBudget: num(params.pageBudget),
        pageLabel: page,
        ownerHandle: str((params.params as Record<string, string> | undefined)?.handle),
      });
      if ('error' in r) {
        return { ok: false, produced: 0, error: r.error, elapsedMs: Date.now() - t0 };
      }
      /**
       * ⚠️ **采到 0 条不算失败** —— 可能这一页真没有(如搜索词冷门)。
       * 但要把「为什么停」带上,否则人看到 0 只能猜。
       */
      return {
        ok: true, produced: r.saved,
        note: `采 ${r.tweets} 条 / 入库 ${r.saved} 条 · ${r.stopReason}`,
        elapsedMs: Date.now() - t0,
      };
    },

    /**
     * ③ AI 判断哪些值得回复。
     * ⚠️ `judged === 0` 有**两种**含义,必须分开(`JudgeBatchResult` 已经区分了):
     *   `fetched === 0` → 队列真空了(正常)
     *   `fetched > 0`   → 取到了却一条没判成(**模型有问题**)
     */
    async judge(params, wsId): Promise<FlowStepOutcome> {
      const t0 = Date.now();
      const cfg = getJudgeConfig();
      const r = await runJudgeBatch(
        { ...cfg, batchSize: num(params.batchSize) ?? cfg.batchSize },
        wsId,
      );
      const stuck = r.fetched > 0 && r.judged === 0;
      return {
        /** ⭐ 取到了却一条没判成 = 真故障,不能报成功 */
        ok: !stuck,
        produced: r.judged,
        error: stuck ? `取到 ${r.fetched} 条却一条都没判成 —— 模型没覆盖这些 id` : undefined,
        note: r.fetched === 0
          ? '待判队列是空的(不是故障)'
          : `判了 ${r.judged}/${r.fetched} 条,其中值得回复 ${r.worth} 条`,
        /**
         * ⭐⭐ **闸门在这里** —— 用户 2026-09-26:
         * 「既然值得回复是零条,为什么第四步还需要跑呢?」
         *
         * ⚠️ 闸门是 `worth` **不是 `produced`**:`produced` 是「判了几条」,
         * 判了 10 条而 worth=0 时照样该刹车。
         * 这个数**一直都算出来了**,只是原来只写进给人看的 note,编排读不到。
         */
        hasCandidates: r.worth > 0,
        /**
         * ⭐ 观察点:判断步的判据 = 这批的三个数。
         * ⚠️ 逐条的 verdict+理由在 `x_tweet.ai_verdict`,那张表**有 TTL**;
         * 这里先记汇总,逐条留痕等 §5.3 的 evidence.items 落地再补
         * (别现在就把整批推文塞进来 —— flow_step_run 会被撑爆)。
         */
        evidence: { items: [{ fetched: r.fetched, judged: r.judged, worth: r.worth }] },
        elapsedMs: Date.now() - t0,
      };
    },

    /**
     * ③ 备料 —— 给这一批候选补齐「作者 bio」与「这一楼的上文」。
     *
     * ── 用户 2026-09-26 ──
     * > 「针对目标数据，获取对应的 bio-上下文--打包」
     * > 「这一步应该是先查询数据库，有就即可获取，没有再从 x 上定位获取。」
     *
     * ⚠️ 这一步原来**根本不在编排里** —— 两个预取只挂在收件箱面板的按钮上。
     * 手点时人就是那根接线;编排一跑,拟回复拿到的推**没 bio 也没上文**。
     */
    async prefetch(params, wsId): Promise<FlowStepOutcome> {
      const t0 = Date.now();
      const r = await prefetchReplyContext({
        wsId,
        wcId: wcOf(params),
        limit: num(params.limit),
        status: str(params.status) as never,
        replied: false,
        /**
         * ⚠️ 编排**要按 wsId 过滤** —— `planReplyBatch` 就是按 wsId 取候选的,
         * 不过滤会给别的 ws 的推白备料(而且白跳详情页)。
         * ⚠️ 与收件箱面板口径相反,那边**不过滤**(见 PrefetchOptions 注释)。
         */
        filterByWs: true,
        /** ⭐ 上文深度是变量 —— 编排档里可调 */
        contextDepth: num(params.contextDepth),
      });

      /**
       * ⚠️ **机制可疑要报失败**:采不到单个账号是常事,
       * 但连着一串都采不到多半是采集机制坏了(X 改版让载荷截不到)。
       * 那时继续往下拟回复,用户会在毫不知情下拿到一堆「只读正文」的建议。
       */
      const ok = !r.mechanismSuspect;
      return {
        ok,
        /** 产出 = 这一步真的补上了多少样东西(bio + 上文) */
        produced: r.bio.fetched + r.context.fetched,
        error: ok ? undefined
          : `连续采不到 —— 疑似采集机制坏了(${r.errors.slice(0, 2).join('; ')})`,
        note: `备料 ${r.scanned} 条:bio ${r.bio.cached} 条库里有/`
          + `${r.bio.fetched} 条现采(共 ${r.bio.authors} 人)· `
          + `上文 ${r.context.cached} 条库里有/${r.context.fetched} 条现采`
          + (r.context.fetched > 0 ? `(平均 ${r.context.avgDepth.toFixed(1)} 条/楼)` : '')
          + (r.context.failed > 0 ? ` · ⚠️ ${r.context.failed} 条没抓到` : ''),
        /**
         * ⚠️ **备料不当闸门**:没料也能拟回复(只是质量差),
         * 不像判断那样「没候选就无事可做」。所以这里**不表态**。
         */
        payload: { scanned: r.scanned },
        /** ⭐ 观察点:「先查库」到底省了多少、现采成功率多少 */
        evidence: { items: [{ bio: r.bio, context: r.context, errors: r.errors }] },
        elapsedMs: Date.now() - t0,
      };
    },

    /**
     * ④ 拟回复草稿 —— ⚠️ **只填不发**(用户定的红线,这里不碰发布)。
     */
    async planReply(params, wsId): Promise<FlowStepOutcome> {
      const t0 = Date.now();
      if (!wsId) {
        /** ⚠️ 缺 wsId 会跨 ws 混批 —— 与 handler 同一道守卫 */
        return { ok: false, produced: 0, error: 'planReply 需要 wsId(否则会跨 ws 混批)', elapsedMs: Date.now() - t0 };
      }
      const r = await planReplyBatch(wsId, {
        limit: num(params.limit),
        ref: str(params.ref),
        /**
         * ⭐ 哪一跑拟的 —— 由编排器注入(`__runId`)。
         * ⚠️ 没有它,库里的草稿说不清「这批是哪次编排的产物」,
         * 回头对账「哪次质量好」就无从查起(2026-09-24 实测漏掉过)。
         */
        runId: str(params.__runId),
      });
      /**
       * ⭐⭐ **跳过的理由要分类报出来** —— 2026-09-24 实测:
       * 编排报「扫了 10 条,拟出 0 条,跳过 10 条」,而**为什么跳**一个字没有。
       * 于是「模型都说不值得回」和「这 10 条早就回过了」长得一模一样,
       * 只能再去翻代码/查库才知道 —— 那正是编排该消灭的东西。
       *
       * ⚠️ 用 `skipReason` 聚合(already_replied / blocked_author /
       * duplicate / ai_declined / low_confidence …),不列具体条目:
       * 编排报告是给人看「这一步发生了什么」,不是给人看全量数据。
       */
      const byReason = new Map<string, number>();
      for (const sk of r.skips as Array<{ skipReason?: string }>) {
        const k = sk?.skipReason ?? 'unknown';
        byReason.set(k, (byReason.get(k) ?? 0) + 1);
      }
      const reasons = [...byReason.entries()]
        .sort((a2, b2) => b2[1] - a2[1])
        .map(([k, n]) => `${k}×${n}`)
        .join(' · ');
      /**
       * ⭐⭐ **落库结果要如实报** —— 2026-09-24 用户拍板落库
       * (「这是未来AI学习和优化的环节」)。
       *
       * ⚠️ 「拟出 N 条」与「存进去 N 条」**必须分开报**:
       * 之前报「拟出 6 条」而库里一条都没有,正是本仓最忌的「看着成功实际没有」。
       * ⭐ 两个数相等才算真成;不等就把失败条数摆出来。
       */
      const pst = r.persisted;
      const note0 = !pst || r.drafts.length === 0
        ? ''
        : pst.failed > 0
          ? ` ⚠️ **${pst.failed} 条没存进库**(${pst.errors[0] ?? ''})`
          : ` · 已落库 ${pst.saved} 条`;
      return {
        ok: true, produced: r.drafts.length,
        note: r.scanned === 0
          ? '没有「值得回复且还没回过」的候选(不是故障)'
          : `扫了 ${r.scanned} 条,拟出 ${r.drafts.length} 条草稿`
            + (r.skips.length ? `,跳过 ${r.skips.length} 条(${reasons})` : '')
            + note0,
        elapsedMs: Date.now() - t0,
      };
    },
  };
}
