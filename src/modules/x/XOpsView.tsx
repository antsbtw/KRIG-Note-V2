/**
 * XOpsView —— ⭐⭐ X 的**业务平台**「运营」(2026-10-07 起,本步只有骨架)
 *
 * ── 用户 2026-10-07 定的 ──
 * · 主入口叫「运营」;toolbar 放按钮,点击弹出 right slot view
 * · 「这个view，是一个和x view是同级别的，也可以放大做到全屏，可以放在左边右边的。」
 * · dashboard 先分大类:**状态 / 人 / 推文**;互动是「人」「推文」两个观察维度,不单开一类
 * · 运营以**发起的 ws 登录的那个号**为中心
 *
 * ⚠️ 与「X 操作台」不是一回事:操作台是前期测试用的后台,将来要隐藏;
 * 运营是给人用的业务平台。**业务功能只进这里,不进操作台。**
 *
 * ⚠️ 本步**零业务**:三个大类里放什么还在设计,只占位。
 *
 * ## ⭐ 全屏 = 覆盖层,不借 slot 布局
 *
 * eBook 的全屏靠「收 navSide + 关另一栏」,在**右栏进不了全屏**:
 * 腾左栏只能 closeLeft(),而那会触发 right→left 升级 → React key 变 → 实例重建 →
 * 全屏状态当场丢失(EBookView `onFullscreen` 注释、记忆 project-slot-symmetry 缺口 3)。
 * 那条记忆给的正解就是「全屏改覆盖层」。
 * → 这里全屏只是把本 view 的根节点 `position: fixed` 铺满窗口:
 *   **不动 slotBinding、不重建实例**,左栏右栏同一份逻辑。
 * ⚠️ 依赖 slot 祖先链上没有 transform/filter/contain(会把 fixed 困在容器里);
 * 2026-10-07 查过 src/slot、src/shell 没有。
 * ⚠️ z-index 900:盖住两栏,但低于 popup/菜单/overlay(1000+),全屏时弹层照样能用。
 *
 * ## ⚠️ ✕ 关哪一栏用 slot prop,不推导
 * 记忆 project-dont-guess-own-slot:靠 slotBinding 反推「我在哪一栏」,
 * 左右双开时对两个实例都成立 → 点左栏 ✕ 关掉右栏(note/eBook/web 各踩过一次)。
 */

import { useCallback, useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import type { ViewComponentProps } from '@slot/view-type-registry/view-definition';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { XOpsStatus } from './XOpsStatus';
import { XOpsPeople } from './XOpsPeople';
import { BgIndicator } from './XBgStatus';
import { XAccountBadge } from './XAccountBadge';
import { XSpotCard } from './XSpotCard';
import type { WsAccount } from './x-account';

/** ⚠️ 标签与 id 同在一处 —— 分开写两份必漂 */
type OpsCategory = 'status' | 'people' | 'tweets';
const OPS_CATEGORIES: ReadonlyArray<{ id: OpsCategory; label: string; hint: string }> = [
  { id: 'status', label: '状态', hint: '数据概要:各类采了多少、什么时候采的、缺什么' },
  { id: 'people', label: '人', hint: '关系 · 客户池 · 人的互动(从人观察:他和我之间发生过什么)' },
  { id: 'tweets', label: '推文', hint: '我的推文 · 搜到的推文 · 推文的互动(从推文观察:这条推文下发生过什么)' },
];

export function XOpsView({ workspaceId, slot }: ViewComponentProps): ReactElement {
  const [category, setCategory] = useState<OpsCategory>('status');
  const [fullscreen, setFullscreen] = useState(false);
  /**
   * ⭐ 当前号的数字 id —— 关系按号存(1.2.27),号变了「状态」「人」要按新号重查(key 变 → 重挂)。
   * 'none' = 还没认出:面板照常挂,各自把「还没认出登录号」的原因报出来。
   */
  const [accountKey, setAccountKey] = useState('none');
  const onAccount = useCallback((a: WsAccount | null) => setAccountKey(a?.restId ?? 'none'), []);

  /** ⭐ 全屏时 Esc 退出 —— 只在全屏期间挂监听,免得抢别的 view 的 Esc */
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const handleClose = useCallback(() => {
    const bus = workspaceManager.getBus(workspaceId);
    if (!bus) return;
    /** ⚠️ 由框架告知的 slot 决定,不读 slotBinding 反推 */
    if (slot === 'right') bus.slot.closeRight();
    else bus.slot.closeLeft();
  }, [workspaceId, slot]);

  const current = OPS_CATEGORIES.find((c) => c.id === category)!;

  return (
    <div style={fullscreen ? { ...S.root, ...S.fullscreen } : S.root}>
      <div style={S.header}>
        <span style={S.title}>📊 运营</span>
        {/* ⭐ 运营以本 ws 登录的号为中心(用户 10-07)—— 从 X 页面认号(用户 10-16 选 A) */}
        <XAccountBadge wsId={workspaceId} onAccount={onAccount} />
        {/* ⭐ 后台采集此刻在不在跑 —— 任何页都看得见(用户 10-14) */}
        <BgIndicator wsId={workspaceId} />
        <span style={{ flex: 1 }} />
        <button
          type="button"
          style={S.iconBtn}
          onClick={() => setFullscreen((f) => !f)}
          title={fullscreen ? '退出全屏(Esc)' : '全屏'}
        >
          {fullscreen ? '⤡' : '⤢'}
        </button>
        {/* ⚠️ 全屏时不给 ✕:关掉 view 会连带丢掉全屏态,先退出全屏再关 */}
        {!fullscreen && (
          <button type="button" style={S.iconBtn} onClick={handleClose} title="关闭运营">✕</button>
        )}
      </div>

      <div style={S.tabBar}>
        {OPS_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategory(c.id)}
            style={{ ...S.tab, ...(category === c.id ? S.tabActive : null) }}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* ⭐ 右键「查库」抽查卡片(2026-10-16)—— 任何大类下都在最上面 */}
      <XSpotCard wsId={workspaceId} />
      <div style={S.body}>
        {category === 'status' && <XOpsStatus key={accountKey} wsId={workspaceId} />}
        {category === 'people' && <XOpsPeople key={accountKey} workspaceId={workspaceId} />}
        {category === 'tweets' && (
        <div style={S.placeholder}>
          <div style={{ fontSize: 13, color: 'var(--text-primary, #ddd)' }}>{current.label}</div>
          <div>{current.hint}</div>
          <div style={{ opacity: 0.6 }}>设计中 —— 内容还没定</div>
        </div>
        )}
      </div>
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  root: {
    display: 'flex', flexDirection: 'column', height: '100%', boxSizing: 'border-box',
    background: 'var(--bg-shell, #1e1e1e)', color: 'var(--text-secondary, #999)', fontSize: 12,
  },
  /** ⭐ 覆盖层全屏 —— 见文件头「全屏 = 覆盖层」 */
  fullscreen: { position: 'fixed', inset: 0, zIndex: 900, height: 'auto' },
  header: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
    borderBottom: '1px solid var(--border-color, #333)', flex: '0 0 auto',
  },
  title: { fontSize: 13, color: 'var(--text-primary, #ddd)' },
  sub: { fontSize: 11, opacity: 0.6 },
  iconBtn: {
    background: 'transparent', border: '1px solid var(--border-color, #444)', borderRadius: 4,
    color: 'var(--text-secondary, #aaa)', cursor: 'pointer', fontSize: 12, padding: '2px 8px',
  },
  tabBar: {
    display: 'flex', gap: 2, padding: '0 10px', flex: '0 0 auto',
    borderBottom: '1px solid var(--border-color, #333)',
  },
  tab: {
    background: 'transparent', border: 'none', borderBottom: '2px solid transparent', marginBottom: -1,
    color: '#888', cursor: 'pointer', fontSize: 12, padding: '6px 14px',
  },
  tabActive: { color: 'var(--text-primary, #ddd)', borderBottomColor: 'var(--accent-color, #6a9fd4)' },
  body: { flex: 1, minHeight: 0, overflow: 'auto', padding: 16 },
  placeholder: { display: 'flex', flexDirection: 'column', gap: 6, lineHeight: 1.6 },
};
