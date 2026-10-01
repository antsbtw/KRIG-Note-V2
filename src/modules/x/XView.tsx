/**
 * XView —— X 模块的 view 外壳(第一步:**只占位,不做业务**)
 *
 * ⭐ 本步的意义是**先有可见入口**:用户 2026-10-01
 * 「先把 navSide bar 的 x button 添加上,在这个基础上好在 right slot 构建结果」。
 * 有了落点,后面每一步(采集、判断、拟回复)才有地方展示。
 *
 * ⚠️ 这里**刻意什么都不做** —— 没有 webview、没有采集、没有库表。
 * 把「能不能挂上去」与「业务对不对」分开验:
 * 混在一起的话,点开是空白时分不清是没注册还是业务挂了。
 *
 * ## ⚠️ handleClose 用 slot prop,不推导
 *
 * 「我在哪一栏」必须由框架经 `ViewComponentProps.slot` 告知。
 * 靠 `slotBinding.right === VIEW_ID` 反推在**左右双开同一个 view** 时
 * 对两个实例都成立 —— 点左栏的 ✕ 会把右栏关掉
 * (note / eBook / web 各踩过一次,见记忆「别猜自己在哪一栏」)。
 */

import type { ReactElement } from 'react';
import type { ViewComponentProps } from '@slot/view-type-registry/view-definition';

export function XView({ workspaceId, slot }: ViewComponentProps): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 24,
        height: '100%',
        boxSizing: 'border-box',
        color: 'var(--text-secondary, #888)',
        fontSize: 13,
        lineHeight: 1.7,
      }}
    >
      <div style={{ fontSize: 15, color: 'var(--text-primary, #ddd)' }}>𝕏 模块</div>
      <div>
        ⭐ 第一步:入口已挂上,底座的语义页面表已注册
        （<code>x.home / x.profile / x.withReplies / x.status</code>）。
      </div>
      <div>⚠️ 本步**刻意零业务** —— 采集、判断、拟回复都还没建。</div>
      <div style={{ marginTop: 8, opacity: 0.7 }}>
        ws={workspaceId} · slot={slot ?? '(未知)'}
      </div>
    </div>
  );
}
