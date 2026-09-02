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

    // 判据 A:「Replying to @xxx」提示行。
    // ⚠️ 实测 2026-09-02:/with_replies 页面**不渲染这行文本**,X 用左侧
    // 视觉连接线表示回复关系 → 本判据在该页面恒为 null,保留仅作对照。
    var replyingTo = null;
    try {
      var m = (a.textContent || '').match(/(?:Replying to|回复)\\s*(@[A-Za-z0-9_]+)/);
      if (m) replyingTo = m[1];
    } catch (e) {}

    // 判据 B:**读 X 自己声明的关系**,不再量像素几何。
    // 用户 2026-09-02 定的原则:「不能离开 X 本身提供的关系来自行分析,
    // 应该从 DOM 中找到 X 渲染时提供的关联方式」。
    // 量连接线尺寸(宽≤4px)是在页面外面猜 —— 有损、会漂、错了不报错,
    // 实测漏了 3 条(本人 109 / 判出 106)。
    //
    // X 渲染时必然带着这个关系(否则它自己也画不出线、跳不对链接),
    // 这里把候选载体**原样 dump**,由实机结果指认哪个是真源:
    //   · article 自身的 aria-* / data-* 属性
    //   · 祖先容器(cellInnerDiv 层)的属性
    //   · article 内所有 /status/ 链接 —— 父推链接通常就在其中
    var relSignals = {};
    try {
      var selfAttrs = {};
      for (var ai = 0; ai < a.attributes.length; ai++) {
        var at = a.attributes[ai];
        if (at.name.indexOf('aria') === 0 || at.name.indexOf('data-') === 0) {
          selfAttrs[at.name] = String(at.value).slice(0, 80);
        }
      }
      relSignals.articleAttrs = selfAttrs;

      var anc = a.parentElement, hops = 0, ancAttrs = [];
      while (anc && hops < 4) {
        var one = {};
        for (var bi = 0; bi < anc.attributes.length; bi++) {
          var bt = anc.attributes[bi];
          if (bt.name.indexOf('aria') === 0 || bt.name === 'data-testid') {
            one[bt.name] = String(bt.value).slice(0, 60);
          }
        }
        if (Object.keys(one).length) ancAttrs.push(one);
        anc = anc.parentElement; hops++;
      }
      relSignals.ancestorAttrs = ancAttrs;

      var links = a.querySelectorAll('a[href*="/status/"]');
      var ids = [];
      for (var li = 0; li < links.length; li++) {
        var href = links[li].getAttribute('href') || '';
        var lm = href.match(/\/([A-Za-z0-9_]+)\/status\/(\d+)/);
        if (lm) ids.push(lm[1] + '/' + lm[2]);
      }
      relSignals.statusLinks = ids.slice(0, 6);
    } catch (e) { relSignals.err = String(e); }

    // 判据 C:回复按钮的 aria-label 常含数量与语义,顺带取回以备判读
    var ariaReply = null;
    try {
      var rb = a.querySelector('[data-testid="reply"]');
      if (rb) ariaReply = (rb.getAttribute('aria-label') || '').slice(0, 40);
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
    // tweet id:从 status 链接取,作为跨轮去重的稳定键(DOM 会被虚拟列表回收)
    var tid = null;
    try { if (url) { var mm = url.match(/status\\/(\\d+)/); if (mm) tid = mm[1]; } } catch (e) {}

    items.push({
      idx: i,
      tweetId: tid,
      handle: handle,
      isSelf: norm === selfHandle,
      createdAt: createdAt,
      url: url,
      replyingTo: replyingTo,
      relSignals: relSignals,
      ariaReply: ariaReply,
      social: social,
      text: body
    });
  }
  return items;
})(arguments_self)`;

export interface TimelineScanItem {
  idx: number;
  tweetId: string | null;
  handle: string;
  isSelf: boolean;
  createdAt: string | null;
  url: string | null;
  /** 判据 A:「Replying to」文本(实测 /with_replies 不渲染,恒 null) */
  replyingTo: string | null;
  /** 判据 B:X 自己在 DOM 里声明的关系载体(原样 dump,由实机指认真源) */
  relSignals: {
    articleAttrs?: Record<string, string>;
    ancestorAttrs?: Array<Record<string, string>>;
    /** article 内所有 <handle>/status/<id> 链接 —— 父推通常在其中 */
    statusLinks?: string[];
    err?: string;
  };
  /** 判据 C:回复按钮 aria-label */
  ariaReply: string | null;
  social: string | null;
  text: string;
}

export interface RoundStat {
  round: number;
  /** 本轮**当前 DOM 里**的 article 数(虚拟列表会回收,故非单调) */
  domCount: number;
  /** 跨轮累计去重后的总数 —— 这才是真实进度指标 */
  cumulative: number;
  /** 本轮新收到的**新 id** 数(0 才意味着可能到底) */
  newIds: number;
  /** 累计集合里最旧一条的时间 */
  oldest: string | null;
  /** 最旧一条距今多少天 */
  spanDays: number | null;
}

export interface TimelineProbeResult {
  /** ⑤ 详情页解出的真实回复关系(回复给谁 + 父推 id) */
  relationProbe: Array<{ tweetId: string; replyingTo: string | null; parentId: string | null }>;
  handle: string;
  url: string;
  rounds: RoundStat[];
  /** 滚动停止的原因:到底了 / 达到轮次上限 / 不再增长 */
  stopReason: string;
  totalItems: number;
  selfItems: number;
  /** 判据 A 命中数(「Replying to」文本;实测该页面恒 0) */
  replyItems: number;
  /** 判据 B 命中数(头像列连接线 = 上接一条推) */
  threadLineItems: number;
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
  maxRounds = 60,
  targetDays = 7,
): Promise<TimelineProbeResult | { error: string }> {
  const h = normalizeHandle(handle);
  if (!h) return { error: 'empty handle' };

  const resolved = resolveXWebContents(targetWcId);
  if ('error' in resolved) return { error: resolved.error };
  const wc = resolved.wc;

  const url = `https://x.com/${h}/with_replies`;
  console.log(`[author-timeline-spike] → ${url} (最多 ${maxRounds} 轮, 目标回溯 ${targetDays} 天)`);
  wc.loadURL(url);

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

  // ⚠️ 跨轮累计:X 用虚拟列表,滚过去的 article 会被**从 DOM 删除**,
  // 所以「当前 DOM 条数」不是进度 —— 实测出现过 +0 / -1(计数不涨反降),
  // 旧版据此判定「到底了」,23 条就收工,而账号有 1183 条。
  // 正解:按 tweet id 累计进 Map,DOM 回收不影响已收集的。
  const collected = new Map<string, TimelineScanItem>();
  const rounds: RoundStat[] = [];
  let stopReason = `达到轮次上限 ${maxRounds}`;
  let noNewStreak = 0;

  for (let round = 1; round <= maxRounds; round++) {
    const items = await scanDom(wc, h);

    let newIds = 0;
    for (const it of items) {
      const key = it.tweetId ?? `${it.handle}|${it.createdAt}|${it.text}`;
      if (!collected.has(key)) { collected.set(key, it); newIds++; }
    }

    const times = [...collected.values()].map((i) => i.createdAt).filter(Boolean) as string[];
    const oldest = times.length ? times.reduce((a, b) => (a < b ? a : b)) : null;
    const spanDays = oldest
      ? Math.round((Date.now() - new Date(oldest).getTime()) / 86_400_000 * 10) / 10
      : null;

    rounds.push({ round, domCount: items.length, cumulative: collected.size, newIds, oldest, spanDays });
    console.log(`[author-timeline-spike] 轮 ${round}: DOM ${items.length} | 累计 ${collected.size} `
      + `(+${newIds} 新) | 最旧 ${spanDays ?? '?'} 天前`);

    // 到达目标回溯窗口即停 —— 「取多久」是变量,不是写死的
    if (spanDays !== null && spanDays >= targetDays) {
      stopReason = `已覆盖目标窗口 ${targetDays} 天(最旧 ${spanDays} 天前)`;
      break;
    }

    // 只有连续多轮**没有新 id** 才可能是真到底 —— 不再拿 DOM 条数当判据
    if (newIds === 0) {
      noNewStreak++;
      if (noNewStreak >= 4) {
        stopReason = `连续 4 轮无新推文(到底了,或懒加载封顶 —— 累计 ${collected.size} 条,`
          + `覆盖 ${spanDays ?? '?'} 天)`;
        break;
      }
    } else {
      noNewStreak = 0;
    }

    // 慢一点没关系,不能漏 —— 每轮滚一屏,给懒加载留足时间
    await wc.executeJavaScript(`window.scrollBy(0, window.innerHeight * 0.9)`);
    await new Promise((r) => setTimeout(r, 2000));
  }

  const all = [...collected.values()];

  // ① 配对结构:本人推文的前一条是谁的
  // 遍历**全部本人推文**,不用连接线预筛(理由见下方 ⑤ 的说明)
  const adjacency = { checked: 0, precededByOther: 0, precededBySelf: 0, atTop: 0 };
  for (const it of all) {
    if (!it.isSelf) continue;
    adjacency.checked++;
    if (it.idx === 0) { adjacency.atTop++; continue; }
    const prev = all.find((x) => x.idx === it.idx - 1);
    if (!prev) { adjacency.atTop++; continue; }
    if (prev.isSelf) adjacency.precededBySelf++;
    else adjacency.precededByOther++;
  }

  // ── ⑤ 回复关系:详情页判据 ────────────────────────────────────────
  //
  // ⚠️ **不要用连接线来筛候选**(2026-09-02 用户指出):
  //   /with_replies 这个页面上,本账号的每一条**都是回复**(原创推在 Posts 标签页)。
  //   所以「本人 109 条 → 连接线判出 106 条」不是发现了 106 条回复,
  //   而是**漏了 3 条** —— 连接线是量几何的启发式(宽≤4px 高≥12px),
  //   线程末条、父推在视口外、元素尚未布局(rect 全 0)都会漏。
  //   用一个有损代理去筛,漏掉的那部分**永远不会进入详情页探测**,
  //   而且不报错 —— 又是一次「拿有缺陷的测量当证据」。
  //
  //   正解:候选 = **本人的全部推文**(在 /with_replies 上即全部回复),
  //   由详情页给出权威答案。连接线只留作对照统计,不作筛选条件。
  // 用户 2026-09-02 指出:「用户回复了谁,这个关系要在爬取数据时有能力获取才对」。
  // 说得对 —— 时间线页把关系画成连接线(视觉),抓下来只知道「上接一条推」,
  // 不知道**接的是谁的哪一条**;而累计集合里 idx 会跨轮错乱,相邻推断更不可靠。
  //
  // 可靠来源是**推文自己的详情页**:打开 /<handle>/status/<id>,X 会明确渲染
  // 「Replying to @xxx」,且被回复的原推就在同一页上,能直接取到它的 status id。
  // 代价是每条回复多一次导航 —— 但这是**拿得到真关系**的唯一确定路径。
  // 本 spike 只验证可行性:取前 3 条本人带连接线的推,逐个开详情页看能否解出。
  const relationProbe: Array<{ tweetId: string; replyingTo: string | null; parentId: string | null }> = [];
  const candidates = all.filter((i) => i.isSelf && i.tweetId).slice(0, 5);
  for (const c of candidates) {
    try {
      wc.loadURL(`https://x.com/${h}/status/${c.tweetId}`);
      await new Promise((r) => setTimeout(r, 3500));
      const detail = await wc.executeJavaScript(`(function () {
        var out = { replyingTo: null, parentId: null };
        try {
          var m = (document.body.textContent || '').match(/(?:Replying to|回复)\\s*(@[A-Za-z0-9_]+)/);
          if (m) out.replyingTo = m[1];
        } catch (e) {}
        try {
          var arts = document.querySelectorAll('article[data-testid="tweet"]');
          for (var i = 0; i < arts.length; i++) {
            var t = arts[i].querySelector('time');
            var a2 = t && t.closest('a[href*="/status/"]');
            if (a2) {
              var mm = a2.href.match(/status\\/(\\d+)/);
              if (mm && mm[1] !== ${JSON.stringify(c.tweetId)}) { out.parentId = mm[1]; break; }
            }
          }
        } catch (e) {}
        return out;
      })()`) as { replyingTo: string | null; parentId: string | null };
      relationProbe.push({ tweetId: c.tweetId!, ...detail });
      console.log(`[author-timeline-spike] 详情页 ${c.tweetId}: 回复给 ${detail.replyingTo ?? '?'} `
        + `父推 ${detail.parentId ?? '?'}`);
    } catch (err) {
      relationProbe.push({ tweetId: c.tweetId!, replyingTo: null, parentId: null });
      console.error(`[author-timeline-spike] 详情页 ${c.tweetId} 失败:`, err);
    }
  }

  const result: TimelineProbeResult = {
    relationProbe,
    handle: h,
    url,
    rounds,
    stopReason,
    totalItems: all.length,
    selfItems: all.filter((i) => i.isSelf).length,
    replyItems: all.filter((i) => i.replyingTo).length,
    // 有多少条能从 X 自己的 status 链接里解出「除自己以外的另一条推」
    threadLineItems: all.filter((i) =>
      (i.relSignals?.statusLinks ?? []).some((l) => !l.endsWith(`/${i.tweetId}`)),
    ).length,
    socialItems: all.filter((i) => i.social).length,
    adjacency,
    samples: all.slice(0, 12),
  };

  console.log('[author-timeline-spike] 结果:', JSON.stringify({
    ...result, samples: `(${result.samples.length} 条,见返回值)`,
  }, null, 2));

  return result;
}
