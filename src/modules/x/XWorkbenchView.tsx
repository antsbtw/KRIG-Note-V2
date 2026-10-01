/**
 * XWorkbenchView —— ⭐ **右栏:X 的操作面板**(第一步仍是占位)
 *
 * ── 用户 2026-10-01 定的形态 ──
 *
 * 「x 的访问页面在左边;x 模块的操作作为一个单独的 view 在 right slot,
 * 　随时可以关闭。**也就是说,两个都是独立的 view**。」
 *
 * ⭐ 为什么这个分法是对的:
 * · **左栏是人在用的**(浏览 X、登录、右键提取)—— 它要全宽、长期开着
 * · **右栏是工具**(采集参数、结果列表、拟回复)—— 用完就关,不该占死一栏
 * · 两个独立 view ⇒ 可以**只开一个**:只想浏览就不开面板,
 *   只想看结果就不必开网页
 *
 * ⚠️ 本 view **不上 navSide 切换条**,走 `slotPickerEntry`
 * (与 `thought-view` 同款):navSide 那一栏留给「网页」,
 * 面板从 right slot 选择器召出。
 *
 * ## ⚠️ handleClose 用 slot prop,不推导
 *
 * 「我在哪一栏」必须由框架经 `ViewComponentProps.slot` 告知。
 * 靠 `slotBinding.right === VIEW_ID` 反推在左右双开同一 view 时
 * 对两个实例都成立 —— 点左栏的 ✕ 会把右栏关掉
 * (note / eBook / web 各踩过一次,见记忆「别猜自己在哪一栏」)。
 */

import type { ReactElement } from 'react';
import type { ViewComponentProps } from '@slot/view-type-registry/view-definition';

export function XWorkbenchView({ workspaceId, slot }: ViewComponentProps): ReactElement {
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
      <div style={{ fontSize: 15, color: 'var(--text-primary, #ddd)' }}>𝕏 操作面板</div>
      <div>⭐ 这一栏将来放**采集参数 / 结果列表 / 拟回复**。</div>
      <div>⚠️ 本步**刻意零业务** —— 先确认两个 view 能各自独立开关。</div>
      <div style={{ marginTop: 8, opacity: 0.7 }}>
        ws={workspaceId} · slot={slot ?? '(未知)'}
      </div>
    </div>
  );
}
