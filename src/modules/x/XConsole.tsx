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

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { WebDomInvoke, WebDomResult } from '@shared/ipc/web-dom-types';
import {
  auditTimelinePayload, summarizeAudits, mergeExpandedText, type TimelineAudit,
} from './x-timeline-audit';
import {
  X_TIMELINE_ENDPOINTS, X_NOISY_URLS, X_PAGE_MATCHERS, X_PAGE_NAME, isTimelineOp,
} from './x-pages';
import { describePayload } from './x-payload-shape';
import { exportAuditText } from './x-audit-export';
import { X_SCRIPTS } from './x-dom-scripts';
import { runCollect } from './x-collect-run';
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
type CapTab = 'control' | 'input' | 'output';

/** ⚠️ 标签文字与 id 同在一处 —— 分开写两份必漂 */
const CAP_TABS: ReadonlyArray<{ id: CapTab; label: string; sub: string }> = [
  { id: 'control', label: '控制', sub: 'web.page' },
  { id: 'input', label: '输入', sub: 'web.input' },
  { id: 'output', label: '输出', sub: 'web.net' },
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
  result: WebDomResult | { status: 'error'; reason: string };
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
   * ⭐ 采集中 / 最近一次报告 —— **只有这两个 state**。
   * ⚠️ 原来有 stats / hook / payloads 三份(按腿分),那是实现细节漏到了界面上。
   */
  const [running, setRunning] = useState(false);
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
  /** ⭐ 长流程的进度 —— 不让人对着一个「采集中」干等 */
  const [step, setStep] = useState('');
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
                        onProgress: setStep,
                      }, {
                        // ⭐ 用户 2026-10-03:「每次采集 10 页」
                        wantPages: Number(pagesWanted) || 10,
                        /** ⭐⭐ 补到哪一层 —— **采集要求说了算**,不是代码定 */
                        depth,
                      });

                      if (run.harvest) setReport(run.harvest as HarvestReport);
                      setAudit(run.summary);
                      setPlan(run.plan === null ? null : { ...run.plan, fetched: run.fetched });

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
                <input
                  value={pagesWanted}
                  onChange={(e) => setPagesWanted(e.target.value.replace(/\D/g, ''))}
                  style={{ ...S.input, flex: 'none', width: 46 }}
                  title="采够几页就停"
                />
                <span style={{ fontSize: 10, opacity: 0.5 }}>页</span>
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
                  onClick={() => void window.electronAPI?.webDomInvoke?.({
                    op: 'scrollStop', pageRef: { wcId: wcId! },
                  })}
                  style={S.btn}
                >
                  停止
                </button>
              </div>

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
                  <div style={S.statRow}>
                    <Stat label="采到" v={report.items.length}
                      tone={report.items.length > 0 ? 'good' : 'idle'} hint="合并去重后的总条数" />
                    {/* ⚠️ 轮次/像素是**控制**那栏的报告,采集不重复记一份 */}
                  </div>
                  <div style={S.todo}>
                    {report.stopReason}
                    {report.elapsedMs > 0 && `　·　${(report.elapsedMs / 1000).toFixed(1)}s`}
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
