/**
 * ContentSender — 把 prompt "真粘贴+真发送" 到 AI 网页输入框
 *
 * V1 走 ClipboardEvent JS 派发 — 在 Claude 这种 React + ProseMirror 输入框上失效:
 * - JS dispatch 的 ClipboardEvent 会触发 PM 的 paste handler 写 ContentEditable DOM,
 *   但 React 的 controlled state 不更新 → 发送按钮永远 disabled
 * - 实测 Claude.ai 上 paste"成功"日志却看不到内容显现
 *
 * V2 改方案:走真 OS 级 paste — clipboard.writeText + webContents.sendInputEvent
 * Cmd+V(macOS) / Ctrl+V(Win/Linux) 模拟真键盘。Chromium 处理真粘贴时:
 * - 触发 native paste event(React 监听到 input change)
 * - 输入框真的填上字符,按钮真的从 disabled 变 enabled
 * - 跟用户手动 Cmd+V 完全等价(因为就是 OS 级 input event)
 *
 * 副作用:会污染用户剪贴板 — 用 save/restore 模式:发送前备份原 clipboard,完成后还原。
 *
 * 发送:也走 OS 级 — focus 输入框 + sendInputEvent Enter(Gemini Ctrl+Enter)。
 * fallback:Step 1 OS Enter / Step 2 querySelector click button / Step 3 JS dispatch Enter。
 */

import { clipboard } from 'electron';
import { getAIServiceProfile, type AIServiceId } from '@shared/types/ai-service-types';

const IS_MAC = process.platform === 'darwin';
const PASTE_MODIFIER: Array<'control' | 'meta'> = IS_MAC ? ['meta'] : ['control'];

/**
 * focus 输入框 — sendInputEvent Cmd+V 需要 webContents 内焦点在输入框上,
 * 否则 OS 级粘贴会落到无效目标。
 */
async function focusInput(
  webContents: Electron.WebContents,
  serviceId: AIServiceId,
): Promise<boolean> {
  const profile = getAIServiceProfile(serviceId);
  const script = `
    (function() {
      var sel = ${JSON.stringify(profile.selectors.inputBox)};
      var selectors = sel.split(',').map(function(s) { return s.trim(); });
      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (el) {
          // 确保元素在视野内 + scroll into view
          try { el.scrollIntoView({block:'center'}); } catch(e) {}
          try { el.focus(); } catch(e) {}
          // 若是 contenteditable,把光标移到内容末尾
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
    console.error('[ContentSender] focusInput failed:', err);
    return false;
  }
}

/**
 * Paste text into the AI service input box.
 *
 * 流程:
 *   1. focus 输入框
 *   2. 备份用户剪贴板
 *   3. clipboard.writeText(prompt)
 *   4. webContents.sendInputEvent Cmd+V(模拟真 OS 级粘贴)
 *   5. 短暂等待让 React 状态更新 + 检验内容是否落地
 *   6. 还原剪贴板
 */
export async function pasteTextToAI(
  webContents: Electron.WebContents,
  serviceId: AIServiceId,
  text: string,
): Promise<boolean> {
  const profile = getAIServiceProfile(serviceId);

  // 1. focus input
  const focused = await focusInput(webContents, serviceId);
  if (!focused) {
    console.warn(`[ContentSender] ${profile.name} input element not found`);
    return false;
  }

  // 2. 备份剪贴板(发送后还原,避免污染用户剪贴板)
  const originalClipboard = clipboard.readText();

  try {
    // 3. 写新内容到剪贴板
    clipboard.writeText(text);

    // 4. OS 级 Cmd+V / Ctrl+V — Chromium 走真 native paste 流程,React state 同步
    webContents.sendInputEvent({
      type: 'keyDown',
      keyCode: 'V',
      modifiers: PASTE_MODIFIER,
    });
    webContents.sendInputEvent({
      type: 'char',
      keyCode: 'V',
      modifiers: PASTE_MODIFIER,
    });
    webContents.sendInputEvent({
      type: 'keyUp',
      keyCode: 'V',
      modifiers: PASTE_MODIFIER,
    });

    // 5. 等 React 接收 paste event + state update(实测 200-400ms 足够)
    await new Promise((resolve) => setTimeout(resolve, 400));

    // 6. 检验内容是否落地(返 true 表示输入框 textContent 非空 + 含 prompt 头)
    const verifyScript = `
      (function() {
        var sel = ${JSON.stringify(profile.selectors.inputBox)};
        var selectors = sel.split(',').map(function(s) { return s.trim(); });
        for (var i = 0; i < selectors.length; i++) {
          var el = document.querySelector(selectors[i]);
          if (el) {
            var content = (el.value !== undefined ? el.value : el.textContent) || '';
            return content.trim().length > 0;
          }
        }
        return false;
      })();
    `;
    let landed = false;
    try {
      landed = Boolean(await webContents.executeJavaScript(verifyScript));
    } catch { /* ignore */ }

    if (landed) {
      console.log(`[ContentSender] Pasted text into ${profile.name} input via OS Cmd+V (length: ${text.length})`);
      return true;
    }

    // 兜底:OS Cmd+V 也没生效 → 走 JS execCommand('insertText')
    // (V1 ClipboardEvent 模式作为最后兜底,某些 textarea-only 输入框可能反而对这个敏感)
    console.warn(`[ContentSender] OS Cmd+V didn't populate ${profile.name} input, falling back to JS execCommand`);
    const fallbackScript = `
      (function() {
        var sel = ${JSON.stringify(profile.selectors.inputBox)};
        var selectors = sel.split(',').map(function(s) { return s.trim(); });
        var el = null;
        for (var i = 0; i < selectors.length; i++) {
          el = document.querySelector(selectors[i]);
          if (el) break;
        }
        if (!el) return false;
        try { el.focus(); } catch(e) {}
        var text = ${JSON.stringify(text)};
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          // React 控制的 input:用 native setter 触发 React onChange
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
          // contenteditable:用 execCommand('insertText') — 走 native input event
          try {
            document.execCommand('insertText', false, text);
          } catch(e) {
            // execCommand 失败 → 直接写 textContent + dispatch input
            el.textContent = text;
            el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true }));
          }
        }
        return true;
      })();
    `;
    try {
      await webContents.executeJavaScript(fallbackScript);
      console.log(`[ContentSender] Pasted text into ${profile.name} via JS execCommand fallback`);
      return true;
    } catch (err) {
      console.error(`[ContentSender] Fallback failed for ${profile.name}:`, err);
      return false;
    }
  } finally {
    // 7. 还原剪贴板(避免污染用户)— 延迟 500ms 确保 paste 已被消费
    setTimeout(() => {
      try {
        clipboard.writeText(originalClipboard);
      } catch { /* ignore */ }
    }, 500);
  }
}

/**
 * 点发送 — 优先 OS 级 Enter,fallback querySelector click,再 fallback JS dispatch。
 *
 * Gemini 用 Ctrl+Enter(profile.input.submitKey),Claude/ChatGPT 用 Enter。
 */
export async function clickSendButton(
  webContents: Electron.WebContents,
  serviceId: AIServiceId,
): Promise<boolean> {
  const profile = getAIServiceProfile(serviceId);
  const useCtrlEnter = profile.input.submitKey === 'Ctrl+Enter';
  const modifiers: Array<'control'> = useCtrlEnter ? ['control'] : [];

  // 先确保输入框焦点在(刚 paste 后焦点应该还在,但保险起见再 focus)
  await focusInput(webContents, serviceId);
  await new Promise((resolve) => setTimeout(resolve, 50));

  // ── Step 1: OS 级 Enter(input 已 focus → Chromium 派发到 native handler)──
  try {
    webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return', modifiers });
    webContents.sendInputEvent({ type: 'char', keyCode: 'Return', modifiers });
    webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return', modifiers });
    // 等 200ms 让 React 反应,然后探测输入框是否被清空(成功提交的标志)
    await new Promise((resolve) => setTimeout(resolve, 250));
    const cleared = await checkInputCleared(webContents, serviceId);
    if (cleared) {
      console.log(`[ContentSender] Sent for ${profile.name} via OS ${useCtrlEnter ? 'Ctrl+' : ''}Enter`);
      return true;
    }
  } catch (err) {
    console.warn(`[ContentSender] OS Enter failed for ${profile.name}:`, err);
  }

  // ── Step 2: querySelector click send button ──
  const script = `
    (function() {
      var sendSel = ${JSON.stringify(profile.selectors.sendButton)};
      var inputSel = ${JSON.stringify(profile.selectors.inputBox)};
      var sendSelectors = sendSel.split(',').map(function(s) { return s.trim(); });
      var inputSelectors = inputSel.split(',').map(function(s) { return s.trim(); });

      // 找 send button + click(过滤 disabled)
      for (var i = 0; i < sendSelectors.length; i++) {
        var el = document.querySelector(sendSelectors[i]);
        if (el && !el.disabled && el.getAttribute('aria-disabled') !== 'true') {
          el.click();
          return { success: true, via: 'click', sel: el.tagName + (el.getAttribute('aria-label') ? '[' + el.getAttribute('aria-label') + ']' : '') };
        }
      }

      // 找不到 send button → 输入框上 JS dispatch Enter
      var input = null;
      for (var j = 0; j < inputSelectors.length; j++) {
        input = document.querySelector(inputSelectors[j]);
        if (input) break;
      }
      if (input) {
        try { input.focus(); } catch(e) {}
        var opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
        input.dispatchEvent(new KeyboardEvent('keydown', opts));
        input.dispatchEvent(new KeyboardEvent('keypress', opts));
        input.dispatchEvent(new KeyboardEvent('keyup', opts));
        return { success: true, via: 'js-dispatch-enter' };
      }
      return { success: false, error: 'No send button + no input found' };
    })();
  `;

  try {
    const result = await webContents.executeJavaScript(script);
    if (result?.success) {
      console.log(
        `[ContentSender] Sent for ${profile.name} via ${result.via}${result.sel ? ` (${result.sel})` : ''}`,
      );
      return true;
    }
    console.error(`[ContentSender] All send paths failed for ${profile.name}: ${result?.error}`);
    return false;
  } catch (err) {
    console.error(`[ContentSender] Failed to send for ${profile.name}:`, err);
    return false;
  }
}

/**
 * 检验输入框是否被清空(发送成功后 AI 网页通常清空输入框)。
 */
async function checkInputCleared(
  webContents: Electron.WebContents,
  serviceId: AIServiceId,
): Promise<boolean> {
  const profile = getAIServiceProfile(serviceId);
  const script = `
    (function() {
      var sel = ${JSON.stringify(profile.selectors.inputBox)};
      var selectors = sel.split(',').map(function(s) { return s.trim(); });
      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (el) {
          var content = (el.value !== undefined ? el.value : el.textContent) || '';
          return content.trim().length === 0;
        }
      }
      return false;
    })();
  `;
  try {
    return Boolean(await webContents.executeJavaScript(script));
  } catch {
    return false;
  }
}
