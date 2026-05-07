/**
 * SyncDriver — renderer 侧双 webview 同步引擎(L5-B4.2,从 V1 直迁)
 *
 * 控制权模型(单向通信防回环):
 * - 同一时刻只有单向同步:controller 发,passive 收
 * - 用户在 X 侧操作(poll 抓到事件)→ X 侧自动 takeControl + 通知对面 yield
 *
 * 跨 slot 通信:V2 走 slot-bus(模块级 event bus),非 V1 IPC 转发。
 */

// Vite ?raw import:把 .js 文件原文当字符串读(运行时 string)
import syncInjectRaw from './sync-inject.js?raw';
import { SYNC_ACTION, WEB_TRANSLATE_PROTOCOL } from './sync-protocol';
import { slotBus, type Side, type SlotMessage } from '../slot-bus';

const SYNC_POLL_MS = 80;

/** Electron WebviewTag 最小接口(避免 import 'electron' 类型) */
interface WebviewElement extends HTMLElement {
  loadURL(url: string): void;
  isLoading(): boolean;
  executeJavaScript(code: string): Promise<unknown>;
}

// ── Event types(从 V1 直迁) ──

interface ScrollDeltaEvent { type: 'scroll-delta'; deltaY: number }
interface ScrollAnchorEvent { type: 'scroll-anchor'; anchor: { tag: string; index: number; offsetRatio: number } | null; pctX?: number; pctY?: number }
interface ClickEvent { type: 'click'; selector: string; toggleState?: { attr?: string; value?: string; controlledSelector?: string; visible?: boolean } | null }
interface InputSyncEvent { type: 'input'; selector: string; value: string; inputType: string; checked: boolean }
interface SubmitFormEvent { type: 'submit'; selector: string; formData: Record<string, { value: string; checked: boolean }> }
interface SelectionEvent { type: 'selection'; blocks: Array<{ tag: string; index: number }> | null }
interface InputEnterEvent { type: 'input-enter'; selector: string; value: string }

type SyncEvent =
  | ScrollDeltaEvent
  | ScrollAnchorEvent
  | ClickEvent
  | InputSyncEvent
  | SubmitFormEvent
  | SelectionEvent
  | InputEnterEvent
  | { type: string; [key: string]: unknown };

export class SyncDriver {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private webviewEl: WebviewElement | null = null;
  private active = false;
  private clickSyncLock = false;
  private polling = false;

  /** 当前角色:controller(发送方)或 passive(接收方) */
  role: 'controller' | 'passive' = 'passive';

  constructor(
    private side: Side,
    private onInputEnter?: (value: string, selector: string) => Promise<string | null>,
    /** 外部 guard:返回 true 时跳过 poll(如翻译注入中) */
    private isBusy?: () => boolean,
  ) {}

  /** 绑定 webview 元素 */
  bind(webview: WebviewElement): void {
    this.webviewEl = webview;
  }

  /** 抢占控制权:本侧变 controller,通知对面变 passive */
  takeControl(): void {
    if (this.role === 'controller') return;
    this.role = 'controller';
    slotBus.sendFromSide(this.side, {
      protocol: WEB_TRANSLATE_PROTOCOL,
      action: SYNC_ACTION.TAKE_CONTROL,
      payload: { fromSide: this.side },
    });
  }

  /** 被对面抢占控制权:本侧变 passive */
  yield(): void {
    if (this.role === 'passive') return;
    this.role = 'passive';
    this.drainQueue();
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

  /** 发消息到对面(包装 slot-bus,封装 protocol/fromSide)*/
  private sendToOther(message: Omit<SlotMessage, 'protocol'> & Partial<Pick<SlotMessage, 'protocol'>>): void {
    slotBus.sendFromSide(this.side, {
      protocol: message.protocol ?? WEB_TRANSLATE_PROTOCOL,
      action: message.action,
      payload: message.payload,
    });
  }

  // ── 接收对面发来的同步事件(仅 passive 时生效) ──

  handleRemoteEvents(events: SyncEvent[], fromSide: Side): void {
    if (!this.webviewEl || !this.active) return;
    if (this.role === 'controller') return;
    if (this.webviewEl.isLoading()) return;
    if (this.isBusy?.()) return;

    const direction = `${fromSide}-to-${this.side}` as 'left-to-right' | 'right-to-left';

    let totalDeltaY = 0;
    let lastAnchor: ScrollAnchorEvent | null = null;
    const otherEvents: SyncEvent[] = [];

    for (const ev of events) {
      if (ev.type === 'scroll-delta') totalDeltaY += (ev as ScrollDeltaEvent).deltaY;
      else if (ev.type === 'scroll-anchor') lastAnchor = ev as ScrollAnchorEvent;
      else otherEvents.push(ev);
    }

    if (totalDeltaY !== 0) this.applyScrollDelta(totalDeltaY);
    if (lastAnchor) this.applyScrollAnchor(lastAnchor);

    for (const ev of otherEvents) {
      switch (ev.type) {
        case 'click':
          this.applyClickSync(ev as ClickEvent);
          break;
        case 'input':
          if (direction === 'left-to-right') {
            this.applyInputSync(ev as InputSyncEvent);
          }
          break;
        case 'input-enter':
          if (direction === 'right-to-left') {
            void this.handleInputEnter(ev as InputEnterEvent);
          }
          break;
        case 'submit':
          this.applySubmitSync(ev as SubmitFormEvent);
          break;
        case 'selection':
          this.applySelectionHighlight(ev as SelectionEvent);
          break;
      }
    }
  }

  private async handleInputEnter(event: InputEnterEvent): Promise<void> {
    if (!this.onInputEnter || !this.webviewEl) return;

    const translated = await this.onInputEnter(event.value, event.selector);
    const finalValue = translated || event.value;

    this.webviewEl.executeJavaScript(`
      (function() {
        window.__krigInputLock = true;
        try {
          var el = document.querySelector(${JSON.stringify(event.selector)});
          if (!el) return;
          el.value = ${JSON.stringify(finalValue)};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          var form = el.closest('form');
          if (form) {
            if (form.requestSubmit) form.requestSubmit();
            else form.submit();
          }
        } catch(e) {}
        setTimeout(function() { window.__krigInputLock = false; }, 200);
      })();
    `).catch(() => {});
  }

  // ── Private ──

  private injectSyncScript(): void {
    if (!this.webviewEl) return;
    const script = (syncInjectRaw as unknown as string).replace('__KRIG_SIDE__', this.side);
    this.webviewEl.executeJavaScript(script).catch(() => {});
  }

  /** 清空 guest 的事件队列(passive 时丢弃) */
  private drainQueue(): void {
    if (!this.webviewEl || this.webviewEl.isLoading()) return;
    this.webviewEl.executeJavaScript(`window.__krigSyncQueue = [];`).catch(() => {});
  }

  private poll(): void {
    if (!this.webviewEl || !this.active) return;
    if (this.polling) return;
    if (this.webviewEl.isLoading()) return;
    if (this.isBusy?.()) return;

    this.polling = true;

    this.webviewEl.executeJavaScript(`
      (function() {
        var q = window.__krigSyncQueue || [];
        window.__krigSyncQueue = [];
        return q.length > 0 ? q : null;
      })();
    `).then((events) => {
      this.polling = false;
      if (!events || (events as unknown[]).length === 0) return;

      // 有用户事件 → 自动抢占控制权
      if (this.role !== 'controller') {
        this.role = 'controller';
        this.sendToOther({
          action: SYNC_ACTION.TAKE_CONTROL,
          payload: { fromSide: this.side },
        });
      }

      this.sendToOther({
        action: SYNC_ACTION.SYNC_EVENTS,
        payload: { events, fromSide: this.side },
      });
    }).catch(() => {
      this.polling = false;
    });
  }

  // ── Apply methods(从 V1 直迁,改命名空间) ──

  private applyScrollDelta(deltaY: number): void {
    this.webviewEl?.executeJavaScript(`
      (function() {
        var targetY = Math.round(window.scrollY + ${deltaY});
        window.__krigProgramScrollY = targetY;
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
              window.__krigSmoothScrolling = true;
              window.scrollTo({ top: targetY, behavior: 'smooth' });
              setTimeout(function() { window.__krigSmoothScrolling = false; }, 400);
            }
          } catch(e) {}
        })();
      `).catch(() => {});
    } else if (event.pctY !== undefined) {
      this.webviewEl?.executeJavaScript(`
        (function() {
          var maxY = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
          window.__krigSmoothScrolling = true;
          window.scrollTo({ top: ${event.pctY} * maxY, behavior: 'smooth' });
          setTimeout(function() { window.__krigSmoothScrolling = false; }, 400);
        })();
      `).catch(() => {});
    }
  }

  private applyClickSync(event: ClickEvent): void {
    if (this.clickSyncLock) return;
    this.clickSyncLock = true;

    const toggleStateJSON = JSON.stringify(event.toggleState || null);
    this.webviewEl?.executeJavaScript(`
      (function() {
        window.__krigClickLock = true;
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
        setTimeout(function() { window.__krigClickLock = false; }, 100);
      })();
    `).catch(() => {});

    setTimeout(() => { this.clickSyncLock = false; }, 100);
  }

  private applyInputSync(event: InputSyncEvent): void {
    this.webviewEl?.executeJavaScript(`
      (function() {
        window.__krigInputLock = true;
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
        setTimeout(function() { window.__krigInputLock = false; }, 50);
      })();
    `).catch(() => {});
  }

  private applySubmitSync(event: SubmitFormEvent): void {
    this.webviewEl?.executeJavaScript(`
      (function() {
        window.__krigInputLock = true;
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
        setTimeout(function() { window.__krigInputLock = false; }, 200);
      })();
    `).catch(() => {});
  }

  private applySelectionHighlight(event: SelectionEvent): void {
    const blocksJSON = JSON.stringify(event.blocks);
    this.webviewEl?.executeJavaScript(`
      (function() {
        if (!document.getElementById('__krigHighlightStyle')) {
          var style = document.createElement('style');
          style.id = '__krigHighlightStyle';
          style.textContent = '.__krig-highlight { background-color: rgba(138,180,248,0.15) !important; outline: 2px solid rgba(138,180,248,0.5) !important; outline-offset: 2px !important; border-radius: 4px !important; }';
          document.head.appendChild(style);
        }
        var old = document.querySelectorAll('.__krig-highlight');
        for (var i = 0; i < old.length; i++) old[i].classList.remove('__krig-highlight');
        var blocks = ${blocksJSON};
        if (!blocks) return;
        for (var j = 0; j < blocks.length; j++) {
          try {
            var els = document.getElementsByTagName(blocks[j].tag);
            var el = els[blocks[j].index];
            if (el) el.classList.add('__krig-highlight');
          } catch(e) {}
        }
      })();
    `).catch(() => {});
  }
}

export type { SyncEvent, WebviewElement };
