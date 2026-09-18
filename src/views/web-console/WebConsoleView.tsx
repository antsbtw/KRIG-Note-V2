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
  /**
   * ⚠️ 默认留空 —— 此前默认值是 `fang_danie121`,那是测「账号不存在」留下的残留。
   * 用户选了 x.profile 没改这个框就点采集,X 把他弹回首页,
   * 而采集**在首页上照跑不误**、报告一切正常。
   * ⭐ 空值会让语义页面表返回 null → 明确报错「参数不全」,比默认跳到坏账号好。
   */
  const [gotoHandle, setGotoHandle] = useState('');
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
  /**
   * ⚠️ 传**语义页面名**,不是 URL —— 守卫「面板不许构造 x.com URL」刚抓住我。
   * 那条规矩是对的:URL 是 adapter 的知识,站点改版只改 x-pages.ts 一处。
   * 下拉用的是**真表**(pageNames),不在这里抄一份。
   */
  const [acPage, setAcPage] = useState('x.home');
  const [acRounds, setAcRounds] = useState('30');
  const [acBudget, setAcBudget] = useState('120');
  const [acReport, setAcReport] = useState<unknown>(null);
  /**
   * ⭐⭐ 跟着左边走 —— 用户 2026-09-18:
   * 「点击左边时,右边自动填充变量,点击采集,即可采集。」
   *
   * ⚠️ 下拉与参数框**照样在**(编排时要用),只是值可以从当前页面自动来;
   * 填完看得见、能改 —— 不是黑盒。
   * ⚠️ 自动填充可关 —— 你想采别的页面时不该被一直覆盖回去。
   */
  const [acFollow, setAcFollow] = useState(true);
  const [acCurrent, setAcCurrent] = useState<{ url?: string; name?: string } | null>(null);
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

  /**
   * ⭐ 每 1.5s 问一次「左边在哪一页」,自动填充下拉与参数。
   * ⚠️ 只在跟随开着、且**不在跑**的时候填 —— 采集途中页面会变(它自己导航),
   * 那时覆盖输入框会让人以为自己选的被改掉了。
   */
  useEffect(() => {
    const timer = setInterval(() => {
      if (!acFollow || busy !== null) return;
      void (async () => {
        const r = await api()?.whereAmI(wcId());
        const page = r?.page ?? null;
        setAcCurrent({ url: r?.url, name: page?.name });
        if (!page) return;
        setAcPage(page.name);
        if (page.params.handle) setGotoHandle(page.params.handle);
        if (page.params.tweetId) setGotoTweetId(page.params.tweetId);
        if (page.params.q) setGotoQuery(page.params.q);
      })();
    }, 1500);
    return () => clearInterval(timer);
  }, [acFollow, busy]);

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
          { id: 'verify' as const, label: '采集', desc: '无人工采集:导航+滚动+解析载荷+入库,并报字段完整性' },
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
                <label className="krig-webc__note" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={acFollow}
                    onChange={(e) => setAcFollow(e.target.checked)} />
                  跟着左边走
                </label>
                <span className="krig-webc__note" style={{ margin: 0, flex: 1 }}>
                  {acCurrent?.name
                    ? <>左边现在在 <b>{acCurrent.name}</b> —— 下拉与参数已自动填好,点采集即可</>
                    : acCurrent?.url
                      ? <>⚠️ 认不出左边这个页面({String(acCurrent.url).slice(0, 60)})—— 请手动选</>
                      : '(还没读到左边的页面)'}
                </span>
              </div>
              <div className="krig-webc__row">
                <select className="krig-webc__in" style={{ flex: 1 }} value={acPage}
                  onChange={(e) => setAcPage(e.target.value)}>
                  {(pageNames.length > 0 ? pageNames : ['x.home']).map((n) =>
                    <option key={n} value={n}>{n}</option>)}
                </select>
                {/**
                  * ⭐ 带参数的页面要能填参数 —— 否则选了 x.profile 点采集会直接失败。
                  * ⚠️ 复用 goto 那块的 state(同一套语义页面表、同一套参数),
                  * 不另起一份:两份会漂,而漂的表现是「这边填了那边没生效」。
                  */}
                {/^x\.(profile|withReplies|articles)$/.test(acPage) && (
                  <input className="krig-webc__in" style={{ width: 150 }} value={gotoHandle}
                    onChange={(e) => setGotoHandle(e.target.value)} placeholder="handle" />
                )}
                {acPage === 'x.status' && (
                  <input className="krig-webc__in" style={{ width: 150 }} value={gotoTweetId}
                    onChange={(e) => setGotoTweetId(e.target.value)} placeholder="推文 id" />
                )}
                {acPage === 'x.search' && (
                  <input className="krig-webc__in" style={{ width: 150 }} value={gotoQuery}
                    onChange={(e) => setGotoQuery(e.target.value)} placeholder="搜索词" />
                )}
                <input className="krig-webc__in" style={{ width: 72 }} value={acRounds}
                  onChange={(e) => setAcRounds(e.target.value)} placeholder="轮数" title="滚动轮数上限" />
                <input className="krig-webc__in" style={{ width: 72 }} value={acBudget}
                  onChange={(e) => setAcBudget(e.target.value)} placeholder="秒" title="时间预算(秒)" />
                <button type="button" className="krig-webc__go" disabled={busy !== null}
                  onClick={() => void run('autoCollect', { page: acPage, maxRounds: Number(acRounds), budgetSec: Number(acBudget) },
                    async () => {
                      const params: Record<string, string> = {};
                      if (/^x\.(profile|withReplies|articles)$/.test(acPage)) params.handle = gotoHandle;
                      if (acPage === 'x.status') params.tweetId = gotoTweetId;
                      if (acPage === 'x.search') params.q = gotoQuery;
                      const r = await api()?.autoCollect({
                        page: acPage, params, wcId: wcId(),
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
                  longText?: { count: number; maxChars: number; avgChars: number };
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
                      * ⭐⭐ 浓缩成**结论**,不铺满屏 —— 用户 2026-09-18:
                      * 「这些数据是验证用的,但是对我来讲,我是要看到事实。」
                      *
                      * ⚠️ 此前把 19 个字段逐行列出(大部分是 100%),
                      * 真正有信息的那一两行被淹在里面。
                      * 全绿的只报一句,**只展开没到 100% 的**。
                      */}
                    {(d.coverage?.length ?? 0) > 0 && (() => {
                      const scored = d.coverage!.filter((c) => c.total > 0);
                      const gaps = scored.filter((c) => c.rate < 1);
                      const lt = d.longText;
                      return (
                        <div style={{ marginTop: 6 }}>
                          <div>
                            <b>字段完整性</b>:{scored.length - gaps.length}/{scored.length} 项 100%
                            {gaps.length === 0 && ' —— 全齐'}
                          </div>
                          {gaps.map((c) => (
                            <div key={c.field}>
                              ⚠️ <b>{c.field}</b> {c.have}/{c.total}({(c.rate * 100).toFixed(0)}%)
                            </div>
                          ))}
                          {lt && (
                            <div>
                              <b>长推(Show more)</b>:{lt.count} 条 ·
                              最长 <b>{lt.maxChars}</b> 字 · 平均 {lt.avgChars} 字
                              {lt.count > 0 && lt.maxChars <= 290
                                ? ' ⚠️ 最长只有 ~280 字,疑似被截断'
                                : lt.count > 0 ? ' ✓ 全文已取回' : ''}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* ⭐ 逐条明细 —— 人要能逐条检查,不是只看百分比 */}
                    {(d.sample?.length ?? 0) > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <div><b>逐条检查</b>(前 {d.sample!.length} 条 ·
                          完整 {d.sample!.filter((x) => x.missing.length === 0).length} 条 ·
                          有缺 {d.sample!.filter((x) => x.missing.length > 0).length} 条)
                          {/* ⚠️ 只列**有缺的** —— 全列会把真问题淹掉 */}</div>
                        {d.sample!.filter((x) => x.missing.length > 0).map((x) => (
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
                ⭐ <b>已经在目标页就不会跳转</b> —— 「确保在目标页」是流程里的**一个步骤**,
                不是两个流程(用户 2026-09-18 纠正)。你在左边点到谁的主页,
                选同一个页面点采集即可:不会重新加载、不会冲掉滚动位置、不白等 4.5 秒。
                <br />⚠️ 但**没有新载荷就采不到全字段** —— 关系/蓝V/bio 都在载荷里,
                而页面早已渲染好的推不会重新请求。在已加载的页面上采,
                主要靠**往下滚**触发新载荷(看报告里的「载荷 N 个」)。
                <br />⭐ 滚动轮数是**参数不是常量**;采集层**无条件全收**,不在这里过滤。
              </div>
            </div>

            {/**
              * ⚠️ 「采集验证」那一块已删(用户 2026-09-18:「先去掉这个框?没有意义了」)。
              *
              * 它的使命是**诊断采集通不通** —— 操作流、原始载荷、悬浮卡、内存探针,
              * 都是为了回答「数据在哪、为什么没采到」。那些问题现在有答案了:
              * 关系/蓝V/bio 都在时间线载荷里,autoCollect 一次全拿。
              *
              * ⭐ 诊断脚手架完成使命就该拆,留着只会占屏幕、让人以为还要用它。
              * 被动监视本身(startCaptureMonitor)保留在主侧,将来要用再接回来。
              */}
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
