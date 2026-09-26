/**
 * X 工作台 —— 采集 / 分析 / 回复的自动协作面板(第一版)
 *
 * ⭐ 用户 2026-09-15 定的三条:
 *  1. 名字「X 工作台」(比 X Task 宽:未来要容纳采集/分析/回复三件事)
 *  2. 布局**乙方案**:左任务、右详情 —— 盯人天然需要「一边列表一边对照」
 *  3. 底色线条与 X 统一(见 `x-workbench.css`,不改全局 token)
 *
 * ⚠️ **第一版只做三样**:任务列表 / 执行与进度 / 盯人对照。
 * 收件箱 5 切片、✎拟回复、人工标注**不搬** —— 顶栏「旧版」按钮切回去用。
 * 用户:「保留一个旧界面的切换 button,这样就不会中断原来的一些操作」。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { XExtractionApi } from '@capabilities/x-extraction';
import { normalizeHandle } from '@shared/types/x-timeline-types';
import './x-workbench.css';

const api = () => window.electronAPI?.xTimeline;

/** 载荷层补全后的推文(与 main 的 MonitorSnapshot.recent 同形) */
interface CapturedTweet {
  tweetId: string;
  authorHandle?: string;
  authorRestId?: string;
  text: string;
  createdAt?: string;
  lang?: string;
  isReply: boolean;
  inReplyToStatusId?: string;
  inReplyToScreenName?: string;
  conversationId?: string;
  quotedStatusId?: string;
  hasMedia: boolean;
  mediaTypes?: string[];
  isLongText: boolean;
  metrics: {
    likes?: number; retweets?: number; replies?: number;
    quotes?: number; bookmarks?: number; views?: number;
  };
  self: { favorited?: boolean; retweeted?: boolean; bookmarked?: boolean };
  fromDom: boolean;
}

interface CaptureSnap {
  running: boolean; onScreenCount: number; skippedAds: number;
  seenInDom: number; captured: number; captureRate: number;
  missing: string[]; payloads: number; elapsedSec: number;
  currentUrl?: string; scrollY?: number;
  recent: CapturedTweet[];
}

interface WatchProfile {
  handle: string;
  displayName?: string;
  bio?: string;
  location?: string;
  website?: string;
  isBlueVerified?: boolean;
  followersCount?: number;
  followingCount?: number;
  tweetCount?: number;
  iFollow?: boolean;
  followsMe?: boolean;
  blocking?: boolean;
  fetchedAt?: string;
}

type PaneId = 'watch' | 'tasks' | 'facts' | 'review';

/**
 * 一条草稿 —— 与 `x_reply_draft` 对应。
 * ⭐ 带 `context_snapshot`:点评时要能看到「AI 当时看到的是什么」,
 * 否则人只凭正文判断,与模型当时的处境不同 —— 那样的点评不公平。
 */
interface DraftRow {
  tweet_id: string;
  tweet_text?: string;
  author_handle?: string;
  ai_text?: string;
  ai_reason?: string;
  status?: string;
  source?: string;
  user_edit_diff?: string;
  review_note?: string;
  review_count?: number;
  reviewed_at?: string;
  created_at?: string;
  context_snapshot?: Record<string, unknown>;
}

/** 产品事实清单 —— 与 `x_product_facts` 一一对应 */
interface ProductFactsView {
  productName: string;
  direction: string;
  trial: string;
  platforms: string;
  accountSharing: string;
  paymentNote: string;
  forbidden: string[];
  updatedAt?: string;
  /** ⭐ 'default' = 还没设过,用的是代码默认值 */
  source?: 'db' | 'default';
}

/** 清单里每一项的说明 —— ⚠️ 写清楚「这会进 prompt 的哪里」,别让人猜 */
const FACT_FIELDS: Array<{
  key: keyof ProductFactsView; label: string; hint: string; multiline?: boolean;
}> = [
  { key: 'productName', label: '产品名', hint: '进 prompt 第一行。留空模型会自己脑补一个名字' },
  { key: 'direction', label: '服务方向', hint: '⚠️ 双向都要写。只写一边会让 AI 答不到点上（实测：希腊看英超那条因为不知道有英国节点，只能泛泛推销）', multiline: true },
  { key: 'trial', label: '试用', hint: '如「注册即得 7 天 10GB 测试流量」' },
  { key: 'platforms', label: '支持平台', hint: '如「iOS / Android / macOS / Windows / Google TV」' },
  { key: 'accountSharing', label: '账号共享', hint: '如「一个账号可多客户端共享」' },
  { key: 'paymentNote', label: '支付方式', hint: '⭐ 写清楚**不支持**什么。实测 AI 会主动先说不支持微信支付，这正是模板做不到的' },
];

/** 面板上的一步 —— ⚠️ 形状跟着 FlowProgress 走,面板不自己拼一份 */
interface FlowStepView {
  seq: number;
  stepId: string;
  label: string;
  status: 'idle' | 'running' | 'ok' | 'failed' | 'skipped';
  produced?: number;
  note?: string;
  error?: string;
  elapsedMs?: number;
  /** 这一步开始的时刻 —— 用来算「已经跑了多久」 */
  startedAt?: number;
}

export function XWorkbenchView({ workspaceId }: { workspaceId: string }) {
  const [pane, setPane] = useState<PaneId>('watch');
  const [msg, setMsg] = useState('');

  /**
   * ── 编排执行(用户 2026-09-24 的分层:编排=定义,工作台=执行与观察)──
   *
   * ⚠️ 这里**只执行与观察**,不编辑编排档 —— 改步骤顺序/参数是「编排视图」的事。
   * ⭐ 分开的好处:将来编排视图升级成画布,这里**完全不用动**
   *   (它只读 flow_run,不关心档是怎么画出来的)。
   */
  const [flowSteps, setFlowSteps] = useState<FlowStepView[]>([]);
  const [flowRunning, setFlowRunning] = useState(false);
  const [flowMsg, setFlowMsg] = useState('');
  /** ⭐ 正在跑的那一步从什么时候开始 —— 用来显示「已经跑了 N 秒」 */
  const [tickAt, setTickAt] = useState(0);

  /**
   * ── 草稿点评(用户 2026-09-26)──
   * > 「后期用户可以对已经发送的数据继续点评纠正，这样迭代工作。」
   *
   * ⚠️ 所以这里**不限 pending** —— 已填入/已否决的照样列出来,
   * 否则「回头改点评」根本无从下手。
   */
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [draftMsg, setDraftMsg] = useState('');
  /** 正在写的点评:tweetId → 文字 */
  const [notes, setNotes] = useState<Record<string, string>>({});

  /**
   * ── 产品事实清单(用户 2026-09-26)──
   * > 「这个需要增加，而且产品描述给好格式，我要及时更新的。」
   *
   * ⚠️ 原来写死在 `x-reply-facts.ts`,改一次要重新编译打包。
   * ⭐ 这里改完**当场生效**:拟回复每次都从库里读。
   */
  const [facts, setFacts] = useState<ProductFactsView | null>(null);
  const [factsDirty, setFactsDirty] = useState(false);
  const [factsMsg, setFactsMsg] = useState('');
  const [savingFacts, setSavingFacts] = useState(false);

  /** 载入草稿 —— ⚠️ 不限 status,已处置的也要看得到 */
  const loadDrafts = async () => {
    const r = await api()?.listDrafts?.(workspaceId, 'all', 50);
    if (!r?.success) { setDraftMsg(`读取失败：${r?.error ?? '未知'}`); return; }
    const rows = (r.drafts ?? []) as unknown as DraftRow[];
    setDrafts(rows);
    setDraftMsg(rows.length === 0
      ? '这个工作区还没有落库的草稿 —— 跑一次编排的「拟回复」就会有'
      : `共 ${rows.length} 条（已点评 ${rows.filter((d) => d.review_count).length} 条）`);
  };

  useEffect(() => {
    if (pane !== 'review') return;
    /** ⚠️ 进这一页时拉一次;切 ws 也要重拉(草稿是按 ws 分的) */
    void loadDrafts();
    /**
     * ⚠️ 依赖只列 pane / workspaceId —— `loadDrafts` 每次渲染都是新函数,
     * 列进去会**每渲染一次就查一次库**。
     */
  }, [pane, workspaceId]);

  /**
   * 补一条点评。
   *
   * ⚠️ **不传 status** —— 这是「回头补评价」,不该顺手改掉已发送的状态。
   * ⭐ 可以反复补:review_count 会累加,「改过几轮」本身是信号。
   */
  const submitNote = async (tweetId: string) => {
    const note = (notes[tweetId] ?? '').trim();
    if (!note) return;
    const r = await api()?.reviewDraft?.(tweetId, note);
    if (!r?.success) { setDraftMsg(`记点评失败：${r?.error ?? '未知'}`); return; }
    setNotes((m) => ({ ...m, [tweetId]: '' }));
    setDraftMsg(`✓ 已记下（${new Date().toLocaleTimeString()}）`);
    /** ⭐ 回读:让 review_count 当场变,而不是只弹一句「成功」 */
    await loadDrafts();
  };

  /**
   * 保存口径。
   *
   * ⚠️ **回读确认**(可靠性纲领铁律四:成功要对账)——
   * 只报「保存成功」而不回读,用户会以为改好了,
   * 而模型还在用旧口径(「看着成功实际没有」那一类)。
   */
  const saveFacts = async () => {
    if (!facts) return;
    setSavingFacts(true);
    try {
      const r = await api()?.saveProductFacts?.(facts as never);
      if (!r?.success) { setFactsMsg(`保存失败：${r?.error ?? '未知'}`); return; }
      /** ⭐ 用回读结果覆盖本地,而不是保留用户输入 —— 两者不一致要看得出来 */
      if (r.facts) setFacts(r.facts as ProductFactsView);
      setFactsDirty(false);
      setFactsMsg(`✓ 已保存并回读确认（${new Date().toLocaleTimeString()}）—— 下一次拟回复就用新口径`);
    } catch (err) {
      setFactsMsg(`保存失败：${String(err)}`);
    } finally {
      setSavingFacts(false);
    }
  };

  // ── 盯人 ──
  const [watchHandle, setWatchHandle] = useState('');
  const [profile, setProfile] = useState<WatchProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [snap, setSnap] = useState<CaptureSnap | null>(null);
  const [running, setRunning] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const target = normalizeHandle(watchHandle);

  /**
   * ⚠️ 过滤在**呈现层**,不在采集层。
   * 用户 2026-09-03 定:「不要过滤,入库后前端就可以请求了」——
   * 「原先在采集层就把推荐流丢掉,结果是丢掉的永远查不回来」。
   * 所以监视器照样全采,这里只是少显示。
   */
  const shown = (snap?.recent ?? []).filter(
    (t) => !target || normalizeHandle(t.authorHandle ?? '') === target,
  );

  useEffect(() => {
    const off = api()?.onCaptureUpdate?.((s) => setSnap(s as CaptureSnap));
    return () => { if (off) off(); };
  }, []);

  /**
   * ⭐ 进「产品口径」页时载入当前清单。
   * ⚠️ **已改未存时不覆盖**(factsDirty)—— 否则切走再切回来,改的字全没了。
   */
  useEffect(() => {
    if (pane !== 'facts' || factsDirty) return;
    void (async () => {
      const r = await api()?.getProductFacts?.();
      if (r?.success && r.facts) {
        setFacts(r.facts as ProductFactsView);
        setFactsMsg(r.facts.source === 'default'
          ? '当前用的是代码里的默认口径（还没改过）—— 改完保存即生效'
          : `上次更新：${r.facts.updatedAt ? new Date(r.facts.updatedAt).toLocaleString() : '未知'}`);
      } else {
        /** ⚠️ 读不到要说出来,别留一张空表单让人以为清单是空的 */
        setFactsMsg(`读取失败：${r?.error ?? '未知'} —— 别在这个状态下保存，会覆盖掉现有口径`);
      }
    })();
  }, [pane, factsDirty]);

  /**
   * ⭐⭐ **订阅编排进度** —— 用户 2026-09-24 那句「没有任何反应」的解药。
   *
   * 实测四步耗时 0.1s / 30.8s / **330.8s** / 0.5s —— 差 3000 倍。
   * 没有逐步进度的话,判断那 5.5 分钟里面板什么都不动。
   *
   * ⚠️⚠️ **必须核对 wsId** —— 广播是发给**所有 renderer** 的,
   * 多窗口下不核对就会「别的窗口的进度显示在这里」
   * (记忆:宿主广播×多ws扇出)。
   */
  useEffect(() => {
    const off = window.electronAPI?.webConsole?.onFlowProgress?.((p) => {
      if (p.wsId && p.wsId !== workspaceId) return;   // ⚠️ 不是我这个 ws 的,丢掉
      setFlowSteps((prev) => {
        const next = [...prev];
        /** ⭐ 第一次收到就按 total 铺满 —— 否则后面的步骤在跑完前不显示 */
        while (next.length < p.total) {
          next.push({ seq: next.length + 1, stepId: `step${next.length + 1}`, label: '…', status: 'idle' });
        }
        const i = p.seq - 1;
        next[i] = {
          seq: p.seq, stepId: p.stepId, label: p.label,
          status: p.status,
          produced: p.produced, note: p.note, error: p.error, elapsedMs: p.elapsedMs,
          startedAt: p.status === 'running' ? Date.now() : next[i]?.startedAt,
        };
        return next;
      });
    });
    return () => { if (off) off(); };
  }, [workspaceId]);

  /**
   * ⭐ 正在跑的那一步,每秒刷一次「已用时」。
   * ⚠️ 只在**真的有步骤在跑**时开定时器 —— 常驻 timer 是本仓的已知坑
   * (记忆:常驻 timer 必须在 before-quit 有停止调用)。
   */
  useEffect(() => {
    if (!flowSteps.some((x) => x.status === 'running')) return;
    const t = setInterval(() => setTickAt(Date.now()), 1000);
    return () => clearInterval(t);
  }, [flowSteps]);

  const wcId = useCallback((): number | undefined => {
    try {
      const xApi = requireCapabilityApi<XExtractionApi>('x-extraction');
      return xApi.getXHostWcId(workspaceId) ?? undefined;
    } catch {
      return undefined;
    }
  }, [workspaceId]);

  /** ⭐ 跑编排 —— 进度靠广播实时来,这里只等最终结果 */
  const runFlow = async () => {
    setFlowRunning(true);
    setFlowSteps([]);
    setFlowMsg('启动中…');
    try {
      const r = await window.electronAPI?.webConsole?.runFlow?.({
        wsId: workspaceId, wcId: wcId(),
      });
      const rep = r?.report;
      if (!r?.channelOk) {
        setFlowMsg(`⚠️ 启动失败:${r?.error ?? '通道没注册?'}`);
      } else if (rep) {
        /**
         * ⚠️ 「断在哪一步」要说出来 —— 光说「失败」人还得自己去找。
         * ⭐ 而每一步的详情已经由广播填进 flowSteps 了,这里只补一句总结。
         */
        setFlowMsg(rep.ok
          ? `✓ 四步全通 · ${(rep.elapsedMs / 1000).toFixed(1)}s`
          : `⚠️ 断在「${rep.failedAt}」· ${(rep.elapsedMs / 1000).toFixed(1)}s`);
      }
    } catch (e) {
      setFlowMsg(`⚠️ ${String(e)}`);
    } finally {
      setFlowRunning(false);
    }
  };

  /** ⭐ 停 —— 复用采集那套暂停键(协作式,到下一个检查点才真停) */
  const stopFlow = () => {
    void window.electronAPI?.webConsole?.stopCollect?.({ wsId: workspaceId });
    setFlowMsg('已请求停止 —— 跑到下一个检查点才会停(补正文时约 10 秒内)');
  };

  const fetchProfile = async () => {
    if (!target) { setMsg('先填要盯的账号'); return; }
    setLoadingProfile(true);
    setMsg(`抓 @${target} 的画像中(会导航到他的主页)…`);
    try {
      const r = await api()?.fetchAuthorProfile?.(target, wcId());
      if (!r?.success || !r.profile) {
        setMsg(`抓画像失败:${r?.error ?? '未知'}`);
        return;
      }
      setProfile({ ...r.profile, fetchedAt: new Date().toISOString() });
      setMsg('画像已更新 —— 现在可以点「开始对照」,再去左边翻他的推');
    } finally {
      setLoadingProfile(false);
    }
  };

  const start = async () => {
    const r = await api()?.captureStart?.(wcId());
    if (!r?.success) { setMsg(`启动失败:${r?.error ?? '未知'}`); return; }
    setRunning(true);
    setMsg('对照中 —— 请在左侧 X 里浏览、滚动');
  };

  const stop = async () => {
    const r = await api()?.captureStop?.();
    setRunning(false);
    if (r?.snapshot) setSnap(r.snapshot as CaptureSnap);
    setMsg('已停止');
  };

  /** ⭐ 切回旧面板 —— 迁移完成前不中断原有操作(用户明确要求) */
  const openLegacy = () => {
    workspaceManager.getBus(workspaceId)?.slot.openRight('x-inbox-view');
  };

  return (
    <div className="krig-xwb">
      <div className="krig-xwb__topbar">
        <span className="krig-xwb__title">X 工作台</span>
        <span className="krig-xwb__ws">{workspaceId}</span>
        <div className="krig-xwb__spacer" />
        {msg && <span style={{ fontSize: 11, color: 'var(--xwb-dim)' }}>{msg}</span>}
        {/* ⚠️ 旧面板入口:收件箱/拟回复/标注还在那边,别断了日常操作 */}
        <button type="button" className="krig-xwb__btn" onClick={openLegacy} title="收件箱 / 拟回复 / 标注仍在旧面板">
          旧版
        </button>
      </div>

      <div className="krig-xwb__body">
        {/* ── 左:任务 ── */}
        <div className="krig-xwb__left">
          <div className="krig-xwb__section-label">面板</div>
          {([
            { id: 'watch' as const, label: '盯人对照', icon: '🎯' },
            { id: 'tasks' as const, label: '采集任务', icon: '▶' },
            { id: 'facts' as const, label: '产品口径', icon: '📋' },
            { id: 'review' as const, label: '草稿点评', icon: '✍' },
          ]).map((p) => (
            <div
              key={p.id}
              className={`krig-xwb__task${pane === p.id ? ' krig-xwb__task--active' : ''}`}
              onClick={() => setPane(p.id)}
            >
              <span>{p.icon}</span>
              <span className="krig-xwb__task-name">{p.label}</span>
            </div>
          ))}
        </div>

        {/* ── 右:详情 ── */}
        <div className="krig-xwb__right">
          {pane === 'review' ? (
            /**
             * ⭐⭐ **草稿点评** —— 用户 2026-09-26 定的学习环节。
             *
             * ⚠️ 这里看的是**已落库的草稿**(含已填入/已否决的),
             * 不是待发列表 —— 「回头改点评」正是要对着已处置的做。
             */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <b style={{ flex: 1 }}>草稿点评</b>
                <button type="button" className="krig-xwb__btn"
                  onClick={() => void loadDrafts()}>刷新</button>
              </div>
              <div style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.6 }}>
                这里记的是<b>「AI 当时看到什么 → 写了什么 → 人改成什么」</b>。
                {' '}已发出去的也能回头补评价，补几次都行。
              </div>
              {draftMsg ? (
                <div style={{ fontSize: 12, opacity: 0.8 }}>{draftMsg}</div>
              ) : null}

              {drafts.map((d) => {
                const ctx = d.context_snapshot ?? {};
                return (
                  <div key={d.tweet_id} style={{
                    border: '1px solid var(--xwb-line)', borderRadius: 10,
                    padding: 10, display: 'flex', flexDirection: 'column', gap: 6,
                  }}>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      @{d.author_handle ?? '?'} · {d.status ?? '?'}
                      {d.review_count ? ` · 已点评 ${d.review_count} 次` : ''}
                      {d.source ? ` · ${d.source}` : ''}
                    </div>
                    <div style={{ fontSize: 13 }}>
                      <b>原推：</b>{(d.tweet_text ?? '').slice(0, 220) || '（没快照到正文）'}
                    </div>
                    {/* ⭐ AI 当时看到的语境 —— 没有它，点评是不公平的 */}
                    {(ctx.bio || ctx.parentText) ? (
                      <div style={{ fontSize: 12, opacity: 0.75 }}>
                        {ctx.bio ? <div><b>作者简介：</b>{String(ctx.bio).slice(0, 160)}</div> : null}
                        {ctx.parentText ? <div><b>上文：</b>{String(ctx.parentText).slice(0, 200)}</div> : null}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, opacity: 0.55 }}>
                        ⚠️ 拟稿时<b>没有语境</b>（bio/上文都没采到）—— 评判时请把这点算进去
                      </div>
                    )}
                    {d.ai_reason ? (
                      <div style={{ fontSize: 12, opacity: 0.7 }}><b>判断理由：</b>{d.ai_reason}</div>
                    ) : null}
                    <div style={{ fontSize: 13 }}><b>AI 写的：</b>{d.ai_text ?? ''}</div>
                    {/* ⭐ 人改了什么 —— 最强学习信号 */}
                    {d.user_edit_diff ? (
                      <div style={{ fontSize: 13, color: 'var(--xwb-blue)' }}>
                        <b>人改成：</b>{d.user_edit_diff}
                      </div>
                    ) : d.review_count ? (
                      <div style={{ fontSize: 12, opacity: 0.6 }}>（人没改，原样通过）</div>
                    ) : null}
                    {d.review_note ? (
                      <div style={{ fontSize: 12, opacity: 0.8 }}><b>已记的点评：</b>{d.review_note}</div>
                    ) : null}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        className="krig-xwb__input"
                        style={{ flex: 1 }}
                        placeholder="这条写得怎么样？哪里不好？（补几次都行）"
                        value={notes[d.tweet_id] ?? ''}
                        onChange={(e) => setNotes((m) => ({ ...m, [d.tweet_id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === 'Enter') void submitNote(d.tweet_id); }}
                      />
                      <button type="button" className="krig-xwb__btn"
                        disabled={!(notes[d.tweet_id] ?? '').trim()}
                        onClick={() => void submitNote(d.tweet_id)}>记下</button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : pane === 'facts' ? (
            /**
             * ⭐⭐ **产品口径** —— 用户 2026-09-26:
             * > 「这个需要增加，而且产品描述给好格式，我要及时更新的。」
             *
             * ⚠️ 这份清单是**模型唯一能引用的信源**:改它等于改所有回复的对外承诺。
             * ⭐ 刻意做成一眼能核对全部承诺的清单,而不是散落的设置项。
             */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 720 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <b style={{ flex: 1 }}>产品事实清单</b>
                <button
                  type="button"
                  className="krig-xwb__btn"
                  disabled={!facts || savingFacts || !factsDirty}
                  onClick={() => void saveFacts()}
                  title="保存后当场生效 —— 下一次拟回复就用新口径"
                >{savingFacts ? '保存中…' : '保存'}</button>
              </div>

              <div style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.6 }}>
                AI 写回复时<b>只能用这里的内容</b>，清单外的一律不许说。
                {' '}改完保存即生效，不用重启。
              </div>

              {facts ? (
                <>
                  {FACT_FIELDS.map((f) => (
                    <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{f.label}</span>
                      {f.multiline ? (
                        <textarea
                          className="krig-xwb__input"
                          rows={3}
                          value={String(facts[f.key] ?? '')}
                          onChange={(e) => {
                            setFacts({ ...facts, [f.key]: e.target.value });
                            setFactsDirty(true);
                          }}
                        />
                      ) : (
                        <input
                          className="krig-xwb__input"
                          value={String(facts[f.key] ?? '')}
                          onChange={(e) => {
                            setFacts({ ...facts, [f.key]: e.target.value });
                            setFactsDirty(true);
                          }}
                        />
                      )}
                      <span style={{ fontSize: 11, opacity: 0.6 }}>{f.hint}</span>
                    </label>
                  ))}

                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>严禁提及（一行一个）</span>
                    <textarea
                      className="krig-xwb__input"
                      rows={4}
                      value={(facts.forbidden ?? []).join('\n')}
                      onChange={(e) => {
                        setFacts({ ...facts, forbidden: e.target.value.split('\n') });
                        setFactsDirty(true);
                      }}
                    />
                    <span style={{ fontSize: 11, opacity: 0.6 }}>
                      ⭐ 显式列出比「不要瞎说」有效得多（实测：7 个诱导问题 0 编造）。
                      {' '}价格、速度数字、节点数量这类<b>会变或说不准</b>的，都该列进来。
                    </span>
                  </label>
                </>
              ) : <div style={{ opacity: 0.6 }}>载入中…</div>}

              {factsMsg ? (
                <div style={{ fontSize: 12, opacity: 0.8, whiteSpace: 'pre-wrap' }}>{factsMsg}</div>
              ) : null}
            </div>
          ) : pane === 'tasks' ? (
            /**
             * ⭐⭐⭐ **编排执行与观察** —— 用户 2026-09-24 的分层:
             * 「编排完毕,交给工作台执行和观察」。
             *
             * ⚠️ 这里**只跑与看**,不编辑编排档 ——
             * 改步骤顺序/参数是「编排视图」的事(还没做)。
             */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <b style={{ flex: 1 }}>X:搜索 → 采集 → 判断 → 拟回复</b>
                <button
                  type="button"
                  className="krig-xwb__btn"
                  disabled={flowRunning}
                  onClick={() => void runFlow()}
                  title="按编排档依次跑四步。⚠️ 一步失败就停,后面标「跳过」;拟回复只填不发"
                >
                  {flowRunning ? '跑着…' : '▶ 开始'}
                </button>
                {/** ⭐ 只在跑的时候露出来 —— 不跑时按不动的按钮是噪音 */}
                {flowRunning ? (
                  <button type="button" className="krig-xwb__btn" onClick={stopFlow}
                    title="停 —— 已跑完的步骤不回滚,报告里会写明「是人停的,不是跑完了」">
                    ⏸ 停止
                  </button>
                ) : null}
              </div>

              {flowMsg ? <div className="krig-xwb__hint">{flowMsg}</div> : null}

              {flowSteps.length === 0 ? (
                <div className="krig-xwb__empty">
                  还没跑过 —— 点「▶ 开始」。
                  <br /><br />
                  ⚠️ 判断那步一批 10 条约 3~5 分钟,
                  <br />跑起来后这里会**逐步显示进度**(不是卡住)。
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {flowSteps.map((st) => {
                    /** ⭐ 正在跑的显示「已用时」—— 这是长步骤唯一的反馈 */
                    const live = st.status === 'running' && st.startedAt
                      ? Math.max(0, Math.round((tickAt - st.startedAt) / 1000))
                      : undefined;
                    const icon = st.status === 'ok' ? '✓'
                      : st.status === 'failed' ? '✗'
                        : st.status === 'skipped' ? '–'
                          : st.status === 'running' ? '◐' : '○';
                    return (
                      <div key={st.seq} className="krig-xwb__card"
                        style={{ opacity: st.status === 'idle' || st.status === 'skipped' ? 0.6 : 1 }}>
                        <div>
                          <b>{icon} {st.seq}. {st.label}</b>
                          {st.status === 'ok' && st.produced !== undefined
                            ? <span> · 产出 {st.produced}</span> : null}
                          {live !== undefined ? <span> · 已跑 {live}s</span> : null}
                          {st.elapsedMs ? <span> · {(st.elapsedMs / 1000).toFixed(1)}s</span> : null}
                        </div>
                        {/** ⚠️ 「为什么」比数字要紧 —— note 里带着跳过原因/停止原因 */}
                        {st.error
                          ? <div style={{ color: '#e05555' }}>{st.error}</div>
                          : st.note ? <div style={{ opacity: 0.85 }}>{st.note}</div> : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <>
              {/* 盯谁 */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  className="krig-xwb__input"
                  style={{ flex: 1 }}
                  value={watchHandle}
                  onChange={(e) => setWatchHandle(e.target.value)}
                  placeholder="要盯的账号,如 fang_danie121"
                />
                <button
                  type="button"
                  className="krig-xwb__btn"
                  onClick={fetchProfile}
                  disabled={!target || loadingProfile}
                >
                  {loadingProfile ? '抓取中…' : '抓画像'}
                </button>
                <button
                  type="button"
                  className={`krig-xwb__btn${running ? ' krig-xwb__btn--danger' : ' krig-xwb__btn--primary'}`}
                  onClick={running ? stop : start}
                >
                  {running ? '停止' : '开始对照'}
                </button>
              </div>

              {/* bio 卡片 —— 用户:「上部分有一个 card,是这个人的 bio」 */}
              {profile && (
                <div className="krig-xwb__card">
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>
                      {profile.displayName ?? profile.handle}
                    </span>
                    <span style={{ color: 'var(--xwb-dim)' }}>@{profile.handle}</span>
                    {profile.isBlueVerified && <span style={{ color: 'var(--xwb-blue)', fontSize: 11 }}>✔</span>}
                    {profile.followsMe && <span style={{ fontSize: 11, color: 'var(--xwb-green)' }}>关注了我</span>}
                    {profile.iFollow && <span style={{ fontSize: 11, color: 'var(--xwb-blue)' }}>我关注了他</span>}
                    {profile.blocking && <span style={{ fontSize: 11, color: 'var(--xwb-red)' }}>已屏蔽</span>}
                  </div>
                  {profile.bio && (
                    <div style={{ marginTop: 6, lineHeight: 1.5 }}>{profile.bio}</div>
                  )}
                  <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: 'var(--xwb-dim)' }}>
                    <span><b style={{ color: 'var(--xwb-text)' }}>{profile.tweetCount ?? '—'}</b> 推文</span>
                    <span><b style={{ color: 'var(--xwb-text)' }}>{profile.followersCount ?? '—'}</b> 关注者</span>
                    <span><b style={{ color: 'var(--xwb-text)' }}>{profile.followingCount ?? '—'}</b> 正在关注</span>
                    {profile.location && <span>📍{profile.location}</span>}
                  </div>
                </div>
              )}

              {/* 对照统计 —— ⚠️ 盯人时要说清「他的 N 条 / 屏幕共 M 条」,
                  不能拿全局采集率冒充,否则会出现「列表 3 条、采集率 99%」这种对不上的账 */}
              <div className="krig-xwb__stats">
                <div className="krig-xwb__stat">
                  <div className="krig-xwb__stat-label">{target ? `@${target} 的推` : '屏幕上'}</div>
                  <div className="krig-xwb__stat-value">{target ? shown.length : (snap?.onScreenCount ?? 0)}</div>
                </div>
                <div className="krig-xwb__stat">
                  <div className="krig-xwb__stat-label">累计滚过</div>
                  <div className="krig-xwb__stat-value" style={{ color: 'var(--xwb-dim)' }}>{snap?.seenInDom ?? 0}</div>
                </div>
                <div className="krig-xwb__stat">
                  <div className="krig-xwb__stat-label">已采到</div>
                  <div className="krig-xwb__stat-value" style={{ color: 'var(--xwb-blue)' }}>{snap?.captured ?? 0}</div>
                </div>
                <div className="krig-xwb__stat">
                  <div className="krig-xwb__stat-label">采集率(全部)</div>
                  <div
                    className="krig-xwb__stat-value"
                    style={{ color: (snap?.captureRate ?? 0) >= 99 ? 'var(--xwb-green)' : (snap?.captureRate ?? 0) >= 90 ? 'var(--xwb-amber)' : 'var(--xwb-red)' }}
                  >
                    {snap?.captureRate ?? 0}%
                  </div>
                </div>
              </div>

              {snap?.currentUrl && (
                <div style={{ fontSize: 11, color: 'var(--xwb-dim)' }}>
                  当前页:{snap.currentUrl}　已运行 {snap.elapsedSec}s　响应 {snap.payloads}
                  {target && `　(屏幕共 ${snap.onScreenCount} 条,这里只列 @${target} 的)`}
                </div>
              )}

              {/* 漏网名单 —— 屏幕上见过却没采到的,这才是真问题 */}
              {snap && snap.missing.length > 0 && (
                <div className="krig-xwb__card" style={{ borderColor: 'var(--xwb-red)' }}>
                  <div style={{ color: 'var(--xwb-red)', fontWeight: 600 }}>
                    ⚠ 屏幕上见过但没采到:{snap.missing.length} 条
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--xwb-dim)', fontFamily: 'ui-monospace, monospace', marginTop: 4 }}>
                    {snap.missing.join(', ')}
                  </div>
                </div>
              )}

              {/* 推文列表 —— 补全字段在这里才有意义(传了不用 = 白补) */}
              <div ref={listRef} style={{ flex: 1, minHeight: 0 }}>
                {shown.map((t) => (
                  <div key={t.tweetId} className="krig-xwb__tweet">
                    <div className="krig-xwb__tweet-head">
                      <span>@{normalizeHandle(t.authorHandle ?? '')}</span>
                      <span style={{ color: t.isReply ? 'var(--xwb-blue)' : 'var(--xwb-green)' }}>
                        {t.isReply ? '回复' : '原创'}
                      </span>
                      {t.hasMedia && <span style={{ color: 'var(--xwb-amber)' }}>🖼{t.mediaTypes?.length ? ` ${t.mediaTypes.join('/')}` : ''}</span>}
                      {t.isLongText && <span>长推</span>}
                      <span style={{ color: t.fromDom ? 'var(--xwb-amber)' : 'var(--xwb-dim)' }}>
                        {t.fromDom ? 'DOM' : '载荷'}
                      </span>
                      <span style={{ marginLeft: 'auto' }}>
                        {t.createdAt ? new Date(t.createdAt).toLocaleString('zh-CN') : ''}
                      </span>
                    </div>

                    <div className="krig-xwb__tweet-text">{t.text}</div>

                    <div className="krig-xwb__tweet-metrics">
                      <span>♥ {t.metrics?.likes ?? 0}</span>
                      <span>🔁 {t.metrics?.retweets ?? 0}</span>
                      <span>💬 {t.metrics?.replies ?? 0}</span>
                      {t.metrics?.views ? <span>👁 {t.metrics.views}</span> : null}
                      {t.metrics?.bookmarks ? <span>🔖 {t.metrics.bookmarks}</span> : null}
                      {(t.self?.favorited || t.self?.retweeted || t.self?.bookmarked) && (
                        <span style={{ color: 'var(--xwb-green)' }}>
                          我:{[t.self.favorited && '赞', t.self.retweeted && '转', t.self.bookmarked && '藏'].filter(Boolean).join('/')}
                        </span>
                      )}
                    </div>

                    {(t.inReplyToScreenName || t.quotedStatusId) && (
                      <div className="krig-xwb__tweet-rel">
                        {t.inReplyToScreenName && `↩ @${t.inReplyToScreenName}`}
                        {t.inReplyToStatusId && ` · ${t.inReplyToStatusId}`}
                        {t.quotedStatusId && ` ❝ ${t.quotedStatusId}`}
                      </div>
                    )}
                  </div>
                ))}

                {!shown.length && (
                  <div className="krig-xwb__empty">
                    {running
                      ? (target
                        ? `对照中 —— 请在左侧打开 x.com/${target}/with_replies 并往下滚`
                        : '对照中 —— 请在左侧 X 里浏览、滚动')
                      : '① 填账号 → ② 抓画像 → ③ 开始对照 → ④ 左边翻他的推'}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
