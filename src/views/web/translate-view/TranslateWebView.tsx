/**
 * TranslateWebView — 右栏翻译 webview(L5-B4.2 / L5-B4.2.2)
 *
 * 跟 WebView 区别:
 * - 启用 disablewebsecurity 旁路 CSP(允许 Google Translate CDN 注入)
 * - did-finish-load 时自动 TranslateDriver.inject + SyncDriver.start
 * - 砍 WebToolbar 导航按钮(导航由左栏触发,翻译栏纯被动)
 *
 * targetLang(L5-B4.2.2):
 * - 从 per-ws state 读(workspace pluginStates['web'].targetLang)
 * - **mount 时读一次** — 运行时切语言不可靠是 widget 注入路径的固有限制,
 *   所以切语言走 WebToolbar → 写 per-ws state + banner 提示重启 app
 * - 顶部 select 已删,统一入口在 WebToolbar(避免双入口)
 *
 * 通信:走 slot-bus(side: 'right'),sync-driver 自动处理 NAVIGATE / SYNC_EVENTS / TAKE_CONTROL
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { WEBVIEW_TRANSLATE_PARTITION } from '@shared/constants/webview';
import { SyncDriver, type WebviewElement } from '../sync/sync-driver';
import { SYNC_ACTION, WEB_TRANSLATE_PROTOCOL } from '../sync/sync-protocol';
import { slotBus } from '../slot-bus';
import { TranslateDriver } from '../translate/translate-driver';
import { getWebWsState, setWebTargetLang } from '../data-model';
import { getDefaultTargetLang, getLangLabel, LANG_OPTIONS } from './lang-defaults';

interface ExtendedWebviewElement extends WebviewElement {
  loadURL(url: string): void;
  getURL(): string;
}

interface TranslateWebViewProps {
  workspaceId: string;
}

export function TranslateWebView({ workspaceId }: TranslateWebViewProps) {
  const webviewRef = useRef<ExtendedWebviewElement | null>(null);
  const syncDriverRef = useRef<SyncDriver | null>(null);
  const translateDriverRef = useRef<TranslateDriver | null>(null);
  /** "对面 NAVIGATE 触发的导航"时间窗口(2 秒内的 did-navigate 不回发,防回环)*/
  const remoteNavUntilRef = useRef(0);
  const initSentRef = useRef(false);
  const domReadyRef = useRef(false);
  /** 对面 NAVIGATE 来得比 dom-ready 早时暂存 URL,ready 后执行 */
  const pendingNavigateUrlRef = useRef<string | null>(null);

  // 从 per-ws state 取 targetLang(mount 时读 — 运行时变化不影响已注入的 widget)
  const wsTargetLang = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = workspaceManager.get(workspaceId);
      return ws ? getWebWsState(ws).targetLang : getDefaultTargetLang();
    },
  );
  /** mount 时锁定的 targetLang(给 driver 用 — 后续 wsTargetLang 变化不重 inject)*/
  const initialTargetLangRef = useRef(wsTargetLang);

  // ── 订阅 slot-bus 接收对面消息 ──
  useEffect(() => {
    const unsub = slotBus.subscribe('right', (msg) => {
      if (msg.protocol !== WEB_TRANSLATE_PROTOCOL) return;
      switch (msg.action) {
        case SYNC_ACTION.TAKE_CONTROL:
          syncDriverRef.current?.yield();
          break;
        case SYNC_ACTION.SYNC_EVENTS: {
          const p = msg.payload as { events: unknown[]; fromSide: 'left' | 'right' };
          const driver = syncDriverRef.current;
          if (driver) {
            driver.handleRemoteEvents(
              p.events as Parameters<typeof driver.handleRemoteEvents>[0],
              p.fromSide,
            );
          }
          break;
        }
        case SYNC_ACTION.NAVIGATE: {
          const url = (msg.payload as { url: string }).url;
          if (!url || url === 'about:blank') break;
          if (webviewRef.current && domReadyRef.current) {
            remoteNavUntilRef.current = Date.now() + 2000;
            webviewRef.current.loadURL(url);
          } else {
            // webview 未 dom-ready 时暂存,handleDomReady 内 flush
            pendingNavigateUrlRef.current = url;
          }
          break;
        }
      }
    });
    return () => unsub();
  }, []);

  // ── webview ref callback ──
  const setupWebview = useCallback((el: HTMLElement | null) => {
    if (!el) {
      webviewRef.current = null;
      return;
    }
    const wv = el as ExtendedWebviewElement;
    if (webviewRef.current === wv) return;
    webviewRef.current = wv;

    // 创建 TranslateDriver(注入期间 SyncDriver 跳过 poll,通过 isBusy 联动)
    // targetLang 用 mount 时锁定的值 — 运行时切 lang 走重启路径,不在此组件刷新
    const td = new TranslateDriver(initialTargetLangRef.current);
    translateDriverRef.current = td;

    // 创建 SyncDriver(右侧角色;W4.2 C1:bus 接口注入)
    const driver = new SyncDriver('right', slotBus, undefined, () => td.injecting);
    driver.bind(wv);
    syncDriverRef.current = driver;

    const handleDomReady = () => {
      domReadyRef.current = true;
      // 处理 dom-ready 之前收到的 NAVIGATE(REQUEST_URL → 左栏 NAVIGATE 抢先到达)
      const pending = pendingNavigateUrlRef.current;
      if (pending) {
        pendingNavigateUrlRef.current = null;
        remoteNavUntilRef.current = Date.now() + 2000;
        wv.loadURL(pending);
      }
    };

    // did-finish-load:启动同步 + 异步注入翻译
    const handleFinishLoad = () => {
      const url = wv.getURL();
      if (!url || url === 'about:blank') return;
      driver.start();
      slotBus.sendFromSide('right', {
        protocol: WEB_TRANSLATE_PROTOCOL,
        action: SYNC_ACTION.READY,
        payload: {},
      });
      // 异步注入翻译(fire-and-forget)
      td.inject(wv).catch(() => {});
    };

    // did-navigate:用户主动导航时 takeControl + 通知对面
    const handleDidNavigate = (e: Event) => {
      driver.reinject();
      const ev = e as Event & { url?: string };
      const url = ev.url ?? wv.getURL();
      // 忽略 about:blank(初始 src 加载,不应回发 NAVIGATE 把左栏冲掉)
      if (!url || url === 'about:blank') return;
      if (Date.now() < remoteNavUntilRef.current) {
        // 时间窗内 — 对面触发,不回发
      } else {
        driver.takeControl();
        slotBus.sendFromSide('right', {
          protocol: WEB_TRANSLATE_PROTOCOL,
          action: SYNC_ACTION.NAVIGATE,
          payload: { url },
        });
      }
    };

    wv.addEventListener('dom-ready', handleDomReady);
    wv.addEventListener('did-finish-load', handleFinishLoad);
    wv.addEventListener('did-navigate', handleDidNavigate);
    wv.addEventListener('did-navigate-in-page', handleDidNavigate);

    // 首次 mount 完后请求左侧发当前 URL(REQUEST_URL)
    if (!initSentRef.current) {
      initSentRef.current = true;
      queueMicrotask(() => {
        slotBus.sendFromSide('right', {
          protocol: WEB_TRANSLATE_PROTOCOL,
          action: SYNC_ACTION.REQUEST_URL,
          payload: {},
        });
      });
    }
    // 不依赖 wsTargetLang — driver 创建时用初始 targetLang 即可,
    // 后续 lang 变化(写 per-ws state)由 banner + 重启路径处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 组件 unmount 时清理 driver ──
  useEffect(() => {
    return () => {
      syncDriverRef.current?.destroy();
      syncDriverRef.current = null;
      translateDriverRef.current = null;
    };
  }, []);

  // ── 顶部信息条:语言下拉菜单状态 ──
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const langMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!langMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!langMenuRef.current) return;
      if (!langMenuRef.current.contains(e.target as Node)) {
        setLangMenuOpen(false);
      }
    };
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
    };
  }, [langMenuOpen]);

  // 切语言:写 per-ws state(WebView 侧的 banner 会自动 fire — slotBinding right=translate-view)
  const handleSelectLang = useCallback(
    (lang: string) => {
      setLangMenuOpen(false);
      if (lang === wsTargetLang) return;
      setWebTargetLang(workspaceId, lang);
      // 注:实际生效仍需重启(widget 注入路径限制),WebView 顶部 banner 会提示用户
    },
    [workspaceId, wsTargetLang],
  );

  // 关闭翻译模式(× 按钮)
  const handleCloseTranslate = useCallback(() => {
    const ws = workspaceManager.get(workspaceId);
    if (!ws) return;
    workspaceManager.update(workspaceId, {
      slotBinding: { ...ws.slotBinding, right: null },
    });
  }, [workspaceId]);

  return (
    <div className="krig-translate-web-view">
      {/* L5-B4.2.2 顶部信息条 — 跟左栏 WebToolbar 高度对齐,显示译文方向 + 切语言 + 关闭 */}
      <div className="krig-translate-bar">
        <div className="krig-translate-bar__direction">
          <span className="krig-translate-bar__source">自动检测</span>
          <span className="krig-translate-bar__arrow">→</span>
          <span className="krig-translate-bar__target">{getLangLabel(wsTargetLang)}</span>
        </div>
        <div className="krig-translate-bar__actions" ref={langMenuRef}>
          <button
            type="button"
            className="krig-translate-bar__btn"
            onClick={() => setLangMenuOpen((v) => !v)}
            title="切换目标语言"
            aria-expanded={langMenuOpen}
          >
            ▾
          </button>
          <button
            type="button"
            className="krig-translate-bar__btn"
            onClick={handleCloseTranslate}
            title="关闭翻译"
            aria-label="关闭翻译"
          >
            ×
          </button>
          {langMenuOpen && (
            <div className="krig-translate-bar__lang-menu" role="menu">
              {LANG_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="menuitem"
                  className={`krig-translate-bar__lang-item${
                    opt.value === wsTargetLang ? ' active' : ''
                  }`}
                  onClick={() => handleSelectLang(opt.value)}
                >
                  <span className="krig-translate-bar__lang-check">
                    {opt.value === wsTargetLang ? '✓' : ''}
                  </span>
                  <span className="krig-translate-bar__lang-label">{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {(() => {
        // webview tag — disablewebsecurity 旁路 CSP(允许 Google Translate CDN 注入)
        const props = {
          ref: setupWebview,
          src: 'about:blank',
          partition: WEBVIEW_TRANSLATE_PARTITION,
          allowpopups: 'true',
          disablewebsecurity: 'true',
          className: 'krig-translate-web-view__webview',
        };
        const Tag = 'webview' as unknown as React.ComponentType<typeof props>;
        return <Tag {...props} />;
      })()}
    </div>
  );
}
