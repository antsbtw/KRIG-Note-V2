/**
 * WebView — 视图主组件(L5-B4 / W4.2 C4 重构 / Phase 4 多 tab)
 *
 * View 归属(charter § 1.4):仅做"组合 + 状态订阅 + 命令注册"。webview tag 生命周期、
 * SyncDriver lifecycle、URL 同步、context-menu 转发等 webview 编排全部封装在
 * `web-rendering` capability 的 <Host /> 组件内,view 通过 props/callbacks/ref 协作。
 *
 * Phase 4(Commit 1):web view 加内部 tab。
 * - 每 tab 一个常驻 <Host key={tab.id}>,display:none 切换(切 tab 不丢页面状态)。
 * - hostRef 改 Map<tabId, HostHandle>,toolbar 命令路由到活跃 tab。
 * - transient state(loading/url 等)只跟活跃 tab(回调带 tabId 区分,坑6)。
 * - ⌘T 新建 tab / ⌘W 关闭当前 tab。
 * - translateMode(Commit 1 简化):仅 tabs.length===1 时按原逻辑;多 tab 暂不开翻译,
 *   翻译×tab 单活跃留 Commit 2。
 *
 * View 仍持有的部分:
 * - per-ws state 订阅(tabs / activeTabId / targetLang)+ slotBinding 订阅(translateMode)
 * - WebToolbar UI + 命令路由(命令式 ref 调活跃 tab 的 host)
 * - 切语言 banner(只是 transient UI 状态)
 * - ws 切换时重置 banner
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { WEBVIEW_PARTITION, WEBVIEW_DEFAULT_URL } from '@shared/constants/webview';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { HostHandle, WebRenderingApi } from '@capabilities/web-rendering/types';
import type { WebFoundInPageResult } from '@capabilities/web-rendering/webview-types';
import {
  getWebWsState,
  setTabUrl,
  setWebTargetLang,
  addTab,
  closeTab,
  setActiveTab,
} from './data-model';
import { recordVisit } from './web-history';
import { WebToolbar } from './WebToolbar';
import { WebTabBar } from './WebTabBar';
import { WebFindBar } from './WebFindBar';
import { getLangLabel } from './translate-view/lang-defaults';
import './web.css';

interface WebViewProps {
  workspaceId: string;
}

export function WebView({ workspaceId }: WebViewProps) {
  // W5:间接路由拿 Host 组件(useMemo 缓存避免每次渲染重 require + 保持 React identity)
  const Host = useMemo(
    () => requireCapabilityApi<WebRenderingApi>('web-rendering').Host,
    [],
  );
  /** 每 tab 一个 HostHandle —— 命令路由到活跃 tab 的那个 */
  const hostMapRef = useRef<Map<string, HostHandle>>(new Map());
  /** 地址栏 input(⌘L focus)*/
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  /** 容器(键盘快捷键挂这里 + focus 兜底)*/
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 订阅 per-ws state
  const wsState = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = workspaceManager.get(workspaceId);
      return ws ? getWebWsState(ws) : null;
    },
  );

  /** 订阅 slotBinding.right 判断是否在双栏翻译模式 */
  const isTranslateMode = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = workspaceManager.get(workspaceId);
      return ws?.slotBinding.right === 'web-translate-view';
    },
  );

  const tabs = wsState?.tabs ?? [];
  const activeTabId = wsState?.activeTabId ?? '';

  /** 活跃 tab 的 host handle */
  const getActiveHost = useCallback(
    () => hostMapRef.current.get(activeTabId) ?? null,
    [activeTabId],
  );

  // Toolbar 用的 transient state(由活跃 tab 的 Host callback 推送)
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [displayUrl, setDisplayUrl] = useState('about:blank');

  /**
   * L5-B4.2.2:切语言后到重启 app 前的 banner 标志(transient,不持久化)
   */
  const [pendingRestartLang, setPendingRestartLang] = useState<string | null>(null);

  // ── P0:页内查找(⌘F)transient state ──
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findResult, setFindResult] = useState<WebFoundInPageResult>({
    activeMatchOrdinal: 0,
    matches: 0,
  });

  // ── P0:缩放指示(非 100% 时显示,transient 不持久化)──
  const [zoomPercent, setZoomPercent] = useState(100);

  // ── Host callback handlers(坑6:transient 只跟活跃 tab,回调带 tabId 区分)──
  const handleNavStateChanged = useCallback(
    (tabId: string, state: { canGoBack: boolean; canGoForward: boolean }) => {
      if (tabId !== activeTabId) return;
      setCanGoBack(state.canGoBack);
      setCanGoForward(state.canGoForward);
    },
    [activeTabId],
  );
  const handleUrlChanged = useCallback(
    (tabId: string, url: string) => {
      // url 持久化对每个 tab 都要做(非活跃 tab 后台导航也要存)
      setTabUrl(workspaceId, tabId, url);
      // 轻量全局历史(地址栏补全用,非 per-ws)
      recordVisit(url, '');
    },
    [workspaceId],
  );
  const handleLoadingChanged = useCallback(
    (tabId: string, isLoading: boolean) => {
      if (tabId !== activeTabId) return;
      setLoading(isLoading);
    },
    [activeTabId],
  );
  const handleDisplayUrlChanged = useCallback(
    (tabId: string, url: string) => {
      if (tabId !== activeTabId) return;
      setDisplayUrl(url);
    },
    [activeTabId],
  );
  const handleFoundInPage = useCallback(
    (tabId: string, result: WebFoundInPageResult) => {
      if (tabId !== activeTabId) return;
      setFindResult(result);
    },
    [activeTabId],
  );

  // ── toolbar 命令(走活跃 tab 的 host imperative API)──
  const handleNavigate = useCallback(
    (url: string) => {
      getActiveHost()?.loadURL(url);
    },
    [getActiveHost],
  );
  const handleGoBack = useCallback(() => getActiveHost()?.goBack(), [getActiveHost]);
  const handleGoForward = useCallback(() => getActiveHost()?.goForward(), [getActiveHost]);
  const handleReload = useCallback(() => {
    const host = getActiveHost();
    if (!host) return;
    if (host.isLoading()) host.stop();
    else host.reload();
  }, [getActiveHost]);

  /** 打开查找栏(⌘F)*/
  const openFind = useCallback(() => {
    setFindOpen(true);
    setFindResult({ activeMatchOrdinal: 0, matches: 0 });
  }, []);

  /** 关闭查找栏 + 清选区 */
  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindResult({ activeMatchOrdinal: 0, matches: 0 });
    getActiveHost()?.stopFindInPage('clearSelection');
  }, [getActiveHost]);

  /** 查找词变化 → 新查找(findNext: false) */
  const handleFindQueryChange = useCallback(
    (q: string) => {
      setFindQuery(q);
      if (!q.trim()) {
        getActiveHost()?.stopFindInPage('clearSelection');
        setFindResult({ activeMatchOrdinal: 0, matches: 0 });
        return;
      }
      getActiveHost()?.findInPage(q, { forward: true, findNext: false });
    },
    [getActiveHost],
  );

  /** 下一个 / 上一个(findNext: true) */
  const handleFindNext = useCallback(
    (forward: boolean) => {
      const q = findQuery.trim();
      if (!q) return;
      getActiveHost()?.findInPage(q, { forward, findNext: true });
    },
    [findQuery, getActiveHost],
  );

  // ── P0:缩放回调 ──
  const handleZoomIn = useCallback(() => {
    const f = getActiveHost()?.zoomIn() ?? 1;
    setZoomPercent(Math.round(f * 100));
  }, [getActiveHost]);
  const handleZoomOut = useCallback(() => {
    const f = getActiveHost()?.zoomOut() ?? 1;
    setZoomPercent(Math.round(f * 100));
  }, [getActiveHost]);
  const handleZoomReset = useCallback(() => {
    getActiveHost()?.zoomReset();
    setZoomPercent(100);
  }, [getActiveHost]);

  /** ⌘L:focus + 全选地址栏 */
  const focusUrlBar = useCallback(() => {
    const el = urlInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  // ── tab 操作 ──
  const handleNewTab = useCallback(() => {
    addTab(workspaceId, WEBVIEW_DEFAULT_URL);
  }, [workspaceId]);
  const handleCloseTab = useCallback(
    (tabId: string) => {
      closeTab(workspaceId, tabId);
    },
    [workspaceId],
  );
  const handleSelectTab = useCallback(
    (tabId: string) => {
      setActiveTab(workspaceId, tabId);
    },
    [workspaceId],
  );

  // ── Phase 4 Commit 2:web 快捷键分发(主进程 before-input-event 回推） ──
  // 把 action 字符串映射到现有 handler。这些 action 与
  // src/platform/main/web-shortcuts/handler.ts 的 matchShortcut 一一对应。
  const dispatchShortcut = useCallback(
    (action: string) => {
      switch (action) {
        case 'new-tab':
          handleNewTab();
          break;
        case 'close-tab':
          if (activeTabId) handleCloseTab(activeTabId);
          break;
        case 'focus-url':
          focusUrlBar();
          break;
        case 'find':
          openFind();
          break;
        case 'reload':
          handleReload();
          break;
        case 'zoom-in':
          handleZoomIn();
          break;
        case 'zoom-out':
          handleZoomOut();
          break;
        case 'zoom-reset':
          handleZoomReset();
          break;
        case 'go-back':
          getActiveHost()?.goBack();
          break;
        case 'go-forward':
          getActiveHost()?.goForward();
          break;
      }
    },
    [
      handleNewTab,
      handleCloseTab,
      activeTabId,
      focusUrlBar,
      openFind,
      handleReload,
      handleZoomIn,
      handleZoomOut,
      handleZoomReset,
      getActiveHost,
    ],
  );

  // closure 新鲜度:IPC 订阅只在 mount 时建一次,回调里读 ref 拿最新 dispatch
  // (别捕获 stale activeTabId/handlers）。每次 dispatchShortcut 变化刷新 ref。
  const dispatchShortcutRef = useRef(dispatchShortcut);
  useEffect(() => {
    dispatchShortcutRef.current = dispatchShortcut;
  }, [dispatchShortcut]);

  // 订阅主进程快捷键回推 + 弹窗导流(只建一次,回调走 ref 拿最新值）
  useEffect(() => {
    const offShortcut = window.electronAPI.onWebViewShortcut(({ action }) => {
      dispatchShortcutRef.current(action);
    });
    const offNewTab = window.electronAPI.onWebNewTab(({ url }) => {
      // 发弹窗的就是活跃 web view 的 webview → getActiveId 必为该 ws。
      const activeWsId = workspaceManager.getActiveId();
      if (!activeWsId || !url) return;
      addTab(activeWsId, url);
    });
    return () => {
      offShortcut();
      offNewTab();
    };
  }, []);

  // ── P0:键盘快捷键(宿主焦点兜底） ──
  // webview 焦点下 key 事件不冒泡到宿主 onKeyDown(webview 独立进程)→ 这套快捷键
  // 主力走主进程 before-input-event(见上方 onWebViewShortcut 订阅）。
  // 但**宿主焦点时**(刚切 tab、点了 toolbar/地址栏、还没点进网页)before-input-event
  // 不触发 → 保留宿主 onKeyDown 做兜底。两路靠焦点位置互斥(焦点要么在 webview、
  // 要么在宿主),不会同一次按键双触发,且都 dispatch 到同组幂等 handler。
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const mod = e.metaKey || e.ctrlKey;
      // 新建 tab:⌘T
      if (mod && e.key === 't') {
        e.preventDefault();
        handleNewTab();
      } else if (mod && e.key === 'w') {
        // 关闭当前 tab:⌘W(关到剩 1 → closeTab 回 DEFAULT_URL 单 tab,不关 view)
        e.preventDefault();
        if (activeTabId) handleCloseTab(activeTabId);
      } else if (mod && e.key === '[') {
        // 后退/前进:⌘[ ⌘]  或  Alt+← Alt+→
        e.preventDefault();
        getActiveHost()?.goBack();
      } else if (mod && e.key === ']') {
        e.preventDefault();
        getActiveHost()?.goForward();
      } else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        getActiveHost()?.goBack();
      } else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        getActiveHost()?.goForward();
      } else if ((mod && e.key === 'r') || e.key === 'F5') {
        // 刷新:⌘R / F5
        e.preventDefault();
        getActiveHost()?.reload();
      } else if (mod && e.key === 'l') {
        // focus 地址栏:⌘L
        e.preventDefault();
        focusUrlBar();
      } else if (mod && e.key === 'f') {
        // 页内查找:⌘F
        e.preventDefault();
        openFind();
      } else if (mod && (e.key === '+' || e.key === '=')) {
        // 放大:⌘+ (= 同键无 shift)
        e.preventDefault();
        handleZoomIn();
      } else if (mod && e.key === '-') {
        // 缩小:⌘-
        e.preventDefault();
        handleZoomOut();
      } else if (mod && e.key === '0') {
        // 复位:⌘0
        e.preventDefault();
        handleZoomReset();
      }
    },
    [
      focusUrlBar,
      openFind,
      handleZoomIn,
      handleZoomOut,
      handleZoomReset,
      handleNewTab,
      handleCloseTab,
      getActiveHost,
      activeTabId,
    ],
  );

  // × 关闭当前 web view:根据所在槽位调 closeLeft / closeRight
  // (照 ebook 模式判 slot,不硬编码 closeLeft —— web 可进 right slot,硬编码会误关 left)
  // (最后一个 view 时 closeLeft 自身拒绝,见 slot-control.ts 铁律 8)
  const handleClose = useCallback(() => {
    const ws = workspaceManager.get(workspaceId);
    const bus = workspaceManager.getBus(workspaceId);
    if (!ws || !bus) return;
    if (ws.slotBinding.right === 'web-view') {
      bus.slot.closeRight();
    } else {
      bus.slot.closeLeft();
    }
  }, [workspaceId]);

  // toggle 双栏翻译模式
  const handleToggleTranslate = useCallback(() => {
    const ws = workspaceManager.get(workspaceId);
    if (!ws) return;
    const next: 'web-translate-view' | null =
      ws.slotBinding.right === 'web-translate-view' ? null : 'web-translate-view';
    workspaceManager.update(workspaceId, {
      slotBinding: { ...ws.slotBinding, right: next },
    });
  }, [workspaceId]);

  // 用户选语言 — 翻译已开 → 写 per-ws state + 显示 banner;翻译未开 → 静默写
  const handleSelectLang = useCallback(
    (lang: string) => {
      if (lang === wsState?.targetLang) return;
      setWebTargetLang(workspaceId, lang);
      if (isTranslateMode) {
        setPendingRestartLang(lang);
      }
    },
    [workspaceId, wsState?.targetLang, isTranslateMode],
  );

  // 重启 app
  const handleRestartApp = useCallback(() => {
    window.electronAPI.restartApp();
  }, []);

  const handleDismissBanner = useCallback(() => {
    setPendingRestartLang(null);
  }, []);

  // 切 workspace → 重置 banner / 查找 / 缩放 transient state
  useEffect(() => {
    setPendingRestartLang(null);
    setFindOpen(false);
    setFindQuery('');
    setFindResult({ activeMatchOrdinal: 0, matches: 0 });
    setZoomPercent(100);
  }, [workspaceId]);

  // 切活跃 tab → 重置随活跃 tab 走的 transient(loading/导航能力/地址栏/查找/缩放)。
  // 这些值由新活跃 tab 的 Host dom-ready / 事件重新推送(坑6),先清避免显示旧 tab 的残值。
  useEffect(() => {
    setLoading(false);
    setCanGoBack(false);
    setCanGoForward(false);
    setFindOpen(false);
    setFindQuery('');
    setFindResult({ activeMatchOrdinal: 0, matches: 0 });
    setZoomPercent(100);
    // 地址栏先显示该 tab 持久化的 url(Host dom-ready 后会用真实 getURL 覆盖)
    const cur = tabs.find((t) => t.id === activeTabId);
    if (cur) setDisplayUrl(cur.url);
  }, [activeTabId]);

  /** ref 回调工厂:把每个 tab 的 HostHandle 收进 Map(unmount 时清掉)*/
  const makeHostRef = useCallback(
    (tabId: string) => (handle: HostHandle | null) => {
      if (handle) hostMapRef.current.set(tabId, handle);
      else hostMapRef.current.delete(tabId);
    },
    [],
  );

  if (!wsState) {
    return <div className="krig-web-view__empty">Workspace 未就绪</div>;
  }

  // Commit 2:翻译 × tab 单活跃 —— 翻译只对**活跃 tab**生效(取代 Commit 1 的
  // tabs.length===1 兜法）。任一时刻只一个 Host(活跃 tab 且翻译开)translateMode=true,
  // 即只一个 Host 订阅 slotBus 'left',不串台。toolbar 翻译按钮跟随是否开翻译。
  const translateActiveForToolbar = isTranslateMode;

  return (
    <div
      className="krig-web-view"
      ref={containerRef}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      {tabs.length >= 2 && (
        <WebTabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={handleSelectTab}
          onClose={handleCloseTab}
          onNewTab={handleNewTab}
        />
      )}
      <WebToolbar
        url={displayUrl}
        loading={loading}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        translateActive={translateActiveForToolbar}
        currentTargetLang={wsState.targetLang}
        onNavigate={handleNavigate}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        onReload={handleReload}
        onToggleTranslate={handleToggleTranslate}
        onSelectLang={handleSelectLang}
        urlInputRef={urlInputRef}
        onClose={handleClose}
      />
      {zoomPercent !== 100 && (
        <button
          type="button"
          className="krig-web-view__zoom-badge"
          onClick={handleZoomReset}
          title="点击复位 100% (⌘0)"
        >
          {zoomPercent}%
        </button>
      )}
      {findOpen && (
        <WebFindBar
          query={findQuery}
          activeMatchOrdinal={findResult.activeMatchOrdinal}
          matches={findResult.matches}
          onQueryChange={handleFindQueryChange}
          onFindNext={handleFindNext}
          onClose={closeFind}
        />
      )}
      {pendingRestartLang && (
        <div className="krig-web-view__restart-banner">
          <span className="krig-web-view__restart-msg">
            ⚠ 已选 <strong>{getLangLabel(pendingRestartLang)}</strong>,需重启 app 才生效
          </span>
          <button
            type="button"
            className="krig-web-view__restart-btn"
            onClick={handleRestartApp}
          >
            立即重启
          </button>
          <button
            type="button"
            className="krig-web-view__restart-dismiss"
            onClick={handleDismissBanner}
            title="稍后(关闭提示,下次启动应用)"
            aria-label="关闭提示"
          >
            ×
          </button>
        </div>
      )}
      {/* 下载 UI 已迁到 NavSide 下载段(进行中 + 历史),工具栏不再有下载图标。 */}
      {/* 每 tab 一个常驻 Host,display 切换(key=tab.id 保证各自独立 mount,
          initialUrlRef 不变量自动 per-tab 成立 —— 坑2)*/}
      <div className="krig-web-view__hosts">
        {tabs.map((tab) => (
          <Host
            key={tab.id}
            ref={makeHostRef(tab.id)}
            workspaceId={workspaceId}
            currentUrl={tab.url}
            // Commit 2:翻译 × tab 单活跃 —— 只有「活跃 tab 且翻译开」的 Host
            // translateMode=true,其余 tab false → 走 destroy 分支不订阅 slotBus 'left'。
            // 任一时刻只一个 Host 活跃订阅 'left',不串台。
            translateMode={isTranslateMode && tab.id === activeTabId}
            partition={WEBVIEW_PARTITION}
            className="krig-web-view__webview"
            style={{ display: tab.id === activeTabId ? 'inline-flex' : 'none' }}
            onUrlChanged={(url) => handleUrlChanged(tab.id, url)}
            onLoadingChanged={(l) => handleLoadingChanged(tab.id, l)}
            onNavStateChanged={(s) => handleNavStateChanged(tab.id, s)}
            onDisplayUrlChanged={(url) => handleDisplayUrlChanged(tab.id, url)}
            onFoundInPage={(r) => handleFoundInPage(tab.id, r)}
          />
        ))}
      </div>
    </div>
  );
}
