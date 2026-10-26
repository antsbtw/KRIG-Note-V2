/**
 * ⭐⭐⭐ X 的能力登记(Module5-04 第 2 步,2026-10-23)—— 往平台能力目录里登记,删 X 目录即卸载
 *
 * 先接形状差最大的三个(先用真东西试形状,定了再铺 —— Module5-04 §5):
 *   x.engage.prepare  占网页:采他主页 + 读来龙去脉 → 互动卡
 *   x.vpn.find        花搜索额度:四条 VPN 配方各搜最近 24 小时 → 登记求助帖(整轮占着网页)
 *   x.engage.overview 纯读库:互动名单(我的互关蓝V、最近谁找过我…)
 *
 * 前提检查(认号 / 网页开没开 / 额度)写在这里一份,三个入口(界面 / 定时器 / 收件箱)都不再自己查。
 * ⚠️ 只在主进程 import(x/main.ts 调 registerXCapabilities)。
 */
import { defineCapability, capFailed, type Prepared } from '@platform/main/capability/capability';
import { getXHostState } from './x-host-registry';
import { pageResource } from './x-page-lock';
import { registerXReadCapabilities } from './x-capabilities-read';
import { registerXWriteCapabilities } from './x-capabilities-write';
import { registerXPageCapabilities } from './x-capabilities-page';
import { registerXCollectCapabilities } from './x-capabilities-collect';
import { registerXActCapabilities } from './x-capabilities-act';
import { registerXFlows } from './x-flows';
import { registerCardQueueCapabilities } from './x-card-queue';
import { registerXTimerCapabilities } from './x-capabilities-timer';
import { pageNeed, wsAccount } from './x-capabilities-common';
import { searchBudget } from './x-search-budget';
import { prepareEngageOn } from './x-engage-prepare';
import { findVpnPostsWith } from './x-vpn-run';
import { readEngageOverview } from './x-engage-repo';
import { listAllRecipes } from '@platform/main/db/search-recipe-repo';
import { VPN_RECIPES } from './x-vpn-help';

export const X_CAP = {
  engagePrepare: 'x.engage.prepare',
  vpnFind: 'x.vpn.find',
  engageOverview: 'x.engage.overview',
} as const;

// ── 公用的前提检查(原来散在 x-data-ipc accountOfWs / 各函数开头 / 收件箱里,各写各的)──

type Acc = { readonly restId: string; readonly handle: string };

const isWs = (v: unknown): v is string => typeof v === 'string' && v !== '';
const obj = (raw: unknown): Record<string, unknown> => (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {});

let registered = false;

export function registerXCapabilities(): void {
  if (registered) return;
  registered = true;
  /** 第 3 步第 1 批:26 个读库能力(x-capabilities-read.ts) */
  registerXReadCapabilities();
  /** 第 3 步第 2 批:15 个改库能力(x-capabilities-write.ts) */
  registerXWriteCapabilities();
  /** 第 3 步第 3a 批:9 个用网页的(x-capabilities-page.ts) */
  registerXPageCapabilities();
  /** 第 3 步第 3b 批:采集流水线 10 个(x-capabilities-collect.ts) */
  registerXCollectCapabilities();
  /** 第 3 步第 4 批:AI 类 + 对外动作(x-capabilities-act.ts) */
  registerXActCapabilities();
  /** 第 4 步 4b:流程(原来写在界面里的循环,x-flows.ts) */
  registerXFlows();
  /** 第 4 步 4c:卡片队列(x-card-queue.ts) */
  registerCardQueueCapabilities();
  /** 收尾(10-26):定时器调的两个(后台采一段 / 关注一个人)—— 占锁、记录归执行器 */
  registerXTimerCapabilities();

  defineCapability<{ wsId: string; restId: string; handle: string; hisTweetId?: string }, unknown, { wcId: number; acc: Acc }>({
    id: X_CAP.engagePrepare,
    kind: 'input',
    describe: '互动卡准备:采他主页最新几页,按 X 现状核对还是不是互关,选一条该回的推文并读它的来龙去脉(只读,不发)',
    inputDoc: { wsId: '哪个 workspace 的 X 网页', restId: '他的数字 id', handle: '他的 handle(不带 @)', hisTweetId: '可选:他找过我的那条推文 id' },
    parse: (raw) => {
      const o = obj(raw);
      if (!isWs(o.wsId)) return '要 wsId';
      if (typeof o.restId !== 'string' || !/^\d+$/.test(o.restId)) return 'restId 要数字 id';
      if (typeof o.handle !== 'string' || o.handle === '') return '要 handle';
      if (o.hisTweetId !== undefined && (typeof o.hisTweetId !== 'string' || !/^\d*$/.test(o.hisTweetId))) return 'hisTweetId 要数字 id';
      return { wsId: o.wsId, restId: o.restId, handle: o.handle, hisTweetId: o.hisTweetId ? (o.hisTweetId as string) : undefined };
    },
    prepare: async (i): Promise<Prepared<{ wcId: number; acc: Acc }>> => {
      const acc = await wsAccount(i.wsId);
      if ('refused' in acc) return acc;
      const p = pageNeed(i.wsId, `互动卡:准备 @${i.handle}`);
      if ('refused' in p) return p;
      return { needs: [p.need], ctx: { wcId: p.wcId, acc } };
    },
    run: async (i, ctx) => {
      const r = await prepareEngageOn(ctx.prep.wcId, ctx.prep.acc.restId, i.restId, i.handle, i.hisTweetId);
      if (!r.ok) throw capFailed(r.why);
      return r;
    },
    subject: (i) => `x_author:${i.restId}`,
    summarize: (out) => {
      const r = out as { plan?: { kind?: string; why?: string; tweet?: { id?: string } }; ledgerProblem?: string };
      return { plan: r.plan?.kind, why: r.plan?.why, tweet: r.plan?.tweet?.id, ledgerProblem: r.ledgerProblem };
    },
  });

  defineCapability<{ wsId: string }, unknown, { acc: Acc }>({
    id: X_CAP.vpnFind,
    kind: 'input',
    describe: '找求助帖:库里的 VPN 配方各搜最近 24 小时,新帖登记进求助名单;花搜索额度,撞限流就停(只读,不发)',
    inputDoc: { wsId: '哪个 workspace 的 X 网页' },
    parse: (raw) => {
      const o = obj(raw);
      return isWs(o.wsId) ? { wsId: o.wsId } : '要 wsId';
    },
    prepare: async (i): Promise<Prepared<{ acc: Acc }>> => {
      const acc = await wsAccount(i.wsId);
      if ('refused' in acc) return acc;
      /** ⭐ 额度在执行器这一道查(原来界面「再找一轮」不查额度,Module5-04 §1.2) */
      const b = searchBudget();
      if (b.waitUntil !== undefined) {
        return { refused: `刚撞过搜索限流,${new Date(b.waitUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 后再找` };
      }
      if (b.freePages < 1) return { refused: `搜索额度用完了(最近 15 分钟用了 ${b.usedPages} 页),过一会儿再找` };
      /** 一条配方都没有 = 什么也不会做 → refused,不去占网页(2026-10-23 Windows 新库真机:原来先占网页才发现) */
      const names = new Set((await listAllRecipes()).map((r) => r.name));
      if (!VPN_RECIPES.some((n) => names.has(n))) return { refused: `库里没有 VPN 配方(${VPN_RECIPES.join(' / ')})—— 先在配方里建` };
      const p = pageNeed(i.wsId, '找求助帖(配方搜索)');
      if ('refused' in p) return p;
      return { needs: [p.need], ctx: { acc } };
    },
    run: async (i, ctx) => {
      const wcId = getXHostState(i.wsId)?.wcId;
      const token = wcId === undefined ? undefined : ctx.held.get(pageResource(wcId));
      if (token === undefined) throw capFailed('占着的 X 网页不见了(中途被关掉?)');
      const r = await findVpnPostsWith(i.wsId, ctx.prep.acc.restId, token);
      if (!r.ok) throw capFailed(r.why);
      return r;
    },
  });

  defineCapability<{ wsId: string; limit: number }, unknown, { acc: Acc }>({
    id: X_CAP.engageOverview,
    kind: 'input',
    describe: '互动名单:我的互关蓝V 数、最近谁回复 / 提到过我、哪些很久没互动(纯读库,不碰网页)',
    inputDoc: { wsId: '哪个 workspace 的号', limit: '「很久没互动」最多列几个,1–500,默认 10' },
    parse: (raw) => {
      const o = obj(raw);
      if (!isWs(o.wsId)) return '要 wsId';
      const limit = o.limit === undefined ? 10 : o.limit;
      if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 500) return 'limit 要 1–500';
      return { wsId: o.wsId, limit: limit as number };
    },
    prepare: async (i) => {
      const acc = await wsAccount(i.wsId);
      return 'refused' in acc ? acc : { ctx: { acc } };
    },
    run: async (i, ctx) => readEngageOverview(ctx.prep.acc.restId, ctx.prep.acc.handle, i.limit),
  });
}
