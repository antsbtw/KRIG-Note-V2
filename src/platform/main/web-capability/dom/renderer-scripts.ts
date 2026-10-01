/**
 * renderer 侧注入脚本的预注册表(L2 收口最后一块,步 2)
 *
 * ── 为什么要收进来 ──
 *
 * 这些脚本原本由 renderer 直接 `webview.executeJavaScript(...)` 注入,
 * 四个实测缺陷(设计 §〇):
 *  ① `sync-driver` **26 处静默吞异常、零日志**
 *  ② ⭐ `replace(/占位符/g, side)` 把运行时值**文本替换进脚本源码** ——
 *     与 `project-x-inject-template-escape` 同机制,**且已经咬过一次**
 *     (占位符在 `sync-inject.js` 出现 2 处:一处注释一处真实变量,
 *      当初 `replace(string,string)` 只换了注释 → sync 行为异常)
 *  ③ 9 处运行时值拼进脚本 ④ 零留痕
 *
 * ⭐ 收进来之后:参数走 `JSON.stringify` **绑定值**,调用方只给 `scriptId`
 * —— 从类型层面拼不出坏脚本;且自动获得 `trace` 留痕。
 *
 * ⚠️ **脚本本体一行没动** —— `?raw` 整文件照原样注入,
 * 这里只负责「在它前面定义绑定变量」。改脚本内容是另一回事,不混在收口里。
 */

import type { RegisteredScript, ScriptId, ScriptParams } from './types';
import type { ScriptRegistry } from './script-registry';
// ⚠️ Vite `?raw`:把 .js 文件原文当字符串读(与 renderer 侧同一手法)
import syncInjectRaw from '../../../../drivers/web-sync-driver/sync-inject.js?raw';
import googleTranslateInjectRaw from '../../../../drivers/web-translate-driver/google-translate-inject.js?raw';

export const RENDERER_SCRIPTS = {
  /** 双开 web view 的同步内核(guest 端事件队列 + 滚动/点击/输入采集) */
  syncInject: 'renderer.sync-inject' as ScriptId,
  /** 翻译:剥 CSP meta + MutationObserver 防新加(零参数) */
  translateStripCsp: 'renderer.translate-strip-csp' as ScriptId,
  /** 翻译:Google Translate 挂载壳(targetLang 决定译成哪种语言) */
  translateMount: 'renderer.translate-mount' as ScriptId,
  /** 翻译:暗色 color-scheme meta(零参数) */
  translateDarkMeta: 'renderer.translate-dark-meta' as ScriptId,

  // ── 双开同步的「应用动作」(C 组,步 3)——⭐ 都带运行时值 ──
  /** 按增量滚动(deltaY) */
  syncScrollDelta: 'renderer.sync-scroll-delta' as ScriptId,
  /** 滚到锚点元素(tag + index + offsetRatio) */
  syncScrollAnchor: 'renderer.sync-scroll-anchor' as ScriptId,
  /** 按百分比滚动(pctY) */
  syncScrollPct: 'renderer.sync-scroll-pct' as ScriptId,
  /** 同步点击(selector + 可选 toggleState) */
  syncClick: 'renderer.sync-click' as ScriptId,
  /** 同步输入(selector + value / checked) */
  syncInput: 'renderer.sync-input' as ScriptId,
  /** 同步表单提交(selector + formData) */
  syncSubmit: 'renderer.sync-submit' as ScriptId,
  /** 选区高亮(blocks) */
  syncHighlight: 'renderer.sync-highlight' as ScriptId,
  /** 输入框回车(写值 + 派发事件 + 提交表单) */
  syncInputEnter: 'renderer.sync-input-enter' as ScriptId,
} as const;

/**
 * ⚠️⚠️ **数字必须用 `Number.isFinite` 校验,不能只看 typeof** ——
 * `JSON.stringify(NaN)` === `'null'`,浏览器把 `scrollBy(0, null)` 当 `0`,
 * **静默滚了个寂寞而不报错**。2026-09-30 在 mail 那一刀实测过这个坑。
 * ⭐ `JSON.stringify` 对数字**不是安全网**,挡坏数字只能靠校验。
 *
 * C 组的 deltaY / pctY 都来自滚动事件回调,NaN 是真实可能。
 */
function requireFiniteNumber(params: ScriptParams, key: string): number {
  const v = params[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(
      `[web.dom] ${key} 必须是有限数字,收到 ${typeof v}: ${String(v)}`
      + '(NaN/Infinity 经 JSON.stringify 变 null,浏览器当 0 → 静默做错事)',
    );
  }
  return v;
}

/** 取一个 JSON 串参数(调用方已 stringify 过的结构) */
function requireJson(params: ScriptParams, key: string): string {
  const v = params[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`[web.dom] ${key} 必须是非空 JSON 字符串,收到 ${typeof v}`);
  }
  return v;
}

/** 取一个字符串参数 */
function requireStr(params: ScriptParams, key: string): string {
  const v = params[key];
  if (typeof v !== 'string') {
    throw new Error(`[web.dom] ${key} 必须是 string,收到 ${typeof v}`);
  }
  return v;
}

/** 缺参数就抛,不静默用默认值(那会把「忘了传」变成静默错误) */
function requireLang(params: ScriptParams): string {
  const v = params['targetLang'];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`[web.dom] translate-mount 的 targetLang 必须是非空 string,收到 ${typeof v}`);
  }
  return v;
}

/** 缺参数就抛,不静默用默认值(那会把「忘了传」变成静默错误) */
function requireSide(params: ScriptParams): 'left' | 'right' {
  const v = params['side'];
  if (v !== 'left' && v !== 'right') {
    throw new Error(`[web.dom] sync-inject 的 side 必须是 'left' | 'right',收到 ${String(v)}`);
  }
  return v;
}

export const RENDERER_SCRIPT_DEFINITIONS: readonly RegisteredScript[] = [
  {
    id: RENDERER_SCRIPTS.syncInject,
    purpose: '双开 web view 同步内核(guest 端注入;side 决定本侧身份)',
    /**
     * ⭐ **绑定值,不是文本替换**:在脚本本体**之前**定义
     * `window.__krigSyncSideBound`,脚本体读它。
     *
     * ⚠️ 这样即使 side 的值里带引号/反斜杠也拼不坏脚本 ——
     * 而旧的 regex 替换做不到这一点(它改的是源码文本)。
     */
    build: (p) => {
      const side = requireSide(p);
      return `(function(){ window.__krigSyncSideBound = ${JSON.stringify(side)}; })();\n`
        + (syncInjectRaw as unknown as string);
    },
  },
  {
    id: RENDERER_SCRIPTS.translateStripCsp,
    purpose: '翻译:剥页面 CSP meta,并用 MutationObserver 防站点再加回来',
    /** ⭐ 零参数 —— 纯字面量,照搬原实现一字未改 */
    build: () => `
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
    `,
  },
  {
    id: RENDERER_SCRIPTS.translateMount,
    purpose: 'Google Translate 挂载壳(targetLang 决定译成哪种语言)',
    /**
     * ⭐ **绑定值,不是文本替换**:在脚本本体之前定义
     * `window.__krigTargetLangBound`,脚本体读它。
     * ⚠️ 旧做法是对占位符做 regex 全局替换,而那个占位符在
     * `google-translate-inject.js` 出现 2 处(一处注释一处真实变量)——
     * 与 sync-inject 踩过的完全同形。
     */
    build: (p) => {
      const lang = requireLang(p);
      return `(function(){ window.__krigTargetLangBound = ${JSON.stringify(lang)}; })();\n`
        + (googleTranslateInjectRaw as unknown as string);
    },
  },
  {
    id: RENDERER_SCRIPTS.translateDarkMeta,
    purpose: '翻译:写 color-scheme=dark meta(让 Google 的 widget 跟随暗色)',
    /** ⭐ 零参数 —— 纯字面量,照搬原实现一字未改 */
    build: () => `
      (function() {
        var meta = document.querySelector('meta[name="color-scheme"]');
        if (!meta) {
          meta = document.createElement('meta');
          meta.setAttribute('name', 'color-scheme');
          document.head.appendChild(meta);
        }
        meta.setAttribute('content', 'dark');
        document.documentElement.style.colorScheme = 'dark';
      })();
    `,
  },
  {
    id: RENDERER_SCRIPTS.syncInputEnter,
    purpose: '同步:输入框回车 —— 写值 + 派发 input/change/keydown + 提交表单',
    build: (p) => {
      const selector = requireStr(p, 'selector');
      const value = requireStr(p, 'value');
      return `
      (function() {
        window.__krigInputLock = true;
        try {
          var el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return;
          el.value = ${JSON.stringify(value)};
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
    `;
    },
  },
  // ── C 组:双开同步的「应用动作」(步 3)──
  // ⭐ 脚本体逐字搬自 sync-driver 的 apply* 方法,**一个字没改**;
  //    只把 `${运行时值}` 换成绑定值。
  {
    id: RENDERER_SCRIPTS.syncScrollDelta,
    purpose: '同步:按增量滚动(deltaY)',
    build: (p) => {
      const deltaY = requireFiniteNumber(p, 'deltaY');
      return `
      (function() {
        var D = ${JSON.stringify(deltaY)};
        var targetY = Math.round(window.scrollY + D);
        window.__krigProgramScrollY = targetY;
        window.scrollBy(0, D);
      })();
    `;
    },
  },
  {
    id: RENDERER_SCRIPTS.syncScrollAnchor,
    purpose: '同步:滚到锚点元素(tag + index + offsetRatio)',
    build: (p) => {
      const anchorJson = requireJson(p, 'anchor');
      return `
      (function() {
        try {
          var anchor = ${anchorJson};
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
    `;
    },
  },
  {
    id: RENDERER_SCRIPTS.syncScrollPct,
    purpose: '同步:按百分比滚动(pctY)',
    build: (p) => {
      const pctY = requireFiniteNumber(p, 'pctY');
      return `
      (function() {
        var P = ${JSON.stringify(pctY)};
        var maxY = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        window.__krigSmoothScrolling = true;
        window.scrollTo({ top: P * maxY, behavior: 'smooth' });
        setTimeout(function() { window.__krigSmoothScrolling = false; }, 400);
      })();
    `;
    },
  },
  {
    id: RENDERER_SCRIPTS.syncClick,
    purpose: '同步:点击某元素(带 toggleState 防重复开合)',
    build: (p) => {
      const selector = requireStr(p, 'selector');
      const toggleState = requireJson(p, 'toggleState');   // 'null' 也是合法 JSON
      return `
      (function() {
        window.__krigClickLock = true;
        try {
          var el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return;
          var toggleState = ${toggleState};
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
    `;
    },
  },
  {
    id: RENDERER_SCRIPTS.syncInput,
    purpose: '同步:写输入框 / select / contenteditable 的值',
    build: (p) => {
      const selector = requireStr(p, 'selector');
      const value = requireStr(p, 'value');
      /** ⚠️ checked 是布尔 —— 单独校验,不混进数字那条 */
      const checkedRaw = p['checked'];
      if (typeof checkedRaw !== 'boolean') {
        throw new Error(`[web.dom] sync-input 的 checked 必须是 boolean,收到 ${typeof checkedRaw}`);
      }
      return `
      (function() {
        window.__krigInputLock = true;
        try {
          var el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return;
          var tag = el.tagName.toLowerCase();
          if (tag === 'input' || tag === 'textarea') {
            if (el.type === 'checkbox' || el.type === 'radio') {
              el.checked = ${JSON.stringify(checkedRaw)};
            } else {
              el.value = ${JSON.stringify(value)};
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (tag === 'select') {
            el.value = ${JSON.stringify(value)};
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (el.isContentEditable) {
            el.textContent = ${JSON.stringify(value)};
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        } catch(e) {}
        setTimeout(function() { window.__krigInputLock = false; }, 50);
      })();
    `;
    },
  },
  {
    id: RENDERER_SCRIPTS.syncSubmit,
    purpose: '同步:回填表单并提交',
    build: (p) => {
      const selector = requireStr(p, 'selector');
      const formData = requireJson(p, 'formData');
      return `
      (function() {
        window.__krigInputLock = true;
        try {
          var form = document.querySelector(${JSON.stringify(selector)});
          if (!form) return;
          var formData = ${formData};
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
    `;
    },
  },
  {
    id: RENDERER_SCRIPTS.syncHighlight,
    purpose: '同步:给对面选中的块加高亮',
    build: (p) => {
      const blocks = requireJson(p, 'blocks');
      return `
      (function() {
        if (!document.getElementById('__krigHighlightStyle')) {
          var style = document.createElement('style');
          style.id = '__krigHighlightStyle';
          style.textContent = '.__krig-highlight { background-color: rgba(138,180,248,0.15) !important; outline: 2px solid rgba(138,180,248,0.5) !important; outline-offset: 2px !important; border-radius: 4px !important; }';
          document.head.appendChild(style);
        }
        var old = document.querySelectorAll('.__krig-highlight');
        for (var i = 0; i < old.length; i++) old[i].classList.remove('__krig-highlight');
        var blocks = ${blocks};
        if (!blocks) return;
        for (var j = 0; j < blocks.length; j++) {
          try {
            var els = document.getElementsByTagName(blocks[j].tag);
            var el = els[blocks[j].index];
            if (el) el.classList.add('__krig-highlight');
          } catch(e) {}
        }
      })();
    `;
    },
  },
];

/** 把本表登记进脚本注册表(由 `wiring/runtime.ts` 在启动时调一次)*/
export function registerRendererScripts(registry: ScriptRegistry): void {
  for (const def of RENDERER_SCRIPT_DEFINITIONS) {
    registry.register(def);
  }
}
