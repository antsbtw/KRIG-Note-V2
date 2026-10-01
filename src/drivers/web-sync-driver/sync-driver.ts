/**
 * SyncDriver — renderer 侧双 webview 同步引擎(L5-B4.2)
 *
 * 控制权模型(单向通信防回环):
 * - 同一时刻只有单向同步:controller 发,passive 收
 * - 用户在 X 侧操作(poll 抓到事件)→ X 侧自动 takeControl + 通知对面 yield
 *
 * 跨 slot 通信:driver **不依赖具体 slot-bus 模块**,通过构造函数注入 SyncBus
 * 接口(charter § 1.1 单向调用 + driver 协议铁律 — driver 不绑定具体 view/capability)。
 *
 * 历史(W4.2 C1):
 * - 文件原位于 src/views/web/sync/sync-driver.ts,直接 import 视图层 slot-bus
 * - 现迁到 driver 层,bus 改为接口注入(实例化方传具体实现)
 */

/**
 * ⭐ 脚本 id —— 脚本**本体**已登记在 main 侧
 * (`web-capability/dom/renderer-scripts.ts`),这里只认一个名字。
 *
 * ⚠️ 不从 `@platform` import 那个常量:renderer 不许 import 能力层
 * (`ipc-dom-boundary-guard` 钉着)。两边各写一份字面量,
 * 由守卫钉住它们一致 —— 这是刻意的取舍:宁可重复一个字符串,
 * 不要把 main 的模块拖进渲染进程。
 */
const RENDERER_SCRIPTS_SYNC_INJECT = 'renderer.sync-inject';
import { SYNC_ACTION, WEB_TRANSLATE_PROTOCOL } from './sync-protocol';

const SYNC_POLL_MS = 80;

/** Slot 一侧标记 — driver 自定义,不跟具体 slot-bus 模块绑(charter 单向调用)*/
export type Side = 'left' | 'right';

/** Slot 消息形态 — driver 自定义结构,与 slot-bus 实现 nominal 兼容即可 */
export interface SlotMessage {
  protocol: string;
  action: string;
  payload: unknown;
}

/** Bus 接口注入(实例化方提供) */
export interface SyncBus {
  sendFromSide(side: Side, message: SlotMessage): void;
}

/** Electron WebviewTag 最小接口(避免 import 'electron' 类型) */
interface WebviewElement extends HTMLElement {
  loadURL(url: string): void;
  isLoading(): boolean;
  executeJavaScript(code: string): Promise<unknown>;
  /** ⭐ guest 的 webContents id —— 走 web.dom IPC 面时用它指认页面 */
  getWebContentsId(): number;
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
    /** Bus 接口注入(实例化方提供具体 slot-bus 实现)*/
    private bus: SyncBus,
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
    this.bus.sendFromSide(this.side, {
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

  /** 发消息到对面(包装 bus,封装 protocol/fromSide)*/
  private sendToOther(message: Omit<SlotMessage, 'protocol'> & Partial<Pick<SlotMessage, 'protocol'>>): void {
    this.bus.sendFromSide(this.side, {
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

    try {
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
    } catch { /* webview 未就绪 */ }
  }

  // ── Private ──

  /**
   * 注入同步内核。⭐ 2026-09-30 改走 `web.dom` IPC 面(L2 收口步 2)。
   *
   * ── 换掉了什么 ──
   *
   * 旧做法:`syncInjectRaw.replace(/占位符/g, this.side)` ——
   * 把运行时值**文本替换进脚本源码**,与 `project-x-inject-template-escape`
   * 同机制,**而且已经咬过一次**(占位符在 `sync-inject.js` 出现 2 处:
   * 一处注释一处真实变量,当初 `replace(string,string)` 只换了注释 →
   * sync 行为异常;靠加 `/g` 修好但机制没变)。
   *
   * 新做法:脚本登记在 `web.dom` 的 `RENDERER_SCRIPTS.syncInject`,
   * 这里只给 **scriptId + 参数** —— 给不了脚本文本,也就拼不出坏脚本。
   * ⭐ 附带获得 `trace` 留痕(旧路径一行痕迹都没有)。
   *
   * ⚠️ 失败**不再静默吞**:如实 warn 一行。
   * 旧注释说「失败无所谓:dom-ready 兜底会重 inject」—— 重试机制保留,
   * 但「什么都不说」是另一回事:双开同步失效时日志里一个字都没有,
   * 那正是可靠性纲领 §44 要治的。
   */
  private injectSyncScript(): void {
    if (!this.webviewEl) return;
    let wcId: number;
    try {
      // ⚠️ webview 未 attached 时 getWebContentsId 会抛(同 executeJavaScript)
      wcId = this.webviewEl.getWebContentsId();
    } catch {
      // webview 未就绪 —— 这是**预期**状态(start 的 dom-ready 兜底会重来),
      // 不是故障,故不 warn。⭐ 但下面真正的失败会 warn。
      return;
    }
    void window.electronAPI
      ?.webDomRun({ wcId }, RENDERER_SCRIPTS_SYNC_INJECT, { side: this.side })
      .then((r) => {
        if (r.status === 'failed') {
          console.warn(`[sync-driver] 注入同步内核失败(${this.side}): ${r.reason}`);
        }
      })
      .catch((err: unknown) => {
        console.warn(`[sync-driver] 注入同步内核异常(${this.side}):`, err);
      });
  }

  /** 清空 guest 的事件队列(passive 时丢弃) */
  private drainQueue(): void {
    if (!this.webviewEl || this.webviewEl.isLoading()) return;
    // 同 injectSyncScript:executeJavaScript 在 webview 未就绪时同步 throw,必须 try/catch
    try {
      this.webviewEl.executeJavaScript(`window.__krigSyncQueue = [];`).catch(() => {});
    } catch {
      /* webview 未就绪 */
    }
  }

  private poll(): void {
    if (!this.webviewEl || !this.active) return;
    if (this.polling) return;
    if (this.webviewEl.isLoading()) return;
    if (this.isBusy?.()) return;

    this.polling = true;

    // 同 injectSyncScript:executeJavaScript 在未就绪时同步 throw,必须 try/catch
    try {
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
    } catch {
      // webview 未就绪 — 重置 polling flag,下次 80ms 再试
      this.polling = false;
    }
  }

  // ── Apply methods(从 V1 直迁,改命名空间) ──

  private applyScrollDelta(deltaY: number): void {
    if (!this.webviewEl) return;
    try {
      this.webviewEl.executeJavaScript(`
        (function() {
          var targetY = Math.round(window.scrollY + ${deltaY});
          window.__krigProgramScrollY = targetY;
          window.scrollBy(0, ${deltaY});
        })();
      `).catch(() => {});
    } catch { /* webview 未就绪 */ }
  }

  private applyScrollAnchor(event: ScrollAnchorEvent): void {
    if (!this.webviewEl) return;
    if (event.anchor) {
      const anchorJSON = JSON.stringify(event.anchor);
      try {
        this.webviewEl.executeJavaScript(`
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
      } catch { /* webview 未就绪 */ }
    } else if (event.pctY !== undefined) {
      try {
        this.webviewEl.executeJavaScript(`
          (function() {
            var maxY = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
            window.__krigSmoothScrolling = true;
            window.scrollTo({ top: ${event.pctY} * maxY, behavior: 'smooth' });
            setTimeout(function() { window.__krigSmoothScrolling = false; }, 400);
          })();
        `).catch(() => {});
      } catch { /* webview 未就绪 */ }
    }
  }

  private applyClickSync(event: ClickEvent): void {
    if (this.clickSyncLock) return;
    if (!this.webviewEl) return;
    this.clickSyncLock = true;

    const toggleStateJSON = JSON.stringify(event.toggleState || null);
    try {
    this.webviewEl.executeJavaScript(`
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
    } catch { /* webview 未就绪 */ }

    setTimeout(() => { this.clickSyncLock = false; }, 100);
  }

  private applyInputSync(event: InputSyncEvent): void {
    if (!this.webviewEl) return;
    try {
    this.webviewEl.executeJavaScript(`
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
    } catch { /* webview 未就绪 */ }
  }

  private applySubmitSync(event: SubmitFormEvent): void {
    if (!this.webviewEl) return;
    try {
    this.webviewEl.executeJavaScript(`
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
    } catch { /* webview 未就绪 */ }
  }

  private applySelectionHighlight(event: SelectionEvent): void {
    if (!this.webviewEl) return;
    const blocksJSON = JSON.stringify(event.blocks);
    try {
      this.webviewEl.executeJavaScript(`
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
    } catch { /* webview 未就绪 */ }
  }
}

export type { SyncEvent, WebviewElement };
