import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

const VIEW_ID = 'social-view';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { useOnSlotVisible } from '@workspace/workspace-state/slot-visibility';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { XExtractionApi, XHostHandle } from '@capabilities/x-extraction';
import { XPublishOverlay } from '@shell/global-progress-overlay/XPublishOverlay';
import './social.css';

type PlatformId = 'x';

const PLATFORMS: Array<{ id: PlatformId; name: string; icon: string }> = [
  { id: 'x', name: 'X', icon: '𝕏' },
  // 未来: { id: 'reddit', name: 'Reddit', icon: '🤖' },
];

interface SocialViewProps {
  workspaceId: string;
  payload?: unknown;
}

function getActivePlatform(workspaceId: string): PlatformId {
  const ws = workspaceManager.get(workspaceId);
  const persisted = ws?.pluginStates?.['social'] as { activePlatform?: string } | undefined;
  return persisted?.activePlatform === 'x' ? 'x' : 'x';
}

function setActivePlatform(workspaceId: string, platform: PlatformId): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  workspaceManager.update(workspaceId, {
    pluginStates: {
      ...(ws.pluginStates ?? {}),
      social: { activePlatform: platform },
    },
  });
}

export function SocialView({ workspaceId, payload }: SocialViewProps) {
  const xApi = useMemo(
    () => requireCapabilityApi<XExtractionApi>('x-extraction'),
    [],
  );
  const XHost = xApi.Host;
  const xHostRef = useRef<XHostHandle | null>(null);

  const activePlatform = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => getActivePlatform(workspaceId),
  );

  const isInRightSlot = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => workspaceManager.get(workspaceId)?.slotBinding.right === VIEW_ID,
  );

  // ── webview 重新布局的两个触发源 ────────────────────────────────────
  //
  // <webview> 是 OS 级 surface,和 EPUB/PDF/WebGL 一样是命令式渲染引擎:
  // 容器尺寸变了不会自愈,会停在上次布局算出的尺寸上。dff9e5d0 为这类引擎
  // 建了 slot-visibility,但当时只接了 ebook / graph-canvas,**X 漏接了** ——
  // 于是右槽打开把 X 挤成半宽后,x.com 内部仍以为自己全宽,不触发响应式断点,
  // 左侧导航该收起却一直摊开。
  //
  // 两个触发源都要接,少一个就有场景漏:
  //  ① 隐藏→重新上台(切走再切回):slot-visibility 管这个
  //  ② 一直可见但宽度变了(右槽开/关、拖分隔线):ResizeObserver 管这个
  const shellRef = useRef<HTMLDivElement | null>(null);

  useOnSlotVisible(workspaceId, VIEW_ID, () => {
    xHostRef.current?.relayout();
  });

  useEffect(() => {
    const el = shellRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    // 宽度没变就不打扰 guest(ResizeObserver 高度变化也会触发)。
    //
    // ⚠️ 但**不能**只在"宽度变了"时触发一次就完事:全屏/拖分隔线都是连续变化,
    // 那样只会在中途某个尺寸上排一次版,动画结束后的最终尺寸反而没人管
    // (旧实现用 lastWidth 锁死,正是这个 bug)。
    // 改成 debounce:连续变化只在**停下来之后**量一次,拿到的就是最终尺寸。
    let lastWidth = -1;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w <= 0 || w === lastWidth) return;   // 0 = 隐藏期,交给 ① 处理
      lastWidth = w;
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = null;
        xHostRef.current?.relayout();
      }, 120);
    });
    ro.observe(el);
    return () => {
      if (settleTimer) clearTimeout(settleTimer);
      ro.disconnect();
    };
  }, []);

  // ③ 窗口进/出全屏(点绿灯按钮)。
  //
  // ⚠️ 光靠 ② 的 ResizeObserver 不够:macOS 全屏是 ~0.5s 的动画,过程中容器宽度
  // 连续变化,observer 在**中途某个尺寸**上触发一次(lastWidth 随即锁住),
  // 而 guest 的 OS surface 落在动画结束后 —— 于是 X 按中途宽度排了版,
  // 动画结束再没有事件把它纠回来。表现就是"点全屏侧栏不展开,
  // 一按 Cmd+Opt+I 就弹出来"(用户 2026-09-01 实拍)。
  //
  // 主进程本来就在发 WINDOW_FULLSCREEN_CHANGED(main-window.ts:145),这里补上订阅:
  // 动画结束后再量一次,拿到的才是最终尺寸。
  useEffect(() => {
    const off = window.electronAPI?.onFullscreenChanged?.(() => {
      // 全屏动画结束后才是最终尺寸;等一拍再量,避免又量在动画中途
      setTimeout(() => xHostRef.current?.relayout(), 350);
    });
    return () => off?.();
  }, []);

  const handleCloseRightSlot = useCallback(() => {
    const bus = workspaceManager.getBus(workspaceId);
    bus?.slot.closeRight();
  }, [workspaceId]);

  const registerXWc = useCallback(() => {
    const wcId = xHostRef.current?.getWebContentsId() ?? null;
    if (wcId != null) xApi.registerXHostWcId(workspaceId, wcId);
  }, [xApi, workspaceId]);

  useEffect(() => {
    return () => xApi.clearXHostWcId(workspaceId);
  }, [xApi, workspaceId]);

  // payload.subId → 切换到指定平台（SlotPicker 子项选择时传入）
  useEffect(() => {
    if (!payload || typeof payload !== 'object') return;
    const { subId } = payload as { subId?: string };
    if (subId === 'x') setActivePlatform(workspaceId, 'x');
  }, [payload, workspaceId]);

  /**
   * 订阅 'x.open-tweet' — tweet block「Open original」触发 x-view.open-tweet 命令发的:
   * payload: { url: string, emittedAt: number }
   *
   * 收到 → 把 X webview 导航到该推文。
   * last-known pull + emittedAt 去重(应对 mount/切 ws 边角)。
   */
  const lastXNavAtRef = useRef(0);
  useEffect(() => {
    const bus = workspaceManager.getBus(workspaceId);
    if (!bus) return;
    const handle = (payload: unknown): void => {
      const p = (payload ?? {}) as { url?: string; emittedAt?: number };
      if (typeof p.url !== 'string' || !p.url) return;
      const ts = typeof p.emittedAt === 'number' ? p.emittedAt : Date.now();
      if (ts <= lastXNavAtRef.current) return;
      lastXNavAtRef.current = ts;
      xHostRef.current?.navigate(p.url);
    };
    const last = bus.channels.getLastValue('x.open-tweet');
    if (last) handle(last);
    const unsub = bus.channels.subscribe('x.open-tweet', handle);
    return () => unsub();
  }, [workspaceId]);

  /**
   * 订阅 'x.activate-launcher' — 「发到 X」注入前发的:
   * 让 SocialView 切到 X 平台,把 X webview 显示出来 + 注册 wcId,
   * main 侧 pasteTweet/pasteReply 才能拿到活跃 X webContents。
   */
  const lastXActivateAtRef = useRef(0);
  useEffect(() => {
    const bus = workspaceManager.getBus(workspaceId);
    if (!bus) return;
    const handle = (payload: unknown): void => {
      const p = (payload ?? {}) as { emittedAt?: number };
      const ts = typeof p.emittedAt === 'number' ? p.emittedAt : Date.now();
      if (ts <= lastXActivateAtRef.current) return;
      lastXActivateAtRef.current = ts;
      setActivePlatform(workspaceId, 'x');
    };
    const last = bus.channels.getLastValue('x.activate-launcher');
    if (last) handle(last);
    const unsub = bus.channels.subscribe('x.activate-launcher', handle);
    return () => unsub();
  }, [workspaceId]);

  return (
    <div className="krig-social-view" ref={shellRef}>
      <div className="krig-social-view__tabbar">
        <div className="krig-social-view__tabs">
          {PLATFORMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`krig-social-view__tab${item.id === activePlatform ? ' krig-social-view__tab--active' : ''}`}
              onClick={() => setActivePlatform(workspaceId, item.id)}
              title={item.name}
            >
              <span>{item.icon}</span>
              <span>{item.name}</span>
            </button>
          ))}
          <button
            type="button"
            className="krig-social-view__tab krig-social-view__tab--inbox"
            onClick={() => {
              const bus = workspaceManager.getBus(workspaceId);
              bus?.slot.openRight('x-inbox-view');
            }}
            title="X Inbox — 打开智能筛选面板"
          >
            <span>📥</span>
            <span>Inbox</span>
          </button>
        </div>
        <div className="krig-social-view__drag-spacer" />
        {isInRightSlot && (
          <button
            type="button"
            className="krig-social-view__close-btn"
            onClick={handleCloseRightSlot}
            title="关闭此面板"
          >
            ✕
          </button>
        )}
      </div>
      <XHost
        ref={xHostRef}
        workspaceId={workspaceId}
        className="krig-social-view__webview"
        onUrlChanged={() => { registerXWc(); }}
        onLoadingChanged={() => {}}
      />
      <XPublishOverlay />
    </div>
  );
}
