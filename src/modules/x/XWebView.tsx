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

import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactElement,
} from 'react';
import { popupController } from '@slot/triggers/popup-controller';
import { SLOT_PICKER_POPUP_ID, slotPickerContext } from '@shell/slot-picker';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { ViewComponentProps } from '@slot/view-type-registry/view-definition';
import type { HostHandle, HostProps } from '@capabilities/web-rendering';
import { setXHostWcId, clearXHostWcId } from './x-host-registry';

/** ⭐ 起始页 —— 与语义页面表的 `x.home` 同一个地址,不另写一份 */
const X_HOME = 'https://x.com/home';

/** ⭐ 操作台的 view id —— 与 `renderer.ts` 的注册共用同一个字面量 */
const X_WORKBENCH_VIEW_ID = 'x-workbench-view';

type WebRenderingApi = {
  Host: React.ForwardRefExoticComponent<HostProps & React.RefAttributes<HostHandle>>;
};

export function XWebView({ workspaceId, slot }: ViewComponentProps): ReactElement {
  /**
   * ⭐ 从 capability 注册表取 Host —— 不自己 new `<webview>`。
   * webview 的生命周期(attach / 导航 / 崩溃重建)全在 `web-rendering` 里,
   * 各 view 自己写一份正是「同功能多份实现」的由来。
   */
  const webApi = requireCapabilityApi<WebRenderingApi>('web-rendering');
  const Host = webApi.Host;

  const [url, setUrl] = useState(X_HOME);
  const hostRef = useRef<HostHandle | null>(null);

  /**
   * ⭐ 把 guest 的 wcId 登记给本模块 —— **右栏 Console 靠它调 goto**。
   *
   * ⚠️ 两个 view 是独立的、互相拿不到 ref,所以走模块自带的小注册表
   * (`x-host-registry`)。⚠️ 按 ws 分:不分的话右栏会拿到**别的 ws** 的 wcId,
   * 现象是「在 A 窗口点 goto,B 窗口的页面跳了」。
   *
   * ⚠️ 卸载时必须清 —— 不清的话右栏会拿着一个已销毁的 wcId 反复失败。
   */
  const registerWc = useCallback(() => {
    const id = hostRef.current?.getWebContentsId() ?? null;
    if (id != null) setXHostWcId(workspaceId, id);
  }, [workspaceId]);

  useEffect(() => () => clearXHostWcId(workspaceId), [workspaceId]);

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

  /**
   * ⭐⭐ 「操作台」专用按钮 —— 用户 2026-10-01:
   * 「右栏叫『X 操作台』—— 这个应该通过 x 的 toolbar 设置一个 button 来调出来?」
   *
   * ── 为什么要专用按钮,而不是让人去 SlotPicker 里找 ──
   *
   * ⚠️ 实测踩过:picker 里「X 网页」与「X 操作台」两项并排,
   * 用户点错开出第二个网页 view。**最常用的那个动作不该靠认名字。**
   * ⭐ 通用 picker 仍保留(⊞ 右栏)—— 它能开**任何** view(Note/eBook/…);
   * 这个按钮只管最高频的那一个,两者不冲突。
   *
   * ── 读 `slotBinding.right` 是**读状态**,不是「猜自己在哪一栏」 ──
   *
   * ⚠️ 记忆 `project-dont-guess-own-slot` 禁的是「靠 slotBinding 反推**我**是谁」
   * (左右双开同一 view 时对两个实例都成立 → 点左栏 ✕ 关掉右栏)。
   * 这里问的是「**右栏现在装的是谁**」—— 那是一个确定的事实,与「我」无关。
   * 与 `WebView` 判断翻译模式同一手法。
   */
  const workbenchOpen = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => workspaceManager.get(workspaceId)?.slotBinding.right === X_WORKBENCH_VIEW_ID,
  );

  const handleToggleWorkbench = useCallback(() => {
    const bus = workspaceManager.getBus(workspaceId);
    if (!bus) return;
    // ⚠️ 用当下的真状态判断,不缓存 —— 缓存会在别处关掉右栏后错判
    const openNow = workspaceManager.get(workspaceId)?.slotBinding.right === X_WORKBENCH_VIEW_ID;
    if (openNow) bus.slot.closeRight();
    else bus.slot.openRight(X_WORKBENCH_VIEW_ID);
  }, [workspaceId]);

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
        {/* ⭐ 最高频动作:直接开/关操作台,不必去 picker 里认名字 */}
        <button
          type="button"
          onClick={handleToggleWorkbench}
          title={workbenchOpen ? '关闭 X 操作台' : '打开 X 操作台'}
          style={{
            background: workbenchOpen ? 'var(--accent-bg, #2d4a6b)' : 'transparent',
            border: '1px solid var(--border-color, #444)',
            borderRadius: 4,
            color: workbenchOpen ? 'var(--text-primary, #ddd)' : 'var(--text-secondary, #aaa)',
            cursor: 'pointer', fontSize: 12, padding: '3px 8px', flex: '0 0 auto',
          }}
        >
          🛠 操作台
        </button>
        {/* 通用入口保留 —— 它能开任何 view(Note / eBook / …),与上面那个不冲突 */}
        <button
          type="button"
          onClick={handleOpenSlotPicker}
          title="打开右栏视图(任意 view)"
          style={{
            background: 'transparent', border: '1px solid var(--border-color, #444)',
            borderRadius: 4, color: 'var(--text-secondary, #aaa)',
            cursor: 'pointer', fontSize: 12, padding: '3px 8px', flex: '0 0 auto',
          }}
        >
          ⊞
        </button>
      </div>

      {/* ⭐ 真 webview —— 与同 ws 的内置浏览器同 partition(登录态共享) */}
      <Host
        ref={hostRef}
        workspaceId={workspaceId}
        currentUrl={url}
        translateMode={false}
        partition={`persist:webview-${workspaceId}`}
        style={{ flex: 1, width: '100%' }}
        onDisplayUrlChanged={(u) => { setUrl(u); registerWc(); }}
        onLoadingChanged={registerWc}
      />

      {/* ⚠️ slot 只用于调试显示;真要关栏时由框架给的 slot 决定,不自己推导 */}
      <div style={{ display: 'none' }} data-slot={slot ?? 'unknown'} />
    </div>
  );
}
