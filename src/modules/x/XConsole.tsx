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
import { auditTimelinePayload, summarizeAudits, type TimelineAudit } from './x-timeline-audit';
import { X_TIMELINE_ENDPOINTS } from './x-pages';
import { describePayload } from './x-payload-shape';

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
type AcquireReport = {
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
  const [report, setReport] = useState<AcquireReport | null>(null);
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
  const [scrollRounds, setScrollRounds] = useState('30');

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
                op: 'scrollUntil', pageRef: { wcId: wcId! },
                stop: { kind: 'atBottom' }, maxRounds: Number(scrollRounds) || 5,
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
                ⭐⭐⭐ **一个按钮** —— 用户 2026-10-02:
                「我需要的是**完整的数据**，而不是分这么多类别」
                「不是选择用哪条腿 —— 你要构建**获取完整信息的函数/或者类**，
                　底层能够可以做最小化的抽象函数，但**上层只关注某个具体的目标**呀。」

                ⭐ 原来七个按钮里五个是**实现细节**(CDP 腿/钩子腿/重载/取载荷/分别停)。
                现在底层 `acquire` 一次做完:所有腿一起上 → 重载(解竞态)
                → 滚到够了或真到底 → 合并去重 → 回一份报告。
              */}
              {/*
                ⭐⭐ **控制是控制,采集是采集**(用户 2026-10-02)。
                这一栏只管「开始接 / 停止接」—— 页面怎么翻去**控制那栏**。
                ⚠️ 上一版把 reload+滚动揉进采集,实测 `rounds=0 scrolledPx=0`:
                　 重载后首屏就够数、一轮都没滚,而人在这栏看不出来页面没动过。
              */}
              <div style={S.row}>
                <button
                  type="button"
                  disabled={wcId == null || running}
                  onClick={async () => {
                    /**
                     * ⭐ 落痕「人点了什么」—— 2026-10-02:
                     * 连续两轮卡在同一步而我**读不到面板状态**,只能静态推断。
                     * ⚠️ 「人点了但没发出去」与「人没点」必须分得开。
                     */
                    void window.electronAPI?.webDomInvoke?.({
                      op: 'uiTrace', pageRef: { wcId: wcId! },
                      action: '开始收', state: { running, hasReport: report !== null },
                    });
                    const r = await window.electronAPI!.webDomInvoke({
                      op: 'acquireStart', pageRef: { wcId: wcId! },
                    });
                    setLog((l) => [{
                      at: new Date().toLocaleTimeString(), label: '开始收', result: r,
                    }, ...l].slice(0, 50));
                    if (r.status === 'ok') {
                      setRunning(true);
                      setReport(null);
                      setAudit(null);
                    }
                  }}
                  style={S.btn}
                  title="两条取数通路同时装上；页面怎么翻请去「控制」那栏"
                >
                  开始收
                </button>
                <button
                  type="button"
                  disabled={wcId == null || !running}
                  onClick={async () => {
                    /**
                     * ⚠️⚠️ **先把 running 置回,再做别的** —— 2026-10-02 实测:
                     * 用户点了停,数据**还在不断进来**、提示块也不消失。
                     * 真因:原来 `setRunning(false)` 写在 `await` **之后**,
                     * 那次 IPC 一抛异常,整个 handler 就中断 ——
                     * **停不下来,而且界面看不出哪里出了错**。
                     *
                     * ⭐ 「停」是取消动作:它必须**先生效**,
                     * 失败也只是「没拿到报告」,不该变成「停不下来」。
                     */
                    void window.electronAPI?.webDomInvoke?.({
                      op: 'uiTrace', pageRef: { wcId: wcId! },
                      action: '停止并核对',
                      state: { running, peekTotal: peek?.total ?? null },
                    });
                    setRunning(false);
                    setPeek(null);
                    let r: WebDomResult | { status: 'error'; reason: string };
                    try {
                      r = await window.electronAPI!.webDomInvoke({
                        op: 'acquireStop', pageRef: { wcId: wcId! },
                      });
                    } catch (e) {
                      // ⚠️ 不静默:停不下来时人要看得见原因
                      r = { status: 'error' as const, reason: e instanceof Error ? e.message : String(e) };
                    }
                    if (r.status === 'ok' || r.status === 'degraded') {
                      const rep = (r as WebDomResult & { value: AcquireReport }).value;
                      setReport(rep);
                      /**
                       * ⭐⭐ **完整性核对在这里做** —— 它是 X 的活。
                       * ⚠️ 底座只回「收到了什么」,不做研判(用户 2026-10-02:
                       * 「采集数据就是全面的采集,**没有数据研判的功能呀?**」)。
                       */
                      const audits: TimelineAudit[] = rep.items
                        .filter((it) => X_TIMELINE_ENDPOINTS.some((e) => it.url.includes(e)))
                        .map((it) => auditTimelinePayload(it.text));
                      setAudit(audits.length > 0 ? summarizeAudits(audits) : null);
                    }
                    setLog((l) => [{
                      at: new Date().toLocaleTimeString(), label: '停止收', result: r,
                    }, ...l].slice(0, 50));
                  }}
                  style={S.btn}
                >
                  停止并核对
                </button>
                {running && <span style={S.live}>● 收集中</span>}
              </div>
              {/*
                ⭐⭐ 步骤提示**跟着状态走** —— 2026-10-02 实测踩到:
                原来条件是 `!running && !report`,**一点「开始收」它就消失了**,
                于是人进入第 ② 步后面板上只剩一个「● 收集中」,
                **不告诉他接下来该做什么** —— 那一轮因此没走到「停止并核对」。
                ⚠️ 与 `feedback-maintainability-over-feature-completion` 同族:
                　 依据一关就没。⭐ 正在进行的那一步要**更醒目**,不是消失。
              */}
              {!running && !report && (
                <div style={S.todo}>
                  <strong style={{ color: 'var(--text-primary, #ddd)' }}>① 点「开始收」</strong>
                  　（两条取数通路同时装上）<br />
                  ② 去「控制」那栏：重载 / goto / scrollUntil<br />
                  ③ 回来点「停止并核对」
                </div>
              )}
              {running && (
                <div style={S.diagnose}>
                  {/*
                    ⚠️⚠️ **重载不是可选项,是必须的第一步** —— 2026-10-02 实测:
                    这一轮没重载,结果 6 条全是杂项、`HomeTimeline` 一条都没有。
                    ⭐ 真因:X 首页的 `HomeTimeline` 在**页面加载时就发完了**,
                    　 装腿时它早已过去。重载让页面从第一条请求重新开始。
                    ⚠️ 原来写成「重载 / goto / scrollUntil」并列,像三个可选项 ——
                    　 那是我的表述把必须步骤降级成了选项。
                  */}
                  <strong>② 去「控制」那栏，按顺序做两步：</strong><br />
                  　<strong style={{ color: '#d9c48f' }}>必须先点「重载」</strong>
                  　—— 首屏那批请求（含 HomeTimeline）只在页面加载时发一次，
                  不重载就永远收不到。<br />
                  　再点「scrollUntil」翻页（X 要滚到接近底部才请求下一批，
                  <strong>2 轮通常不够，建议 10 轮以上</strong>）。<br />
                  翻完<strong>回到这里点「停止并核对」</strong>。
                  {peek && (
                    <div style={{ marginTop: 4, opacity: 0.85 }}>
                      {/* ⚠️ 只报**收到多少** —— 「其中几条有用」是停止后核对的事 */}
                      已收到 {peek.total} 条
                    </div>
                  )}
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
                        完整性核对：{audit.pages} 页 ·
                        {' '}{audit.uniqueTweets} 条推文
                        {audit.tweets !== audit.uniqueTweets
                          && `（原始 ${audit.tweets} 条，去重后 ${audit.uniqueTweets}）`}
                      </div>
                      <div style={S.statRow}>
                        {Object.entries(audit.coverage).map(([k, v]) => (
                          <div key={k} style={S.stat} title={`${k} 字段的覆盖率`}>
                            <div style={{
                              fontSize: 15,
                              lineHeight: 1.2,
                              // ⚠️ 100% 才算满 —— 95% 也意味着有东西丢了
                              color: v === 100 ? '#8fd9a8' : v > 0 ? '#d9c48f' : '#777',
                            }}>
                              {v}%
                            </div>
                            <div style={{ fontSize: 10, opacity: 0.7 }}>{k}</div>
                          </div>
                        ))}
                      </div>
                      {audit.problems.length > 0 && (
                        <div style={{ ...S.failLine, marginTop: 4 }}>
                          {[...new Set(audit.problems)].map((x) => <div key={x}>⚠️ {x}</div>)}
                        </div>
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

                  <div style={S.logBox}>
                    {report.items.map((it) => (
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
