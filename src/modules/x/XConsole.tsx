/**
 * X Console —— ⭐ **调试台**:逐个原子能力单独跑、看**原样**返回值
 *
 * ── 用户 2026-10-01 定的用途 ──
 *
 * 「专门用于调试控制、输入、输出(采集)等子函数使用」
 * · 控制 —— 跳转各页面、滚动、选定输入框
 * · 输入 —— 在选定输入框内输入、确认、发送
 * · 输出 —— 完整获取页面信息并落进数据模型
 *
 * ── ⭐ 它是调试台,不是功能面板 ──
 *
 * 判据:**每个按钮只调一个底座函数,返回值原样显示,不美化**。
 * ⚠️ 一旦开始「帮用户把两步连起来」,它就从调试台变成了业务流水线 ——
 * 而那时出问题就分不清是哪一步坏的。
 *
 * ⚠️⚠️ **红线:绝不提供「点发布」按钮。**
 * 用户反复确认过:只填内容,发布永远由人点。
 * 本文件可以 `type`(填进输入框),**不可以** `tap` 发布按钮。
 *
 * ── 本步(第 1 步)的范围 ──
 *
 * 骨架 + 控制那栏接通。输入/输出两栏先占位 ——
 * ⭐ 把「能不能调通」与「调得对不对」分开验。
 *
 * ── ⭐⭐ 对称性(2026-10-02 加)──
 *
 * 用户:「在左边操作,右边自动识别行为并填写上参数?」
 *
 * ⚠️⚠️ **做成「建议」而不是「自动覆盖」** —— 这是刻意的取舍:
 * 自动跟随左栏会在两种场合咬人,
 * ① 人在右栏打了一半参数,左栏一跳转就被冲掉;
 * ② 更贵的那次 —— 记忆 `project-x-collect-panel-scraped-homepage`:
 *    「跟着左边走」把人选好的 `x.profile` **静默改成** `x.home`,
 *    结果爬了自己 For You 首页 1281 条、703 轮、30 分钟,污染入库。
 *    真因正是**自动跟随覆盖了人的选择且不出声**。
 * ⭐ 所以这里只**显示**识别结果,人点「用它」才写进下拉与参数框。
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { WebDomInvoke, WebDomResult } from '@shared/ipc/web-dom-types';
import { xDataCall } from './x-data-types';
import type { XDataResult } from './x-data-types';
import {
  auditTimelinePayload, summarizeAudits, mergeExpandedText, type TimelineAudit,
} from './x-timeline-audit';
import {
  X_TIMELINE_ENDPOINTS, X_NOISY_URLS, X_PAGE_MATCHERS, X_PAGE_NAME,
  X_USER_LIST_PAGES, isTimelineOp,
} from './x-pages';
import { describePayload } from './x-payload-shape';
import { exportAuditText } from './x-audit-export';
import { X_SCRIPTS } from './x-dom-scripts';
import { runCollect, type RunResult } from './x-collect-run';
import { buildRunReport } from './x-run-report';
import { recipeToQuery } from './x-recipe-query';
import { setXHostBusy } from './x-host-registry';
import type { SearchRecipe } from '@shared/types/x-timeline-types';
import type { FetchDepth, TweetNeed } from './x-fetch-plan';

type PageTable = {
  owner: string;
  names: string[];
  /** ⭐ 每个页面要哪些参数 —— **从真表来**,面板不抄 */
  params: Record<string, string[]>;
  /** ⭐ 每个参数该填什么 —— **从真表来**,面板不许自己写 `k === 'handle'` 分支 */
  hints: Record<string, string>;
  /**
   * ⭐⭐ 哪些参数不填也能跑 —— **从真表来**。
   * ⚠️ 旧实现把这个清单写死成只有 `'f'`,于是新增的 `days` 被当成必填
   * → 不填就点不了,而面板不说为什么。「清单不会自己长」同族。
   */
  optional: Record<string, string[]>;
};

/**
 * 能力 tab —— ⭐ 三者**平级互斥**,不是三段内容。
 * ⚠️ 加能力时只改这里和 `CAP_TABS`,JSX 里不写第四处判断。
 */
type CapTab = 'control' | 'input' | 'output' | 'recipe';

/** ⚠️ 标签文字与 id 同在一处 —— 分开写两份必漂 */
const CAP_TABS: ReadonlyArray<{ id: CapTab; label: string; sub: string }> = [
  { id: 'control', label: '控制', sub: 'web.page' },
  { id: 'input', label: '输入', sub: 'web.input' },
  { id: 'output', label: '输出', sub: 'web.net' },
  /**
   * ⭐⭐ 配方 —— 前三个是**底座能力**(web.page/input/net),这一个是 **X 的业务**。
   * 用户 2026-10-04:「配方的配置功能也要增加上来哦。」
   * ⚠️ 仍然并排平级 —— 用户 2026-10-02 的原话是「X console 中的**各种能力**
   * 是并排的」,配方配置也是这个台子的一项能力,不该竖着堆在输出下面。
   */
  /** ⚠️ `sub` 从**常量**取,不写字面量 —— 面板里不许出现写死的语义页名 */
  { id: 'recipe', label: '配方', sub: X_PAGE_NAME.search },
];

/** 左栏当前页的识别结果(来自底座 `identify`,不是面板自己 parse 的) */
type Identified = {
  /** ⭐ 记下是**哪个 URL** 认出来的 —— 免得 URL 已变而建议还是旧的 */
  url: string;
  name: string;
  params: Record<string, string>;
};

/**
 * ⭐⭐⭐ 一次「取全这一页」的报告 —— 与底座 `AcquireReport` 同构。
 *
 * ── 用户 2026-10-02 ──
 * 「我需要的是**完整的数据**,而不是分这么多类别。」
 * 「不是选择用哪条腿 —— 你要构建**获取完整信息的函数/或者类**。」
 *
 * ⭐ 所以面板上**没有** CaptureStats / HookStats 这些按腿分的类型了:
 * 那是实现细节,合并在底座完成,这里只认一份结果。
 */
/**
 * ⭐⭐ 一次「采这一页」的报告 —— 与底座 `HarvestReport` 同构。
 *
 * ── 用户 2026-10-03 ──
 * 「我自己选定一个页面,**点击开始采集,就采集**,采集完毕后再验证」
 * 「每次采集 **10 页**」
 *
 * ⚠️ 它比 `AcquireReport` 多了**过程事实**(轮次/滚动/页数):
 * 没有它们,「只采到 N 页」分不清是**采少了**还是**页面就这么多**。
 */
type HarvestReport = {
  /** ⭐ 其中算「一页」的有几条 */
  pages: number;
  /** ⭐ 每轮展开的产出 —— 底座原样转,由这里解释 */
  afterRound: unknown[];
  rounds: number;
  scrolledPx: number;
  reachedBottom: boolean;
  ok: boolean;
  problems: string[];
  items: AcquiredItem[];
  elapsedMs: number;
  stopReason: string;
  /**
   * ⚠️ 各腿计数是**证据不是选项** —— 面板只在出问题时显示它,
   * 用来回答「为什么只采到这么点」,正常时它是噪音。
   */
  legs: {
    cdp: number; hook: number; both: number;
    hookInjected: boolean; cdpAttached: boolean;
  };
};

/** 采到的一条 —— ⭐ 对外只有这一种形状,不分腿 */
type AcquiredItem = {
  url: string;
  method: string;
  status: number;
  text: string;
  byteLength: number;
  at: string;
  /** ⚠️ 证据字段:正常情况下面板不该用它做任何分支 */
  from: 'cdp' | 'hook' | 'both';
};

/** 一次调用的留痕 —— ⭐ 存**整个 Result**,不只存成功与否 */
type LogEntry = {
  at: string;
  label: string;
  /**
   * ⚠️ 三种来源:底座的 `WebDomResult`、X 自己的 `XDataResult`(落库/配方)、
   * 以及 catch 里兜的那种。**原样存**,三态都要看得见。
   */
  result: WebDomResult | XDataResult | { status: 'error'; reason: string };
};

export function XConsole(
  { wcId, hostUrl }: { wcId: number | null; hostUrl: string },
): ReactElement {
  const [tables, setTables] = useState<PageTable[]>([]);
  const [pageName, setPageName] = useState('');
  /** 参数值:`{ handle: 'elonmusk' }` —— ⭐ 字段**由真表决定**,不写死 */
  const [paramVals, setParamVals] = useState<Record<string, string>>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  /**
   * 左栏当前页的识别结果 —— ⭐ 只用于**显示建议**,不自动写进上面的下拉。
   * `null` = 底座说「不认识这一页」(正常答案,不是故障)。
   */
  const [identified, setIdentified] = useState<Identified | null>(null);
  /** 展开看原样 JSON 的那一条 */
  const [openPayload, setOpenPayload] = useState<string | null>(null);
  /**
   * ⭐⭐⭐ **页面一变就读断点** —— 开采前就让人看见「这次是续采还是从头」。
   * ⚠️ 不读的话人只能点下去才知道,而那时配额已经花出去了。
   */
  useEffect(() => {
    const kind = X_USER_LIST_PAGES[identified?.name ?? ''] ?? '';
    const h = identified?.params.handle ?? '';
    if (kind === '' || h === '') { setCursorInfo(null); return; }
    const sc = `${h.trim().replace(/^@+/, '').toLowerCase()}:${kind}`;
    void (async () => {
      const r = await xDataCall({ op: 'readCursor', scope: sc });
      const v = r?.status === 'ok'
        ? (r.value as {
          bottomCursor?: string; exhausted?: boolean; lastRound?: number; totalSeen?: number;
        } | null)
        : null;
      setCursorInfo(v === null ? null : {
        lastRound: v.lastRound,
        totalSeen: v.totalSeen,
        exhausted: v.exhausted === true,
        /** ⭐ 「有断点可续」要同时满足:有游标 且 没到头 */
        has: v.exhausted !== true && typeof v.bottomCursor === 'string' && v.bottomCursor !== '',
      });
    })();
  }, [identified]);
  /**
   * ⭐ 采集中 / 最近一次报告 —— **只有这两个 state**。
   * ⚠️ 原来有 stats / hook / payloads 三份(按腿分),那是实现细节漏到了界面上。
   */
  const [running, setRunning] = useState(false);
  /**
   * ⭐ 采集中登记「X 网页正忙」—— 运营的人页点人会让 X 网页跳到他主页,
   * 采集途中跳走会打断采集(2026-10-08)。
   */
  useEffect(() => {
    if (wcId == null || !running) return;
    setXHostBusy(wcId, '操作台正在采集');
    return () => setXHostBusy(wcId, null);
  }, [wcId, running]);
  /** ⭐ 采够几页就停 —— 用户 2026-10-03:「每次采集 10 页」 */
  const [pagesWanted, setPagesWanted] = useState('10');
  const [report, setReport] = useState<HarvestReport | null>(null);
  /**
   * ⭐⭐ **完整性核对**结果 —— 用户 2026-10-02:
   * 「关键是**核对爬取的数据完整没有**。」
   * ⚠️ 底座只知道「采到几条响应」,**一条推文都没有**时它照样报「采到 72 条」
   * (2026-10-02 实测)。所以必须逐字段量。
   */
  const [audit, setAudit] = useState<ReturnType<typeof summarizeAudits> | null>(null);
  /**
   * ⭐ 收集中的实时进度 —— ⚠️ 不是为了好看:
   * 没有它的话人在第 ② 步只看到一个「● 收集中」,
   * **不知道翻页到底有没有收到东西**,也就不知道什么时候该停。
   */
  const [peek, setPeek] = useState<{ total: number } | null>(null);
  /** ⭐ 核对报告落盘的位置 —— 人和 AI 看同一份 */
  const [auditFile, setAuditFile] = useState<string | null>(null);
  /**
   * ⭐⭐⭐ **补到哪一层** —— 用户 2026-10-03:
   * 「是否需要逐层获取,**根据采集的要求定下来**就可以了。」
   *
   * ⚠️ 默认 `expand-only`:**不离开页面**,最稳也最快。
   * 要 38 篇长文正文才选 `full`(一篇约 9 秒,38 篇约 6 分钟)。
   */
  const [depth, setDepth] = useState<FetchDepth>('expand-only');
  // ── ⭐⭐ 配方(X 的业务,不是底座能力)──
  const [recipes, setRecipes] = useState<SearchRecipe[]>([]);
  const [recipeBusy, setRecipeBusy] = useState(false);
  /** ⚠️ 读写失败要**看得见** —— 静默的话人以为「还没建过配方」 */
  const [recipeErr, setRecipeErr] = useState<string | null>(null);
  /** 正在编辑的那条;null = 没在编辑 */
  const [editing, setEditing] = useState<SearchRecipe | null>(null);

  /** ⭐ 读配方 —— 失败如实报,不回空数组充数 */
  const loadRecipes = useCallback(async () => {
    setRecipeBusy(true);
    setRecipeErr(null);
    try {
      const r = await xDataCall({ op: 'list' });
      if (r.status === 'ok') setRecipes(r.value as SearchRecipe[]);
      else setRecipeErr(r.reason);
    } catch (e) {
      setRecipeErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRecipeBusy(false);
    }
  }, []);

  /** ⚠️ 存完**重新读一遍** —— 不拿本地那份充数(库里可能改了别的字段) */
  const saveRecipe = useCallback(async (r: SearchRecipe) => {
    setRecipeErr(null);
    const res = await xDataCall({ op: 'upsert', recipe: r });
    if (res.status !== 'ok') { setRecipeErr(res.reason); return; }
    setEditing(null);
    await loadRecipes();
  }, [loadRecipes]);

  const removeRecipe = useCallback(async (r: SearchRecipe) => {
    setRecipeErr(null);
    const res = await xDataCall({ op: 'delete', recipeId: r.id });
    if (res.status !== 'ok') { setRecipeErr(res.reason); return; }
    await loadRecipes();
  }, [loadRecipes]);

  /**
   * ⭐⭐ 按配方去搜 —— **只导航,不采集**。
   * ⚠️ 采集仍是「输出」栏那一个按钮的事(用户 2026-10-03:
   * 「我自己选定一个页面,点击开始采集,就采集」)——
   * 配方栏替人把页面选好,不替人决定采不采。
   */
  const runRecipe = useCallback(async (q: { q: string; resultType: string }) => {
    const g = await window.electronAPI!.webDomInvoke({
      op: 'goto',
      pageRef: { wcId: wcId! },
      name: X_PAGE_NAME.search,
      params: { q: q.q, f: q.resultType },
    });
    setLog((l) => [{
      at: new Date().toLocaleTimeString(), label: `按配方搜索`, result: g,
    }, ...l].slice(0, 50));
  }, [wcId]);

  /** ⭐ 长流程的进度 —— 不让人对着一个「采集中」干等 */
  const [step, setStep] = useState('');
  /**
   * ⭐ **整轮**的响应总数(含翻页与补长文)。
   * ⚠️ 不能用 `report.items.length` —— 那只是**第一趟**的
   * (用户 2026-10-04:「怎么才采到 7 条呢?」而报告写着 56 条响应/43 条推文)。
   */
  const [totalResponses, setTotalResponses] = useState(0);
  /**
   * ⭐⭐ 落库结果 —— **inserted / updated 分开显示**。
   * ⚠️ 合成一个「保存了 N 条」的话,「全是重复的」和「全是新的」
   * 长得一模一样 —— 而那正是 `INSERT IGNORE` 当年藏住的东西。
   */
  /**
   * ⭐⭐ 翻页的账 —— 用户 2026-10-05:「翻页够 50 页啦?」
   * ⚠️ 上一跑翻了 47 轮(填 50),**没到上限**却读不出是哪道闸停的 ——
   * 三句停止原因只走进度条,关掉就没。
   */
  /**
   * ⭐⭐ 形状**从 `RunResult` 推**,不在这里重抄一遍。
   * ⚠️ 2026-10-05 栽过:采集层加了 `rounds_detail`,这里的手抄类型没跟上,
   * 于是面板**读不到已经产出来的数据**(tsc 当场报了,但这就是
   * `project-x-field-four-place-registration` 的同一种病:同一个事实写两处)。
   */
  const [paging, setPaging] = useState<RunResult['paging']>(null);
  const [saved, setSaved] = useState<{
    inserted: number; updated: number; failed: unknown[];
  } | null>(null);
  /**
   * ⭐⭐⭐ 人点了「停止」—— 用户 2026-10-04:「怎么点击停止也不停止?」
   *
   * ⚠️ 用 `useRef` 不用 `useState`:编排是在一个 async 函数里跑的,
   * 它闭包捕获的 state **永远是开跑那一刻的值**,改了也看不见。
   */
  const cancelRef = useRef(false);
  /**
   * ⭐⭐ **断点** —— 上次停在哪(2026-10-07)。
   * ⚠️ 开采前要让人看见「这次是续采还是从头采」——
   * 否则「为什么只采到 2400」和「为什么又重采一遍」都说不清。
   */
  const [cursorInfo, setCursorInfo] = useState<{
    lastRound?: number; totalSeen?: number; exhausted: boolean; has: boolean;
  } | null>(null);
  /**
   * ⭐⭐ **人流采集的结果** —— 与推文那套分开存。
   * ⚠️ 不复用 `audit`/`saved`:两者字段不同(人流有 `terminated`、
   * 有 `skippedNoHandle`),挤进一个 state 就要到处 `as`,
   * 而那种地方**改错了不报错**。
   */
  const [userRun, setUserRun] = useState<{
    listSource: string;
    users: number;
    saved: { inserted: number; updated: number; skippedNoHandle: number; skippedNoRestId?: number; failed: unknown[] } | null;
    reason: string;
  } | null>(null);
  /** ⭐⭐ 研判与执行的账:做了 / 这次不做 / 根本补不了 —— 三类分开 */
  const [plan, setPlan] = useState<{
    depth: FetchDepth;
    todo: readonly TweetNeed[];
    skipped: readonly TweetNeed[];
    impossible: readonly TweetNeed[];
    fetched: ReadonlyArray<{ id: string; url: string; ok: boolean; textLen?: number; why?: string }>;
  } | null>(null);

  /** ⭐ 上次「展开全部」的结果 —— 让人看见点开了几条 */
  const [expanded, setExpanded] = useState<{ clicked: number; read: number } | null>(null);
  /**
   * ⭐⭐ DOM 展开后的全文 —— ⚠️ **必须存下来**:
   * 2026-10-02 发现「展开全部」的结果只进了一个显示用的计数,
   * 核对时用的还是载荷里的截断版 —— **那一步白点了**。
   */
  const [domTexts, setDomTexts] = useState<Array<{ id: string; text: string }>>([]);
  /**
   * ⭐⭐ 当前能力 tab。
   *
   * ── 用户 2026-10-02 ──
   * 「X console 中的各种能力是**并排**的，上部分是操作参数，下部分是操作结果。
   * 　如果你把能力垂直布局，就变成一个不断向下滚动的 view，
   * 　**没有体现能力的层级是一致的**了。」
   *
   * ⭐ 关键在最后那句:控制/输入/输出是**平级**的三种能力,
   * 竖排会隐含「从上到下」的次序,而它们之间本来没有次序。
   */
  const [tab, setTab] = useState<CapTab>('control');
  /** ⭐ 切到配方栏时自动读一次 —— 省得人还要先点「刷新」 */
  useEffect(() => {
    if (tab === 'recipe' && recipes.length === 0 && !recipeBusy) void loadRecipes();
  }, [tab, recipes.length, recipeBusy, loadRecipes]);

  /**
   * 滚动轮数上限 —— ⚠️ **可填,不写死**(见下面那个输入框的注释)。
   * ⭐ 默认 30 而不是 5:X 的无限流一屏才几百像素,5 轮看着像没动。
   */
  // ⭐ 用户 2026-10-02:「下次就滚 10 页试试」
  const [scrollRounds, setScrollRounds] = useState('10');

  /**
   * ⭐ 页面名**从真表读**,面板不抄一份。
   * ⚠️ 抄一份就会漂 —— 漂的表现是「面板上有这个名字、点下去说没登记」
   * (旧实现的注释专门记了这条)。
   */
  useEffect(() => {
    void window.electronAPI?.webPageListNames?.().then(setTables).catch(() => {
      // ⚠️ 不静默:取不到页面表时下拉是空的,要让人看见原因
      setLog((l) => [{
        at: new Date().toLocaleTimeString(),
        label: 'listPageNames',
        result: { status: 'error' as const, reason: '取页面表失败 —— 主进程没注册这个通道?' },
      }, ...l]);
    });
  }, []);

  /**
   * ⭐⭐ 对称性:左栏 URL 一变就问底座「这是哪一页」。
   *
   * ⚠️ 识别走**底座的 `identify`**(各业务页面表的反向),
   * 面板**绝不自己 parse x.com 的 URL** ——
   * 自己 parse 就有了第二份规则,而漂的表现是
   * 「自动填的和实际采的不是同一页」(`control-types.ts` 原话)。
   *
   * ⚠️ 这一路**不进留痕**:它每次导航都跑,会把 50 条留痕瞬间刷没,
   * 真正要看的 goto/scroll 返回值就被淹了。失败只落到 `identified`。
   */
  useEffect(() => {
    if (!hostUrl) { setIdentified(null); return; }
    let alive = true;
    void window.electronAPI?.webDomInvoke?.({ op: 'identify', url: hostUrl })
      .then((r) => {
        if (!alive) return;
        // ⚠️ `ok` + `value: null` = 认不出来(正常);非 ok 才是真出错
        if (r.status === 'ok') {
          const v = r.value as { name: string; params: Record<string, string> } | null;
          setIdentified(v ? { url: hostUrl, ...v } : null);
        } else {
          setIdentified(null);
        }
      })
      .catch(() => { if (alive) setIdentified(null); });
    return () => { alive = false; };
  }, [hostUrl]);

  /**
   * ⭐ **不再轮询** —— 2026-10-02 用户:「上层只关注某个具体的目标」。
   *
   * ⚠️ 原来要轮询,是因为面板在**分别**盯两条腿的实时计数;
   * 现在 `acquire` 是**一次调用跑完整件事**并回一份报告,
   * 没有「中途要看的数」了 —— 轮询连同它防的那些坑一起消失。
   * ⭐ 这就是把决策收进底座的直接收益:**上层的复杂度跟着没了**。
   */

  /**
   * ⭐ 收集中轮询进度 —— ⚠️ **只在 running 时轮**,停了就不轮
   * (人点了停而数字还在动,会让人以为没停下来)。
   */
  useEffect(() => {
    if (wcId == null || !running) { setPeek(null); return; }
    const timer = setInterval(() => {
      void window.electronAPI?.webDomInvoke?.({
        op: 'acquirePeek', pageRef: { wcId },
      }).then((r) => {
        if (r.status === 'ok') setPeek(r.value as { total: number });
      }).catch(() => undefined);
    }, 1200);
    return () => clearInterval(timer);
  }, [wcId, running]);

  const call = useCallback(async (label: string, payload: WebDomInvoke) => {
    setBusy(true);
    const at = new Date().toLocaleTimeString();
    try {
      const r = await window.electronAPI!.webDomInvoke(payload);
      // ⭐ 原样存:Result 三态都要看得见,**degraded 不许当成功**
      setLog((l) => [{ at, label, result: r }, ...l].slice(0, 50));
    } catch (e) {
      setLog((l) => [{
        at, label,
        result: { status: 'error' as const, reason: e instanceof Error ? e.message : String(e) },
      }, ...l].slice(0, 50));
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * ⭐ 当前页面要哪些参数 —— **问真表**,不靠面板猜。
   *
   * ⚠️ 旧实现栽过(原文):面板有**四处写死的正则**决定「要不要显示 handle
   * 输入框」,新页面不在里面 → 框不显示 → 参数不传 → resolve 返 null。
   * ⚠️ 2026-10-01 Console 第一版没有这张表,用户点 x.profile 直接 failed
   * 「没传参数」—— **面板没办法知道该填什么**。
   */
  const ownerTable = tables.find((t) => t.names.includes(pageName));
  const requiredParams: string[] = ownerTable?.params[pageName] ?? [];

  /**
   * ⚠️ 必填参数没填满就禁用 —— 免得点下去只拿到一句「解析不出 URL」。
   *
   * ⭐⭐ 但**可选参数不算缺** —— 问真表要哪些可选,面板不写死。
   * ⚠️ 不减掉可选会怎样:`x.search` 的 `f`/`days` 有默认值,
   * 却成了事实上的必填 —— 人不填就点不了 goto,而按钮只说「还缺参数」。
   */
  const optionalParams: string[] = ownerTable?.optional[pageName] ?? [];
  const missing = requiredParams
    .filter((k) => !optionalParams.includes(k))
    .filter((k) => !(paramVals[k] ?? '').trim());

  const disabled = busy || wcId == null;

  return (
    <div style={S.root}>
      <div style={S.title}>𝕏 Console</div>
      <div style={S.hint}>
        ⭐ 调试台:每个按钮**只调一个底座函数**，返回值原样显示。
        {wcId == null && <strong style={{ color: '#d88' }}>　⚠️ 左栏 webview 未就绪</strong>}
      </div>

      {/*
        ⭐⭐ 能力 tab —— 用户 2026-10-02:
        「各种能力是**并排**的…如果垂直布局，就变成一个不断向下滚动的 view，
        　**没有体现能力的层级是一致的**了。」
        ⚠️ 从 `CAP_TABS` 渲染,不在 JSX 里写三个按钮 ——
        　 写死就会在加第四个能力时漏掉(本仓「清单不会自己长」栽过五次)。
      */}
      <div style={S.tabBar}>
        {CAP_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{ ...S.tab, ...(tab === t.id ? S.tabActive : null) }}
          >
            {t.label}
            <span style={S.tabSub}>{t.sub}</span>
            {/* ⭐ 捕获中在**输出 tab 的标签上**也要看得见 —— 人可能正在控制 tab */}
            {/* ⭐ 采集中在**输出 tab 的标签上**也看得见 —— 人可能正在控制 tab */}
            {t.id === 'output' && running && <span style={S.dot}>●</span>}
          </button>
        ))}
      </div>

      {/*
        ⭐⭐ 每个 tab 内:**上半操作参数、下半操作结果**(用户定的形态)。
        ⚠️ 结果区各 tab 自己带 —— 控制的结果是返回值留痕,
        　 输出的结果是载荷列表,两者形状不同,合不到一起。
      */}
      <div style={S.pane}>
        {tab === 'control' && (
          <>
            <div style={S.opArea}>

              {/*
                ⭐⭐ 对称性:左栏在哪一页 —— **建议,不自动覆盖**。
                ⚠️ 为什么留「用它」这一下:自动写会冲掉人正在填的参数,
                　 更贵的那次是 2026-09-07「跟着左边走」把 x.profile 静默改成 x.home
                　 → 爬了首页 1281 条污染入库。见本文件头注释。
              */}
              <div style={S.suggest}>
                {!hostUrl && <span style={{ opacity: 0.5 }}>左栏还没导航。</span>}
                {hostUrl && identified && identified.url === hostUrl && (
                  <>
                    <span>左栏在 </span>
                    <code style={S.code}>{identified.name}</code>
                    {Object.entries(identified.params).map(([k, v]) => (
                      <code key={k} style={S.code}>{`${k}=${v}`}</code>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setPageName(identified.name);
                        // ⭐ 整份替换而非 merge:留着上一页的残参数会**混搭成一个不存在的页**
                        setParamVals(identified.params);
                      }}
                      style={S.btn}
                    >
                      用它
                    </button>
                  </>
                )}
                {hostUrl && !(identified && identified.url === hostUrl) && (
                  /*
                    ⚠️ 「不认识」是**正常答案**(人可能停在设置页/登录页),
                    　 所以用灰字不用报错色 —— 染红会让人去查一个不存在的故障。
                  */
                  <span style={{ opacity: 0.5 }}>
                    这一页没有对应的语义名（{shortUrl(hostUrl)}）
                  </span>
                )}
            </div>

          <div style={S.row}>
            <select
              value={pageName}
              onChange={(e) => setPageName(e.target.value)}
              style={S.input}
            >
              <option value="">（选语义页面）</option>
              {tables.map((t) =>
                t.names.map((n) => (
                  <option key={`${t.owner}:${n}`} value={n}>{`${n}  ·  ${t.owner}`}</option>
                )),
              )}
            </select>
            <button
              type="button"
              disabled={disabled || !pageName || missing.length > 0}
              title={missing.length > 0 ? `还缺参数：${missing.join('、')}` : undefined}
              onClick={() => call(`goto ${pageName}`, {
                op: 'goto', pageRef: { wcId: wcId! }, name: pageName, params: paramVals,
              })}
              style={S.btn}
            >
              goto
            </button>
          </div>
          {/* ⭐ 参数框**按真表渲染** —— 加页面时只改页面表,这里自动跟上 */}
          {requiredParams.map((k) => (
            <div key={k} style={S.row}>
              {/* ⭐ 可选参数标出来 —— 否则人会以为每个框都得填 */}
              <span style={{ width: 70, opacity: 0.8 }}>
                {k}
                {optionalParams.includes(k) && (
                  <span style={{ opacity: 0.5, fontSize: 10 }}>　可选</span>
                )}
              </span>
              <input
                value={paramVals[k] ?? ''}
                onChange={(e) => setParamVals((v) => ({ ...v, [k]: e.target.value }))}
                placeholder={ownerTable?.hints[k] ?? k}
                style={S.input}
              />
            </div>
          ))}
          {pageName && requiredParams.length === 0 && (
            <div style={S.todo}>这个页面不需要参数。</div>
          )}
          <div style={S.row}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => call(`scrollUntil ${scrollRounds} 轮`, {
                op: 'scrollUntil',
                pageRef: { wcId: wcId! },
                stop: { kind: 'atBottom' },
                maxRounds: Number(scrollRounds) || 5,
                /**
                 * ⭐⭐⭐ **每轮滚完自动展开折叠的推文** —— 用户 2026-10-02:
                 * 「应该是**内部的控制机制**,而不是通过一个 button 来点击去做的呀。」
                 *
                 * ⭐ 对的 —— 人读推文时看到「Show more」会自然点开,
                 * 采集也该自己做,不该是人要记得点的一步。
                 * ⚠️ 原来那个「展开全部」按钮已删:它要人记得点、还要记得顺序,
                 * 而且**结果压根没接进采集**(只进了一个显示用的计数)。
                 */
                afterRoundScriptId: X_SCRIPTS.expandAll,
              })}
              style={S.btn}
            >
              scrollUntil
            </button>
            {/*
              ⭐ 轮数**可填** —— 用户 2026-10-02:「x view 没有怎么滚动哦」。
              ⚠️ 真因是这里写死 `maxRounds: 5`:留痕实测**滚了 5 轮 3321px**,
              　 确实滚了,只是在 X 首页看着不明显。
              ⚠️⚠️ 写死的闸门会被当成「滚不动」——
              　 `project-x-followers-2500-ceiling` 整条就是这个教训:
              　 我把**自己设的轮数上限**当成了平台的天花板,
              　 不填参数实采到 2781 人才证否。
            */}
            <input
              value={scrollRounds}
              onChange={(e) => setScrollRounds(e.target.value.replace(/\D/g, ''))}
              style={{ ...S.input, flex: 'none', width: 56 }}
              title="滚动轮数上限"
            />
            <span style={{ fontSize: 10, opacity: 0.5 }}>轮</span>
            {expanded && (
              <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 4 }}>
                展开了 {expanded.clicked} 条（页面上共 {expanded.read} 条）
              </span>
            )}
            {/*
              ⭐⭐ 「停翻页」—— 用户 2026-10-02:
              「停应该包含两个动作 —— 停止翻页/停止取数据吧?」

              ⚠️ 输出 tab 那个「停」会同时停两件事,但它要求 `running`:
              人**只滚不捕**时那个按钮是灰的 —— 翻页就停不下来。
              ⭐ 所以控制 tab 这里要有独立的一个,只管翻页。
              ⚠️ 不看 `busy`:滚动期间 busy 恒为 true,看了就永远点不到。
            */}
            <button
              type="button"
              disabled={wcId == null}
              onClick={() => void window.electronAPI?.webDomInvoke?.({
                op: 'scrollStop', pageRef: { wcId: wcId! },
              })}
              style={S.btn}
              title="立刻停止翻页（下一轮开头生效）"
            >
              停翻页
            </button>
            {/*
              ⭐ 「重载」是**控制**的活 —— 2026-10-02 从采集里拆回来。
              ⚠️ 它解的是时序竞态:两条取数通路要在页面发请求**之前**装好。
              　 正确用法:先去输出栏「开始收」,回来点这个,页面从第一条请求开始发。
            */}
            <button
              type="button"
              disabled={wcId == null}
              onClick={() => void window.electronAPI?.webDomInvoke?.({
                op: 'reload', pageRef: { wcId: wcId! },
              })}
              style={S.btn}
              title="重载页面 —— 先在「输出」那栏点「开始收」，再点这个，才能收到首屏那批请求"
            >
              重载
            </button>
            {/*
              ⭐⭐ 「读现场」—— 探针,2026-10-03 加。

              ⚠️ 它**不采集任何数据**,只回报 URL / 滚动位置 / history 深度 /
              　 首张卡 id。用来回答一个我**推断不出来**的问题:

              　 用户 2026-10-02:「正常的人的浏览会怎么做呢?**点击进去观看,
              　 观看完毕,点击返回上一下,继续往下浏览**。」

              　 长文正文只在单篇页,所以非进去一趟不可。这条路成立的前提是
              　 「后退能恢复现场」(滚动位置 + 已装的两条腿)。
              ⭐ 用法:点一次记下数字 → 手动点进一条推 → 点返回 → 再点一次对比。
              　 `project-x-collect-two-legs`:CDP 通道的行为**只有真机验得出来**。
            */}
            <button
              type="button"
              disabled={disabled}
              onClick={() => call('读现场（探针）', {
                op: 'run', pageRef: { wcId: wcId! }, scriptId: X_SCRIPTS.navProbe,
              })}
              style={S.btn}
              title="只读不改：URL / 滚动位置 / history 深度 / 首张卡 id。进单篇页前后各点一次，对比现场有没有回来"
            >
              读现场
            </button>
          </div>
            </div>
            <div style={S.resultArea}>
              <div style={S.sectionTitle}>
                返回值（原样，最近 50 条）
                {log.length > 0 && (
                  <button type="button" onClick={() => setLog([])} style={S.linkBtn}>清空</button>
                )}
            </div>
          <div style={S.logBox}>
            {log.length === 0 && <div style={S.todo}>还没调用过。</div>}
            {log.map((e, i) => (
              <div key={`${e.at}-${i}`} style={S.logItem}>
                <div style={S.logHead}>
                  <span style={{ ...S.badge, ...badgeStyle(e.result.status) }}>{e.result.status}</span>
                  <span style={{ color: '#aaa' }}>{e.label}</span>
                  <span style={{ color: '#666', marginLeft: 'auto' }}>{e.at}</span>
                </div>
                {/* ⭐ 原样 JSON —— 不挑字段、不美化;挑了就看不出底座到底回了什么 */}
                <pre style={S.pre}>{JSON.stringify(e.result, null, 2)}</pre>
              </div>
            ))}
          </div>
            </div>
          </>
        )}

        {tab === 'input' && (
          <div style={S.opArea}>
            <div style={S.todo}>
              ⏸️ 第 5 步接。⚠️⚠️ <strong>红线：永远不提供「点发布」按钮</strong> —— 只填内容，发布由人点。
          </div>
          </div>
        )}

        {tab === 'output' && (
          <>
            <div style={S.opArea}>
              {/*
                ⭐⭐⭐ **一个按钮** —— 用户 2026-10-03:
                「应该是反过来,**我自己选定一个页面,点击开始采集,就采集**,
                　采集完毕后再验证采集的内容才对。」「每次采集 **10 页**。」

                ⚠️ 此前这里有五个要人点的动作(开始收/重载/滚动/展开/停止),
                　 而且**顺序错了就采不到** —— 那是把编排推给了人。
                ⭐ 现在底座 `harvest` 一次做完:装腿 → 重载(解竞态)→ 滚动
                　 → 每轮展开折叠的推文 → 采够页数就停 → 出报告。
              */}
              <div style={S.row}>
                <button
                  type="button"
                  /** ⚠️ 不看 busy:这**就是**那个长操作 */
                  disabled={wcId == null || running}
                  onClick={async () => {
                    setRunning(true);
                    setReport(null);
                    setAudit(null);
                    setAuditFile(null);
                    setPlan(null);
                    setStep('');
                    setTotalResponses(0);
                    setSaved(null);
                    setPaging(null);
                    cancelRef.current = false;
                    try {
                      /**
                       * ⭐⭐⭐ **一次调用跑完全程** —— 编排在 `x-collect-run`。
                       *
                       * 用户 2026-10-03:「先 tweetid,然后**研判**这个推文是需要
                       * showall 还是需要点击进入 article,最后**根据业务的要求**
                       * 来执行是否要获取全部内容。」
                       *
                       * ⚠️ 此前这 60 行全挤在这个 onClick 里 ——
                       * 写在 onClick 里的东西**测不了**,而「逐篇补 38 篇」
                       * 这种循环恰恰是最该测的。
                       */
                      /**
                       * ⭐⭐ **开跑前抓拍起点** —— 跑完再读就晚了(那时已在长文页)。
                       * ⚠️ `identified` 是 hostUrl 变化时算的,这里直接用它的快照。
                       */
                      const origin = identified === null
                        ? null
                        : { name: identified.name, params: identified.params };

                      /**
                       * ⭐⭐⭐ **开跑前读断点** —— 2026-10-07。
                       *
                       * ⚠️⚠️ `Followers` 端点约 50 次/窗口就 429,而 X 每次都从
                       * **第 1 页**给游标。不续采的话:翻 1-48 轮全是已入库的人
                       * → 第 49 轮又 429 → **一个新人都拿不到**。
                       * ⭐ scope 按 `<账号>:<名单>` 分 —— 混用会让 A 名单的游标
                       * 被 B 续采,而那种错在数据里看不出来。
                       * ⚠️ 读不到就从头采 —— 游标是可重算的派生状态,这不是降级。
                       */
                      const listKind = X_USER_LIST_PAGES[origin?.name ?? ''] ?? '';
                      const handle = origin?.params.handle ?? '';
                      const scope = listKind !== '' && handle !== ''
                        ? `${handle.trim().replace(/^@+/, '').toLowerCase()}:${listKind}`
                        : '';
                      let resumeCursor: string | undefined;
                      if (scope !== '') {
                        const cr = await xDataCall({
                          op: 'readCursor', scope,
                        });
                        const prev = cr.status === 'ok'
                          ? (cr.value as {
                            bottomCursor?: string; exhausted?: boolean;
                            lastRound?: number; totalSeen?: number;
                          } | null)
                          : null;
                        /**
                         * ⚠️ **到头了就不续** —— 带着一个已经到底的游标去续,
                         * 只会立刻又到底、白跑一趟。到头后该从头采拿新增。
                         */
                        if (prev && prev.exhausted !== true && prev.bottomCursor) {
                          resumeCursor = prev.bottomCursor;
                          setStep(`从断点续采：上次停在第 ${prev.lastRound ?? '?'} 页`
                            + `（累计 ${prev.totalSeen ?? '?'} 人）`);
                        }
                      }

                      const run = await runCollect({
                        harvest: async (plan) => {
                          const rr = await window.electronAPI!.webDomInvoke({
                            op: 'harvest', pageRef: { wcId: wcId! }, plan,
                          });
                          setLog((l) => [{
                            at: new Date().toLocaleTimeString(),
                            label: plan.gotoPage ? `取长文 ${plan.gotoPage.params?.articleId ?? ''}` : '采这一页',
                            result: rr,
                          }, ...l].slice(0, 50));
                          if (rr.status !== 'ok' && rr.status !== 'degraded') return null;
                          return (rr as WebDomResult & { value: HarvestReport }).value;
                        },
                        /**
                         * ⭐⭐⭐ **采完回到原来那一页** —— 用户 2026-10-03:
                         * 「点击进去观看,观看完毕,**点击返回上一下**,继续往下浏览。」
                         *
                         * ⚠️⚠️ 我上一版只做了前半句,真机四次跑的后果:
                         * 推文 97 → 40 → 21,每次都报「滚到底 ✓」——
                         * 因为每轮都停在最后一篇长文页,而「采这一页」采的是当前页,
                         * 下一次跑时当前页已经不是主页而是一篇文章。
                         *
                         * ⭐ 走**语义页**回去(不是裸 URL)—— 那道闸不绕;
                         * 起点由开跑前抓拍的 `identified` 定,不是现读
                         * (`project-x-pm-panel-instance-id` 的教训:
                         * 　现读到的已经是长文页了)。
                         */
                        goBack: async () => {
                          if (origin === null) return false;
                          const g = await window.electronAPI!.webDomInvoke({
                            op: 'goto',
                            pageRef: { wcId: wcId! },
                            name: origin.name,
                            params: origin.params,
                          });
                          return g.status === 'ok' || g.status === 'degraded';
                        },
                        /**
                         * ⭐⭐ 翻页脚本 —— **带参数**(URL + 游标是运行时值)。
                         * ⚠️ 只收**预注册的 id**,收不了脚本文本
                         * (`inject-template-escape` 那道闸)。
                         */
                        runScript: async (scriptId, params) => {
                          const rr = await window.electronAPI!.webDomInvoke({
                            op: 'run',
                            pageRef: { wcId: wcId! },
                            scriptId,
                            params: params as Record<string, string>,
                          });
                          if (rr.status !== 'ok' && rr.status !== 'degraded') {
                            throw new Error(`翻页脚本失败：${(rr as { reason?: string }).reason ?? ''}`);
                          }
                          return (rr as { value?: unknown }).value;
                        },
                        /**
                         * ⭐⭐⭐ **还翻不翻,业务说了算** —— 用户 2026-10-04:
                         * 「判断是否停下来是由**业务编排时的研判逻辑**来定,
                         * 　而不是你在采集中定下来。」
                         *
                         * ⭐ 这里的业务判断就是面板上那个「**页**」——
                         * 人填 10 页就翻到 10 页为止。
                         * ⚠️ 采集层只管「X 还给不给」(没游标 / 游标不变),
                         * **它不知道也不该知道「够了没有」**。
                         */
                        stopPaging: (st) => {
                          const want = Number(pagesWanted) || 10;
                          /**
                           * ⭐⭐⭐ **「页」就是翻页轮次** —— 2026-10-06 实测订正回来。
                           *
                           * ⚠️ 我上一版把它换算成人数(`want × 20`),是为了绕开
                           * 「按轮次收手」把人卡在 169 那个 bug ——
                           * 但那个 bug 的真因是**翻页根本没跑起来**(403),
                           * 现在链路通了:每轮一个请求、当场回 50 人、游标每轮在变。
                           * ⭐ 换算反而制造了新的错位:实测**每页 50 人**,
                           * 我按 20 算 → 填 10 页只采 200 人就收手,
                           * 而 X 本来还在给。
                           *
                           * ⭐ 现在「页」= **翻页轮次**,与人的直觉一致:
                           * 填 10 就翻 10 轮 ≈ 500 人;要全量就填大一点。
                           * ⚠️ 真正该停的仍是数据判据(X 说到头 / 游标不变),
                           * 这个数只是**人给的上限**,不是采集的判据。
                           */
                          if (st.round >= want) {
                            return {
                              go: false,
                              why: `已翻够 ${want} 页（${st.uniqueUsers} 人）`,
                            };
                          }
                          /**
                           * ⚠️⚠️ **连续空轮不是停止理由** —— 这条刹车害过两次:
                           * ① `project-x-cursor-paging` 实测:3 页刹车把 2604 账号
                           * 　 **卡死在 2244**、三跑同数,而 X 一直说 hasMore=true。
                           * ② 2026-10-05 真机:`emptyRounds >= 15` 把
                           * 　 verified_followers 停在 **60 人**,还报「没有新**推文**」——
                           * 　 一个连推文都没有的页面。
                           *
                           * ⭐ 滚动已经采过的人让翻页头几页**天然零新增**,
                           * 这个数在业务侧设多少都是猜。真正该停的是数据判据
                           * (没游标 / 游标不变 / X 说到头),采集层已经在管。
                           * ⚠️ 要防「X 原地打转」的话,判据该是**游标不变**(采集层有),
                           * 不是「几轮没新的」—— 后者把「X 还有但头几页重复」
                           * 和「X 真的没了」混成一件事。
                           */
                          return { go: true };
                        },
                        cancelled: () => cancelRef.current,
                        onProgress: setStep,
                        /**
                         * ⭐⭐ **被限流时的等待** —— 2026-10-06。
                         * ⚠️ 等待期间**每秒看一次有没有人点停止** ——
                         * 退避可能几分钟,干等着不响应停止键最招人烦。
                         */
                        wait: async (ms) => {
                          const until = Date.now() + ms;
                          while (Date.now() < until) {
                            if (cancelRef.current) return;
                            await new Promise((r) => setTimeout(r, 1000));
                          }
                        },
                      }, {
                        // ⭐ 用户 2026-10-03:「每次采集 10 页」
                        wantPages: Number(pagesWanted) || 10,
                        /** ⭐⭐ 补到哪一层 —— **采集要求说了算**,不是代码定 */
                        depth,
                        /** ⭐ 有断点就从断点翻 —— 配额才花在新数据上 */
                        resumeCursor,
                      });

                      /**
                       * ⭐⭐⭐ **被限流要第一时间喊** —— 2026-10-06。
                       * ⚠️⚠️ 限流下的「滚到底」是假的,而我对着滚动逻辑改了七八轮。
                       * ⭐ 放在最前面、用红字:它决定的是「现在该停手等一等」,
                       * 不是「哪个字段没解出来」。
                       */
                      if (run.rateLimit) setStep(run.rateLimit);
                      if (run.harvest) setReport(run.harvest as HarvestReport);
                      setTotalResponses(run.totalResponses);
                      setPaging(run.paging);
                      setAudit(run.summary);
                      setPlan(run.plan === null ? null : { ...run.plan, fetched: run.fetched });

                      /**
                       * ⭐⭐⭐ **采完就存** —— 2026-10-05 接上。
                       *
                       * ⚠️⚠️ 在这之前,采到的数据**跑完就蒸发**:长文正文 23446 字、
                       * 主动翻页、研判分层 —— 修了一串,库里一个字都没留下。
                       *
                       * ⚠️ 存的是 `record`(解析器产出的**完整记录**),
                       * 不是面板那份核对结果(preview 只 80 字、媒体只有 type)。
                       * ⭐ 【空】这一维由这里补 —— 解析器不知道自己在哪采的。
                       */
                      const records = (run.summary?.items ?? [])
                        .map((t) => t.record)
                        .filter((r) => r.id !== '');
                      if (records.length > 0) {
                        const sv = await xDataCall({
                          op: 'saveTweets',
                          records,
                          ctx: {
                            /**
                             * ⭐ 【空】从哪采的 —— 解析器不知道,由这里补。
                             * ⚠️ `origin` 是开跑前抓拍的识别结果;
                             * 认不出来就**如实留空**,别编一个 'x.unknown' 出来
                             * (守卫「面板不许写死语义页名」当场逮到了那次编造)。
                             */
                            source: origin?.name ?? identified?.name ?? '',
                            searchRecipe: origin?.params.q,
                          },
                        });
                        setLog((l) => [{
                          at: new Date().toLocaleTimeString(), label: '落库', result: sv,
                        }, ...l].slice(0, 50));
                        /**
                         * ⭐⭐ 存的结果**要显示出来** —— 不显示的话
                         * 「存进去了」和「静默失败了」长得一模一样
                         * (`project-x-upsert-insert-ignore` 就是这么藏了两个月)。
                         */
                        setSaved(sv.status === 'ok'
                          ? (sv.value as { inserted: number; updated: number; failed: unknown[] })
                          : null);
                        if (sv.status !== 'ok') {
                          setStep(`落库失败：${(sv as { reason?: string }).reason ?? ''}`);
                        } else {
                          /**
                           * ⭐⭐⭐ **一条都没存进去 = 失败**,别让它看着像成功。
                           *
                           * ⚠️⚠️ 2026-10-05 连栽两跑:面板报「新入库 44 条」而库里 0 行。
                           * 那次 `status` 是 ok(IPC 没出错)、数字也不是 0 ——
                           * 因为 repo 在 `await db.query` 之后就 `inserted += 1`,
                           * 而那条语句**不报错也不写**。
                           * ⭐ 现在以「失败条数」为准:有失败就直说,别只报好消息。
                           */
                          const v = sv.value as { inserted: number; updated: number; failed: Array<{ why: string }> };
                          if (v.failed.length > 0) {
                            setStep(`⚠️ ${v.failed.length} 条没入库：${v.failed[0]?.why ?? ''}`);
                          } else if (v.inserted + v.updated === 0 && records.length > 0) {
                            setStep(`⚠️ ${records.length} 条推文一条都没入库 —— 看返回值`);
                          }
                        }
                      }

                      /**
                       * ⭐⭐⭐ **同一次采集解出来的 X 用户也存** —— 2026-10-05。
                       *
                       * 用户订正(原话):「不管采什么,都是采集页面的内容,
                       * 而不应该增加一个采人的名单…**输出要自行判断**。」
                       * ⚠️⚠️ 原先我为此加了第二个按钮,让**人**告诉采集器这页是什么。
                       * 可端点名里就写着 `Followers` —— 信息本来就在数据里,
                       * 我却造了第二个真源,还把「保持两边一致」变成人的活。
                       * ⭐ 现在:`run.kind` 由数据算,有人就存人,不问。
                       */
                      const users = run.users.flatMap((a) => a.items);
                      if (users.length > 0) {
                        /**
                         * ⭐⭐ `listSource` 从**识别出的页面**来(它会进
                         * `list_memberships`,累加不覆盖,必须是稳定的词)。
                         * ⚠️ 认不出来就**如实留空**,由 IPC 侧拒收 ——
                         * 绝不默认成 'followers':猜错了会在**每个人的档案**里
                         * 永久留一条错记录,而「他在不在我的关注者里」从此答错
                         * 且看不出来。这是少数「宁可不存也不兜底」的地方。
                         */
                        const listSource = X_USER_LIST_PAGES[origin?.name ?? identified?.name ?? ''] ?? '';
                        const su = await xDataCall({
                          op: 'saveUsers', records: users, ctx: { listSource },
                        });
                        setLog((l) => [{
                          at: new Date().toLocaleTimeString(), label: '落库（人）', result: su,
                        }, ...l].slice(0, 50));
                        setUserRun({
                          users: users.length,
                          listSource: listSource || '(认不出是哪个名单)',
                          saved: su.status === 'ok'
                            ? (su.value as {
                              inserted: number; updated: number;
                              skippedNoHandle: number; skippedNoRestId?: number; failed: unknown[];
                            })
                            : null,
                          reason: su.status === 'ok' ? '' : (su as { reason?: string }).reason ?? '',
                        });
                        /** ⭐⭐ 一个都没存进去 = 失败,别让它看着像成功 */
                        if (su.status !== 'ok') {
                          setStep(`人落库失败：${(su as { reason?: string }).reason ?? ''}`);
                        } else {
                          const u = su.value as {
                            inserted: number; updated: number; failed: Array<{ why: string }>;
                          };
                          if (u.failed.length > 0) {
                            setStep(`⚠️ ${u.failed.length} 人没入库：${u.failed[0]?.why ?? ''}`);
                          } else if (u.inserted + u.updated === 0) {
                            setStep(`⚠️ ${users.length} 人一条都没入库 —— 看返回值`);
                          }
                        }
                      }

                      /**
                       * ⭐⭐⭐ **采到人时,把原始载荷落一份** —— 2026-10-05。
                       *
                       * 用户:「人有哪些数据?**要先观察清楚**,不要数据都采不齐呢。」
                       * ⚠️⚠️ 库里实测:bio 159/171 有,而**粉丝数/关注数/地点/注册时间
                       * 全是 0/171** —— 四个字段整列空。解析器读的是 `legacy.*`,
                       * 而 handle/name/bio/avatar 之所以有,是因为它们**另有一条
                       * 新结构的路**(core./profile_bio./avatar.)。
                       * ⭐ 所以多半是 X 把这些字段挪走了,**但我不该猜** ——
                       * 落一份原始载荷下来,照着真结构改。
                       * (`feedback-dont-guess-look-at-real-data`:
                       * 　别靠读代码脑补,拿真实数据定根因。)
                       *
                       * ⚠️ 只落**第一条**用户载荷:够看结构了,不占地方。
                       */
                      /**
                       * ⭐⭐⭐ **跑完存断点** —— 2026-10-07。
                       *
                       * ⚠️⚠️ **无论怎么停的都要存**:被 429 挡下那次正是最需要它的
                       * (不存的话下次从第 1 页开始,50 次配额全浪费在重采上)。
                       * ⭐ X 说到头了也要存(`exhausted=true`)——
                       * 下次就知道该从头采拿新增,而不是拿个到底的游标去续。
                       */
                      if (scope !== '') {
                        const cu = await xDataCall({
                          op: 'saveCursor',
                          cursor: {
                            scope,
                            bottomCursor: run.nextCursor,
                            exhausted: run.exhausted === true,
                            lastRound: run.paging?.rounds,
                            lastReason: run.paging?.stopReason,
                            totalSeen: run.users.reduce((n, a) => n + a.items.length, 0),
                          },
                        });
                        setLog((l) => [{
                          at: new Date().toLocaleTimeString(), label: '存断点', result: cu,
                        }, ...l].slice(0, 50));
                      }

                      /**
                       * ⭐⭐⭐ **每一跑都落一份账** —— 2026-10-06,用户:
                       * 「这两个你没有办法自行读取吗?」
                       *
                       * ⚠️⚠️ 不能:滚动停因与每轮游标**只渲染在面板上**,关掉就没,
                       * 于是每次核对我都得回头要截图。这正是
                       * `feedback-maintainability-over-feature-completion` 的原病
                       * ——用户当时点破的是「**你不记录如何做验证**」。
                       * ⚠️ 我上一轮只落了原始载荷(解决「字段在哪」),
                       * 却没落**结论性的那几行**(解决「为什么停在 200 人」)。
                       *
                       * ⭐ 无条件写:**成功路径也要留痕**,不只失败时写。
                       */
                      {
                        const text = buildRunReport({
                          run,
                          page: origin?.name ?? identified?.name ?? '',
                          wantPages: Number(pagesWanted) || 10,
                          at: new Date().toISOString(),
                        });
                        const rr = await window.electronAPI!.webDomInvoke({
                          op: 'writeAudit', pageRef: { wcId: wcId! }, text, name: 'x-run',
                        });
                        if (rr.status === 'ok') {
                          setAuditFile((rr.value as { file: string }).file);
                        }
                      }

                      if (run.users.length > 0 && run.harvest) {
                        const raw = run.harvest.items.find((it) => /Followers|Following/.test(it.url));
                        if (raw) {
                          const rw = await window.electronAPI!.webDomInvoke({
                            op: 'writeAudit',
                            pageRef: { wcId: wcId! },
                            text: `URL: ${raw.url}\n\n${raw.text}`,
                            name: 'x-user-payload',
                          });
                          if (rw.status === 'ok') {
                            setStep(`原始载荷已落盘：${(rw.value as { file: string }).file}`);
                          }
                        }
                      }

                      if (run.audits.length > 0) {
                        const text = exportAuditText(run.audits, {
                          pages: run.audits.length,
                          /** ⭐ **整轮**的(含逐篇长文页)——不是只有第一趟 */
                          totalResponses: run.totalResponses,
                          rounds: run.harvest?.rounds,
                          scrolledPx: run.harvest?.scrolledPx,
                          /** ⭐ 「到上限停」与「滚到底停」要分得开 */
                          reachedBottom: run.harvest?.reachedBottom,
                          stopReason: run.harvest?.stopReason,
                        });
                        const w = await window.electronAPI!.webDomInvoke({
                          op: 'writeAudit', pageRef: { wcId: wcId! }, text, name: 'x-harvest',
                        });
                        if (w.status === 'ok') setAuditFile((w.value as { file: string }).file);
                      }
                    } finally {
                      setRunning(false);
                    }
                  }}
                  style={S.btn}
                  title="装腿 → 重载 → 滚动（每轮自动展开折叠的推文）→ 采够页数就停 → 核对"
                >
                  {running ? '采集中…' : '采这一页'}
                </button>
                {/*
                  ⭐⭐⭐ **开采前先说清楚「这是哪个名单」** —— 2026-10-07。
                  ⚠️⚠️ 用户连着三次采到了同一个名单(following),
                  而他要的是 followers。他说「粗心大意了」——
                  ⭐ 但三次都点错说明**界面没把这件事说清楚**,不是人该更小心:
                  · X 的三个标签页(Verified Followers / Followers / Following)
                    文字相近、挨在一起
                  · **采完后 X 会自己跳回 Following** —— 最容易再点错的时刻
                  · 面板原来只在结果区事后显示名单名,开采前看不到
                  ⚠️ 代价很实:每次白跑 6-7 分钟,还白耗一次限流额度。
                  ⭐ 所以放在**按钮右边**(点之前视线必经之处),不是结果区。
                */}
                {X_USER_LIST_PAGES[identified?.name ?? ''] !== undefined && (
                  <span
                    style={{
                      fontSize: 11,
                      padding: '2px 6px',
                      borderRadius: 3,
                      background: '#2a3a2a',
                      color: '#9c9',
                      whiteSpace: 'nowrap',
                    }}
                    title="当前页面是哪个名单 —— X 的三个标签页很像，采之前扫一眼"
                  >
                    名单：{X_USER_LIST_PAGES[identified?.name ?? '']}
                  </span>
                )}
                {/*
                  ⭐⭐⭐ **断点状态** —— 2026-10-07。
                  ⚠️ `Followers` 端点约 50 次/窗口就 429,5729 人要分 2-3 跑。
                  不显示的话,「为什么只采到 2400」和「这次会不会又重采一遍」
                  人都看不出来。⭐ 放按钮旁 —— 点之前就该知道。
                */}
                {cursorInfo !== null && (
                  <>
                    <span
                      style={{
                        fontSize: 11, padding: '2px 6px', borderRadius: 3,
                        background: cursorInfo.has ? '#2a3348' : '#333',
                        color: cursorInfo.has ? '#9bf' : '#999',
                        whiteSpace: 'nowrap',
                      }}
                      title={cursorInfo.exhausted
                        ? '上次 X 说名单到头了 —— 这次会从头采（拿新增）'
                        : '上次没采完，这次从断点接着翻（配额才花在新数据上）'}
                    >
                      {cursorInfo.exhausted
                        ? `✓ 上次采到底（${cursorInfo.totalSeen ?? '?'} 人）`
                        : cursorInfo.has
                          ? `续采：上次第 ${cursorInfo.lastRound ?? '?'} 页（${cursorInfo.totalSeen ?? '?'} 人）`
                          : '从头采'}
                    </span>
                    {cursorInfo.has && (
                      <button
                        type="button"
                        disabled={running}
                        onClick={async () => {
                          const kind = X_USER_LIST_PAGES[identified?.name ?? ''] ?? '';
                          const h = identified?.params.handle ?? '';
                          if (kind === '' || h === '') return;
                          const sc = `${h.trim().replace(/^@+/, '').toLowerCase()}:${kind}`;
                          await xDataCall({ op: 'clearCursor', scope: sc });
                          setCursorInfo(null);
                          setStep('断点已清 —— 下次从头采');
                        }}
                        style={{ ...S.btn, fontSize: 10, padding: '2px 6px' }}
                        title="丢掉断点，下次从第 1 页开始。⚠️ 删的是派生状态，已采到的人一个不少"
                      >
                        从头采
                      </button>
                    )}
                  </>
                )}
                <input
                  value={pagesWanted}
                  onChange={(e) => setPagesWanted(e.target.value.replace(/\D/g, ''))}
                  style={{ ...S.input, flex: 'none', width: 46 }}
                  title="翻几页就停 —— 人流名单实测每页约 50 人（10 页≈500 人）。想采全就填大一点，真正该停的是「X 说到头了」"
                />
                <span style={{ fontSize: 10, opacity: 0.5 }}>
                  页
                  {/*
                    ⭐ 把**每页多少人**直接写在旁边 —— 2026-10-06 真机实测 50。
                    ⚠️ 不写的话「10 页」是多少人全靠猜:我自己就按 20 猜过,
                    结果填 10 页只采 200 人就收手,而 X 还在给。
                  */}
                  <span style={{ opacity: 0.6 }}>（约 {(Number(pagesWanted) || 10) * 50} 人）</span>
                </span>
                {/*
                  ⭐⭐⭐ **补到哪一层** —— 用户 2026-10-03:
                  「是否需要逐层获取,**根据采集的要求定下来**就可以了。」
                  ⚠️ 不是代码决定「缺就补」—— 有的采集只要互动数,
                  　 为此进 38 篇详情页纯属浪费。
                */}
                <select
                  value={depth}
                  onChange={(e) => setDepth(e.target.value as FetchDepth)}
                  disabled={running}
                  style={{ ...S.input, flex: 'none', width: 128 }}
                  title="补到哪一层：as-is 一个不补 / 只展开 不离开页面 / 全部 含逐篇进长文页"
                >
                  <option value="as-is">只采，不补</option>
                  <option value="expand-only">展开折叠（不离页）</option>
                  <option value="full">全部（含长文正文）</option>
                </select>
                <button
                  type="button"
                  /** ⭐ 停是取消动作,必须在忙的时候可用 */
                  disabled={wcId == null || !running}
                  onClick={() => {
                    /**
                     * ⭐⭐⭐ **两件事都要做** —— 用户 2026-10-04:
                     * 「停止按钮不起作用的,怎么点击停止也不停止?」
                     *
                     * ⚠️⚠️ 原先只发 `scrollStop`,那**只能停滚动**。
                     * 而一跑有三段,后两段是编排自己的循环:
                     * 　① 首轮 harvest(滚动)② 主动翻页 ③ 逐篇补长文
                     * 人点停止时多半正在 ②③ —— 所以「点了没反应」。
                     */
                    cancelRef.current = true;
                    setStep('正在停止…');
                    void window.electronAPI?.webDomInvoke?.({
                      op: 'scrollStop', pageRef: { wcId: wcId! },
                    });
                  }}
                  style={S.btn}
                  title="停止采集 —— 滚动、翻页、补长文都会停，已采到的留着"
                >
                  停止
                </button>
              </div>

              {/*
                ⭐⭐⭐ **人的账** —— 用户「这就是我们要检阅的结果」。
                ⚠️ 翻页/停因在上面那块「翻页」里(同一次采集只有一套),
                这里只答「解出几个人、存进去几个」。
                ⚠️⚠️ 「采到了」和「存进去了」**必须是两个数** ——
                合成一个就是「面板报 44、库里 0 行」那家族的起点。
              */}
              {userRun !== null && (
                <div style={S.diagnose}>
                  <strong>人（{userRun.listSource}）</strong>
                  <div style={{ marginTop: 3 }}>
                    解出 <strong>{userRun.users}</strong> 人
                    {userRun.saved !== null && (
                      <>
                        　·　入库 新 <strong>{userRun.saved.inserted}</strong>
                        　·　更新 <strong>{userRun.saved.updated}</strong>
                        {userRun.saved.skippedNoHandle > 0 && (
                          <>　·　<span style={{ opacity: 0.8 }}>
                            无 handle 挡下 {userRun.saved.skippedNoHandle}
                          </span></>
                        )}
                        {(userRun.saved.skippedNoRestId ?? 0) > 0 && (
                          <>　·　<span style={{ opacity: 0.8 }}>
                            无数字 id 挡下 {userRun.saved.skippedNoRestId}
                          </span></>
                        )}
                        {userRun.saved.failed.length > 0 && (
                          <>　·　<span style={{ color: '#f66' }}>
                            ⚠️ 失败 {userRun.saved.failed.length}
                          </span></>
                        )}
                      </>
                    )}
                  </div>
                  {/*
                    ⭐⭐ 没存进去要**说为什么** —— 最常见就是认不出页面、
                    listSource 为空被 IPC 拒收(那是故意的:宁可不存也不猜,
                    猜错了会在每个人的档案里永久留一条错记录)。
                  */}
                  {userRun.saved === null && userRun.reason !== '' && (
                    <div style={{ marginTop: 3, color: '#f66' }}>
                      ⚠️ 没入库：{userRun.reason}
                    </div>
                  )}
                </div>
              )}

              {/*
                ⭐⭐⭐ **研判与执行的账** —— 三类分开,不许混(2026-10-03)。

                ⚠️⚠️ 「这次不补」**不等于**「不缺」,「补不了」又是第三件事。
                混起来报告就会显得「全都齐了」——
                `project-x-article-body-lost`:**不量的字段永远 100%**。
              */}
              {plan !== null && (
                <div style={S.diagnose}>
                  <strong>研判（深度：{
                    plan.depth === 'as-is' ? '只采，不补'
                      : plan.depth === 'expand-only' ? '展开折叠（不离页）' : '全部'
                  }）</strong>
                  <div style={{ marginTop: 3 }}>
                    本次执行 <strong>{plan.todo.length}</strong> 条
                    {plan.skipped.length > 0 && (
                      <>　·　<span style={{ opacity: 0.8 }}>
                        缺但本次不补 <strong>{plan.skipped.length}</strong> 条
                      </span></>
                    )}
                    {plan.impossible.length > 0 && (
                      <>　·　<span style={{ opacity: 0.8 }}>
                        ⚠️ 补不了 <strong>{plan.impossible.length}</strong> 条
                      </span></>
                    )}
                  </div>
                  {/* ⭐ 逐篇结果:成/败都列,失败要说清为什么 */}
                  {plan.fetched.length > 0 && (
                    <div style={{ marginTop: 4 }}>
                      取回长文正文 {plan.fetched.filter((f) => f.ok).length}/{plan.fetched.length}：
                      {plan.fetched.filter((f) => !f.ok).map((f, i) => (
                        <div key={i} style={{ opacity: 0.75 }}>
                          ⚠️ {f.id} 没取到 —— {f.why ?? '未说明'}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* ⚠️ 补不了的要列出来,别只报个数 */}
                  {plan.impossible.map((n, i) => (
                    <div key={i} style={{ opacity: 0.7, marginTop: 2 }}>
                      ⚠️ {n.id}：{n.why}
                    </div>
                  ))}
                </div>
              )}
              {!running && !report && (
                <div style={S.todo}>
                  ① 去「控制」那栏选好页面（或左栏自己导航到想采的页）<br />
                  ② 回来点「采这一页」—— 重载、滚动、展开折叠的推文、
                  采够页数就停，<strong>全自动</strong><br />
                  ③ 采完直接出完整性核对 + 逐条明细
                </div>
              )}
              {running && (
                <div style={S.diagnose}>
                  {/* ⭐ 有具体进度就显示具体的 —— 「取长文 7/38」比「采集中」有用得多 */}
                  {step !== '' ? <><strong>{step}</strong><br /></> : null}
                  采集中…（重载 → 滚动 → 每轮展开折叠的推文 → 采够 {pagesWanted} 页就停）
                  <br />
                  <span style={{ opacity: 0.75 }}>想提前结束就点「停止」。</span>
                </div>
              )}
            </div>


            <div style={S.resultArea}>
              {report && (
                <>
                  {/* ⭐ 一行说清结果,不堆指标 */}
                  {/*
                    ⭐⭐⭐ **报「推文」不报「响应」** —— 用户 2026-10-04:
                    「怎么才采到 7 条呢?」

                    ⚠️⚠️ 那个 7 是**第一趟 harvest 的响应条数**,而同一跑
                    报告里写着「56 条响应 / **43 条推文**」—— 三个数字说同一件事,
                    而面板挑了最没用的那个,标签还写着「合并去重后的总条数」
                    (**既没合并也没去重**,更不含翻页那几趟)。
                    ⭐ 人要知道的是「采到几条推文」,响应数是排查用的,放后面。
                  */}
                  <div style={S.statRow}>
                    <Stat
                      label="推文"
                      v={audit?.uniqueTweets ?? 0}
                      tone={(audit?.uniqueTweets ?? 0) > 0 ? 'good' : 'idle'}
                      hint="去重后的推文条数（含主动翻页采到的）"
                    />
                    <Stat
                      /**
                       * ⭐⭐ 叫「载荷」不叫「页」—— 用户 2026-10-05:
                       * 「从观察的数字看,好像有点问题吧?」
                       *
                       * ⚠️⚠️ 它量的是**时间线载荷条数**(首轮滚动 + 翻页都算),
                       * 而旁边那行写着「翻页 28 轮」—— 两个口径并排摆着、
                       * 标签都像在说「翻了多少」,于是 32 vs 28 看起来自相矛盾。
                       * ⭐ 数字本身是对的(实测逐个对过),**错的是名字**。
                       */
                      label="载荷"
                      v={audit?.pages ?? 0}
                      tone="idle"
                      hint="时间线载荷条数（首轮滚动 + 翻页都算）—— 与下面的「翻页 N 轮」不是一个口径"
                    />
                    {/*
                      ⭐⭐⭐ **入库了几条** —— 2026-10-05。
                      ⚠️ `inserted` 与 `updated` **分开报**:合成一个数的话
                      「全是重复的」和「全是新的」长得一模一样 ——
                      那正是 `INSERT IGNORE` 当年藏了两个月的东西。
                    */}
                    {saved !== null && (
                      <>
                        <Stat
                          label="新入库"
                          v={saved.inserted}
                          tone={saved.inserted > 0 ? 'good' : 'idle'}
                          hint="第一次见到的推文"
                        />
                        <Stat
                          label="已更新"
                          v={saved.updated}
                          tone="idle"
                          hint="库里已有、这次把采集字段刷新了（人工/AI 填的不动）"
                        />
                        {saved.failed.length > 0 && (
                          <Stat
                            label="入库失败"
                            v={saved.failed.length}
                            tone="bad"
                            hint="⚠️ 这几条没存进去 —— 展开「返回值」看原因"
                          />
                        )}
                      </>
                    )}
                    <Stat
                      label="响应"
                      v={totalResponses}
                      tone="idle"
                      hint="整轮收到的响应总数（含翻页与补长文）—— 排查用"
                    />
                    {/* ⚠️ 轮次/像素是**控制**那栏的报告,采集不重复记一份 */}
                  </div>
                  {/*
                    ⭐⭐ 翻页为什么停 —— 用户 2026-10-05 问「翻够 50 页啦?」
                    ⚠️ 光报轮数不够:47 轮(填 50)是**哪道闸**停的,
                    不写出来就只能去留痕里翻。
                  */}
                  {paging !== null && (
                    <div style={S.todo}>
                      翻页 {paging.rounds} 轮 · 新采到 {paging.freshTotal} 条
                      <br />
                      停因：{paging.stopReason}
                      {/*
                        ⭐⭐⭐ **每轮发的游标摊开** —— 2026-10-05 补。
                        ⚠️⚠️ 真机翻 16 轮只多 20 人,而「游标没变」(我的 bug)和
                        「游标变了 X 还回同一批」(请求形状的问题)是**两个毛病**,
                        光看总数分不出来 —— 我只能猜,而判据就在这几行里。
                        ⭐ 只在**零新增**的轮次标出来,正常轮次不占屏幕。
                      */}
                      {paging.rounds_detail.length > 0 && (
                        <details style={{ marginTop: 3 }}>
                          <summary style={{ cursor: 'pointer', opacity: 0.75 }}>
                            每轮的游标（{paging.rounds_detail.filter((d) => d.fresh === 0).length} 轮零新增）
                          </summary>
                          <div style={{ marginTop: 3, fontFamily: 'monospace', fontSize: 10 }}>
                            {paging.rounds_detail.map((d) => (
                              <div key={d.round} style={{ opacity: d.fresh === 0 ? 0.6 : 1 }}>
                                {String(d.round).padStart(3)} · 新 {String(d.fresh).padStart(3)}
                                {' · 响应 '}{String(d.responses).padStart(2)}
                                {' · '}{d.cursor}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                  {/*
                    ⭐⭐⭐ **滚动的停因**(与上面「翻页的停因」是两件事)。
                    ⚠️⚠️ 2026-10-05:这两个停因并排摆着,我却**只读了翻页那个**,
                    于是「滚动到了轮次上限」整整漏了两跑 ——
                    following 卡在 150 人,而屏幕上一直写着「达到轮次上限 60」。
                    ⭐ 加上标签,并在**撞上限**时标红:
                    「滚到底了」和「我数到上限了」是完全不同的结论。
                  */}
                  <div style={S.todo}>
                    滚动：{report.stopReason}
                    {report.elapsedMs > 0 && `　·　${(report.elapsedMs / 1000).toFixed(1)}s`}
                    {report.stopReason?.includes('轮次上限') && (
                      <div style={{ color: '#f90', marginTop: 2 }}>
                        ⚠️ 是**撞到轮次上限**停的,不是滚到底 ——
                        名单多半还有,这个数不是全部
                      </div>
                    )}
                  </div>

                  {/*
                    ⭐⭐⭐ **完整性核对** —— 用户 2026-10-02:
                    「关键是**核对爬取的数据完整没有**。」
                    ⚠️ 上面那行「采到 N 条」说的是**响应条数**;
                    　 2026-10-02 实测 72 条响应里**一条推文都没有**。
                    　 所以真正要看的是下面这些。
                  */}
                  {audit && (
                    <div style={S.auditBox}>
                      <div style={{ color: 'var(--text-primary, #ddd)', marginBottom: 4 }}>
                        {auditFile && (
                          <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 4 }}>
                            ⭐ 完整报告已写入（可逐条核对）：
                            <span style={{ userSelect: 'all', color: '#9ac' }}>{auditFile}</span>
                          </div>
                        )}
                        完整性核对：{audit.pages} 页 ·
                        {' '}{audit.uniqueTweets} 条推文
                        {audit.tweets !== audit.uniqueTweets
                          && `（原始 ${audit.tweets} 条，去重后 ${audit.uniqueTweets}）`}
                      </div>
                      {/*
                        ⭐⭐ **分组显示** —— 字段清单从 8 项扩到 22 项(照搬旧实现
                        实际取过的),挤一行就看不了了。
                        ⭐ 三组的含义**完全不同**:
                        ① 缺了是真丢数据 ② 缺了影响筛选 ③ 是种类不是缺失
                      */}
                      {([
                        ['① 正文与身份（缺＝真丢数据）',
                          ['正文', '作者', '作者id', '显示名', '头像']],
                        ['② 元数据（缺＝影响筛选／排序）',
                          ['发布时间', '语言', '互动数', '会话id', '推文链接',
                            '蓝V', '关系', '作者bio', '我的操作']],
                        ['③ 种类分布（不是缺失）',
                          ['长推', '长文', '有媒体', '是回复']],
                      ] as const).map(([title, keys]) => (
                        <div key={title} style={{ marginTop: 4 }}>
                          <div style={{ fontSize: 10, opacity: 0.55, marginBottom: 2 }}>{title}</div>
                          <div style={S.statRow}>
                            {keys.filter((k) => audit.coverage[k] !== undefined).map((k) => {
                              const v = audit.coverage[k];
                              /**
                               * ⚠️ 第③组是**分布**不是缺失 —— 不许用红/黄配色,
                               * 　 否则「长文 0%」会被当成故障(其实只是这批没长文)。
                               */
                              const isDist = title.startsWith('③');
                              return (
                                <div key={k} style={S.stat} title={`${k}：${v}%`}>
                                  <div style={{
                                    fontSize: 15,
                                    lineHeight: 1.2,
                                    color: isDist ? '#9ac'
                                      // ⚠️ 100% 才算满 —— 95% 也意味着有东西丢了
                                      : v === 100 ? '#8fd9a8' : v > 0 ? '#d9c48f' : '#777',
                                  }}>
                                    {v}%
                                  </div>
                                  <div style={{ fontSize: 10, opacity: 0.7 }}>{k}</div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      {audit.problems.length > 0 && (
                        <div style={{ ...S.failLine, marginTop: 4 }}>
                          {[...new Set(audit.problems)].map((x) => <div key={x}>⚠️ {x}</div>)}
                        </div>
                      )}

                      {/*
                        ⭐⭐⭐ **逐条明细** —— 用户 2026-10-02:
                        「对于推文中的**数据是否完整**没有显示哦。」
                        ⚠️ 只给百分比的话,人不知道**哪几条**不完整、缺的是什么,
                        　 也不知道采到的到底是什么内容。
                      */}
                      {audit.incomplete.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          <div style={{ color: '#d9c48f', marginBottom: 3 }}>
                            ⚠️ 有缺失的 {audit.incomplete.length} 条：
                          </div>
                          {audit.incomplete.slice(0, 8).map((x) => (
                            <div key={x.audit.id} style={S.tweetLine}>
                              <span style={{ color: '#d98f8f' }}>缺 {x.missing.join('／')}</span>
                              <span style={{ opacity: 0.55 }}>　@{x.audit.handle || '?'}</span>
                              <span style={{ opacity: 0.8 }}>　{x.audit.preview || '（无正文）'}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/*
                        ⭐⭐⭐ **逐条全字段** —— 用户 2026-10-02:
                        「截图中应该是显示每条推文的相关数据,**我好左右比较对对不对**呀?」
                        「你修的还是这样呢,**我怎么无法观察数据**?」

                        ⚠️ 原来只有一行摘要(@handle + 字数 + 80 字),
                        　 22 个字段**只在文件里** —— 人要去翻文件系统才看得到。
                        ⭐ 现在每条点开就是全字段,与报告文件**同一份内容**。
                      */}
                      {audit.items.length > 0 && (
                        <details style={{ marginTop: 6 }} open>
                          <summary style={{ cursor: 'pointer', opacity: 0.75 }}>
                            逐条核对（{audit.items.length} 条）—— 点开看全字段
                          </summary>
                          <div style={{ marginTop: 4 }}>
                            {audit.items.map((t, i) => (
                              <details key={t.id} style={S.tweetItem}>
                                <summary style={{ cursor: 'pointer', fontSize: 11 }}>
                                  <span style={{ opacity: 0.4 }}>{i + 1}.</span>
                                  <span style={{ color: '#8fd9a8' }}>　@{t.handle || '?'}</span>
                                  <span style={{ opacity: 0.5 }}>　{t.textLen} 字</span>
                                  {t.isLongText && <span style={{ color: '#9ac' }}>　长推</span>}
                                  {t.isArticle && <span style={{ color: '#9ac' }}>　长文</span>}
                                  {t.hasMedia && <span style={{ color: '#9ac' }}>　{t.mediaTypes.join('/')}</span>}
                                  {t.incomplete && <span style={{ color: '#d98f8f' }}>　⚠️ 不完整</span>}
                                  <span style={{ opacity: 0.75 }}>　{t.preview || '（无正文）'}</span>
                                </summary>
                                <div style={S.tweetFields}>
                                  <Field k="推文id" v={t.id} />
                                  <Field k="正文" v={`${t.textLen} 字`} ok={t.hasText} />
                                  {t.incomplete === 'text-truncated'
                                    && <Field k="⚠️" v="正文被截断 —— 载荷只给了截断版" bad />}
                                  {t.incomplete === 'article-no-body'
                                    && <Field k="⚠️" v="长文没正文 —— 正文在单篇页" bad />}
                                  <Field k="正文内容" v={t.preview} />
                                  <Field k="作者" v={`@${t.handle}`} ok={t.hasAuthor} />
                                  <Field k="显示名" v={t.authorName} ok={t.authorName.length > 0} />
                                  <Field k="作者id" v={t.authorRestId} ok={t.authorRestId.length > 0} />
                                  <Field k="头像" v={t.hasAvatar ? '有' : '无'} ok={t.hasAvatar} />
                                  <Field k="作者bio" v={t.authorBio.slice(0, 60)} ok={t.authorBio.length > 0} />
                                  <Field k="蓝V" v={tri(t.isBlueVerified)} />
                                  <Field k="我关注他" v={tri(t.iFollow)} />
                                  <Field k="他关注我" v={tri(t.followsMe)} />
                                  <Field k="发布时间" v={t.hasCreatedAt ? '有' : '无'} ok={t.hasCreatedAt} />
                                  <Field k="语言" v={t.lang} ok={t.lang.length > 0} />
                                  <Field k="会话id" v={t.hasConversationId ? '有' : '无'} ok={t.hasConversationId} />
                                  <Field k="推文链接" v={t.hasTweetUrl ? '有' : '无'} ok={t.hasTweetUrl} />
                                  <Field
                                    k="互动数"
                                    v={`${t.metricsCount}/6　赞 ${t.metrics.likes ?? '✗'}`
                                      + `　转 ${t.metrics.retweets ?? '✗'}　评 ${t.metrics.replies ?? '✗'}`
                                      + `　引用 ${t.metrics.quotes ?? '✗'}　收藏 ${t.metrics.bookmarks ?? '✗'}`
                                      + `　浏览 ${t.metrics.views ?? '✗'}`}
                                    ok={t.metricsCount >= 6}
                                  />
                                  <Field
                                    k="我的操作"
                                    v={`赞 ${tri(t.self.favorited)}　转 ${tri(t.self.retweeted)}`
                                      + `　收藏 ${tri(t.self.bookmarked)}`}
                                  />
                                  <Field k="媒体" v={t.hasMedia ? t.mediaTypes.join('/') : '无'} />
                                  <Field
                                    k="是回复"
                                    v={t.inReplyToStatusId
                                      ? `是 → ${t.inReplyToStatusId}`
                                        + (t.inReplyToScreenName ? `（@${t.inReplyToScreenName}）` : '')
                                      : '否'}
                                  />
                                  <Field k="引用推文" v={t.quotedStatusId || '无'} />
                                </div>
                              </details>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                  {report.items.length > 0 && !audit && (
                    <div style={S.diagnose}>
                      ⚠️ 收到了 {report.items.length} 条响应，但<strong>一条推文都没解出来</strong>
                      —— 可能这一页没发时间线请求，或载荷结构变了（展开下面的原文看看）。
                    </div>
                  )}
                  {report.problems.length > 0 && (
                    <div style={S.diagnose}>
                      {report.problems.map((x) => <div key={x}>⚠️ {x}</div>)}
                    </div>
                  )}
                  {/*
                    ⚠️ 各腿计数**只在出问题时显示** —— 正常时它是噪音。
                    ⭐ 它是**证据不是选项**:回答「为什么只采到这么点」。
                  */}
                  {(report.problems.length > 0 || report.legs.hook === 0) && (
                    <div style={S.failLine}>
                      取数通路：CDP {report.legs.cdp} · 页面钩子 {report.legs.hook} ·
                      两者都有 {report.legs.both}
                      {!report.legs.hookInjected && '　⚠️ 页面钩子未注入'}
                      {!report.legs.cdpAttached && '　⚠️ CDP 未接上'}
                    </div>
                  )}

                  {/*
                    ⭐⭐ **按大小排序** —— 2026-10-02 实测 71 条里 37 条是视频分片,
                    而正经数据(HomeTimeline 等)混在中间,一条条翻找不到。
                    ⚠️ 原来按时间倒序,结果滚到后面全是视频 —— **人看到的前几条毫无价值**。
                    ⭐ 按大小排:正经载荷几百 KB,心跳/埋点 0KB,一眼分开。
                  */}
                  <div style={S.todo}>
                    共 {report.items.length} 条，按大小排序（正经数据在前，心跳／埋点在后）
                  </div>
                  <div style={S.logBox}>
                    {[...report.items].sort((a, b) => b.byteLength - a.byteLength).map((it) => (
                      <div key={`${it.url}-${it.at}`} style={S.logItem}>
                        <div
                          style={{ ...S.logHead, cursor: 'pointer' }}
                          onClick={() => setOpenPayload(
                            openPayload === it.url + it.at ? null : it.url + it.at,
                          )}
                        >
                          <span style={{ ...S.badge, ...badgeStyle(it.status === 200 ? 'ok' : 'failed') }}>
                            {it.status || '—'}
                          </span>
                          <span style={{ color: '#aaa' }}>{tailOfUrl(it.url)}</span>
                          <span style={{ color: '#666', marginLeft: 'auto' }}>
                            {(it.byteLength / 1024).toFixed(1)} KB
                          </span>
                          <span style={{ color: '#555' }}>
                            {openPayload === it.url + it.at ? '▾' : '▸'}
                          </span>
                        </div>
                        {/*
                          ⭐⭐ **每条里有什么** —— 用户 2026-10-02:
                          「采集了几条,**每条的内容是什么,有哪些数据,有哪些元数据**?」
                          ⚠️ 原来只显示「尾段 + KB」,人要一条条点开看原始 JSON ——
                          　 那不叫「看得见」。
                        */}
                        {(() => {
                          const sh = describePayload(it.text);
                          return (
                            <div style={S.shapeLine}>
                              <span style={{ color: sh.empty || sh.notJson ? '#888' : '#9ac' }}>
                                {sh.summary}
                              </span>
                              {sh.collections.length > 0 && (
                                <span style={{ opacity: 0.6 }}>
                                  　｜ 最大集合：{sh.collections[0].path}（{sh.collections[0].count} 项）
                                </span>
                              )}
                            </div>
                          );
                        })()}
                        {openPayload === it.url + it.at && (
                          <pre style={S.pre}>{it.text.slice(0, 20000)}
                            {it.text.length > 20000
                              && `\n…（还有 ${it.text.length - 20000} 字，已截断显示）`}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/*
          ⭐⭐⭐ **配方** —— 用户 2026-10-04:「配方的配置功能也要增加上来哦。」

          ⚠️ 配方记的是**意图**(要哪些词、谁发的、多久以内、热度门槛),
          真正发出去的查询串由 `recipeToQuery` 翻译 —— 两者**不是一回事**,
          所以每条都把「实际会搜什么」显示出来,人点之前看得见。
        */}
        {tab === 'recipe' && (
          <>
            <div style={S.opArea}>
              <div style={S.row}>
                <button
                  type="button"
                  disabled={recipeBusy}
                  onClick={() => void loadRecipes()}
                  style={S.btn}
                >
                  {recipeBusy ? '读取中…' : '刷新'}
                </button>
                <button
                  type="button"
                  disabled={recipeBusy}
                  onClick={() => setEditing(blankRecipe())}
                  style={S.btn}
                >
                  新建配方
                </button>
                <span style={{ fontSize: 10, opacity: 0.55 }}>
                  共 {recipes.length} 条
                </span>
              </div>
              {recipeErr !== null && (
                <div style={{ ...S.todo, color: '#f87171' }}>⚠️ {recipeErr}</div>
              )}
            </div>

            <div style={S.resultArea}>
              {editing !== null && (
                <RecipeEditor
                  value={editing}
                  onCancel={() => setEditing(null)}
                  onSave={(r) => void saveRecipe(r)}
                />
              )}
              <div style={S.sectionTitle}>配方列表</div>
              <div style={S.logBox}>
                {recipes.length === 0 && <div style={S.todo}>还没有配方。</div>}
                {recipes.map((r) => {
                  const q = recipeToQuery(r);
                  return (
                    <div key={r.id} style={{ marginBottom: 8 }}>
                      <div>
                        <strong>{r.name}</strong>
                        <span style={{ opacity: 0.55 }}>　{r.template}</span>
                        {!r.enabled && <span style={{ opacity: 0.55 }}>　（已停用）</span>}
                      </div>
                      {/* ⭐⭐ 实际会搜什么 —— 配方填的词与发出去的串不是一回事 */}
                      <div style={{ fontSize: 11, opacity: 0.7 }}>{q.explain}</div>
                      <div style={{ fontSize: 11, opacity: 0.55, wordBreak: 'break-all' }}>
                        <code>{q.q}</code>
                      </div>
                      {/* ⚠️ 翻译不出来的要**挡住**,不许点了才失败 */}
                      {q.problems.map((p, i) => (
                        <div key={i} style={{ fontSize: 11, color: '#f87171' }}>⚠️ {p}</div>
                      ))}
                      <div style={{ ...S.row, marginTop: 3 }}>
                        <button
                          type="button"
                          disabled={wcId == null || q.problems.length > 0}
                          onClick={() => void runRecipe(q)}
                          style={S.btn}
                          title={q.problems.length > 0 ? '这条配方还搜不出东西' : '按这条配方去搜，然后回「输出」栏采'}
                        >
                          按它搜索
                        </button>
                        <button type="button" onClick={() => setEditing(r)} style={S.btn}>编辑</button>
                        <button
                          type="button"
                          onClick={() => void removeRecipe(r)}
                          style={S.btn}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * ⭐ 新配方的空壳 —— ⚠️ `id` 空串表示「新增」(由 repo 生成 ULID)。
 * ⭐ 默认值照搬 `SearchRecipe` 注释里的实测结论:
 * `sinceHours` 默认 24、`resultType` 默认 latest。
 */
function blankRecipe(): SearchRecipe {
  return {
    id: '', name: '', enabled: true, template: 'trending',
    keywords: [], fromAccounts: [], helpSignals: [],
    sinceHours: 24, resultType: 'latest', intervalMinutes: 60,
  };
}

/** ⭐ 逗号/空格分隔 ↔ 数组 —— 人填的是一行字,库里存的是数组 */
const toList = (v: string): string[] =>
  v.split(/[,，、\n]+/).map((x) => x.trim()).filter(Boolean);
const fromList = (v: readonly string[] | undefined): string => (v ?? []).join('，');

/**
 * ⭐⭐ 配方编辑器 —— 用户 2026-10-04:「配方的配置功能也要增加上来哦。」
 *
 * ⚠️ 字段**按模板显示**:盯人模板不显示关键词(它根本不筛词),
 * 求助模板才显示信号词 —— 显示用不上的框等于请人填错。
 */
function RecipeEditor(
  { value, onSave, onCancel }:
  { value: SearchRecipe; onSave: (r: SearchRecipe) => void; onCancel: () => void },
): ReactElement {
  const [r, setR] = useState<SearchRecipe>(value);
  /** ⚠️ 换一条编辑时要跟着换 —— 否则点「编辑」第二条还显示第一条 */
  useEffect(() => { setR(value); }, [value]);
  const set = <K extends keyof SearchRecipe>(k: K, v: SearchRecipe[K]): void =>
    setR((x) => ({ ...x, [k]: v }));

  const preview = recipeToQuery(r);
  const isVip = r.template === 'vip-tracking';
  const isHelp = r.template === 'help-wanted';

  return (
    <div style={{ ...S.diagnose, marginBottom: 8 }}>
      <div style={S.sectionTitle}>{r.id ? '编辑配方' : '新建配方'}</div>
      <div style={S.row}>
        <input
          value={r.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="配方名字（必填）"
          style={S.input}
        />
        <select
          value={r.template}
          onChange={(e) => set('template', e.target.value as SearchRecipe['template'])}
          style={{ ...S.input, flex: 'none', width: 150 }}
        >
          <option value="trending">关键词</option>
          <option value="vip-tracking">盯人（只看这些账号）</option>
          <option value="help-wanted">求助（词 + 信号词）</option>
          <option value="custom">自定义</option>
        </select>
      </div>

      {/* ⚠️ 盯人模板不显示关键词 —— 它根本不筛词,显示出来只会请人填错 */}
      {!isVip && (
        <div style={S.row}>
          <input
            value={fromList(r.keywords)}
            onChange={(e) => set('keywords', toList(e.target.value))}
            placeholder="关键词（逗号分隔，任一命中）"
            style={S.input}
          />
        </div>
      )}
      {isHelp && (
        <div style={S.row}>
          <input
            value={fromList(r.helpSignals)}
            onChange={(e) => set('helpSignals', toList(e.target.value))}
            placeholder="求助信号词（逗号分隔，与关键词同时命中才算）"
            style={S.input}
          />
        </div>
      )}
      <div style={S.row}>
        <input
          value={fromList(r.fromAccounts)}
          onChange={(e) => set('fromAccounts', toList(e.target.value))}
          placeholder={isVip ? '盯哪些账号（逗号分隔，必填）' : '限这些账号（可留空）'}
          style={S.input}
        />
      </div>
      <div style={S.row}>
        <input
          value={r.minLikes ?? ''}
          onChange={(e) => set('minLikes', Number(e.target.value.replace(/\D/g, '')) || undefined)}
          placeholder="赞≥"
          style={{ ...S.input, flex: 'none', width: 64 }}
        />
        <input
          value={r.minRetweets ?? ''}
          onChange={(e) => set('minRetweets', Number(e.target.value.replace(/\D/g, '')) || undefined)}
          placeholder="转≥"
          style={{ ...S.input, flex: 'none', width: 64 }}
        />
        <input
          value={r.lang ?? ''}
          onChange={(e) => set('lang', e.target.value.trim() || undefined)}
          placeholder="语言 zh/en"
          style={{ ...S.input, flex: 'none', width: 90 }}
        />
        <input
          value={r.sinceHours ?? ''}
          onChange={(e) => set('sinceHours', Number(e.target.value.replace(/\D/g, '')) || undefined)}
          placeholder="几小时内"
          style={{ ...S.input, flex: 'none', width: 90 }}
        />
        <select
          value={r.resultType}
          onChange={(e) => set('resultType', e.target.value as SearchRecipe['resultType'])}
          style={{ ...S.input, flex: 'none', width: 90 }}
        >
          <option value="latest">最新</option>
          <option value="top">热门</option>
        </select>
      </div>
      <div style={S.row}>
        <label style={{ fontSize: 11 }}>
          <input
            type="checkbox"
            checked={r.includeReplies ?? false}
            onChange={(e) => set('includeReplies', e.target.checked)}
          />
          {' '}连回复一起（filter:replies）
        </label>
        <label style={{ fontSize: 11 }}>
          <input
            type="checkbox"
            checked={r.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
          />
          {' '}启用
        </label>
      </div>

      {/* ⭐⭐ 改一个字就看得见最终会搜什么 —— 不用存了再看 */}
      <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
        实际会搜：<code style={{ wordBreak: 'break-all' }}>{preview.q || '（还搜不出东西）'}</code>
      </div>
      {preview.problems.map((p, i) => (
        <div key={i} style={{ fontSize: 11, color: '#f87171' }}>⚠️ {p}</div>
      ))}

      <div style={{ ...S.row, marginTop: 4 }}>
        <button
          type="button"
          disabled={r.name.trim() === ''}
          onClick={() => onSave(r)}
          style={S.btn}
          title={r.name.trim() === '' ? '配方必须有名字' : '存进库'}
        >
          保存
        </button>
        <button type="button" onClick={onCancel} style={S.btn}>取消</button>
      </div>
    </div>
  );
}

/**
 * ⭐ 一行字段 —— ⚠️ `ok` 不给时**不染色**:
 * 「蓝V 否」「是回复 否」这些是**事实**不是缺失,染红会制造假警报。
 */
function Field({ k, v, ok, bad }: { k: string; v: string; ok?: boolean; bad?: boolean }): ReactElement {
  return (
    <div style={{ display: 'flex', gap: 6, fontSize: 10, lineHeight: 1.7 }}>
      <span style={{ width: 62, flexShrink: 0, opacity: 0.5, textAlign: 'right' }}>{k}</span>
      <span style={{
        color: bad ? '#d98f8f' : ok === undefined ? '#aaa' : ok ? '#8fd9a8' : '#d98f8f',
        wordBreak: 'break-all',
      }}>
        {ok === false && '✗ '}{v || '（空）'}
      </span>
    </div>
  );
}

/**
 * ⚠️⚠️ `undefined` 与 `false` **必须分开显示** ——
 * 「我没关注他」与「载荷没告诉我关注没有」是两件事,
 * 混起来会让追踪名单判错人(旧实现原话)。
 */
function tri(v: boolean | undefined): string {
  return v === undefined ? '—（载荷没带）' : v ? '是' : '否';
}

/**
 * 一个计数格。
 * ⚠️ `tone` 由**调用方按语义给**,不在这里按「大于 0 就绿」猜 ——
 * `noBody > 0` 是坏事,`captured > 0` 是好事,同一个数两种含义。
 */
function Stat(
  { label, v, tone, hint }: { label: string; v: number; tone: 'good' | 'warn' | 'bad' | 'idle'; hint: string },
): ReactElement {
  const color = tone === 'good' ? '#8fd9a8'
    : tone === 'warn' ? '#d9c48f'
      : tone === 'bad' ? '#d98f8f' : '#888';
  return (
    <div style={S.stat} title={hint}>
      <div style={{ color, fontSize: 15, lineHeight: 1.2 }}>{v}</div>
      <div style={{ fontSize: 10, opacity: 0.7 }}>{label}</div>
    </div>
  );
}

/**
 * URL 尾段 —— ⚠️ 只为显示,**不参与判断**。
 * X 的 GraphQL URL 带长 queryId,全显示会把别的字段挤出屏幕。
 */
function tailOfUrl(u: string): string {
  if (!u) return '（URL 未知）';   // ⚠️ 如实说不知道,不猜一个
  try {
    const x = new URL(u);
    const seg = x.pathname.split('/').filter(Boolean);
    return seg.length ? seg[seg.length - 1] : x.hostname;
  } catch {
    return u.slice(0, 40);
  }
}

/** ⚠️ `degraded` 用**警告色**不用成功色 —— 它不是成功 */
function badgeStyle(status: string): React.CSSProperties {
  if (status === 'ok') return { background: '#1f4d2e', color: '#8fd9a8' };
  if (status === 'degraded') return { background: '#4d3f1f', color: '#d9c48f' };
  return { background: '#4d1f1f', color: '#d98f8f' };
}

/** URL 截短显示 —— ⚠️ 只为显示,**不参与任何判断**(判断一律用完整 URL) */
function shortUrl(u: string): string {
  try {
    const x = new URL(u);
    const p = x.pathname + x.search;
    return x.hostname + (p.length > 40 ? p.slice(0, 40) + '…' : p);
  } catch {
    return u.length > 50 ? u.slice(0, 50) + '…' : u;
  }
}

const S: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex', flexDirection: 'column', gap: 10, padding: 12,
    height: '100%', boxSizing: 'border-box', overflow: 'hidden',
    color: 'var(--text-secondary, #999)', fontSize: 12,
  },
  title: { fontSize: 14, color: 'var(--text-primary, #ddd)' },
  hint: { fontSize: 11, opacity: 0.75, lineHeight: 1.6 },
  /** ── tab 栏:三个能力**并排平级** ── */
  tabBar: {
    display: 'flex', gap: 2, borderBottom: '1px solid var(--border-color, #333)',
  },
  tab: {
    display: 'flex', alignItems: 'baseline', gap: 5,
    background: 'transparent', border: 'none',
    borderBottom: '2px solid transparent', marginBottom: -1,
    color: '#888', cursor: 'pointer', fontSize: 12,
    padding: '6px 12px', whiteSpace: 'nowrap',
  },
  tabActive: {
    color: 'var(--text-primary, #ddd)',
    borderBottomColor: 'var(--accent-color, #6a9fd4)',
  },
  tabSub: { fontSize: 9, opacity: 0.45 },
  dot: { color: '#8fd9a8', fontSize: 8 },

  /**
   * ⭐ tab 内容区 —— **上半操作、下半结果**(用户 2026-10-02 定的形态)。
   * ⚠️ `minHeight: 0` 不能少:不写的话 flex 子项按内容撑开,
   * 　 下半的滚动条就出不来,整个面板又变回「一直往下滚」。
   */
  pane: {
    flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8,
    paddingTop: 10,
  },
  /** 上半:操作参数 —— 不抢高度,内容多少占多少 */
  opArea: { display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 },
  /** 下半:操作结果 —— 吃掉剩余高度并自己滚 */
  resultArea: {
    flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8,
    borderTop: '1px solid var(--border-color, #2c2c2c)', paddingTop: 8,
  },

  sectionTitle: {
    fontSize: 12, color: 'var(--text-primary, #ccc)',
    display: 'flex', alignItems: 'center', gap: 8,
  },
  row: { display: 'flex', gap: 6, alignItems: 'center' },
  suggest: {
    display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
    fontSize: 11, padding: '4px 0', minHeight: 24,
  },
  code: {
    background: '#232323', border: '1px solid #3a3a3a', borderRadius: 3,
    padding: '1px 5px', color: '#bda', fontSize: 11,
  },
  input: {
    flex: 1, background: '#1b1b1b', border: '1px solid #3a3a3a',
    borderRadius: 4, color: '#ddd', fontSize: 12, padding: '4px 6px',
  },
  btn: {
    background: 'transparent', border: '1px solid #4a4a4a', borderRadius: 4,
    color: '#bbb', cursor: 'pointer', fontSize: 12, padding: '4px 10px', whiteSpace: 'nowrap',
  },
  linkBtn: {
    marginLeft: 'auto', background: 'none', border: 'none',
    color: '#777', cursor: 'pointer', fontSize: 11,
  },
  todo: { fontSize: 11, opacity: 0.6, lineHeight: 1.6 },
  statRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  stat: {
    minWidth: 58, textAlign: 'center', padding: '4px 6px',
    border: '1px solid #2c2c2c', borderRadius: 4, background: '#1b1b1b',
  },
  failLine: { fontSize: 10, color: '#d98f8f', lineHeight: 1.5, wordBreak: 'break-all' },
  tweetItem: {
    borderTop: '1px solid #2a2a2a', padding: '3px 0',
  },
  tweetFields: {
    padding: '4px 0 6px 10px', borderLeft: '2px solid #333', marginLeft: 6,
  },
  tweetLine: {
    fontSize: 10, lineHeight: 1.7, whiteSpace: 'nowrap',
    overflow: 'hidden', textOverflow: 'ellipsis',
  },
  shapeLine: {
    fontSize: 10, lineHeight: 1.6, padding: '2px 0 0 4px',
    wordBreak: 'break-all', opacity: 0.9,
  },
  auditBox: {
    border: '1px solid var(--border-color, #333)', borderRadius: 6,
    padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11,
  },
  diagnose: {
    fontSize: 11, lineHeight: 1.6, color: '#d9c48f',
    background: '#2a2415', border: '1px solid #4d3f1f', borderRadius: 4, padding: '6px 8px',
  },
  logBox: { flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 },
  logItem: { border: '1px solid #2c2c2c', borderRadius: 4, padding: 6 },
  logHead: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, marginBottom: 4 },
  badge: { borderRadius: 3, fontSize: 10, padding: '1px 6px' },
  pre: {
    margin: 0, fontSize: 11, lineHeight: 1.5, color: '#9a9a9a',
    whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 220, overflow: 'auto',
  },
};
