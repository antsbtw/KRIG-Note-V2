/**
 * 服务无关的「webview 输入框 focus + OS 级粘贴 + 发送按钮定位」原语(铁律 1)
 *
 * 背景:AI view(问 AI)与 X view(发推/回复)都要把一段文本「真粘贴」进某网页的
 * 输入框。这套「focus 输入框 → 备份剪贴板 → writeText → sendInputEvent OS 级 Cmd+V
 * → 验证内容落地 → 还原剪贴板」的逻辑**与具体服务无关**——唯一的服务差异是 selector
 * 字符串。故抽到 web-service-base,AI 的 writer.ts 与 X 的 x-write.ts 共用,不许各抄一份。
 *
 * 历史:这三段原先内联在 src/platform/main/ai/writer.ts(focusInput / pasteTextToAI /
 * clickSendButton),只是把 getAIServiceProfile(serviceId).selectors.* 写死在里面。
 * 本文件把 selector 提成入参,逻辑一字不改地下沉;writer.ts 改成传 AI profile selector
 * 的薄包装,X 侧传 X profile 的 composeBox/replyBox。
 *
 * ⚠️ 写方向红线:本文件**只**提供 focus / paste / 「定位」发送按钮三个原语。
 * 「点击发送」一律由调用方自己决定 —— AI 侧保留 clickSendButton(问答语义需要自动发),
 * X 侧**绝不**调用任何 click 发布按钮的代码(永远「填充内容,用户点发布」)。
 * 因此本文件的 locateSendButton 只「定位 / 校验存在」,不 click。
 */

import { clipboard, type WebContents } from 'electron';

const IS_MAC = process.platform === 'darwin';
const PASTE_MODIFIER: Array<'control' | 'meta'> = IS_MAC ? ['meta'] : ['control'];

/**
 * focus 一个输入框。
 *
 * sendInputEvent 的 OS 级 Cmd+V 需要 webContents 内焦点落在输入框上,否则粘贴落到
 * 无效目标。逻辑(与原 writer.focusInput 一致):querySelector(支持逗号分隔多 selector
 * 顺序尝试)→ scrollIntoView → focus → 若 contenteditable 把光标移到内容末尾。
 *
 * @param webContents 目标 guest webContents
 * @param inputSelector 输入框 CSS selector(支持逗号分隔多候选,顺序命中)
 * @returns 是否找到并 focus 了某个输入框
 */
export async function focusInputBox(
  webContents: WebContents,
  inputSelector: string,
): Promise<boolean> {
  const script = `
    (function() {
      var sel = ${JSON.stringify(inputSelector)};
      var selectors = sel.split(',').map(function(s) { return s.trim(); });
      for (var i = 0; i < selectors.length; i++) {
        if (!selectors[i]) continue;
        var el = document.querySelector(selectors[i]);
        if (el) {
          try { el.scrollIntoView({block:'center'}); } catch(e) {}
          try { el.focus(); } catch(e) {}
          if (el.contentEditable === 'true' && document.createRange) {
            try {
              var range = document.createRange();
              range.selectNodeContents(el);
              range.collapse(false);
              var sel2 = window.getSelection();
              if (sel2) {
                sel2.removeAllRanges();
                sel2.addRange(range);
              }
            } catch(e) {}
          }
          return true;
        }
      }
      return false;
    })();
  `;
  try {
    return Boolean(await webContents.executeJavaScript(script));
  } catch (err) {
    console.error('[webview-input] focusInputBox failed:', err);
    return false;
  }
}

/**
 * 把 text「真粘贴」进 webContents 的某输入框。
 *
 * 流程(与原 writer.pasteTextToAI 一致,只把 selector 提成入参):
 *   1. focusInputBox(找不到输入框 → 返回 false,调用方 fail loud)
 *   2. 备份用户剪贴板
 *   3. clipboard.writeText(text)
 *   4. sendInputEvent OS 级 Cmd+V / Ctrl+V(Chromium 走真 native paste,React state 同步)
 *   5. 等 ~400ms 让 React 接收 paste event + state update,然后校验内容落地
 *   6. 落地失败 → JS execCommand('insertText') / native value setter 兜底
 *   7. finally 还原剪贴板(延迟 500ms 确保 paste 已被消费)
 *
 * @param htmlText 可选富文本 HTML —— 传了则合成 paste 的 DataTransfer 额外带 `text/html`
 *   (X Article 正文等认富文本粘贴的编辑器用;X Articles 终态发布 2026-06-13)。
 *   主路径合成 paste 才用到;OS Cmd+V / execCommand 兜底仍只走 text/plain(富格式那两级不保证,
 *   富文本目标应命中主路径。校验仍按 text/plain 片段判落地)。不传 = 纯文本行为完全不变(防回归)。
 * @returns 内容是否成功落进输入框(true = 落地;false = 输入框没找到或两条路径都没生效)
 */
export async function pasteTextToWebview(
  webContents: WebContents,
  inputSelector: string,
  text: string,
  htmlText?: string,
): Promise<boolean> {
  // 1. focus input
  const focused = await focusInputBox(webContents, inputSelector);
  if (!focused) {
    console.warn('[webview-input] input element not found for selector:', inputSelector);
    return false;
  }

  // 2. 备份剪贴板(OS Cmd+V 兜底会写剪贴板,用完还原避免污染用户剪贴板)
  const originalClipboard = clipboard.readText();

  try {
    // 3. 主路径:在 guest 自己的 JS 上下文里**合成一个真实 paste 事件**(带 text/plain
    //    DataTransfer),dispatch 到输入框上。
    //
    //    为什么这是主路径(实机 spike 验证):
    //    - X 用 Electron <webview> 挂载,DOM/焦点与宿主隔离。主进程 sendInputEvent 的
    //      OS 级 Cmd+V 焦点打不进 guest 输入框 → 完全没送达(实测 textContent 为空)。
    //    - X reply/compose 框是 DraftJS(contenteditable),document.execCommand('insertText',
    //      多行) 在 DraftJS 下会丢行 / URL 被 link decorator 渲染重复(就是那个 bug)。
    //    - 合成 paste 事件在 guest 自身上下文 dispatch,不依赖 OS 焦点送达;DraftJS 的
    //      paste handler 会把 text/plain 按 \n 正确拆 block 插入 —— 文字 + 单条链接都对。
    //    textarea/input(value 型)也吃 paste 事件,故统一走这条;不吃时下面两级兜底接。
    const synthPasteScript = `
      (function() {
        var sel = ${JSON.stringify(inputSelector)};
        var text = ${JSON.stringify(text)};
        var html = ${JSON.stringify(htmlText ?? '')};
        var selectors = sel.split(',').map(function(s) { return s.trim(); });
        var el = null;
        for (var i = 0; i < selectors.length; i++) {
          if (!selectors[i]) continue;
          el = document.querySelector(selectors[i]);
          if (el) break;
        }
        if (!el) return false;
        try { el.focus(); } catch(e) {}
        try {
          var dt = new DataTransfer();
          dt.setData('text/plain', text);
          // 富文本目标(X Article 正文)：额外带 text/html，编辑器 paste handler 认富格式。
          if (html) dt.setData('text/html', html);
          var evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
          el.dispatchEvent(evt);
          return true;
        } catch(e) {
          return false; // 环境不支持 ClipboardEvent/DataTransfer 构造 → 调用方走兜底
        }
      })();
    `;
    try {
      await webContents.executeJavaScript(synthPasteScript);
    } catch (err) {
      console.warn('[webview-input] synthetic paste dispatch failed:', err);
    }

    // 4. 等框接收 paste + 重渲染(DraftJS state update,实测 ~300ms 足够)
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 5. 校验内容是否真落地 —— 不只看 length>0(那会把"粘歪了但有内容"误判成功),
    //    而是看框内容**包含预期文本的可辨识片段**(取降级文本首 12 个非空白字符)。
    const verifyScript = buildVerifyScript(inputSelector, text);
    if (await isLanded(webContents, verifyScript)) {
      console.log(`[webview-input] Pasted via synthetic paste event (length: ${text.length})`);
      return true;
    }

    // 6. 兜底 A:OS 级 Cmd+V(某些 webview / 普通 input 焦点态下才需要,且会真走 native
    //    paste)。需先把内容写进系统剪贴板。
    console.warn('[webview-input] synthetic paste did not land, falling back to OS Cmd+V');
    clipboard.writeText(text);
    webContents.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers: PASTE_MODIFIER });
    webContents.sendInputEvent({ type: 'char', keyCode: 'V', modifiers: PASTE_MODIFIER });
    webContents.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers: PASTE_MODIFIER });
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (await isLanded(webContents, verifyScript)) {
      console.log(`[webview-input] Pasted via OS Cmd+V fallback (length: ${text.length})`);
      return true;
    }

    // 7. 兜底 B:JS 直写(execCommand / native value setter)。最后手段——contenteditable
    //    多行可能有瑕疵(DraftJS \n 坑),但总比完全没内容强,且仍过下面的落地校验。
    console.warn('[webview-input] OS Cmd+V did not land, falling back to JS execCommand / setter');
    const fallbackScript = `
      (function() {
        var sel = ${JSON.stringify(inputSelector)};
        var selectors = sel.split(',').map(function(s) { return s.trim(); });
        var el = null;
        for (var i = 0; i < selectors.length; i++) {
          if (!selectors[i]) continue;
          el = document.querySelector(selectors[i]);
          if (el) break;
        }
        if (!el) return false;
        try { el.focus(); } catch(e) {}
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
        } else if (el.contentEditable === 'true') {
          try {
            document.execCommand('insertText', false, text);
          } catch(e) {
            el.textContent = text;
            el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true }));
          }
        }
        return true;
      })();
    `;
    try {
      await webContents.executeJavaScript(fallbackScript);
      await new Promise((resolve) => setTimeout(resolve, 200));
      const ok = await isLanded(webContents, verifyScript);
      if (ok) {
        console.log('[webview-input] Pasted via JS execCommand / setter fallback');
      } else {
        console.warn('[webview-input] all paste paths exhausted, content did not land');
      }
      return ok;
    } catch (err) {
      console.error('[webview-input] Fallback failed:', err);
      return false;
    }
  } finally {
    // 还原剪贴板(延迟 500ms 确保 OS Cmd+V 兜底若用了已被消费)
    setTimeout(() => {
      try {
        clipboard.writeText(originalClipboard);
      } catch { /* ignore */ }
    }, 500);
  }
}

/**
 * 构造「内容落地校验」脚本:框内容(value 或 textContent)是否**包含预期文本的可辨识片段**。
 *
 * 不用「length>0」:那会把「粘歪了但框里有别的内容」误判成功(就是 X DraftJS 把 URL 渲染
 * 成卡片、文字丢失却 length>0 的坑)。取降级文本首 12 个非空白字符做包含匹配 —— 足以区分
 * 「我们的内容真进去了」vs「框里是别的/空的」,又不至于因 DraftJS 规范化空白而误判。
 */
function buildVerifyScript(inputSelector: string, text: string): string {
  const needle = [...text].filter((c) => !/\s/.test(c)).slice(0, 12).join('');
  return `
    (function() {
      var sel = ${JSON.stringify(inputSelector)};
      var needle = ${JSON.stringify(needle)};
      var selectors = sel.split(',').map(function(s) { return s.trim(); });
      for (var i = 0; i < selectors.length; i++) {
        if (!selectors[i]) continue;
        var el = document.querySelector(selectors[i]);
        if (el) {
          var content = (el.value !== undefined && el.value !== null ? el.value : el.textContent) || '';
          var stripped = content.replace(/\\s/g, '');
          return needle.length === 0 ? content.trim().length > 0 : stripped.indexOf(needle) !== -1;
        }
      }
      return false;
    })();
  `;
}

/** 跑校验脚本,返回内容是否落地(异常按未落地处理) */
async function isLanded(webContents: WebContents, verifyScript: string): Promise<boolean> {
  try {
    return Boolean(await webContents.executeJavaScript(verifyScript));
  } catch {
    return false;
  }
}

/**
 * 定位发送 / 发布按钮 —— ⚠️ 只「查存在 + 是否可用」,**不 click**。
 *
 * 写方向红线:发布那一下永远留给用户。X 侧用本原语「校验粘贴后发布按钮已出现/可点」
 * 作为「内容已正确落进框」的辅助信号,但绝不程序点击。AI 侧的自动发送走自己的
 * clickSendButton(问答语义),不复用本原语。
 *
 * @returns { found: 是否找到按钮, enabled: 找到且未 disabled / aria-disabled }
 */
export async function locateSendButton(
  webContents: WebContents,
  sendSelector: string,
): Promise<{ found: boolean; enabled: boolean }> {
  if (!sendSelector) return { found: false, enabled: false };
  const script = `
    (function() {
      var sel = ${JSON.stringify(sendSelector)};
      var selectors = sel.split(',').map(function(s) { return s.trim(); });
      for (var i = 0; i < selectors.length; i++) {
        if (!selectors[i]) continue;
        var el = document.querySelector(selectors[i]);
        if (el) {
          var disabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true';
          return { found: true, enabled: !disabled };
        }
      }
      return { found: false, enabled: false };
    })();
  `;
  try {
    const r = await webContents.executeJavaScript(script);
    return {
      found: Boolean(r?.found),
      enabled: Boolean(r?.enabled),
    };
  } catch (err) {
    console.error('[webview-input] locateSendButton failed:', err);
    return { found: false, enabled: false };
  }
}

/** OS 级粘贴用的修饰键(Cmd / Ctrl)— 供调用方需要时复用(如自定义发送序列) */
export { PASTE_MODIFIER };
