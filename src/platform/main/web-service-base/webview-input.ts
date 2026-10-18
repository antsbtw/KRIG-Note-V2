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

import { clipboard, nativeImage, type WebContents } from 'electron';

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
    console.warn(
      '[webview-input] input element not found for selector:',
      inputSelector,
      '· 页面上实际可编辑元素:',
      await describeEditableCandidates(webContents),
    );
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
 * 「附件预览出现」的信号计数脚本 —— pasteImageToWebview 判落地用。
 *
 * ⚠️ 这是**我的判断**(2026-10-17),未逐站实测:三家 AI 粘图后都会在输入区出一个
 * 缩略图,但 DOM 各不相同,这里取几类通用信号求和,任一增加即视为落地:
 *   - img[src^=blob:/data:](本地预览图的常见形态)
 *   - class / data-testid 含 attachment / file-preview / thumbnail 的元素
 *   - 输入区(输入框向上 6 层)内的 img 数 —— 2026-10-17 Claude 实测补:合成 paste 后
 *     输入区 imgs=[],前三类信号在 Claude 上不一定会变
 * 每次都把各信号计数打日志 —— 真机某家判不出时,按日志里的数换判据,别猜。
 */
function attachmentSignalScript(inputSelector: string): string {
  return `
  (function() {
    var q = function(s) { try { return document.querySelectorAll(s).length; } catch(e) { return 0; } };
    // 输入框向上 6 层祖先 = 输入区;其中的 img 数(Claude 上传缩略图不一定是 blob:/data:)
    var selectors = ${JSON.stringify(inputSelector)}.split(',').map(function(s) { return s.trim(); });
    var el = null;
    for (var i = 0; i < selectors.length && !el; i++) { if (selectors[i]) el = document.querySelector(selectors[i]); }
    var composerImg = 0;
    if (el) {
      var root = el;
      for (var k = 0; k < 6 && root.parentElement; k++) root = root.parentElement;
      composerImg = root.querySelectorAll('img').length;
    }
    return {
      localImg: q('img[src^="blob:"], img[src^="data:"]'),
      attachment: q('[class*="attachment" i], [data-testid*="attachment" i]'),
      preview: q('[class*="file-preview" i], [class*="thumbnail" i], [data-testid*="file" i]'),
      composerImg: composerImg,
    };
  })();
`;
}

type AttachmentSignals = { localImg: number; attachment: number; preview: number; composerImg: number };

async function readAttachmentSignals(
  webContents: WebContents,
  inputSelector: string,
): Promise<AttachmentSignals | null> {
  try {
    return (await webContents.executeJavaScript(attachmentSignalScript(inputSelector))) as AttachmentSignals;
  } catch {
    return null;
  }
}

function signalsGrew(before: AttachmentSignals, after: AttachmentSignals | null): boolean {
  if (!after) return false;
  return (
    after.localImg > before.localImg ||
    after.attachment > before.attachment ||
    after.preview > before.preview ||
    after.composerImg > before.composerImg
  );
}

/** 轮询等附件信号增长(上传预览渲染需要时间) */
async function waitAttachmentLanded(
  webContents: WebContents,
  inputSelector: string,
  before: AttachmentSignals,
  timeoutMs: number,
): Promise<AttachmentSignals | null> {
  const deadline = Date.now() + timeoutMs;
  let last: AttachmentSignals | null = null;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    last = await readAttachmentSignals(webContents, inputSelector);
    if (signalsGrew(before, last)) return last;
  }
  return null;
}

/**
 * 把一张图片(dataUrl)「真粘贴」进 webContents 的某输入框 —— pasteTextToWebview 的图片版。
 *
 * 流程:
 *   1. focusInputBox(找不到 → landed=false)
 *   2. 记下附件信号基线
 *   3. 主路径:guest 上下文合成 paste,DataTransfer 带一个 image File(与文字主路径同理)
 *      —— ChatGPT 实测走这条落地
 *   4. 没落地 → 次选:塞进页面的 <input type=file> + 派发 change(Claude 不吃合成 paste)
 *   5. 仍没落地 → 兜底:clipboard.writeImage + OS Cmd+V(还原用户剪贴板文字)
 *
 * 只负责「图进了输入区」;上传是否完成由调用方等发送按钮可用来判(上传中按钮通常禁用)。
 *
 * @returns landed + 各信号计数(调用方打日志 / 拼错误信息用)
 */
export async function pasteImageToWebview(
  webContents: WebContents,
  inputSelector: string,
  dataUrl: string,
): Promise<{ landed: boolean; detail: string }> {
  const m = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl);
  if (!m) return { landed: false, detail: 'imageDataUrl 不是 base64 dataUrl' };
  const mime = m[1];
  const base64 = m[2];
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';

  const focused = await focusInputBox(webContents, inputSelector);
  if (!focused) {
    const candidates = await describeEditableCandidates(webContents);
    return { landed: false, detail: `输入框没找到: ${inputSelector} · 页面上实际可编辑元素: ${candidates}` };
  }

  const before = await readAttachmentSignals(webContents, inputSelector);
  if (!before) return { landed: false, detail: '读不到附件信号基线(executeJavaScript 失败)' };

  // 3. 主路径:合成 paste(atob 手工解码,不用 fetch(dataUrl) —— 站点 CSP 可能拦 data: fetch)
  const synthScript = `
    (function() {
      var sel = ${JSON.stringify(inputSelector)};
      var selectors = sel.split(',').map(function(s) { return s.trim(); });
      var el = null;
      for (var i = 0; i < selectors.length; i++) {
        if (!selectors[i]) continue;
        el = document.querySelector(selectors[i]);
        if (el) break;
      }
      if (!el) return 'no-input';
      try { el.focus(); } catch(e) {}
      try {
        var bin = atob(${JSON.stringify(base64)});
        var bytes = new Uint8Array(bin.length);
        for (var j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
        var file = new File([bytes], ${JSON.stringify(`krig-capture.${ext}`)}, { type: ${JSON.stringify(mime)} });
        var dt = new DataTransfer();
        dt.items.add(file);
        var evt = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        el.dispatchEvent(evt);
        return 'dispatched';
      } catch(e) {
        return 'error: ' + String(e);
      }
    })();
  `;
  let synthResult = '';
  try {
    synthResult = String(await webContents.executeJavaScript(synthScript));
  } catch (err) {
    synthResult = `executeJavaScript failed: ${String(err)}`;
  }
  let after = await waitAttachmentLanded(webContents, inputSelector, before, 3000);
  if (after) {
    const detail = `synthetic paste · before=${JSON.stringify(before)} after=${JSON.stringify(after)}`;
    console.log(`[webview-input] image landed via ${detail}`);
    return { landed: true, detail };
  }

  // 4. 次选:塞进页面的 <input type=file>(2026-10-17 Claude 实测:合成 paste 不吃,
  //    输入区旁有隐藏的 input[data-testid=file-upload])。input.files 赋 DataTransfer.files
  //    + 派发 change,等价用户在文件选择框里选了这张图。优先取输入区内的,再退全页第一个收图的。
  console.warn(`[webview-input] synthetic image paste did not land (${synthResult}), trying <input type=file>`);
  const fileInputScript = `
    (function() {
      var selectors = ${JSON.stringify(inputSelector)}.split(',').map(function(s) { return s.trim(); });
      var el = null;
      for (var i = 0; i < selectors.length && !el; i++) { if (selectors[i]) el = document.querySelector(selectors[i]); }
      var acceptsImage = function(inp) {
        var a = (inp.getAttribute('accept') || '').toLowerCase();
        return !a || a.indexOf('image') !== -1 || a.indexOf('.jpg') !== -1 || a.indexOf('.jpeg') !== -1 || a.indexOf('*') !== -1;
      };
      var pick = null;
      if (el) {
        var root = el;
        for (var k = 0; k < 6 && root.parentElement; k++) root = root.parentElement;
        var near = root.querySelectorAll('input[type="file"]');
        for (var n = 0; n < near.length && !pick; n++) if (acceptsImage(near[n])) pick = near[n];
      }
      if (!pick) {
        var all = document.querySelectorAll('input[type="file"]');
        for (var m = 0; m < all.length && !pick; m++) if (acceptsImage(all[m])) pick = all[m];
      }
      if (!pick) return 'no-file-input';
      try {
        var bin = atob(${JSON.stringify(base64)});
        var bytes = new Uint8Array(bin.length);
        for (var j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
        var file = new File([bytes], ${JSON.stringify(`krig-capture.${ext}`)}, { type: ${JSON.stringify(mime)} });
        var dt = new DataTransfer();
        dt.items.add(file);
        pick.files = dt.files;
        pick.dispatchEvent(new Event('input', { bubbles: true }));
        pick.dispatchEvent(new Event('change', { bubbles: true }));
        return 'set:' + (pick.getAttribute('data-testid') || pick.id || 'input[type=file]');
      } catch(e) {
        return 'error: ' + String(e);
      }
    })();
  `;
  let fileInputResult = '';
  try {
    fileInputResult = String(await webContents.executeJavaScript(fileInputScript));
  } catch (err) {
    fileInputResult = `executeJavaScript failed: ${String(err)}`;
  }
  if (fileInputResult.startsWith('set:')) {
    after = await waitAttachmentLanded(webContents, inputSelector, before, 5000);
    if (after) {
      const detail = `file input (${fileInputResult}) · before=${JSON.stringify(before)} after=${JSON.stringify(after)}`;
      console.log(`[webview-input] image landed via ${detail}`);
      return { landed: true, detail };
    }
  }

  // 5. 兜底:OS 级 Cmd+V(系统剪贴板放图片)
  console.warn(`[webview-input] file input did not land (${fileInputResult}), falling back to OS Cmd+V`);
  const originalText = clipboard.readText();
  try {
    await focusInputBox(webContents, inputSelector);
    clipboard.writeImage(nativeImage.createFromDataURL(dataUrl));
    webContents.sendInputEvent({ type: 'keyDown', keyCode: 'V', modifiers: PASTE_MODIFIER });
    webContents.sendInputEvent({ type: 'char', keyCode: 'V', modifiers: PASTE_MODIFIER });
    webContents.sendInputEvent({ type: 'keyUp', keyCode: 'V', modifiers: PASTE_MODIFIER });
    after = await waitAttachmentLanded(webContents, inputSelector, before, 3000);
  } finally {
    setTimeout(() => {
      try {
        clipboard.writeText(originalText);
      } catch { /* ignore */ }
    }, 500);
  }
  const last = after ?? (await readAttachmentSignals(webContents, inputSelector));
  const detail = `before=${JSON.stringify(before)} after=${JSON.stringify(last)} synth=${synthResult} fileInput=${fileInputResult}`;
  if (after) {
    console.log(`[webview-input] image landed via OS Cmd+V · ${detail}`);
    return { landed: true, detail: `OS Cmd+V · ${detail}` };
  }
  const composer = await describeComposerArea(webContents, inputSelector);
  console.error(`[webview-input] image paste did not land · ${detail} · composer: ${composer}`);
  return { landed: false, detail: `${detail} · composer: ${composer}` };
}

/**
 * 输入框 selector 没命中时,列出页面上实际存在的可编辑元素(tag/id/class/testid)+ 页面 URL。
 *
 * 站点改版换了输入框 DOM 是常态;报错里直接带上「现在实际是什么」,照着改 selector,不用猜。
 */
export async function describeEditableCandidates(webContents: WebContents): Promise<string> {
  const script = `
    (function() {
      var els = document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]');
      var out = [];
      for (var i = 0; i < els.length && i < 8; i++) {
        var el = els[i];
        var cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\\s+/).slice(0, 4).join('.');
        out.push(el.tagName.toLowerCase()
          + (el.id ? '#' + el.id : '')
          + (cls ? '.' + cls : '')
          + (el.getAttribute('data-testid') ? '[data-testid=' + el.getAttribute('data-testid') + ']' : '')
          + (el.getAttribute('aria-label') ? '[aria-label=' + el.getAttribute('aria-label') + ']' : ''));
      }
      return 'url=' + location.href + ' readyState=' + document.readyState + ' n=' + els.length + ' [' + out.join(' | ') + ']';
    })();
  `;
  try {
    return String(await webContents.executeJavaScript(script));
  } catch (err) {
    return `(读取失败: ${String(err)})`;
  }
}

/**
 * 粘图判「没落地」时,描述输入框周围(向上 6 层祖先的子树)实际有什么:
 * img(src 前缀)+ class/testid/aria-label 含 file/upload/attach/image/preview 的元素。
 *
 * 用途:某站点图其实进去了但附件信号没认出来时,照这份真实 DOM 改判据,不猜。
 */
async function describeComposerArea(webContents: WebContents, inputSelector: string): Promise<string> {
  const script = `
    (function() {
      var selectors = ${JSON.stringify(inputSelector)}.split(',').map(function(s) { return s.trim(); });
      var el = null;
      for (var i = 0; i < selectors.length && !el; i++) { if (selectors[i]) el = document.querySelector(selectors[i]); }
      if (!el) return 'no-input';
      var root = el;
      for (var k = 0; k < 6 && root.parentElement; k++) root = root.parentElement;
      var imgs = [];
      root.querySelectorAll('img').forEach(function(im) { if (imgs.length < 6) imgs.push((im.getAttribute('src') || '').slice(0, 40)); });
      var hits = [];
      var re = /file|upload|attach|image|preview|thumb/i;
      root.querySelectorAll('*').forEach(function(n) {
        if (hits.length >= 12) return;
        var cls = typeof n.className === 'string' ? n.className : '';
        var tid = n.getAttribute('data-testid') || '';
        var al = n.getAttribute('aria-label') || '';
        if (re.test(cls) || re.test(tid) || re.test(al)) {
          hits.push(n.tagName.toLowerCase() + (tid ? '[testid=' + tid + ']' : '') + (al ? '[aria=' + al.slice(0, 30) + ']' : '') + (cls ? '.' + cls.trim().split(/\\s+/).slice(0, 3).join('.') : ''));
        }
      });
      return 'rootTag=' + root.tagName.toLowerCase() + ' imgs=[' + imgs.join(' | ') + '] hits=[' + hits.join(' | ') + ']';
    })();
  `;
  try {
    return String(await webContents.executeJavaScript(script));
  } catch (err) {
    return `(读取失败: ${String(err)})`;
  }
}

/** OS 级粘贴的修饰键(mac=Cmd,其余=Ctrl)—— 供同族原语复用 */
export { PASTE_MODIFIER };
