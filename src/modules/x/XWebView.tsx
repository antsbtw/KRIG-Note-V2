/**
 * XWebView —— ⭐ **左栏:X 的网页**(第一步仍是占位,webview 下一刀接)
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

import { useCallback, type ReactElement } from 'react';
import { popupController } from '@slot/triggers/popup-controller';
import { SLOT_PICKER_POPUP_ID, slotPickerContext } from '@shell/slot-picker';
import type { ViewComponentProps } from '@slot/view-type-registry/view-definition';

export function XWebView({ workspaceId, slot }: ViewComponentProps): ReactElement {
  /**
   * ⊞ 右栏视图切换 —— ⭐ 复用**全局 SlotPicker**,不自造 toggle 逻辑
   * (与 Note / AI / Mail 同一套机制;铁律:同功能同逻辑)。
   *
   * 点击先把本 view 的 `open-right-slot` 命令注入 `slotPickerContext`,
   * 再弹 popup;popup 从 `viewTypeRegistry` **动态列出**所有 view ——
   * 所以「X 操作台」会自动出现在里面,不必在这里写死它。
   *
   * ⚠️ 没有这个按钮,右栏那个独立 view 就**召不出来** ——
   * 实测第一版漏了它(别的 view 都有),于是用户看到左栏却开不出面板。
   */
  const handleOpenSlotPicker = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    slotPickerContext.setCommandId('x-view.open-right-slot');
    popupController.toggle(SLOT_PICKER_POPUP_ID, e.currentTarget);
  }, []);

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
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}
      >
        <div style={{ fontSize: 15, color: 'var(--text-primary, #ddd)' }}>𝕏 网页</div>
        {/* ⭐ 召出右栏:操作台从这里开(与别的 view 同一个 SlotPicker) */}
        <button
          type="button"
          onClick={handleOpenSlotPicker}
          title="打开右栏视图(含 X 操作台)"
          style={{
            background: 'transparent',
            border: '1px solid var(--border-color, #444)',
            borderRadius: 4,
            color: 'var(--text-secondary, #aaa)',
            cursor: 'pointer',
            fontSize: 13,
            padding: '4px 10px',
          }}
        >
          ⊞ 右栏
        </button>
      </div>
      <div>
        ⭐ 这一栏将来放 **X 的 webview**(人自己浏览、登录、右键提取)。
        底座的语义页面表已注册
        （<code>x.home / x.profile / x.withReplies / x.status</code>）。
      </div>
      <div>⚠️ 本步**刻意零业务** —— webview 与采集都还没接。</div>
      <div>
        ⭐ X 的**操作面板**是另一个独立 view，在右栏，
        从 right slot 选择器召出、随时可关。
      </div>
      <div style={{ marginTop: 8, opacity: 0.7 }}>
        ws={workspaceId} · slot={slot ?? '(未知)'}
      </div>
    </div>
  );
}
