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

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { WEBVIEW_PARTITION } from '@shared/constants/webview';
import { Host, type HostHandle } from '@capabilities/web-rendering';
import { getWebWsState, setWebUrl, setWebTargetLang } from './data-model';
import { showWebContextMenu } from './context-menu-integration';
import { WebToolbar } from './WebToolbar';
import { getLangLabel } from './translate-view/lang-defaults';
import './web.css';

interface WebViewProps {
  workspaceId: string;
}

export function WebView({ workspaceId }: WebViewProps) {
  const hostRef = useRef<HostHandle | null>(null);

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

  // ── Host callback handlers ──
  const handleNavStateChanged = useCallback(
    (state: { canGoBack: boolean; canGoForward: boolean }) => {
      setCanGoBack(state.canGoBack);
      setCanGoForward(state.canGoForward);
    },
    [],
  );
  const handleUrlChanged = useCallback(
    (url: string) => setWebUrl(workspaceId, url),
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

  // 切 workspace → 重置 banner state(避免 ws-A 切的 lang 在 ws-B 显 banner)
  useEffect(() => {
    setPendingRestartLang(null);
  }, [workspaceId]);

  if (!wsState) {
    return <div className="krig-web-view__empty">Workspace 未就绪</div>;
  }

  return (
    <div className="krig-web-view">
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
      />
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
      />
    </div>
  );
}
