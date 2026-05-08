/**
 * web-rendering capability — TranslateHost 组件(翻译模式 webview)
 *
 * 跟 Host 的差别:
 * - 启用 disablewebsecurity 旁路 CSP(允许 Google Translate CDN 注入)
 * - 创建 TranslateDriver 在 did-finish-load 时注入 Google Translate widget
 * - SyncDriver 角色为 'right',被动跟随左栏导航
 * - 不持久化 URL(右栏导航完全由左栏 NAVIGATE 推动)
 *
 * 接口契约:
 * - props 注入:workspaceId / partition / targetLang / className
 * - 不需要 imperative ref(右栏不接受外部命令式调用,所有交互来自左栏 slot-bus)
 *
 * 历史(W4.2 C3):原 webview 编排在 src/views/web/translate-view/TranslateWebView.tsx
 * L96-L187,本组件直接复制业务逻辑,跟 view 拆分(view 留 translate-bar UI)。
 */

import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { SyncDriver, SYNC_ACTION, WEB_TRANSLATE_PROTOCOL } from '@drivers/web-sync-driver';
import { TranslateDriver } from '@drivers/web-translate-driver';
import { slotBus } from './slot-bus';
import type { WebviewElement } from './webview-types';

interface ExtendedWebviewElement extends WebviewElement {
  loadURL(url: string): void;
  getURL(): string;
}

export interface TranslateHostProps {
  /** 当前 ws id(用于 debug 标识 / 未来 per-ws 行为差异)*/
  workspaceId: string;
  /** webview tag partition(translate 用独立 partition,跟主 webview 隔离)*/
  partition: string;
  /** 翻译目标语言(mount 时锁定 — 运行时变化走重启路径,host 不响应)*/
  targetLang: string;
  /** webview 容器 className */
  className?: string;
}

export function TranslateHost(props: TranslateHostProps): ReactElement {
  const { workspaceId, partition, targetLang, className } = props;

  const webviewRef = useRef<ExtendedWebviewElement | null>(null);
  const syncDriverRef = useRef<SyncDriver | null>(null);
  const translateDriverRef = useRef<TranslateDriver | null>(null);
  /** "对面 NAVIGATE 触发的导航"时间窗口(2 秒内的 did-navigate 不回发,防回环)*/
  const remoteNavUntilRef = useRef(0);
  const initSentRef = useRef(false);
  const domReadyRef = useRef(false);
  /** 对面 NAVIGATE 来得比 dom-ready 早时暂存 URL,ready 后执行 */
  const pendingNavigateUrlRef = useRef<string | null>(null);

  /** mount 时锁定的 targetLang(给 driver 用 — 后续 wsTargetLang 变化不重 inject)*/
  const initialTargetLangRef = useRef(targetLang);

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
    const td = new TranslateDriver(initialTargetLangRef.current);
    translateDriverRef.current = td;

    // 创建 SyncDriver(右侧角色;bus 接口注入 — Wave 4.2 C1)
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
    // workspaceId 当前不直接用,保留依赖以便未来 per-ws 行为差异
    void workspaceId;
  }, [workspaceId]);

  // ── 组件 unmount 时清理 driver ──
  useEffect(() => {
    return () => {
      syncDriverRef.current?.destroy();
      syncDriverRef.current = null;
      translateDriverRef.current = null;
    };
  }, []);

  // webview tag — disablewebsecurity 旁路 CSP(允许 Google Translate CDN 注入)
  const tagProps = {
    ref: setupWebview,
    src: 'about:blank',
    partition,
    allowpopups: 'true',
    disablewebsecurity: 'true',
    className,
  };
  const Tag = 'webview' as unknown as React.ComponentType<typeof tagProps>;
  return <Tag {...tagProps} />;
}
