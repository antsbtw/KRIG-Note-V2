/**
 * XWebView —— ⭐ **左栏:X 的真网页**(人自己浏览、登录、将来右键提取)
 *
 * ── 用户 2026-10-01 定的形态 ──
 *
 * 「一边是 X 的原始网页,一边是对 X 进行操作的 dashboard」
 *
 * ⭐ 本 view 就是「原始网页」那一半:一个真的 `<webview>`,
 * 人在里面登录、刷、点 —— 与内置浏览器同一套 `web-rendering` 能力。
 * 操作台是**另一个独立 view**(`XWorkbenchView`),在右栏,随时可关。
 *
 * ## ⚠️ partition 必须与同 ws 的内置浏览器**同名**
 *
 * `persist:webview-${workspaceId}` —— 与 AI / Mail / 内置浏览器一致。
 * ⭐ 这样**登录态共享**:在内置浏览器登录过 X,这里就是登录状态。
 * ⚠️ 换个名字 = 另一个 session = 要重新登录,且与别处的 cookie 不互通
 * (记忆 `project-ai-x-partition-per-ws`)。
 *
 * ## ⚠️ handleClose 用 slot prop,不推导
 *
 * 「我在哪一栏」必须由框架经 `ViewComponentProps.slot` 告知。
 * 靠 `slotBinding.right === VIEW_ID` 反推在左右双开同一 view 时
 * 对两个实例都成立 —— 点左栏的 ✕ 会把右栏关掉
 * (note / eBook / web 各踩过一次,见记忆「别猜自己在哪一栏」)。
 */

import { useCallback, useState, type ReactElement } from 'react';
import { popupController } from '@slot/triggers/popup-controller';
import { SLOT_PICKER_POPUP_ID, slotPickerContext } from '@shell/slot-picker';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { ViewComponentProps } from '@slot/view-type-registry/view-definition';
import type { HostProps } from '@capabilities/web-rendering';

/** ⭐ 起始页 —— 与语义页面表的 `x.home` 同一个地址,不另写一份 */
const X_HOME = 'https://x.com/home';

type WebRenderingApi = { Host: React.ComponentType<HostProps> };

export function XWebView({ workspaceId, slot }: ViewComponentProps): ReactElement {
  /**
   * ⭐ 从 capability 注册表取 Host —— 不自己 new `<webview>`。
   * webview 的生命周期(attach / 导航 / 崩溃重建)全在 `web-rendering` 里,
   * 各 view 自己写一份正是「同功能多份实现」的由来。
   */
  const webApi = requireCapabilityApi<WebRenderingApi>('web-rendering');
  const Host = webApi.Host;

  const [url, setUrl] = useState(X_HOME);

  /**
   * ⊞ 右栏视图切换 —— ⭐ 复用**全局 SlotPicker**,不自造 toggle 逻辑
   * (与 Note / AI / Mail 同一套机制;铁律:同功能同逻辑)。
   *
   * popup 从 `viewTypeRegistry` **动态列出**所有 view ——
   * 所以「X 操作台」会自动出现在里面,不必在这里写死它。
   *
   * ⚠️ 没有这个按钮,右栏那个独立 view 就**召不出来** ——
   * 实测第一版漏了它(别的 view 都有)。
   */
  const handleOpenSlotPicker = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    slotPickerContext.setCommandId('x-view.open-right-slot');
    popupController.toggle(SLOT_PICKER_POPUP_ID, e.currentTarget);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 顶条:地址显示 + 召出右栏 */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px', borderBottom: '1px solid var(--border-color, #333)',
          flex: '0 0 auto',
        }}
      >
        <span style={{ fontSize: 13, color: 'var(--text-primary, #ddd)' }}>𝕏</span>
        <span
          style={{
            flex: 1, fontSize: 12, color: 'var(--text-secondary, #888)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
          title={url}
        >
          {url}
        </span>
        <button
          type="button"
          onClick={handleOpenSlotPicker}
          title="打开右栏视图(含 X 操作台)"
          style={{
            background: 'transparent', border: '1px solid var(--border-color, #444)',
            borderRadius: 4, color: 'var(--text-secondary, #aaa)',
            cursor: 'pointer', fontSize: 12, padding: '3px 8px', flex: '0 0 auto',
          }}
        >
          ⊞ 右栏
        </button>
      </div>

      {/* ⭐ 真 webview —— 与同 ws 的内置浏览器同 partition(登录态共享) */}
      <Host
        workspaceId={workspaceId}
        currentUrl={url}
        translateMode={false}
        partition={`persist:webview-${workspaceId}`}
        style={{ flex: 1, width: '100%' }}
        onDisplayUrlChanged={setUrl}
      />

      {/* ⚠️ slot 只用于调试显示;真要关栏时由框架给的 slot 决定,不自己推导 */}
      <div style={{ display: 'none' }} data-slot={slot ?? 'unknown'} />
    </div>
  );
}
