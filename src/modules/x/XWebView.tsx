/**
 * XWebView —— ⭐ **左栏:X 的真网页**(人自己浏览、登录、将来右键提取)
 *
 * ── 用户 2026-10-01 定的形态 ──
 *
 * 「一边是 X 的原始网页,一边是对 X 进行操作的 dashboard」
 *
 * ⭐ 本 view 就是「原始网页」那一半:一个真的 `<webview>`,
 * 人在里面登录、刷、点 —— 与内置浏览器同一套 `web-rendering` 能力。
 * 操作台(`XWorkbenchView`)2026-10-26 已拆;右栏放「运营」「任务」。
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
import { setXHostState, clearXHostState } from './x-host-registry';
import { setSpot, type SpotReq } from './x-spot-store';
import { xDataCall } from './x-data-types';
import { XPostBar } from './XPostBar';

/** ⭐ 起始页 —— 与语义页面表的 `x.home` 同一个地址,不另写一份 */
const X_HOME = 'https://x.com/home';

/**
 * ⭐ 运营的 view id —— 同上,与 `renderer.ts` 共用同一个字面量。
 * ⚠️ 不 import renderer.ts:那会把 registerView 的副作用拖进来(循环引用)。
 */
const X_OPS_VIEW_ID = 'x-ops-view';
/** ⭐ 任务的 view id —— 与 `renderer.ts` 同一个字面量 */
const X_TASK_VIEW_ID = 'x-task-view';

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
  /**
   * ⭐ 最后一次 displayUrl —— ⚠️ **用 ref 不用 state**。
   *
   * ⚠️⚠️ 为什么:登记函数与 `setUrl(u)` 在**同一个回调里并列调用**,
   * 那时 `url` state 还是**上一页**的值(setState 不同步生效)。
   * 读 state 登记就会落后一页,现象是右栏识别结果**永远慢一拍**:
   * 人点进 A 的主页,右栏填的是上一页。
   *
   * ⭐ ref 与 state **在同一行同时赋值**,所以不是「两份真源」——
   * state 只管渲染(传给 Host 的 currentUrl),ref 只管登记。
   * ⚠️ 不能只留 ref:Host 的 currentUrl 是受控 prop,必须走 state。
   * ⚠️ 也不能让登记函数收参数了就算完 —— `onLoadingChanged` 那一路
   * 没有 URL 参数可传,只能读这里,所以真源必须是 ref 而不是 state。
   */
  const lastUrlRef = useRef(X_HOME);

  const registerHost = useCallback(() => {
    const id = hostRef.current?.getWebContentsId() ?? null;
    if (id != null) setXHostState(workspaceId, id, lastUrlRef.current);
  }, [workspaceId]);

  useEffect(() => () => clearXHostState(workspaceId), [workspaceId]);

  /**
   * ⭐⭐ 抽查(2026-10-16):右键「查库」后,主进程存下请求;这里每秒问一次(X 无推送通道)。
   * 拿到就交给运营面板;右栏不是运营就打开它(用户选 A:「没开就自动打开」)。
   */
  useEffect(() => {
    let after = 0;
    let alive = true;
    const t = setInterval(() => {
      void xDataCall({ op: 'spotCheckPoll', wsId: workspaceId, after }).then((r) => {
        if (!alive || r.status !== 'ok' || r.value === null) return;
        const req = r.value as SpotReq;
        after = req.seq;
        setSpot(workspaceId, req);
        const bus = workspaceManager.getBus(workspaceId);
        if (bus && workspaceManager.get(workspaceId)?.slotBinding.right !== X_OPS_VIEW_ID) bus.slot.openRight(X_OPS_VIEW_ID);
      });
    }, 1000);
    return () => { alive = false; clearInterval(t); };
  }, [workspaceId]);

  /**
   * ⊞ 右栏视图切换 —— ⭐ 复用**全局 SlotPicker**,不自造 toggle 逻辑
   * (与 Note / AI / Mail 同一套机制;铁律:同功能同逻辑)。
   *
   * popup 从 `viewTypeRegistry` **动态列出**所有 view ——
   * 所以「运营」「任务」会自动出现在里面,不必在这里写死它。
   *
   * ⚠️ 没有这个按钮,右栏那个独立 view 就**召不出来** ——
   * 实测第一版漏了它(别的 view 都有)。
   */
  const handleOpenSlotPicker = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    slotPickerContext.setCommandId('x-view.open-right-slot');
    popupController.toggle(SLOT_PICKER_POPUP_ID, e.currentTarget);
  }, []);


  /**
   * ⭐⭐ 「运营」按钮 —— 用户 2026-10-07:「同意叫运营-在toolbar中放置这样的button，
   * 点击后弹出right slot view」。
   * ⚠️ 与操作台同一手法:读「右栏现在装的是谁」是读状态,不是猜自己在哪一栏。
   */
  const opsOpen = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => workspaceManager.get(workspaceId)?.slotBinding.right === X_OPS_VIEW_ID,
  );

  const handleToggleOps = useCallback(() => {
    const bus = workspaceManager.getBus(workspaceId);
    if (!bus) return;
    // ⚠️ 用当下的真状态判断,不缓存
    const openNow = workspaceManager.get(workspaceId)?.slotBinding.right === X_OPS_VIEW_ID;
    if (openNow) bus.slot.closeRight();
    else bus.slot.openRight(X_OPS_VIEW_ID);
  }, [workspaceId]);

  /** ⭐⭐ 「任务」按钮(2026-10-16)—— 与运营同一手法:读「右栏现在装的是谁」 */
  const taskOpen = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => workspaceManager.get(workspaceId)?.slotBinding.right === X_TASK_VIEW_ID,
  );
  const handleToggleTask = useCallback(() => {
    const bus = workspaceManager.getBus(workspaceId);
    if (!bus) return;
    const openNow = workspaceManager.get(workspaceId)?.slotBinding.right === X_TASK_VIEW_ID;
    if (openNow) bus.slot.closeRight();
    else bus.slot.openRight(X_TASK_VIEW_ID);
  }, [workspaceId]);

  /** ✕ 关掉本栏 —— 用框架给的 slot(见文件头「handleClose 用 slot prop,不推导」),与 note / 运营同一手法 */
  const handleClose = useCallback(() => {
    const bus = workspaceManager.getBus(workspaceId);
    if (!bus) return;
    if (slot === 'right') bus.slot.closeRight();
    else bus.slot.closeLeft();
  }, [workspaceId, slot]);

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
        {/* ⭐ 业务平台入口:开/关右栏的「运营」 */}
        <button
          type="button"
          onClick={handleToggleOps}
          title={opsOpen ? '关闭运营' : '打开运营'}
          style={{
            background: opsOpen ? 'var(--accent-bg, #2d4a6b)' : 'transparent',
            border: '1px solid var(--border-color, #444)',
            borderRadius: 4,
            color: opsOpen ? 'var(--text-primary, #ddd)' : 'var(--text-secondary, #aaa)',
            cursor: 'pointer', fontSize: 12, padding: '3px 8px', flex: '0 0 auto',
          }}
        >
          📊 运营
        </button>
        {/* ⭐ 编排好的业务流程(蓝V互关 …):开/关右栏的「任务」 */}
        <button
          type="button"
          onClick={handleToggleTask}
          title={taskOpen ? '关闭任务' : '打开任务'}
          style={{
            background: taskOpen ? 'var(--accent-bg, #2d4a6b)' : 'transparent',
            border: '1px solid var(--border-color, #444)',
            borderRadius: 4,
            color: taskOpen ? 'var(--text-primary, #ddd)' : 'var(--text-secondary, #aaa)',
            cursor: 'pointer', fontSize: 12, padding: '3px 8px', flex: '0 0 auto',
          }}
        >
          📋 任务
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
        <button
          type="button"
          onClick={handleClose}
          title="关闭 X"
          style={{
            background: 'transparent', border: 'none', color: 'var(--text-secondary, #aaa)',
            cursor: 'pointer', fontSize: 14, padding: '3px 6px', flex: '0 0 auto',
          }}
        >
          ✕
        </button>
      </div>

      {/* ⭐ 发推第②期:note 填进 X 发推框后,在这里确认 / 取消(没有待发草稿时不占地方) */}
      <XPostBar wsId={workspaceId} />

      {/* ⭐ 真 webview —— 与同 ws 的内置浏览器同 partition(登录态共享) */}
      <Host
        ref={hostRef}
        workspaceId={workspaceId}
        currentUrl={url}
        translateMode={false}
        partition={`persist:webview-${workspaceId}`}
        style={{ flex: 1, width: '100%' }}
        /**
         * ⭐ ref 与 state **同时**赋值 —— ref 给登记用(即刻生效),
         * state 给渲染用(Host 的受控 prop)。见 `lastUrlRef` 的注释。
         */
        onDisplayUrlChanged={(u) => { lastUrlRef.current = u; setUrl(u); registerHost(); }}
        /** ⚠️ 这一路只为补「wcId 晚于首次导航才可取」—— URL 一律读 ref */
        onLoadingChanged={registerHost}
      />

      {/* ⚠️ slot 只用于调试显示;真要关栏时由框架给的 slot 决定,不自己推导 */}
      <div style={{ display: 'none' }} data-slot={slot ?? 'unknown'} />
    </div>
  );
}
