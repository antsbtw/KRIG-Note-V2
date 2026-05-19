/**
 * ContentSender — paste text/images into AI service input box.
 *
 * V1 源:src/plugins/web-bridge/capabilities/writer.ts(字面搬,改 import alias)
 */

import { getAIServiceProfile, type AIServiceId } from '@shared/types/ai-service-types';

/**
 * Paste text into the AI service input box via executeJavaScript.
 * Uses ClipboardEvent simulation for contentEditable (ChatGPT/Claude)
 * and value assignment for textarea (Gemini).
 */
export async function pasteTextToAI(
  webContents: Electron.WebContents,
  serviceId: AIServiceId,
  text: string,
): Promise<boolean> {
  const profile = getAIServiceProfile(serviceId);
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');

  const script = `
    (function() {
      var selector = ${JSON.stringify(profile.selectors.inputBox)};
      var selectors = selector.split(',').map(function(s) { return s.trim(); });
      var el = null;
      for (var i = 0; i < selectors.length; i++) {
        el = document.querySelector(selectors[i]);
        if (el) break;
      }
      if (!el) return { success: false, error: 'Input element not found' };

      var text = \`${escaped}\`;

      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        el.focus();
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (el.contentEditable === 'true') {
        el.focus();
        var dt = new DataTransfer();
        dt.setData('text/plain', text);
        var pasteEvent = new ClipboardEvent('paste', {
          bubbles: true, cancelable: true, clipboardData: dt,
        });
        el.dispatchEvent(pasteEvent);

        // Fallback: if paste didn't populate, set innerHTML directly
        setTimeout(function() {
          if (el.textContent.trim().length === 0) {
            el.innerHTML = '<p>' + text.replace(/\\n/g, '</p><p>') + '</p>';
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, 200);
      }

      return { success: true };
    })();
  `;

  try {
    const result = await webContents.executeJavaScript(script);
    if (result?.success) {
      console.log(`[ContentSender] Pasted text into ${profile.name} input`);
      return true;
    }
    console.warn(`[ContentSender] ${profile.name} input not found`);
    return false;
  } catch (error) {
    console.error(`[ContentSender] Failed to paste into ${profile.name}:`, error);
    return false;
  }
}

/**
 * Click the send button to submit the prompt.
 *
 * 三层 fallback:
 *   1. 用 profile.selectors.sendButton 找按钮 → click()(不 disabled)
 *   2. 找不到/disabled → 在输入框上 dispatch KeyboardEvent('keydown', {key:'Enter'})
 *      (Claude/ChatGPT/Gemini 输入框都是 ProseMirror/Quill/contenteditable,响应
 *       JS-dispatched keydown 触发它们的 submit handler)
 *   3. 仍失败 → webContents.sendInputEvent OS 级 Return(最弱兜底)
 *
 * V1 第 3 步直接被用,但 V2 测试发现 sendInputEvent 不被 contenteditable 收到。
 * 第 2 步是 V1 没有的强化(根治"send button not found"案例)。
 */
export async function clickSendButton(
  webContents: Electron.WebContents,
  serviceId: AIServiceId,
): Promise<boolean> {
  const profile = getAIServiceProfile(serviceId);

  const script = `
    (function() {
      var sendSel = ${JSON.stringify(profile.selectors.sendButton)};
      var inputSel = ${JSON.stringify(profile.selectors.inputBox)};
      var sendSelectors = sendSel.split(',').map(function(s) { return s.trim(); });
      var inputSelectors = inputSel.split(',').map(function(s) { return s.trim(); });

      // ── Step 1: 找 send button + click ──
      var btn = null;
      for (var i = 0; i < sendSelectors.length; i++) {
        var el = document.querySelector(sendSelectors[i]);
        // 拒 disabled 按钮(刚 paste 时按钮可能还在 disabled 状态)
        if (el && !el.disabled && el.getAttribute('aria-disabled') !== 'true') {
          btn = el;
          break;
        }
      }
      if (btn) {
        btn.click();
        return { success: true, via: 'click', sel: btn.tagName + (btn.getAttribute('aria-label') ? '[' + btn.getAttribute('aria-label') + ']' : '') };
      }

      // ── Step 2: 找 input 元素 → dispatch keydown Enter ──
      var input = null;
      for (var j = 0; j < inputSelectors.length; j++) {
        input = document.querySelector(inputSelectors[j]);
        if (input) break;
      }
      if (input) {
        try {
          input.focus();
        } catch (e) { /* ignore */ }
        var ev = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
          composed: true,
        });
        input.dispatchEvent(ev);
        // 部分输入框需要 keypress + keyup 配合(老 React/Vue 监听)
        var ev2 = new KeyboardEvent('keypress', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          bubbles: true, cancelable: true,
        });
        input.dispatchEvent(ev2);
        var ev3 = new KeyboardEvent('keyup', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          bubbles: true, cancelable: true,
        });
        input.dispatchEvent(ev3);
        return { success: true, via: 'dispatch-enter' };
      }

      return { success: false, error: 'No send button + no input element found' };
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
    // 最弱兜底:OS 级 Return(V2 测试中此路径常被 contenteditable 忽略,但留底防御)
    console.warn(`[ContentSender] DOM-level submit failed for ${profile.name}: ${result?.error}, trying OS-level Return`);
    webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
    webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    return false;
  } catch (error) {
    console.error(`[ContentSender] Failed to click send for ${profile.name}:`, error);
    return false;
  }
}
