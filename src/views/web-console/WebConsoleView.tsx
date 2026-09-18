/**
 * Web 能力层控制台 —— 逐个原子能力单独跑,看**原样返回值**(dev-only)
 *
 * 用户 2026-09-15:
 * > 「做一个函数测试面板,对函数的执行结果可看到,可验证才行。」
 * > 「在面板上分三个 tog,每个 tog 都放置对应的函数,
 * >   对这个函数配置后测试后就可以看到测试结果。」
 * > 「抽象好函数,原子性操作很重要,这是业务编排的基础。」
 *
 * ⭐ 分类用契约原文的三分法(`01-contract.md:15`):**控制 / 输入 / 输出**。
 *
 * ⚠️⚠️ **这是观察窗,不是演示台。**
 * 结果区渲染**原样返回值**,不做 ✅/❌ 判定 —— 判断留给看的人。
 * 「满屏绿灯而真实链路零数据」是本仓明确记过的死法
 * (`project-web-capability-observer`)。
 *
 * ⚠️ 三态要看得见:`ok` / `failed` / **`degraded`**。
 * `degraded` = 做了但不完整,当成功会掩盖漏采,当失败会丢掉已有进度。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { XExtractionApi } from '@capabilities/x-extraction';
import './web-console.css';

type TabId = 'control' | 'input' | 'output' | 'exec' | 'verify';

/** 一次调用的完整记录 —— 入参与返回值都留着 */
type Run = {
  fn: string;
  input: unknown;
  output: unknown;
  at: string;
  ms: number;
};

const api = () => window.electronAPI?.webConsole;
/** ⚠️ 主侧已有这套(startCaptureMonitor + broadcast),**renderer 侧此前零接收** ——
 *  广播出去没人听,正是「建好了却点不到」那个形态(feedback-guard-must-pin-live-code)。*/
const xapi = () => (window.electronAPI as { xTimeline?: {
  captureStart(wcId?: number): Promise<unknown>;
  captureStop(): Promise<unknown>;
  onCaptureUpdate(cb: (s: unknown) => void): () => void;
} } | undefined)?.xTimeline;

type CapturedTweet = Record<string, unknown> & { tweetId?: string };
type CaptureSnapshot = {
  running?: boolean; onScreenCount?: number; captured?: number;
  seenInDom?: number; skippedAds?: number; payloads?: number; captureRate?: number;
  recent?: CapturedTweet[];
  rawPayloads?: Array<{ op: string; url: string; body: string; at: number; bytes: number }>;
  cdpNote?: string;
  graphqlSeen?: number;
  actions?: Array<{ t: number; kind: string; detail: string }>;
  hoverProfiles?: Record<string, Record<string, unknown>>;
};

/** 全字段都要列 —— 包括空的。只显示有值的,就看不出少了什么 */
const VERIFY_FIELDS = [
  'tweetId', 'authorHandle', 'authorRestId', 'authorName', 'authorAvatar', 'isBlueVerified', 'verifiedEvidence', 'authorBio', 'iFollow', 'followEvidence', 'followsMe',
  'text', 'createdAt', 'lang', 'tweetUrl',
  'isReply', 'inReplyToStatusId', 'inReplyToScreenName', 'conversationId',
  'quotedStatusId', 'hasMedia', 'mediaTypes', 'media', 'isLongText',
  'metrics', 'self', 'fromDom',
] as const;


/**
 * 锚点下拉 —— 只列**真表里有的**名字。
 *
 * ⚠️ 表没加载出来时**明说**,不渲染一个空下拉:
 * 空下拉看起来像「没有任何锚点」,而实际可能只是还没读到。
 * 这与底座「查不到返回 null 而不是原样回显」是同一条原则。
 */
function AnchorSelect(
  { value, onChange, names }: { value: string; onChange: (v: string) => void; names: string[] },
) {
  if (names.length === 0) {
    return (
      <span className="krig-webc__note" style={{ flex: 1, margin: 0 }}>
        锚点表还没读到 —— 去「输出」页点一次 anchors
      </span>
    );
  }
  return (
    <select className="krig-webc__in" style={{ flex: 1 }}
      value={value} onChange={(e) => onChange(e.target.value)}>
      {names.map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  );
}

export function WebConsoleView({ workspaceId }: { workspaceId: string }) {
  const [tab, setTab] = useState<TabId>('control');
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  // ── 控制:参数 ──
  /** ⭐ goto:语义页面名 + 参数。⚠️ 面板不碰 URL —— 那是 adapter 的知识 */
  const [gotoName, setGotoName] = useState('x.home');
  const [gotoHandle, setGotoHandle] = useState('fang_danie121');
  const [gotoTweetId, setGotoTweetId] = useState('');
  const [gotoQuery, setGotoQuery] = useState('');
  const [pageNames, setPageNames] = useState<string[]>([]);
  const [readyKind, setReadyKind] = useState('urlIncludes');
  /** ⚠️ URL 片段与锚点名**分开存** —— 共用一个格子就是那个 bug 的根源 */
  const [readyValue, setReadyValue] = useState('/home');
  const [readyAnchor, setReadyAnchor] = useState('tweet.article');
  const [readyTimeout, setReadyTimeout] = useState('6000');
  const [scrollKind, setScrollKind] = useState('rounds');
  const [scrollN, setScrollN] = useState('3');
  const [scrollStuck, setScrollStuck] = useState('3');
  const [tapAnchor, setTapAnchor] = useState('nav.profile');
  const [pressKey, setPressKey] = useState('Escape');

  // ── 输入:参数 ──
  /**
   * ⚠️ 默认必须是**输入框**,不是发送按钮。
   *
   * 初版默认 `compose.sendButton` —— 它是个合法锚点,下拉照样选中它,
   * 于是用户不手动改就一直在**往按钮里填字**,底座如实报
   * 「既非 input/textarea 也非 contenteditable」。连撞三次都是这个原因。
   * ⭐ 默认值要选「这个功能最常见的正确用法」,而不是随手挑一个能解析的名字。
   */
  const [typeAnchor, setTypeAnchor] = useState('compose.box');
  const [typeText, setTypeText] = useState('测试文本(不会发布)');
  const [typeCheck, setTypeCheck] = useState('contains');

  // ── 执行(第四类:对象=模型,不是页面)──
  // ⚠️ 模型名不给默认值以外的猜测:这里填的就是 Ollama 里真实存在的那个
  // ⚠️ 默认值来自**实测** `ollama /api/tags`(gemma4:31b-it-qat / gemma4:26b-a4b-it-qat),
  //    不是猜的。初版我写了个不存在的 `gemma3:27b` —— 那会让第一次点击返回
  //    HTTP 404,看起来像面板坏了,其实是模型名编的。
  //    选 26b 而非 31b:记忆 project-x-reply-latency 实测 31b 慢 5-8 倍,面板要反复点。
  const [execModel, setExecModel] = useState('gemma4:26b-a4b-it-qat');
  const [execInstruction, setExecInstruction] = useState(
    '判断这条推文是不是在求助「翻墙/VPN 连不上」。只回 JSON:{"worth":true|false,"reason":"一句话"}',
  );
  const [execContent, setExecContent] = useState('求推荐一个好用的机场,最近老是连不上');
  const [execStructured, setExecStructured] = useState(true);
  /**
   * ⭐⭐ 卷宗附件 —— **可增删的列表,不是写死的清单**(用户 2026-09-17 订正)。
   *
   * > 「这个不应该写死,大概为 bio,和这条推文相关的判断数据-上下文等。」
   *
   * ⚠️ 初版我在这里放了四个写死的输入框(推主概况/上下文/会话串/时间线邻近),
   * 那等于把**我列的示例**变成了**系统的清单**。契约里 `attachments` 本来就是
   * `Record<string, unknown>` —— 键是什么由调用方决定,附件种类是**编排的参数**,
   * 不是能力层的常量。
   *
   * 下面两行只是**省事的预填**,可以改名、可以删、可以加 —— 不是清单。
   */
  const [inv, setInv] = useState<unknown>(null);
  /**
   * ⭐⭐ 采集验证(用户 2026-09-18 定的验证方式):
   *
   * > 「我在 x 上操作一个界面,你把采集到的数据显示在右侧,
   * >   列出所有的数据(包括元数据),我核对一遍,如果有漏数据,我会告知你。」
   *
   * ⚠️ 这比「两路互比」强在哪:两路可能**一起漏**同一样东西,
   * 互比出来是「一致」,其实共同盲区。而人眼看得见页面上真有什么 ——
   * 那才是真值。这正是 AI 验不了、只能靠人的那部分。
   */
  const [capSnap, setCapSnap] = useState<CaptureSnapshot | null>(null);
  const [capOn, setCapOn] = useState(false);
  const [rawOpen, setRawOpen] = useState<number | null>(null);
  const [vBadge, setVBadge] = useState<unknown>(null);
  const [memProbe, setMemProbe] = useState<unknown>(null);
  /**
   * ⚠️ 传**语义页面名**,不是 URL —— 守卫「面板不许构造 x.com URL」刚抓住我。
   * 那条规矩是对的:URL 是 adapter 的知识,站点改版只改 x-pages.ts 一处。
   * 下拉用的是**真表**(pageNames),不在这里抄一份。
   */
  const [acPage, setAcPage] = useState('x.home');
  const [acRounds, setAcRounds] = useState('30');
  const [acBudget, setAcBudget] = useState('120');
  const [acReport, setAcReport] = useState<unknown>(null);
  const [atts, setAtts] = useState<Array<{ name: string; value: string }>>([
    { name: 'bio', value: '' },
    { name: '上下文', value: '' },
  ]);

  // ── 输出 ──
  const [pages, setPages] = useState<unknown>(null);
  const [anchors, setAnchors] = useState<unknown>(null);
  const [tabBar, setTabBar] = useState<unknown>(null);

  const wcId = useCallback((): number | undefined => {
    try {
      const xApi = requireCapabilityApi<XExtractionApi>('x-extraction');
      return xApi.getXHostWcId(workspaceId) ?? undefined;
    } catch {
      return undefined;
    }
  }, [workspaceId]);

  /** 跑一个函数并记账。⚠️ 入参与返回值都原样留着 */
  const run = useCallback(async (fn: string, input: unknown, call: () => Promise<unknown>) => {
    setBusy(fn);
    const t0 = Date.now();
    try {
      const output = await call();
      const rec: Run = {
        fn,
        input,
        // 通道没接 / 生产构建下 api() 是 undefined —— 照实显示,不编结果
        output: output ?? { channelOk: false, error: '没有返回(通道未注册?生产构建下控制台不注册)' },
        at: new Date().toLocaleTimeString('zh-CN'),
        ms: Date.now() - t0,
      };
      setRuns((prev) => [rec, ...prev].slice(0, 20));
      return rec.output;
    } catch (err) {
      const rec: Run = {
        fn, input,
        output: { channelOk: false, error: String(err) },
        at: new Date().toLocaleTimeString('zh-CN'),
        ms: Date.now() - t0,
      };
      setRuns((prev) => [rec, ...prev].slice(0, 20));
      return rec.output;
    } finally {
      setBusy(null);
    }
  }, []);

  /**
   * ⭐ 订阅采集快照。
   * ⚠️ 退订必须返回 —— 组件卸载后还收广播会往死组件里 setState
   * (多窗口下每个 view 实例各收一份,不退订会越积越多)。
   */
  useEffect(() => {
    const off = xapi()?.onCaptureUpdate((snap) => setCapSnap(snap as CaptureSnapshot));
    return () => { off?.(); };
  }, []);

  // 打开就拉一次页面清单 —— 「屏幕上几个页面,这里就该几行」
  useEffect(() => {
    void (async () => {
      const r = await api()?.pages();
      setPages(r ?? { channelOk: false, error: '通道未注册' });
      const a = await api()?.anchors();
      setAnchors(a ?? null);
      // ⭐ 语义页面名同样读**真表**,面板不抄一份(抄一份就会漂)
      const pn = await api()?.pageNames();
      const tabs = (pn as { tables?: Array<{ names: string[] }> } | undefined)?.tables ?? [];
      setPageNames(tabs.flatMap((t) => t.names));
    })();
  }, []);

  const anchorOwners = useMemo(() => {
    const o = anchors as { owners?: string[] } | null;
    return o?.owners ?? [];
  }, [anchors]);

  /**
   * ⭐ 可选锚点名 —— 从**真表**读(`anchors()` 通道),面板不抄一份。
   * ⚠️ 抄一份就会漂,而漂的表现是「面板上有这个名字、点下去说没登记」。
   */
  const anchorNames = useMemo(() => {
    const o = anchors as { tables?: Array<{ owner: string; names: string[] }> } | null;
    return (o?.tables ?? []).flatMap((t) => t.names);
  }, [anchors]);

  return (
    <div className="krig-webc">
      <div className="krig-webc__topbar">
        <span className="krig-webc__title">能力控制台</span>
        <span className="krig-webc__badge">dev-only</span>
        <span className="krig-webc__ws">{workspaceId}</span>
        <div className="krig-webc__spacer" />
        <span className="krig-webc__hint">
          左边真页面,右边原样返回值 —— 结果自己判断,面板不给绿灯
        </span>
      </div>

      <div className="krig-webc__tabs">
        {([
          { id: 'control' as const, label: '控制', desc: 'web.page / web.input 的动作' },
          { id: 'input' as const, label: '输入', desc: '往页面里填' },
          { id: 'output' as const, label: '输出', desc: '看得见的事实' },
          { id: 'exec' as const, label: '执行', desc: '第四类:对象=模型,不是页面' },
          { id: 'verify' as const, label: '采集验证', desc: '左边操作 X,右边列出采到的一切 —— 你来核对漏没漏' },
        ]).map((t) => (
          <button
            key={t.id}
            type="button"
            className={`krig-webc__tab${tab === t.id ? ' krig-webc__tab--active' : ''}`}
            onClick={() => setTab(t.id)}
            title={t.desc}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="krig-webc__body">
        {tab === 'control' && (
          <>
            {/* goto —— 编排第一步:先去对页面 */}
            <div className="krig-webc__fn">
              <div className="krig-webc__fn-head">
                <span className="krig-webc__fn-name">goto</span>
                <span className="krig-webc__fn-sig">语义导航 · 传页面名不传 URL</span>
              </div>
              <div className="krig-webc__row">
                {pageNames.length === 0 ? (
                  <span className="krig-webc__note" style={{ flex: 1, margin: 0 }}>
                    语义页面表还没读到 —— 重启后应自动加载
                  </span>
                ) : (
                  <select className="krig-webc__in" style={{ flex: 1 }}
                    value={gotoName} onChange={(e) => setGotoName(e.target.value)}>
                    {pageNames.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                )}
                {/^x\.(profile|withReplies|articles)$/.test(gotoName) && (
                  <input className="krig-webc__in" style={{ width: 170 }} value={gotoHandle}
                    onChange={(e) => setGotoHandle(e.target.value)} placeholder="handle" />
                )}
                {gotoName === 'x.status' && (
                  <input className="krig-webc__in" style={{ width: 170 }} value={gotoTweetId}
                    onChange={(e) => setGotoTweetId(e.target.value)} placeholder="推文 id" />
                )}
                {gotoName === 'x.search' && (
                  <input className="krig-webc__in" style={{ width: 170 }} value={gotoQuery}
                    onChange={(e) => setGotoQuery(e.target.value)} placeholder="搜索词" />
                )}
                <button type="button" className="krig-webc__go" disabled={busy !== null}
                  onClick={() => {
                    const params: Record<string, string> = {};
                    if (/^x\.(profile|withReplies|articles)$/.test(gotoName)) params.handle = gotoHandle;
                    if (gotoName === 'x.status') params.tweetId = gotoTweetId;
                    if (gotoName === 'x.search') params.q = gotoQuery;
                    void run('goto', { name: gotoName, params },
                      () => api()!.goto(wcId(), gotoName, params));
                  }}>执行</button>
              </div>
              <div className="krig-webc__note">
                ⭐ 跑的时候**看左边** —— 页面真的换了才算数。
                <br />⚠️ 判据由语义页面表给(如 <code>x.withReplies</code> 的判据带 handle,
                跳到别人页面不算到位)。
              </div>
            </div>

            {/* ready */}
            <div className="krig-webc__fn">
              <div className="krig-webc__fn-head">
                <span className="krig-webc__fn-name">ready</span>
                <span className="krig-webc__fn-sig">等页面到位 · 超时是 Failed,不是 Ok</span>
              </div>
              <div className="krig-webc__row">
                <select className="krig-webc__in" value={readyKind}
                  onChange={(e) => setReadyKind(e.target.value)}>
                  <option value="urlIncludes">urlIncludes</option>
                  <option value="anchorAppears">anchorAppears</option>
                  <option value="anchorGone">anchorGone(模态关闭)</option>
                </select>
                {/* ⚠️ 按判据切换输入形态 —— 初版三种判据共用一个自由文本框,
                    于是默认值 anchorAppears + "/home" 这种**配不到一起**的组合
                    也能提交(用户第一次点就撞上了:/home 是 URL 片段不是锚点名)。
                    锚点类判据改成下拉,直接消灭「猜名字」。 */}
                {readyKind === 'urlIncludes' ? (
                  <input className="krig-webc__in" style={{ flex: 1 }} value={readyValue}
                    onChange={(e) => setReadyValue(e.target.value)}
                    placeholder="URL 片段,如 /home" />
                ) : (
                  <AnchorSelect value={readyAnchor} onChange={setReadyAnchor} names={anchorNames} />
                )}
                <input className="krig-webc__in" style={{ width: 80 }} value={readyTimeout}
                  onChange={(e) => setReadyTimeout(e.target.value)} placeholder="ms" />
                <button type="button" className="krig-webc__go" disabled={busy !== null}
                  onClick={() => {
                    const criterion = readyKind === 'urlIncludes'
                      ? { kind: 'urlIncludes', fragment: readyValue }
                      : { kind: readyKind, anchor: readyAnchor };
                    void run('ready', { criterion, timeoutMs: Number(readyTimeout) },
                      () => api()!.ready(wcId(), criterion, Number(readyTimeout)));
                  }}>执行</button>
              </div>
            </div>

            {/* scrollUntil */}
            <div className="krig-webc__fn">
              <div className="krig-webc__fn-head">
                <span className="krig-webc__fn-name">scrollUntil</span>
                <span className="krig-webc__fn-sig">只滚不抓 · 连续 N 轮不动才算到底</span>
              </div>
              <div className="krig-webc__row">
                <select className="krig-webc__in" value={scrollKind}
                  onChange={(e) => setScrollKind(e.target.value)}>
                  <option value="rounds">rounds</option>
                  <option value="atBottom">atBottom</option>
                </select>
                {scrollKind === 'rounds' && (
                  <input className="krig-webc__in" style={{ width: 70 }} value={scrollN}
                    onChange={(e) => setScrollN(e.target.value)} placeholder="轮数" />
                )}
                <input className="krig-webc__in" style={{ width: 110 }} value={scrollStuck}
                  onChange={(e) => setScrollStuck(e.target.value)} placeholder="stuckRounds" />
                <button type="button" className="krig-webc__go" disabled={busy !== null}
                  onClick={() => {
                    const stop = scrollKind === 'rounds'
                      ? { kind: 'rounds', n: Number(scrollN) }
                      : { kind: 'atBottom' };
                    const options = { stuckRounds: Number(scrollStuck) };
                    void run('scrollUntil', { stop, options },
                      () => api()!.scrollUntil(wcId(), stop, options));
                  }}>执行</button>
              </div>
              <div className="krig-webc__note">⭐ 跑的时候看左边 —— 页面真的在滚才算数</div>
            </div>

            {/* tap */}
            <div className="krig-webc__fn">
              <div className="krig-webc__fn-head">
                <span className="krig-webc__fn-name">tap</span>
                <span className="krig-webc__fn-sig">点一个锚点 · settled 没给 settle 时恒 false</span>
              </div>
              <div className="krig-webc__row">
                <AnchorSelect value={tapAnchor} onChange={setTapAnchor} names={anchorNames} />
                <button type="button" className="krig-webc__go" disabled={busy !== null}
                  onClick={() => void run('tap', { anchor: tapAnchor },
                    () => api()!.tap(wcId(), tapAnchor))}>执行</button>
              </div>
              <div className="krig-webc__note">
                ⚠️ 左栏 tab 的真实 testid 只验证过 <code>nav.profile</code> 一个;
                其余去「输出」页点 readTabBar 从真页面读出来再补进锚点表。
              </div>
            </div>

            {/* press */}
            <div className="krig-webc__fn">
              <div className="krig-webc__fn-head">
                <span className="krig-webc__fn-name">press</span>
                <span className="krig-webc__fn-sig">按键 · 底座不解释语义</span>
              </div>
              <div className="krig-webc__row">
                <input className="krig-webc__in" style={{ flex: 1 }} value={pressKey}
                  onChange={(e) => setPressKey(e.target.value)} placeholder="Escape / Enter" />
                <button type="button" className="krig-webc__go" disabled={busy !== null}
                  onClick={() => void run('press', { key: pressKey },
                    () => api()!.press(wcId(), pressKey))}>执行</button>
              </div>
            </div>
          </>
        )}

        {tab === 'input' && (
          <div className="krig-webc__fn">
            <div className="krig-webc__fn-head">
              <span className="krig-webc__fn-name">type</span>
              <span className="krig-webc__fn-sig">往锚点填文本 + 落地确认</span>
            </div>
            <div className="krig-webc__row">
              <AnchorSelect value={typeAnchor} onChange={setTypeAnchor} names={anchorNames} />
              <select className="krig-webc__in" value={typeCheck}
                onChange={(e) => setTypeCheck(e.target.value)}>
                <option value="contains">check: contains</option>
                <option value="exact">check: exact</option>
                <option value="none">check: none</option>
              </select>
            </div>
            <div className="krig-webc__row">
              <input className="krig-webc__in" style={{ flex: 1 }} value={typeText}
                onChange={(e) => setTypeText(e.target.value)} placeholder="要填的文本" />
              <button type="button" className="krig-webc__go" disabled={busy !== null}
                onClick={() => {
                  const check = typeCheck === 'contains'
                    ? { kind: 'contains', fragment: typeText.slice(0, 8) }
                    : { kind: typeCheck };
                  void run('type', { anchor: typeAnchor, text: typeText, check },
                    () => api()!.type(wcId(), typeAnchor, typeText, check));
                }}>执行</button>
            </div>
            <div className="krig-webc__note">
              ⭐ 人验的关键:<b>面板说 landed:true + 屏幕上框是空的 = 当场抓到</b>。
              <br />⚠️ <code>check: none</code> 时 <code>landed</code> 恒 false —— 没校验就不能说落地了。
              <br />🚦 本通道只填不发,不会点发布按钮。
            </div>
          </div>
        )}

        {tab === 'output' && (
          <>
            <div className="krig-webc__fn">
              <div className="krig-webc__fn-head">
                <span className="krig-webc__fn-name">pages</span>
                <span className="krig-webc__fn-sig">页面清单 · 对照屏幕数行数</span>
              </div>
              <div className="krig-webc__row">
                <button type="button" className="krig-webc__go"
                  onClick={() => void run('pages', {}, async () => {
                    const r = await api()?.pages(); setPages(r); return r;
                  })}>刷新</button>
                <span className="krig-webc__note" style={{ margin: 0 }}>
                  多一行 = 幽灵页面;少一行 = 有页面没接线
                </span>
              </div>
              <pre className="krig-webc__pre">{JSON.stringify(pages, null, 2)}</pre>
            </div>

            <div className="krig-webc__fn">
              <div className="krig-webc__fn-head">
                <span className="krig-webc__fn-name">anchors</span>
                <span className="krig-webc__fn-sig">已注册锚点表(owner)</span>
              </div>
              <div className="krig-webc__row">
                <button type="button" className="krig-webc__go"
                  onClick={() => void run('anchors', {}, async () => {
                    const r = await api()?.anchors(); setAnchors(r); return r;
                  })}>刷新</button>
                <span className="krig-webc__note" style={{ margin: 0 }}>
                  已注册 owner:{anchorOwners.length ? anchorOwners.join(' / ') : '(空 —— 业务没推表进来)'}　锚点 {anchorNames.length} 个
                </span>
              </div>
            </div>

            <div className="krig-webc__fn">
              <div className="krig-webc__fn-head">
                <span className="krig-webc__fn-name">readTabBar</span>
                <span className="krig-webc__fn-sig">从真页面读 X 左栏 tab 的 testid</span>
              </div>
              <div className="krig-webc__row">
                <button type="button" className="krig-webc__go" disabled={busy !== null}
                  onClick={() => void run('readTabBar', {}, async () => {
                    const r = await api()?.readTabBar(wcId()); setTabBar(r); return r;
                  })}>读取</button>
                <span className="krig-webc__note" style={{ margin: 0 }}>
                  ⭐ 先看见事实,再写进锚点表 —— 不猜 selector
                </span>
              </div>
              <pre className="krig-webc__pre">{JSON.stringify(tabBar, null, 2)}</pre>
            </div>
          </>
        )}

        {tab === 'exec' && (
          <>
            <div className="krig-webc__fn">
              <div className="krig-webc__fn-head">
                <span className="krig-webc__fn-name">inventory</span>
                <span className="krig-webc__fn-sig">卷宗盘点 · 附件实际能取到多少</span>
              </div>
              <div className="krig-webc__row">
                <button type="button" className="krig-webc__go" disabled={busy !== null}
                  onClick={() => void run('inventory', {}, async () => {
                    const r = await api()?.inventory(); setInv(r); return r;
                  })}>盘点</button>
                <span className="krig-webc__note" style={{ margin: 0, flex: 1 }}>
                  ⭐ 只读不写 —— 随便点,不动你的数据
                </span>
              </div>
              <div className="krig-webc__note">
                ⭐ 回答的是「<b>卷宗能有多厚</b>」:bio / 上下文 / 会话串
                各自**实际**能取到多少,而不是靠读代码推断。
                <br />⚠️ 覆盖率的分母是**见过的作者数**(不是 x_author 行数 ——
                那张表只在「对某人动过作」时才建行,拿它当分母覆盖率会虚高)。
                <br />⚠️ X 库没初始化时会**照实报错**,不返回一堆 0 假装「库是空的」。
              </div>
              {(() => {
                const r = inv as { inventory?: { tweets: number; authorsSeen: number;
                  attachments: Array<{ name: string; have: number; total: number; rate: number; note: string }> };
                  error?: string } | null;
                if (!r) return null;
                if (r.error) return <pre className="krig-webc__pre">{r.error}</pre>;
                const d = r.inventory;
                if (!d) return null;
                return (
                  <div style={{ marginTop: 6 }}>
                    <div className="krig-webc__note" style={{ margin: '0 0 4px' }}>
                      推文 <b>{d.tweets}</b> 条 · 见过作者 <b>{d.authorsSeen}</b> 人
                    </div>
                    {d.attachments.map((a) => (
                      <div className="krig-webc__row" key={a.name}>
                        <span className="krig-webc__note" style={{ margin: 0, width: 140, flexShrink: 0 }}>
                          {a.have === 0 ? '⚠️' : '✓'} {a.name}
                        </span>
                        <span className="krig-webc__note" style={{ margin: 0, width: 92, flexShrink: 0 }}>
                          {a.have}/{a.total}
                        </span>
                        <span className="krig-webc__note" style={{ margin: 0, width: 52, flexShrink: 0 }}>
                          {(a.rate * 100).toFixed(0)}%
                        </span>
                        <span className="krig-webc__note" style={{ margin: 0, flex: 1 }}>{a.note}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            <div className="krig-webc__fn">
              <div className="krig-webc__fn-head">
                <span className="krig-webc__fn-name">execute</span>
                <span className="krig-webc__fn-sig">判据 + 素材 → 一次判断(三态)</span>
              </div>

              <div className="krig-webc__row">
                <input className="krig-webc__in" style={{ flex: 1 }} value={execModel}
                  onChange={(e) => setExecModel(e.target.value)} placeholder="模型名(如 gemma4:26b-a4b-it-qat)" />
                <label className="krig-webc__note" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={execStructured}
                    onChange={(e) => setExecStructured(e.target.checked)} />
                  要 JSON
                </label>
              </div>

              <div className="krig-webc__row">
                <textarea className="krig-webc__in" style={{ flex: 1, minHeight: 60 }}
                  value={execInstruction} onChange={(e) => setExecInstruction(e.target.value)}
                  placeholder="判据:要它判什么、按什么标准" />
              </div>

              <div className="krig-webc__row">
                <textarea className="krig-webc__in" style={{ flex: 1, minHeight: 50 }}
                  value={execContent} onChange={(e) => setExecContent(e.target.value)}
                  placeholder="主体:判的就是它(如推文正文)" />
              </div>

              {/* ── 卷宗附件:名字自己填,留空 = 没取到 → 进 missing ── */}
              <div className="krig-webc__note" style={{ marginBottom: 4 }}>
                <b>附件</b>(种类**不写死** —— 名字自己填;内容留空 = 没取到,会进 <code>missing</code>)
              </div>
              {atts.map((a, i) => (
                <div className="krig-webc__row" key={i}>
                  <span className="krig-webc__note" style={{ margin: 0, width: 18, flexShrink: 0 }}>
                    {a.value.trim() ? '✓' : '⚠️'}
                  </span>
                  <input className="krig-webc__in" style={{ width: 110, flexShrink: 0 }}
                    value={a.name} placeholder="附件名"
                    onChange={(e) => setAtts(atts.map((x, j) =>
                      j === i ? { ...x, name: e.target.value } : x))} />
                  <input className="krig-webc__in" style={{ flex: 1 }}
                    value={a.value} placeholder="取到的内容(留空=没取到)"
                    onChange={(e) => setAtts(atts.map((x, j) =>
                      j === i ? { ...x, value: e.target.value } : x))} />
                  <button type="button" className="krig-webc__clear"
                    onClick={() => setAtts(atts.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
              <div className="krig-webc__row">
                <button type="button" className="krig-webc__clear"
                  onClick={() => setAtts([...atts, { name: '', value: '' }])}>+ 加一项附件</button>
              </div>

              {/* ⭐ 跑之前就把「缺几项」摆出来,不是跑完才发现依据不足 */}
              <div className="krig-webc__note">
                {(() => {
                  const named = atts.filter((a) => a.name.trim());
                  const miss = named.filter((a) => !a.value.trim()).map((a) => a.name.trim());
                  if (named.length === 0) return <span>还没有附件 —— 模型只看得见主体</span>;
                  return miss.length === 0
                    ? <span>✓ {named.length} 项附件齐全 → 结果应为 <code>ok</code></span>
                    : <span>⚠️ {named.length} 项附件缺 {miss.length} 项({miss.join('、')})
                        → 结果应为 <code>degraded</code>,模型判断依据不足</span>;
                })()}
              </div>

              <div className="krig-webc__row">
                <button type="button" className="krig-webc__go" disabled={busy !== null}
                  onClick={() => void run('execute',
                    { model: execModel, structured: execStructured },
                    () => {
                      // ⭐ 只把**取到了**的放进 attachments;空的进 missing。
                      //    绝不塞空串占位 —— 那会让模型以为「查过了,是空的」,
                      //    而事实是「压根没查到」,两者结论方向相反。
                      const attachments: Record<string, unknown> = {};
                      const missing: string[] = [];
                      for (const a of atts) {
                        const n = a.name.trim();
                        if (!n) continue;                       // 没名字的行直接跳过
                        if (a.value.trim()) attachments[n] = a.value.trim();
                        else missing.push(n);
                      }
                      return api()!.execute({
                        model: execModel,
                        instruction: execInstruction,
                        content: execContent,
                        attachments, missing,
                        structured: execStructured,
                      });
                    })}>执行</button>
              </div>

              <div className="krig-webc__note">
                ⭐ 第四类能力:对象是**模型**,不是页面 —— 所以这里没有 wcId,
                跑它**不需要**先打开什么页面。
                <br />⭐ 执行者**不写库**,在这里随便跑都不会动你的数据
                (这正是它与 <code>judgeWithOllama</code> 的分界:后者一跑就改 x_tweet)。
                <br />⚠️ 「模型说不该回」是 <code>ok</code> 不是 <code>failed</code> ——
                前者是「判了,结论是否定」,后者是「根本没跑起来」,处置完全相反。
                <br />⚠️ 判据与素材都由**这里给**:换成「判断这条推该不该点赞」
                就是另一种判断,<b>执行者一个字都不用改</b>。
              </div>
            </div>
          </>
        )}

        {tab === 'verify' && (
          <>
            <div className="krig-webc__fn">
              <div className="krig-webc__fn-head">
                <span className="krig-webc__fn-name">无人工采集</span>
                <span className="krig-webc__fn-sig">导航 + 滚动 + 解析载荷 + 入库 —— 不用你点</span>
              </div>
              <div className="krig-webc__row">
                <select className="krig-webc__in" style={{ flex: 1 }} value={acPage}
                  onChange={(e) => setAcPage(e.target.value)}>
                  {(pageNames.length > 0 ? pageNames : ['x.home']).map((n) =>
                    <option key={n} value={n}>{n}</option>)}
                </select>
                <input className="krig-webc__in" style={{ width: 72 }} value={acRounds}
                  onChange={(e) => setAcRounds(e.target.value)} placeholder="轮数" title="滚动轮数上限" />
                <input className="krig-webc__in" style={{ width: 72 }} value={acBudget}
                  onChange={(e) => setAcBudget(e.target.value)} placeholder="秒" title="时间预算(秒)" />
                <button type="button" className="krig-webc__go" disabled={busy !== null}
                  onClick={() => void run('autoCollect', { page: acPage, maxRounds: Number(acRounds), budgetSec: Number(acBudget) },
                    async () => {
                      const r = await api()?.autoCollect({
                        page: acPage, wcId: wcId(),
                        maxRounds: Number(acRounds) || 30,
                        budgetMs: (Number(acBudget) || 120) * 1000,
                        wsId: workspaceId,
                      });
                      setAcReport(r); return r;
                    })}>采集</button>
              </div>
              {(() => {
                const r = acReport as { report?: {
                  tweets: number; fromPayload: number; saved: number;
                  authorsWithRelation: number; payloads: number;
                  problems: string[]; stopReason: string; elapsedMs: number;
                  coverage?: Array<{ field: string; have: number; total: number; rate: number }>;
                  sample?: Array<{ tweetId: string; handle?: string; missing: string[]; fromDom: boolean }>;
                }; error?: string } | null;
                if (!r) return null;
                if (r.error) return <pre className="krig-webc__pre">{r.error}</pre>;
                const d = r.report;
                if (!d) return null;
                return (
                  <div className="krig-webc__note" style={{ lineHeight: 1.9 }}>
                    <div>采到 <b>{d.tweets}</b> 条 · 其中载荷来源 <b>{d.fromPayload}</b> 条 ·
                      入库 <b>{d.saved}</b> 条 · 载荷 <b>{d.payloads}</b> 个 · {(d.elapsedMs / 1000).toFixed(1)}s</div>
                    <div>⭐ <b>采到关系数据的作者:{d.authorsWithRelation} 人</b>
                      {d.authorsWithRelation > 0
                        ? ' —— 不用点击就拿到了'
                        : ' —— 一个都没有,载荷里可能没带关系字段'}</div>
                    <div>停止原因:{d.stopReason}
                      {d.problems.length > 0 && <> · ⚠️ {d.problems.join('、')}</>}</div>

                    {/**
                      * ⭐⭐ 字段级覆盖率 —— 用户 2026-09-18:
                      * 「我关注的是采集数据的完整性,每一条数据都是完整的吗?」
                      * ⚠️ 总数不等于完整:77 条里可能条条缺字段,而「采到 77 条」照样好看。
                      */}
                    {(d.coverage?.length ?? 0) > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <div><b>字段完整性</b>(分母按字段种类算,不是一律用总条数)</div>
                        {d.coverage!.map((c) => (
                          <div className="krig-webc__row" key={c.field}>
                            <span className="krig-webc__note" style={{ margin: 0, width: 170, flexShrink: 0 }}>
                              {c.total === 0 ? '·' : c.rate === 1 ? '✓' : c.rate >= 0.9 ? '⚠️' : '✗'} {c.field}
                            </span>
                            <span className="krig-webc__note" style={{ margin: 0, width: 90, flexShrink: 0 }}>
                              {c.have}{c.total > 0 ? `/${c.total}` : ''}
                            </span>
                            <span className="krig-webc__note" style={{ margin: 0, flex: 1 }}>
                              {c.total === 0
                                ? '(条件字段,不算覆盖率 —— 不是回复本来就没有)'
                                : `${(c.rate * 100).toFixed(0)}%`}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* ⭐ 逐条明细 —— 人要能逐条检查,不是只看百分比 */}
                    {(d.sample?.length ?? 0) > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <div><b>逐条检查</b>(前 {d.sample!.length} 条 ·
                          完整 {d.sample!.filter((x) => x.missing.length === 0).length} 条 ·
                          有缺 {d.sample!.filter((x) => x.missing.length > 0).length} 条)</div>
                        {d.sample!.map((x) => (
                          <div className="krig-webc__row" key={x.tweetId}>
                            <span className="krig-webc__note" style={{ margin: 0, width: 24, flexShrink: 0 }}>
                              {x.missing.length === 0 ? '✓' : '⚠️'}
                            </span>
                            <span className="krig-webc__note" style={{ margin: 0, width: 130, flexShrink: 0 }}>
                              @{x.handle ?? '?'}
                            </span>
                            <span className="krig-webc__note" style={{ margin: 0, width: 54, flexShrink: 0 }}>
                              {x.fromDom ? 'DOM' : '载荷'}
                            </span>
                            <span className="krig-webc__note" style={{ margin: 0, flex: 1 }}>
                              {x.missing.length === 0 ? '完整' : `缺:${x.missing.join('、')}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
              <div className="krig-webc__note">
                ⚠️ <b>导航是必须的</b> —— 关系/蓝V 在载荷里就有,但**要有新请求**才截得到;
                页面早已渲染好的推不会重新请求(实测:悬停弹卡片零网络请求)。
                <br />⭐ 滚动轮数是**参数不是常量**;采集层**无条件全收**,不在这里过滤。
              </div>
            </div>

            <div className="krig-webc__fn">
              <div className="krig-webc__fn-head">
                <span className="krig-webc__fn-name">采集验证</span>
                <span className="krig-webc__fn-sig">左边操作 X · 右边列出采到的一切</span>
              </div>
              <div className="krig-webc__row">
                <button type="button" className="krig-webc__go" disabled={busy !== null}
                  onClick={() => void run(capOn ? 'captureStop' : 'captureStart', {}, async () => {
                    const r = capOn ? await xapi()?.captureStop() : await xapi()?.captureStart(wcId());
                    setCapOn(!capOn);
                    return r;
                  })}>{capOn ? '停止监测' : '开始监测'}</button>
                <span className="krig-webc__note" style={{ margin: 0, flex: 1 }}>
                  {capSnap?.running
                    ? `● 监测中 · 屏幕上 ${capSnap.onScreenCount ?? 0} 条 · 累计 ${capSnap.captured ?? 0} · 载荷 ${capSnap.payloads ?? 0}`
                    : '未开始 —— 点「开始监测」后在左边正常浏览 X'}
                </span>
              </div>

              {/**
                * ⭐⭐ 操作流 × 载荷 —— **按时间交织**,因果一眼可见。
                *
                * ── 用户 2026-09-18 ──
                * > 「我建议你在后台也能够观察到我在 x 上的操作以及操作结果才对呀。
                * >   否则那叫什么数据采集?」
                *
                * ⚠️ 此前监视器完全不知道用户做了什么,于是每次都只能回头问
                * 「你点了吗」「有没有反应」—— 那正是「靠口头描述」的复发。
                *
                * ⭐ 交织显示的价值:「悬停头像 → 后面没有任何请求」
                * 才**证明得了**「数据本来就在本地」,而不是停留在推测。
                */}
              {capSnap?.running && ((capSnap.actions?.length ?? 0) > 0
                || (capSnap.rawPayloads?.length ?? 0) > 0) && (
                <div className="krig-webc__fn" style={{ marginTop: 6 }}>
                  <div className="krig-webc__fn-head">
                    <span className="krig-webc__fn-name">你的操作 × 网络请求</span>
                    <span className="krig-webc__fn-sig">按时间交织 —— 哪个动作触发了请求,一眼看见</span>
                  </div>
                  {(() => {
                    type Row = { t: number; kind: string; text: string };
                    const rows: Row[] = [
                      ...(capSnap.actions ?? []).map((a) => ({
                        t: a.t, kind: a.kind, text: a.detail,
                      })),
                      ...(capSnap.rawPayloads ?? []).map((r) => ({
                        t: r.at, kind: 'payload',
                        text: `${r.op} · ${(r.bytes / 1024).toFixed(0)}KB`,
                      })),
                    ].sort((a, b) => b.t - a.t).slice(0, 30);

                    if (rows.length === 0) {
                      return <div className="krig-webc__note">
                        还没有记录到操作 —— 在左边点一下、悬停一下试试
                      </div>;
                    }
                    const icon: Record<string, string> = {
                      click: '👆', hover: '🖱', scroll: '↕', payload: '📦',
                    };
                    return rows.map((r, i) => (
                      <div className="krig-webc__row" key={`${r.t}-${i}`}>
                        <span className="krig-webc__note" style={{ margin: 0, width: 62, flexShrink: 0 }}>
                          {new Date(r.t).toLocaleTimeString('zh-CN')}
                        </span>
                        <span className="krig-webc__note" style={{ margin: 0, width: 26, flexShrink: 0 }}>
                          {icon[r.kind] ?? '·'}
                        </span>
                        <span className="krig-webc__note" style={{
                          margin: 0, flex: 1,
                          color: r.kind === 'payload' ? 'var(--accent, #6af)' : undefined,
                          fontWeight: r.kind === 'payload' ? 600 : undefined,
                        }}>
                          {r.kind === 'payload' ? `载荷 ${r.text}` : r.text}
                        </span>
                      </div>
                    ));
                  })()}
                </div>
              )}

              {/**
                * ⭐⭐ 悬浮卡白拿的画像 —— 用户 2026-09-18 的洞察:
                * 「关键这里还有 bio 数据呀?这样就不一定逐个翻页就可以获取 bio 数据了。」
                */}
              {Object.keys(capSnap?.hoverProfiles ?? {}).length > 0 && (
                <div className="krig-webc__fn" style={{ marginTop: 6 }}>
                  <div className="krig-webc__fn-head">
                    <span className="krig-webc__fn-name">悬浮卡画像</span>
                    <span className="krig-webc__fn-sig">
                      白拿的 bio / 粉丝数 / 关注状态 —— 零网络请求,不用逐个翻主页
                    </span>
                  </div>
                  {Object.entries(capSnap!.hoverProfiles!).map(([h, p]) => (
                    <div key={h} style={{ marginBottom: 8 }}>
                      <div className="krig-webc__row">
                        <span className="krig-webc__note" style={{ margin: 0, width: 150, flexShrink: 0 }}>
                          <b>@{h}</b>
                        </span>
                        <span className="krig-webc__note" style={{ margin: 0, flex: 1 }}>
                          {p.iFollow ? '✓ 我已关注' : '· 未关注'}
                          {p.isBlueVerified ? ' · 蓝V' : ''}
                          {p.restId ? ` · id=${String(p.restId)}` : ''}
                          {p.followingText ? ` · 关注 ${String(p.followingText)}` : ''}
                          {p.followersText ? ` · 粉丝 ${String(p.followersText)}` : ''}
                        </span>
                      </div>
                      <div className="krig-webc__row">
                        <span className="krig-webc__note" style={{ margin: 0, width: 150, flexShrink: 0 }}>
                          {p.bio ? '✓ bio' : '⚠️ bio'}
                        </span>
                        <span className="krig-webc__note" style={{ margin: 0, flex: 1 }}>
                          {p.bio ? String(p.bio).slice(0, 200) : '— (没解出来,看下面 rawHtml)'}
                        </span>
                      </div>
                      {!p.bio && typeof p.rawHtml === 'string' && (
                        <pre className="krig-webc__pre" style={{ maxHeight: 150, overflow: 'auto' }}>
                          {String(p.rawHtml)}
                        </pre>
                      )}
                    </div>
                  ))}
                  <div className="krig-webc__note">
                    ⭐ 一张卡 ≈ 一次「抓画像」,而后者要**导航到那人主页 + 等 12 秒**。
                    盘点里 bio 只有 <b>155/8021(2%)</b>,正是因为那条路太贵。
                    <br />⚠️ 卡片 DOM 结构仓里零记录,所以解不出来时**把 rawHtml 摆出来** ——
                    量不准时能当场看清该怎么改,不用猜。
                  </div>
                </div>
              )}

              {/**
                * ⭐⭐ 载荷为 0 时**说清是哪一环断的** —— 这是「载荷 0」唯一有用的诊断。
                *
                * ⚠️ 此前 CDP 状态只进 console.log,用户看不见、我也读不到,
                * 只能靠猜。用户定过:「在后台能 log 这些操作,而不是靠我口头描述」。
                */}
              {capSnap?.running && (capSnap.payloads ?? 0) === 0 && (
                <div className="krig-webc__note" style={{ lineHeight: 1.9 }}>
                  <div>⚠️ <b>一条载荷都没截到</b> —— 分三种,现在能分清:</div>
                  <div>· CDP 通道:<b>{capSnap.cdpNote ?? '(未知)'}</b></div>
                  <div>· 见过的 graphql 请求:<b>{capSnap.graphqlSeen ?? 0}</b> 条</div>
                  <div>
                    {(capSnap.graphqlSeen ?? 0) === 0
                      ? <>→ <b>页面压根没发新请求</b>。
                          <br />⭐ 这本身就是一个发现:<b>悬停弹卡片没有伴随任何网络请求</b>,
                          说明那些关注关系数据**本来就在前端内存里** —— 是更早的时间线载荷带来的。
                          <br />⚠️ 而那次载荷发生在**监测开始之前**,所以我们没截到。
                          <br /><b>要验证:点一下「Following」再点回「For you」</b> ——
                          那会让 X 重新拉一次时间线,我们就能截到完整载荷,
                          当场看清关系字段在不在里面。
                          <br />(单纯往下滚可能只用缓存,不一定发新请求)</>
                      : <>→ 请求发生了但 <b>body 取不到</b>(响应体可能已被丢弃)——
                          这是 CDP 侧的问题,我去查。</>}
                  </div>
                </div>
              )}

              <div className="krig-webc__row" style={{ display: 'none' }}>
              </div>
              <div className="krig-webc__row">
                <button type="button" className="krig-webc__go" disabled={busy !== null}
                  onClick={() => void run('probeMemory', {}, async () => {
                    const r = await api()?.probeMemory(wcId()); setMemProbe(r); return r;
                  })}>探内存里的 user 数据</button>
                <span className="krig-webc__note" style={{ margin: 0, flex: 1 }}>
                  ⭐ 磁盘已排除(IndexedDB 只存 UI 偏好、Cache 里 API 响应 no-store)——
                  数据在页面 JS 内存里
                </span>
              </div>
              {memProbe != null && (
                <pre className="krig-webc__pre" style={{ maxHeight: 300, overflow: 'auto' }}>
                  {JSON.stringify(memProbe, null, 2)}
                </pre>
              )}

              <div className="krig-webc__row">
                <button type="button" className="krig-webc__clear" disabled={busy !== null}
                  onClick={() => void run('readVerified', {}, async () => {
                    const r = await api()?.readVerified(wcId()); setVBadge(r); return r;
                  })}>量一下蓝V结构</button>
                <span className="krig-webc__note" style={{ margin: 0, flex: 1 }}>
                  ⚠️ 蓝V的 selector 全仓没有实测记录 —— <b>量出来再写</b>,不猜
                </span>
              </div>
              {vBadge != null && (
                <pre className="krig-webc__pre" style={{ maxHeight: 260, overflow: 'auto' }}>
                  {JSON.stringify(vBadge, null, 2)}
                </pre>
              )}

              <div className="krig-webc__note">
                ⭐ <b>你核对的是「漏没漏」</b>:左边页面上看得见的东西,右边是不是都列出来了。
                <br />⚠️ <b>空字段也列出来并标 ⚠️</b> —— 只显示有值的,就看不出少了什么。
                <br />⭐ 说「这个数据明明有」时,展开<b>原始载荷</b>当场分清:
                是 X 压根没返回,还是返回了但我们没解出来 —— 两者修法完全相反。
              </div>
            </div>

            {(capSnap?.recent ?? []).map((t, i) => (
              <div className="krig-webc__fn" key={String(t.tweetId ?? i)}>
                <div className="krig-webc__fn-head">
                  <span className="krig-webc__fn-name">{String(t.tweetId ?? '(无 id)')}</span>
                  <span className="krig-webc__fn-sig">
                    {String(t.authorHandle ?? '?')} · {t.fromDom ? 'DOM 兜底' : '载荷'}
                  </span>
                </div>
                {VERIFY_FIELDS.map((f) => {
                  const v = t[f];
                  const empty = v === undefined || v === null || v === ''
                    || (Array.isArray(v) && v.length === 0);
                  return (
                    <div className="krig-webc__row" key={f}>
                      <span className="krig-webc__note" style={{ margin: 0, width: 150, flexShrink: 0 }}>
                        {empty ? '⚠️' : '✓'} {f}
                      </span>
                      <span className="krig-webc__note" style={{ margin: 0, flex: 1, wordBreak: 'break-all' }}>
                        {empty ? '—' : (typeof v === 'object' ? JSON.stringify(v) : String(v))}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}

            {(capSnap?.rawPayloads?.length ?? 0) > 0 && (
              <div className="krig-webc__fn">
                <div className="krig-webc__fn-head">
                  <span className="krig-webc__fn-name">原始载荷</span>
                  <span className="krig-webc__fn-sig">X 到底给了什么(最近 {capSnap!.rawPayloads!.length} 条)</span>
                </div>
                {/**
                  * ⭐⭐ 自动判读 —— **不用人输任何东西**。
                  *
                  * ⚠️ 初版做成「让你输字段名去搜」,那是把我该知道的事甩给用户:
                  * 用户怎么会知道该输 `relationship_perspectives`?
                  * 面板的职责是**直接给结论**,不是给个搜索框让人自己查。
                  */}
                <div className="krig-webc__note" style={{ lineHeight: 1.9 }}>
                  <div><b>截到的请求</b>:{
                    Array.from(new Set(capSnap!.rawPayloads!.map((r) => r.op))).join('、') || '(无)'
                  }</div>
                  {(() => {
                    const all = capSnap!.rawPayloads!;
                    const has = (k: string) => all.some((r) => r.body.includes(k));
                    const ops = new Set(all.map((r) => r.op));
                    const hoverOp = [...ops].some((o) => /UserByScreenName|UserByRestId/i.test(o));
                    const inTimeline = all
                      .filter((r) => /Timeline|UserTweets/i.test(r.op))
                      .some((r) => r.body.includes('relationship_perspectives')
                        || r.body.includes('"followed_by"'));

                    if (inTimeline) {
                      return <div>✓ <b>关注关系在时间线载荷里就有</b> —— 你的推断对,
                        数据早就打包下来了。<b>是我们没解出来</b>,我去修解析器。</div>;
                    }
                    if (hoverOp) {
                      return <div>✓ <b>悬停触发了独立请求</b>(UserByScreenName)——
                        而我们**已经把它截下来了**,只是解析器只认推文对象、把它整个跳过。
                        <b>数据在手里,只是没解。</b></div>;
                    }
                    if (has('relationship_perspectives') || has('"followed_by"')) {
                      return <div>✓ 关系字段出现在载荷里(但不在时间线里)—— 我去看是哪条请求带的。</div>;
                    }
                    return <div>⚠️ 最近 {all.length} 条载荷里<b>没有任何关系字段</b> ——
                      要么还没悬停过,要么 X 真没给。
                      <b>请把鼠标靠近一个头像让卡片弹出来</b>,然后再看这里。</div>;
                  })()}
                </div>
                {capSnap!.rawPayloads!.map((r, i) => (
                  <div key={`${r.at}-${i}`}>
                    <div className="krig-webc__row">
                      <button type="button" className="krig-webc__clear"
                        onClick={() => setRawOpen(rawOpen === i ? null : i)}>
                        {rawOpen === i ? '▾' : '▸'} {r.op}
                      </button>
                      <span className="krig-webc__note" style={{ margin: 0, flex: 1 }}>
                        {(r.bytes / 1024).toFixed(0)} KB
                      </span>
                    </div>
                    {rawOpen === i && (
                      <pre className="krig-webc__pre" style={{ maxHeight: 320, overflow: 'auto' }}>
                        {r.body}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── 调用记录:原样返回值 ── */}
        <div className="krig-webc__runs">
          <div className="krig-webc__runs-head">
            调用记录（最近 {runs.length}）
            {runs.length > 0 && (
              <button type="button" className="krig-webc__clear"
                onClick={() => setRuns([])}>清空</button>
            )}
          </div>
          {runs.length === 0 && (
            <div className="krig-webc__empty">还没跑过 —— 上面选一个函数点「执行」</div>
          )}
          {runs.map((r, i) => (
            <div key={`${r.at}-${i}`} className="krig-webc__run">
              <div className="krig-webc__run-head">
                <span className="krig-webc__run-fn">{r.fn}</span>
                <span>{r.at}</span>
                <span>{r.ms}ms</span>
              </div>
              <div className="krig-webc__run-label">入参</div>
              <pre className="krig-webc__pre">{JSON.stringify(r.input, null, 2)}</pre>
              <div className="krig-webc__run-label">返回值（原样）</div>
              <pre className="krig-webc__pre">{JSON.stringify(r.output, null, 2)}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
