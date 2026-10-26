/**
 * XOpsPeople —— ⭐⭐ 运营 → 「人」(2026-10-08,第 1 块:只读骨架)
 *
 * 用户定的三段:① 我的号 ② 关系概览(点格子列出这群人)③ 列表 + 人卡。
 * 规矩:事实只从三个标记来;每个数字带采集时间;没采到写「还没采集」不写 0;
 * 人卡「事实」与「推断」分开;缺数据处就是采集入口。
 *
 * ⚠️ 第 1 块**不动数据结构**。还没做的(我的号曲线 / 回复往来 / 大陆背景标注 /
 * 采他的推文 / 分析他)都**明说「还没做」**,不做成点了没反应的假按钮。
 *
 * 布局随自身宽度变:窄(右栏)时人卡盖住列表、点返回回来;宽(全屏)时左右并排。
 *
 * ⭐ 排除(2026-10-08,schema 1.2.21):用户「我看到不愿意再需要分析的用户，就右键排除」。
 * 右键一行 → 排除;立刻从列表消失,上方给「撤销」;概览只算范围内的人。
 *
 * ⭐ 标签(2026-10-08,schema 1.2.22):用户「增加第三个功能，就是打标签，点击后弹出一个简单的对话框，
 * 我输入我自己想要的标签。最后提供一个标签关键词的过滤方式就好了，标签可以打多个的，自由一点。」
 *
 * ⭐ 关联(2026-10-08):用户「点击选定用户时，右边的x view跳转到这个人的主页」。
 * ⭐⭐ 核对(2026-10-09):跳转时**顺手读这一页**(主页加载本来就会请求 UserByScreenName),
 * 有变化直接更新库并在这一行提示。一次只核对一个;连点时只核对最后点的那个。
 * ⭐⭐ 采他的帖子和回复(2026-10-09):人卡按钮,主页帖子 + 回复各 2 页(用户同意的默认值)。
 * ⭐⭐ 取关(2026-10-10):用户取消了「不由程序点按钮」的红线,「取关的动作放在运营面板上,直接取关和更新」。
 * 保护:每日上限 + 最小间隔(用户可设)、异常即停(要人点「恢复」)、每次留动作记录、取关后立刻核对。
 * ⚠️ 操作台采集中不跳(跳走会打断采集),并说出来;已经在他主页就不重载。
 */

import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore,
  type CSSProperties, type ReactElement,
} from 'react';
import { xDataCall } from './x-data-types';
import { subscribeXHost, getXHostState } from './x-host-registry';
import type { XUserRecord } from './x-user-audit';
import type { CollectOnWebviewResult } from './x-collect-on-webview';
import type { CirclePerson } from './x-friend-circle';
import { LIVE_PAGE_CAP, PERSON_TABS, TIMELINE_RANGES, rangeStart, worthReloadRetry, type TimelineRange } from './x-person-timeline';
import { acquireXPage, releaseXPage, resumeUnfollowOf, unfollowHaltOf, unfollowPerson, verifyPerson, type UnfollowOutcome, type VerifyOutcome } from './x-unfollow-run';
import { XPersonTimeline } from './XPersonTimeline';
import { XPersonLists } from './XPersonLists';
import { describeProgress, type BgJob } from './x-bg-job';
import { useBgStatus } from './XBgStatus';
import { localDayStart, type OpsSettings, type UnfollowGate } from './x-ops-settings';
import {
  DEFAULT_PEOPLE_FILTER, PEOPLE_GROUPS, PEOPLE_SORTS, relationLabel, normalizeTags, splitTagInput, inGroup,
  type PeopleFilter, type PeopleGroup, type PeopleOverview, type PeopleScope, type PeopleSort,
  type PersonDetail, type PersonRow, type PersonTweet,
} from './x-people-query';

const PAGE = 200;
/** 宽于此就并排显示列表与人卡 */
const WIDE = 760;

const fmt = (n: number | undefined): string => (n === undefined ? '—' : n.toLocaleString());

/** 互关倾向是谁定的 —— 人 > AI > 算法 */
const INTENT_SOURCE: Readonly<Record<string, string>> = { human: '你标的', ai: 'AI', rule: '算法' };


export function XOpsPeople({ workspaceId }: { workspaceId: string }): ReactElement {
  const [overview, setOverview] = useState<PeopleOverview | null>(null);
  const [filter, setFilter] = useState<PeopleFilter>(DEFAULT_PEOPLE_FILTER);
  const [rows, setRows] = useState<PersonRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 选中(高亮)的那一行 —— 单击即选中 */
  const [selected, setSelected] = useState<string | null>(null);
  /**
   * ⭐ 人卡开着的那个人 —— **双击才开**(用户 2026-10-08:「个人card双击的时候再显示，
   * 单击用户不要显示好操作一点」)。与「选中」分开:单击只高亮 + X 网页跟着跳。
   */
  const [cardId, setCardId] = useState<string | null>(null);
  /** 右键菜单 —— 位置 + 对象 */
  const [menu, setMenu] = useState<{ x: number; y: number; p: PersonRow; index: number } | null>(null);
  /** ⭐ 标签目录(有哪些标签、各几人)—— 对话框提示与过滤提示共用 */
  const [catalog, setCatalog] = useState<Array<{ tag: string; count: number }>>([]);
  /** 正在打标签的人 */
  const [tagging, setTagging] = useState<PersonRow | null>(null);
  /** 人卡要重读(标签改了)—— 递增即重读 */
  const [cardRev, setCardRev] = useState(0);
  /** ⭐ 刚做的那次排除/取消 —— 点错了能马上撤回 */
  const [undo, setUndo] = useState<{ p: PersonRow; index: number; excluded: boolean } | null>(null);

  /** ⭐ 自身宽度 —— 决定人卡是盖住列表还是并排 */
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWide(e.contentRect.width >= WIDE));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** X 网页的 wcId —— 「点人跳主页」要用;没开就不跳并说明 */
  const wcId = useSyncExternalStore(subscribeXHost, () => getXHostState(workspaceId)?.wcId ?? null);
  /** ⭐ 点人时 X 网页跟着跳 —— 默认开;只想翻列表不想跳时可以关 */
  const [follow, setFollow] = useState(true);
  /** 没跳的原因 —— 说出来,不静默 */
  const [followNote, setFollowNote] = useState<string | null>(null);

  const loadOverview = useCallback(() => {
    void xDataCall({ op: 'peopleOverview', wsId: workspaceId }).then((r) => {
      if (r.status === 'ok') setOverview(r.value as PeopleOverview);
      else setErr(r.reason);
    });
  }, [workspaceId]);
  /**
   * ⭐ 当前筛选的最新值 —— 核对是异步的,回来时要按**那一刻**的分组判断要不要移出列表。
   * (用 ref:runVerify 是 useCallback,直接读 filter 会拿到旧值)
   */
  const filterRef = useRef(filter);
  filterRef.current = filter;
  /** ⭐ 核对后移出当前分组的人 —— 告诉人他去哪了(用户:「要做及时的调整才对吧」) */
  const [moved, setMoved] = useState<string | null>(null);

  /** ⭐ 每个人最近一次核对的结果 —— 显示在列表那一行 */
  const [verify, setVerify] = useState<Record<string, { kind: 'running' | 'same' | 'changed' | 'new' | 'miss'; text: string; at: number }>>({});
  const verifying = useRef(false);
  const pending = useRef<PersonRow | null>(null);

  /** 把核对到的资料补进列表那一行(不重查整页) */
  const patchRow = (r: XUserRecord): void => {
    setRows((prev) => prev.map((x) => (x.rest_id !== r.restId ? x : {
      ...x,
      handle: r.handle.toLowerCase() || x.handle,
      display_name: r.name || x.display_name,
      avatar: r.avatar || x.avatar,
      bio: r.bio || x.bio,
      followers_count: r.followersCount ?? x.followers_count,
      is_blue_verified: r.isBlueVerified ?? x.is_blue_verified,
      i_follow: r.following ?? x.i_follow,
      follows_me: r.followedBy ?? x.follows_me,
    })));
  };

  /**
   * ⭐⭐ 让 X 网页打开这个人的主页,并**顺手核对**。
   * ⚠️ 不跳的情况都说出来:X 网页没开 / 操作台正在采集(跳走会打断采集)。
   * ⚠️ 核对在主进程(能力 x.person.verify,2026-10-26 第 4 步):期间占住 X 网页,免得操作台 / 后台同时在这个页面上采;
   *    被占着就不跳,说出是谁。
   */
  /** 核对结果显示到人卡 / 列表(取关后的核对结果也走这里) */
  const showVerify = useCallback((p: PersonRow, r: VerifyOutcome): void => {
    const result = { kind: r.kind, text: r.text };
    {
      if (r.kind !== 'miss') {
        const rec = r.rec;
        patchRow(rec);
        setCardRev((v) => v + 1);
        /**
         * ⭐⭐ 关系变了、已不属于当前这组 → 立刻移出列表、总数减一,并说清楚去了哪
         * (2026-10-09 截图:jess01239 已是「互不关注」却还留在「我关注·他没回关」里)。
         */
        const g = filterRef.current.group;
        const iF = rec.following ?? p.i_follow;
        const fM = rec.followedBy ?? p.follows_me;
        if (!inGroup(g, iF, fM)) {
          setRows((prev) => prev.filter((x) => x.rest_id !== p.rest_id));
          setTotal((t) => (t === null ? t : t - 1));
          setMoved(`@${p.handle} 关系变为「${relationLabel({ i_follow: iF, follows_me: fM })}」,已移出「${PEOPLE_GROUPS.find((x) => x.id === g)?.label}」`);
        }
        if (r.changes.length > 0 || r.kind === 'new') loadOverview();
      }
    }
    setVerify((v) => ({ ...v, [p.rest_id]: { ...result, at: Date.now() } }));
  }, [loadOverview]);
  const runVerify = useCallback(async (p: PersonRow): Promise<void> => {
    if (wcId == null) { setFollowNote('X 网页没开,没跳转'); return; }
    setVerify((v) => ({ ...v, [p.rest_id]: { kind: 'running', text: '核对中…', at: Date.now() } }));
    const r = await verifyPerson(workspaceId, p);
    if ('refused' in r) {
      setVerify((v) => { const n = { ...v }; delete n[p.rest_id]; return n; });
      setFollowNote(`${r.refused},没跳转(跳走会打断采集)`);
      return;
    }
    setFollowNote(null);
    showVerify(p, r);
  }, [wcId, workspaceId, showVerify]);

  /** ⭐ 一次只核对一个;核对中又点了别人,只记住**最后点的那个** */
  const openInX = useCallback((p: PersonRow): void => {
    const last = verify[p.rest_id];
    /**
     * 3 秒内刚核对过同一个人就不重来 —— 只为挡双击(双击会先触发两次单击)。
     * ⚠️ 原先 15 秒:人在 X 页面上刚取关、马上再点他想更新时会被挡掉(2026-10-09)。
     */
    if (last && last.kind !== 'miss' && Date.now() - last.at < 3_000) return;
    if (verifying.current) { pending.current = p; return; }
    verifying.current = true;
    void (async () => {
      let next: PersonRow | null = p;
      while (next) {
        await runVerify(next);
        next = pending.current;
        pending.current = null;
      }
      verifying.current = false;
    })();
  }, [runVerify, verify]);

  /**
   * ⭐⭐ 采他的帖子 / 回复 / 转发 —— 按时间范围(2026-10-10 用户:「可以配置获取的长度（一个月、半年、一年，全部）」)。
   * 每个标签页:去那一页 → runCollect(首页 + 游标翻页,随机停顿/限流退避都在里面;2026-10-13 起在主进程跑)→ 存推文。
   * ⭐ 收手:这一页**他自己**最新的推文早于起点(置顶只在首页,不参与判断)/ 当场采到页数上限。
   * ⚠️ 2026-10-10 第一版只滚动 8 轮,每页都只拿到首屏 —— 滚动触发翻页不可靠,所以改游标翻页。
   */
  const [collect, setCollect] = useState<Record<string, { running: boolean; text: string }>>({});
  const COLLECT_BUSY = '运营正在采他的推文';
  const cancelCollect = useRef(false);
  const collectTweets = useCallback(async (p: PersonRow, range: TimelineRange): Promise<void> => {
    if (wcId == null) { setCollect((c) => ({ ...c, [p.rest_id]: { running: false, text: 'X 网页没开,没法采' } })); return; }
    const lock = await acquireXPage(wcId, COLLECT_BUSY);
    if (!lock.ok) { setCollect((c) => ({ ...c, [p.rest_id]: { running: false, text: `${lock.why},先等它结束` } })); return; }
    const start = rangeStart(range, new Date());
    const label = TIMELINE_RANGES.find((r) => r.id === range)?.label ?? range;
    cancelCollect.current = false;
    const parts: string[] = [];
    const say = (msg: string): void =>
      setCollect((c) => ({ ...c, [p.rest_id]: { running: true, text: `[${label}] ${parts.join(';')}${parts.length ? ';' : ''}${msg}` } }));
    try {
      for (const tab of PERSON_TABS) {
        if (cancelCollect.current) { parts.push(`${tab.label}:人点了停止`); break; }
        /**
         * ⭐ 最多两次:第一次翻页就 403(翻页模板没带鉴权头)时,重载这一页再试一次。
         * ⚠️ 2026-10-12 真机:帖子页那条响应只被页面钩子收到、CDP 没收到 → 模板没有鉴权头 → 403,
         * 只翻了 1 页就停。重载后两条通道重新收一遍,大概率拿到带头的那份。第一次采到的照样存。
         */
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          say(`正在采${tab.label}…${attempt > 1 ? '(重载后第 2 次)' : ''}`);
          /**
           * ⭐⭐ 去那一页 + runCollect 在**主进程**跑(2026-10-13 后台策略 3a:`collectOnWebview`,
           * 与后台 runner 共用一份)。进度每句都由主进程当场写 x-person-progress 留痕;
           * 这里每秒问一次最新那句,只为界面上滚动显示。
           */
          let seenSeq = 0;
          /** ⚠️ 采完后才回来的那次问询不许再改界面(会盖掉结果那句) */
          let done = false;
          const poll = setInterval(() => {
            void xDataCall({ op: 'personCollectProgress', wcId }).then((r) => {
              if (done) return;
              const v = r.status === 'ok' ? r.value as { seq: number; msg?: string } | null : null;
              if (v && v.seq !== seenSeq && v.msg) { seenSeq = v.seq; say(`${tab.label}:${v.msg}`); }
            });
          }, 1000);
          let res;
          try {
            res = await xDataCall({
              op: 'collectPersonTab', wcId, page: tab.name, handle: p.handle, restId: p.rest_id,
              start: start?.toISOString(),
              pageCap: settingsRef.current?.['collect.live_page_cap'] ?? LIVE_PAGE_CAP,
              attempt,
              /** ⭐ 带着上面占住的锁进去(主进程能力只核对、不再申请) */
              ownToken: lock.token,
            });
          } finally {
            done = true;
            clearInterval(poll);
          }
          if (res.status === 'failed') throw new Error(res.reason);
          const run = res.value as CollectOnWebviewResult;
          if (!run.reached) { parts.push(`${tab.label}:没去到这一页(${run.reason})`); break; }
          const records = [...run.records];
          const pages = (run.paging?.rounds ?? 0) + 1;
          const why = run.paging?.stopReason ?? '';
          /**
           * 第一轮翻页就被拒 = 翻页模板没带鉴权头 → 值得重载再试。
           * ⚠️ 两种措辞都要认(2026-10-13):旧的「HTTP 403」+ 403 根治后的
           * 「没带鉴权头」(种子一条带头的都没有时的失败语)——
           * 只认 HTTP 403 的话,新措辞不触发重试,回复页种子没带头就只采 1 页就停
           * (project-x-paging-403-root-cause 记过这笔连带账)。
           */
          const authFail = worthReloadRetry(why, run.paging?.rounds ?? 0);
          /** ⚠️ 每页已在主进程先存过(逐页账,2026-10-16)—— 新增要加上每页累计的,否则下面整批再存恒为 0 */
          let inserted = run.pageInserted ?? 0;
          if (records.length > 0) {
            const sv = await xDataCall({ op: 'saveTweets', records, ctx: { source: tab.name, wcId: wcId ?? undefined } });
            if (sv.status === 'failed') { parts.push(`${tab.label}没存进库:${sv.reason}`); break; }
            inserted += (sv.value as { inserted: number }).inserted;
          }
          /**
           * ⭐⭐ 每个标签页(每次尝试)的结果**落留痕**(2026-10-10:停因只显示在人卡上,关了就没,
           * 事后分不清「第一页就按时间停」还是「根本没翻页」)。成功路径也要留痕。
           */
          void xDataCall({
            op: 'logPersonCollect',
            entry: { restId: p.rest_id, handle: p.handle, range, tab: tab.name, pages, records: records.length, inserted, stopReason: `${attempt > 1 ? '[第 2 次] ' : ''}${why}` },
          });
          if (authFail && attempt === 1 && !cancelCollect.current) continue;
          parts.push(`${tab.label} ${pages} 页 ${records.length} 条(新 ${inserted})${attempt > 1 ? '[重载后]' : ''}${why ? ` —— ${why}` : ''}`);
          break;
        }
      }
    } catch (e) {
      parts.push(`出错:${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await releaseXPage(lock.token);
    }
    setCollect((c) => ({ ...c, [p.rest_id]: { running: false, text: `[${label}] 采完:${parts.join(';')}` } }));
    setCardRev((v) => v + 1);
    loadOverview();
  }, [wcId, loadOverview]);

  /** ⭐ 选时间范围的小框 —— 第一步只开放「一个月」 */
  /**
   * ⭐⭐ 半年 / 一年 / 全部 = 建后台任务(2026-10-14 第 4 步),**不走 collectTweets**(那是当场采)。
   * 任务属于发起的号(本 view 的 ws);后台按节奏一段段采,跨重启接着采。
   * ⚠️ 同一个人同一范围已有没完成的任务 → 不重建(repo 去重),明说「已经在后台了」。
   */
  const [bgMsg, setBgMsg] = useState<Record<string, string>>({});
  const [bgRev, setBgRev] = useState(0);
  const createBgJob = useCallback(async (p: PersonRow, range: TimelineRange): Promise<void> => {
    const r = await xDataCall({ op: 'bgCreateJob', restId: p.rest_id, handle: p.handle, wsId: workspaceId, range });
    const label = TIMELINE_RANGES.find((x) => x.id === range)?.label ?? range;
    let text: string;
    if (r.status !== 'ok') text = `没建成后台任务:${r.reason}`;
    else {
      const v = r.value as { created: boolean };
      text = v.created ? `已排进后台(${label}),会按节奏慢慢采` : `「${label}」已经在后台了,没重复建`;
      if (wcId == null) text += ' —— 这个号的 X 网页没开,开了才会采';
    }
    setBgMsg((m) => ({ ...m, [p.rest_id]: text }));
    setBgRev((n) => n + 1);
  }, [workspaceId, wcId]);
  const [rangeFor, setRangeFor] = useState<PersonRow | null>(null);

  /** ⭐ 运营设置(人可设定的变量)*/
  const [settings, setSettings] = useState<OpsSettings | null>(null);
  /** 采集是 useCallback,用 ref 读最新设置 */
  const settingsRef = useRef<OpsSettings | null>(null);
  settingsRef.current = settings;
  const [gate, setGate] = useState<UnfollowGate | null>(null);
  const loadGate = useCallback(() => {
    void xDataCall({ op: 'unfollowGate', dayStartIso: localDayStart(new Date()).toISOString() }).then((r) => {
      if (r.status === 'ok') setGate(r.value as UnfollowGate);
    });
  }, []);
  useEffect(() => {
    void xDataCall({ op: 'opsSettings' }).then((r) => {
      if (r.status === 'ok') setSettings((r.value as { settings: OpsSettings }).settings);
      else setErr(r.reason);
    });
    loadGate();
  }, [loadGate]);


  /**
   * ⭐⭐ 异常即停 —— 一次取关没成功就暂停,要人看过原因、点「恢复」才继续。
   * (红线取消后挡封号风险的就剩这些;X 弹验证 / 改版时连着硬点只会更糟)
   */
  /** ⚠️ 暂停在主进程一份(按 workspace,2026-10-26):任务页取关没成,这里也看得见;这里只是显示 */
  const [unfollowPaused, setUnfollowPaused] = useState<string | null>(null);
  const [unfollowing, setUnfollowing] = useState<string | null>(null);
  useEffect(() => { void unfollowHaltOf(workspaceId).then(setUnfollowPaused); }, [workspaceId]);

  const unfollow = useCallback(async (p: PersonRow): Promise<void> => {
    if (wcId == null) { setFollowNote('X 网页没开,没法取关'); return; }
    /** ⭐ 闸门 / 让路 / 去主页 / 点 / 记动作 / 同一把锁里核对 / 异常即停 —— 都在主进程(能力 x.person.unfollow) */
    setUnfollowing(p.rest_id);
    let r: UnfollowOutcome;
    try {
      r = await unfollowPerson(workspaceId, p);
    } finally {
      setUnfollowing(null);
    }
    if ('blocked' in r) {
      setFollowNote(r.blocked);
      /** 被拒可能就是因为暂停着 —— 以主进程为准刷一下 */
      void unfollowHaltOf(workspaceId).then(setUnfollowPaused);
      return;
    }
    setGate(r.gate);
    loadGate();
    if (r.halted) { setUnfollowPaused(r.halted); return; }
    if (r.done) setFollowNote(r.warning ? `⚠️ 已取关 @${p.handle},提醒:${r.warning}` : null);
    else setFollowNote(`@${p.handle} 本来就没关注,已重新核对`);
    /** ⑤ 取关后的核对在主进程同一把锁里做完了 —— 这里只显示(并按分组移出列表) */
    if (r.verify) showVerify(p, r.verify);
  }, [wcId, workspaceId, loadGate, showVerify]);

  /** 单击:选中 + X 网页跟着跳 —— **不开人卡** */
  const selectPerson = (p: PersonRow): void => {
    setSelected(p.rest_id);
    if (follow) openInX(p);
  };

  /** 双击 / 右键「打开人卡」:开人卡 */
  const openCard = (p: PersonRow): void => {
    setSelected(p.rest_id);
    setCardId(p.rest_id);
  };

  useEffect(() => { loadOverview(); }, [loadOverview]);

  const loadCatalog = useCallback(() => {
    void xDataCall({ op: 'tagCatalog' }).then((r) => {
      if (r.status === 'ok') setCatalog(r.value as Array<{ tag: string; count: number }>);
      else setErr(r.reason);
    });
  }, []);
  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  /**
   * ⭐⭐ 存标签 —— 写成功后**用库返回的**(清洗后的)标签更新列表,不用自己手里那份。
   * ⚠️ 失败如实报,对话框不关(人填的东西别丢)。
   */
  const saveTags = useCallback(async (p: PersonRow, tags: string[]): Promise<string | null> => {
    const r = await xDataCall({ op: 'setTags', restId: p.rest_id, tags });
    if (r.status === 'failed') return r.reason;
    const saved = r.value as string[];
    setRows((prev) => prev.map((x) => (x.rest_id === p.rest_id ? { ...x, tags: saved } : x)));
    setCardRev((v) => v + 1);
    loadCatalog();
    return null;
  }, [loadCatalog]);

  /** 菜单:点别处 / Esc / 滚动就关 */
  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  /** ⚠️ 只认最后一次请求 —— 打字时先发的慢请求不许覆盖后发的 */
  const seq = useRef(0);
  const load = useCallback(async (f: PeopleFilter, start: number) => {
    const my = ++seq.current;
    setBusy(true);
    const r = await xDataCall({ op: 'queryPeople', wsId: workspaceId, filter: f, limit: PAGE, start });
    if (my !== seq.current) return;
    setBusy(false);
    if (r.status === 'failed') { setErr(r.reason); return; }
    const v = r.value as { total: number; rows: PersonRow[] };
    setErr(null);
    setTotal(v.total);
    setRows((prev) => (start === 0 ? v.rows : [...prev, ...v.rows]));
  }, [workspaceId]);

  const key = JSON.stringify(filter);
  /** 换了分组/筛选,「已移出」那句就不相干了 */
  useEffect(() => { setMoved(null); }, [key]);
  useEffect(() => {
    const t = setTimeout(() => void load(JSON.parse(key) as PeopleFilter, 0), 250);
    return () => clearTimeout(t);
  }, [key, load]);

  /**
   * ⭐⭐ 排除 / 取消排除 —— 成功后这个人离开当前列表(它已不属于这个范围),
   * 记下原位置供「撤销」放回去;概览重读。
   * ⚠️ 失败如实报,不先从列表里拿掉 —— 否则「看着排除了、库里没变」。
   */
  const applyExcluded = useCallback(async (p: PersonRow, excluded: boolean): Promise<boolean> => {
    const r = await xDataCall({ op: 'setExcluded', restId: p.rest_id, excluded });
    if (r.status === 'failed') { setErr(r.reason); return false; }
    setErr(null);
    setRows((prev) => prev.filter((x) => x.rest_id !== p.rest_id));
    setTotal((t) => (t === null ? t : t - 1));
    if (selected === p.rest_id) setSelected(null);
    if (cardId === p.rest_id) setCardId(null);
    loadOverview();
    return true;
  }, [loadOverview, selected, cardId]);

  const toggleExclude = async (p: PersonRow, index: number): Promise<void> => {
    const excluded = p.excluded !== true;
    if (await applyExcluded(p, excluded)) setUndo({ p, index, excluded });
  };

  const doUndo = async (): Promise<void> => {
    if (!undo) return;
    const r = await xDataCall({ op: 'setExcluded', restId: undo.p.rest_id, excluded: !undo.excluded });
    if (r.status === 'failed') { setErr(r.reason); return; }
    /** 放回原位置 —— 撤销后列表应与操作前一样 */
    setRows((prev) => [...prev.slice(0, undo.index), { ...undo.p }, ...prev.slice(undo.index)]);
    setTotal((t) => (t === null ? t : t + 1));
    setUndo(null);
    loadOverview();
  };

  /**
   * ⭐⭐ 互关倾向(1.2.30,蓝V互关 M2)。
   * 用户 10-16:「对有蓝V有互关倾向的(比如写了蓝V互关/浇朋友等类似属于的Bio或者帖子),进行互动求关。」
   * 扫描 = 算法层(可重算);右键标 = 人的决定(人 > AI > 算法,算法不能覆盖)。
   */
  const [intentNote, setIntentNote] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const scanIntent = async (): Promise<void> => {
    setScanning(true); setIntentNote('扫描中…');
    const r = await xDataCall({ op: 'scanMutualIntent' });
    setScanning(false);
    if (r.status === 'failed') { setIntentNote(`扫描出错:${r.reason}`); return; }
    const v = r.value as { scanned: number; hits: number; set: number; cleared: number; skippedHigher: number; failed: number; firstFailure?: string };
    setIntentNote(`扫了 ${v.scanned.toLocaleString()} 人:有倾向 ${v.hits}(新标 ${v.set})· 不再命中清掉 ${v.cleared} · 你定过的不动 ${v.skippedHigher}`
      + (v.failed > 0 ? ` · ⚠️ 失败 ${v.failed}:${v.firstFailure}` : ''));
    void load(filter, 0);
  };
  const markIntent = async (p: PersonRow, value: boolean): Promise<void> => {
    const r = await xDataCall({ op: 'setMutualIntent', restId: p.rest_id, value });
    if (r.status === 'failed') { setErr(r.reason); return; }
    setErr(null);
    /** 只看有倾向时标成「无」→ 离开列表;否则就地改这一行 */
    if (filter.intentOnly && !value) {
      setRows((prev) => prev.filter((x) => x.rest_id !== p.rest_id));
      setTotal((t) => (t === null ? t : t - 1));
    } else {
      setRows((prev) => prev.map((x) => (x.rest_id === p.rest_id ? { ...x, mutual_intent: value, mutual_intent_source: 'human' } : x)));
    }
  };

  const pickGroup = (g: PeopleGroup): void =>
    setFilter((f) => ({ ...f, group: f.group === g ? 'all' : g }));

  const showCard = cardId !== null;
  const listHidden = showCard && !wide;

  return (
    <div ref={rootRef} style={S.root}>
      {/* ① 我的号 */}
      <div style={S.card}>
        <div style={S.cardTitle}>我的号</div>
        <div style={S.muted}>
          增长曲线还没做 —— 要先定「什么时候记一次自己号的粉丝数」(打开运营时自动记,还是手动点)。
        </div>
      </div>

      {/* ② 关系概览 —— 点一格,下面列出这群人;再点一次回到全部 */}
      <div style={S.cells}>
        {PEOPLE_GROUPS.filter((g) => g.id !== 'all'
          /** 「关系不明」只在真有这类人时才占一格 */
          && (g.id !== 'unknown' || (overview?.unknown.total ?? 0) > 0)).map((g) => {
          const v = overview?.[g.id];
          const active = filter.group === g.id;
          return (
            <button
              key={g.id}
              type="button"
              /**
               * ⚠️ 点完去掉焦点(2026-10-21 用户截图):再点一次回到「全部」后,按钮焦点的深底浅边还留着,
               * 看着像这一格仍选着,下面列的却是全部 —— 「这个数据不对呀?」。选中只认蓝边浅蓝底 + 「已选」字样。
               */
              onClick={(e) => { pickGroup(g.id); e.currentTarget.blur(); }}
              style={{ ...S.cell, ...(active ? S.cellActive : null), outline: 'none' }}
              title={active ? '再点一次回到全部' : `列出「${g.label}」的人`}
            >
              <span style={S.cellLabel}>{g.label}</span>
              <span style={S.cellNum}>{v ? v.total.toLocaleString() : '…'}</span>
              <span style={S.muted}>蓝V {v ? v.blue.toLocaleString() : '…'}</span>
              {active && <span style={{ ...S.muted, color: 'var(--accent-bar, #6b9fff)' }}>已选 · 再点回到全部</span>}
              {g.id === 'none' && <span style={S.muted}>多为配方找到的</span>}
              {g.id === 'unknown' && <span style={S.muted}>推文没带关系标记</span>}
            </button>
          );
        })}
        <div style={{ ...S.cell, cursor: 'default', opacity: 0.75 }} title="第 3 块:先采「我回复过他」">
          <span style={S.cellLabel}>回复往来</span>
          <span style={S.muted}>我回复过他:还没采集</span>
          <span style={S.muted}>他回复过我:还没采集</span>
        </div>
      </div>

      {err !== null && <div style={S.error}>⚠️ {err}</div>}

      {/* ③ 列表 + 人卡 */}
      <div style={S.split}>
        {!listHidden && (
          <div style={{ ...S.listPane, ...(showCard && wide ? { flex: '1 1 55%' } : null) }}>
            <div style={S.controls}>
              <label style={S.check}>
                <input type="checkbox" checked={filter.blueOnly}
                  onChange={(e) => setFilter({ ...filter, blueOnly: e.target.checked })} /> 蓝V
              </label>
              <label style={S.check} title="字面信号:有汉字、且没有 2 个以上假名字母(排除日文)。港台、海外华人也会命中;中日双语的中文用户会被当成日文">
                <input type="checkbox" checked={filter.cnText}
                  onChange={(e) => setFilter({ ...filter, cnText: e.target.checked })} /> 中文名或 bio(不含日文)
              </label>
              <label style={S.check} title="Bio 或他自己的推文里有「互关必回 / 关注必回 / 有关必回 / 互粉…」;你右键标过的以你为准">
                <input type="checkbox" checked={filter.intentOnly}
                  onChange={(e) => setFilter({ ...filter, intentOnly: e.target.checked })} /> 有互关倾向
              </label>
              <button type="button" style={S.btn} disabled={scanning} onClick={() => void scanIntent()}
                title="用词组扫一遍所有人的 Bio 和他自己的推文;你标过的不动,不再命中的(算法以前标的)清掉">
                {scanning ? '扫描中…' : '扫描互关倾向'}
              </button>
              <select
                value={filter.scope} style={S.select}
                onChange={(e) => { setUndo(null); setFilter({ ...filter, scope: e.target.value as PeopleScope }); }}
                title="排除过的人默认不显示"
              >
                <option value="in">范围内</option>
                <option value="excluded">已排除{overview ? ` (${overview.excludedTotal.toLocaleString()})` : ''}</option>
              </select>
              <select value={filter.sort} style={S.select}
                onChange={(e) => setFilter({ ...filter, sort: e.target.value as PeopleSort })}>
                {PEOPLE_SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <label style={S.check} title="点一个人时,X 网页跳到他的主页">
                <input type="checkbox" checked={follow} onChange={(e) => { setFollow(e.target.checked); setFollowNote(null); }} />
                点人时 X 网页跟着跳
              </label>
              <input value={filter.text} placeholder="搜 handle / 名字 / bio" style={S.input}
                onChange={(e) => setFilter({ ...filter, text: e.target.value })} />
              {/* ⭐ 标签关键词 —— 有任一标签包含它就命中;输入时提示已有标签 */}
              <input
                value={filter.tag} placeholder="标签关键词" style={{ ...S.input, flex: '0 1 140px' }}
                list="x-ops-tag-catalog"
                onChange={(e) => setFilter({ ...filter, tag: e.target.value })}
                title={catalog.length > 0 ? `已有 ${catalog.length} 个标签` : '还没有标签 —— 右键一个人「打标签…」'}
              />
              <datalist id="x-ops-tag-catalog">
                {catalog.map((c) => <option key={c.tag} value={c.tag}>{`${c.count} 人`}</option>)}
              </datalist>
            </div>
            {/*
              ⭐ 2026-10-20 用户:「这些是配置项,没有必要用户做配置,而是AI执行这些任务时自我优化就可以了。
              根据限流出现的不同来调整这些参数。人参与进来,不是代表着这是一个石器时代的产品吗?」
              → 设置输入框全部拿掉;采集节奏由 x_pace 按限流自调(任务 → 关系采集 底部只读显示)。
            */}
            <div style={S.settingsBar}>
              <span>取关:今日 {gate ? `${gate.todayCount}` : '…'}</span>
              <span style={{ opacity: 0.6 }}>· 采集节奏由 AI 按限流情况自己调</span>
            </div>
            {unfollowPaused !== null && (
              <div style={S.error}>
                ⏸ 取关已暂停:{unfollowPaused}(X 改版、弹验证或限流时连着硬点只会更糟)
                <button type="button" style={S.linkBtn} onClick={() => { void resumeUnfollowOf(workspaceId).then(() => unfollowHaltOf(workspaceId)).then(setUnfollowPaused); setFollowNote(null); }}>恢复</button>
              </div>
            )}
            {followNote !== null && <div style={S.muted}>⚠️ {followNote}</div>}
            {intentNote !== null && (
              <div style={S.muted}>
                🤝 {intentNote}
                <button type="button" style={S.linkBtn} onClick={() => setIntentNote(null)} title="知道了">✕</button>
              </div>
            )}
            {moved !== null && (
              <div style={S.undo}>
                {moved}
                <button type="button" style={S.linkBtn} onClick={() => setMoved(null)} title="知道了">✕</button>
              </div>
            )}
            {undo && (
              <div style={S.undo}>
                已{undo.excluded ? '排除' : '取消排除'} {undo.p.display_name ?? undo.p.handle}(@{undo.p.handle})
                <button type="button" style={S.linkBtn} onClick={() => void doUndo()}>撤销</button>
                <button type="button" style={S.linkBtn} onClick={() => setUndo(null)} title="知道了">✕</button>
              </div>
            )}
            <div style={S.muted}>
              {filter.scope === 'excluded' ? '已排除 · ' : ''}
              {PEOPLE_GROUPS.find((g) => g.id === filter.group)?.label}
              {total === null ? ' · 读取中…' : ` · 共 ${total.toLocaleString()} 人,显示 ${rows.length.toLocaleString()}`}
              {busy && total !== null && ' · 刷新中…'}
            </div>
            <div style={S.list}>
              {rows.map((p, index) => (
                <div
                  key={p.rest_id}
                  onClick={() => selectPerson(p)}
                  onDoubleClick={() => openCard(p)}
                  /** 双击时浏览器会选中一段文字 —— 只挡「第二下」,单击拖选复制照常 */
                  onMouseDown={(e) => { if (e.detail > 1) e.preventDefault(); }}
                  onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, p, index }); }}
                  style={{ ...S.row, ...(selected === p.rest_id ? S.rowActive : null) }}
                >
                  {p.avatar ? <img src={p.avatar} alt="" style={S.avatar} /> : <div style={S.avatar} />}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={S.line}>
                      <strong style={S.name}>{p.display_name ?? p.handle}</strong>
                      {p.is_blue_verified === true && <span style={S.blue} title="蓝V">✓</span>}
                      <span style={S.muted}>@{p.handle}</span>
                    </div>
                    <div style={S.line}>
                      <span style={S.tag}>{relationLabel(p)}</span>
                      <span style={S.muted}>粉丝 {fmt(p.followers_count)}</span>
                      {(p.tags ?? []).map((t) => <span key={t} style={S.userTag}>{t}</span>)}
                      {(p.found_via_recipes ?? []).map((r) => <span key={`r:${r}`} style={S.recipeTag}>配方:{r}</span>)}
                      {p.mutual_intent !== undefined && p.mutual_intent !== null && (
                        <span style={p.mutual_intent ? S.intentTag : S.muted} title={p.mutual_intent_evidence ?? ''}>
                          {p.mutual_intent ? '🤝 互关倾向' : '无互关倾向'}({INTENT_SOURCE[p.mutual_intent_source ?? ''] ?? '?'})
                        </span>
                      )}
                    </div>
                    {p.bio && <div style={S.bio}>{p.bio}</div>}
                    {p.mutual_intent === true && p.mutual_intent_evidence && (
                      <div style={S.muted}>依据 · {p.mutual_intent_evidence}</div>
                    )}
                    {verify[p.rest_id] && (
                      <div style={verify[p.rest_id].kind === 'changed' || verify[p.rest_id].kind === 'miss' ? S.verifyWarn : S.muted}>
                        {{ running: '⏳', same: '✓', changed: '⚠', new: '＋', miss: '?' }[verify[p.rest_id].kind]} {verify[p.rest_id].text}
                        {verify[p.rest_id].kind === 'miss' && (
                          <button type="button" style={S.linkBtn} onClick={(e) => { e.stopPropagation(); openInX(p); }}>再读</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {total !== null && rows.length < total && (
                <button type="button" style={S.btn} disabled={busy} onClick={() => void load(filter, rows.length)}>
                  {busy ? '读取中…' : `再显示 ${Math.min(PAGE, total - rows.length)} 人`}
                </button>
              )}
            </div>
          </div>
        )}
        {showCard && (
          <PersonCard
            restId={cardId!}
            wcId={wcId}
            onOpenInX={(person) => openInX(person)}
            onCollect={(person) => void collectTweets(person, 'month')}
            onCancelCollect={() => {
              cancelCollect.current = true;
              /** ⭐ 翻页在主进程跑 —— 光立 renderer 的标记停不住它 */
              if (wcId != null) void xDataCall({ op: 'cancelPersonCollect', wcId });
            }}
            onUnfollow={(person) => void unfollow(person)}
            unfollowing={unfollowing === cardId}
            collectState={collect[cardId!]}
            wsId={workspaceId}
            bgMsg={bgMsg[cardId!]}
            bgRev={bgRev}
            rev={cardRev}
            onEditTags={(p) => setTagging(p)}
            onToggleExclude={(p) => {
              const index = rows.findIndex((x) => x.rest_id === p.rest_id);
              void toggleExclude(p, index < 0 ? 0 : index);
            }}
            onBack={wide ? undefined : () => setCardId(null)}
            onClose={() => setCardId(null)}
          />
        )}
      </div>

      {/* ⭐ 右键菜单 —— 点别处 / Esc / 滚动就关 */}
      {menu && (
        <div style={{ ...S.menu, left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button
            type="button" style={S.menuItem}
            onClick={() => { const m = menu; setMenu(null); void toggleExclude(m.p, m.index); }}
          >
            {menu.p.excluded === true ? '取消排除(放回分析范围)' : '排除(不在分析范围)'}
          </button>
          <button
            type="button" style={S.menuItem}
            onClick={() => { openCard(menu.p); setMenu(null); }}
          >
            打开人卡
          </button>
          <button
            type="button" style={S.menuItem}
            onClick={() => { setTagging(menu.p); setMenu(null); }}
          >
            打标签…
          </button>
          {/* ⭐ 用户 10-10:「右键点击，获取这三项数据」—— 探查版先直接采(各 2 页),时间范围选择在正式版加 */}
          <button
            type="button" style={S.menuItem}
            disabled={collect[menu.p.rest_id]?.running === true}
            onClick={() => { const m = menu; setMenu(null); setRangeFor(m.p); }}
          >
            采他的帖子/回复/转发…
          </button>
          <button
            type="button" style={S.menuItem}
            onClick={() => { const m = menu; setMenu(null); void markIntent(m.p, m.p.mutual_intent !== true); }}
            title="你的判断优先:标过之后,扫描不会再改他"
          >
            {menu.p.mutual_intent === true ? '标为无互关倾向' : '标为有互关倾向'}
          </button>
          {menu.p.i_follow === true && (
            <button
              type="button" style={S.menuItem}
              disabled={unfollowing !== null}
              onClick={() => { const m = menu; setMenu(null); void unfollow(m.p); }}
            >
              取关
            </button>
          )}
        </div>
      )}

      {rangeFor && (
        <div style={S.backdrop} onClick={() => setRangeFor(null)}>
          <div style={S.dialog} onClick={(e) => e.stopPropagation()}>
            <div style={S.cardTitle}>采 @{rangeFor.handle} 的帖子、回复、转发</div>
            <div style={S.muted}>时间范围(到了起点就停;置顶推文不算)</div>
            {TIMELINE_RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                style={r.id === 'month' ? S.btnPrimary : S.btn}
                title={r.id === 'month' ? `当场采,每页最多翻 ${LIVE_PAGE_CAP} 页` : '后台慢慢采:按节奏一段段翻,跨重启接着采,进度在人卡里看'}
                onClick={() => {
                  const pr = rangeFor; setRangeFor(null); openCard(pr);
                  if (r.id === 'month') void collectTweets(pr, r.id);
                  else void createBgJob(pr, r.id);
                }}
              >
                {r.label}{r.id !== 'month' ? '(后台慢慢采)' : '(当场采)'}
              </button>
            ))}
            <button type="button" style={S.btn} onClick={() => setRangeFor(null)}>取消</button>
          </div>
        </div>
      )}

      {tagging && (
        <TagDialog
          person={tagging}
          catalog={catalog}
          onSave={async (tags) => {
            const why = await saveTags(tagging, tags);
            if (why === null) setTagging(null);
            return why;
          }}
          onCancel={() => setTagging(null)}
        />
      )}
    </div>
  );
}

/** ⭐ 人卡 —— 事实(采来的)与推断(AI 猜的)分开;缺的就是采集入口 */
function PersonCard(
  { restId, wcId, onBack, onClose, onToggleExclude, onOpenInX, onEditTags, rev, onCollect, collectState, onUnfollow, unfollowing, onCancelCollect, bgMsg, bgRev, wsId }: {
    restId: string; wcId: number | null;
    /** 发起的号(ws)—— 后台任务属于它 */
    wsId: string; onBack?: () => void; onClose: () => void;
    /** ⭐ 刚建后台任务的那句提示 */
    bgMsg?: string;
    /** 建了后台任务要立刻重读 —— 递增即重读 */
    bgRev: number;
    onToggleExclude: (p: PersonRow) => void;
    onEditTags: (p: PersonRow) => void;
    /** 标签改了要重读 —— 递增即重读 */
    rev: number;
    /** ⭐ 与「点人跳主页」同一个函数 —— 忙不跳、一次只核对一个的规矩只有一份 */
    onOpenInX: (p: PersonRow) => void;
    onCollect: (p: PersonRow) => void;
    onCancelCollect: () => void;
    onUnfollow: (p: PersonRow) => void;
    unfollowing: boolean;
    collectState?: { running: boolean; text: string };
  },
): ReactElement {
  const [p, setP] = useState<PersonDetail | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setP(undefined);
    void xDataCall({ op: 'personDetail', wsId, restId }).then((r) => {
      if (r.status === 'ok') { setP(r.value as PersonDetail | null); setErr(null); }
      else setErr(r.reason);
    });
  }, [restId, rev, wsId]);

  /** ⭐ 他的朋友圈 —— 从推文现算,前 30 人 */
  const [circle, setCircle] = useState<{ tweets: number; people: number; rows: CirclePerson[] } | null>(null);
  useEffect(() => {
    setCircle(null);
    void xDataCall({ op: 'friendCircle', wsId, restId, limit: 30 }).then((r) => {
      if (r.status === 'ok') setCircle(r.value as { tweets: number; people: number; rows: CirclePerson[] });
    });
  }, [restId, rev, wsId]);

  /** ⭐ 他的推文 —— 按数字 id 查,最新 20 条 */
  const [tw, setTw] = useState<{ total: number; rows: PersonTweet[] } | null>(null);
  useEffect(() => {
    setTw(null);
    void xDataCall({ op: 'personTweets', restId, limit: 20 }).then((r) => {
      if (r.status === 'ok') setTw(r.value as { total: number; rows: PersonTweet[] });
    });
  }, [restId, rev]);

  const openProfile = (): void => {
    if (p) onOpenInX(p);
  };

  return (
    <div style={S.cardPane}>
      <div style={S.line}>
        {onBack && <button type="button" style={S.btn} onClick={onBack}>← 返回列表</button>}
        <span style={{ flex: 1 }} />
        {!onBack && <button type="button" style={S.btn} onClick={onClose} title="关闭人卡">✕</button>}
      </div>
      {err !== null && <div style={S.error}>⚠️ {err}</div>}
      {p === undefined && err === null && <div style={S.muted}>读取中…</div>}
      {p === null && <div style={S.error}>这个人不在库里了(数字 id {restId})</div>}
      {p && (
        <>
          <div style={S.cardHead}>
            {p.avatar ? <img src={p.avatar} alt="" style={S.bigAvatar} /> : <div style={S.bigAvatar} />}
            <div style={{ minWidth: 0 }}>
              <div style={S.line}>
                <strong style={{ ...S.name, fontSize: 15 }}>{p.display_name ?? p.handle}</strong>
                {p.is_blue_verified === true && <span style={S.blue}>✓ 蓝V</span>}
                {p.is_verified === true && <span style={S.tag}>认证</span>}
                {p.is_protected === true && <span title="受保护:采不到他的推文">🔒</span>}
              </div>
              <div style={S.line}>
                <span style={S.muted}>@{p.handle}</span>
                <span style={S.tag}>{relationLabel(p)}</span>
              </div>
            </div>
          </div>

          <div style={S.line}>
            <span style={S.muted}>
              {p.excluded === true
                ? `已排除(${p.excluded_source === 'human' ? '你' : p.excluded_source ?? '?'}${p.excluded_at ? ` · ${new Date(p.excluded_at).toLocaleDateString()}` : ''})`
                : '在分析范围内'}
            </span>
            <button type="button" style={S.btn} onClick={() => onToggleExclude(p)}>
              {p.excluded === true ? '取消排除' : '排除'}
            </button>
            {p.i_follow === true && (
              <button type="button" style={S.btn} disabled={unfollowing} onClick={() => onUnfollow(p)}>
                {unfollowing ? '取关中…' : '取关'}
              </button>
            )}
          </div>

          <div style={S.line}>
            <span style={S.factKey}>标签</span>
            {(p.tags ?? []).length === 0
              ? <span style={S.muted}>还没有</span>
              : (p.tags ?? []).map((t) => <span key={t} style={S.userTag}>{t}</span>)}
            <button type="button" style={S.btn} onClick={() => onEditTags(p)}>编辑标签</button>
          </div>
          {(p.found_via_recipes ?? []).length > 0 && (
            <div style={S.line}>
              <span style={S.factKey}>来源</span>
              {(p.found_via_recipes ?? []).map((r) => <span key={r} style={S.recipeTag}>配方:{r}</span>)}
            </div>
          )}

          <Section title="事实" note={p.fetched_at ? `采于 ${new Date(p.fetched_at).toLocaleString()}` : '采集时间未知'}>
            <Fact k="粉丝 / 关注 / 发推" v={`${fmt(p.followers_count)} / ${fmt(p.following_count)} / ${fmt(p.tweet_count)}`} />
            <Fact k="注册" v={p.account_created_at ? p.account_created_at.slice(0, 10) : '—'} />
            <Fact k="地点" v={p.location || '未填'} />
            {p.website && <Fact k="网站" v={p.website} />}
            <Fact k="曾用名" v={p.handle_history && p.handle_history.length > 0 ? p.handle_history.map((h) => `@${h}`).join('、') : '无'} />
            <Fact k="数字 id" v={p.rest_id} />
            {p.bio && <div style={S.bioFull}>{p.bio}</div>}
          </Section>

          <Section title="推断" note="AI / 算法 —— 还没做">
            <Fact k="大陆背景" v="还没做(下一块:你标 > AI > 算法)" />
            <Fact k="省份 / 内容定位" v="还没做" />
            <button type="button" style={S.btn} disabled title="第 4 块">分析他(还没做)</button>
          </Section>

          {/* ⭐ 放在「他的推文」上面 —— 下面是 20 条推文,放后面要翻很远才看得到(用户 10-15 找不到) */}
          <BgJobsSection restId={restId} wsId={wsId} msg={bgMsg} rev={bgRev} />

          {/* ⭐ 2026-10-19 用户:「在人卡中增加自动采集follower/following/verified followers」—— 后台采全 + 名单里的求关候选 */}
          <Section title="他的名单" note="关注者 / 他关注的 / 蓝V关注者">
            <XPersonLists wsId={wsId} restId={restId} handle={p.handle} wcOpen={wcId != null}
              onOpenInX={(x) => onOpenInX({ rest_id: x.rest_id, handle: x.handle } as PersonRow)} />
          </Section>

          <Section
            title="他的推文"
            note={tw === null ? '读取中…' : tw.total === 0 ? '还没采集' : `库里 ${tw.total} 条,显示最新 ${tw.rows.length} 条`}
          >
            <div style={S.line}>
              <button
                type="button" style={S.btn}
                disabled={collectState?.running === true || wcId == null}
                onClick={() => onCollect(p)}
                title={wcId == null ? 'X 网页没开' : '采最近一个月的帖子 / 回复 / 转发'}
              >
                {collectState?.running ? '采集中…' : '采最近一个月'}
              </button>
              {collectState?.running && (
                <button type="button" style={S.btn} onClick={onCancelCollect}>停止</button>
              )}
              {collectState && <span style={S.muted}>{collectState.text}</span>}
            </div>
            {tw?.rows.map((t) => (
              <div key={t.tweet_id} style={S.tweetRow}>
                <div style={S.muted}>
                  {t.created_at ? new Date(t.created_at).toLocaleString() : '时间未知'}
                  {t.in_reply_to_user && <> · 回复 @{t.in_reply_to_user}</>}
                </div>
                <div style={S.tweetText}>{t.text || '(没有正文)'}</div>
              </div>
            ))}
          </Section>

          <Section
            title="他的朋友圈"
            note={circle === null ? '读取中…' : circle.tweets === 0 ? '还没采他的推文' : `基于他的 ${circle.tweets} 条推文 · 共 ${circle.people} 人`}
          >
            {circle && circle.rows.length > 0 && (
              <div style={S.muted}>
                其中你还没关注的蓝V中文:{circle.rows.filter((c) => c.i_follow !== true && c.is_blue_verified === true && c.chinese).length} 人(前 {circle.rows.length} 人里)
              </div>
            )}
            {circle?.rows.map((c) => (
              <div
                key={c.id}
                style={{ ...S.row, cursor: c.handle ? 'pointer' : 'default' }}
                onClick={() => { if (c.handle) onOpenInX({ rest_id: c.id, handle: c.handle } as PersonRow); }}
                title={c.handle ? '在 X 网页打开他的主页(顺手核对)' : '只知道数字 id'}
              >
                {c.avatar ? <img src={c.avatar} alt="" style={S.avatar} /> : <div style={S.avatar} />}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={S.line}>
                    <strong style={S.name}>{c.display_name ?? (c.handle ? `@${c.handle}` : c.id)}</strong>
                    {c.is_blue_verified === true && <span style={S.blue}>✓</span>}
                    {c.handle && c.display_name && <span style={S.muted}>@{c.handle}</span>}
                    {c.inTable ? <span style={S.tag}>{relationLabel(c)}</span> : <span style={S.muted}>(人表里还没有)</span>}
                    {c.chinese && <span style={S.tag}>中文</span>}
                  </div>
                  <div style={S.muted}>
                    {[c.reply && `回复 ${c.reply}`, c.theyReply && `被回复 ${c.theyReply}`, c.quote && `引用 ${c.quote}`,
                      c.mention && `提及 ${c.mention}`, c.retweet && `转发 ${c.retweet}`].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
            ))}
          </Section>

          {/* ⭐ 第 4 阶段(2026-10-19):用户选「人卡里一个『互动』栏」—— 求关 / 回关 / 回复往来一条线 */}
          <Section title="我们的互动" note="从早到晚">
            <XPersonTimeline wsId={wsId} restId={restId} rev={rev} />
          </Section>

          <button
            type="button"
            style={S.btn}
            disabled={wcId == null}
            onClick={openProfile}
            title={wcId == null ? 'X 网页没开,打不开' : '在 X 网页打开他的主页'}
          >
            在 X 网页打开他的主页
          </button>
        </>
      )}
    </div>
  );
}

/**
 * ⭐ 打标签对话框 —— 用户要的是「一个简单的对话框，我输入我自己想要的标签」。
 * 回车加一个(逗号/顿号可一次加多个),✕ 去掉;输入时提示已有标签(防同义写法分叉)。
 * ⚠️ 存失败对话框不关,原因显示出来 —— 人填的东西别丢。
 */
function TagDialog(
  { person, catalog, onSave, onCancel }: {
    person: PersonRow;
    catalog: ReadonlyArray<{ tag: string; count: number }>;
    onSave: (tags: string[]) => Promise<string | null>;
    onCancel: () => void;
  },
): ReactElement {
  const [tags, setTags] = useState<string[]>([...(person.tags ?? [])]);
  const [input, setInput] = useState('');
  const [why, setWhy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** 把输入框里的东西加进去 —— 清洗规则与存库同一个函数 */
  const commit = (): string[] => {
    const { tags: next, problems } = normalizeTags([...tags, ...splitTagInput(input)]);
    setWhy(problems.length > 0 ? problems.join(';') : null);
    if (problems.length === 0) setInput('');
    setTags(next);
    return problems.length === 0 ? next : tags;
  };

  const save = async (): Promise<void> => {
    const next = input.trim() === '' ? tags : commit();
    if (input.trim() !== '' && next === tags) return;
    setSaving(true);
    const err = await onSave(next);
    setSaving(false);
    if (err !== null) setWhy(err);
  };

  /**
   * ⭐ 已有标签 —— 用户 2026-10-08:「输入框+已存在的标签的方式组合，这样我不用一个一个输入标签，
   * 可以从历史标签中选择。」点一下加上、再点去掉;打字时只留包含这几个字的。
   */
  const has = (t: string): boolean => tags.some((x) => x.toLowerCase() === t.toLowerCase());
  const toggle = (t: string): void => {
    setWhy(null);
    setTags(has(t) ? tags.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...tags, t]);
  };
  const kw = input.trim().toLowerCase();
  const shown = kw === '' ? catalog : catalog.filter((c) => c.tag.toLowerCase().includes(kw));

  return (
    <div style={S.backdrop} onClick={onCancel}>
      <div
        style={S.dialog}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
      >
        <div style={S.cardTitle}>给 {person.display_name ?? person.handle}(@{person.handle})打标签</div>
        <div style={{ ...S.line, minHeight: 26 }}>
          <span style={S.muted}>已选:</span>
          {tags.length === 0 && <span style={S.muted}>还没有</span>}
          {tags.map((t) => (
            <span key={t} style={S.userTag}>
              {t}
              <button type="button" style={S.chipX} onClick={() => setTags(tags.filter((x) => x !== t))} title="去掉">✕</button>
            </span>
          ))}
        </div>
        <input
          autoFocus
          value={input}
          placeholder="输入新标签,回车加入(逗号可一次加多个);也会筛下面的已有标签"
          /** ⚠️ flex: none —— 借用的 S.input 带 flex-basis 140px,放进竖排对话框会变成 140px 高(2026-10-08 截图) */
          style={{ ...S.input, flex: 'none' }}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (input.trim() === '') void save(); else commit();
            }
          }}
        />
        {catalog.length > 0 && (
          <div style={S.catalogBox}>
            <div style={S.muted}>
              已有标签(点一下加上 / 再点去掉){kw !== '' && ` · 包含「${input.trim()}」的 ${shown.length} 个`}
            </div>
            <div style={S.catalogChips}>
              {shown.length === 0 && <span style={S.muted}>没有匹配的 —— 回车就加成新标签</span>}
              {shown.map((c) => (
                <button
                  key={c.tag}
                  type="button"
                  onClick={() => toggle(c.tag)}
                  style={has(c.tag) ? S.pickOn : S.pickOff}
                  title={has(c.tag) ? '已选,点一下去掉' : `${c.count} 人用过,点一下加上`}
                >
                  {c.tag} <span style={{ opacity: 0.6 }}>{c.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {why !== null && <div style={S.error}>⚠️ {why}</div>}
        <div style={{ ...S.line, justifyContent: 'flex-end' }}>
          <button type="button" style={S.btn} onClick={onCancel}>取消</button>
          <button type="button" style={S.btnPrimary} disabled={saving} onClick={() => void save()}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * ⭐⭐ 人卡「后台采集」—— 这个人的后台任务 + 一句话进度 + 暂停/恢复/取消(2026-10-14 第 4 步)。
 * ⚠️ X 没有推送通道:每 5 秒问一次(与采一个月的进度同套路);一段要几分钟,5 秒足够。
 * ⚠️ 取消 = 删任务(断点是派生状态,已采的推文都在库里不受影响)。
 */
function BgJobsSection({ restId, wsId, msg, rev }: { restId: string; wsId: string; msg?: string; rev: number }): ReactElement {
  /** ⭐ 此刻在不在跑 —— 与运营顶栏同一个 hook */
  const { st } = useBgStatus(wsId);
  const [jobs, setJobs] = useState<BgJob[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = (): void => {
      void xDataCall({ op: 'bgListJobs', restId }).then((r) => {
        if (!alive) return;
        if (r.status === 'ok') { setJobs(r.value as BgJob[]); setErr(null); } else setErr(r.reason);
      });
    };
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [restId, rev, tick]);

  const act = async (op: 'bgPauseJob' | 'bgResumeJob' | 'bgCancelJob', id: string): Promise<void> => {
    const r = await xDataCall({ op, id });
    if (r.status !== 'ok') setErr(r.reason);
    setTick((n) => n + 1);
  };

  const rangeLabel = (j: BgJob): string => (j.kind === 'lists' ? '他的名单(采全)' : TIMELINE_RANGES.find((x) => x.id === j.range)?.label ?? j.range);
  return (
    <Section title="后台采集" note={jobs === null ? '读取中…' : jobs.length === 0 ? '没有后台任务(右键「采他的帖子/回复/转发…」选半年/一年/全部)' : `${jobs.length} 个任务`}>
      {msg && <div style={S.muted}>{msg}</div>}
      {err && <div style={S.muted}>⚠️ {err}</div>}
      {jobs?.map((j) => (
        <div key={j.id} style={S.tweetRow}>
          <div style={S.line}>
            <strong>{rangeLabel(j)}</strong>
            <span style={S.muted}>{j.lastSegmentAt ? `上一段 ${new Date(j.lastSegmentAt).toLocaleString()}` : '还没跑过一段'}</span>
          </div>
          <div style={S.tweetText}>{describeProgress(j)}</div>
          {st?.live?.jobId === j.id && (
            <div style={{ ...S.muted, color: '#4caf50' }}>
              🟢 此刻正在采:{st.live.msg}{st.live.pageMsg ? ` · ${st.live.pageMsg}` : ''}
            </div>
          )}
          {st?.live?.jobId !== j.id && (j.status === 'queued' || j.status === 'running') && (
            <div style={S.muted}>
              ⏳ 等待:{st?.live ? `这个号正在采 @${st.live.handle},同一个号一次只采一个` : (st?.waitNote ?? '还没轮到检查')}
              {st?.nextTickAt != null && !st.live ? ` · 约 ${Math.max(0, Math.round((st.nextTickAt - st.now) / 1000))} 秒后再看` : ''}
            </div>
          )}
          <div style={S.line}>
            {(j.status === 'queued' || j.status === 'running') && (
              <button type="button" style={S.btn} onClick={() => void act('bgPauseJob', j.id)}>暂停</button>
            )}
            {j.status === 'paused' && (
              <button type="button" style={S.btn} onClick={() => void act('bgResumeJob', j.id)}>恢复</button>
            )}
            <button
              type="button" style={S.btn}
              title="删掉这个任务(已采的推文留在库里)"
              onClick={() => void act('bgCancelJob', j.id)}
            >
              {j.status === 'done' || j.status === 'failed' ? '移除' : '取消'}
            </button>
          </div>
        </div>
      ))}
    </Section>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }): ReactElement {
  return (
    <div style={S.section}>
      <div style={S.line}><span style={S.cardTitle}>{title}</span>{note && <span style={S.muted}>{note}</span>}</div>
      {children}
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }): ReactElement {
  return (
    <div style={S.fact}><span style={S.factKey}>{k}</span><span style={S.factVal}>{v}</span></div>
  );
}

const S: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 10, height: '100%', minHeight: 0 },
  card: {
    border: '1px solid var(--border-color, #333)', borderRadius: 6, padding: '8px 12px',
    display: 'flex', flexDirection: 'column', gap: 4,
  },
  cardTitle: { fontSize: 12, color: 'var(--text-secondary, #aaa)' },
  muted: { fontSize: 11, color: 'var(--text-muted, #888)' },
  error: { fontSize: 12, color: 'var(--text-primary, #ddd)', border: '1px solid #7a3b3b', borderRadius: 4, padding: 8 },
  cells: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 6 },
  cell: {
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, textAlign: 'left',
    background: 'transparent', border: '1px solid var(--border-color, #333)', borderRadius: 6,
    padding: '8px 10px', cursor: 'pointer', color: 'var(--text-secondary, #aaa)',
  },
  cellActive: { borderColor: 'var(--accent-bar, #6b9fff)', background: 'var(--accent-bg, rgba(138,180,248,0.15))' },
  cellLabel: { fontSize: 11, color: 'var(--text-secondary, #aaa)' },
  cellNum: { fontSize: 18, color: 'var(--text-primary, #ddd)', fontVariantNumeric: 'tabular-nums' },
  split: { flex: 1, minHeight: 0, display: 'flex', gap: 10 },
  listPane: { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 },
  controls: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  check: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary, #aaa)' },
  select: {
    background: 'var(--bg-elevated, #1b1b1b)', border: '1px solid var(--border-color, #3a3a3a)', borderRadius: 4,
    color: 'var(--text-primary, #ddd)', fontSize: 12, padding: '3px 4px',
  },
  input: {
    flex: '1 1 140px', minWidth: 0, background: 'var(--bg-elevated, #1b1b1b)',
    border: '1px solid var(--border-color, #3a3a3a)', borderRadius: 4,
    color: 'var(--text-primary, #ddd)', fontSize: 12, padding: '4px 6px',
  },
  list: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' },
  row: {
    display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 4px', cursor: 'pointer',
    borderTop: '1px solid var(--border-color, #2a2a2a)',
  },
  rowActive: { background: 'var(--accent-bg, rgba(138,180,248,0.15))' },
  avatar: { width: 32, height: 32, borderRadius: '50%', background: '#2a2a2a', flexShrink: 0 },
  bigAvatar: { width: 48, height: 48, borderRadius: '50%', background: '#2a2a2a', flexShrink: 0 },
  line: { display: 'flex', gap: 6, alignItems: 'center', minWidth: 0, flexWrap: 'wrap', lineHeight: 1.6 },
  name: { color: 'var(--text-primary, #ddd)' },
  blue: { color: '#1d9bf0', fontWeight: 700, fontSize: 12 },
  tag: { fontSize: 10, border: '1px solid var(--border-color, #444)', borderRadius: 3, padding: '0 4px', color: 'var(--text-secondary, #aaa)' },
  bio: {
    fontSize: 11, color: 'var(--text-muted, #888)', lineHeight: 1.6,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
  btn: {
    background: 'transparent', border: '1px solid var(--border-color, #444)', borderRadius: 4,
    color: 'var(--text-secondary, #aaa)', cursor: 'pointer', fontSize: 12, padding: '4px 10px',
    alignSelf: 'flex-start',
  },
  cardPane: {
    flex: '1 1 45%', minWidth: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10,
    border: '1px solid var(--border-color, #333)', borderRadius: 6, padding: 12,
  },
  cardHead: { display: 'flex', gap: 10, alignItems: 'center' },
  section: {
    display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 8,
    borderTop: '1px solid var(--border-color, #2a2a2a)',
  },
  fact: { display: 'flex', gap: 8, fontSize: 12 },
  factKey: { width: 104, flexShrink: 0, color: 'var(--text-muted, #888)' },
  factVal: { color: 'var(--text-primary, #ddd)', wordBreak: 'break-all' },
  /** 核对有变化 / 没读到 —— 要让人注意,用正文色,不只靠颜色(前面有 ⚠ / ? 图标) */
  verifyWarn: { fontSize: 11, color: 'var(--text-primary, #ddd)' },
  tweetRow: { padding: '6px 0', borderTop: '1px solid var(--border-color, #2a2a2a)' },
  tweetText: { fontSize: 12, lineHeight: 1.6, color: 'var(--text-primary, #ddd)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  settingsBar: { display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', fontSize: 12, color: 'var(--text-secondary, #aaa)' },
  undo: {
    display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 8px', borderRadius: 4,
    color: 'var(--text-primary, #ddd)', background: 'var(--accent-bg, rgba(138,180,248,0.15))',
  },
  linkBtn: {
    background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 12,
    color: 'var(--accent-text, #8ab4f8)',
  },
  /** ⚠️ z-index 1000:与 app 的 popup 同层,高于运营全屏覆盖层(900) */
  menu: {
    position: 'fixed', zIndex: 1000, display: 'flex', flexDirection: 'column', minWidth: 180, padding: 4,
    background: 'var(--bg-popup, #2a2a2a)', border: '1px solid var(--border-color, #444)', borderRadius: 6,
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
  },
  menuItem: {
    textAlign: 'left', background: 'transparent', border: 'none', borderRadius: 4, cursor: 'pointer',
    color: 'var(--text-primary, #ddd)', fontSize: 12, padding: '6px 10px',
  },
  /** 你打的标签 —— 与「关系」那种系统标签样子要分得开 */
  userTag: {
    display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, borderRadius: 10, padding: '0 8px',
    color: 'var(--accent-text, #8ab4f8)', background: 'var(--accent-bg, rgba(138,180,248,0.15))',
  },
  /** ⭐ 配方来源 —— 系统记录的事实,与你手打的标签样子分开(虚线框、不填色) */
  intentTag: {
    fontSize: 11, padding: '0 6px', borderRadius: 8,
    background: 'rgba(80, 200, 120, 0.15)', color: '#5fc98a', border: '1px solid rgba(80, 200, 120, 0.4)',
  },
  recipeTag: {
    display: 'inline-flex', alignItems: 'center', fontSize: 11, borderRadius: 10, padding: '0 8px',
    color: 'var(--text-secondary, #aaa)', border: '1px dashed var(--border-color, #555)',
  },
  chipX: {
    background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 10,
    color: 'var(--accent-text, #8ab4f8)',
  },
  backdrop: {
    position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.35)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  dialog: {
    width: 'min(420px, calc(100vw - 32px))', display: 'flex', flexDirection: 'column', gap: 10, padding: 16,
    background: 'var(--bg-popup, #2a2a2a)', border: '1px solid var(--border-color, #444)', borderRadius: 8,
    boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
  },
  catalogBox: { display: 'flex', flexDirection: 'column', gap: 6 },
  /** 标签多了也不撑爆对话框 —— 自己滚 */
  catalogChips: { display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 160, overflowY: 'auto' },
  pickOff: {
    fontSize: 12, borderRadius: 12, padding: '2px 10px', cursor: 'pointer',
    background: 'transparent', color: 'var(--text-secondary, #aaa)',
    border: '1px solid var(--border-color, #444)',
  },
  pickOn: {
    fontSize: 12, borderRadius: 12, padding: '2px 10px', cursor: 'pointer',
    background: 'var(--accent-bg, rgba(138,180,248,0.15))', color: 'var(--accent-text, #8ab4f8)',
    border: '1px solid var(--accent-bar, #6b9fff)',
  },
  btnPrimary: {
    background: 'var(--accent, #1d4ed8)', border: '1px solid var(--accent, #1d4ed8)', borderRadius: 4,
    color: '#fff', cursor: 'pointer', fontSize: 12, padding: '4px 14px',
  },
  bioFull: { fontSize: 12, color: 'var(--text-secondary, #aaa)', lineHeight: 1.7, whiteSpace: 'pre-wrap', marginTop: 4 },
};
