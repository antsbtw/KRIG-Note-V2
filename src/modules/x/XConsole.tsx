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
 * 捕获计数 —— ⭐⭐ **三种状态分开**,与底座 `CaptureStats` 同构。
 *
 * ⚠️⚠️ 为什么不能合成一个「捕获 N 条」:
 * · `noBody` = 有响应但拿不到载荷 → **通道哑了**
 * · `bodyLost` = 有 bodyRef 但取不出 → 与老化赛跑输了
 * 两种成因要调的东西完全不同,混起来就不知道该动哪里。
 * ⭐ 而记忆 `project-x-collect-two-legs` 的教训是:**判据看 payloads
 * 不看推文数** —— DOM 那条腿会顶着,掩盖载荷全断(实测 payloads 83→0
 * 而推文数还有 38,人以为只是少了点)。这一栏就是让 payloads 看得见的地方。
 */
type CaptureStats = {
  captured: number;
  noBody: number;
  bodyLost: number;
  channelFailures: number;
  lastChannelFailure?: string;
  held: number;
  running: boolean;
};

/** 一条攒下来的载荷 —— ⭐ 原样文本,面板不解析 */
type CapturedPayload = {
  requestId: string;
  url: string;
  method?: string;
  status?: number;
  at: string;
  text: string;
  byteLength: number;
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
  /** 捕获计数 —— ⚠️ `null` = 还没问过,与「问过了是 0」不是一回事 */
  const [stats, setStats] = useState<CaptureStats | null>(null);
  const [payloads, setPayloads] = useState<CapturedPayload[]>([]);
  /** 展开看原样 JSON 的那一条 */
  const [openPayload, setOpenPayload] = useState<string | null>(null);
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
   * ⭐⭐ 捕获中轮询计数 —— **只在 running 时轮**。
   *
   * ⚠️ 为什么用轮询不用主进程推送:
   * ① `netBus.list` / `stats()` 本来就现成,推送要新开一条通道;
   * ② 推送要管多窗口扇出,而记忆 `project-host-broadcast-multi-ws-fanout`
   *    记着四类坑(广播型/定向型/发起型…),为一个调试台开这个口不值。
   * ⚠️ 这是**我的取舍**,不是用户要求 —— 哪天采集侧要实时进度条,
   * 推送才真有必要(那时本 effect 是唯一改动点)。
   *
   * ⚠️⚠️ **停捕后必须停轮** —— 不停的话:
   * ① 白耗 IPC;② 更坏的是人点了「停」而数字还在动,
   * 会让人以为没停下来,然后去查一个不存在的 bug。
   */
  useEffect(() => {
    if (wcId == null || !stats?.running) return;
    const timer = setInterval(() => {
      void window.electronAPI?.webDomInvoke?.({ op: 'captureStats', pageRef: { wcId } })
        .then((r) => { if (r.status === 'ok') setStats(r.value as CaptureStats); })
        // ⚠️ 轮询失败不进留痕(会刷满),但也不能静默 —— 由下一次轮询自愈;
        //    真故障会在 channelFailures 计数里出现
        .catch(() => undefined);
    }, 1500);
    return () => clearInterval(timer);
  }, [wcId, stats?.running]);

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
            {t.id === 'output' && stats?.running && <span style={S.dot}>●</span>}
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
              <div style={S.row}>
                <button
                  type="button"
                  disabled={disabled || stats?.running === true}
                  onClick={async () => {
                    await call('captureStart', { op: 'captureStart', pageRef: { wcId: wcId! } });
                    const r = await window.electronAPI!.webDomInvoke({
                      op: 'captureStats', pageRef: { wcId: wcId! },
                    });
                    if (r.status === 'ok') setStats(r.value as CaptureStats);
                  }}
                  style={S.btn}
                >
                  开始捕获
                </button>
                <button
                  type="button"
                  disabled={disabled || !stats?.running}
                  onClick={async () => {
                    const r = await window.electronAPI!.webDomInvoke({
                      op: 'captureStop', pageRef: { wcId: wcId! },
                    });
                    if (r.status === 'ok') setStats(r.value as CaptureStats);
                  }}
                  style={S.btn}
                >
                  停
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={async () => {
                    const r = await window.electronAPI!.webDomInvoke({
                      op: 'captureList', pageRef: { wcId: wcId! }, limit: 20,
                    });
                    if (r.status === 'ok') setPayloads(r.value as CapturedPayload[]);
                    else setPayloads([]);
                  }}
                  style={S.btn}
                >
                  取载荷
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={async () => {
                    const r = await window.electronAPI!.webDomInvoke({
                      op: 'captureClear', pageRef: { wcId: wcId! },
                    });
                    if (r.status === 'ok') setStats(r.value as CaptureStats);
                    setPayloads([]);
                    setOpenPayload(null);
                  }}
                  style={S.linkBtn}
                >
                  清空
                </button>
            </div>

          {/*
            ⭐⭐ 三种状态分开显示 —— 这一栏是本步的**全部意义**。
            ⚠️ 合成一个「捕获 N 条」会让「通道哑了」长得像「这页没请求」,
            　 而 `project-x-collect-two-legs` 实测过:payloads 83→0 时
            　 推文数还有 38,DOM 那条腿顶着,人以为只是少了点。
          */}
          {stats && (
            <div style={S.statRow}>
              <Stat label="captured" v={stats.captured} tone={stats.captured > 0 ? 'good' : 'idle'}
                hint="真拿到了 body" />
              <Stat label="noBody" v={stats.noBody} tone={stats.noBody > 0 ? 'warn' : 'idle'}
                hint="⚠️ 有响应却没载荷 —— 通道哑了的指纹" />
              <Stat label="bodyLost" v={stats.bodyLost} tone={stats.bodyLost > 0 ? 'warn' : 'idle'}
                hint="⚠️ 有 bodyRef 但取不出 —— 与老化赛跑输了" />
              <Stat label="通道故障" v={stats.channelFailures}
                tone={stats.channelFailures > 0 ? 'bad' : 'idle'}
                hint="attach 失败 / 中途被 detach" />
              <Stat label="攒着" v={stats.held} tone="idle" hint="当前存了几条（封顶 64）" />
            </div>
          )}
          {stats?.lastChannelFailure && (
            <div style={S.failLine}>最后一条通道故障：{stats.lastChannelFailure}</div>
          )}
          {stats && stats.captured === 0 && stats.noBody > 0 && (
            /*
              ⭐ 这句话是本栏最值钱的地方:这个组合**唯一指向**通道问题。
              ⚠️ 没有它,人看到「captured 0」第一反应是去查选择器或页面 ——
              　 而真因在 CDP 通道,方向完全相反。
            */
            <div style={S.diagnose}>
              ⚠️ 有响应但一条载荷都没拿到 —— 这是 <strong>CDP 通道</strong>的问题，
              不是页面或选择器的问题。查 DevTools 是否占着通道。
            </div>
          )}
          {stats && !stats.running && stats.captured === 0 && stats.noBody === 0 && (
            <div style={S.todo}>
              还没捕到任何响应。⭐ 载荷靠**滚动**触发 —— 先点上面的
              scrollUntil，页面不动就不会有新请求。
            </div>
          )}
            </div>
            <div style={S.resultArea}>
              {/* ── 原样载荷 ── */}
              {payloads.length > 0 && (
                <div style={S.logBox}>
                  {payloads.map((pl) => (
                    <div key={pl.requestId} style={S.logItem}>
                      <div
                        style={{ ...S.logHead, cursor: 'pointer' }}
                        onClick={() => setOpenPayload(openPayload === pl.requestId ? null : pl.requestId)}
                      >
                        <span style={{ ...S.badge, ...badgeStyle(pl.status === 200 ? 'ok' : 'failed') }}>
                          {pl.status ?? '—'}
                        </span>
                        {/* ⭐ 只显示路径尾段 —— X 的 GraphQL URL 很长,全显示会把别的挤掉 */}
                        <span style={{ color: '#aaa' }}>{tailOfUrl(pl.url)}</span>
                        <span style={{ color: '#666', marginLeft: 'auto' }}>
                          {(pl.byteLength / 1024).toFixed(1)} KB
                        </span>
                        <span style={{ color: '#555' }}>{openPayload === pl.requestId ? '▾' : '▸'}</span>
            </div>
                  {openPayload === pl.requestId && (
                    /* ⭐ 原样,不解析、不挑字段 —— 这是调试台的本分 */
                    <pre style={S.pre}>{pl.text.slice(0, 20000)}
                      {pl.text.length > 20000 && `\n…（还有 ${pl.text.length - 20000} 字，已截断显示）`}
                    </pre>
                  )}
                </div>
              ))}
            </div>
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
