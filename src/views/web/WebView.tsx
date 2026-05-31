/**
 * WebView — 视图主组件(L5-B4 / W4.2 C4 重构)
 *
 * View 归属(charter § 1.4):仅做"组合 + 状态订阅 + 命令注册"。webview tag 生命周期、
 * SyncDriver lifecycle、URL 同步、context-menu 转发等 webview 编排全部封装在
 * `web-rendering` capability 的 <Host /> 组件内,view 通过 props/callbacks/ref 协作。
 *
 * View 仍持有的部分:
 * - per-ws state 订阅(currentUrl / targetLang)+ slotBinding 订阅(translateMode)
 * - WebToolbar UI + 命令路由(命令式 ref 调 host)
 * - 切语言 banner(只是 transient UI 状态,跟翻译能力关系不大)
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
import { WEBVIEW_PARTITION } from '@shared/constants/webview';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { HostHandle, WebRenderingApi } from '@capabilities/web-rendering/types';
import type { WebFoundInPageResult } from '@capabilities/web-rendering/webview-types';
import { getWebWsState, setWebUrl, setWebTargetLang } from './data-model';
import { recordVisit } from './web-history';
import { showWebContextMenu } from './context-menu-integration';
import { WebToolbar } from './WebToolbar';
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
  const hostRef = useRef<HostHandle | null>(null);
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

  // Toolbar 用的 transient state(由 Host callback 推送)
  const [loading, setLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [displayUrl, setDisplayUrl] = useState(wsState?.currentUrl ?? 'about:blank');

  /**
   * L5-B4.2.2:切语言后到重启 app 前的 banner 标志(transient,不持久化)
   *
   * mount 时锁定的 lang(给 TranslateDriver 用)和 wsState.targetLang(用户选的)不一致时,
   * 表示用户切了语言但还没重启 — 显示 banner。重启后 mount lang = wsState lang,banner 不显。
   * 切 ws 也会重置(useState 跟 workspaceId 走)
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

  // ── Host callback handlers ──
  const handleNavStateChanged = useCallback(
    (state: { canGoBack: boolean; canGoForward: boolean }) => {
      setCanGoBack(state.canGoBack);
      setCanGoForward(state.canGoForward);
    },
    [],
  );
  const handleUrlChanged = useCallback(
    (url: string) => {
      setWebUrl(workspaceId, url);
      // 轻量全局历史(地址栏补全用,非 per-ws)
      recordVisit(url, '');
    },
    [workspaceId],
  );

  // ── toolbar 命令(走 host imperative API)──
  const handleNavigate = useCallback((url: string) => {
    hostRef.current?.loadURL(url);
  }, []);
  const handleGoBack = useCallback(() => hostRef.current?.goBack(), []);
  const handleGoForward = useCallback(() => hostRef.current?.goForward(), []);
  const handleReload = useCallback(() => {
    const host = hostRef.current;
    if (!host) return;
    if (host.isLoading()) host.stop();
    else host.reload();
  }, []);

  // ── P0:页内查找回调 ──
  const handleFoundInPage = useCallback((result: WebFoundInPageResult) => {
    setFindResult(result);
  }, []);

  /** 打开查找栏(⌘F)*/
  const openFind = useCallback(() => {
    setFindOpen(true);
    // 已有查询词 → 立即重查(打开时 FindBar 会 focus+select)
    setFindResult({ activeMatchOrdinal: 0, matches: 0 });
  }, []);

  /** 关闭查找栏 + 清选区 */
  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindResult({ activeMatchOrdinal: 0, matches: 0 });
    hostRef.current?.stopFindInPage('clearSelection');
  }, []);

  /** 查找词变化 → 新查找(findNext: false) */
  const handleFindQueryChange = useCallback((q: string) => {
    setFindQuery(q);
    if (!q.trim()) {
      hostRef.current?.stopFindInPage('clearSelection');
      setFindResult({ activeMatchOrdinal: 0, matches: 0 });
      return;
    }
    hostRef.current?.findInPage(q, { forward: true, findNext: false });
  }, []);

  /** 下一个 / 上一个(findNext: true) */
  const handleFindNext = useCallback(
    (forward: boolean) => {
      const q = findQuery.trim();
      if (!q) return;
      hostRef.current?.findInPage(q, { forward, findNext: true });
    },
    [findQuery],
  );

  // ── P0:缩放回调 ──
  const handleZoomIn = useCallback(() => {
    const f = hostRef.current?.zoomIn() ?? 1;
    setZoomPercent(Math.round(f * 100));
  }, []);
  const handleZoomOut = useCallback(() => {
    const f = hostRef.current?.zoomOut() ?? 1;
    setZoomPercent(Math.round(f * 100));
  }, []);
  const handleZoomReset = useCallback(() => {
    hostRef.current?.zoomReset();
    setZoomPercent(100);
  }, []);

  /** ⌘L:focus + 全选地址栏 */
  const focusUrlBar = useCallback(() => {
    const el = urlInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  // ── P0:键盘快捷键 ──
  // 已知坑:页面 focus 在 webview 子 frame 时,key 事件不冒泡到宿主 onKeyDown
  // (见 context-menu-integration 注释)。先走宿主 onKeyDown 最简路径;若实测
  // webview 内不触发,后续可上主进程 before-input-event。文档登记在汇报里。
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const mod = e.metaKey || e.ctrlKey;
      // 后退/前进:⌘[ ⌘]  或  Alt+← Alt+→
      if (mod && e.key === '[') {
        e.preventDefault();
        hostRef.current?.goBack();
      } else if (mod && e.key === ']') {
        e.preventDefault();
        hostRef.current?.goForward();
      } else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        hostRef.current?.goBack();
      } else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        hostRef.current?.goForward();
      } else if ((mod && e.key === 'r') || e.key === 'F5') {
        // 刷新:⌘R / F5
        e.preventDefault();
        hostRef.current?.reload();
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
    [focusUrlBar, openFind, handleZoomIn, handleZoomOut, handleZoomReset],
  );

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

  if (!wsState) {
    return <div className="krig-web-view__empty">Workspace 未就绪</div>;
  }

  return (
    <div
      className="krig-web-view"
      ref={containerRef}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <WebToolbar
        url={displayUrl}
        loading={loading}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        translateActive={isTranslateMode}
        currentTargetLang={wsState.targetLang}
        onNavigate={handleNavigate}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        onReload={handleReload}
        onToggleTranslate={handleToggleTranslate}
        onSelectLang={handleSelectLang}
        urlInputRef={urlInputRef}
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
      <Host
        ref={hostRef}
        workspaceId={workspaceId}
        currentUrl={wsState.currentUrl}
        translateMode={isTranslateMode}
        partition={WEBVIEW_PARTITION}
        className="krig-web-view__webview"
        onContextMenu={showWebContextMenu}
        onUrlChanged={handleUrlChanged}
        onLoadingChanged={setLoading}
        onNavStateChanged={handleNavStateChanged}
        onDisplayUrlChanged={setDisplayUrl}
        onFoundInPage={handleFoundInPage}
      />
    </div>
  );
}
