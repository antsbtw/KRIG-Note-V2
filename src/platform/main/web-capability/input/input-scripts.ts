/**
 * `web.input` 的注入脚本 —— **收编** `web-service-base/webview-input.ts` 的浏览器知识
 *
 * ⚠️ 本文件是**纯字符串构造**,零 Electron 依赖 —— 与 `web.dom` 同一手法:
 * 真正执行 `executeJavaScript` 的地方在 `wiring/electron-input.ts` 一个文件里。
 *
 * ── 为什么这些知识值得搬过来(§10.4)──
 * 它内含的知识**全是浏览器知识,零站点知识**,且已被 AI / X 发推 / X 长文三处共用验证:
 *
 *  1. **webview 焦点隔离**:X 用 Electron `<webview>` 挂载,DOM/焦点与宿主隔离。
 *     主进程 `sendInputEvent` 的 OS 级 Cmd+V **焦点打不进 guest 输入框**
 *     —— 实测 textContent 为空(记忆 `project-x-inject-synthetic-paste`)。
 *  2. **DraftJS 丢行**:X reply/compose 框是 contenteditable(DraftJS),
 *     `document.execCommand('insertText', 多行)` 会**丢行 / URL 被 link decorator 渲染重复**
 *     —— 那就是当年发推 bug 的根因。
 *  3. **合成 paste 才能穿透**:在 guest 自身上下文 dispatch 合成 `paste` 事件,
 *     不依赖 OS 焦点送达;DraftJS 的 paste handler 会把 text/plain 按 `\n` 正确拆 block。
 *
 * ── 本轮补的:作用域(§10.1)──
 * 原实现一律 `document.querySelector(...)` —— 也就是「页面上第一个匹配的框」。
 * 这里全部改走 `__scope(...)`:先解析容器,再在容器内查。
 * ⚠️ 容器命中多个 → **返回 ambiguous 让调用方失败**,绝不挑第一个。
 *
 * ── 参数安全 ──
 * 一律 `JSON.stringify` 后作为**绑定值**,绝不拼进脚本文本。
 * 这是 `project-x-inject-template-escape` 的同族防线(那次 `\/` 被吃掉,
 * 浏览器收到非法正则 → 整段解析失败 → **采集恒 0 一整天,而 tsc 和单测全绿**)。
 */

/** 脚本里统一的作用域解析失败标记 —— 与成功返回值区分开,调用方据此 fail loud */
export const SCOPE_AMBIGUOUS = '__web_input_scope_ambiguous__';
export const SCOPE_NOT_FOUND = '__web_input_scope_not_found__';

/**
 * 作用域解析的公共前缀:定义 `__scope()` 与 `__pick()`。
 *
 * `__scope()` 返回:
 *   - 容器元素(within 且唯一命中)
 *   - `document`(main)
 *   - 字符串标记 `SCOPE_*`(失败)—— ⚠️ 调用方必须先判这个,不能当成 falsy 处理
 *
 * ⭐ **`within` 命中多个直接返回 ambiguous**,不挑第一个(§10.1)。
 *
 * @param containerSelector within 的容器 selector;main 作用域传空串
 */
function scopePrelude(containerSelector: string): string {
  return `
    var __containerSel = ${JSON.stringify(containerSelector)};
    var __AMBIGUOUS = ${JSON.stringify(SCOPE_AMBIGUOUS)};
    var __NOT_FOUND = ${JSON.stringify(SCOPE_NOT_FOUND)};
    function __candidates(sel) {
      return sel.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
    }
    function __scope() {
      if (!__containerSel) return document;
      var parts = __candidates(__containerSel);
      var hits = [];
      for (var i = 0; i < parts.length; i++) {
        var list;
        try { list = document.querySelectorAll(parts[i]); } catch (e) { continue; }
        for (var j = 0; j < list.length; j++) {
          if (hits.indexOf(list[j]) === -1) hits.push(list[j]);
        }
      }
      if (hits.length === 0) return __NOT_FOUND;
      // ⭐ 命中多个不挑第一个 —— 底座不替调用方挑(§10.1,与 web.page 的 find 同源)
      if (hits.length > 1) return __AMBIGUOUS;
      return hits[0];
    }
    function __pick(root, sel) {
      var parts = __candidates(sel);
      for (var i = 0; i < parts.length; i++) {
        var el;
        try { el = root.querySelector(parts[i]); } catch (e) { continue; }
        if (el) return el;
      }
      return null;
    }
  `;
}

/**
 * 把作用域解析包成「失败即返回标记」的统一开头。
 *
 * ⚠️ 产出的是一个**表达式**(IIFE),不带结尾分号、不以换行开头 ——
 * 这样调用方无论写 `executeJavaScript(s)` 还是 `new Function('return (' + s + ')')` 都成立。
 * 踩过:脚本以换行开头时 `return\n(function...)` 会被 ASI 在 return 后插分号,
 * **结果恒 undefined 且不报错** —— 又一种「绿得毫无意义」。
 */
function withScope(containerSelector: string, body: string): string {
  return `(function() {
      ${scopePrelude(containerSelector)}
      var __root = __scope();
      if (__root === __AMBIGUOUS) return __AMBIGUOUS;
      if (__root === __NOT_FOUND) return __NOT_FOUND;
      ${body}
    })()`;
}

/**
 * focus 一个输入框(收编 `focusInputBox`)。
 *
 * 逻辑一字不改地搬:querySelector(支持逗号分隔多候选顺序尝试)→ scrollIntoView →
 * focus → 若 contenteditable 把光标移到内容末尾。
 *
 * ⚠️ 光标移末尾这步不能省:X 长文里表格等块插入后光标会卡在 cell 内,
 * 下一段文字就插进表格里(`x-article-driver.ts:410` 记的坑)。
 */
export function buildFocusScript(inputSelector: string, containerSelector = ''): string {
  return withScope(containerSelector, `
      var el = __pick(__root, ${JSON.stringify(inputSelector)});
      if (!el) return false;
      try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
      try { el.focus(); } catch (e) {}
      if (el.contentEditable === 'true' && document.createRange) {
        try {
          var range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          var sel2 = window.getSelection();
          if (sel2) { sel2.removeAllRanges(); sel2.addRange(range); }
        } catch (e) {}
      }
      return true;
  `);
}

/**
 * ⭐ 主路径:在 guest 自己的 JS 上下文里**合成一个真实 paste 事件**。
 *
 * 为什么这是主路径而不是 OS Cmd+V —— 见文件头注释三条。
 * textarea/input(value 型)也吃 paste 事件,故统一走这条;不吃时由兜底接。
 *
 * @param htmlText 传了则 DataTransfer 额外带 `text/html`(X Article 正文认富文本)
 */
export function buildSyntheticPasteScript(
  inputSelector: string,
  text: string,
  htmlText = '',
  containerSelector = '',
): string {
  return withScope(containerSelector, `
      var el = __pick(__root, ${JSON.stringify(inputSelector)});
      if (!el) return false;
      var text = ${JSON.stringify(text)};
      var html = ${JSON.stringify(htmlText)};
      try { el.focus(); } catch (e) {}
      try {
        var dt = new DataTransfer();
        dt.setData('text/plain', text);
        if (html) dt.setData('text/html', html);
        var evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        el.dispatchEvent(evt);
        return true;
      } catch (e) {
        // 环境不支持 ClipboardEvent/DataTransfer 构造 → 如实返 false,调用方走兜底
        return false;
      }
  `);
}

/**
 * 兜底 B:JS 直写(execCommand / native value setter)。
 *
 * ⚠️ 返回值区分走的是哪一支 —— 这是 `via` 能如实反映路径的前提:
 *   'native-setter'(textarea/input)/ 'exec-command'(contenteditable)/ false(没找到框)
 *
 * 原实现两支都只返 `true`,于是「走了哪条」只能靠 console 猜 ——
 * 这正是 §10.2 要补 `via` 的原因。
 */
export function buildDirectWriteScript(
  inputSelector: string,
  text: string,
  containerSelector = '',
): string {
  return withScope(containerSelector, `
      var el = __pick(__root, ${JSON.stringify(inputSelector)});
      if (!el) return false;
      try { el.focus(); } catch (e) {}
      var text = ${JSON.stringify(text)};
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value') ||
                           Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (nativeSetter && nativeSetter.set) {
          nativeSetter.set.call(el, text);
        } else {
          el.value = text;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return 'native-setter';
      }
      if (el.contentEditable === 'true') {
        try {
          document.execCommand('insertText', false, text);
        } catch (e) {
          el.textContent = text;
          el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true }));
        }
        return 'exec-command';
      }
      return false;
  `);
}

/**
 * 取「可辨识片段」—— 落地校验的 needle。
 *
 * 不用「length>0」:那会把「粘歪了但框里有别的内容」误判成功
 * (就是 X DraftJS 把 URL 渲染成卡片、文字丢失却 length>0 的坑)。
 * 取首 12 个非空白字符做包含匹配 —— 足以区分「我们的内容真进去了」vs「框里是别的/空的」,
 * 又不至于因 DraftJS 规范化空白而误判。
 */
export function landingNeedle(text: string): string {
  return [...text].filter((c) => !/\s/.test(c)).slice(0, 12).join('');
}

/** 落地校验:框内容(value 或 textContent)是否**包含**给定片段(去空白后比) */
export function buildContainsScript(
  inputSelector: string,
  fragment: string,
  containerSelector = '',
): string {
  return withScope(containerSelector, `
      var el = __pick(__root, ${JSON.stringify(inputSelector)});
      if (!el) return false;
      var needle = ${JSON.stringify(fragment)}.replace(/\\s/g, '');
      var content = (el.value !== undefined && el.value !== null ? el.value : el.textContent) || '';
      var stripped = content.replace(/\\s/g, '');
      // ⚠️ needle 为空(全空白文本)时退成「框非空」,而不是无条件 true ——
      //    无条件 true 等于不校验,那正是「看着成功实际没做」的形态。
      return needle.length === 0 ? content.trim().length > 0 : stripped.indexOf(needle) !== -1;
  `);
}

/** 落地校验:框内容与期望**完全相等**(去空白后比,容忍 DraftJS 的空白规范化) */
export function buildExactScript(
  inputSelector: string,
  text: string,
  containerSelector = '',
): string {
  return withScope(containerSelector, `
      var el = __pick(__root, ${JSON.stringify(inputSelector)});
      if (!el) return false;
      var expect = ${JSON.stringify(text)}.replace(/\\s/g, '');
      var content = (el.value !== undefined && el.value !== null ? el.value : el.textContent) || '';
      return content.replace(/\\s/g, '') === expect;
  `);
}

/** 某锚点在场吗(缩略图出现 / 转码完成 / 模态打开,共用这一个) */
export function buildAnchorExistsScript(anchorSelector: string, containerSelector = ''): string {
  return withScope(containerSelector, `
      return !!__pick(__root, ${JSON.stringify(anchorSelector)});
  `);
}

/**
 * 点一个元素(收编 `x-article-driver.clickSelector` 的形态)。
 *
 * 🚦 **中立原语**:不分等级、不设危险词表、**不拒绝任何目标**(§10.3)。
 * 现有 `clickByText` 里那份 `FORBIDDEN = ['publish','发布',...]` 词表**不搬** ——
 * 那是 X **业务层**的红线(闸门关闭时 X 写方向代码不调 `tap` 点发布按钮),
 * 不是底座的判断。证据:同一个「发送按钮」AI 必须自动点、X 绝不能点,
 * 差别在业务语义,底座无从判断。
 */
export function buildTapScript(anchorSelector: string, containerSelector = ''): string {
  return withScope(containerSelector, `
      var el = __pick(__root, ${JSON.stringify(anchorSelector)});
      if (!el) return false;
      try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
      el.click();
      return true;
  `);
}

/**
 * hover 一个元素 —— 完整鼠标进入序列。
 *
 * 现有代码血泪(`x-article-driver.ts:252`):X 表格网格按钮等**需 hover + 完整鼠标序列**
 * 才提交,光 `.click()` 不行。故 hover 不是 `mouseover` 一发了事。
 */
export function buildHoverScript(anchorSelector: string, containerSelector = ''): string {
  return withScope(containerSelector, `
      var el = __pick(__root, ${JSON.stringify(anchorSelector)});
      if (!el) return false;
      try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
      var r = el.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      ['pointerover', 'mouseover', 'mouseenter', 'mousemove'].forEach(function (t) {
        try {
          el.dispatchEvent(new MouseEvent(t, {
            bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy, button: 0,
          }));
        } catch (e) {}
      });
      return true;
  `);
}

/**
 * 合成按键(收编 `x-article-driver.ts:392` 的 Escape 兜底)。
 *
 * ⚠️ 往**当前焦点元素**派发(退化到 document.body),因为 webview 焦点隔离下
 * 主进程 `sendInputEvent` 未必送达 guest —— 与合成 paste 同源的理由。
 */
export function buildPressScript(key: string, containerSelector = ''): string {
  return withScope(containerSelector, `
      var target = (__root === document)
        ? (document.activeElement || document.body)
        : __root;
      if (!target) return false;
      var key = ${JSON.stringify(key)};
      ['keydown', 'keyup'].forEach(function (t) {
        try {
          target.dispatchEvent(new KeyboardEvent(t, {
            key: key, code: key, bubbles: true, cancelable: true,
          }));
        } catch (e) {}
      });
      return true;
  `);
}
