/**
 * ⭐⭐ X 用网页的能力(Module5-04 第 3 步第 3a 批,2026-10-24)—— 主进程自己驱动左边 X 网页采 / 读的 9 个
 *
 * 占网页由执行器做(page: 写在锁上的用途);函数只干活(…On / …With)。第 1 步时这些函数在内部自己占锁,
 * 现在挪到执行器,调用方(界面 / 每天巡检 / 收件箱)一律 execute。
 * ⚠️ 例外:认号(x.account.identify)不声明占网页 —— 它多半只读页面就认出来了,只有要开自己主页时才占(在 identifyAccount 里);
 *   每次都占的话网页忙时就认不了号。
 */
import { capFailed, capRefused } from '@platform/main/capability/capability';
import { traceRecorder } from '@platform/main/web-capability/wiring/runtime';
import { digits, str, xCap, type O } from './x-capabilities-common';
import { identifyAccount } from './x-account-repo';
import { checkFollowBackOn, FOLLOW_CHECK_BUSY } from './x-follow-check';
import { RELATION_BUSY, startRelationTaskOn } from './x-relation-task';
import { prepareAskOn } from './x-ask-prepare';
import { prepareVpnOn } from './x-vpn-run';
import { screenEngageOn } from './x-engage-prepare';
import { loadEngageThread } from './x-engage-thread';
import { readLeftTweet } from './x-left-tweet';
import { collectEngagementWith } from './x-engage-collect';
import { followQueueStatus } from './x-follow-queue';
import { webviewPorts } from './x-collect-ports';
import { X_PAGE_NAME } from './x-pages';
import { getXHostState } from './x-host-registry';

const input = <I extends O>(def: Parameters<typeof xCap<I>>[1]): void => xCap('input', def);
const control = <I extends O>(def: Parameters<typeof xCap<I>>[1]): void => xCap('control', def);
const optDigits = (o: O, k: string): string | undefined => (o[k] === undefined || o[k] === '' ? undefined : digits(o, k));
const WS = { wsId: '哪个 workspace 的 X 网页' };

export function registerXPageCapabilities(): void {
  control({
    id: 'x.account.identify', describe: '认出这个 X 网页登录的是哪个号(handle + 数字 id);要拿数字 id 时会开一次自己的主页',
    inputDoc: WS, parse: (o) => ({ wsId: str(o, 'wsId') }),
    /** 网页没开 = 没动手(refused),和别的能力一致(2026-10-24 Windows 真机:原来 identifyAccount 判成 failed) */
    preflight: (i) => (getXHostState(i.wsId) ? null : 'X 网页没开,认不了号'),
    run: async (i) => {
      const r = await identifyAccount(i.wsId);
      traceRecorder.lifecycle({
        layer: 'web.net', event: `x-account-identify-${r.status}`, pageId: 'x-data',
        detail: { wsId: i.wsId, ...(r.status === 'ok' ? { handle: r.account.handle, restId: r.account.restId } : { reason: r.reason }) },
      });
      if (r.status === 'pending') throw capRefused(r.reason);
      if (r.status === 'failed') throw capFailed(r.reason);
      return r;
    },
  });

  input({
    id: 'x.followCheck.run', describe: '查回关:翻我自己的 followers 直到追上上次,记下谁新关注了我、求关的人回关没有(只读 X)',
    inputDoc: WS, parse: (o) => ({ wsId: str(o, 'wsId') }), page: () => FOLLOW_CHECK_BUSY,
    run: async (i, _a, page, caller) => {
      const r = await checkFollowBackOn(i.wsId, page.wcId, caller === 'timer' ? 'auto' : 'manual');
      if (!r.ran) throw r.failed ? capFailed(r.why) : capRefused(r.why);
      return r;
    },
  });

  control({
    id: 'x.relation.start', describe: '关系采集:读他(不给 = 我自己)主页上的关注数,和库里对一下,建一个采三个名单的后台任务',
    inputDoc: { ...WS, restId: '可选:他的数字 id(不给 = 我自己)', handle: '给了 restId 就要 handle' },
    parse: (o) => {
      const restId = optDigits(o, 'restId');
      return { wsId: str(o, 'wsId'), restId, handle: restId ? str(o, 'handle') : undefined };
    },
    page: () => RELATION_BUSY,
    subject: (i) => (i.restId ? `x_author:${i.restId}` : undefined),
    run: async (i, _a, page, caller) => {
      const r = await startRelationTaskOn(i.wsId, page.wcId, i.restId ? { restId: i.restId, handle: i.handle as string } : undefined, caller === 'timer' ? 'auto' : 'manual');
      traceRecorder.lifecycle({ layer: 'web.net', event: r.ok ? 'x-relation-start' : 'x-relation-start-refused', pageId: 'x-data',
        detail: r.ok ? { jobId: r.jobId, created: r.created, target: r.plan.target.handle, self: r.plan.self } : { why: r.why } });
      if (!r.ok) throw r.refused ? capRefused(r.why) : capFailed(r.why);
      return r;
    },
  });

  input({
    id: 'x.ask.prepare', describe: '求关卡准备:采他主页最新几页,按 X 现状核对关系,选一条可以求关的推文(只读,不发)', account: true,
    inputDoc: { ...WS, restId: '他的数字 id', handle: '他的 handle' },
    parse: (o) => ({ wsId: str(o, 'wsId'), restId: digits(o, 'restId'), handle: str(o, 'handle') }),
    preflight: (i) => (followQueueStatus(i.wsId).current ? '关注队列正在动作' : null),
    page: (i) => `求关卡:准备 @${i.handle}`,
    subject: (i) => `x_author:${i.restId}`,
    run: async (i, a, page) => {
      const r = await prepareAskOn(page.wcId, a.restId, i.restId, i.handle);
      traceRecorder.lifecycle({ layer: 'web.net', event: 'x-ask-prepare', pageId: 'x-data',
        detail: { handle: i.handle, ok: r.ok, kind: r.ok ? r.plan.kind : undefined, why: r.ok ? r.plan.why : r.why } });
      if (!r.ok) throw capFailed(r.why);
      return r;
    },
  });

  input({
    id: 'x.vpn.prepare', describe: '求助回复卡准备:库里这条求助帖 + 他的资料 + 来龙去脉(先看上一层确认真和 VPN 相关)', account: true,
    inputDoc: { ...WS, tweetId: '求助帖 id' },
    parse: (o) => ({ wsId: str(o, 'wsId'), tweetId: digits(o, 'tweetId') }),
    page: (i) => `求助回复卡:准备 ${i.tweetId}`,
    subject: (i) => `x_tweet:${i.tweetId}`,
    run: async (i, a, page) => {
      const r = await prepareVpnOn(page.wcId, a.restId, i.tweetId);
      if (!r.ok) throw capFailed(r.why);
      return r;
    },
  });

  input({
    id: 'x.engage.screen', describe: '互动先过一轮:采他主页最新一页,看 2 小时内有没有动静',
    inputDoc: { ...WS, restId: '他的数字 id', handle: '他的 handle', hisAt: '可选:他找我那条的时间(ISO)' },
    parse: (o) => ({ wsId: str(o, 'wsId'), restId: digits(o, 'restId'), handle: str(o, 'handle'), hisAt: typeof o.hisAt === 'string' ? o.hisAt : undefined }),
    page: (i) => `互动:先过一轮 @${i.handle}`,
    subject: (i) => `x_author:${i.restId}`,
    run: async (i, _a, page) => {
      const r = await screenEngageOn(page.wcId, i.restId, i.handle, i.hisAt);
      if (!r.ok) throw capFailed(r.why);
      return r;
    },
  });

  input({
    id: 'x.engage.thread', describe: '读一条推文的来龙去脉(原帖 → 来回 → 这条)', account: true,
    inputDoc: { ...WS, restId: '作者的数字 id', tweetId: '推文 id' },
    parse: (o) => ({ wsId: str(o, 'wsId'), restId: digits(o, 'restId'), tweetId: digits(o, 'tweetId') }),
    page: () => '互动卡:读来龙去脉',
    subject: (i) => `x_tweet:${i.tweetId}`,
    run: (i, a, page) => loadEngageThread(page.wcId, a.restId, i.restId, i.tweetId),
  });

  input({
    id: 'x.left.read', describe: '读左边 X 网页正在看的那条帖子(给了 open 就先打开那条)',
    inputDoc: { ...WS, open: '可选:先在左边打开这条推文 id(模拟人点开)' },
    parse: (o) => ({ wsId: str(o, 'wsId'), open: optDigits(o, 'open') }),
    page: (i) => (i.open ? `读左边那条(先打开 ${i.open})` : '读左边那条'),
    subject: (i) => (i.open ? `x_tweet:${i.open}` : undefined),
    run: async (i, _a, page) => {
      if (i.open) {
        const go = await webviewPorts(page.wcId).goto(X_PAGE_NAME.status, { tweetId: i.open });
        if (!go.ok) throw capFailed(`没打开那条推文:${go.reason}`);
      }
      const r = await readLeftTweet(page.wcId);
      if (!r.ok) throw capFailed(r.why);
      return r.tweet;
    },
  });

  input({
    id: 'x.engage.collect', describe: '采互动一段:搜「我回复过谁 / 谁回复过我 / 谁提到过我」,小段多次,按搜索额度避开限流', account: true,
    inputDoc: WS, parse: (o) => ({ wsId: str(o, 'wsId') }),
    page: () => '采互动(搜索)',
    run: async (i, a, page) => {
      const r = await collectEngagementWith(i.wsId, a, page.token);
      traceRecorder.lifecycle({ layer: 'web.net', event: 'x-engage-collect', pageId: 'x-data', detail: r });
      if (!r.ok) throw capFailed(r.why);
      return r;
    },
  });
}
