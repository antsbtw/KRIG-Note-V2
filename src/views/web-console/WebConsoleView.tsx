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

type TabId = 'control' | 'input' | 'output';

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
