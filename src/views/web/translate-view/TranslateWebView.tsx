/**
 * TranslateWebView — 右栏翻译 webview(L5-B4.2)
 *
 * 跟 WebView 区别:
 * - 启用 disablewebsecurity 旁路 CSP(允许 Google Translate CDN 注入)
 * - did-finish-load 时自动 TranslateDriver.inject + SyncDriver.start
 * - 顶部加语言选择器(中/日/韩/英)
 * - 砍 WebToolbar 导航按钮(导航由左栏触发,翻译栏纯被动)
 *
 * 通信:走 slot-bus(side: 'right'),sync-driver 自动处理 NAVIGATE / SYNC_EVENTS / TAKE_CONTROL
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { WEBVIEW_TRANSLATE_PARTITION } from '@shared/constants/webview';
import { SyncDriver, type WebviewElement } from '../sync/sync-driver';
import { SYNC_ACTION, WEB_TRANSLATE_PROTOCOL } from '../sync/sync-protocol';
import { slotBus } from '../slot-bus';
import { TranslateDriver } from '../translate/translate-driver';

const LANG_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'zh-CN', label: '中文' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'en', label: 'English' },
];

interface ExtendedWebviewElement extends WebviewElement {
  loadURL(url: string): void;
  getURL(): string;
}

export function TranslateWebView() {
  const webviewRef = useRef<ExtendedWebviewElement | null>(null);
  const syncDriverRef = useRef<SyncDriver | null>(null);
  const translateDriverRef = useRef<TranslateDriver | null>(null);
  /** "对面 NAVIGATE 触发的导航"时间窗口(2 秒内的 did-navigate 不回发,防回环)*/
  const remoteNavUntilRef = useRef(0);
  const initSentRef = useRef(false);
  const domReadyRef = useRef(false);
  /** 对面 NAVIGATE 来得比 dom-ready 早时暂存 URL,ready 后执行 */
  const pendingNavigateUrlRef = useRef<string | null>(null);

  const [targetLang, setTargetLang] = useState('zh-CN');

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

  // ── lang 变更:更新 driver + 重新注入(让 inject 脚本"已注入分支"切 lang)──
  useEffect(() => {
    const td = translateDriverRef.current;
    const wv = webviewRef.current;
    console.log(
      '[translate-view] lang useEffect — targetLang:', targetLang,
      ', td:', !!td, ', wv:', !!wv, ', domReady:', domReadyRef.current,
    );
    if (!td || !wv || !domReadyRef.current) return;
    td.setTargetLang(targetLang);
    console.log('[translate-view] lang 变更触发重新 inject:', targetLang);
    // 重新 inject,触发 inject 脚本头部的"language changed"分支:
    // 写新 cookie + 重置 select 选中 + dispatchEvent('change') → widget 刷新翻译
    td.inject(wv).catch(() => {});
  }, [targetLang]);

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
    const td = new TranslateDriver(targetLang);
    translateDriverRef.current = td;

    // 创建 SyncDriver(右侧角色)
    const driver = new SyncDriver('right', undefined, () => td.injecting);
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
    // 注:不依赖 targetLang — driver 创建时用初始 targetLang 即可,
    // 后续 lang 变化由独立 useEffect [targetLang] 内 td.setTargetLang + reinject 处理。
    // 若依赖 targetLang,setupWebview 会重生成 → React 解绑 webview ref → driver 被重建 →
    // [targetLang] 内 td 还是 null 错乱。
  }, []);

  // ── 组件 unmount 时清理 driver ──
  useEffect(() => {
    return () => {
      syncDriverRef.current?.destroy();
      syncDriverRef.current = null;
      translateDriverRef.current = null;
    };
  }, []);

  return (
    <div className="krig-translate-web-view">
      <div className="krig-translate-toolbar">
        <select
          className="krig-translate-toolbar__lang"
          value={targetLang}
          onChange={(e) => setTargetLang(e.target.value)}
          title="目标语言"
        >
          {LANG_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
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
