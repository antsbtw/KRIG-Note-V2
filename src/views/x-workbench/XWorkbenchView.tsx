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

type PaneId = 'watch' | 'tasks';

export function XWorkbenchView({ workspaceId }: { workspaceId: string }) {
  const [pane, setPane] = useState<PaneId>('watch');
  const [msg, setMsg] = useState('');

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

  const wcId = useCallback((): number | undefined => {
    try {
      const xApi = requireCapabilityApi<XExtractionApi>('x-extraction');
      return xApi.getXHostWcId(workspaceId) ?? undefined;
    } catch {
      return undefined;
    }
  }, [workspaceId]);

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
          {pane === 'tasks' ? (
            <div className="krig-xwb__empty">
              采集任务列表还没接上 —— 任务已经在库里(`x_task`,4 条),
              <br />但 renderer 侧还缺一条取任务的 IPC 通道。
              <br /><br />
              ⚠️ 这里**故意留空**而不是塞假数据:
              <br />「看着有、实际没有」比「明说没有」更难查。
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
