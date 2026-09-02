/**
 * 「取某账号的全部发言」实机诊断 —— 用户 2026-09-02 定位:
 * 这是**画像获取的基础方法**,不是 watchlist 的实现细节。
 *   「要获取这个用户的画像,第一步就是通过推文主页,
 *     获取他发出的所有的推文以及回复的推文。」
 *
 * ⚠️ 一次性诊断工具,只读不写(不落库、不改状态)。方法定稿后应删除或收编。
 *
 * ── 为什么走个人主页而不是搜索 ─────────────────────────────────
 * 原设计去试 `from:x include:replies` / `filter:replies` 哪种搜索语法有效,
 * 方向偏了。用户指出个人主页本就有 Replies 标签页(/with_replies),
 * 且回复与被回复的原推**上下相邻渲染**,关系是页面结构自带的。
 *   · 搜索语法易变(交接文档 §4.1 明说不可信);/<handle>/with_replies 是一级导航,稳定
 *   · 搜索要从 DOM 猜「Replying to」;主页里父推就在紧邻位置
 *   · 搜索受索引延迟/限流;主页就是发言全集
 *
 * ── 本工具要回答的三个问题(都不预设答案)───────────────────────
 * ① **配对结构**:「他的回复」与「被回复的原推」是两个相邻 article,
 *    还是同一 article 内的两段?→ 决定怎么还原 in_reply_to
 * ② **时间覆盖**:滚 N 轮能覆盖多少天?→ 决定「回溯窗口」变量的可行上限。
 *    个人主页**没有 since: 参数**,只能从最新往下滚到够为止,
 *    所以窗口越大轮次越多,成本线性增长 —— 要实测数字,不能猜。
 * ③ **加载上限**:滚不动了是「到底了」还是「被限流/懒加载封顶」?
 *    真有上限必须**如实说明边界**,不能假装取全了(feedback-fail-loud-no-fallback)。
 *
 * ── 判读顺序(2026-09-02 踩过的倒果为因,别再犯)──────────────
 * 曾拿「库里 856 行 in_reply_to 全为 NONE」论证「选择器取错」—— 不成立:
 * 那 856 行全来自关键词配方(搜 VPN 求助),返回的本就是原创推,
 * **样本里根本没有回复**,字段为空是应然。且它与「我们自建的回复功能」无关
 * (用户没用过那个功能)。追踪对象是 **X 上「他回复别人」那条推本身**。
 * → 必须先抓到确实含回复的一批,再看字段有没有值。
 */

import { resolveXWebContents } from './x-webcontents';
import { normalizeHandle } from '@shared/types/x-timeline-types';

/**
 * 页面探针:枚举当前 DOM 里的所有 article,逐条报告
 * 作者 / 时间 / 是否本人 / 「Replying to」提示 / 在文档中的序号。
 *
 * 序号是关键 —— 用它判断①:若「他的回复」总是紧跟在「别人的原推」之后,
 * 则相邻 article 配对成立;否则得另寻办法。
 */
const SCAN_JS = `(function (selfHandle) {
  var arts = document.querySelectorAll('article[data-testid="tweet"]');
  var items = [];

  for (var i = 0; i < arts.length; i++) {
    var a = arts[i];
    var handle = '';
    try {
      var un = a.querySelector('[data-testid="User-Name"]');
      if (un) {
        var sp = un.querySelectorAll('span');
        for (var j = 0; j < sp.length; j++) {
          var t = (sp[j].textContent || '').trim();
          if (t.indexOf('@') === 0) { handle = t; break; }
        }
      }
    } catch (e) {}

    var createdAt = null, url = null;
    try {
      var te = a.querySelector('time');
      if (te) {
        createdAt = te.getAttribute('datetime') || null;
        var link = te.closest('a');
        if (link) url = link.href;
      }
    } catch (e) {}

    // 「Replying to @xxx」提示行(中英两种界面)
    var replyingTo = null;
    try {
      var m = (a.textContent || '').match(/(?:Replying to|回复)\\s*(@[A-Za-z0-9_]+)/);
      if (m) replyingTo = m[1];
    } catch (e) {}

    // 现有代码在用的 socialContext(对照用:它其实是「xx 转推了/已置顶」横幅)
    var social = null;
    try {
      var sc = a.querySelector('[data-testid="socialContext"]');
      if (sc) social = (sc.textContent || '').trim().slice(0, 30);
    } catch (e) {}

    var body = '';
    try {
      var tt = a.querySelector('[data-testid="tweetText"]');
      body = tt ? (tt.textContent || '').replace(/\\s+/g, ' ').slice(0, 50) : '';
    } catch (e) {}

    var norm = handle.replace(/^@+/, '').toLowerCase();
    items.push({
      idx: i,
      handle: handle,
      isSelf: norm === selfHandle,
      createdAt: createdAt,
      url: url,
      replyingTo: replyingTo,
      social: social,
      text: body
    });
  }
  return items;
})(arguments_self)`;

export interface TimelineScanItem {
  idx: number;
  handle: string;
  isSelf: boolean;
  createdAt: string | null;
  url: string | null;
  replyingTo: string | null;
  social: string | null;
  text: string;
}

export interface RoundStat {
  round: number;
  /** 本轮结束时页面上累计的 article 数 */
  domCount: number;
  /** 本轮新增(与上一轮相比) */
  added: number;
  /** 当前最旧一条的时间 */
  oldest: string | null;
  /** 最旧一条距今多少天 */
  spanDays: number | null;
}

export interface TimelineProbeResult {
  handle: string;
  url: string;
  rounds: RoundStat[];
  /** 滚动停止的原因:到底了 / 达到轮次上限 / 不再增长 */
  stopReason: string;
  totalItems: number;
  selfItems: number;
  /** 带「Replying to」提示的条数 */
  replyItems: number;
  /** socialContext 命中条数(对照:与 replyItems 不等即证明二者不是一回事) */
  socialItems: number;
  /** ① 相邻配对验证:本人回复的前一条是否为他人推文 */
  adjacency: {
    checked: number;
    precededByOther: number;
    precededBySelf: number;
    atTop: number;
  };
  samples: TimelineScanItem[];
}

async function scanDom(wc: Electron.WebContents, selfNorm: string): Promise<TimelineScanItem[]> {
  // 把 handle 作为参数注入,避免字符串拼接引号问题
  const js = `(function(){ var arguments_self = ${JSON.stringify(selfNorm)}; return ${SCAN_JS}; })()`;
  return await wc.executeJavaScript(js) as TimelineScanItem[];
}

/**
 * 探测「某账号的全部发言」—— 导航到 /with_replies 并滚动,逐轮记录覆盖情况。
 *
 * @param handle     目标账号
 * @param maxRounds  最多滚多少轮(默认 8;每轮约 1.5s,够看出增长趋势与上限)
 *
 * ⚠️ 会占用前台 X webview,期间请勿操作 X。
 */
export async function probeAuthorTimeline(
  handle: string,
  targetWcId?: number,
  maxRounds = 8,
): Promise<TimelineProbeResult | { error: string }> {
  const h = normalizeHandle(handle);
  if (!h) return { error: 'empty handle' };

  const resolved = resolveXWebContents(targetWcId);
  if ('error' in resolved) return { error: resolved.error };
  const wc = resolved.wc;

  const url = `https://x.com/${h}/with_replies`;
  console.log(`[author-timeline-spike] → ${url}`);
  wc.loadURL(url);

  // 等首批 article
  const deadline = Date.now() + 15_000;
  let ready = false;
  while (Date.now() < deadline) {
    const n = await wc.executeJavaScript(
      `document.querySelectorAll('article[data-testid="tweet"]').length`,
    ) as number;
    if (typeof n === 'number' && n > 0) { ready = true; break; }
    await new Promise((r) => setTimeout(r, 600));
  }
  if (!ready) {
    return { error: '15s 内没出现推文元素(未登录 / 账号不存在 / 被限流,三者需人工区分)' };
  }

  const rounds: RoundStat[] = [];
  let prevCount = 0;
  let stagnant = 0;
  let stopReason = `达到轮次上限 ${maxRounds}`;
  let items: TimelineScanItem[] = [];

  for (let round = 1; round <= maxRounds; round++) {
    items = await scanDom(wc, h);

    const times = items.map((i) => i.createdAt).filter(Boolean) as string[];
    const oldest = times.length ? times.reduce((a, b) => (a < b ? a : b)) : null;
    const spanDays = oldest
      ? Math.round((Date.now() - new Date(oldest).getTime()) / 86_400_000 * 10) / 10
      : null;

    rounds.push({
      round, domCount: items.length, added: items.length - prevCount, oldest, spanDays,
    });
    console.log(`[author-timeline-spike] 轮 ${round}: DOM ${items.length} 条 `
      + `(+${items.length - prevCount}), 最旧 ${oldest ?? 'n/a'} (${spanDays ?? '?'} 天前)`);

    // ⚠️ X 用虚拟列表:滚下去时上面的 article 会被回收,DOM 数不会一直涨。
    // 所以「不再增长」不等于「到底了」—— 这正是要 spike 出来的边界。
    if (items.length === prevCount) {
      stagnant++;
      if (stagnant >= 2) { stopReason = '连续两轮 DOM 无增长(到底了,或虚拟列表回收/懒加载封顶 —— 需人工判读)'; break; }
    } else {
      stagnant = 0;
    }
    prevCount = items.length;

    await wc.executeJavaScript(`window.scrollBy(0, window.innerHeight * 3)`);
    await new Promise((r) => setTimeout(r, 1500));
  }

  // ① 相邻配对验证:本人的回复,其前一条是不是别人的推
  const adjacency = { checked: 0, precededByOther: 0, precededBySelf: 0, atTop: 0 };
  for (const it of items) {
    if (!it.isSelf || !it.replyingTo) continue;
    adjacency.checked++;
    if (it.idx === 0) { adjacency.atTop++; continue; }
    const prev = items.find((x) => x.idx === it.idx - 1);
    if (!prev) { adjacency.atTop++; continue; }
    if (prev.isSelf) adjacency.precededBySelf++;
    else adjacency.precededByOther++;
  }

  const result: TimelineProbeResult = {
    handle: h,
    url,
    rounds,
    stopReason,
    totalItems: items.length,
    selfItems: items.filter((i) => i.isSelf).length,
    replyItems: items.filter((i) => i.replyingTo).length,
    socialItems: items.filter((i) => i.social).length,
    adjacency,
    samples: items.slice(0, 10),
  };

  console.log('[author-timeline-spike] 结果:', JSON.stringify({
    ...result, samples: `(${result.samples.length} 条,见返回值)`,
  }, null, 2));

  return result;
}
