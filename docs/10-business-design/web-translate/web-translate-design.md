# Web Translate — 对称浏览翻译设计

## 概述

在 KRIG-Note 中实现双屏翻译浏览：
- 左 slot：普通 WebView，浏览原文网页
- 右 slot：翻译 WebView，加载同一 URL 并通过 Google Translate Element.js 自动翻译
- 双向同步：滚动、点击、输入、表单提交、文本选择高亮

## 核心设计原则

**遵守 KRIG-Note 的分层架构，上层不参与下层业务：**

1. **Shell（L2）**：只管 View 创建、布局、消息路由——不感知翻译/同步逻辑
2. **插件注册**：通过 WorkMode + Protocol + onViewCreated 钩子接入，不修改 shell.ts
3. **View 间通信**：走 ViewMessage 双工协议，框架只路由不解析 payload
4. **同步引擎运行在 renderer 层**：左右 host renderer 各自轮询自己的 guest，通过 ViewMessage 交换事件

## 架构总览

```
┌─ NavSide ─┤─ Left Slot (web) ──────┤D├── Right Slot (web-translate) ──┤
│           │                         │i│                                 │
│           │  Host Renderer          │v│  Host Renderer                  │
│           │  ┌─ WebView.tsx ──────┐ │ │  ┌─ TranslateWebView.tsx ────┐ │
│           │  │ SyncDriver (left)  │ │ │  │ SyncDriver (right)        │ │
│           │  │   ↕ poll guest     │ │ │  │   ↕ poll guest            │ │
│           │  │   ↕ ViewMessage ←──┼─┼─┼──┼─→ ViewMessage             │ │
│           │  └────────────────────┘ │ │  └────────────────────────────┘ │
│           │  ┌─ <webview> ────────┐ │ │  ┌─ <webview> ────────────────┐ │
│           │  │ 原文网页            │ │ │  │ 翻译后网页                  │ │
│           │  │ sync-inject.js     │ │ │  │ sync-inject.js             │ │
│           │  │ (side='left')      │ │ │  │ (side='right')             │ │
│           │  │                    │ │ │  │ google-translate-inject.js │ │
│           │  └────────────────────┘ │ │  └────────────────────────────┘ │
└───────────┴─────────────────────────┴─┴─────────────────────────────────┘
```

**数据流：**
```
左 guest 页面用户滚动
  → sync-inject.js 捕获 scroll-delta → window.__mirroSyncQueue
  → WebView.tsx SyncDriver 轮询 guest（webview.executeJavaScript）
  → viewAPI.sendToOtherSlot({ action: 'sync-events', payload: [...] })
  → 框架路由（ipcMain 不解析，直接转发）
  → TranslateWebView.tsx onMessage 接收
  → SyncDriver 应用到右 guest（webview.executeJavaScript）
```

## 注册

### WorkMode 注册

```typescript
// app.ts registerPlugins()

workModeRegistry.register({
  id: 'web-translate',
  viewType: 'web',
  variant: 'translate',
  icon: '🌐',
  label: 'Translate',
  order: 5,
  hidden: true,   // 仅作为 right slot，不在 NavSide tab 中显示
  onViewCreated: (_view, guestWebContents) => {
    // 在主进程设置 CSP 绕过（session 级别，必须在 guest 加载页面前生效）
    // 这是唯一需要在主进程做的事：guestWebContents.session 只能在主进程访问
    setupCSPBypass(guestWebContents);
  },
});
```

**为什么 CSP 绕过在 onViewCreated 中做？**
- `session.webRequest.onHeadersReceived` 只能在主进程的 WebContents 上调用
- 这是 Electron API 的限制，不是业务逻辑侵入——类似 extraction handler 拦截下载
- 与 `setupExtractionInterceptor(guestWebContents)` 同一模式

### Protocol 注册

```typescript
// app.ts registerPlugins()

protocolRegistry.register({
  id: 'web-translate',
  match: { left: { type: 'web' }, right: { type: 'web', variant: 'translate' } },
});
```

注册后，左 web ↔ 右 web(translate) 的 ViewMessage 自动允许路由。

### 左侧 web WorkMode 无需修改

`demo-c`（web）不需要新增 onViewCreated——左侧 WebView.tsx renderer 自己管理同步逻辑。

## 模块设计

### 层级划分

```
src/
├── main/
│   └── web-translate/              # 主进程侧（最小化）
│       └── csp-bypass.ts           # CSP 响应头拦截（onViewCreated 用）
│
├── plugins/
│   └── web/
│       ├── sync/                   # 同步引擎（renderer 侧）
│       │   ├── sync-driver.ts      # SyncDriver 类：轮询 + 发送 + 接收 + 应用
│       │   ├── sync-inject.js      # 注入到 guest 页面的事件采集脚本
│       │   └── sync-protocol.ts    # ViewMessage action 常量定义
│       ├── translate/              # 翻译注入（renderer 侧）
│       │   ├── translate-driver.ts # 翻译注入逻辑（renderer 内通过 webview API 执行）
│       │   └── google-translate-inject.js  # GT 初始化脚本
│       ├── components/
│       │   ├── WebView.tsx         # 修改：挂载 SyncDriver
│       │   ├── TranslateWebView.tsx  # 新增：翻译 WebView
│       │   └── WebToolbar.tsx      # 修改：增加翻译按钮
│       └── renderer.tsx            # 修改：增加 variant='translate' 分支
│
└── shared/
    └── types.ts                    # 修改：增加 IPC 通道（仅 WEB_TRANSLATE_SET_LANG）
```

**关键约束：**
- `src/main/web-translate/` 只有 `csp-bypass.ts` 一个文件——主进程最小化参与
- 同步引擎、翻译注入、导航同步全部在 `src/plugins/web/` 的 renderer 层完成
- shell.ts 零修改

### 主进程侧：CSP 绕过

**文件：`src/main/web-translate/csp-bypass.ts`**

```typescript
import type { WebContents } from 'electron';

/**
 * 拦截 HTTP 响应头，移除 CSP — 允许 Google Translate 脚本注入。
 *
 * 仅对 translate variant 的 webview guest session 生效。
 * 通过 onViewCreated 钩子调用，与 setupExtractionInterceptor 同一模式。
 */
export function setupCSPBypass(guestWebContents: WebContents): void {
  guestWebContents.session.webRequest.onHeadersReceived(
    { urls: ['*://*/*'] },
    (details, callback) => {
      const headers = { ...details.responseHeaders };
      delete headers['content-security-policy'];
      delete headers['Content-Security-Policy'];
      delete headers['content-security-policy-report-only'];
      delete headers['Content-Security-Policy-Report-Only'];
      callback({ responseHeaders: headers });
    },
  );
}
```

### Renderer 侧：同步引擎

#### 协议常量

**文件：`src/plugins/web/sync/sync-protocol.ts`**

```typescript
/** web-translate 协议的 ViewMessage action 常量 */
export const SYNC_ACTION = {
  // 导航同步
  NAVIGATE: 'wt:navigate',           // 左→右：URL 变更
  NAV_READY: 'wt:nav-ready',         // 右→左：页面加载完成，可开始同步

  // 事件同步（双向，80ms 批量）
  SYNC_EVENTS: 'wt:sync-events',     // 左↔右：同步事件批量传输

  // 语言设置
  SET_LANG: 'wt:set-lang',           // 右→左：目标语言变更（暂留）
} as const;
```

#### SyncDriver

**文件：`src/plugins/web/sync/sync-driver.ts`**

SyncDriver 运行在 host renderer 中，通过 `<webview>.executeJavaScript()` 与 guest 通信。

```typescript
import syncInjectRaw from './sync-inject.js?raw';
import { SYNC_ACTION } from './sync-protocol';

const SYNC_POLL_MS = 80;

/**
 * SyncDriver — renderer 侧的同步引擎
 *
 * 职责：
 * 1. 注入 sync-inject.js 到自己的 guest
 * 2. 轮询 guest 的 __mirroSyncQueue
 * 3. 通过 ViewMessage 发送到对面
 * 4. 接收对面的 ViewMessage，应用到自己的 guest
 *
 * 分别在 WebView.tsx 和 TranslateWebView.tsx 中各实例化一个。
 */
export class SyncDriver {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private webviewEl: Electron.WebviewTag | null = null;
  private active = false;

  constructor(
    private side: 'left' | 'right',
    private sendToOther: (message: { protocol: string; action: string; payload: unknown }) => void,
  ) {}

  /** 绑定 webview 元素 */
  bind(webview: Electron.WebviewTag): void {
    this.webviewEl = webview;
  }

  /** 页面加载完成后注入同步脚本并开始轮询 */
  start(): void {
    if (!this.webviewEl) return;
    this.injectSyncScript();
    this.active = true;
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => this.poll(), SYNC_POLL_MS);
    }
  }

  /** 页面导航后重新注入 */
  reinject(): void {
    this.injectSyncScript();
  }

  stop(): void {
    this.active = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  destroy(): void {
    this.stop();
    this.webviewEl = null;
  }

  // ── 接收对面发来的同步事件，应用到自己的 guest ──

  handleRemoteEvents(events: SyncEvent[]): void {
    if (!this.webviewEl || !this.active) return;

    let totalDeltaY = 0;
    let lastAnchor: ScrollAnchorEvent | null = null;
    const otherEvents: SyncEvent[] = [];

    for (const ev of events) {
      if (ev.type === 'scroll-delta') totalDeltaY += ev.deltaY;
      else if (ev.type === 'scroll-anchor') lastAnchor = ev;
      else otherEvents.push(ev);
    }

    // 应用滚动
    if (totalDeltaY !== 0) this.applyScrollDelta(totalDeltaY);
    if (lastAnchor) this.applyScrollAnchor(lastAnchor);

    // Phase 1 先只处理滚动，Phase 2 处理 click/input/submit/selection
    for (const ev of otherEvents) {
      switch (ev.type) {
        case 'click': this.applyClickSync(ev); break;
        case 'input': this.applyInputSync(ev); break;
        case 'submit': this.applySubmitSync(ev); break;
        case 'selection': this.applySelectionHighlight(ev); break;
      }
    }
  }

  // ── Private ──

  private injectSyncScript(): void {
    if (!this.webviewEl) return;
    const script = syncInjectRaw.replace('__MIRRO_SIDE__', this.side);
    this.webviewEl.executeJavaScript(script).catch(() => {});
  }

  private async poll(): Promise<void> {
    if (!this.webviewEl || !this.active) return;

    try {
      const events = await this.webviewEl.executeJavaScript(`
        (function() {
          var q = window.__mirroSyncQueue || [];
          window.__mirroSyncQueue = [];
          return q.length > 0 ? q : null;
        })();
      `);

      if (events && events.length > 0) {
        // 通过 ViewMessage 发送到对面
        this.sendToOther({
          protocol: 'web-translate',
          action: SYNC_ACTION.SYNC_EVENTS,
          payload: { events },
        });
      }
    } catch {
      // webview 可能未就绪
    }
  }

  private applyScrollDelta(deltaY: number): void {
    this.webviewEl?.executeJavaScript(`
      (function() {
        var targetY = Math.round(window.scrollY + ${deltaY});
        window.__mirroProgramScrollY = targetY;
        window.scrollBy(0, ${deltaY});
      })();
    `).catch(() => {});
  }

  private applyScrollAnchor(event: ScrollAnchorEvent): void {
    if (event.anchor) {
      const anchorJSON = JSON.stringify(event.anchor);
      this.webviewEl?.executeJavaScript(`
        (function() {
          try {
            var anchor = ${anchorJSON};
            var els = document.getElementsByTagName(anchor.tag);
            var el = els[anchor.index];
            if (el) {
              var rect = el.getBoundingClientRect();
              var targetY = window.scrollY + rect.top + (anchor.offsetRatio * rect.height);
              window.__mirroSmoothScrolling = true;
              window.scrollTo({ top: targetY, behavior: 'smooth' });
              setTimeout(function() { window.__mirroSmoothScrolling = false; }, 400);
            }
          } catch(e) {}
        })();
      `).catch(() => {});
    } else if (event.pctY !== undefined) {
      this.webviewEl?.executeJavaScript(`
        (function() {
          var maxY = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
          window.__mirroSmoothScrolling = true;
          window.scrollTo({ top: ${event.pctY} * maxY, behavior: 'smooth' });
          setTimeout(function() { window.__mirroSmoothScrolling = false; }, 400);
        })();
      `).catch(() => {});
    }
  }

  private applyClickSync(event: ClickEvent): void {
    const toggleStateJSON = JSON.stringify(event.toggleState || null);
    this.webviewEl?.executeJavaScript(`
      (function() {
        window.__mirroClickLock = true;
        try {
          var el = document.querySelector(${JSON.stringify(event.selector)});
          if (!el) return;
          var toggleState = ${toggleStateJSON};
          var shouldClick = true;
          if (toggleState) {
            if (toggleState.attr === 'aria-expanded' && toggleState.value !== null) {
              var toggle = el.closest ? (el.closest('[aria-expanded]') || el) : el;
              var current = toggle.getAttribute('aria-expanded');
              if (current === toggleState.value) shouldClick = false;
            } else if (toggleState.controlledSelector && toggleState.visible !== undefined) {
              var controlled = document.querySelector(toggleState.controlledSelector);
              if (controlled) {
                var style = window.getComputedStyle(controlled);
                var isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                if (isVisible === toggleState.visible) shouldClick = false;
              }
            }
          }
          if (shouldClick) el.click();
        } catch(e) {}
        setTimeout(function() { window.__mirroClickLock = false; }, 100);
      })();
    `).catch(() => {});
  }

  private applyInputSync(event: InputEvent): void {
    this.webviewEl?.executeJavaScript(`
      (function() {
        window.__mirroInputLock = true;
        try {
          var el = document.querySelector(${JSON.stringify(event.selector)});
          if (!el) return;
          var tag = el.tagName.toLowerCase();
          if (tag === 'input' || tag === 'textarea') {
            if (el.type === 'checkbox' || el.type === 'radio') {
              el.checked = ${event.checked};
            } else {
              el.value = ${JSON.stringify(event.value)};
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (tag === 'select') {
            el.value = ${JSON.stringify(event.value)};
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (el.isContentEditable) {
            el.textContent = ${JSON.stringify(event.value)};
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        } catch(e) {}
        setTimeout(function() { window.__mirroInputLock = false; }, 50);
      })();
    `).catch(() => {});
  }

  private applySubmitSync(event: SubmitEvent): void {
    this.webviewEl?.executeJavaScript(`
      (function() {
        window.__mirroInputLock = true;
        try {
          var form = document.querySelector(${JSON.stringify(event.selector)});
          if (!form) return;
          var formData = ${JSON.stringify(event.formData)};
          for (var name in formData) {
            var input = form.querySelector('[name="' + name + '"], #' + name);
            if (!input) continue;
            if (input.type === 'checkbox' || input.type === 'radio') {
              input.checked = formData[name].checked;
            } else {
              input.value = formData[name].value;
            }
          }
          form.submit();
        } catch(e) {}
        setTimeout(function() { window.__mirroInputLock = false; }, 200);
      })();
    `).catch(() => {});
  }

  private applySelectionHighlight(event: SelectionEvent): void {
    const blocksJSON = JSON.stringify(event.blocks);
    this.webviewEl?.executeJavaScript(`
      (function() {
        if (!document.getElementById('__mirroHighlightStyle')) {
          var style = document.createElement('style');
          style.id = '__mirroHighlightStyle';
          style.textContent = '.__mirro-highlight { background-color: rgba(138,180,248,0.15) !important; outline: 2px solid rgba(138,180,248,0.5) !important; outline-offset: 2px !important; border-radius: 4px !important; }';
          document.head.appendChild(style);
        }
        var old = document.querySelectorAll('.__mirro-highlight');
        for (var i = 0; i < old.length; i++) old[i].classList.remove('__mirro-highlight');
        var blocks = ${blocksJSON};
        if (!blocks) return;
        for (var j = 0; j < blocks.length; j++) {
          try {
            var els = document.getElementsByTagName(blocks[j].tag);
            var el = els[blocks[j].index];
            if (el) el.classList.add('__mirro-highlight');
          } catch(e) {}
        }
      })();
    `).catch(() => {});
  }
}

// ── 事件类型 ──

interface ScrollDeltaEvent { type: 'scroll-delta'; deltaY: number }
interface ScrollAnchorEvent { type: 'scroll-anchor'; anchor: { tag: string; index: number; offsetRatio: number } | null; pctX?: number; pctY?: number }
interface ClickEvent { type: 'click'; selector: string; toggleState?: any }
interface InputEvent { type: 'input'; selector: string; value: string; inputType: string; checked: boolean }
interface SubmitEvent { type: 'submit'; selector: string; formData: Record<string, { value: string; checked: boolean }> }
interface SelectionEvent { type: 'selection'; blocks: Array<{ tag: string; index: number }> | null }
type SyncEvent = ScrollDeltaEvent | ScrollAnchorEvent | ClickEvent | InputEvent | SubmitEvent | SelectionEvent;
```

#### 在 WebView.tsx 和 TranslateWebView.tsx 中使用 SyncDriver

模式完全一致——类似 NoteView ↔ ThoughtView 通过 ViewMessage 通信。

### 翻译注入（Renderer 侧）

**文件：`src/plugins/web/translate/translate-driver.ts`**

翻译注入在 renderer 侧通过 `<webview>.executeJavaScript()` 完成。
Google Translate element.js 的获取通过 IPC 请求主进程 fetch（绕过 guest 页面 CSP）。

```typescript
import googleTranslateInjectRaw from './google-translate-inject.js?raw';

/**
 * TranslateDriver — 在 renderer 中管理 Google Translate 注入
 *
 * element.js 的获取需要通过主进程 net.fetch（绕过 CSP），
 * 所以使用 viewAPI.translateFetchElementJs() IPC 调用。
 * 其余注入操作全部通过 <webview>.executeJavaScript() 在 renderer 完成。
 */
export class TranslateDriver {
  private targetLang: string;

  constructor(targetLang = 'zh-CN') {
    this.targetLang = targetLang;
  }

  setTargetLang(lang: string): void {
    this.targetLang = lang;
  }

  async inject(webview: Electron.WebviewTag): Promise<void> {
    // Step 1: 移除 DOM 中的 CSP meta 标签
    await webview.executeJavaScript(`
      (function() {
        document.querySelectorAll('meta[http-equiv]').forEach(function(m) {
          if (/content-security-policy/i.test(m.getAttribute('http-equiv'))) m.remove();
        });
        new MutationObserver(function(mutations) {
          mutations.forEach(function(mut) {
            mut.addedNodes.forEach(function(node) {
              if (node.nodeName === 'META' &&
                  /content-security-policy/i.test(node.getAttribute('http-equiv') || ''))
                node.remove();
            });
          });
        }).observe(document.head || document.documentElement, { childList: true });
      })();
    `).catch(() => {});

    // Step 2: 通过主进程 fetch element.js（绕过页面 CSP）
    const elementJsCode = await (window as any).viewAPI.translateFetchElementJs();
    if (!elementJsCode) return;

    // Step 3: 注入 GT 初始化脚本
    const script = googleTranslateInjectRaw.replace('__KRIG_TARGET_LANG__', this.targetLang);
    await webview.executeJavaScript(script);

    // Step 4: 执行 element.js
    await webview.executeJavaScript(elementJsCode);
  }
}
```

**新增 IPC**：`translateFetchElementJs` — 主进程 fetch Google Translate element.js 并返回代码字符串。
这是因为 renderer 进程无法绕过 guest 页面的 CSP 来获取第三方脚本。

```typescript
// shared/types.ts
WEB_TRANSLATE_FETCH_ELEMENT_JS: 'web-translate:fetch-element-js',

// main/ipc/handlers.ts
ipcMain.handle(IPC.WEB_TRANSLATE_FETCH_ELEMENT_JS, async () => {
  const resp = await net.fetch(
    'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit'
  );
  if (!resp.ok) return null;
  return resp.text();
});

// main/preload/view.ts
translateFetchElementJs: () => ipcRenderer.invoke(IPC.WEB_TRANSLATE_FETCH_ELEMENT_JS),
```

### 组件设计

#### TranslateWebView.tsx

**文件：`src/plugins/web/components/TranslateWebView.tsx`**

```typescript
import { useState, useRef, useCallback, useEffect } from 'react';
import { SyncDriver } from '../sync/sync-driver';
import { TranslateDriver } from '../translate/translate-driver';
import { SYNC_ACTION } from '../sync/sync-protocol';
import '../web.css';

declare const viewAPI: {
  sendToOtherSlot: (message: { protocol: string; action: string; payload: unknown }) => void;
  onMessage: (callback: (message: any) => void) => () => void;
  closeSlot: () => Promise<void>;
  translateFetchElementJs: () => Promise<string | null>;
};

/**
 * TranslateWebView — 右侧翻译 WebView
 *
 * 无地址栏。URL 由左侧 WebView 通过 ViewMessage 同步。
 * 页面加载后自动注入 Google Translate + 同步脚本。
 */
export function TranslateWebView() {
  const webviewRef = useRef<Electron.WebviewTag | null>(null);
  const syncDriverRef = useRef<SyncDriver | null>(null);
  const translateDriverRef = useRef(new TranslateDriver('zh-CN'));
  const [targetLang, setTargetLang] = useState('zh-CN');

  const setupWebview = useCallback((el: Electron.WebviewTag | null) => {
    if (!el || webviewRef.current === el) return;
    webviewRef.current = el;

    // 初始化 SyncDriver
    const driver = new SyncDriver('right', (msg) => viewAPI.sendToOtherSlot(msg));
    driver.bind(el);
    syncDriverRef.current = driver;

    // 页面加载完成 → 注入翻译 + 启动同步
    el.addEventListener('did-finish-load', async () => {
      await translateDriverRef.current.inject(el);
      driver.start();
      // 通知左侧：右侧准备就绪
      viewAPI.sendToOtherSlot({
        protocol: 'web-translate',
        action: SYNC_ACTION.NAV_READY,
        payload: {},
      });
    });

    el.addEventListener('did-navigate', () => driver.reinject());
    el.addEventListener('did-navigate-in-page', () => driver.reinject());
  }, []);

  // 监听来自左侧的 ViewMessage
  useEffect(() => {
    const unsub = viewAPI.onMessage((msg) => {
      if (msg.action === SYNC_ACTION.NAVIGATE) {
        // 左侧导航 → 右侧跟随加载
        webviewRef.current?.loadURL((msg.payload as any).url);
      } else if (msg.action === SYNC_ACTION.SYNC_EVENTS) {
        // 左侧同步事件 → 应用到右侧 guest
        syncDriverRef.current?.handleRemoteEvents((msg.payload as any).events);
      }
    });
    return unsub;
  }, []);

  // 语言变更
  useEffect(() => {
    translateDriverRef.current.setTargetLang(targetLang);
  }, [targetLang]);

  return (
    <div className="web-view">
      <div className="translate-toolbar">
        <select
          value={targetLang}
          onChange={(e) => setTargetLang(e.target.value)}
          className="translate-toolbar__lang-select"
        >
          <option value="zh-CN">中文</option>
          <option value="ja">日本語</option>
          <option value="ko">한국어</option>
          <option value="en">English</option>
          <option value="fr">Français</option>
          <option value="de">Deutsch</option>
          <option value="es">Español</option>
        </select>
        <button className="web-toolbar__btn web-toolbar__btn--close-slot"
          onClick={() => viewAPI.closeSlot()} title="关闭翻译">
          ×
        </button>
      </div>
      <div className="web-view__content">
        <webview
          ref={setupWebview}
          src="about:blank"
          partition="persist:web-translate"
          className="web-view__webview"
        />
      </div>
    </div>
  );
}
```

#### WebView.tsx 修改

在现有 WebView.tsx 中增加 SyncDriver 和导航通知：

```typescript
// 新增 import
import { SyncDriver } from '../sync/sync-driver';
import { SYNC_ACTION } from '../sync/sync-protocol';

// 在 WebView 组件中新增：
const syncDriverRef = useRef<SyncDriver | null>(null);

// setupWebview 回调中新增：
const driver = new SyncDriver('left', (msg) => viewAPI.sendToOtherSlot(msg));
driver.bind(el);
syncDriverRef.current = driver;

// did-navigate 事件中新增：导航通知 + 重注入
el.addEventListener('did-navigate', (e: any) => {
  // ... 现有逻辑 ...
  viewAPI.sendToOtherSlot({
    protocol: 'web-translate',
    action: SYNC_ACTION.NAVIGATE,
    payload: { url: e.url },
  });
  driver.reinject();
});

// did-navigate-in-page 事件中同理
el.addEventListener('did-navigate-in-page', (e: any) => {
  if (e.isMainFrame) {
    // ... 现有逻辑 ...
    viewAPI.sendToOtherSlot({
      protocol: 'web-translate',
      action: SYNC_ACTION.NAVIGATE,
      payload: { url: e.url },
    });
    driver.reinject();
  }
});

// 监听右侧发来的同步事件
useEffect(() => {
  const unsub = viewAPI.onMessage((msg) => {
    if (msg.action === SYNC_ACTION.SYNC_EVENTS) {
      syncDriverRef.current?.handleRemoteEvents((msg.payload as any).events);
    } else if (msg.action === SYNC_ACTION.NAV_READY) {
      // 右侧准备就绪 → 启动左侧同步轮询
      syncDriverRef.current?.start();
    }
  });
  return unsub;
}, []);
```

**注意：ViewMessage 的 sendToOtherSlot 当右侧不存在时不会报错**——框架检查 `getActiveProtocol()` 返回 null 就静默丢弃。所以 WebView.tsx 可以无条件发送导航通知，不需要判断右侧是否打开。

#### renderer.tsx 修改

```typescript
if (variant === 'translate') {
  root.render(<TranslateWebView />);
} else if (variant === 'extraction') {
  root.render(<ExtractionView />);
} else {
  root.render(<WebView />);
}
```

#### WebToolbar.tsx 修改

增加翻译按钮：

```typescript
<button
  className="web-toolbar__btn"
  onClick={() => (viewAPI as any).ensureRightSlot('web-translate')}
  title="翻译浏览"
>
  译
</button>
```

### 注入脚本

**`src/plugins/web/sync/sync-inject.js`**
— 直接复制 mirro-desktop 的 `sync-inject.js`（410 行），零修改。

**`src/plugins/web/translate/google-translate-inject.js`**
— 直接复制 mirro-desktop 的 `google-translate-inject.js`（92 行），零修改。

### Vite 配置

sync-inject.js 和 google-translate-inject.js 通过 `?raw` 导入为字符串，
需要确认 web_view 的 Vite 配置支持 `?raw` 后缀（Vite 默认支持）。

### IPC 变更

```typescript
// shared/types.ts 新增
WEB_TRANSLATE_FETCH_ELEMENT_JS: 'web-translate:fetch-element-js',

// main/preload/view.ts 新增
translateFetchElementJs: () => ipcRenderer.invoke(IPC.WEB_TRANSLATE_FETCH_ELEMENT_JS),
```

仅此一个新增 IPC——用于主进程代替 renderer fetch Google Translate element.js。

## 关键设计决策

### 1. 同步引擎在 renderer 层，不在主进程

**原因**：遵守上层不参与下层业务的原则。

mirro-desktop 的 SyncEngine 在主进程运行（直接操作 WebContentsView.webContents），
因为 mirro-desktop 没有 host renderer / guest 的分离。

KRIG-Note 的 `<webview>` 架构下，host renderer 可以通过 `webview.executeJavaScript()`
完成完全相同的操作。将同步引擎放在 renderer 层：
- shell.ts 零修改
- 主进程零参与（除了 CSP 绕过）
- 符合 ViewMessage 双工通信模式

### 2. CSP 绕过是唯一的主进程参与

`session.webRequest.onHeadersReceived` 只能在主进程的 WebContents 对象上调用——
这是 Electron API 的限制。通过 `onViewCreated` 钩子设置，与 `setupExtractionInterceptor` 同一模式。
不是业务侵入，而是基础设施配置。

### 3. Google Translate element.js 通过 IPC fetch

renderer 进程无法绕过 guest 页面的 CSP 来获取 `translate.google.com` 上的脚本。
通过 IPC 请求主进程的 `net.fetch` 获取脚本代码，再通过 `executeJavaScript` 注入——
与 mirro-desktop 的做法一致（主进程 fetch → executeJavaScript 注入）。

### 4. partition 隔离

- 左 webview：`persist:web`（CSP 完整保留）
- 右 webview：`persist:web-translate`（CSP 被移除）

独立 session 确保 CSP 绕过不影响左侧的安全策略。
同时 cookie 隔离避免 `googtrans` cookie 影响左侧页面。

### 5. ViewMessage 发送不判断右侧是否存在

框架在 `ipcMain.on(VIEW_MESSAGE_SEND)` 中检查 `getActiveProtocol()` 返回值。
当右侧不存在时返回 null，消息静默丢弃。
所以 WebView.tsx 可以始终发送导航通知，不需要维护"翻译模式是否开启"的状态。

### 6. 活跃侧检测

mirro-desktop 用 `screen.getCursorScreenPoint()` 在主进程判断。
KRIG-Note 的 SyncDriver 运行在 renderer 中，无法访问 `screen` API。

替代方案：sync-inject.js 已经在各自 guest 中标记了 `__mirroSyncSide`。
host renderer 只发送自己 guest 采集到的事件，对面只做应用。
不需要"活跃侧"判断——每个 SyncDriver 只负责"采集自己的 → 发给对面"和"接收对面的 → 应用到自己"。

**防回声由 sync-inject.js 自身处理**：
- `__mirroProgramScrollY`：程序化滚动标记
- `__mirroSmoothScrolling`：平滑滚动抑制
- `__mirroInputLock` / `__mirroClickLock`：输入/点击锁

这些锁都在 guest 页面内部完成，不需要跨 View 协调。

## Phase 规划

### Phase 1：全页翻译 + 滚动同步

- WorkMode + Protocol 注册
- TranslateWebView 组件
- CSP 绕过（onViewCreated）
- 翻译注入（TranslateDriver）
- 同步引擎（SyncDriver）— 仅滚动事件
- 导航同步（ViewMessage）
- WebToolbar 翻译按钮

### Phase 2：点击 / 输入 / 表单 / 选择高亮同步

- SyncDriver 中启用全部事件类型的处理
- input-enter（右侧输入 → 翻译 → 回填左侧）复用 `src/main/learning/providers/google-translate.ts`
- 翻译日志面板

### Phase 3：知识集成

- 右侧选词 → LEARNING_LOOKUP / LEARNING_TRANSLATE
- 翻译选词 → Thought 锚点
- 与 learning 模块深度整合
