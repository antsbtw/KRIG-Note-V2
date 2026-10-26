/**
 * ⭐⭐ X 的 AI 类 + 对外动作能力(Module5-04 第 3 步第 4 批,2026-10-25)
 *
 * AI 类(input):判求助帖(Gemma)、草拟留言(Gemma)—— 只读库、写自己的判断 / 草稿,不对外。
 * 对外动作(output):求关发送(点赞 / 留言 / 关注)、关注队列 加入 / 继续 —— 执行器只接受人在界面上点的、
 *   或人排进队列后由定时器按节奏执行的;AI / 收件箱调用要人批复(批复入口 P3)。
 * 普通控制(control):关注队列 暂停 / 清空(只让它不动)。
 * ⚠️ 求关发送(runAsk)里那套保护(网页锁 / 关注队列在不在动 / 每步核对 / 留痕)原样保留在函数里 ——
 *   有一整套行为测试钉着(x-ask-run.test.ts);这里只把结果分成 没动手(refused)/ 做了一半(failed + partial)/ 成了。
 */
import { capFailed, capRefused } from '@platform/main/capability/capability';
import { getXDB } from '@storage/surreal/client';
import { traceRecorder } from '@platform/main/web-capability/wiring/runtime';
import type { ReplyLang } from '@shared/types/x-reply-types';
import { Bad, digits, int, modeOf, str, xCap, type O } from './x-capabilities-common';
import { judgeVpnPosts } from './x-vpn-run';
import { draftAskReply } from './x-ask-draft';
import { replyLangOf, vpnLink } from './x-vpn-help';
import { runAsk } from './x-ask-run';
import { addToFollowQueue, controlFollowQueue, followQueueStatus, type FollowItem } from './x-follow-queue';

const input = <I extends O>(def: Parameters<typeof xCap<I>>[1]): void => xCap('input', def);
const output = <I extends O>(def: Parameters<typeof xCap<I>>[1]): void => xCap('output', def);
const control = <I extends O>(def: Parameters<typeof xCap<I>>[1]): void => xCap('control', def);
const optStr = (o: O, k: string): string | undefined => (typeof o[k] === 'string' && o[k] !== '' ? (o[k] as string) : undefined);
const WS = { wsId: '哪个 workspace 的号' };

export function registerXActCapabilities(): void {
  input({
    id: 'x.vpn.judge', describe: '让 Gemma 判一批还没判的求助帖(值不值得回、是翻出去还是回国),一次最多 50 条', account: true,
    inputDoc: { ...WS, limit: '这一批判几条,1–50' },
    parse: (o) => ({ wsId: str(o, 'wsId'), limit: int(o, 'limit', 1, 50) }),
    run: async (i, a) => {
      const r = await judgeVpnPosts(a.restId, i.limit);
      /** left = -1 是「已经有一轮在判」的哨兵 —— 没动手 */
      if (r.left === -1) throw capRefused('已经有一轮判断在跑');
      return r;
    },
  });

  input({
    id: 'x.ask.draft', describe: '让 Gemma 草拟一句留言(求关 / 互动 / 回复求助);只写草稿,不发', account: true,
    inputDoc: {
      ...WS, tweetText: '他那条帖子的正文(不给就按 tweetId 到库里读)', mode: 'ask / engage / vpn,默认 ask', name: '可选:他的名字', bio: '可选:他的 Bio',
      context: '可选:来龙去脉(给 Gemma 看上文)', tweetId: '回复求助时要:那条帖子的 id', revise: '可选:{ previous, note, keep } 按点评改上一版',
    },
    parse: (o) => {
      const mode = modeOf(o.mode);
      const rv = o.revise as { previous?: unknown; note?: unknown; keep?: unknown } | undefined;
      if (rv !== undefined && (typeof rv.previous !== 'string' || typeof rv.note !== 'string' || rv.note.trim() === '')) throw new Bad('点评要上一版 + 点评内容');
      const tweetId = mode === 'vpn' ? str(o, 'tweetId') : optStr(o, 'tweetId');
      /** 只给帖子 id 也行(AI / 收件箱):正文到库里读 */
      if ((typeof o.tweetText !== 'string' || o.tweetText.trim() === '') && !tweetId) throw new Bad('要 tweetText(或只给 tweetId,到库里读正文)');
      return {
        wsId: str(o, 'wsId'), tweetText: typeof o.tweetText === 'string' ? o.tweetText : '', mode,
        name: optStr(o, 'name'), bio: optStr(o, 'bio'), context: optStr(o, 'context'),
        tweetId,
        revise: rv ? { previous: rv.previous as string, note: (rv.note as string).trim(), keep: rv.keep === true } : undefined,
      };
    },
    subject: (i) => (i.tweetId ? `x_tweet:${i.tweetId}` : undefined),
    run: async (i, a) => {
      let text = i.tweetText;
      if (text.trim() === '') {
        const [tw] = await getXDB().query<[Array<{ text?: string }>]>('SELECT text FROM x_tweet WHERE tweet_id = $id', { id: i.tweetId });
        text = tw?.[0]?.text ?? '';
        if (text === '') throw capFailed(`库里没有这条推文的正文(${i.tweetId})`);
      }
      let vpn: { link: string; lang: ReplyLang; direction?: 'out' | 'in' | 'none' } | undefined;
      if (i.mode === 'vpn') {
        const [post] = await getXDB().query<[Array<{ recipe?: string; verdict?: { direction?: 'out' | 'in' | 'none' } }>]>(
          `SELECT recipe, verdict FROM type::record('x_vpn_post', $id)`, { id: i.tweetId });
        const lang = replyLangOf(text);
        vpn = { link: vpnLink(lang, a.handle, post?.[0]?.recipe, new Date()), lang, direction: post?.[0]?.verdict?.direction };
      }
      const r = await draftAskReply({ account: a.restId, tweet: text, person: { name: i.name, bio: i.bio }, mode: i.mode, vpn, context: i.context, revise: i.revise });
      traceRecorder.lifecycle({ layer: 'web.net', event: r.ok ? 'x-ask-draft' : 'x-ask-draft-failed', pageId: 'x-data',
        detail: r.ok ? { ms: r.ms, examples: r.examples, text: r.text } : { why: r.why } });
      if (!r.ok) throw capFailed(r.why);
      return r;
    },
  });

  output({
    id: 'x.ask.run', describe: '求关 / 互动 / 回复求助:去那条推文点赞 → 留言 → (求关才)关注;每步核对、留痕',
    inputDoc: {
      ...WS, restId: '他的数字 id', handle: '他的 handle', tweetId: '那条推文 id', tweetText: '那条推文的正文',
      pickKind: 'tweet / bio-latest / other', reply: '留言(人确认过的终稿)', aiText: '可选:Gemma 原稿(判断是不是人改过)', mode: 'ask / engage / vpn',
    },
    parse: (o) => {
      if (!['tweet', 'bio-latest', 'other'].includes(String(o.pickKind))) throw new Bad('pickKind 只认 tweet / bio-latest / other');
      if (typeof o.reply !== 'string') throw new Bad('要 reply');
      return {
        wsId: str(o, 'wsId'), restId: digits(o, 'restId'), handle: str(o, 'handle'), tweetId: digits(o, 'tweetId'),
        tweetText: typeof o.tweetText === 'string' ? o.tweetText : '', pickKind: o.pickKind as 'tweet' | 'bio-latest' | 'other',
        reply: o.reply, aiText: optStr(o, 'aiText'), mode: modeOf(o.mode),
      };
    },
    subject: (i) => `x_author:${i.restId}`,
    run: async (i) => {
      const r = await runAsk(i);
      traceRecorder.lifecycle({ layer: 'web.net', event: 'x-ask-run', pageId: 'x-data',
        detail: { handle: i.handle, tweetId: i.tweetId, ok: r.ok, blocked: r.blocked, liked: r.liked, replied: r.replied,
          followed: r.followed, failedStep: r.failedStep, detail: r.detail } });
      if (r.blocked) throw capRefused(r.blocked);
      if (!r.ok) throw capFailed(r.detail ?? `${r.failedStep ?? '某一步'}没成`, r);
      return r;
    },
  });

  output({
    id: 'x.followQueue.add', describe: '把一批人排进关注队列(后台按节奏一个一个关注,异常即停)',
    inputDoc: { ...WS, items: '[{ restId, handle, reason? }]' },
    parse: (o) => {
      if (!Array.isArray(o.items) || o.items.length === 0) throw new Bad('items 要非空数组');
      const items = (o.items as O[]).map((x, n) => {
        if (!x || typeof x !== 'object' || typeof x.restId !== 'string' || typeof x.handle !== 'string') throw new Bad(`items[${n}] 要 restId + handle`);
        return { restId: x.restId, handle: x.handle, reason: typeof x.reason === 'string' ? x.reason : undefined } as FollowItem;
      });
      return { wsId: str(o, 'wsId'), items };
    },
    run: (i) => {
      const r = addToFollowQueue(i.wsId, i.items);
      traceRecorder.lifecycle({ layer: 'web.net', event: 'x-follow-queue-add', pageId: 'x-data', detail: { wsId: i.wsId, ...r } });
      return r;
    },
  });

  output({
    id: 'x.followQueue.resume', describe: '关注队列继续(接着去关注排着的人)', inputDoc: WS,
    parse: (o) => ({ wsId: str(o, 'wsId') }),
    run: (i) => {
      controlFollowQueue(i.wsId, 'resume');
      console.log(`[x.follow] ${i.wsId} resume`);
      return followQueueStatus(i.wsId);
    },
  });

  control({
    id: 'x.followQueue.control', describe: '关注队列暂停 / 清空(只让它不动,不对外)',
    inputDoc: { ...WS, action: 'pause / clear' },
    parse: (o) => {
      if (o.action !== 'pause' && o.action !== 'clear') throw new Bad('action 只认 pause / clear(继续用 x.followQueue.resume —— 那是对外动作)');
      return { wsId: str(o, 'wsId'), action: o.action as 'pause' | 'clear' };
    },
    run: (i) => {
      controlFollowQueue(i.wsId, i.action);
      console.log(`[x.follow] ${i.wsId} ${i.action}`);
      return followQueueStatus(i.wsId);
    },
  });
}
